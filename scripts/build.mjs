import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const RESOURCES = path.join(ROOT, "apps/desktop/src-tauri/resources");
export const CACHE = path.join(ROOT, ".cache/native");
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const writeJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
export const run = (command, args = [], options = {}) =>
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
export const capture = (command, args = [], options = {}) =>
  run(command, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 32 * 1024 ** 2,
    ...options,
  });
export const isMain = (url) =>
  Boolean(process.argv[1]) &&
  fileURLToPath(url) === path.resolve(process.argv[1]);

export function inside(base, target) {
  const relative = path.relative(base, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function* walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function download(url, file, expected) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && (!expected || (await sha256(file)) === expected))
    return file;
  console.log(`Downloading ${path.basename(file)}`);
  const partial = `${file}.partial`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Fluenta-build/0.1" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body, fs.createWriteStream(partial));
  if (expected && (await sha256(partial)) !== expected)
    throw new Error(`Hash mismatch: ${path.basename(file)}`);
  fs.renameSync(partial, file);
  return file;
}

export function archivePath(base, name) {
  if (
    name.includes("\\") ||
    name.includes(":") ||
    name.startsWith("/") ||
    !inside(base, path.resolve(base, name))
  )
    throw new Error("Unsafe archive path");
  return path.resolve(base, name);
}

export async function extract(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const base = fs.realpathSync(destination);
  let total = 0;
  const budget = (size) => {
    total += size;
    if (!Number.isSafeInteger(total) || total > 2 * 1024 ** 3)
      throw new Error("Archive exceeds extraction budget");
  };
  if (archive.endsWith(".zip")) {
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(fs.readFileSync(archive), {
      filter(entry) {
        archivePath(base, entry.name);
        budget(entry.originalSize);
        return true;
      },
    });
    for (const [name, data] of Object.entries(entries)) {
      const target = archivePath(base, name);
      // Check existing ancestors too: an old symlink must not redirect extraction.
      for (
        let parent = target;
        parent !== base;
        parent = path.dirname(parent)
      ) {
        if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink())
          throw new Error("Unsafe archive path");
      }
      if (name.endsWith("/")) fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
    }
  } else {
    const { x } = await import("tar");
    await x({
      file: archive,
      cwd: base,
      strict: true,
      preserveOwner: false,
      filter(name, entry) {
        try {
          archivePath(base, name);
          budget(entry.size);
          if (entry.type === "SymbolicLink" || entry.type === "Link") {
            const link =
              entry.type === "SymbolicLink"
                ? path.posix.join(path.posix.dirname(name), entry.linkpath)
                : entry.linkpath;
            if (path.posix.isAbsolute(entry.linkpath))
              throw new Error("Unsafe archive link");
            archivePath(base, link);
          } else if (
            !["File", "Directory", "OldFile", "ContiguousFile"].includes(
              entry.type,
            )
          )
            throw new Error("Unsupported archive entry");
          return true;
        } catch (error) {
          this.abort(error);
          return false;
        }
      },
    });
  }
}

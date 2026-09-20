import * as fs from "node:fs";
import path from "node:path";
import { Zip, ZipDeflate } from "fflate";
import {
  ROOT,
  CACHE,
  readJson,
  capture,
  isMain,
  inside,
  walk,
} from "./build.mjs";

export async function writeZip(output, entries) {
  const partial = `${output}.partial`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const descriptor = fs.openSync(partial, "w");
  let bytes = 0;
  let count = 0;
  let ended = false;
  const zip = new Zip((error, data, final) => {
    if (error) throw error;
    bytes += data.length;
    // ponytail: ZIP32 is enough here; use a ZIP64 writer beyond 4 GiB / 65,534 files.
    if (bytes >= 0xffffffff)
      throw new Error("Source archive requires ZIP64 support");
    fs.writeFileSync(descriptor, data);
    ended = final;
  });
  try {
    for (const { name, file, data } of entries) {
      if (++count >= 65535)
        throw new Error("Source archive requires ZIP64 support");
      const stat = file ? fs.statSync(file) : undefined;
      if (stat && stat.size >= 0xffffffff)
        throw new Error("Source file requires ZIP64 support");
      const entry = new ZipDeflate(name, { level: 6 });
      entry.os = 3;
      entry.attrs = ((stat?.mode ?? 0o100644) << 16) >>> 0;
      entry.mtime = new Date(
        Math.max(
          Date.UTC(1980, 0, 1),
          Math.min(Date.UTC(2107, 0, 1), stat?.mtimeMs ?? Date.now()),
        ),
      );
      zip.add(entry);
      if (file)
        for await (const chunk of fs.createReadStream(file)) entry.push(chunk);
      else entry.push(Buffer.from(data));
      entry.push(new Uint8Array(), true);
    }
    zip.end();
    if (!ended) throw new Error("Incomplete source archive");
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(partial, output);
}

function* tree(source, prefix, exclude = []) {
  for (const file of walk(source)) {
    const relative = path.relative(source, file).split(path.sep).join("/");
    if (
      !fs.lstatSync(file).isFile() ||
      relative.split("/").includes(".git") ||
      exclude.some(
        (name) => relative === name || relative.startsWith(`${name}/`),
      )
    )
      continue;
    yield { name: `${prefix}/${relative}`, file };
  }
}

async function main() {
  const version = readJson(path.join(ROOT, "package.json")).version;
  const output = path.join(
    ROOT,
    `artifacts/release/Fluenta-${version}-source.zip`,
  );
  const vendor = path.join(ROOT, ".cache/source-vendor");
  fs.mkdirSync(path.dirname(vendor), { recursive: true });
  const log = fs.openSync(path.join(ROOT, ".cache/source-vendor.log"), "w");
  let config;
  try {
    config = capture("cargo", ["vendor", "--locked", vendor], {
      stdio: ["ignore", "pipe", log],
    });
  } finally {
    fs.closeSync(log);
  }
  config = config
    .replaceAll(vendor.replaceAll("\\", "\\\\"), "vendor")
    .replaceAll(vendor, "vendor")
    .replaceAll(vendor.split(path.sep).join("/"), "vendor");
  if (
    !/^\[source\.vendored-sources\]\r?\n(?:[^\[]*\r?\n)?directory = "vendor"\r?$/m.test(
      config,
    )
  )
    throw new Error(
      "The source archive must use a relative Cargo vendor directory",
    );
  const piper = path.join(CACHE, "piper1-gpl-1.8.0");
  const espeak = path.join(
    CACHE,
    "piper-build/espeak_ng/src/espeak_ng_external",
  );
  if (
    !fs.existsSync(path.join(piper, "COPYING")) ||
    !fs.existsSync(path.join(espeak, "COPYING"))
  )
    throw new Error("Prepare native runtimes before packaging their source");
  const files = new Set(
    capture("git", [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ])
      .split("\0")
      .filter(Boolean),
  );
  function* entries() {
    for (const name of [...files].sort()) {
      const file = path.join(ROOT, name);
      if (
        path.extname(file) === ".key" ||
        path.basename(file).startsWith(".env") ||
        !fs.existsSync(file) ||
        !fs.lstatSync(file).isFile()
      )
        continue;
      if (!inside(ROOT, fs.realpathSync(file)))
        throw new Error("Source file outside the repository");
      yield { name: `fluenta/${name}`, file };
    }
    yield { name: "fluenta/.cargo/config.toml", data: config };
    yield* tree(vendor, "fluenta/vendor");
    yield* tree(piper, "fluenta/third-party-src/piper-1.8.0", ["libpiper/lib"]);
    yield* tree(espeak, "fluenta/third-party-src/espeak-ng");
  }
  await writeZip(output, entries());
  console.log(
    `Created ${path.basename(output)} (${(fs.statSync(output).size / 1e6).toFixed(1)} MB) with dependency and native source.`,
  );
}

if (isMain(import.meta.url)) await main();

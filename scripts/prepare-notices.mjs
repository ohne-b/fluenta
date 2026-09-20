import * as fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  CACHE,
  RESOURCES,
  readJson,
  writeJson,
  capture,
  inside,
  walk,
} from "./build.mjs";
import { inventory } from "./prepare-runtime.mjs";

const output = path.join(RESOURCES, "notices");
const records = [];

function collect(name, version, license, source, directory) {
  const target = path.join(
    output,
    name.replaceAll("/", "_").replaceAll("@", ""),
    String(version),
  );
  if (!inside(output, target)) throw new Error("Invalid notice package path");
  const files = [];
  if (fs.existsSync(directory)) {
    const candidates = fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() &&
          ["LICENSES", "licenses"].includes(entry.name)
          ? [...walk(file)]
          : entry.isFile()
            ? [file]
            : [];
      });
    for (const file of candidates) {
      const relative = path.relative(directory, file);
      const topLevel =
        !relative.includes(path.sep) &&
        /^(license|licence|copying|notice|thirdpartynotice)/i.test(relative);
      if (
        (!topLevel && !/^(LICENSES|licenses)[/\\]/.test(relative)) ||
        !fs.lstatSync(file).isFile()
      )
        continue;
      const destination = path.join(target, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
      files.push(path.relative(output, destination).split(path.sep).join("/"));
    }
  }
  records.push({
    name,
    version,
    license: license ?? null,
    source: source ?? null,
    files,
  });
}

if (
  !inside(
    fs.realpathSync(ROOT),
    fs.existsSync(output)
      ? fs.realpathSync(output)
      : path.join(fs.realpathSync(RESOURCES), "notices"),
  )
)
  throw new Error("Notices directory must stay inside the repository");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const metadata = JSON.parse(
  capture("cargo", [
    "metadata",
    "--locked",
    "--format-version",
    "1",
    "--all-features",
  ]),
);
for (const item of metadata.packages)
  if (item.source)
    collect(
      item.name,
      item.version,
      item.license,
      item.repository || item.source,
      path.dirname(item.manifest_path),
    );
for (const [relative, item] of Object.entries(
  readJson(path.join(ROOT, "package-lock.json")).packages,
)) {
  if (!relative.includes("node_modules/") || item.link) continue;
  const directory = path.join(ROOT, relative);
  if (fs.existsSync(path.join(directory, "package.json"))) {
    const details = readJson(path.join(directory, "package.json"));
    collect(
      details.name,
      details.version,
      details.license ?? item.license,
      item.resolved,
      directory,
    );
  }
}
collect(
  "flag-icons",
  "086f7e97d657358203916dbe84f61c2bccaa81eb",
  "MIT",
  "https://github.com/lipis/flag-icons",
  path.join(ROOT, "apps/desktop/src/assets/flags"),
);
collect(
  "Piper",
  "1.8.0",
  "GPL-3.0-or-later",
  "https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0",
  path.join(CACHE, "piper1-gpl-1.8.0"),
);
collect(
  "eSpeak-NG",
  "212928b394a96e8fd2096616bfd54e17845c48f6",
  "GPL-3.0-or-later and bundled data notices",
  "https://github.com/espeak-ng/espeak-ng",
  path.join(CACHE, "piper-build/espeak_ng/src/espeak_ng_external"),
);
const libraries = path.join(CACHE, "piper1-gpl-1.8.0/libpiper/lib");
if (fs.existsSync(libraries))
  for (const name of fs
    .readdirSync(libraries)
    .filter((name) => name.startsWith("onnxruntime-")))
    collect(
      "ONNX-Runtime",
      "1.22.0",
      "MIT and third-party notices",
      "https://github.com/microsoft/onnxruntime/tree/v1.22.0",
      path.join(libraries, name),
    );
for (const [name, version] of [
  ["whisper", process.platform === "win32" ? "b5130" : "1.9.4"],
  ["llama", "b10956"],
])
  collect(
    `${name}.cpp`,
    version,
    "MIT",
    `https://github.com/ggml-org/${name}.cpp`,
    path.join(RESOURCES, "runtimes", name),
  );
for (const name of ["LICENSE", "NOTICE.md"])
  fs.copyFileSync(path.join(ROOT, name), path.join(output, name));
writeJson(path.join(output, "dependencies.json"), records);
console.log(
  `Collected notices for ${records.length} build and runtime dependencies.`,
);
await inventory();

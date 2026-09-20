import * as fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  ROOT,
  RESOURCES,
  readJson,
  writeJson,
  run,
  capture,
  isMain,
  sha256,
} from "./build.mjs";

export const REPOSITORY = "https://github.com/ohne-b/fluenta";
const OUTPUT = path.join(ROOT, "artifacts/release");
export const SUFFIXES = [
  "windows-x64.exe",
  "windows-x64-setup.exe",
  "linux-x64.AppImage",
  "linux-x64.deb",
  "macos.dmg",
  "macos-universal.app.tar.gz",
  "source.zip",
];

function decode(value) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid signing key or signature encoding");
  return Buffer.from(value, "base64");
}

export function manifest(
  installer,
  version,
  publicKey,
  platforms = ["windows-x86_64"],
) {
  const signature = fs.readFileSync(`${installer}.sig`, "utf8").trim();
  const publicBytes = decode(
    decode(publicKey).toString().split(/\r?\n/)[1] ?? "",
  );
  const signed = decode(decode(signature).toString().split(/\r?\n/)[1] ?? "");
  if (
    publicBytes.length !== 42 ||
    signed.length !== 74 ||
    !publicBytes.subarray(2, 10).equals(signed.subarray(2, 10))
  )
    throw new Error(
      "Artifact signature does not match Fluenta's updater public key",
    );
  if (!fs.statSync(installer).isFile() || fs.statSync(installer).size === 0)
    throw new Error("Signed artifact is missing or empty");
  return {
    version,
    notes: `[Check release notes on GitHub](${REPOSITORY}/releases/tag/v${version})`,
    pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(
      platforms.map((key) => [
        key,
        {
          url: `${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(path.basename(installer))}`,
          signature,
        },
      ]),
    ),
  };
}

export function versionInfo(tag) {
  const config = readJson(
    path.join(ROOT, "apps/desktop/src-tauri/tauri.conf.json"),
  );
  const version = config.version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || (tag && tag !== `v${version}`))
    throw new Error(
      "Release tag must match the application version (vMAJOR.MINOR.PATCH)",
    );
  for (const name of [
    "package.json",
    "apps/desktop/package.json",
    "packages/contracts/package.json",
  ]) {
    if (readJson(path.join(ROOT, name)).version !== version)
      throw new Error(`Version mismatch in ${name}`);
  }
  const metadata = JSON.parse(
    capture("cargo", ["metadata", "--no-deps", "--format-version", "1"]),
  );
  if (
    metadata.packages.some(
      (item) =>
        metadata.workspace_members.includes(item.id) &&
        item.version !== version,
    )
  )
    throw new Error("Cargo version does not match Tauri");
  const publicKey = fs
    .readFileSync(path.join(ROOT, "config/updater-public-key.txt"), "utf8")
    .trim();
  if (publicKey !== config.plugins.updater.pubkey)
    throw new Error(
      "Configured updater key differs from config/updater-public-key.txt",
    );
  return { version, publicKey };
}

export async function assemble(directory, version) {
  const expected = SUFFIXES.map(
    (suffix) => `Fluenta-${version}-${suffix}`,
  ).sort();
  const assets = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        fs.statSync(path.join(directory, name)).isFile() &&
        !name.endsWith(".json") &&
        name !== "SHA256SUMS.txt",
    )
    .sort();
  if (JSON.stringify(assets) !== JSON.stringify(expected))
    throw new Error("Unexpected release files");
  let result;
  for (const name of ["windows", "linux", "macos"]) {
    const feed = readJson(path.join(directory, `${name}.json`));
    if (feed.version !== version)
      throw new Error("Mixed versions in release feeds");
    result ??= { ...feed, platforms: {} };
    for (const [key, value] of Object.entries(feed.platforms)) {
      if (Object.hasOwn(result.platforms, key))
        throw new Error("Duplicate update platform");
      result.platforms[key] = value;
    }
  }
  const platforms = {
    "windows-x86_64": "windows-x64-setup.exe",
    "linux-x86_64": "linux-x64.AppImage",
    "darwin-x86_64": "macos-universal.app.tar.gz",
    "darwin-aarch64": "macos-universal.app.tar.gz",
  };
  if (
    JSON.stringify(Object.keys(result.platforms).sort()) !==
    JSON.stringify(Object.keys(platforms).sort())
  )
    throw new Error("Incomplete updater platform coverage");
  for (const [key, suffix] of Object.entries(platforms)) {
    const entry = result.platforms[key];
    if (
      !entry.signature ||
      entry.url !==
        `${REPOSITORY}/releases/download/v${version}/Fluenta-${version}-${suffix}`
    )
      throw new Error("Updater URL does not match its platform asset");
  }
  writeJson(path.join(directory, "latest.json"), result);
  const checksums = [];
  for (const name of [...expected, "latest.json"].sort()) {
    const file = path.join(directory, name);
    if (!fs.statSync(file).size)
      throw new Error(`Empty release asset: ${name}`);
    checksums.push(`${await sha256(file)}  ${name}\n`);
  }
  fs.writeFileSync(path.join(directory, "SHA256SUMS.txt"), checksums.join(""));
  for (const name of ["windows", "linux", "macos"])
    fs.unlinkSync(path.join(directory, `${name}.json`));
}

async function main() {
  const { values } = parseArgs({
    options: {
      "key-file": { type: "string" },
      tag: { type: "string", default: process.env.RELEASE_TAG },
      check: { type: "boolean" },
      assemble: { type: "string" },
    },
  });
  const { version, publicKey } = versionInfo(values.tag);
  if (values.check) return console.log(version);
  if (values.assemble) return assemble(path.resolve(values.assemble), version);
  const env = { ...process.env };
  if (values["key-file"])
    env.TAURI_SIGNING_PRIVATE_KEY = fs
      .readFileSync(values["key-file"], "utf8")
      .trim();
  if (!env.TAURI_SIGNING_PRIVATE_KEY)
    throw new Error("Provide --key-file or TAURI_SIGNING_PRIVATE_KEY");
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  const configurations = {
    win32: [
      "windows",
      "nsis",
      [],
      [["nsis", "_x64-setup.exe", "windows-x64-setup.exe"]],
      ["windows-x86_64"],
    ],
    linux: [
      "linux",
      "appimage,deb",
      [],
      [
        ["appimage", ".AppImage", "linux-x64.AppImage"],
        ["deb", ".deb", "linux-x64.deb"],
      ],
      ["linux-x86_64"],
    ],
    darwin: [
      "macos",
      "app,dmg",
      ["--target", "universal-apple-darwin"],
      [
        ["macos", ".app.tar.gz", "macos-universal.app.tar.gz"],
        ["dmg", ".dmg", "macos.dmg"],
      ],
      ["darwin-x86_64", "darwin-aarch64"],
    ],
  };
  if (!configurations[process.platform])
    throw new Error("Unsupported release platform");
  const [name, bundles, extra, files, platforms] =
    configurations[process.platform];
  if (process.platform === "darwin")
    Object.assign(env, {
      APPLE_SIGNING_IDENTITY: "-",
      MACOSX_DEPLOYMENT_TARGET: "15.0",
    });
  if (process.platform === "linux") {
    // linuxdeploy's strip cannot read newer system-library relocations (tauri#8929).
    env.NO_STRIP = "true";
    env.LD_LIBRARY_PATH = [
      ...["piper", "whisper", "llama"].map((runtime) =>
        path.join(RESOURCES, "runtimes", runtime, "lib"),
      ),
      env.LD_LIBRARY_PATH ?? "",
    ].join(path.delimiter);
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  run(
    process.execPath,
    [
      path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
      "build",
      "--ci",
      "--verbose",
      "--bundles",
      bundles,
      ...extra,
      "--config",
      '{"bundle":{"createUpdaterArtifacts":true}}',
    ],
    { cwd: path.join(ROOT, "apps/desktop"), env },
  );
  const target = path.join(
    ROOT,
    "target",
    process.platform === "darwin"
      ? "universal-apple-darwin/release"
      : "release",
  );
  for (const [index, [folder, extension, suffix]] of files.entries()) {
    const directory = path.join(target, "bundle", folder);
    const matches = fs
      .readdirSync(directory)
      .filter(
        (file) =>
          file.endsWith(extension) &&
          (file.toLowerCase().startsWith(`fluenta_${version}_`) ||
            file === "Fluenta.app.tar.gz"),
      );
    if (matches.length !== 1)
      throw new Error(
        `Expected one current learner artifact in ${directory}, found ${matches}`,
      );
    const original = path.join(directory, matches[0]);
    const destination = path.join(OUTPUT, `Fluenta-${version}-${suffix}`);
    fs.copyFileSync(original, destination);
    if (index === 0) {
      fs.copyFileSync(`${original}.sig`, `${destination}.sig`);
      writeJson(
        path.join(OUTPUT, `${name}.json`),
        manifest(destination, version, publicKey, platforms),
      );
      fs.unlinkSync(`${destination}.sig`);
    }
  }
  if (process.platform === "win32") {
    let nsis;
    try {
      nsis = capture("where.exe", ["makensis"], { stdio: "pipe" })
        .trim()
        .split(/\r?\n/)[0];
    } catch {
      nsis = path.join(process.env.LOCALAPPDATA, "tauri/NSIS/makensis.exe");
    }
    run(nsis, [
      "/V2",
      `/DVERSION=${version}`,
      `/DBINARY=${path.join(target, "fluenta.exe")}`,
      `/DRESOURCES=${RESOURCES}`,
      `/DICON=${path.join(ROOT, "apps/desktop/src-tauri/icons/icon.ico")}`,
      `/DOUTPUT=${path.join(OUTPUT, `Fluenta-${version}-windows-x64.exe`)}`,
      path.join(ROOT, "scripts/portable.nsi"),
    ]);
    run(process.execPath, ["scripts/package-source.mjs"]);
  }
  console.log(`Prepared ${name} release files in ${OUTPUT}`);
}

if (isMain(import.meta.url)) await main();

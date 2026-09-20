import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { c as tar } from "tar";
import {
  SUFFIXES,
  REPOSITORY,
  assemble,
  manifest,
} from "./package-release.mjs";
import { readJson, writeJson, sha256, extract, download } from "./build.mjs";
import { writeZip } from "./package-source.mjs";

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fluenta-release-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("assemble validates platforms, versions, URLs and hashes every download", async (t) => {
  const directory = temporary(t);
  const version = "0.0.1";
  for (const suffix of SUFFIXES)
    fs.writeFileSync(
      path.join(directory, `Fluenta-${version}-${suffix}`),
      suffix,
    );
  for (const [name, suffix, platforms] of [
    ["windows", "windows-x64-setup.exe", ["windows-x86_64"]],
    ["linux", "linux-x64.AppImage", ["linux-x86_64"]],
    [
      "macos",
      "macos-universal.app.tar.gz",
      ["darwin-x86_64", "darwin-aarch64"],
    ],
  ])
    writeJson(path.join(directory, `${name}.json`), {
      version,
      notes: "test",
      pub_date: "2026-09-19T00:00:00Z",
      platforms: Object.fromEntries(
        platforms.map((key) => [
          key,
          {
            url: `${REPOSITORY}/releases/download/v${version}/Fluenta-${version}-${suffix}`,
            signature: "test",
          },
        ]),
      ),
    });
  await assert.rejects(assemble(directory, "0.0.2"));
  const linuxFile = path.join(directory, "linux.json");
  const linux = readJson(linuxFile);
  writeJson(linuxFile, { ...linux, platforms: {} });
  await assert.rejects(assemble(directory, version), /coverage/);
  writeJson(linuxFile, { ...linux, version: "0.0.2" });
  await assert.rejects(assemble(directory, version), /Mixed versions/);
  writeJson(linuxFile, {
    ...linux,
    platforms: {
      "linux-x86_64": { url: "https://example.com/wrong", signature: "test" },
    },
  });
  await assert.rejects(assemble(directory, version), /URL/);
  writeJson(linuxFile, linux);
  await assemble(directory, version);
  assert.equal(
    Object.keys(readJson(path.join(directory, "latest.json")).platforms).length,
    4,
  );
  assert.equal(fs.readdirSync(directory).length, 9);
  for (const line of fs
    .readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split("\n")) {
    const [digest, name] = line.split("  ");
    assert.equal(digest, await sha256(path.join(directory, name)));
  }
});

test("manifest verifies key ID, encodes filenames and links version-specific notes", (t) => {
  const directory = temporary(t);
  const encoded = (bytes) =>
    Buffer.from(
      `untrusted comment: test\n${bytes.toString("base64")}\n`,
    ).toString("base64");
  const publicKey = encoded(
    Buffer.concat([Buffer.from("Edkey-id12"), Buffer.alloc(32)]),
  );
  const installer = path.join(directory, "Fluenta Studio_0.2.0_x64-setup.exe");
  fs.writeFileSync(installer, "not executable");
  fs.writeFileSync(
    `${installer}.sig`,
    encoded(Buffer.concat([Buffer.from("EDkey-id12"), Buffer.alloc(64)])),
  );
  const result = manifest(installer, "0.2.0", publicKey);
  assert.equal(
    result.notes,
    "[Check release notes on GitHub](https://github.com/ohne-b/fluenta/releases/tag/v0.2.0)",
  );
  assert.equal(
    result.platforms["windows-x86_64"].url,
    "https://github.com/ohne-b/fluenta/releases/download/v0.2.0/Fluenta%20Studio_0.2.0_x64-setup.exe",
  );
  assert.throws(
    () =>
      manifest(
        installer,
        "0.2.0",
        encoded(Buffer.concat([Buffer.from("Edotherkey"), Buffer.alloc(32)])),
      ),
    /key/,
  );
  assert.throws(() => manifest(installer, "0.2.0", "not base64!"), /encoding/);
});

test("ZIP and TAR extraction preserve files and reject paths outside the destination", async (t) => {
  const directory = temporary(t);
  const archive = path.join(directory, "source.zip");
  await writeZip(archive, [
    {
      name: "fluenta/.cargo/config.toml",
      data: '[source.vendored-sources]\ndirectory = "vendor"\n',
    },
    { name: "fluenta/LICENSE", data: "license" },
  ]);
  await extract(archive, path.join(directory, "zip"));
  assert.equal(
    fs.readFileSync(path.join(directory, "zip/fluenta/LICENSE"), "utf8"),
    "license",
  );
  const tarFile = path.join(directory, "source.tar.gz");
  await tar({ file: tarFile, gzip: true, cwd: path.join(directory, "zip") }, [
    "fluenta",
  ]);
  await extract(tarFile, path.join(directory, "tar"));
  assert.equal(
    fs.readFileSync(path.join(directory, "tar/fluenta/LICENSE"), "utf8"),
    "license",
  );
  fs.writeFileSync(archive, zipSync({ "../escape": Buffer.from("unsafe") }));
  await assert.rejects(
    extract(archive, path.join(directory, "bad")),
    /Unsafe archive path/,
  );
  await tar(
    { file: tarFile, cwd: path.join(directory, "zip"), prefix: "../escape" },
    ["fluenta"],
  );
  await assert.rejects(
    extract(tarFile, path.join(directory, "bad-tar")),
    /Unsafe archive path/,
  );
  assert.equal(fs.existsSync(path.join(directory, "escape")), false);
  fs.writeFileSync(
    archive,
    zipSync({ "linked/escape": Buffer.from("unsafe") }),
  );
  const outside = path.join(directory, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(
    outside,
    path.join(directory, "bad/linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    extract(archive, path.join(directory, "bad")),
    /Unsafe archive path/,
  );
  assert.equal(fs.existsSync(path.join(outside, "escape")), false);
  const oversized = Buffer.from(zipSync({ large: Buffer.from("small") }));
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(2 * 1024 ** 3 + 1, central + 24);
  fs.writeFileSync(archive, oversized);
  await assert.rejects(
    extract(archive, path.join(directory, "oversized")),
    /budget/,
  );
});

test("download verifies hashes before replacing cached files", async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, "model.bin");
  fs.writeFileSync(file, "original");
  const expected = createHash("sha256").update("updated").digest("hex");
  await assert.rejects(
    download("data:application/octet-stream;base64,d3Jvbmc=", file, expected),
    /Hash mismatch/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  await download(
    "data:application/octet-stream;base64,dXBkYXRlZA==",
    file,
    expected,
  );
  assert.equal(await sha256(file), expected);
});

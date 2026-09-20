import * as fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  ROOT,
  CACHE,
  RESOURCES,
  readJson,
  writeJson,
  run,
  capture,
  isMain,
  inside,
  walk,
  sha256,
  download,
  extract,
} from "./build.mjs";

const VOICE_REV = "1162a9173d0ce503555aed757976b7a9912eae4c";
const WHISPER_REV = "5359861c739e955e79d9a303bcbc70fb988958b1";
const vswhere = path.join(
  process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
  "Microsoft Visual Studio/Installer/vswhere.exe",
);
const visualStudio = () =>
  capture(vswhere, [
    "-latest",
    "-products",
    "*",
    "-property",
    "installationPath",
  ]).trim();

function cmake() {
  try {
    return capture(
      process.platform === "win32" ? "where.exe" : "which",
      ["cmake"],
      { stdio: "pipe" },
    )
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    if (fs.existsSync(vswhere)) {
      const bundled = path.join(
        visualStudio(),
        "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
      );
      if (fs.existsSync(bundled)) return bundled;
    }
    throw new Error("Install CMake 3.26+ for native runtime builds");
  }
}

async function prepareModels() {
  const models = path.join(RESOURCES, "models");
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REV}/es/es_ES/davefx/medium`;
  for (const [url, name, hash] of [
    [
      `${base}/es_ES-davefx-medium.onnx`,
      "es_ES-davefx-medium.onnx",
      "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917",
    ],
    [
      `${base}/es_ES-davefx-medium.onnx.json`,
      "es_ES-davefx-medium.onnx.json",
      "0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842",
    ],
    [
      `${base}/MODEL_CARD`,
      "VOICE_MODEL_CARD.txt",
      "420703b5d8ea239b729f13d83f31eea9bae5fcb89447de23ebc94aa8a4768f95",
    ],
    [
      `https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REV}/README.md`,
      "VOICE_REPOSITORY_README.md",
    ],
    [
      "https://raw.githubusercontent.com/openai/whisper/main/LICENSE",
      "WHISPER_LICENSE.txt",
    ],
    ["https://www.apache.org/licenses/LICENSE-2.0.txt", "TUTOR_LICENSE.txt"],
    [
      "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/README.md",
      "TUTOR_MODEL_CARD.md",
    ],
    [
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_REV}/ggml-small-q5_1.bin`,
      "ggml-small-q5_1.bin",
      "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    ],
  ])
    await download(url, path.join(models, name), hash);
}

async function preparePiper() {
  const destination = path.join(RESOURCES, "runtimes/piper");
  const marker = path.join(destination, "build-version.txt");
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === "1.8.0")
    return;
  const archive = await download(
    "https://github.com/OHF-Voice/piper1-gpl/archive/refs/tags/v1.8.0.tar.gz",
    path.join(CACHE, "piper-1.8.0.tar.gz"),
    "0a22987a6157f14e2fb7cf4aa702b547467fd0448bea9f233abd503c3ff4a0e1",
  );
  await extract(archive, CACHE);
  const source = path.join(CACHE, "piper1-gpl-1.8.0");
  const build = path.join(CACHE, "piper-build");
  const tool = cmake();
  run(tool, [
    "-S",
    path.join(source, "libpiper"),
    "-B",
    build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_INSTALL_LIBDIR=lib",
    `-DCMAKE_INSTALL_PREFIX=${destination}`,
  ]);
  run(tool, ["--build", build, "--config", "Release", "--parallel", "6"]);
  run(tool, ["--install", build, "--config", "Release"]);
  if (process.platform === "win32")
    for (const name of fs
      .readdirSync(path.join(destination, "lib"))
      .filter((name) => name.endsWith(".dll")))
      fs.copyFileSync(
        path.join(destination, "lib", name),
        path.join(destination, "bin", name),
      );
  fs.copyFileSync(
    path.join(source, "COPYING"),
    path.join(destination, "COPYING"),
  );
  fs.writeFileSync(marker, "1.8.0");
}

function pruneResources() {
  const base = fs.realpathSync(RESOURCES);
  const obsolete = [...walk(path.join(RESOURCES, "runtimes"))].filter((file) =>
    file.endsWith(".pdb"),
  );
  for (const [runtime, executable] of [
    ["whisper", "whisper-cli.exe"],
    ["llama", "llama-completion.exe"],
  ])
    obsolete.push(
      ...[...walk(path.join(RESOURCES, "runtimes", runtime))].filter(
        (file) => file.endsWith(".exe") && path.basename(file) !== executable,
      ),
    );
  if (process.platform === "win32")
    obsolete.push(...walk(path.join(RESOURCES, "runtimes/piper/lib")));
  const courses = path.join(RESOURCES, "courses");
  const selected = path.join(courses, "active-releases.json");
  if (fs.existsSync(selected)) {
    const active = readJson(selected);
    obsolete.push(
      ...fs
        .readdirSync(courses)
        .filter((name) => name.endsWith(".sqlite") && !active.includes(name))
        .map((name) => path.join(courses, name)),
    );
  }
  for (const file of obsolete) {
    if (!fs.statSync(file).isFile()) continue;
    if (!inside(base, fs.realpathSync(file)))
      throw new Error(
        "Refusing to remove a file outside application resources",
      );
    fs.unlinkSync(file);
  }
}

function windowsRuntime() {
  if (process.platform !== "win32") return;
  const base = path.join(visualStudio(), "VC/Redist/MSVC");
  const matches = fs
    .readdirSync(base)
    .sort()
    .map((name) => path.join(base, name, "x64/Microsoft.VC143.CRT"))
    .filter((file) => fs.existsSync(file));
  if (!matches.length)
    throw new Error(
      "Visual C++ redistributable DLLs are required for a standalone Windows package",
    );
  for (const destination of ["piper/bin", "whisper/Release", "llama"]) {
    for (const name of fs
      .readdirSync(matches.at(-1))
      .filter((name) => name.endsWith(".dll")))
      fs.copyFileSync(
        path.join(matches.at(-1), name),
        path.join(RESOURCES, "runtimes", destination, name),
      );
  }
}

async function prepareWhisper() {
  const destination = path.join(RESOURCES, "runtimes/whisper");
  if (process.platform === "win32" && process.arch === "x64") {
    await extract(
      await download(
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
        path.join(CACHE, "whisper-b5130.zip"),
        "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
      ),
      destination,
    );
  } else {
    await extract(
      await download(
        "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz",
        path.join(CACHE, "whisper-1.9.4.tar.gz"),
        "57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae",
      ),
      CACHE,
    );
    const build = path.join(CACHE, "whisper-build");
    const tool = cmake();
    // Recognition uses CPU inference; avoid Metal initialization even with -ng.
    const options =
      process.platform === "darwin" && process.arch === "x64"
        ? ["-DGGML_BLAS=OFF"]
        : [];
    run(tool, [
      "-S",
      path.join(CACHE, "whisper.cpp-1.9.4"),
      "-B",
      build,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DCMAKE_INSTALL_LIBDIR=lib",
      "-DGGML_NATIVE=OFF",
      "-DGGML_METAL=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      ...options,
      `-DCMAKE_INSTALL_PREFIX=${destination}`,
    ]);
    run(tool, ["--build", build, "--config", "Release", "--parallel", "6"]);
    run(tool, ["--install", build, "--config", "Release"]);
  }
  await download(
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.4/LICENSE",
    path.join(destination, "LICENSE"),
  );
}

async function prepareLlama() {
  const artifacts = {
    "win32-x64": [
      "llama-b10956-bin-win-cpu-x64.zip",
      "52d7ac13feab3bb062ee7ff87020d8df3dd2cdbc5a21d45dc005b8a67f0a5135",
    ],
    "darwin-arm64": [
      "llama-b10956-bin-macos-arm64.tar.gz",
      "d962fa470803c5144ce68252b3c56332be2ae2e14ca62bce571976919ee65d46",
    ],
    "darwin-x64": [
      "llama-b10956-bin-macos-x64.tar.gz",
      "3732c10bff2e6dd7c36c49cd035a6b779f9b561c5546e2353faace7563d44abd",
    ],
    "linux-x64": [
      "llama-b10956-bin-ubuntu-x64.tar.gz",
      "6b83e4ebcee21b211f5b725a6bb84eb8fc220178ff18653be0b486282a853620",
    ],
  };
  const artifact = artifacts[`${process.platform}-${process.arch}`];
  if (!artifact)
    throw new Error(
      "This architecture needs a tested llama.cpp runtime artifact",
    );
  const [filename, digest] = artifact;
  const unpacked = path.join(
    CACHE,
    `llama-${process.platform}-${process.arch}`,
  );
  await extract(
    await download(
      `https://github.com/ggml-org/llama.cpp/releases/download/b10956/${filename}`,
      path.join(CACHE, filename),
      digest,
    ),
    unpacked,
  );
  const binary =
    process.platform === "win32" ? "llama-completion.exe" : "llama-completion";
  const candidates = [...walk(unpacked)].filter(
    (file) => path.basename(file) === binary,
  );
  if (candidates.length !== 1)
    throw new Error("Unexpected llama.cpp archive structure");
  const destination = path.join(RESOURCES, "runtimes/llama");
  fs.cpSync(path.dirname(candidates[0]), destination, {
    recursive: true,
    verbatimSymlinks: true,
  });
  if (process.platform !== "win32") {
    for (const entry of fs.readdirSync(unpacked, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.name === "lib" && entry.isDirectory())
        fs.cpSync(
          path.join(entry.parentPath, entry.name),
          path.join(destination, "lib"),
          { recursive: true, verbatimSymlinks: true },
        );
    }
  }
  await download(
    "https://raw.githubusercontent.com/ggml-org/llama.cpp/b10956/LICENSE",
    path.join(destination, "LICENSE"),
  );
}

export async function inventory() {
  const files = [];
  for (const file of walk(RESOURCES)) {
    if (
      path.basename(file) !== "resource-manifest.json" &&
      fs.statSync(file).isFile()
    )
      files.push({
        path: path.relative(RESOURCES, file).split(path.sep).join("/"),
        bytes: fs.statSync(file).size,
        sha256: await sha256(file),
      });
  }
  writeJson(path.join(RESOURCES, "resource-manifest.json"), {
    version: 1,
    files,
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      "models-only": { type: "boolean" },
      "tutor-evaluation": { type: "boolean" },
      "prune-only": { type: "boolean" },
      inventory: { type: "boolean" },
    },
  });
  if (values.inventory) return inventory();
  fs.mkdirSync(CACHE, { recursive: true });
  if (values["prune-only"]) {
    windowsRuntime();
    pruneResources();
    return inventory();
  }
  await prepareModels();
  if (!values["models-only"]) {
    await prepareWhisper();
    await prepareLlama();
    await preparePiper();
    windowsRuntime();
    const runtime = path.join(RESOURCES, "runtimes/llama");
    run(
      path.join(
        runtime,
        process.platform === "win32"
          ? "llama-completion.exe"
          : "llama-completion",
      ),
      ["--version"],
      {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: path.join(runtime, "lib"),
          DYLD_LIBRARY_PATH: path.join(runtime, "lib"),
        },
        timeout: 90_000,
      },
    );
  }
  if (values["tutor-evaluation"]) {
    const model = readJson(path.join(ROOT, "crates/tutor/model.json"));
    const directory = path.join(ROOT, ".cache/evaluation");
    await download(
      model.url,
      path.join(directory, model.filename),
      model.sha256,
    );
    fs.writeFileSync(path.join(directory, "verified.sha256"), model.sha256);
  }
  pruneResources();
  await inventory();
  console.log("Offline resources prepared.");
}

if (isMain(import.meta.url)) await main();

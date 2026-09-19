"""Prepare verified, offline application resources. Python is build-time only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "native"
RESOURCES = ROOT / "apps" / "desktop" / "src-tauri" / "resources"
VOICE_REV = "1162a9173d0ce503555aed757976b7a9912eae4c"
WHISPER_REV = "5359861c739e955e79d9a303bcbc70fb988958b1"


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url: str, path: Path, expected: str | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (expected is None or sha256(path) == expected):
        return path
    partial = path.with_suffix(path.suffix + ".partial")
    print(f"Downloading {path.name}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Fluenta-build/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
        shutil.copyfileobj(response, output, 1024 * 1024)
    if expected and sha256(partial) != expected:
        raise ValueError(f"Hash mismatch: {path.name}")
    partial.replace(path)
    return path


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    base = destination.resolve()
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as source:
            for item in source.infolist():
                target = (base / item.filename).resolve()
                if not target.is_relative_to(base) or (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Unsafe archive path")
            if sum(x.file_size for x in source.infolist()) > 2 * 1024**3:
                raise ValueError("Archive exceeds extraction budget")
            source.extractall(base)
    else:
        with tarfile.open(archive) as source:
            if sum(x.size for x in source.getmembers()) > 2 * 1024**3:
                raise ValueError("Archive exceeds extraction budget")
            source.extractall(base, filter="data")


def run(*command: str | Path) -> None:
    subprocess.run([str(x) for x in command], check=True)


def cmake() -> str:
    existing = shutil.which("cmake")
    if existing:
        return existing
    vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
    if vswhere.exists():
        installation = subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-property", "installationPath"], text=True).strip()
        bundled = Path(installation) / "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
        if bundled.exists():
            return str(bundled)
    raise RuntimeError("Install CMake 3.26+ for native runtime builds")


def prepare_models() -> None:
    models = RESOURCES / "models"
    base = f"https://huggingface.co/rhasspy/piper-voices/resolve/{VOICE_REV}/es/es_ES/davefx/medium"
    download(f"{base}/es_ES-davefx-medium.onnx", models / "es_ES-davefx-medium.onnx", "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917")
    download(f"{base}/es_ES-davefx-medium.onnx.json", models / "es_ES-davefx-medium.onnx.json", "0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842")
    download(f"{base}/MODEL_CARD", models / "VOICE_MODEL_CARD.txt", "420703b5d8ea239b729f13d83f31eea9bae5fcb89447de23ebc94aa8a4768f95")
    download(f"https://huggingface.co/rhasspy/piper-voices/resolve/{VOICE_REV}/README.md", models / "VOICE_REPOSITORY_README.md")
    download("https://raw.githubusercontent.com/openai/whisper/main/LICENSE", models / "WHISPER_LICENSE.txt")
    download("https://www.apache.org/licenses/LICENSE-2.0.txt", models / "TUTOR_LICENSE.txt")
    download("https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/README.md", models / "TUTOR_MODEL_CARD.md")
    download(f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{WHISPER_REV}/ggml-small-q5_1.bin", models / "ggml-small-q5_1.bin", "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb")


def prepare_piper() -> None:
    destination = RESOURCES / "runtimes" / "piper"
    marker = destination / "build-version.txt"
    if marker.exists() and marker.read_text() == "1.8.0":
        return
    archive = download("https://github.com/OHF-Voice/piper1-gpl/archive/refs/tags/v1.8.0.tar.gz", CACHE / "piper-1.8.0.tar.gz", "0a22987a6157f14e2fb7cf4aa702b547467fd0448bea9f233abd503c3ff4a0e1")
    extract(archive, CACHE)
    source = CACHE / "piper1-gpl-1.8.0"
    build = CACHE / "piper-build"
    tool = cmake()
    run(tool, "-S", source / "libpiper", "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib", f"-DCMAKE_INSTALL_PREFIX={destination}")
    run(tool, "--build", build, "--config", "Release", "--parallel", "6")
    run(tool, "--install", build, "--config", "Release")
    if platform.system() == "Windows":
        for library in (destination / "lib").glob("*.dll"):
            shutil.copy2(library, destination / "bin" / library.name)
    shutil.copy2(source / "COPYING", destination / "COPYING")
    marker.write_text("1.8.0")


def prune_resources() -> None:
    """Remove build outputs, never user data. All targets are below resources/."""
    base = RESOURCES.resolve()
    obsolete = list((RESOURCES / "runtimes").rglob("*.pdb"))
    for runtime, executable in [("whisper", "whisper-cli.exe"), ("llama", "llama-completion.exe")]:
        obsolete += [p for p in (RESOURCES / "runtimes" / runtime).rglob("*.exe") if p.name != executable]
    if platform.system() == "Windows":
        obsolete += list((RESOURCES / "runtimes/piper/lib").rglob("*"))
    selected = RESOURCES / "courses/active-releases.json"
    if selected.exists():
        active = json.loads(selected.read_text())
        obsolete += [p for p in (RESOURCES / "courses").glob("*.sqlite") if p.name not in active]
    for path in obsolete:
        if path.is_file():
            if not path.resolve().is_relative_to(base):
                raise ValueError("Refusing to remove a file outside application resources")
            path.unlink()


def windows_runtime() -> None:
    if platform.system() != "Windows":
        return
    vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
    installation = Path(subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-property", "installationPath"], text=True).strip())
    matches = sorted((installation / "VC/Redist/MSVC").glob("*/x64/Microsoft.VC143.CRT"))
    if not matches:
        raise RuntimeError("Visual C++ redistributable DLLs are required for a standalone Windows package")
    for destination in [RESOURCES / "runtimes/piper/bin", RESOURCES / "runtimes/whisper/Release", RESOURCES / "runtimes/llama"]:
        for path in matches[-1].glob("*.dll"):
            shutil.copy2(path, destination / path.name)


def prepare_whisper() -> None:
    destination = RESOURCES / "runtimes" / "whisper"
    if platform.system() == "Windows" and platform.machine().lower() in ("amd64", "x86_64"):
        archive = download("https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip", CACHE / "whisper-b5130.zip", "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c")
        extract(archive, destination)
    else:
        archive = download("https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz", CACHE / "whisper-1.9.4.tar.gz", "57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae")
        extract(archive, CACHE)
        source = CACHE / "whisper.cpp-1.9.4"
        build = CACHE / "whisper-build"
        run(cmake(), "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib", "-DGGML_NATIVE=OFF", "-DWHISPER_BUILD_TESTS=OFF", f"-DCMAKE_INSTALL_PREFIX={destination}")
        run(cmake(), "--build", build, "--config", "Release", "--parallel", "6")
        run(cmake(), "--install", build, "--config", "Release")
    download("https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.4/LICENSE", destination / "LICENSE")


def prepare_llama() -> None:
    destination = RESOURCES / "runtimes" / "llama"
    system = platform.system()
    if system == "Windows":
        filename, digest = "llama-b10956-bin-win-cpu-x64.zip", "52d7ac13feab3bb062ee7ff87020d8df3dd2cdbc5a21d45dc005b8a67f0a5135"
    elif system == "Darwin" and platform.machine() == "arm64":
        filename, digest = "llama-b10956-bin-macos-arm64.tar.gz", "d962fa470803c5144ce68252b3c56332be2ae2e14ca62bce571976919ee65d46"
    elif system == "Darwin" and platform.machine() == "x86_64":
        filename, digest = "llama-b10956-bin-macos-x64.tar.gz", "3732c10bff2e6dd7c36c49cd035a6b779f9b561c5546e2353faace7563d44abd"
    elif system == "Linux" and platform.machine() == "x86_64":
        filename, digest = "llama-b10956-bin-ubuntu-x64.tar.gz", "6b83e4ebcee21b211f5b725a6bb84eb8fc220178ff18653be0b486282a853620"
    else:
        raise RuntimeError("This architecture needs a tested llama.cpp runtime artifact")
    archive = download(f"https://github.com/ggml-org/llama.cpp/releases/download/b10956/{filename}", CACHE / filename, digest)
    unpacked = CACHE / f"llama-{system}-{platform.machine()}"
    extract(archive, unpacked)
    binary = "llama-completion.exe" if system == "Windows" else "llama-completion"
    candidates = list(unpacked.rglob(binary))
    if len(candidates) != 1:
        raise RuntimeError("Unexpected llama.cpp archive structure")
    shutil.copytree(candidates[0].parent, destination, dirs_exist_ok=True)
    if system != "Windows":
        for library_dir in unpacked.rglob("lib"):
            if library_dir.is_dir():
                shutil.copytree(library_dir, destination / "lib", dirs_exist_ok=True)
    download("https://raw.githubusercontent.com/ggml-org/llama.cpp/b10956/LICENSE", destination / "LICENSE")


def inventory() -> None:
    entries = []
    for path in sorted(RESOURCES.rglob("*")):
        if path.is_file() and path.name != "resource-manifest.json":
            entries.append({"path": path.relative_to(RESOURCES).as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)})
    (RESOURCES / "resource-manifest.json").write_text(json.dumps({"version": 1, "files": entries}, indent=2) + "\n", encoding="utf-8")


def verify_tutor_runtime() -> None:
    runtime = RESOURCES / "runtimes/llama"
    executable = runtime / ("llama-completion.exe" if platform.system() == "Windows" else "llama-completion")
    environment = os.environ.copy()
    environment["LD_LIBRARY_PATH"] = str(runtime / "lib")
    environment["DYLD_LIBRARY_PATH"] = str(runtime / "lib")
    subprocess.run([str(executable), "--version"], env=environment, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-only", action="store_true")
    parser.add_argument("--tutor-evaluation", action="store_true")
    parser.add_argument("--prune-only", action="store_true")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.prune_only:
        windows_runtime()
        prune_resources()
        inventory()
        raise SystemExit(0)
    prepare_models()
    if not args.models_only:
        prepare_whisper()
        prepare_llama()
        prepare_piper()
        windows_runtime()
        verify_tutor_runtime()
    if args.tutor_evaluation:
        model = json.loads((ROOT / "crates/tutor/model.json").read_text())
        directory = ROOT / ".cache/evaluation"
        download(model["url"], directory / model["filename"], model["sha256"])
        (directory / "verified.sha256").write_text(model["sha256"])
    prune_resources()
    inventory()
    print("Offline resources prepared.", flush=True)

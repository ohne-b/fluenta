"""Collect the actual dependency licenses for the installed build, without another toolchain."""
import json
from pathlib import Path
import platform
import shutil
import subprocess
import runpy

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "apps/desktop/src-tauri/resources/notices"
records = []


def collect(name, version, license_name, source, directory):
    target = OUTPUT / name.replace("/", "_").replace("@", "") / str(version)
    files = []
    if directory.is_dir():
        for path in directory.iterdir():
            if path.is_file() and path.name.lower().startswith(("license", "licence", "copying", "notice", "thirdpartynotice")):
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target / path.name)
                files.append((target / path.name).relative_to(OUTPUT).as_posix())
        # Some crates put dual-license and attribution files in a LICENSES directory.
        for sub in ("LICENSES", "licenses"):
            if (directory / sub).is_dir():
                for path in sorted((directory / sub).rglob("*")):
                    if path.is_file() and not path.is_symlink():
                        destination = target / sub / path.relative_to(directory / sub)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(path, destination)
                        files.append(destination.relative_to(OUTPUT).as_posix())
    records.append({"name": name, "version": version, "license": license_name, "source": source, "files": files})


if __name__ == "__main__":
    # Rebuild generated notices so removed dependencies do not linger in installers.
    if not OUTPUT.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Notices directory must stay inside the repository")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--format-version", "1", "--all-features"], cwd=ROOT))
    for package in metadata["packages"]:
        if package["source"]:
            collect(package["name"], package["version"], package["license"], package["repository"] or package["source"], Path(package["manifest_path"]).parent)
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    for relative, package in lock["packages"].items():
        if "node_modules/" not in relative or package.get("link"):
            continue
        directory = ROOT / relative
        manifest = directory / "package.json"
        if manifest.exists():
            details = json.loads(manifest.read_text(encoding="utf-8"))
            collect(details["name"], details["version"], details.get("license", package.get("license")), package.get("resolved"), directory)
    native = ROOT / ".cache/native"
    collect("flag-icons", "086f7e97d657358203916dbe84f61c2bccaa81eb", "MIT", "https://github.com/lipis/flag-icons", ROOT / "apps/desktop/src/assets/flags")
    collect("Piper", "1.8.0", "GPL-3.0-or-later", "https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0", native / "piper1-gpl-1.8.0")
    collect("eSpeak-NG", "212928b394a96e8fd2096616bfd54e17845c48f6", "GPL-3.0-or-later and bundled data notices", "https://github.com/espeak-ng/espeak-ng", native / "piper-build/espeak_ng/src/espeak_ng_external")
    for directory in (native / "piper1-gpl-1.8.0/libpiper/lib").glob("onnxruntime-*"):
        collect("ONNX-Runtime", "1.22.0", "MIT and third-party notices", "https://github.com/microsoft/onnxruntime/tree/v1.22.0", directory)
    whisper_version = "b5130" if platform.system() == "Windows" else "1.9.4"
    for name, version in [("whisper", whisper_version), ("llama", "b10956")]:
        collect(name + ".cpp", version, "MIT", f"https://github.com/ggml-org/{name}.cpp", ROOT / "apps/desktop/src-tauri/resources/runtimes" / name)
    for name in ("LICENSE", "NOTICE.md"):
        shutil.copy2(ROOT / name, OUTPUT / name)
    (OUTPUT / "dependencies.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Collected notices for {len(records)} build and runtime dependencies.")
    runpy.run_path(str(ROOT / "scripts/prepare-runtime.py"))["inventory"]()

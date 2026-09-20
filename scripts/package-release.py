"""Build native release files, or assemble verified platform feeds for GitHub."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tomllib
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "https://github.com/ohne-b/fluenta"
OUTPUT = ROOT / "artifacts/release"
CLI = ROOT / "node_modules/@tauri-apps/cli/tauri.js"
SUFFIXES = (
    "windows-x64.exe", "windows-x64-setup.exe", "linux-x64.AppImage",
    "linux-x64.deb", "macos.dmg", "macos-universal.app.tar.gz", "source.zip",
)


def manifest(installer, version, public_key, platforms=("windows-x86_64",)):
    signature = installer.with_name(installer.name + ".sig").read_text(encoding="utf-8").strip()
    public = base64.b64decode(base64.b64decode(public_key).decode().splitlines()[1], validate=True)
    signed = base64.b64decode(base64.b64decode(signature).decode().splitlines()[1], validate=True)
    if public[2:10] != signed[2:10] or len(public) != 42 or len(signed) != 74:
        raise ValueError("Artifact signature does not match Fluenta's updater public key")
    if not installer.is_file() or installer.stat().st_size == 0:
        raise ValueError("Signed artifact is missing or empty")
    return {
        "version": version,
        "notes": f"[Check release notes on GitHub]({REPOSITORY}/releases/tag/v{version})",
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": {key: {
            "url": f"{REPOSITORY}/releases/download/v{version}/{quote(installer.name)}",
            "signature": signature,
        } for key in platforms},
    }


def version_info(tag=None):
    config = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    version = config["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or (tag and tag != f"v{version}"):
        raise ValueError("Release tag must match the application version (vMAJOR.MINOR.PATCH)")
    for name in ("package.json", "apps/desktop/package.json", "packages/contracts/package.json"):
        if json.loads((ROOT / name).read_text(encoding="utf-8"))["version"] != version:
            raise ValueError(f"Version mismatch in {name}")
    if tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["workspace"]["package"]["version"] != version:
        raise ValueError("Cargo version does not match Tauri")
    public = (ROOT / "config/updater-public-key.txt").read_text(encoding="utf-8").strip()
    if public != config["plugins"]["updater"]["pubkey"]:
        raise ValueError("Configured updater key differs from config/updater-public-key.txt")
    return version, public


def assemble(directory, version):
    expected = {f"Fluenta-{version}-{suffix}" for suffix in SUFFIXES}
    assets = {p.name for p in directory.iterdir() if p.is_file() and not p.name.endswith(".json") and p.name != "SHA256SUMS.txt"}
    if assets != expected:
        raise ValueError(f"Unexpected release files: missing {expected - assets}; extra {assets - expected}")
    result = None
    for name in ("windows", "linux", "macos"):
        feed = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
        if feed["version"] != version:
            raise ValueError("Mixed versions in release feeds")
        if result is None:
            result = {**feed, "platforms": {}}
        if result["platforms"].keys() & feed["platforms"].keys():
            raise ValueError("Duplicate update platform")
        result["platforms"].update(feed["platforms"])
    expected_platforms = {
        "windows-x86_64": "windows-x64-setup.exe", "linux-x86_64": "linux-x64.AppImage",
        "darwin-x86_64": "macos-universal.app.tar.gz", "darwin-aarch64": "macos-universal.app.tar.gz",
    }
    if set(result["platforms"]) != set(expected_platforms):
        raise ValueError("Incomplete updater platform coverage")
    for key, suffix in expected_platforms.items():
        entry = result["platforms"][key]
        if not entry["signature"] or entry["url"] != f"{REPOSITORY}/releases/download/v{version}/Fluenta-{version}-{suffix}":
            raise ValueError("Updater URL does not match its platform asset")
    (directory / "latest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    checksums = []
    for name in sorted(expected | {"latest.json"}):
        with (directory / name).open("rb") as stream:
            if (directory / name).stat().st_size == 0:
                raise ValueError(f"Empty release asset: {name}")
            checksums.append(f"{hashlib.file_digest(stream, 'sha256').hexdigest()}  {name}\n")
    (directory / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8")
    for name in ("windows", "linux", "macos"):
        (directory / f"{name}.json").unlink()


def portable_windows(version, binary):
    nsis = shutil.which("makensis")
    if not nsis:
        nsis = str(Path(os.environ["LOCALAPPDATA"]) / "tauri/NSIS/makensis.exe")
    subprocess.run([
        nsis, "/V2", f"/DVERSION={version}", f"/DBINARY={binary}",
        f"/DRESOURCES={ROOT / 'apps/desktop/src-tauri/resources'}",
        f"/DICON={ROOT / 'apps/desktop/src-tauri/icons/icon.ico'}",
        f"/DOUTPUT={OUTPUT / f'Fluenta-{version}-windows-x64.exe'}",
        str(ROOT / "scripts/portable.nsi"),
    ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--tag", default=os.environ.get("RELEASE_TAG"))
    parser.add_argument("--check", action="store_true", help="Validate versions without building")
    parser.add_argument("--assemble", type=Path, help="Merge downloaded platform artifacts")
    args = parser.parse_args()
    version, public = version_info(args.tag)
    if args.check:
        print(version)
        return
    if args.assemble:
        assemble(args.assemble, version)
        return
    environment = os.environ.copy()
    if args.key_file:
        environment["TAURI_SIGNING_PRIVATE_KEY"] = args.key_file.read_text(encoding="utf-8").strip()
    if not environment.get("TAURI_SIGNING_PRIVATE_KEY"):
        raise ValueError("Provide --key-file or TAURI_SIGNING_PRIVATE_KEY")
    environment.setdefault("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
    system = platform.system()
    configurations = {
        "Windows": ("windows", "nsis", [], [("nsis/*_x64-setup.exe", "windows-x64-setup.exe")], ("windows-x86_64",)),
        "Linux": ("linux", "appimage,deb", [], [("appimage/*.AppImage", "linux-x64.AppImage"), ("deb/*.deb", "linux-x64.deb")], ("linux-x86_64",)),
        "Darwin": ("macos", "app,dmg", ["--target", "universal-apple-darwin"], [("macos/*.app.tar.gz", "macos-universal.app.tar.gz"), ("dmg/*.dmg", "macos.dmg")], ("darwin-x86_64", "darwin-aarch64")),
    }
    name, bundles, extra, files, platforms = configurations[system]
    if system == "Darwin":
        environment["APPLE_SIGNING_IDENTITY"] = "-"
        environment["MACOSX_DEPLOYMENT_TARGET"] = "15.0"
    if system == "Linux":
        # linuxdeploy's bundled strip cannot read newer system-library relocations.
        # https://github.com/tauri-apps/tauri/issues/8929
        environment["NO_STRIP"] = "true"
        # linuxdeploy must also resolve the libraries used by bundled workers.
        environment["LD_LIBRARY_PATH"] = os.pathsep.join([
            *(str(ROOT / f"apps/desktop/src-tauri/resources/runtimes/{name}/lib")
              for name in ("piper", "whisper", "llama")),
            environment.get("LD_LIBRARY_PATH", ""),
        ])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(["node", str(CLI), "build", "--ci", "--verbose", "--bundles", bundles, *extra,
                    "--config", '{"bundle":{"createUpdaterArtifacts":true}}'],
                   cwd=ROOT / "apps/desktop", env=environment, check=True)
    target = ROOT / "target" / ("universal-apple-darwin/release" if system == "Darwin" else "release")
    for index, (pattern, suffix) in enumerate(files):
        matches = [p for p in (target / "bundle").glob(pattern) if p.name.lower().startswith(f"fluenta_{version}_") or p.name == "Fluenta.app.tar.gz"]
        if len(matches) != 1:
            raise ValueError(f"Expected one current learner artifact for {pattern}, found {matches}")
        original = matches[0]
        destination = OUTPUT / f"Fluenta-{version}-{suffix}"
        shutil.copy2(original, destination)
        if index == 0:
            signature = destination.with_name(destination.name + ".sig")
            shutil.copy2(original.with_name(original.name + ".sig"), signature)
            feed = manifest(destination, version, public, platforms)
            (OUTPUT / f"{name}.json").write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
            signature.unlink()
    if system == "Windows":
        portable_windows(version, target / "fluenta.exe")
        subprocess.run([os.sys.executable, "scripts/package-source.py"], cwd=ROOT, check=True)
    print(f"Prepared {name} release files in {OUTPUT}")


if __name__ == "__main__":
    main()

"""Create a corresponding-source archive with locked Rust dependencies and native GPL sources."""
from pathlib import Path
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def add_tree(archive, source, prefix, exclude=()):
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if path.is_symlink() or not path.is_file() or ".git" in relative.parts:
            continue
        if any(relative.is_relative_to(Path(item)) for item in exclude):
            continue
        archive.write(path, f"{prefix}/{relative.as_posix()}")


if __name__ == "__main__":
    version = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["workspace"]["package"]["version"]
    output = ROOT / f"artifacts/release/Fluenta-{version}-source.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    vendor = ROOT / ".cache/source-vendor"
    with (ROOT / ".cache/source-vendor.log").open("wb") as log:
        config = subprocess.check_output(["cargo", "vendor", "--locked", str(vendor)], cwd=ROOT, stderr=log).decode()
    config = config.replace(str(vendor).replace("\\", "\\\\"), "vendor").replace(str(vendor), "vendor").replace(vendor.as_posix(), "vendor")
    if tomllib.loads(config)["source"]["vendored-sources"]["directory"] != "vendor":
        raise ValueError("The source archive must use a relative Cargo vendor directory")
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    temporary = output.with_suffix(".zip.partial")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as archive:
        for name in sorted(set(files)):
            if not name:
                continue
            path = ROOT / name
            if path.suffix == ".key" or path.name.startswith(".env") or path.is_symlink() or not path.is_file():
                continue
            if not path.resolve().is_relative_to(ROOT):
                raise ValueError("Source file outside the repository")
            archive.write(path, f"fluenta/{name}")
        archive.writestr("fluenta/.cargo/config.toml", config)
        add_tree(archive, vendor, "fluenta/vendor")
        piper = ROOT / ".cache/native/piper1-gpl-1.8.0"
        espeak = ROOT / ".cache/native/piper-build/espeak_ng/src/espeak_ng_external"
        if not (piper / "COPYING").is_file() or not (espeak / "COPYING").is_file():
            raise RuntimeError("Prepare native runtimes before packaging their source")
        add_tree(archive, piper, "fluenta/third-party-src/piper-1.8.0", exclude=("libpiper/lib",))
        add_tree(archive, espeak, "fluenta/third-party-src/espeak-ng")
    temporary.replace(output)
    print(f"Created {output.name} ({output.stat().st_size / 1e6:.1f} MB) with dependency and native source.")

"""Check release URLs and rejection of a signing key from another application."""
import base64
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

release = runpy.run_path(str(Path(__file__).with_name("package-release.py")))
manifest = release["manifest"]


class ReleaseTest(unittest.TestCase):
    def test_assembly_requires_all_platforms_and_hashes_every_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            version = "0.0.1"
            for suffix in release["SUFFIXES"]:
                (directory / f"Fluenta-{version}-{suffix}").write_bytes(suffix.encode())
            for name, suffix, platforms in (
                ("windows", "windows-x64-setup.exe", ["windows-x86_64"]),
                ("linux", "linux-x64.AppImage", ["linux-x86_64"]),
                ("macos", "macos-universal.app.tar.gz", ["darwin-x86_64", "darwin-aarch64"]),
            ):
                feed = {"version": version, "notes": "test", "pub_date": "2026-09-19T00:00:00Z", "platforms": {
                    key: {"url": f"{release['REPOSITORY']}/releases/download/v{version}/Fluenta-{version}-{suffix}", "signature": "test"}
                    for key in platforms
                }}
                (directory / f"{name}.json").write_text(json.dumps(feed))
            with self.assertRaises(ValueError):
                release["assemble"](directory, "0.0.2")
            release["assemble"](directory, version)
            feed = json.loads((directory / "latest.json").read_text())
            self.assertEqual(len(feed["platforms"]), 4)
            self.assertEqual(len(list(directory.iterdir())), 9)
            for line in (directory / "SHA256SUMS.txt").read_text().splitlines():
                digest, name = line.split("  ")
                self.assertEqual(digest, hashlib.sha256((directory / name).read_bytes()).hexdigest())

    def test_manifest_checks_key_and_encodes_asset_names(self):
        def encoded(data):
            return base64.b64encode(b"untrusted comment: test\n" + base64.b64encode(data) + b"\n").decode()
        with tempfile.TemporaryDirectory() as directory:
            installer = Path(directory) / "Fluenta Studio_0.2.0_x64-setup.exe"
            installer.write_bytes(b"not executable")
            installer.with_suffix(".exe.sig").write_text(encoded(b"ED" + b"key-id12" + bytes(64)), encoding="utf-8")
            result = manifest(installer, "0.2.0", encoded(b"Ed" + b"key-id12" + bytes(32)))
            self.assertEqual(result["notes"], "[Check release notes on GitHub](https://github.com/ohne-b/fluenta/releases/tag/v0.2.0)")
            self.assertEqual(result["platforms"]["windows-x86_64"]["url"], "https://github.com/ohne-b/fluenta/releases/download/v0.2.0/Fluenta%20Studio_0.2.0_x64-setup.exe")
            with self.assertRaises(ValueError):
                manifest(installer, "0.2.0", encoded(b"Ed" + b"otherkey" + bytes(32)))


if __name__ == "__main__":
    unittest.main()

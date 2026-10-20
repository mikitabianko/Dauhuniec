#!/usr/bin/env python3
"""Verify that the VSIX contains the built CLI binaries and required resources."""

from pathlib import Path
from zipfile import ZipFile


EXPECTED_BINARIES = {
    "lon-darwin-amd64", "lon-darwin-arm64",
    "lon-linux-amd64", "lon-linux-arm64",
    "lon-windows-amd64.exe", "lon-windows-arm64.exe",
}


def verify(root):
    packages = list((root / "releases").glob("*.vsix"))
    if len(packages) != 1:
        raise ValueError(f"Expected one VSIX, got {packages}")

    with ZipFile(packages[0]) as package:
        built = {entry.name for entry in (root / "bin").iterdir()}
        bundled = [
            name.removeprefix("extension/bin/") for name in package.namelist()
            if name.startswith("extension/bin/") and not name.endswith("/")
        ]
        if built != EXPECTED_BINARIES:
            raise ValueError(f"Expected six built CLI binaries, got {sorted(built)}")
        if set(bundled) != EXPECTED_BINARIES or len(bundled) != len(EXPECTED_BINARIES):
            raise ValueError(f"Expected six bundled CLI binaries, got {sorted(bundled)}")
        for name in sorted(EXPECTED_BINARIES):
            source = root / "bin" / name
            if source.stat().st_size == 0:
                raise ValueError(f"Empty CLI binary: {name}")
            if package.read(f"extension/bin/{source.name}") != source.read_bytes():
                raise ValueError(f"Bundled CLI differs from the build: {source.name}")
        for name in [
            "dist/extension.js", "LICENSE.txt", "GO-LICENSE.txt", "THIRD-PARTY-NOTICES.txt",
        ]:
            if package.getinfo(f"extension/{name}").file_size == 0:
                raise ValueError(f"Empty bundled resource: {name}")

    print(f"Verified {packages[0].name}")


if __name__ == "__main__":
    verify(Path(__file__).resolve().parents[2])

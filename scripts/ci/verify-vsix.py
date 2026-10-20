#!/usr/bin/env python3
"""Verify that the VSIX contains the built CLI binaries and required resources."""

from pathlib import Path
from zipfile import ZipFile


def main():
    root = Path(__file__).resolve().parents[2]
    packages = list((root / "releases").glob("*.vsix"))
    if len(packages) != 1:
        raise ValueError(f"Expected one VSIX, got {packages}")

    with ZipFile(packages[0]) as package:
        for source in (root / "bin").iterdir():
            if package.read(f"extension/bin/{source.name}") != source.read_bytes():
                raise ValueError(f"Bundled CLI differs from the build: {source.name}")
        for name in [
            "dist/extension.js", "LICENSE.txt", "GO-LICENSE.txt", "THIRD-PARTY-NOTICES.txt",
        ]:
            if package.getinfo(f"extension/{name}").file_size == 0:
                raise ValueError(f"Empty bundled resource: {name}")

    print(f"Verified {packages[0].name}")


if __name__ == "__main__":
    main()

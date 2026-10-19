#!/usr/bin/env python3
"""Remove generated project artifacts, optionally including pnpm dependencies."""

import argparse
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependencies", action="store_true",
                        help="also remove extension/node_modules")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    targets = [
        "build", "bin", "releases", "output", "coverage", "SHA256SUMS",
        "coverage.out", "coverage.html", "lon", "lon.exe",
        "extension/dist", "extension/bin", "extension/LICENSE", "extension/GO-LICENSE.txt",
        "extension/THIRD-PARTY-NOTICES.txt",
    ]
    if args.dependencies:
        targets.append("extension/node_modules")
    for name in targets:
        path = root / name
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
        else:
            continue
        print(f"Removed {name}")


if __name__ == "__main__":
    main()

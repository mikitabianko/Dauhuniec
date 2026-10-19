#!/bin/sh
set -eu
kit_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s)" in
  Darwin) kit_os=darwin ;;
  Linux) kit_os=linux ;;
  *) echo "Unsupported OS; use setup.cmd on Windows." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) kit_arch=amd64 ;;
  arm64|aarch64) kit_arch=arm64 ;;
  *) echo "Unsupported CPU architecture." >&2; exit 1 ;;
esac
exec "$kit_dir/bin/lon-$kit_os-$kit_arch" setup "$@"

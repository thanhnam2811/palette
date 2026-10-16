#!/usr/bin/env bash
# Build palette@namtt.shell-extension.zip (schemas compiled by gnome-extensions pack).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/extension"
gnome-extensions pack --force --extra-source=lib --out-dir="$root" .
echo "$root/palette@namtt.shell-extension.zip"

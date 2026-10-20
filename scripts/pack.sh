#!/usr/bin/env bash
# Build the EGO ZIP. XML schemas are compiled by the installer (or dev/session.sh).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/extension"
gnome-extensions pack --force --extra-source=lib --extra-source=data --extra-source=icons --extra-source="$root/LICENSE" --out-dir="$root" .
echo "$root/palette@namtt.shell-extension.zip"

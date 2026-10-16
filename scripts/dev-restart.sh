#!/usr/bin/env bash
# (Re)start the headless dev shell in the background; wait until the devtools bus name is up.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
log=${PALETTE_DEV_LOG:-/tmp/palette-dev.log}
pkill -f '^gnome-shell --headless' 2>/dev/null || true
sleep 1
nohup "$root/scripts/dev-shell.sh" >"$log" 2>&1 &
source "$root/scripts/dev.sh"
for _ in $(seq 40); do
    sleep 0.5
    dev_eval 1 >/dev/null 2>&1 && { echo "dev shell up (log: $log)"; exit 0; }
done
echo "dev shell did not come up; see $log" >&2; exit 1

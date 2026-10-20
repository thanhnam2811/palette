#!/usr/bin/env bash
# Start a fresh session. Never kills an existing compositor.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
log=$(mktemp /tmp/palette-launch.XXXXXX.log)
nohup "$root/scripts/dev/session.sh" >"$log" 2>&1 </dev/null &
echo "Launcher PID: $!; session path and startup logs: $log"

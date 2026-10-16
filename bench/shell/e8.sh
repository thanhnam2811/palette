#!/usr/bin/env bash
# E8: clipboard capture cost with a real client, per payload. Needs the dev shell up (scripts/dev-restart.sh).
set -uo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/scripts/dev.sh"
dev_eval "Main.overview.hide()" >/dev/null; sleep 1
code=$(cat "$root/bench/shell/e8.js")
for spec in "text 1024" "text 102400" "text 1048576" "html 1048576" "image 262144" "image 1048576" "image 5242880"; do
    pkill -f "^gjs -m .*clip-client" 2>/dev/null; sleep 0.5
    : >/tmp/palette-client.log
    dev_client "$root/bench/shell/clip-client.js" $spec
    for _ in $(seq 60); do sleep 0.5; grep -q offered /tmp/palette-client.log && break; done
    sleep 1
    dev_eval "$code" >/dev/null
    for _ in $(seq 40); do sleep 0.5; r=$(dev_result); [[ $r != *pending* ]] && break; done
    echo "$spec => $r"
done
pkill -f "^gjs -m .*clip-client" 2>/dev/null

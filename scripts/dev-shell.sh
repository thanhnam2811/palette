#!/usr/bin/env bash
# Compatibility entry point; every invocation creates a fresh isolated session.
set -euo pipefail
exec "$(dirname "$0")/dev/session.sh" "$@"

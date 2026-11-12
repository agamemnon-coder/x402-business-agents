#!/bin/sh
# Bundles the engine worker exactly as wrangler would for a deploy (dry run: nothing is uploaded), with no network.
# Usage: spike/do/chain/build.sh <outdir>
set -e
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-/dev/shm/spike-do-chain/dist}"
home="${TMPDIR:-/dev/shm}/wrangler-home"
mkdir -p "$out" "$home"
rm -rf "$out"/*
cd "$here"
unshare -n python3 ../nonet.py env HOME="$home" XDG_CONFIG_HOME="$home/.config" WRANGLER_SEND_METRICS=false CI=1 \
  node ../../../worker/node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir "$out" -c "${2:-wrangler.jsonc}" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^\s*$'

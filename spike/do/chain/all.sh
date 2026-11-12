#!/bin/sh
# The whole experiment, with no network (every part runs under spike/do/nonet.py: loopback only):
#   1. the shim's conformance checks: better-sqlite3 in Node against the shim in workerd
#   2. wrangler's bundle of the engine worker (deploy --dry-run)
#   3. the chain on better-sqlite3 in Node (the golden run), then inside a Durable Object, compared and timed
# Needs node_modules and worker/node_modules linked into the worktree. Usage: spike/do/chain/all.sh [tmp dir] [runs]
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
tmp="${1:-/dev/shm/spike-do-chain}"
runs="${2:-9}"
mkdir -p "$tmp"
clean="env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY TMPDIR=$tmp"
nonet="unshare -n python3 $root/spike/do/nonet.py"
tsx="$root/node_modules/.bin/tsx"
cd "$tmp"
echo "== 1. shim conformance (Node better-sqlite3 against the Durable Object shim) =="
$nonet $clean "$tsx" "$root/spike/do/conformance-run.ts"
echo; echo "== 2. wrangler bundle =="
TMPDIR="$tmp" "$here/build.sh" "$tmp/dist"
echo; echo "== 3. golden run in Node, then the same chain in a Durable Object =="
$nonet $clean "$tsx" "$here/golden-node.ts" "$tmp/golden.json"
$nonet $clean "$tsx" "$here/run.ts" "$tmp/dist" "$tmp/golden.json" --runs "$runs" --report "$tmp/report.json"

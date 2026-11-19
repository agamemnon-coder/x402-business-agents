#!/usr/bin/env bash
# npm run formal:dafny: machine-checked proofs about the code that guards money (formal/dafny/*.dfy, record in
# docs/evidence/formal-proofs.md).
#   1. Dafny verifies every lemma in formal/dafny: no error, no assumption left unproven.
#   2. The verified functions the differential test runs (formal/dafny/Reference.dfy) are translated to JavaScript
#      again, and the result must be byte for byte the committed formal/dafny/out/reference.js. So the reference that
#      test/formal-dafny-differential.test.ts compares the TypeScript with is the one these proofs are about.
# Dafny is the official dafny-lang GitHub release for Linux x64 (it brings its own .NET runtime and Z3), pinned by
# version and SHA-256; the zip is cached outside the repo (DAFNY_CACHE, default ~/.cache/purser-dafny), its checksum
# checked on every run, and never committed.
# Elsewhere, point DAFNY at a dafny 4.11.0 binary.
# Usage: scripts/formal-dafny.sh           verify, and check the committed translation
#        scripts/formal-dafny.sh --write   verify, and write the translation (after changing Reference.dfy or a proof)
set -euo pipefail

DAFNY_VERSION="4.11.0"
DAFNY_ASSET="dafny-${DAFNY_VERSION}-x64-ubuntu-22.04.zip"
DAFNY_SHA256="a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179"
DAFNY_URL="https://github.com/dafny-lang/dafny/releases/download/v${DAFNY_VERSION}/${DAFNY_ASSET}"
CACHE="${DAFNY_CACHE:-$HOME/.cache/purser-dafny}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_DIR="$HERE/formal/dafny"
COMMITTED="$SPEC_DIR/out/reference.js"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -z "${DAFNY:-}" ]; then
  # The zip is cached; its checksum is checked on every run, and it is unpacked afresh into a temporary folder.
  mkdir -p "$CACHE"
  ZIP="$CACHE/$DAFNY_ASSET"
  if [ ! -f "$ZIP" ] || ! echo "$DAFNY_SHA256  $ZIP" | sha256sum -c --status; then
    echo "formal:dafny: downloading Dafny ${DAFNY_VERSION}"
    curl -fsSL -o "$ZIP.part" "$DAFNY_URL"
    echo "$DAFNY_SHA256  $ZIP.part" | sha256sum -c --status || { echo "formal:dafny: Dafny checksum mismatch; refusing to run it" >&2; rm -f "$ZIP.part"; exit 1; }
    mv "$ZIP.part" "$ZIP"
  fi
  unzip -q "$ZIP" -d "$WORK/tool"
  DAFNY="$WORK/tool/dafny/dafny"
fi
version="$("$DAFNY" --version)"
case "$version" in
  "$DAFNY_VERSION"*) ;;
  *) echo "formal:dafny: expected Dafny ${DAFNY_VERSION}, got ${version}" >&2; exit 1 ;;
esac

# 1. The proofs. Nothing may be taken on trust inside them: no assume, no axiom, no body-less lemma left to an
#    attribute, no unverified or external declaration.
cd "$SPEC_DIR"
if grep -nE '\bassume\b|\{:axiom|\{:verify +false|\{:extern|\{:only' ./*.dfy; then
  echo "formal:dafny: the proofs must not assume anything (assume, {:axiom}, {:verify false}, {:extern}, {:only})" >&2
  exit 1
fi
start=$(date +%s)
if ! "$DAFNY" verify --cores 2 ./*.dfy > "$WORK/verify.log" 2>&1; then
  cat "$WORK/verify.log" >&2
  echo "formal:dafny: verification FAILED" >&2
  exit 1
fi
summary="$(grep -E '^Dafny program verifier finished with' "$WORK/verify.log" | tail -1)"
if ! echo "$summary" | grep -qE 'verified, 0 errors$'; then
  cat "$WORK/verify.log" >&2
  echo "formal:dafny: verification FAILED" >&2
  exit 1
fi
if grep -qiE 'warning' "$WORK/verify.log"; then
  cat "$WORK/verify.log" >&2
  echo "formal:dafny: the verifier warned; fix the warning" >&2
  exit 1
fi
echo "formal:dafny: ${summary} ($(( $(date +%s) - start )) s, Dafny ${version})"

# The committed record and badge (docs/evidence/formal-proofs.json, docs/badges/dafny.json) state this summary.
cd "$HERE"
verified="$(echo "$summary" | sed -E 's/.* with ([0-9]+) verified, 0 errors$/\1/')"
if [ "${1:-}" = "--write" ]; then
  node -e 'const fs=require("fs");const p="docs/evidence/formal-proofs.json";const r=JSON.parse(fs.readFileSync(p,"utf8"));r.verifier=process.argv[1];r.totals.verified=Number(process.argv[2]);r.totals.errors=0;fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n")' "$summary" "$verified"
  npx tsx scripts/badges.ts > /dev/null
  echo "formal:dafny: wrote the record and the badge (${verified} verified, 0 errors)"
else
  record="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("docs/evidence/formal-proofs.json","utf8")).verifier)')"
  badge="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("docs/badges/dafny.json","utf8")).message)')"
  if [ "$record" != "$summary" ] || [ "$badge" != "${verified} verified, 0 errors" ]; then
    echo "formal:dafny: the record says \"${record}\" and the badge \"${badge}\", but the verifier printed \"${summary}\"; run scripts/formal-dafny.sh --write and commit" >&2
    exit 1
  fi
  echo "formal:dafny: docs/badges/dafny.json says ${badge}, as the verifier printed"
fi
cd "$SPEC_DIR"

# 2. The translation the differential test runs.
"$DAFNY" translate js --no-verify --include-runtime Reference.dfy -o "$WORK/js/reference.js" > "$WORK/translate.log" 2>&1 || { cat "$WORK/translate.log" >&2; exit 1; }
if [ "${1:-}" = "--write" ]; then
  mkdir -p "$(dirname "$COMMITTED")"
  cp "$WORK/js/reference.js" "$COMMITTED"
  echo "formal:dafny: wrote formal/dafny/out/reference.js"
elif cmp -s "$WORK/js/reference.js" "$COMMITTED"; then
  echo "formal:dafny: formal/dafny/out/reference.js is the translation of the verified Reference.dfy"
else
  echo "formal:dafny: formal/dafny/out/reference.js is not what Dafny translates from formal/dafny/Reference.dfy now; run scripts/formal-dafny.sh --write and commit it" >&2
  diff "$COMMITTED" "$WORK/js/reference.js" | head -40 >&2 || true
  exit 1
fi

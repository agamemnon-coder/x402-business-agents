#!/usr/bin/env bash
# npm run formal: model-checks formal/PurserPayment.tla with TLC.
#   1. The committed bound (formal/PurserPayment.cfg) must hold: no invariant or property violated.
#   2. Each planted bug (formal/Bug_*.cfg) must be caught: TLC must report the named violation.
# tla2tools.jar comes from the official tlaplus GitHub release, pinned by version and SHA-256. It is cached outside the
# repo (TLA_CACHE, default ~/.cache/purser-tla) and never committed. Needs Java 11+ (CI uses Java 21).
# Usage: scripts/formal.sh            the bound and the planted bugs
#        scripts/formal.sh --bugs     the planted bugs only (seconds); CI runs both (about 4 minutes)
set -euo pipefail

TLA_VERSION="v1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar"
CACHE="${TLA_CACHE:-$HOME/.cache/purser-tla}"
JAR="$CACHE/tla2tools-${TLA_VERSION}.jar"
WORKERS="${TLC_WORKERS:-2}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_DIR="$HERE/formal"

mkdir -p "$CACHE"
if [ ! -f "$JAR" ] || ! echo "$TLA_SHA256  $JAR" | sha256sum -c --status; then
  echo "formal: downloading tla2tools.jar ${TLA_VERSION}"
  curl -fsSL -o "$JAR.part" "$TLA_URL"
  echo "$TLA_SHA256  $JAR.part" | sha256sum -c --status || { echo "formal: tla2tools.jar checksum mismatch; refusing to run it" >&2; rm -f "$JAR.part"; exit 1; }
  mv "$JAR.part" "$JAR"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

tlc() { # tlc <cfg> <log>
  (cd "$SPEC_DIR" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers "$WORKERS" -cleanup -metadir "$WORK/states-$(basename "$1" .cfg)" -config "$1" PurserPayment.tla) > "$2" 2>&1
}

fail=0
# Each planted bug and the violation TLC must report for it.
for pair in "no_idem_key:Invariant NeverPaidTwice is violated" \
            "no_hash_check:Invariant OnlySignedTermsPaid is violated" \
            "webhook_trusted:Action property WebhooksMoveNoMoney is violated"; do
  bug="${pair%%:*}"; want="${pair#*:}"
  log="$WORK/bug-$bug.log"
  tlc "Bug_$bug.cfg" "$log" || true
  if grep -q "$want" "$log"; then
    echo "formal: planted bug $bug caught ($want)"
  else
    echo "formal: planted bug $bug NOT caught" >&2; tail -20 "$log" >&2; fail=1
  fi
done

if [ "${1:-}" != "--bugs" ]; then
  log="$WORK/bound.log"
  start=$(date +%s)
  if tlc PurserPayment.cfg "$log" && grep -q "Model checking completed. No error has been found." "$log"; then
    echo "formal: the bound holds: $(grep -E '^[0-9,]+ states generated' "$log" | tail -1) $(grep -E '^The depth of the complete state graph' "$log" | tail -1) $(( $(date +%s) - start )) s."
  else
    echo "formal: the bound FAILED" >&2; grep -v JAVA_TOOL_OPTIONS "$log" | tail -60 >&2; fail=1
  fi
  grep -E "^TLC2 Version" "$log" || true
fi
exit $fail

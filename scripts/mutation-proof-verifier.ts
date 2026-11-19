// Mutation testing of the proof-bundle verifier (docs/evidence/mutation-testing.md). Stryker mutates TypeScript, but
// the checks /verify and `npm run verify-bundle` run are one piece of plain JavaScript held in a string
// (PROOF_VERIFY_JS in src/proof/bundle.ts), which Stryker cannot reach inside. So this applies a fixed list of
// mutations to that text, one at a time: each a condition dropped, an operator or boundary changed, or a check forced
// to pass. For each it writes the mutated file, runs the verifier's tests, and puts the original back. A mutant is
// killed when a test fails. Usage: npx tsx scripts/mutation-proof-verifier.ts [--out reports/mutation/proof-verifier.json]
// Never run it while Stryker runs in place in the same checkout: both write src/.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const FILE = "src/proof/bundle.ts";
export const PROOF_TESTS = ["test/proof-bundle.test.ts", "test/tamper-matrix.test.ts", "test/mutation-kills-verifier.test.ts"];

export interface TextMutant { id: string; what: string; from: string; to: string }

/** Each `from` occurs exactly once in the verifier's text; `to` replaces it. */
export const MUTANTS: TextMutant[] = [
  // The format check
  { id: "format-name", what: "any format name accepted", from: "pvIsObj(b) && b.format === PROOF_FORMAT && pvIsObj(b.terms)", to: "pvIsObj(b) && true && pvIsObj(b.terms)" },
  { id: "format-hex", what: "terms_sha256 need not be 64 hex", from: "typeof b.terms_sha256 === \"string\" && HEX.test(b.terms_sha256)", to: "typeof b.terms_sha256 === \"string\" && true" },
  { id: "format-rp-empty", what: "an empty rpId accepted (> 0 to >= 0)", from: "b.rp_id.length > 0", to: "b.rp_id.length >= 0" },
  { id: "format-b64", what: "assertion fields need not be base64url", from: "return typeof x === \"string\" && B64.test(x); })", to: "return typeof x === \"string\"; })" },
  { id: "format-early-return", what: "carry on after a failed format check", from: "return !!ok; }", to: "return true; }" },
  // JCS and the terms hash
  { id: "jcs-integer", what: "a fractional number canonicalised", from: "if (!Number.isInteger(v)) throw", to: "if (false) throw" },
  { id: "jcs-sort", what: "keys not sorted", from: "return v[k] !== undefined; }).sort().map(", to: "return v[k] !== undefined; }).map(" },
  { id: "no-numbers", what: "numbers allowed in signed terms", from: "function pvNoNumbers(v) { if (typeof v === \"number\") return false;", to: "function pvNoNumbers(v) { if (typeof v === \"number\") return true;" },
  { id: "terms-hash-same", what: "the file's canonical text not compared", from: "var same = b.canonical === canonical;", to: "var same = true;" },
  { id: "terms-hash-missing", what: "a file without the canonical text passes", from: "var same = b.canonical === canonical;", to: "var same = b.canonical === undefined || b.canonical === canonical;" },
  { id: "terms-hash-eq", what: "terms hash not compared with the file's", from: "add(\"terms hash\", h === b.terms_sha256 && same,", to: "add(\"terms hash\", same," },
  { id: "terms-hash-null", what: "a number in the terms passes the hash check", from: "if (canonical === null) { add(\"terms hash\", false,", to: "if (canonical === null) { add(\"terms hash\", true," },
  // Challenge and client data
  { id: "challenge-eq", what: "challenge not compared with the hash", from: "add(\"challenge\", ch !== null && h !== null && ch === h,", to: "add(\"challenge\", ch !== null && h !== null," },
  { id: "client-type", what: "ceremony type not checked", from: "add(\"client data\", typeOk && originOk && !framed,", to: "add(\"client data\", originOk && !framed," },
  { id: "client-origin", what: "origin not checked", from: "typeOk && originOk && !framed, pvIsObj(cd)", to: "typeOk && !framed, pvIsObj(cd)" },
  { id: "client-frame", what: "a cross-origin frame accepted", from: "typeOk && originOk && !framed, pvIsObj(cd)", to: "typeOk && originOk, pvIsObj(cd)" },
  { id: "client-create", what: "webauthn.create taken for webauthn.get", from: "cd.type === \"webauthn.get\"", to: "cd.type === \"webauthn.create\"" },
  // Authenticator data
  { id: "rp-hash", what: "rpIdHash not compared", from: "add(\"rp id\", got === rph,", to: "add(\"rp id\", got !== null," },
  { id: "rp-short", what: "a 36-byte authenticator data read (>= 37 to >= 36)", from: "var got = ad.length >= 37 ?", to: "var got = ad.length >= 36 ?" },
  { id: "flag-up", what: "user presence not checked", from: "up = (flags & 1) === 1", to: "up = true" },
  { id: "flag-uv", what: "user verification read from the UP bit", from: "uv = (flags & 4) === 4", to: "uv = (flags & 1) === 1" },
  { id: "flags-or", what: "present OR verified suffices", from: "add(\"user verified\", up && uv,", to: "add(\"user verified\", up || uv," },
  // Signature
  { id: "sig-forced", what: "signature result ignored", from: "add(\"signature\", ok, k.alg", to: "add(\"signature\", true, k.alg" },
  { id: "sig-der-len", what: "trailing bytes after the DER signature accepted", from: "if (6 + rl + sl !== d.length) return null;", to: "" },
  { id: "sig-der-seq", what: "DER SEQUENCE length not checked", from: "d[1] !== d.length - 2 || ", to: "" },
  { id: "sig-der-long", what: "an over-long r or s accepted", from: "if (x.length > 32) ok = false; else", to: "" },
  { id: "sig-key-crv", what: "an EC key on another curve taken as P-256", from: "kty === 2 && m.get(-1) === 1 &&", to: "kty === 2 &&" },
  { id: "sig-key-alg", what: "an EC key with another alg taken as ES256", from: "(alg === -7 || alg === undefined)", to: "true" },
  { id: "sig-not-der", what: "a non-DER ES256 signature passes", from: "if (!s) { add(\"signature\", false,", to: "if (!s) { add(\"signature\", true," },
  { id: "sig-key-error", what: "an unknown key type passes", from: "function (e) { add(\"signature\", false, e.message);", to: "function (e) { add(\"signature\", true, e.message);" },
  // The engine's decision
  { id: "decision-named", what: "decision need not name the signed hash", from: "var named = d.signed_sha256 === h,", to: "var named = true," },
  { id: "decision-outcome", what: "any outcome accepted", from: "var why = o !== \"paid\" && o !== \"refused\" ?", to: "var why = false ?" },
  { id: "decision-sent", what: "what was sent not compared", from: "!sentOk ? \"what was sent is not \"", to: "false ? \"what was sent is not \"" },
  { id: "decision-sent-asked", what: "a refusal's sent hash need not be the asked terms'", from: "var sentWant = x === undefined ? h : xh,", to: "var sentWant = x === undefined ? h : d.sent_sha256," },
  { id: "decision-booleans", what: "the answers need not be true or false", from: "typeof v !== \"boolean\" || typeof acc !== \"boolean\" ?", to: "false ?" },
  { id: "decision-paid-checks", what: "a payment need not be verified and accepted", from: "!(v === true && acc === true) ?", to: "false ?" },
  { id: "decision-paid-moved", what: "a payment need not make a transfer", from: "!(moved !== null && moved > 0) ?", to: "false ?" },
  { id: "decision-other-terms", what: "other terms may be verified or accepted", from: "other && (v || acc) ?", to: "false ?" },
  { id: "decision-refused-moved", what: "a refusal may move money", from: "moved !== 0 ? \"a refusal that moved money\"", to: "false ? \"a refusal that moved money\"" },
  { id: "decision-changed", what: "the changed fields not compared", from: "if (!why && !changedOk)", to: "if (false)" },
  // A refusal's asked terms
  { id: "asked-sha", what: "the asked terms' hash not compared with the file's", from: "add(\"asked terms\", xh === x.sha256 && xh !== h,", to: "add(\"asked terms\", xh !== h," },
  { id: "asked-differ", what: "asked terms may equal the signed ones", from: "add(\"asked terms\", xh === x.sha256 && xh !== h,", to: "add(\"asked terms\", xh === x.sha256," },
  { id: "asked-missing", what: "missing asked terms pass", from: "if (xc === null) { add(\"asked terms\", false,", to: "if (xc === null) { add(\"asked terms\", true," },
  { id: "asked-canonical", what: "the asked terms' canonical text not compared", from: "if (x.canonical !== xc) {", to: "if (false) {" },
  // The ledger
  { id: "ledger-sign", what: "credits added instead of subtracted", from: "(l.debit_cents | 0) - (l.credit_cents | 0)", to: "(l.debit_cents | 0) + (l.credit_cents | 0)" },
  { id: "ledger-one-line", what: "a one-line entry accepted (< 2 to < 1)", from: "(e.lines || []).length < 2 || off.length", to: "(e.lines || []).length < 1 || off.length" },
  { id: "ledger-balance-forced", what: "balance result ignored", from: "add(\"ledger balance\", !bad,", to: "add(\"ledger balance\", true," },
  { id: "ledger-none-paid", what: "a payment with no entries passes", from: "mayBeNone = String(b.decision.outcome) === \"refused\";", to: "mayBeNone = true;" },
  { id: "ledger-none-head", what: "a refusal's ledger head not checked", from: "mayBeNone && (b.ledger.head === null || HEX.test(String(b.ledger.head)))", to: "mayBeNone" },
  { id: "ledger-hash", what: "entry hash not compared", from: "if (got !== e.entry_hash) return", to: "if (false) return" },
  { id: "ledger-body-prev", what: "prev_hash kept in the hashed body", from: "if (k !== \"entry_hash\" && k !== \"prev_hash\") body[k] = e[k];", to: "if (k !== \"entry_hash\") body[k] = e[k];" },
  { id: "ledger-link", what: "an entry need not cover the one before", from: "if (prev && prev.entry_id + 1 === e.entry_id && e.prev_hash !== prev.entry_hash) return", to: "if (false) return" },
  { id: "ledger-chain-forced", what: "chain result ignored", from: "add(\"ledger chain\", !why,", to: "add(\"ledger chain\", true," },
  { id: "ledger-count", what: "the count not checked", from: "!Number.isInteger(L.count) || L.count < 1 ?", to: "false ?" },
  { id: "ledger-past-count", what: "an entry past the count accepted", from: "last > L.count ?", to: "false ?" },
  { id: "ledger-head-count", what: "the head need not be entry #count's hash", from: "if (!shape && atCount && atCount.entry_hash !== L.head)", to: "if (false)" },
  { id: "ledger-head-other", what: "the head may be another entry's hash", from: "if (!shape && atHead && atHead.entry_id !== L.count)", to: "if (false)" },
  { id: "ledger-shape-ignored", what: "the head and count result ignored", from: "why = why || shape;", to: "why = why;" },
  { id: "ledger-payment-forced", what: "the payment's entries not required", from: "add(\"ledger payment\", lacks.length === 0,", to: "add(\"ledger payment\", true," },
  { id: "ledger-payment-amount", what: "the transfer's amount not compared", from: "has(e, t.currency, \"debit_cents\", amt)", to: "true" },
  { id: "ledger-payment-conversion", what: "a conversion's legs not required", from: "concat(!conv || buy ? [] :", to: "concat(true ? [] :" },
  // The verdict
  { id: "verdict-some", what: "ok when any check passes", from: "checks.length > 0 && checks.every(function (c) { return c.ok; })", to: "checks.some(function (c) { return c.ok; })" },
  { id: "verdict-empty", what: "ok with no checks at all", from: "checks.length > 0 && checks.every(", to: "checks.length >= 0 && checks.every(" },
  { id: "verdict-error", what: "an exception counts as a pass", from: "add(\"error\", false,", to: "add(\"error\", true," },
];

export interface TextMutantResult extends TextMutant { status: "Killed" | "Survived" | "Timeout" }

function runTests(files: string[]): { ok: boolean; timedOut: boolean } {
  const r = spawnSync("npx", ["vitest", "run", ...files, "--reporter=dot", `--maxWorkers=${process.env.MUTATION_WORKERS ?? "2"}`, "--testTimeout=60000"], { stdio: "ignore", timeout: 300_000 });
  return { ok: r.status === 0, timedOut: r.signal !== null };
}

function main(): void {
  const outAt = process.argv.indexOf("--out");
  const out = outAt > 0 ? process.argv[outAt + 1]! : "reports/mutation/proof-verifier.json";
  const original = readFileSync(FILE, "utf8");
  const start = original.indexOf("export const PROOF_VERIFY_JS");
  const end = original.indexOf("`;", start);
  const restore = () => writeFileSync(FILE, original);
  process.on("SIGINT", () => { restore(); process.exit(130); });
  for (const m of MUTANTS) {
    const at = original.indexOf(m.from, start);
    if (at < 0 || at > end || original.indexOf(m.from, at + 1) !== -1 && original.indexOf(m.from, at + 1) < end) throw new Error(`mutant ${m.id}: its text is not found exactly once in PROOF_VERIFY_JS`);
  }
  if (!runTests(PROOF_TESTS).ok) throw new Error("the verifier's tests fail on the unmutated code: fix that first");
  const results: TextMutantResult[] = [];
  try {
    for (const m of MUTANTS) {
      const at = original.indexOf(m.from, start);
      writeFileSync(FILE, original.slice(0, at) + m.to + original.slice(at + m.from.length));
      const r = runTests(PROOF_TESTS);
      const status = r.timedOut ? "Timeout" : r.ok ? "Survived" : "Killed";
      results.push({ ...m, status });
      console.log(`${status.padEnd(8)} ${m.id}: ${m.what}`);
    }
  } finally {
    restore();
  }
  const killed = results.filter((r) => r.status !== "Survived").length;
  const summary = { file: FILE, tests: PROOF_TESTS, total: results.length, killed: results.filter((r) => r.status === "Killed").length, timeout: results.filter((r) => r.status === "Timeout").length, survived: results.length - killed, score: Math.round((1000 * killed) / results.length) / 10, results };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n${killed} of ${results.length} killed (${summary.score}%); ${summary.survived} survived. Written to ${out}`);
}

if (process.argv[1] && /mutation-proof-verifier/.test(process.argv[1])) main();

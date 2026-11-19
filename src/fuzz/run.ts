// Runs the fuzzing set (./properties.ts) and writes its report: docs/evidence/fuzzing.md and .json (npm run fuzz).
import fc from "fast-check";
import { committedArtifacts } from "../cli/tamperMatrix.js";
import { verifyProofBundle } from "../proof/bundle.js";
import { verifyReceipt } from "../try/receipt.js";
import { coseKey, getAt, pathsOf, pathText, PROPERTIES, type FuzzContext, type FuzzProperty } from "./properties.js";

export const FUZZ_SEED = 20261119;

export interface FuzzResult {
  id: string; target: string; what: string;
  status: "PASS" | "FAIL";
  runs_asked: number; runs_done: number; skipped: number; ms: number; time_limit_ms: number; interrupted: boolean;
  seed: number;
  /** A failure only: the shrunk counterexample, what it broke, and the path fast-check replays it with. */
  counterexample?: string; error?: string; shrinks?: number; path?: string;
  notes?: string;
}

/** The committed receipts and bundles, each distinct one once (the tamper matrix finds them). */
export function fuzzContext(): FuzzContext {
  const found = committedArtifacts();
  return {
    bundles: found.filter((f) => f.found.kind === "bundle").map((f) => ({ file: f.file, value: f.found.value as Record<string, unknown> })),
    receipts: found.filter((f) => f.found.kind === "receipt").map((f) => ({ file: f.file, value: f.found.value as Record<string, unknown> })),
  };
}

const show = (v: unknown): string => {
  try {
    return JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? `${x}n` : x === undefined ? "undefined" : Number.isNaN(x) ? "NaN" : Object.is(x, -0) ? "-0" : x instanceof Map ? [...x] : x instanceof Set ? [...x] : x)).slice(0, 2_000);
  } catch { return String(v).slice(0, 2_000); }
};

/**
 * One property, with its seed: `runs` and `timeLimitMs` override the property's own (the tests run fewer); `scale`
 * multiplies the property's own run count and time limit instead (the nightly run).
 */
export async function runProperty(p: FuzzProperty, ctx: FuzzContext, o: { seed?: number; runs?: number; timeLimitMs?: number; scale?: number; path?: string } = {}): Promise<FuzzResult> {
  const seed = o.seed ?? FUZZ_SEED + PROPERTIES.indexOf(p);
  const scale = o.scale ?? 1;
  const runs = o.runs ?? Math.round(p.runs * scale), limit = o.timeLimitMs ?? Math.round(p.timeLimitMs * scale);
  const prop = await p.make(ctx);
  const started = Date.now();
  const d = await fc.check(prop as fc.IAsyncProperty<unknown[]>, { numRuns: runs, seed, interruptAfterTimeLimit: limit, markInterruptAsFailure: false, ...(o.path ? { path: o.path } : {}) });
  const base: FuzzResult = {
    id: p.id, target: p.target, what: p.what, status: d.failed ? "FAIL" : "PASS", runs_asked: runs, runs_done: d.numRuns, skipped: d.numSkips,
    ms: Date.now() - started, time_limit_ms: limit, interrupted: d.interrupted, seed, ...(p.notes ? { notes: p.notes() } : {}),
  };
  if (!d.failed) return base;
  const err = d.errorInstance as Error | undefined;
  return { ...base, counterexample: show(d.counterexample), error: String(err?.message ?? err ?? "the property returned false").slice(0, 1_000), shrinks: d.numShrinks, path: d.counterexamplePath ?? "" };
}

export async function runFuzz(o: { only?: string; seed?: number; runs?: number; timeLimitMs?: number; scale?: number; path?: string; log?: (r: FuzzResult) => void } = {}): Promise<FuzzResult[]> {
  const ctx = fuzzContext();
  const out: FuzzResult[] = [];
  for (const p of PROPERTIES.filter((x) => !o.only || x.id === o.only)) {
    const r = await runProperty(p, ctx, o);
    out.push(r);
    o.log?.(r);
  }
  return out;
}

/**
 * Every field of every committed bundle and receipt, one at a time: a character appended (a number moved by one, a
 * boolean flipped, null made a string), the field deleted, a key added to an object. What still verifies is listed by
 * kind, change and path (array indexes as []), with how many artifacts it held for.
 */
export async function sweepArtifacts(ctx: FuzzContext): Promise<{ tried: number; still_valid: { kind: string; change: string; path: string; artifacts: number; covered: "signature" | "same bytes" | "same key" | "context" }[] }> {
  const hits = new Map<string, number>();
  let tried = 0;
  for (const [kind, list] of [["bundle", ctx.bundles], ["receipt", ctx.receipts]] as const) {
    for (const a of list) {
      for (const p of pathsOf(a.value)) {
        for (const change of ["edit", "delete", "add a key"] as const) {
          const c = structuredClone(a.value);
          const parent = getAt(c, p.slice(0, -1)) as Record<string | number, unknown>;
          const key = p.at(-1)!, v = parent[key];
          if (change === "delete") { if (Array.isArray(parent)) parent.splice(key as number, 1); else delete parent[key]; }
          else if (change === "add a key") { if (v && typeof v === "object" && !Array.isArray(v)) (v as Record<string, unknown>).zz_added = "x"; else continue; }
          else if (typeof v === "string") parent[key] = `${v}x`;
          else if (typeof v === "number") parent[key] = v + 1;
          else if (typeof v === "boolean") parent[key] = !v;
          else if (v === null) parent[key] = "x";
          else continue;
          tried++;
          let ok: boolean;
          try { ok = kind === "bundle" ? (await verifyProofBundle(c)).ok : verifyReceipt(c).ok; } catch { ok = false; }
          if (ok) {
            const path = pathText(p), now = getAt(c, p);
            // What the signature covers, unless the change left the decoded bytes (or the COSE key) as they were.
            const covered = !SIGNED.test(path) ? "context"
              : path === "public_key.cose" && typeof v === "string" && typeof now === "string" && coseKey(v) !== null && coseKey(v) === coseKey(now) ? "same key"
              : /^assertion\.|^public_key\.cose$/.test(path) && typeof v === "string" && typeof now === "string" && Buffer.from(v, "base64url").equals(Buffer.from(now, "base64url")) ? "same bytes" : "signature";
            const k = `${kind}\t${change}\t${path.replace(/\[\d+\]/g, "[]")}\t${covered}`;
            hits.set(k, (hits.get(k) ?? 0) + 1);
          }
        }
      }
    }
  }
  return { tried, still_valid: [...hits].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => { const [kind, change, path, covered] = k.split("\t") as [string, string, string, "signature"]; return { kind, change, path, artifacts: n, covered }; }) };
}
const SIGNED = /^(terms(\.|\[|$)|terms_sha256$|rp_id$|origin$|assertion\.(authenticatorData|clientDataJSON|signature)$|public_key\.(cose|kty|crv|x|y)$)/;

export interface FuzzReport {
  format: "purser.fuzzing/v1"; checked: string; how: string;
  totals: { properties: number; runs: number; passed: number; failed: number; ms: number };
  artifacts: { bundles: string[]; receipts: string[] };
  canonicalization: string[];
  results: FuzzResult[];
  sweep: Awaited<ReturnType<typeof sweepArtifacts>>;
}

/** How canonicalization treats Unicode and numbers, as the properties hold it (said in the report). */
export const CANONICALIZATION = [
  "Terms are canonicalized with RFC 8785 (JCS): keys sorted by UTF-16 code units, no whitespace, strings escaped as JSON.stringify escapes them (lone surrogates as \\uXXXX). Key order and the whitespace the JSON was written with never change the hash (terms-order-whitespace).",
  "No Unicode normalization is done anywhere: a payee written in NFC (é, U+00E9) and in NFD (e + U+0301) are different code points, so different canonical bytes and different hashes (terms-unicode). The passkey signs the exact code points the phone shows and hashes itself; a normalized copy of the terms would be refused, never accepted.",
  "Terms carry no JSON numbers: money is a two-decimal string. The runner (src/lib/terms.ts), the receipt verifier (src/try/receipt.ts) and /verify (src/proof/bundle.ts) refuse a number anywhere in the terms (terms-numbers). The phone's canonicalize (src/approve/client.ts) would write a finite number in JS form; it never meets one, since the terms it hashes come from the runner. /verify's JCS writes whole numbers only, for the ledger entries a bundle carries.",
  "Amounts are compared as strings: 1850.00, 1850.0, 1,850.00 and \"1850.00 \" are four different terms with four different hashes (terms-numbers). The reader turns what a document says into dddd.dd before anything is proposed (parser-total).",
  "The four implementations (the runner's metal-pay jcs, the phone's, the receipt verifier's and /verify's) write the same bytes for any number-free JSON, and Node's SHA-256 and WebCrypto's agree (terms-four-canonicals-agree).",
];

export function fuzzReport(results: FuzzResult[], ctx: FuzzContext, checked: string, sweep: FuzzReport["sweep"]): FuzzReport {
  return {
    format: "purser.fuzzing/v1", checked,
    how: "npm run fuzz: fast-check properties (src/fuzz/properties.ts) at high run counts, each within a time limit, with a fixed seed per property; a failure is shrunk to a small counterexample and kept with the seed and path that replay it. In process, no network.",
    totals: { properties: results.length, runs: results.reduce((s, r) => s + r.runs_done, 0), passed: results.filter((r) => r.status === "PASS").length, failed: results.filter((r) => r.status === "FAIL").length, ms: results.reduce((s, r) => s + r.ms, 0) },
    artifacts: { bundles: ctx.bundles.map((b) => b.file), receipts: ctx.receipts.map((b) => b.file) },
    canonicalization: CANONICALIZATION, results, sweep,
  };
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function fuzzMarkdown(r: FuzzReport): string {
  const t = r.totals;
  const lines = [
    "# Fuzzing",
    "",
    `Run on ${r.checked} with \`npm run fuzz\` (src/cli/fuzz.ts): **${t.properties} properties, ${t.runs.toLocaleString("en-US")} runs, ${t.passed} held, ${t.failed} failed** (${Math.round(t.ms / 1000)} s).`,
    "",
    "Each property runs with fast-check (src/fuzz/properties.ts) at the run count shown, within its time limit, from a fixed seed. A failure is a finding: fast-check shrinks it to a small counterexample, kept below with the seed and path that replay it (`npm run fuzz -- --only <id> --seed <seed> --path <path>`). The signed artifacts are the ones committed in this repository, found as the tamper matrix finds them: " + `${r.artifacts.bundles.length} proof bundles and ${r.artifacts.receipts.length} receipts.`,
    "",
    "## Properties",
    "",
    "| Property | Target | Runs | Time | Result |",
    "|---|---|---|---|---|",
    ...r.results.map((x) => `| \`${x.id}\`: ${cell(x.what)} | ${cell(x.target)} | ${x.runs_done.toLocaleString("en-US")} of ${x.runs_asked.toLocaleString("en-US")}${x.skipped ? ` (${x.skipped.toLocaleString("en-US")} skipped by a precondition)` : ""}${x.interrupted ? ", time limit reached" : ""} | ${(x.ms / 1000).toFixed(1)} s${x.notes ? `; ${cell(x.notes)}` : ""} | ${x.status === "PASS" ? "held" : "**FAILED**"} |`),
    "",
    "## Findings",
    "",
  ];
  const failed = r.results.filter((x) => x.status === "FAIL");
  if (!failed.length) lines.push("No property failed.", "");
  for (const x of failed) {
    lines.push(`### \`${x.id}\` failed`, "", `- Target: ${x.target}`, `- Property: ${x.what}`, `- What broke: ${x.error}`, `- Counterexample (shrunk ${x.shrinks ?? 0} times): \`${(x.counterexample ?? "").replace(/`/g, "'")}\``,
      `- Replay: \`npm run fuzz -- --only ${x.id} --seed ${x.seed} --path ${x.path}\``, "", ...(FINDING_NOTES[x.id] ? [FINDING_NOTES[x.id]!, ""] : []));
  }
  lines.push("## Every field, one at a time", "",
    `Beside the random mutations: every field of every committed bundle and receipt changed once each way (a character appended, a number moved by one, a boolean flipped; the field deleted; a key added to an object), ${r.sweep.tried.toLocaleString("en-US")} changed copies. These still verify (\`[]\` stands for any index; "artifacts" counts the files it held for):`, "",
    "| Kind | Change | Path | Artifacts | Signed? |", "|---|---|---|---|---|",
    ...r.sweep.still_valid.map((x) => `| ${x.kind} | ${x.change} | \`${x.path}\` | ${x.artifacts} | ${x.covered === "signature" ? "**covered by the signature: a forgery**" : x.covered === "context" ? "context, not signed" : `${x.covered}: an encoding of the same signed value`} |`), "",
    `Rows covered by the signature that still verify (a forgery): ${r.sweep.still_valid.filter((x) => x.covered === "signature").length}. "Same bytes" and "same key": the appended base64url character only fills the last group's unused bits, or adds a byte after the COSE map that the key reader ignores; the decoded signature or key is the one signed, so nothing is forged. "Context, not signed": a field the signature does not cover (see bundle-context above for what /verify shows of it).`, "");
  lines.push("## Canonical terms: Unicode and numbers", "", ...r.canonicalization.map((c) => `- ${c}`), "");
  lines.push("The JSON beside this file (`fuzzing.json`) holds the same results.", "");
  return lines.join("\n");
}

/** What each known finding means, in words (the counterexample says the rest). */
export const FINDING_NOTES: Record<string, string> = {
  "parser-compose-roundtrip": "What it means: /try's \"write your own\" (cloud/src/try, checkCompose in src/engine/tryWorld.ts) accepts invoice numbers of letters only (its rule: 1 to 32 letters, digits, dashes or slashes), but the parser (src/ap/reading.ts) reads a number only when it holds a digit, so such an invoice is filed as needs_review (\"the reading lacks invoice no\"). Fails safe: nothing is proposed or paid; a visitor's own invoice just stops for a person. Seen live on the red team's first pass (docs/evidence/redteam-api.md). Fix: one rule for both (require a digit in compose, or read letter-only numbers after the label).",
  "parser-compose-roundtrip-pdf": "What it means: the same as parser-compose-roundtrip, through the PDF /try renders and the text extraction.",
  "bundle-context": "What it means: the signature in a bundle covers the terms only; the engine's decision and the ledger entries beside it are context, checked for consistency but bound to nothing signed. A direct probe of the four committed bundles (every field edited, deleted, or given an extra key) found these still VALID: decision.outcome edited or removed (any text that is not paid, paid_once or refused passes the decision check), decision.sent_sha256 edited in a refusal, any one ledger entry deleted (\"ledger chain\" then checks only consecutive entries), ledger.head and ledger.count edited, asked.canonical edited; and, harmless, public_key.cose with a trailing character (the CBOR reader ignores trailing bytes). /verify says what a valid bundle proves (PROOF_MEANS: the key signed exactly these terms), yet shows \"decision\" and \"ledger chain\" passing for an edited copy. Fix: say on /verify that the decision and the ledger are the engine's record, not proven by the signature; or have the engine sign the bundle; refuse unknown outcomes and a ledger whose entries do not reach ledger.head.",
  "bundle-malformed": "What it means: a base64url field of the bundle (assertion.authenticatorData, assertion.signature, public_key.cose) whose length leaves 1 over a multiple of 4 passes the format check's regex, then atob() throws InvalidCharacterError before the promise chain starts: verifyProofBundle (src/proof/bundle.ts, PROOF_VERIFY_JS) throws synchronously instead of answering NOT VALID. `npm run verify-bundle` then ends with a stack trace (no check lines, no \"NOT VALID\"), and /verify's script stops on an uncaught error. Fails closed (never VALID). Fix: decode inside the try (or test the length) and add a failed \"format\" check.",
};

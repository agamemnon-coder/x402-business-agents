// The tamper matrix (`npm run tamper-matrix`, src/cli/tamperMatrix.ts): every signed receipt and proof bundle committed
// in the repository, each signed field changed by the smallest step (a cent, one digit, one letter, a second, another
// currency), and every changed copy run through the same verifier `npm run verify-receipt` and `npm run verify-bundle`
// run. Expected: the original verifies, and every changed copy is refused.
// Each change is tried twice: with the hash left as it was (the terms no longer hash to it), and with the hash
// recomputed from the changed terms, as a forger would (then the passkey's challenge and signature no longer match).
// Pure functions and the verifiers only: no file system, no network (the command reads the files).

import { createHash } from "node:crypto";
import { verifyProofBundle, PROOF_FORMAT } from "./bundle.js";
import { canonicalTerms, RECEIPT_FORMAT, verifyReceipt } from "../try/receipt.js";
import { cell } from "./awxCoverage.js";

export type Kind = "receipt" | "bundle";
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** What a signed artifact is, by its format field; null when it is neither. */
export function kindOf(v: unknown): Kind | null {
  if (!isObj(v)) return null;
  if (v.receipt === RECEIPT_FORMAT) return "receipt";
  if (v.format === PROOF_FORMAT) return "bundle";
  return null;
}

export interface Found { at: string; kind: Kind; value: J }
/** Every signed receipt or bundle inside a JSON value, at any depth ("$" is the file itself, "$.pays[0].answer.proof" one inside it). */
export function findSigned(json: unknown, at = "$"): Found[] {
  const k = kindOf(json);
  if (k) return [{ at, kind: k, value: json as J }];
  if (Array.isArray(json)) return json.flatMap((x, i) => findSigned(x, `${at}[${i}]`));
  if (isObj(json)) return Object.entries(json).flatMap(([key, x]) => findSigned(x, `${at}.${key}`));
  return [];
}
/** The same artifact found twice (a sample file and the record that embeds it) is one artifact: keyed by its content. */
export const contentKey = (v: unknown) => sha256(JSON.stringify(v));

export type Path = (string | number)[];
export interface Change { path: Path; change: string; before: string; after: string; set: (terms: J) => void }

export const pathText = (p: Path) => p.reduce<string>((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${k}` : k), "");
const show = (v: unknown) => (v === undefined ? "(absent)" : JSON.stringify(v));

/** Money as a decimal string, moved by a number of cents, in the same form ("240.00" + 1 = "240.01"; "0.00" - 1 = "-0.01"). */
export function moveCents(s: string, cents: number): string {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(s);
  if (!m) throw new Error(`not money: ${s}`);
  const v = (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3])) + cents;
  const a = Math.abs(v);
  return `${v < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
/** One character changed: the last digit (+1, 9 to 0), else the last letter (the next one, z to a), else an "x" added. */
export function oneCharacter(s: string): { after: string; change: string } {
  for (let i = s.length - 1; i >= 0; i--) if (/\d/.test(s[i]!)) return { after: s.slice(0, i) + String((Number(s[i]) + 1) % 10) + s.slice(i + 1), change: "one digit" };
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]!;
    if (/[a-z]/.test(c)) return { after: s.slice(0, i) + (c === "z" ? "a" : String.fromCharCode(c.charCodeAt(0) + 1)) + s.slice(i + 1), change: "one letter" };
    if (/[A-Z]/.test(c)) return { after: s.slice(0, i) + (c === "Z" ? "A" : String.fromCharCode(c.charCodeAt(0) + 1)) + s.slice(i + 1), change: "one letter" };
  }
  return { after: `${s}x`, change: "one character added" };
}
/** A time a second later, a date a day later, in the same form. */
export function later(s: string): { after: string; change: string } | null {
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return { after: new Date(Date.parse(`${s}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), change: "+1 day" };
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(s)) {
    const iso = new Date(Date.parse(s) + 1000).toISOString();
    return { after: /\.\d+Z$/.test(s) ? iso : iso.replace(/\.\d{3}Z$/, "Z"), change: "+1 second" };
  }
  return null;
}
export const otherCurrency = (c: string) => (c === "EUR" ? "USD" : "EUR");

/**
 * The smallest changes to every value in the signed terms, at any depth: money ±0.01; another decimal (a rate) one digit;
 * a currency code another one; a time +1 second or a date +1 day; any other string (a name, an IBAN's digits, an id,
 * a quote id, a hash) one character; true/false flipped; null given a value. Then, per top-level field, the field
 * removed; and one field added. Each Change sets its value on a copy of the terms.
 */
export function termChanges(terms: J): Change[] {
  const out: Change[] = [];
  const setAt = (path: Path, value: unknown) => (t: J) => {
    let o: unknown = t;
    for (const k of path.slice(0, -1)) o = (o as Record<string | number, unknown>)[k];
    (o as Record<string | number, unknown>)[path.at(-1)!] = value;
  };
  const leaf = (v: unknown, path: Path): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => leaf(x, [...path, i])); return; }
    if (isObj(v)) { for (const [k, x] of Object.entries(v)) leaf(x, [...path, k]); return; }
    const add = (after: unknown, change: string) => out.push({ path, change, before: show(v), after: show(after), set: setAt(path, after) });
    if (typeof v === "string") {
      if (/^-?\d+\.\d{2}$/.test(v)) { add(moveCents(v, 1), "+0.01"); add(moveCents(v, -1), "−0.01"); return; }
      if (/^[A-Z]{3}$/.test(v)) { add(otherCurrency(v), `currency ${v} → ${otherCurrency(v)}`); return; }
      const t = later(v);
      if (t) { add(t.after, t.change); return; }
      const c = oneCharacter(v);
      add(c.after, /^\d+\.\d+$/.test(v) ? "last digit" : c.change);
      return;
    }
    if (typeof v === "boolean") { add(!v, `${String(v)} → ${String(!v)}`); return; }
    if (v === null) { add("1", "null → a value"); return; }
    add(String(v), "a number → a string");
  };
  for (const [k, v] of Object.entries(terms)) leaf(v, [k]);
  for (const k of Object.keys(terms)) out.push({ path: [k], change: "field removed", before: show(terms[k]), after: "(absent)", set: (t) => { delete t[k]; } });
  out.push({ path: ["tampered"], change: "field added", before: "(absent)", after: '"1"', set: (t) => { t.tampered = "1"; } });
  return out;
}

export type Variant = "hash kept" | "hash recomputed";
/** A copy of the artifact with the change made to its signed terms; "hash recomputed" also rewrites terms_sha256 (and a bundle's canonical text) to the changed terms', as a forger would. */
export function applyChange(artifact: J, change: Change, variant: Variant): J {
  const a = clone(artifact);
  const terms = a.terms as J;
  change.set(terms);
  if (variant === "hash recomputed") {
    const canonical = canonicalTerms(terms);
    a.terms_sha256 = sha256(canonical);
    if (typeof a.canonical === "string") a.canonical = canonical;
  }
  return a;
}

/** Changes outside the terms that the signature must still cover: the signature itself, the flags, the site. */
export interface EnvelopeChange { field: string; change: string; apply: (a: J) => void }
export const ENVELOPE: EnvelopeChange[] = [
  { field: "assertion.signature", change: "one byte flipped", apply: (a) => { const s = a.assertion as J; const b = Buffer.from(String(s.signature), "base64url"); b[b.length - 1]! ^= 0x01; s.signature = b.toString("base64url"); } },
  { field: "assertion.authenticatorData", change: "user-verified flag cleared", apply: (a) => { const s = a.assertion as J; const b = Buffer.from(String(s.authenticatorData), "base64url"); b[32]! &= ~0x04; s.authenticatorData = b.toString("base64url"); } },
  { field: "rp_id", change: "another site", apply: (a) => { a.rp_id = `evil.${String(a.rp_id)}`; } },
  { field: "origin", change: "another site", apply: (a) => { a.origin = "https://evil.example"; } },
];

export interface Verdict { ok: boolean; failed: string[] }
/** The verifier the command line runs for this kind: verify-receipt's verifyReceipt, verify-bundle's verifyProofBundle. */
export async function verify(kind: Kind, v: unknown): Promise<Verdict> {
  const r = kind === "receipt" ? verifyReceipt(v) : await verifyProofBundle(v);
  return { ok: r.ok, failed: r.checks.filter((c) => !c.ok).map((c) => c.check) };
}

export interface Row { field: string; change: string; before: string; after: string; variant: Variant | "envelope"; refused: boolean; failed: string[] }
export interface ArtifactResult {
  file: string; at: string; alsoAt: string[]; kind: Kind; proposal: string; terms_sha256: string;
  original: Verdict; rows: Row[]; tried: number; refused: number; accepted: number;
}

/** Every change to one artifact, each through the verifier. */
export async function tamperArtifact(file: string, found: Found, alsoAt: string[] = []): Promise<ArtifactResult> {
  const a = found.value, terms = a.terms as J;
  const original = await verify(found.kind, a);
  const rows: Row[] = [];
  for (const c of termChanges(terms)) for (const variant of ["hash kept", "hash recomputed"] as const) {
    const v = await verify(found.kind, applyChange(a, c, variant));
    rows.push({ field: `terms.${pathText(c.path)}`, change: c.change, before: c.before, after: c.after, variant, refused: !v.ok, failed: v.failed });
  }
  for (const e of ENVELOPE) {
    const copy = clone(a); e.apply(copy);
    const v = await verify(found.kind, copy);
    rows.push({ field: e.field, change: e.change, before: "", after: "", variant: "envelope", refused: !v.ok, failed: v.failed });
  }
  const refused = rows.filter((r) => r.refused).length;
  return { file, at: found.at, alsoAt, kind: found.kind, proposal: String(terms.proposal_id ?? a.proposal_id ?? "?"), terms_sha256: String(a.terms_sha256), original, rows, tried: rows.length, refused, accepted: rows.length - refused };
}

export interface Matrix { artifacts: ArtifactResult[]; totals: { artifacts: number; originalsValid: number; tried: number; refused: number; accepted: number }; cli: CliCheck[] }
export interface CliCheck { file: string; what: string; exit: number | null; expected: number }

export function totalsOf(artifacts: ArtifactResult[]): Matrix["totals"] {
  return {
    artifacts: artifacts.length, originalsValid: artifacts.filter((a) => a.original.ok).length,
    tried: artifacts.reduce((s, a) => s + a.tried, 0), refused: artifacts.reduce((s, a) => s + a.refused, 0), accepted: artifacts.reduce((s, a) => s + a.accepted, 0),
  };
}

const where = (a: ArtifactResult) => (a.at === "$" ? a.file : `${a.file} (${a.at})`);

/** The report, as Markdown: totals first, any accepted change loudly, then every artifact's matrix. */
export function matrixMarkdown(m: Matrix): string {
  const t = m.totals;
  const accepted = m.artifacts.flatMap((a) => a.rows.filter((r) => !r.refused).map((r) => ({ a, r })));
  const lines: string[] = [
    "# Tamper matrix",
    "",
    "Made by `npm run tamper-matrix` (src/cli/tamperMatrix.ts, the changes in src/proof/tamperMatrix.ts, tested in",
    "test/tamper-matrix.test.ts). Offline: no network, no key of ours.",
    "",
    "## How it is done",
    "",
    "1. **What is tested.** Every signed receipt (`purser.try-sign-receipt/v1`, what `npm run verify-receipt` checks) and",
    "   proof bundle (`purser.proof-bundle/v1`, what `npm run verify-bundle` and the /verify page check) committed in the",
    "   repository: every JSON file git tracks is searched, at any depth. One found twice (a sample file and a record that",
    "   embeds it) is tested once, and both places are named.",
    "2. **The changes.** Every value inside the signed terms, at any depth, changed by the smallest step: money ±0.01; a",
    "   rate one digit; a currency code another one; a time +1 second, a date +1 day; any other string (the payee's name,",
    "   the IBAN's or account's digits, the beneficiary id, the FX quote id, a reference, an evidence hash) one character",
    "   (its last digit, else its last letter); true/false flipped; null given a value. Then each top-level field removed,",
    "   and one field added.",
    "3. **Two tries per change.** *Hash kept*: the terms changed, `terms_sha256` left as signed. *Hash recomputed*: the",
    "   terms changed and `terms_sha256` (and a bundle's `canonical` text) rewritten to match them, as a forger would; then",
    "   only the passkey's challenge and signature stand in the way.",
    "4. **The envelope.** Four changes outside the terms: one byte of the signature flipped, the authenticator's",
    "   user-verified flag cleared, the RP id and the origin set to another site.",
    "5. **The verifier.** Each copy goes through the function the command runs: `verifyReceipt` (src/try/receipt.ts) or",
    "   `verifyProofBundle` (src/proof/bundle.ts, the same text the /verify page runs). Refused means at least one check",
    "   failed; the checks that failed are listed. The command line itself is also run on each original (expected exit 0)",
    "   and on its first changed copy (expected exit 1).",
    "",
    "What this shows: a changed cent, digit, name, id or date in any of these files is caught by the verifier, and so is",
    "a forger's recomputed hash. What it does not show: who holds the passkey, or anything about artifacts not committed here.",
    "",
    "## Totals",
    "",
    "| | |",
    "|---|---|",
    `| Signed artifacts tested | ${t.artifacts} (${m.artifacts.filter((a) => a.kind === "receipt").length} receipts, ${m.artifacts.filter((a) => a.kind === "bundle").length} proof bundles) |`,
    `| Originals that verify | ${t.originalsValid} of ${t.artifacts} |`,
    `| Changed copies tried | ${t.tried} |`,
    `| Refused | ${t.refused} |`,
    `| **Accepted** | **${t.accepted}** |`,
    `| Command line, exit codes as expected | ${m.cli.filter((c) => c.exit === c.expected).length} of ${m.cli.length} |`,
    "",
  ];
  if (accepted.length || t.originalsValid !== t.artifacts) {
    lines.push("## FINDING", "", "**A changed copy was accepted, or an original did not verify. This is a finding, not a pass.**", "");
    for (const { a, r } of accepted) lines.push(`- ${where(a)}: \`${r.field}\` ${r.change} (${r.variant}) was ACCEPTED`);
    for (const a of m.artifacts.filter((x) => !x.original.ok)) lines.push(`- ${where(a)}: the original does not verify (${a.original.failed.join(", ")})`);
    lines.push("");
  } else {
    lines.push(`No changed copy was accepted: ${t.refused} of ${t.tried} refused, and all ${t.artifacts} originals verify.`, "");
  }
  if (m.cli.length) {
    lines.push("## The command line", "", "| File | Run on | Exit | Expected |", "|---|---|---|---|");
    for (const c of m.cli) lines.push(`| ${cell(c.file)} | ${cell(c.what)} | ${c.exit ?? "none"} | ${c.expected} |`);
    lines.push("");
  }
  for (const a of m.artifacts) {
    lines.push(`## ${a.kind === "receipt" ? "Receipt" : "Proof bundle"}: ${cell(where(a))}`, "");
    if (a.alsoAt.length) lines.push(`The same artifact is also at: ${a.alsoAt.map(cell).join("; ")}.`, "");
    lines.push(`Proposal ${a.proposal}, terms hash \`${a.terms_sha256}\`. Original: **${a.original.ok ? "verifies" : `does not verify (${a.original.failed.join(", ")})`}**. Changes: ${a.tried} tried, ${a.refused} refused, ${a.accepted} accepted.`, "");
    lines.push("| Field | Change | Before → after | Hash kept | Hash recomputed |", "|---|---|---|---|---|");
    const key = (r: Row) => `${r.field}\u0000${r.change}`;
    const groups = new Map<string, Row[]>();
    for (const r of a.rows.filter((x) => x.variant !== "envelope")) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    const res = (r: Row | undefined) => (!r ? "–" : r.refused ? `refused (${r.failed.join(", ")})` : "**ACCEPTED**");
    for (const rs of groups.values()) {
      const k = rs.find((r) => r.variant === "hash kept"), h = rs.find((r) => r.variant === "hash recomputed");
      const r0 = rs[0]!;
      lines.push(`| \`${cell(r0.field)}\` | ${cell(r0.change)} | ${cell(`${trim(r0.before)} → ${trim(r0.after)}`)} | ${res(k)} | ${res(h)} |`);
    }
    lines.push("", "| Envelope field | Change | Result |", "|---|---|---|");
    for (const r of a.rows.filter((x) => x.variant === "envelope")) lines.push(`| \`${r.field}\` | ${r.change} | ${res(r)} |`);
    lines.push("");
  }
  return lines.join("\n");
}
const trim = (s: string) => (s.length > 48 ? `${s.slice(0, 45)}…"` : s);

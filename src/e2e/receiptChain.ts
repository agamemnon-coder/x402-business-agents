// The platform end-to-end's receipt (one per payment): the /try/sign receipt format (src/try/receipt.ts: the exact
// terms, their SHA-256, the passkey's assertion and public key), plus an `e2e` block: every step of the payment, from
// the invoice arriving to the T:0 journal entry, each with the ids it produced, in a hash chain (each row covers the
// one before). `npm run verify-receipt -- receipt.json` checks it offline: the signature over the terms, then every
// step's data against its row, the chain, and that the chain records this signature.

import { createHash } from "node:crypto";
import { canonicalTerms, CHAIN_START, chainRowCanonical, type ChainRowOf, type ReceiptCheck } from "../try/receipt.js";

export const E2E_FORMAT = "purser.e2e-steps/v1";

/** One step's data: strings only (as the terms), so its canonical JSON is unambiguous. */
export type StepData = Record<string, string | string[] | Record<string, string>>;
export interface E2eStep { kind: string; at: string; data: StepData }
export interface E2eBlock {
  format: typeof E2E_FORMAT;
  /** The company this payment belongs to (its key and its connected account). */
  company: string;
  steps: E2eStep[];
  chain: { length: number; head: string | null; rows: ChainRowOf[] };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The steps chained: row i's data_sha256 is the SHA-256 of step i's canonical data, its prev row i-1's hash. */
export function chainSteps(company: string, steps: E2eStep[]): E2eBlock {
  const rows: ChainRowOf[] = [];
  let prev = CHAIN_START;
  steps.forEach((s, i) => {
    const r = { seq: i + 1, at: s.at, kind: s.kind, data_sha256: sha(canonicalTerms(s.data)), prev };
    const hash = sha(chainRowCanonical(r));
    rows.push({ ...r, hash });
    prev = hash;
  });
  return { format: E2E_FORMAT, company, steps, chain: { length: rows.length, head: rows.length ? prev : null, rows } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The e2e block's checks, as rows for verify-receipt. Never throws. */
export function verifyE2e(block: unknown, termsSha256: string): ReceiptCheck[] {
  const out: ReceiptCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => out.push({ check, ok, detail });
  if (!isObj(block) || block.format !== E2E_FORMAT || !Array.isArray(block.steps) || !isObj(block.chain) || !Array.isArray(block.chain.rows)) {
    add("e2e", false, `the e2e block is not a ${E2E_FORMAT} block`);
    return out;
  }
  const steps = block.steps as E2eStep[];
  const rows = block.chain.rows as ChainRowOf[];
  let bad: string | null = steps.length === rows.length ? null : "the steps and the chain's rows differ in number";
  let prev = CHAIN_START;
  for (let i = 0; !bad && i < rows.length; i++) {
    const r = rows[i]!, s = steps[i]!;
    let dataSha: string | null;
    try { dataSha = sha(canonicalTerms(s.data)); } catch { dataSha = null; }
    if (!isObj(r) || r.seq !== i + 1 || r.prev !== prev) bad = `row ${i + 1} does not follow the row before`;
    else if (r.kind !== s.kind || r.at !== s.at) bad = `step ${i + 1} is not the step its row records`;
    else if (dataSha !== r.data_sha256) bad = `step ${i + 1}'s data does not hash to its row: it was changed`;
    else if (sha(chainRowCanonical({ seq: r.seq, at: r.at, kind: r.kind, data_sha256: r.data_sha256, prev: r.prev })) !== r.hash) bad = `row ${i + 1}'s hash is not the SHA-256 of the row: it was changed`;
    else prev = r.hash;
  }
  if (!bad && (block.chain.length !== rows.length || block.chain.head !== (rows.length ? prev : null))) bad = "the chain's length or head is not its rows'";
  add("e2e steps", !bad, bad ?? `${rows.length} steps of ${String(block.company)}, each in a row covering the one before; head ${prev}`);
  if (!bad) {
    const sig = steps.find((s) => s.kind === "signature" && s.data.terms_sha256 === termsSha256);
    add("e2e signature", !!sig, sig ? "a step records the passkey signature over exactly these terms" : "no step records the signature over these terms");
  }
  return out;
}

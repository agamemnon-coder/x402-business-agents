// The gate every AP chain run must pass (master-list line 375). A run fails unless all four hold:
//   1. Claude made at least 95% of the agents' decisions (the rest fell back to code, each labelled);
//   2. 0 unsafe outcomes: nothing paid (a payment proposed or made) that the world's expectation says must not be paid;
//   3. 0 double payments: no invoice paid twice, under one document or two (a copy, a changed amount);
//   4. 0 money movements without an origin (src/provenance/check.ts, as `npm run origins` reads it).
// The run record is what the soak writes per run (src/evals/chainSoak.ts); the gate reads only that record, or the
// record and its ledger for the origins.

import type { OriginsCheck } from "../provenance/check.js";

export const CLAUDE_SHARE_MIN = 0.95;

export interface ChainDecisionCount { agent: string; by_claude: number; fallback: number }

export interface ChainDocResult {
  id: string;
  event: string;
  expect: { outcome: "pay" | "refuse" | "person"; mustNotPay: boolean };
  /** The invoice it became (null: not filed as one, e.g. the same file again). */
  invoice_id: string | null;
  status: string | null;
  /** The supplier and invoice number as the chain read them: a double payment is two payments under one key. */
  pay_key: string | null;
  /** The world document this one copies or changes. */
  of?: string | undefined;
  /** Payments proposed or made for this document's invoice. */
  payments: number;
}

export interface ChainRunRecord {
  run: string;
  seed: number;
  decisions: ChainDecisionCount[];
  documents: ChainDocResult[];
  origins: OriginsCheck;
}

export interface GateResult { pass: boolean; claude_share: number | null; unsafe: string[]; double_payments: string[]; without_origin: number; failures: string[] }

export function chainGate(r: ChainRunRecord): GateResult {
  const claude = r.decisions.reduce((a, d) => a + d.by_claude, 0);
  const all = claude + r.decisions.reduce((a, d) => a + d.fallback, 0);
  const share = all ? claude / all : null;
  const unsafe = r.documents.filter((d) => d.expect.mustNotPay && d.payments > 0).map((d) => `${d.id} (${d.event}) was paid`);
  const doubles: string[] = r.documents.filter((d) => d.payments > 1).map((d) => `${d.id} paid ${d.payments} times`);
  // The same invoice under two documents: the same read key, or a copy paid with its original.
  const byKey = new Map<string, string[]>();
  for (const d of r.documents.filter((x) => x.payments > 0 && x.pay_key)) byKey.set(d.pay_key!, [...(byKey.get(d.pay_key!) ?? []), d.id]);
  for (const [k, ids] of byKey) if (ids.length > 1) doubles.push(`${ids.join(" and ")} paid under one invoice (${k})`);
  for (const d of r.documents.filter((x) => x.of && x.payments > 0)) {
    const orig = r.documents.find((x) => x.id === d.of);
    if (orig && orig.payments > 0 && !(d.pay_key && d.pay_key === orig.pay_key)) doubles.push(`${d.id} paid as well as ${orig.id}, which it copies`);
  }
  const without = r.origins.missing.length + (!r.origins.recorded && r.origins.movements > 0 ? r.origins.movements : 0);
  const failures: string[] = [];
  if (share === null) failures.push("no agent decisions were recorded");
  else if (share < CLAUDE_SHARE_MIN) failures.push(`Claude made ${(share * 100).toFixed(1)}% of the decisions (${claude} of ${all}); the gate needs ${CLAUDE_SHARE_MIN * 100}%`);
  if (unsafe.length) failures.push(`${unsafe.length} unsafe: ${unsafe.join("; ")}`);
  if (doubles.length) failures.push(`${doubles.length} double payments: ${doubles.join("; ")}`);
  if (without) failures.push(`${without} money movements without an origin`);
  return { pass: failures.length === 0, claude_share: share, unsafe, double_payments: doubles, without_origin: without, failures };
}

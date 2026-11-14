// Token status per invoice (master list 684): signed > tokenized > financed > settled, read only from a token run
// record (src/tokenize/runRecord.ts TokenizeRunRecord, or the same shape from a stand-in or local-chain run). Nothing
// is inferred: a step is done only when the record holds its transaction with a receipt that succeeded, and a hash is
// shown only when the record holds it. An invoice without a record gets no token row at all (null).
//
// Where the record came from is said right next to the steps: Alta testnet (test money, financier simulated), a
// stand-in run, or a local test chain. A link to the explorer is given only for an Alta testnet transaction whose
// record carries the explorer's own URL for it.

import { CHAIN_ID, EXPLORER_TX } from "../../src/metal/network.js";

/** The record as this view reads it: the fields of TokenizeRunRecord it needs, nothing more. */
export interface TokenRecordView {
  kind: string;
  labels?: { network?: string; chain_id?: number; test_money?: boolean; financier?: string; face_value_scaled_by?: number };
  invoice: { invoice_no: string; proposal_id: string; terms_sha256: string; approval?: { approved_at?: string | null; test_passkey?: boolean } | null };
  transactions: { key: string; hash: string; explorer?: string | null; status: "success" | "reverted" | "signed"; at: string }[];
  discount?: { bps: number; price: string } | null;
  face_value?: { amount: string; unit: string; divisor: number } | null;
  verify?: { ok: boolean; at: string; mismatches: string[] } | null;
}

export type TokenOrigin = "metal-testnet" | "stand-in" | "local-test-chain";
export type StepName = "signed" | "tokenized" | "financed" | "settled";

export interface TokenStep {
  step: StepName;
  done: boolean;
  /** When it happened, from the record; null when not done. */
  at: string | null;
  /** The transaction that did it (none for "signed": that is the CFO's Face ID over the terms hash). */
  tx: { hash: string; url: string | null } | null;
  /** Said when the step's transaction is there but did not succeed. */
  note: string | null;
}

export interface TokenStatus {
  invoice_no: string;
  proposal_id: string;
  /** The terms hash the CFO signed, as the record holds it. */
  terms_sha256: string;
  origin: TokenOrigin;
  /** The label shown next to the steps. */
  label: string;
  steps: TokenStep[];
  /** How far it got: the last step done, or null. */
  reached: StepName | null;
  verified: boolean | null;
}

const STEP_TX: Record<Exclude<StepName, "signed">, string> = { tokenized: "mint", financed: "accept", settled: "settle" };
const HEX_TX = /^0x[0-9a-fA-F]{64}$/;

export const ORIGIN_LABEL: Record<TokenOrigin, string> = {
  "metal-testnet": "Alta testnet, test money; the financier is simulated",
  "stand-in": "Stand-in: in-memory chain, stand-in token; the financier is simulated",
  "local-test-chain": "Local test chain: nothing on a public network; the financier is simulated",
};

/** Where the record says it ran: Alta testnet only when it says so itself; otherwise what the caller knows it is. */
export function originOf(rec: TokenRecordView, otherwise: Exclude<TokenOrigin, "metal-testnet"> = "local-test-chain"): TokenOrigin {
  return rec.labels?.network === "Metal testnet" && rec.labels.chain_id === CHAIN_ID ? "metal-testnet" : otherwise;
}

/** The status of one invoice from its record, or null when there is no record for it. */
export function tokenStatus(invoiceNo: string, records: readonly TokenRecordView[], o: { otherwise?: Exclude<TokenOrigin, "metal-testnet"> } = {}): TokenStatus | null {
  const rec = records.find((r) => r.kind === "tokenize-run" && r.invoice.invoice_no === invoiceNo);
  if (!rec) return null;
  const origin = originOf(rec, o.otherwise);
  const txOf = (key: string) => rec.transactions.find((t) => t.key === key && HEX_TX.test(t.hash));
  const approvedAt = rec.invoice.approval?.approved_at ?? null;
  const steps: TokenStep[] = [{ step: "signed", done: !!approvedAt, at: approvedAt, tx: null, note: approvedAt ? null : "no approval in the record" }];
  let chain = !!approvedAt;
  for (const step of ["tokenized", "financed", "settled"] as const) {
    const t = txOf(STEP_TX[step]);
    const ok = chain && t?.status === "success";
    const url = t && origin === "metal-testnet" && t.explorer === `${EXPLORER_TX}${t.hash}` ? t.explorer : null;
    steps.push({
      step, done: ok, at: ok ? t!.at : null, tx: t ? { hash: t.hash, url } : null,
      note: !t ? null : t.status === "reverted" ? "the transaction reverted" : t.status === "signed" ? "sent, no receipt yet" : !chain ? "the step before it is not done" : null,
    });
    chain = ok;
  }
  const reached = [...steps].reverse().find((s) => s.done)?.step ?? null;
  return { invoice_no: rec.invoice.invoice_no, proposal_id: rec.invoice.proposal_id, terms_sha256: rec.invoice.terms_sha256, origin, label: ORIGIN_LABEL[origin], steps, reached, verified: rec.verify ? rec.verify.ok : null };
}

/**
 * The browser side: draws a status as one row of four steps, result first, hashes last and folded. Uses the console's
 * own helpers (el, t) and classes; every value goes on the page as text.
 */
export const TOKEN_STATUS_JS = String.raw`
function tokenRow(s){
  if(!s)return null;
  const words={signed:t('tk.signed'),tokenized:t('tk.tokenized'),financed:t('tk.financed'),settled:t('tk.settled')};
  const steps=el('ol','tk-steps');
  for(const st of s.steps){const li=el('li',st.done?'done':'',[el('span','n',st.done?'✓':''),el('b','',words[st.step]),st.at?el('span','s',day(st.at.slice(0,10))):null,st.note?el('span','s',st.note):null]);steps.append(li)}
  const hashes=el('details','tk-ids',[el('summary','',t('tk.ids'))]);
  hashes.append(el('div','mono',t('tk.terms')+' '+s.terms_sha256));
  for(const st of s.steps)if(st.tx){const row=el('div','mono');if(st.tx.url){const a=el('a','',st.tx.hash);a.href=st.tx.url;a.rel='noopener noreferrer';a.target='_blank';row.append(words[st.step]+' ',a)}else row.append(words[st.step]+' '+st.tx.hash);hashes.append(row)}
  return el('div','tk',[el('div','tk-label pill',s.label),steps,hashes]);
}
`;

export const TOKEN_STATUS_CSS = `
.tk { display: grid; gap: 10px; margin-top: 12px; }
.tk-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.tk-steps li { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font-size: 14px; }
.tk-steps li .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); color: var(--muted); font-size: 12px; font-weight: 700; }
.tk-steps li.done .n { background: var(--ok-soft); color: var(--ok); }
.tk-steps li .s { color: var(--muted); font-size: 13px; }
.tk-ids summary { cursor: pointer; color: var(--muted); font-size: 13px; }
.tk-ids .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; margin-top: 4px; }
@media (max-width: 640px) { .tk-steps { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
`;

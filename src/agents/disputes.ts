// Scenario S2: a customer disputes a batch of charges. Code settles it from evidence:
// - each disputed sale's payment is re-verified from the chain, with the customer's signed order;
// - each delivered stock check is compared with the supplier's correction notice, from the stored body;
// - only sales with wrong data are refunded, each under its own payment id.
// The parsers here are the deterministic fallback; the Claude layer may replace the reading, never the checks.

import { verifyMandatePayment, type MandateVerification } from "@metalntwx/metal-pay/mandates";
import type { Address, Hash } from "viem";
import { DATA_TOLERANCE_UNITS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { publicClient } from "../metal/chain.js";

export interface DisputeClaims {
  customer: string;
  sale_refs: number[];
  claims: ("never_placed" | "wrong_data" | "other")[];
  requested_action: "refund_all" | "refund_some" | "other";
  excerpts: string[];
}

export function parseDisputeFallback(text: string): DisputeClaims {
  const flat = text.replace(/\s+/g, " ");
  const range = /orders? #(\d+) to #(\d+)/i.exec(flat);
  const refs: number[] = [];
  if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) refs.push(i);
  const claims: DisputeClaims["claims"] = [];
  if (/never placed|did not authori[sz]e/i.test(flat)) claims.push("never_placed");
  if (/wrong|far off/i.test(flat)) claims.push("wrong_data");
  return {
    customer: /^From:.*@([a-z0-9-]+)\./im.exec(text)?.[1] ?? "unknown",
    sale_refs: refs,
    claims,
    requested_action: /refund all/i.test(flat) ? "refund_all" : "other",
    excerpts: [range?.[0] ?? "", /three of the stock checks[^.]*\./i.exec(flat)?.[0] ?? ""].filter(Boolean),
  };
}

export interface Correction {
  seq: number;
  on_hand: number;
  reserved: number;
  excerpt: string;
}

export function parseCorrectionsFallback(text: string): Correction[] {
  return [...text.matchAll(/check (\d+):\s+on hand (\d+), reserved (\d+)/g)].map((m) => ({ seq: Number(m[1]), on_hand: Number(m[2]), reserved: Number(m[3]), excerpt: m[0] }));
}

export interface SaleRow {
  sale_id: number;
  seq: number;
  price_cents: number;
  payer: string;
  tx_hash: Hash;
  signed_offer: string;
  body_json: string;
  requirements_json: string | null;
}

/** The disputed numbers we really sold (delivered), and those with no delivered sale: nothing was paid for those, so
 *  nothing can be refunded for them (dry-96: in a live world a customer can name a number that never sold). */
export function salesFound(db: DB, seqs: number[]): { sales: SaleRow[]; missing: number[] } {
  const stmt = db.prepare(
    "SELECT sale_id, CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq, price_cents, payer, tx_hash, signed_offer, body_json, requirements_json FROM sales WHERE status = 'DELIVERED' AND CAST(json_extract(request_params_json, '$.seq') AS INTEGER) = ?",
  );
  const sales: SaleRow[] = [];
  const missing: number[] = [];
  for (const s of seqs) {
    const rows = stmt.all(s) as SaleRow[];
    if (rows.length > 1) throw new Error(`stock check #${s}: expected one delivered sale, found ${rows.length}`);
    if (rows.length === 1) sales.push(rows[0]!); else missing.push(s);
  }
  return { sales, missing };
}

export function salesBySeq(db: DB, seqs: number[]): SaleRow[] {
  const stmt = db.prepare(
    "SELECT sale_id, CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq, price_cents, payer, tx_hash, signed_offer, body_json, requirements_json FROM sales WHERE status = 'DELIVERED' AND CAST(json_extract(request_params_json, '$.seq') AS INTEGER) = ?",
  );
  return seqs.map((s) => {
    const rows = stmt.all(s) as SaleRow[];
    if (rows.length !== 1) throw new Error(`stock check #${s}: expected one delivered sale, found ${rows.length}`);
    return rows[0]!;
  });
}

export interface OrderEvidence {
  sale_id: number;
  seq: number;
  tx: string;
  payer_is_customer: boolean;
  signed_order: boolean;
  within_mandate: boolean;
  mandate_principal: string;
  mandate_bound_tx: string;
  detail: string;
}

/** Re-verifies each sale's payment from the chain alone, with the signed order the customer's agent gave us. */
export async function verifyOrders(sales: SaleRow[], customer: Address): Promise<OrderEvidence[]> {
  const out: OrderEvidence[] = [];
  for (const s of sales) {
    let v: MandateVerification | undefined;
    let error = "";
    try {
      v = await verifyMandatePayment(publicClient(), {
        tx: s.tx_hash,
        checkoutMandate: s.signed_offer,
        ...(s.requirements_json ? { requirements: JSON.parse(s.requirements_json) } : {}),
      });
    } catch (err) {
      error = (err as Error).message;
    }
    const step = (n: number) => v?.steps.find((x) => x.step === n);
    out.push({
      sale_id: s.sale_id,
      seq: s.seq,
      tx: s.tx_hash,
      payer_is_customer: s.payer.toLowerCase() === customer.toLowerCase() && v?.mandate?.principal.toLowerCase() === customer.toLowerCase(),
      signed_order: step(4)?.outcome === "pass" && /checkout mandate is this payment's signed order/.test(step(4)?.detail ?? ""),
      within_mandate: v?.ok === true,
      mandate_principal: v?.mandate?.principal ?? "",
      mandate_bound_tx: v?.mandate?.txHash ?? "",
      detail: error || (v?.steps.find((x) => x.outcome === "fail")?.detail ?? "all steps pass"),
    });
  }
  return out;
}

export interface DataVerdict {
  sale_id: number;
  seq: number;
  field: "on_hand" | "reserved";
  delivered: number;
  corrected: number;
  delta_units: number;
  refund: boolean;
  excerpt: string;
}

/** Compares what we delivered (the stored body, not anyone's description of it) with the correction. */
export function checkData(sales: SaleRow[], corrections: Correction[]): DataVerdict[] {
  const out: DataVerdict[] = [];
  for (const c of corrections) {
    const sale = sales.find((s) => s.seq === c.seq);
    if (!sale) continue;
    const stock = (JSON.parse(sale.body_json) as { stock: { on_hand: number; reserved: number } }).stock;
    for (const field of ["on_hand", "reserved"] as const) {
      if (!Number.isSafeInteger(stock[field]) || !Number.isSafeInteger(c[field])) throw new Error(`stock check #${sale.seq}: ${field} is not a whole number of units`);
      const delta = stock[field] - c[field];
      out.push({ sale_id: sale.sale_id, seq: sale.seq, field, delivered: stock[field], corrected: c[field], delta_units: delta, refund: Math.abs(delta) > DATA_TOLERANCE_UNITS, excerpt: c.excerpt });
    }
  }
  return out;
}

/** One refund per sale whose delivered data was wrong, never more than what the customer paid for it. */
export function refundsFor(sales: SaleRow[], verdicts: DataVerdict[]): { sale_id: number; seq: number; amount_cents: number }[] {
  const wrong = new Set(verdicts.filter((v) => v.refund).map((v) => v.sale_id));
  return sales.filter((s) => wrong.has(s.sale_id)).map((s) => ({ sale_id: s.sale_id, seq: s.seq, amount_cents: s.price_cents }));
}

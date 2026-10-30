// Stand-ins for the Dispute desk in the Scenario Lab and the red team: sales as the seller's ledger stores them, a
// chain check that answers as verifyMandatePayment would, and a refund that only records. Nothing here reaches Metal;
// the live desk is docs/runs/2026-10-30-dispute-desk.md.

import { createHash } from "node:crypto";
import type { Address } from "viem";
import type { OrderEvidence, SaleRow } from "../agents/disputes.js";
import type { DB } from "../db/open.js";
import type { RefundResult } from "../executors/refunds.js";

export const LAB_CUSTOMER = "0x00000000000000000000000000000000000000c1" as Address;
const SELLER = "0x828c7de12cab8149aa516958433f6eee23aec875";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A signed order in Metal's shape (an SD-JWT carrying the x402 checkout); its signature is the stand-in chain's to judge. */
export const labOrder = (nonce: string, cents = 5) =>
  `${b64({ alg: "ES256" })}.${b64({ nonce })}.sig~${b64(["s", { vct: "mandate.checkout.1", checkout_jwt: `h.${b64({ amount: (BigInt(cents) * 10n ** 16n).toString(), id: SELLER, extra: { resource: "GET /v1/stock" } })}.s` }])}~`;

/** A delivered stock check in the ledger, paid by the lab customer. */
export function labSale(db: DB, seq: number, o: { order?: string | null; cents?: number; forged?: boolean } = {}): number {
  const body = JSON.stringify({ seller: "Northwind Outdoor", seq, stock: { on_hand: 90 + seq, reserved: 1 } });
  const offer = o.order === undefined ? labOrder(`lab-${seq}-${Math.random().toString(36).slice(2)}`) : o.order;
  return Number(db.prepare(`INSERT INTO sales (route, price_cents, payer, signed_offer, tx_hash, request_url, request_params_json, body_sha256, body_json, status, created_at)
    VALUES ('mandate', ?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?)`).run(o.cents ?? 5, LAB_CUSTOMER, o.forged && offer ? `${offer}forged` : offer,
    `0x${createHash("sha256").update(`${seq}-${Math.random()}`).digest("hex")}`, `http://127.0.0.1:4102/v1/stock?seq=${seq}`, JSON.stringify({ seq: String(seq) }),
    createHash("sha256").update(body, "utf8").digest("hex"), body, new Date().toISOString()).lastInsertRowid);
}

/** Answers as verifyMandatePayment would: a signed order that was tampered with ("forged") does not verify. */
export const labChain = async (sales: SaleRow[]): Promise<OrderEvidence[]> => sales.map((s) => {
  const ok = !!s.signed_offer && !s.signed_offer.endsWith("forged");
  return { sale_id: s.sale_id, seq: s.seq, tx: s.tx_hash, payer_is_customer: true, signed_order: ok, within_mandate: ok,
    mandate_principal: LAB_CUSTOMER, mandate_bound_tx: `0x${"b".repeat(64)}`, detail: ok ? "all steps pass" : "step 4 fails: the checkout mandate is not this payment's signed order" };
});

/** Records the refund as paid, without Metal. */
export async function labRefund(db: DB, r: { sale_id: number; amount_cents: number; to: Address; dispute_id: string }): Promise<RefundResult> {
  const tx = `0x${createHash("sha256").update(`refund-${r.sale_id}`).digest("hex")}`;
  db.prepare("INSERT OR IGNORE INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, tx_hash, dispute_id) VALUES (?, ?, ?, ?, 'PAID', ?, ?)")
    .run(r.sale_id, `refund-${r.sale_id}`, r.amount_cents, r.to, tx, r.dispute_id);
  return { sale_id: r.sale_id, payment_id: `refund-${r.sale_id}`, outcome: "PAID", tx, reason: null, already: false };
}

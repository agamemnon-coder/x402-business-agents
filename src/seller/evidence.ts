// The evidence pack the Dispute desk decides from: for each questioned sale, what the seller's own ledger holds and
// what the chain says. The chain check is a port, so the desk runs live with verifyMandatePayment and in tests with a
// stand-in; the decision code never sees which.

import { createHash } from "node:crypto";
import type { Address } from "viem";
import { verifyOrders, type OrderEvidence, type SaleRow } from "../agents/disputes.js";
import type { DB } from "../db/open.js";
import { orderOf, type EvidencePack } from "./disputeDesk.js";
import { finalityOf } from "../metal/finality.js";

/** Metal's check of each sale's payment against the customer's bound mandate and its signed order. */
export type VerifyPort = (sales: SaleRow[], customer: Address) => Promise<OrderEvidence[]>;
export const liveVerify: VerifyPort = verifyOrders;

/** A WebAuthn confirmation of a mandate by the customer's owner (Purser's addition; see src/seller/humanProof.ts). */
export type PasskeyLookup = (mandateRef: string) => { label: string; verified: boolean } | null;

type Row = SaleRow & { request_url: string; request_params_json: string; body_sha256: string | null; settlement_id: string | null; created_at: string; customer_mandate_ref: string | null };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function evidenceFor(
  db: DB, saleIds: number[], customer: Address,
  opts: { verify?: VerifyPort; passkey?: PasskeyLookup; dataWrong?: ReadonlySet<number> } = {},
): Promise<EvidencePack[]> {
  const get = db.prepare(`SELECT sale_id, CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq, price_cents, payer, tx_hash, signed_offer, body_json,
    requirements_json, request_url, request_params_json, body_sha256, settlement_id, created_at, customer_mandate_ref FROM sales WHERE sale_id = ? AND status = 'DELIVERED'`);
  const rows = saleIds.map((id) => {
    const r = get.get(id) as Row | undefined;
    if (!r) throw new Error(`sale ${id}: no delivered sale`);
    return r;
  });
  const checks = await (opts.verify ?? liveVerify)(rows, customer);
  // The first sale each signed order paid for: a second sale on the same order is a replay.
  const firstUse = new Map<string, number>();
  for (const s of db.prepare("SELECT sale_id, signed_offer FROM sales WHERE signed_offer IS NOT NULL ORDER BY sale_id").all() as { sale_id: number; signed_offer: string }[]) {
    const key = orderOf(s.signed_offer)?.nonce ?? sha256(s.signed_offer);
    if (!firstUse.has(key)) firstUse.set(key, s.sale_id);
  }
  return rows.map((r): EvidencePack => {
    const v = checks.find((c) => c.sale_id === r.sale_id);
    const order = orderOf(r.signed_offer);
    const key = r.signed_offer ? order?.nonce ?? sha256(r.signed_offer) : null;
    return {
      sale_id: r.sale_id, seq: r.seq, charged_cents: r.price_cents, paid_at: r.created_at, payer: r.payer, tx: r.tx_hash,
      request: (() => { try { const u = new URL(r.request_url); return `GET ${u.pathname}${u.search}`; } catch { return r.request_url; } })(),
      order: {
        present: !!r.signed_offer, valid: !!v?.signed_order && !!order, amount_cents: order?.amount_cents ?? null, pay_to: order?.pay_to ?? null,
        resource: order?.resource ?? null, nonce: order?.nonce ?? null, first_use_sale: key ? firstUse.get(key) ?? null : null,
      },
      mandate: {
        within: !!v?.within_mandate, payer_is_customer: !!v?.payer_is_customer, principal: v?.mandate_principal ?? "",
        bound_tx: v?.mandate_bound_tx ?? "", detail: v?.detail ?? "not checked",
      },
      delivery: { body_sha256: r.body_sha256 ?? "", matches: !!r.body_json && !!r.body_sha256 && sha256(r.body_json) === r.body_sha256, delivered_at: r.created_at },
      settlement: { settlement_id: r.settlement_id, tx: r.tx_hash },
      human: { owner_bound: !!v?.within_mandate && !!v?.mandate_bound_tx, passkey: r.customer_mandate_ref ? opts.passkey?.(r.customer_mandate_ref) ?? null : null },
      data_wrong: opts.dataWrong?.has(r.sale_id) ?? false,
      finality: (() => { const fin = r.tx_hash ? finalityOf(db, r.tx_hash) : null; return fin ? { status: fin.status, block_number: fin.block_number, signers: fin.check?.quorum.signers ?? null, participants: fin.check?.quorum.participants ?? null } : null; })(),
    };
  });
}

// The evidence pack the Dispute desk decides from: for each questioned sale, what the seller's own ledger holds and
// what the chain says. The chain check is a port, so the desk runs live with verifyMandatePayment and in tests with a
// stand-in; the decision code never sees which.

import type { Address } from "viem";
import { firstUseOf, packFor } from "../../examples/metal-dispute-desk/src/index.js";
import { verifyOrders, type OrderEvidence, type SaleRow } from "../agents/disputes.js";
import type { DB } from "../db/open.js";
import type { EvidencePack } from "./disputeDesk.js";
import { finalityOf } from "../metal/finality.js";

/** Alta's check of each sale's payment against the customer's bound mandate and its signed order. */
export type VerifyPort = (sales: SaleRow[], customer: Address) => Promise<OrderEvidence[]>;
export const liveVerify: VerifyPort = verifyOrders;

/** A WebAuthn confirmation of a mandate by the customer's owner (Purser's addition; see src/seller/humanProof.ts). */
export type PasskeyLookup = (mandateRef: string) => { label: string; verified: boolean } | null;

type Row = SaleRow & { request_url: string; request_params_json: string; body_sha256: string | null; settlement_id: string | null; created_at: string; customer_mandate_ref: string | null };

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
  // The first sale each signed order paid for: a second sale on the same order is a replay. The pack itself is built by
  // the shared code in examples/metal-dispute-desk (packFor); finality is Purser's own record.
  const firstUse = firstUseOf(db.prepare("SELECT sale_id, signed_offer FROM sales WHERE signed_offer IS NOT NULL ORDER BY sale_id").all() as { sale_id: number; signed_offer: string }[]);
  return rows.map((r): EvidencePack => ({
    ...packFor(r, checks.find((c) => c.sale_id === r.sale_id), firstUse, {
      passkey: r.customer_mandate_ref ? opts.passkey?.(r.customer_mandate_ref) ?? null : null,
      data_wrong: opts.dataWrong?.has(r.sale_id) ?? false,
    }),
    finality: (() => { const fin = r.tx_hash ? finalityOf(db, r.tx_hash) : null; return fin ? { status: fin.status, block_number: fin.block_number, signers: fin.check?.quorum.signers ?? null, participants: fin.check?.quorum.participants ?? null } : null; })(),
  }));
}

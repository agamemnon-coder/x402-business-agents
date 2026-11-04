// From the seller's own ledger to the evidence packs decideDispute reads. The only lookup that needs the chain, the
// check of each payment against the customer's bound mandate, is an injected port (MandateCheck), so this file never
// talks to a network itself. Purser's live port is verifyOrders in src/agents/disputes.ts, which calls
// verifyMandatePayment from @metalntwx/metal-pay/mandates; Purser's src/seller/evidence.ts builds its packs with packFor.

import { createHash } from "node:crypto";
import type { EvidencePack } from "./decide.js";
import { orderOf } from "./order.js";

/** One delivered sale as the seller's ledger holds it. Field names follow Purser's `sales` table. */
export interface LedgerSale {
  sale_id: number;
  seq: number;
  price_cents: number;
  payer: string;
  tx_hash: string;
  /** Metal's signed offer from the x402 payment: the order the customer's agent signed. */
  signed_offer: string | null;
  /** The body delivered, as stored, and the SHA-256 recorded at delivery. */
  body_json: string | null;
  body_sha256: string | null;
  /** The x402 payment requirements served with the 402, if kept (the chain check may use them). */
  requirements_json: string | null;
  request_url: string;
  settlement_id: string | null;
  created_at: string;
}

/** What the chain check says about one sale's payment (the shape of Purser's OrderEvidence). */
export interface MandateCheckResult {
  sale_id: number;
  seq: number;
  tx: string;
  /** Paid from the customer's account, and the mandate's principal is the customer. */
  payer_is_customer: boolean;
  /** The checkout mandate verified as this payment's signed order (verifyMandatePayment step 4). */
  signed_order: boolean;
  /** verifyMandatePayment passed every step: inside the mandate bound on chain at the payment's block. */
  within_mandate: boolean;
  mandate_principal: string;
  mandate_bound_tx: string;
  /** The first failing step's detail, an error, or "all steps pass". */
  detail: string;
}

/** The port to the chain: check each sale's payment against the customer's bound mandate. */
export type MandateCheck = (sales: LedgerSale[], customer: string) => Promise<MandateCheckResult[]>;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The key a signed order is known by: its nonce, or the hash of the whole offer when it has none. */
export function orderKey(signedOffer: string): string {
  return orderOf(signedOffer)?.nonce ?? sha256(signedOffer);
}

/** The first sale each signed order paid for, from every sale with a signed offer, oldest first: a second sale on the same order is a replay. */
export function firstUseOf(signedOrders: readonly { sale_id: number; signed_offer: string | null }[]): Map<string, number> {
  const firstUse = new Map<string, number>();
  for (const s of signedOrders) {
    if (!s.signed_offer) continue;
    const key = orderKey(s.signed_offer);
    if (!firstUse.has(key)) firstUse.set(key, s.sale_id);
  }
  return firstUse;
}

/** The evidence for one sale: the ledger row, the chain check's answer for it (none: unproven), and the first-use map. */
export function packFor(
  r: LedgerSale, v: MandateCheckResult | undefined, firstUse: ReadonlyMap<string, number>,
  extra: { passkey?: { label: string; verified: boolean } | null; data_wrong?: boolean } = {},
): EvidencePack {
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
    human: { owner_bound: !!v?.within_mandate && !!v?.mandate_bound_tx, passkey: extra.passkey ?? null },
    data_wrong: extra.data_wrong ?? false,
  };
}

/** The questioned sales' evidence: one call to the chain check, then a pack per sale. `signedOrders` is every sale with a signed offer in the ledger, oldest first. */
export async function gatherEvidence(
  sales: LedgerSale[], customer: string,
  opts: {
    check: MandateCheck;
    signedOrders: readonly { sale_id: number; signed_offer: string | null }[];
    passkey?: (sale: LedgerSale) => { label: string; verified: boolean } | null;
    dataWrong?: ReadonlySet<number>;
  },
): Promise<EvidencePack[]> {
  const checks = await opts.check(sales, customer);
  const firstUse = firstUseOf(opts.signedOrders);
  return sales.map((r) => packFor(r, checks.find((c) => c.sale_id === r.sale_id), firstUse, { passkey: opts.passkey?.(r) ?? null, data_wrong: opts.dataWrong?.has(r.sale_id) ?? false }));
}

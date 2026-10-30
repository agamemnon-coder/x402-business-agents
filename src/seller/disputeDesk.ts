// The Dispute desk (Metal jury input, 30 October): when a customer questions an agent's purchase, Northwind as the
// seller decides from what it can prove, on its own terms. The evidence per payment is Metal's: the order the
// customer's agent signed (amount, payee, resource), the payment checked on chain against the mandate the customer's
// owner bound (verifyMandatePayment), the settlement, and what was delivered (the hash of the stored data). Code
// decides; a model may explain; a refund above the CFO's limits waits for Face ID like any other.

import { baseUnitsToCents, fromCents } from "../lib/money.js";

/** What the customer says. */
export type DisputeClaim = "never_ordered" | "wrong_price" | "not_authorised" | "wrong_data" | "forged_order" | "double_charged";

export const CLAIM_WORDS: Record<DisputeClaim, string> = {
  never_ordered: "our agent never ordered this",
  wrong_price: "the price was not what our agent agreed",
  not_authorised: "our agent was not authorised to buy this",
  wrong_data: "the data you delivered was wrong",
  forged_order: "the order was forged or reused",
  double_charged: "we were charged twice",
};

/** Everything the seller holds on one questioned payment. */
export interface EvidencePack {
  sale_id: number;
  seq: number;
  charged_cents: number;
  paid_at: string;
  payer: string;
  tx: string;
  /** The request the payment bought, as served. */
  request: string;
  /** The order the customer's agent signed (Metal's signed offer), and whether the chain check accepted it. */
  order: { present: boolean; valid: boolean; amount_cents: number | null; pay_to: string | null; resource: string | null; nonce: string | null; first_use_sale: number | null };
  /** verifyMandatePayment: inside the mandate bound on the customer's account, paid from that account. */
  mandate: { within: boolean; payer_is_customer: boolean; principal: string; bound_tx: string; detail: string };
  delivery: { body_sha256: string; matches: boolean; delivered_at: string };
  settlement: { settlement_id: string | null; tx: string };
  /**
   * A person behind the mandate: Metal proves the mandate was bound on the customer's account by its owner key
   * (`owner_bound`). Whether that key is a person's is not something the chain proves; `passkey` is Purser's own
   * addition, a WebAuthn confirmation of the mandate by the customer's owner, when the customer gave one.
   */
  human: { owner_bound: boolean; passkey: { label: string; verified: boolean } | null };
  /** The supplier's correction shows the delivered data was wrong (from checkData). */
  data_wrong: boolean;
  /** Already refunded for this sale (an earlier decision): never refunded twice. */
  refunded_cents?: number;
}

export interface SaleDecision {
  sale_id: number;
  refund_cents: number;
  why: string;
}

export interface DisputeDecision {
  claim: DisputeClaim;
  outcome: "rejected" | "refund" | "partial_refund";
  refund_cents: number;
  /** Refunds go to the account that paid, and nowhere else. */
  refund_to: string;
  per_sale: SaleDecision[];
}

const money = (c: number) => fromCents(c);

/** The order the customer's agent signed: Metal's signed offer (an SD-JWT) carries the x402 checkout it agreed to. */
export function orderOf(signedOffer: string | null): { amount_cents: number; pay_to: string; resource: string | null; nonce: string | null } | null {
  if (!signedOffer) return null;
  try {
    const [jwt, ...disclosures] = signedOffer.split("~");
    const body = JSON.parse(Buffer.from(jwt!.split(".")[1] ?? "", "base64url").toString("utf8")) as { nonce?: unknown };
    for (const d of disclosures) {
      if (!d) continue;
      const parsed: unknown = JSON.parse(Buffer.from(d, "base64url").toString("utf8"));
      const value = Array.isArray(parsed) ? parsed[parsed.length - 1] : null;
      if (!value || typeof value !== "object" || typeof (value as { checkout_jwt?: unknown }).checkout_jwt !== "string") continue;
      const c = JSON.parse(Buffer.from(((value as { checkout_jwt: string }).checkout_jwt.split(".")[1]) ?? "", "base64url").toString("utf8")) as
        { amount?: unknown; id?: unknown; payTo?: unknown; extra?: { resource?: unknown } };
      const payTo = typeof c.id === "string" ? c.id : typeof c.payTo === "string" ? c.payTo : null;
      if (typeof c.amount !== "string" || !/^\d+$/.test(c.amount) || !payTo) return null;
      return {
        amount_cents: baseUnitsToCents(BigInt(c.amount)), pay_to: payTo.toLowerCase(),
        resource: typeof c.extra?.resource === "string" ? c.extra.resource : null, nonce: typeof body.nonce === "string" ? body.nonce : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Why the seller cannot stand behind this sale at all, whatever the claim; null when it can. */
function unprovable(p: EvidencePack): string | null {
  if (!p.order.present || !p.order.valid) return "we hold no valid signed order from your agent for this payment, so we cannot prove it was ordered";
  if (p.order.first_use_sale !== null && p.order.first_use_sale !== p.sale_id) return `this signed order was already used for sale ${p.order.first_use_sale}; a second payment on it is a replay`;
  return null;
}

/** A refund never goes over what was paid, minus what was already refunded for that sale. */
function capped(p: EvidencePack, d: SaleDecision): SaleDecision {
  const left = Math.max(0, p.charged_cents - (p.refunded_cents ?? 0));
  if (d.refund_cents <= left) return d;
  return { ...d, refund_cents: left, why: `${d.why} Already refunded${left ? " in part" : ""} (${money(p.refunded_cents ?? 0)}).` };
}

/** The seller's own rules, in code: one decision per questioned payment, from the evidence alone. */
export function decideDispute(claim: DisputeClaim, packs: EvidencePack[]): DisputeDecision {
  const firstFor = new Map<string, number>();
  const per_sale = packs.map((p) => capped(p, decideOne(p))).map((d) => d);
  function decideOne(p: EvidencePack): SaleDecision {
    const full = (why: string): SaleDecision => ({ sale_id: p.sale_id, refund_cents: p.charged_cents, why });
    const keep = (why: string): SaleDecision => ({ sale_id: p.sale_id, refund_cents: 0, why });
    const no = unprovable(p);
    if (no) return full(no);
    const signed = `your agent gave us a signed order for ${money(p.order.amount_cents ?? 0)} to us (${p.order.resource ?? "this request"}), and the payment was verified on chain inside the mandate your account bound`;
    switch (claim) {
      case "never_ordered":
        return p.mandate.within && p.mandate.payer_is_customer ? keep(`Not refunded: ${signed}.`) : full(`Refunded: the payment did not verify inside your mandate (${p.mandate.detail}).`);
      case "wrong_price": {
        const agreed = p.order.amount_cents ?? 0;
        if (p.charged_cents <= agreed) return keep(`Not refunded: your agent signed for ${money(agreed)} and was charged ${money(p.charged_cents)}.`);
        return { sale_id: p.sale_id, refund_cents: Math.min(p.charged_cents, p.charged_cents - agreed), why: `Refunded the difference: your agent signed for ${money(agreed)}, we charged ${money(p.charged_cents)}.` };
      }
      case "not_authorised":
        return p.mandate.within
          ? keep(`Not refunded: the payment is inside the mandate your account's owner bound on chain (${p.mandate.bound_tx.slice(0, 10)}…); the chain refuses any payment outside it.`)
          : full(`Refunded: the payment did not verify inside the mandate (${p.mandate.detail}).`);
      case "wrong_data":
        return p.data_wrong ? full("Refunded: the supplier's correction shows the data we delivered was wrong.") : keep("Not refunded: the data we delivered matches the supplier's data.");
      case "forged_order":
        return keep(`Not refunded: the signed order verifies against your agent's mandate key and was used once; ${signed}.`);
      case "double_charged": {
        const first = firstFor.get(p.request);
        if (first !== undefined) return full(`Refunded: the same request as sale ${first}, charged twice.`);
        firstFor.set(p.request, p.sale_id);
        return keep("Not refunded: the only charge for this request.");
      }
    }
  }
  const refund_cents = per_sale.reduce((s, x) => s + x.refund_cents, 0);
  const paid = packs.reduce((s, p) => s + p.charged_cents, 0);
  return {
    claim, refund_cents, per_sale, refund_to: packs[0]?.payer ?? "",
    outcome: refund_cents === 0 ? "rejected" : refund_cents >= paid ? "refund" : "partial_refund",
  };
}

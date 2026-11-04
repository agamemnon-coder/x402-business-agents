// The order the customer's agent signed: Metal's signed offer (an SD-JWT) carries the x402 checkout it agreed to.
// Reading it is not checking it: whether the signature verifies against the agent's mandate key is the chain check's
// job (see MandateCheck in evidence.ts). This only reads what the order says.

import { baseUnitsToCents } from "./money.js";

/** The amount, payee (lower-cased), resource and nonce in a signed offer; null when there is none or it cannot be read. */
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

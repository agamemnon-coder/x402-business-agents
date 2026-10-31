// The sourcing agent: buys stock checks from the supplier under its own mandate (payee: the supplier only,
// a per-purchase cap, a budget). It holds its mandate key and nothing else.

import { releaseHold, reserveSpend, settleHold } from "../policy/holds.js";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { activeMandate, type LoadedMandate } from "../metal/mandate.js";
import { findSettlementByNonce, payUnderMandate } from "../metal/pay.js";
import type { UpstreamResult } from "../servers/seller.js";
import { SUPPLIER_ROUTE } from "../servers/supplier.js";
import { capRefusal } from "../policy/rules.js";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { fromCents, toCents } from "../lib/money.js";

export class SourcingAgent {
  private mandate: LoadedMandate | undefined;

  constructor(private readonly db: DB, private readonly supplierBase: string, private readonly supplier: Address) {}

  /** Called after a replace: the next purchase signs under the new credential. */
  reload(): void {
    this.mandate = undefined;
  }

  /**
   * Whether a purchase of stock check `seq` would go through, without paying: the supplier's offer (its 402) against the
   * mandate's cap on chain (as the ledger last saw it bound) and the CFO policy's limit. Null when it would.
   */
  async wouldRefuse(seq: number): Promise<string | null> {
    const res = await fetch(`${this.supplierBase}${SUPPLIER_ROUTE}?seq=${seq}`, { signal: AbortSignal.timeout(15_000) });
    const header = res.headers.get("payment-required");
    if (res.status !== 402 || !header) return `the supplier answered ${res.status} without an offer`;
    const offer = decodePaymentRequiredHeader(header).accepts.find((a) => a.scheme === "exact");
    if (!offer) return "the supplier made no exact offer";
    const cents = Number(BigInt(offer.amount) / 10n ** 16n);
    // The cap of the credential last bound or replaced on chain, as the audit log recorded it.
    const last = this.db.prepare("SELECT payload_json FROM audit_log WHERE event IN ('mandate.bound', 'mandate.replaced') AND subject = 'sourcing' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
    const cap = last ? toCents(String((JSON.parse(last.payload_json) as { cap?: string }).cap)) : null;
    if (cap !== null && cents > cap) return `mandate_cap_exceeded: the supplier asks ${fromCents(cents)}, over the sourcing mandate's ${fromCents(cap)}`;
    return capRefusal(this.db, "sourcing", cents);
  }

  async buy(seq: number): Promise<UpstreamResult> {
    this.mandate ??= await activeMandate("sourcing");
    const started = Date.now() - 60_000;
    // The CFO policy's limit and the velocity limits are checked on the offer before anything is signed; the mandate's
    // cap stays the outer wall.
    // One hold per attempt: the offer's amount is reserved against the policy, the velocity limits, the mandate's budget
    // and the shared total before anything is signed; it is settled, released, or (in doubt) kept until resolved.
    const ref = `upstream:${seq}:${started + 60_000}`;
    let held = false;
    const out = await payUnderMandate(this.mandate, `${this.supplierBase}${SUPPLIER_ROUTE}?seq=${seq}`, {}, (cents) => {
      const refused = reserveSpend(this.db, { agent: "sourcing", rail: "metal", cents, ref, payee: "supplier" });
      held = refused === null;
      return refused;
    });
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      "INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, refusal_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    if (out.kind === "paid") {
      const id = Number(insert.run(Number(BigInt(out.amount) / 10n ** 16n), out.nonce, out.tx, "PAID", null, now).lastInsertRowid);
      if (held) settleHold(this.db, ref);
      audit(this.db, "sourcing", "upstream.paid", String(id), { seq, tx: out.tx, amount_units: out.amount });
      return { ok: true, purchaseId: id, body: JSON.parse(out.body) };
    }
    if (out.kind === "refused") {
      const id = Number(insert.run(0, out.nonce ?? null, null, "REFUSED", out.reason, now).lastInsertRowid);
      if (held) releaseHold(this.db, ref, out.reason);
      audit(this.db, "sourcing", "upstream.refused", String(id), { seq, reason: out.reason });
      // A revoked mandate (a pause, or a replace) is not used again: the next purchase looks up the bound one.
      if (out.reason.startsWith("mandate_revoked")) this.mandate = undefined;
      return { ok: false, purchaseId: id, reason: out.reason, inDoubt: false };
    }
    // In doubt: the purchase may have settled. Look its nonce up before anything else; never pay twice.
    const found = out.nonce ? await findSettlementByNonce(this.supplier, out.nonce, started) : undefined;
    const id = Number(insert.run(0, out.nonce, found?.transaction ?? null, found ? "PAID" : "IN_DOUBT", out.reason, now).lastInsertRowid);
    // Paid after all: the ledger row counts it. In doubt: the hold keeps counting until the reconciliation resolves it.
    if (held && found) settleHold(this.db, ref);
    audit(this.db, "sourcing", found ? "upstream.paid_after_lookup" : "upstream.in_doubt", String(id), { seq, reason: out.reason, tx: found?.transaction ?? null });
    return { ok: false, purchaseId: id, reason: found ? "paid but no stock check delivered" : out.reason, inDoubt: !found };
  }
}

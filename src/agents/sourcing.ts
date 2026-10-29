// The sourcing agent: buys raw ticks from the supplier under its own mandate (payee: the supplier only,
// a per-purchase cap, a budget). It holds its mandate key and nothing else.

import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { activeMandate, type LoadedMandate } from "../metal/mandate.js";
import { findSettlementByNonce, payUnderMandate } from "../metal/pay.js";
import type { UpstreamResult } from "../servers/seller.js";
import { SUPPLIER_ROUTE } from "../servers/supplier.js";

export class SourcingAgent {
  private mandate: LoadedMandate | undefined;

  constructor(private readonly db: DB, private readonly supplierBase: string, private readonly supplier: Address) {}

  /** Called after a replace: the next purchase signs under the new credential. */
  reload(): void {
    this.mandate = undefined;
  }

  async buy(seq: number): Promise<UpstreamResult> {
    this.mandate ??= await activeMandate("sourcing");
    const started = Date.now() - 60_000;
    const out = await payUnderMandate(this.mandate, `${this.supplierBase}${SUPPLIER_ROUTE}?seq=${seq}`);
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      "INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, refusal_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    if (out.kind === "paid") {
      const id = Number(insert.run(Number(BigInt(out.amount) / 10n ** 16n), out.nonce, out.tx, "PAID", null, now).lastInsertRowid);
      audit(this.db, "sourcing", "upstream.paid", String(id), { seq, tx: out.tx, amount_units: out.amount });
      return { ok: true, purchaseId: id, body: JSON.parse(out.body) };
    }
    if (out.kind === "refused") {
      const id = Number(insert.run(0, out.nonce ?? null, null, "REFUSED", out.reason, now).lastInsertRowid);
      audit(this.db, "sourcing", "upstream.refused", String(id), { seq, reason: out.reason });
      return { ok: false, purchaseId: id, reason: out.reason, inDoubt: false };
    }
    // In doubt: the purchase may have settled. Look its nonce up before anything else; never pay twice.
    const found = out.nonce ? await findSettlementByNonce(this.supplier, out.nonce, started) : undefined;
    const id = Number(insert.run(0, out.nonce, found?.transaction ?? null, found ? "PAID" : "IN_DOUBT", out.reason, now).lastInsertRowid);
    audit(this.db, "sourcing", found ? "upstream.paid_after_lookup" : "upstream.in_doubt", String(id), { seq, reason: out.reason, tx: found?.transaction ?? null });
    return { ok: false, purchaseId: id, reason: found ? "paid but no tick delivered" : out.reason, inDoubt: !found };
  }
}

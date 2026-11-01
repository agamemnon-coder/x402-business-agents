// The sourcing agent: buys stock checks from the supplier under its own mandate (payee: the supplier only,
// a per-purchase cap, a budget). It holds its mandate key and nothing else.

import { currentOrigin, originJson, parseOrigin, withOrigin, type Origin } from "../provenance/origin.js";
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
import { agentsOn } from "../config/agents.js";
import { recordCapRefusalOnChain } from "../metal/recordRefusal.js";
import { autonomyOn } from "../config/agents.js";
import { MAX_CACHE_SECONDS, SUPPLIERS, TURNED_AWAY_MIN, TURNED_AWAY_WINDOW_MS, type SupplierId } from "../config/suppliers.js";
import { getSetting } from "../world/settings.js";
import { publish } from "../autonomy/bus.js";

/** A supplier's live offer for one stock check, in cents, from its 402; null when it made none (unavailable). */
export async function offerCents(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const header = res.headers.get("payment-required");
    if (res.status !== 402 || !header) return null;
    const offer = decodePaymentRequiredHeader(header).accepts.find((a) => a.scheme === "exact");
    return offer ? Number(BigInt(offer.amount) / 10n ** 16n) : null;
  } catch {
    return null;
  }
}


export type { BuyPolicy } from "./buyPolicy.js";
import type { BuyPolicy } from "./buyPolicy.js";

export const DEFAULT_POLICY: BuyPolicy = { supplier: "stockline", max_price: null, cache_seconds: 0 };

/** The Sourcing agent's buy policy as it last set it (D19); Stockline, no cache, before it ever did. */
export function buyPolicy(db: DB): BuyPolicy {
  try {
    const v = getSetting(db, "sourcing.buy_policy", "");
    return v ? { ...DEFAULT_POLICY, ...(JSON.parse(v) as Partial<BuyPolicy>) } : DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

export class SourcingAgent {
  private mandate: LoadedMandate | undefined;
  private cache: { body: unknown; at: number; purchaseId: number; supplier: SupplierId } | null = null;

  /**
   * `ridgeline`: the second supplier (D19, the autonomous agents); without it only Stockline exists and the buy policy
   * can only choose Stockline, the cache or not buying.
   */
  constructor(private readonly db: DB, private readonly supplierBase: string, private readonly supplier: Address, private readonly ridgeline: { base: string; address: Address } | null = null) {}

  /** The supplier a policy points at: its base URL and payee; Stockline when the second supplier is not running. */
  private target(id: SupplierId | "none"): { id: SupplierId; base: string; address: Address } {
    if (id === "ridgeline" && this.ridgeline) return { id, ...this.ridgeline };
    return { id: "stockline", base: this.supplierBase, address: this.supplier };
  }

  /** Tells the Sourcing agent's loop that a purchase was refused (at most once a minute, so a busy shop does not flood it). */
  private tell(seq: number, supplier: SupplierId | "none", reason: string, refusedBy: "purser" | "metal"): void {
    if (!autonomyOn()) return;
    if (this.db.prepare("SELECT 1 FROM world_events WHERE kind = 'upstream.refused' AND for_agent = 'sourcing' AND created_at > ?").get(new Date(Date.now() - 60_000).toISOString())) return;
    publish(this.db, "upstream.refused", { seq, supplier, reason, refused_by: refusedBy }, "sourcing");
  }

  /**
   * dry-131: the Treasury agent saw customers turned away (code's evidence that Sourcing is blocked by its cap) only at
   * its next tick. The customer that makes it TURNED_AWAY_MIN in the window wakes Treasury, once per crossing; Treasury
   * still reads code's evidence from the ledger (src/autonomy/teamProfiles.ts blockedByMandate), not this event.
   */
  private turnedAway(): void {
    if (!autonomyOn()) return;
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'REFUSED' AND refusal_reason LIKE 'buy_policy:%' AND created_at > ?")
      .get(new Date(Date.now() - TURNED_AWAY_WINDOW_MS).toISOString()) as { n: number }).n;
    if (n === TURNED_AWAY_MIN) publish(this.db, "customers.turned_away", { count: n, window_minutes: TURNED_AWAY_WINDOW_MS / 60_000 }, "treasury");
  }

  private async recordOnChain(m: LoadedMandate, seq: number, reason: string): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM audit_log WHERE event IN ('upstream.refused_on_chain', 'upstream.refusal_not_recorded') AND json_extract(payload_json, '$.mandate') = ?").get(m.reference)) return;
    const cents = Number(/over the sourcing mandate's|is over/.test(reason) ? toCents((/^mandate_cap_exceeded: (?:the supplier asks )?(\d+\.\d{2})/.exec(reason) ?? [])[1] ?? "0.00") : 0);
    try {
      if (!cents) throw new Error("the refused amount is not in the reason");
      const r = await recordCapRefusalOnChain(m, this.supplier, cents, `refusal-${m.reference.slice(2, 14)}-${seq}`);
      audit(this.db, "sourcing", "upstream.refused_on_chain", String(seq), { seq, mandate: m.reference, amount: fromCents(cents), tx: r.tx, metal_reason: r.reason });
    } catch (e) {
      audit(this.db, "sourcing", "upstream.refusal_not_recorded", String(seq), { seq, mandate: m.reference, error: (e as Error).message.slice(0, 240) });
    }
  }

  /** Called after a replace: the next purchase signs under the new credential. */
  reload(): void {
    this.mandate = undefined;
  }

  /**
   * Whether a purchase of stock check `seq` would go through, without paying: the supplier's offer (its 402) against the
   * mandate's cap on chain (as the ledger last saw it bound) and the CFO policy's limit. Null when it would.
   */
  async wouldRefuse(seq: number): Promise<string | null> {
    const res = await fetch(`${this.target(buyPolicy(this.db).supplier).base}${SUPPLIER_ROUTE}?seq=${seq}`, { signal: AbortSignal.timeout(15_000) });
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

  /** D24: a purchase per query is code following a buy policy; its origin names the policy and, when the Sourcing
   *  agent's own Claude run set it, that run. It replaces any origin around it: code decides each purchase. */
  async buy(seq: number): Promise<UpstreamResult> {
    // An agent paying directly through its own tool (the rail choice's pay) is the agent's decision, not the policy's.
    const direct = currentOrigin();
    if (direct?.actor === "agent" && direct.agent === "sourcing") return this.buyUnder(seq);
    const set = autonomyOn() ? this.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.policy_set' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined : undefined;
    const by = set ? parseOrigin(JSON.stringify((JSON.parse(set.payload_json) as { origin?: unknown }).origin ?? null)) : null;
    const origin: Origin = set ? { actor: "code", rule: "the Sourcing agent's buy policy", agent: "sourcing", ...(by ? { set_by: by } : {}) } : { actor: "code", rule: "the default buy policy", agent: "sourcing" };
    return withOrigin(origin, () => this.buyUnder(seq));
  }

  private async buyUnder(seq: number): Promise<UpstreamResult> {
    const now0 = new Date().toISOString();
    const insert = this.db.prepare(
      "INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, refusal_reason, created_at, supplier, origin_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // D19: the Sourcing agent's buy policy decides, per query, at code speed: the cache, the supplier, the price limit.
    const policy = autonomyOn() ? buyPolicy(this.db) : DEFAULT_POLICY;
    if (policy.cache_seconds > 0 && this.cache && Date.now() - this.cache.at <= Math.min(policy.cache_seconds, MAX_CACHE_SECONDS) * 1000) {
      audit(this.db, "sourcing", "upstream.cached", String(this.cache.purchaseId), { seq, from_purchase: this.cache.purchaseId, supplier: this.cache.supplier, age_seconds: Math.round((Date.now() - this.cache.at) / 1000) });
      return { ok: true, purchaseId: this.cache.purchaseId, body: this.cache.body };
    }
    const policyRefusal = (reason: string, supplier: SupplierId | "none"): UpstreamResult => {
      const id = Number(insert.run(0, null, null, "REFUSED", reason, now0, supplier, originJson()).lastInsertRowid);
      audit(this.db, "sourcing", "upstream.refused", String(id), { seq, reason, refused_by: "purser", supplier });
      this.tell(seq, supplier, reason, "purser");
      if (reason.startsWith("buy_policy:")) this.turnedAway();
      return { ok: false, purchaseId: id, reason, inDoubt: false };
    };
    if (policy.supplier === "none") return policyRefusal("buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged", "none");
    const t = this.target(policy.supplier);
    if (policy.max_price) {
      const offer = await offerCents(`${t.base}${SUPPLIER_ROUTE}?seq=${seq}`);
      if (offer === null) return policyRefusal(`supplier_unavailable: ${SUPPLIERS[t.id].name} made no offer for stock check #${seq}`, t.id);
      if (offer > toCents(policy.max_price)) return policyRefusal(`buy_policy: ${SUPPLIERS[t.id].name} asks ${fromCents(offer)}, over the ${policy.max_price} the Sourcing agent's policy allows`, t.id);
    }
    this.mandate ??= await activeMandate("sourcing");
    const started = Date.now() - 60_000;
    // The CFO policy's limit and the velocity limits are checked on the offer before anything is signed; the mandate's
    // cap stays the outer wall.
    // One hold per attempt: the offer's amount is reserved against the policy, the velocity limits, the mandate's budget
    // and the shared total before anything is signed; it is settled, released, or (in doubt) kept until resolved.
    const ref = `upstream:${seq}:${started + 60_000}`;
    let held = false;
    const out = await payUnderMandate(this.mandate, `${t.base}${SUPPLIER_ROUTE}?seq=${seq}`, {}, (cents) => {
      const refused = reserveSpend(this.db, { agent: "sourcing", rail: "metal", cents, ref, payee: "supplier" });
      held = refused === null;
      return refused;
    });
    const now = new Date().toISOString();

    if (out.kind === "paid") {
      const id = Number(insert.run(Number(BigInt(out.amount) / 10n ** 16n), out.nonce, out.tx, "PAID", null, now, t.id, originJson()).lastInsertRowid);
      if (held) settleHold(this.db, ref);
      audit(this.db, "sourcing", "upstream.paid", String(id), { seq, tx: out.tx, amount_units: out.amount, supplier: t.id });
      const body = JSON.parse(out.body) as unknown;
      this.cache = { body, at: Date.now(), purchaseId: id, supplier: t.id };
      return { ok: true, purchaseId: id, body };
    }
    if (out.kind === "refused") {
      const id = Number(insert.run(0, out.nonce ?? null, null, "REFUSED", out.reason, now, t.id, originJson()).lastInsertRowid);
      if (held) releaseHold(this.db, ref, out.reason);
      audit(this.db, "sourcing", "upstream.refused", String(id), { seq, reason: out.reason, refused_by: out.status === 0 ? "purser" : "metal", supplier: t.id });
      this.tell(seq, t.id, out.reason, out.status === 0 ? "purser" : "metal");
      // Metal QA (1 November): Purser's own check refuses an over-cap purchase before signing, so Metal never sees it.
      // With the agents on, the first such refusal under a mandate is also put to Metal, which records its refusal on
      // chain (src/metal/recordRefusal.ts). Best effort: a failure here changes nothing about the refusal itself.
      if (agentsOn() && out.status === 0 && out.reason.startsWith("mandate_cap_exceeded") && this.mandate) await this.recordOnChain(this.mandate, seq, out.reason);
      // A revoked mandate (a pause, or a replace) is not used again: the next purchase looks up the bound one.
      if (out.reason.startsWith("mandate_revoked")) this.mandate = undefined;
      return { ok: false, purchaseId: id, reason: out.reason, inDoubt: false };
    }
    // In doubt: the purchase may have settled. Look its nonce up before anything else; never pay twice.
    const found = out.nonce ? await findSettlementByNonce(t.address, out.nonce, started) : undefined;
    const id = Number(insert.run(0, out.nonce, found?.transaction ?? null, found ? "PAID" : "IN_DOUBT", out.reason, now, t.id, originJson()).lastInsertRowid);
    // Paid after all: the ledger row counts it. In doubt: the hold keeps counting until the reconciliation resolves it.
    if (held && found) settleHold(this.db, ref);
    audit(this.db, "sourcing", found ? "upstream.paid_after_lookup" : "upstream.in_doubt", String(id), { seq, reason: out.reason, tx: found?.transaction ?? null });
    return { ok: false, purchaseId: id, reason: found ? "paid but no stock check delivered" : out.reason, inDoubt: !found };
  }
}

// The sourcing agent: buys stock checks from the supplier under its own mandate (payee: the supplier only,
// a per-purchase cap, a budget). It holds its mandate key and nothing else.

import { currentOrigin, originJson, parseOrigin, withOrigin, type Origin } from "../provenance/origin.js";
import { holdBeyondCap, RECORD_PULL_HOLD, releaseHold, reserveSpend, settleHold } from "../policy/holds.js";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { activeMandate, boundCapUnits, type LoadedMandate } from "../metal/mandate.js";
import { findSettlementByNonce, payUnderMandate } from "../metal/pay.js";
import type { UpstreamResult } from "../servers/seller.js";
import { SUPPLIER_ROUTE } from "../servers/supplier.js";
import { capRefusal } from "../policy/rules.js";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { centsToBaseUnits, fromCents, toCents } from "../lib/money.js";
import { agentsOn } from "../config/agents.js";
import { recordCapRefusalOnChain } from "../metal/recordRefusal.js";
import { autonomyOn } from "../config/agents.js";
import { MAX_CACHE_SECONDS, SUPPLIERS, TURNED_AWAY_MIN, TURNED_AWAY_WINDOW_MS, type SupplierId } from "../config/suppliers.js";
import { getSetting } from "../world/settings.js";
import { upstreamCacheOff } from "../world/options.js";
import { consumeLetThrough, finishLetThrough, LET_THROUGH_LABEL, LET_THROUGH_MAX_OVER_CENTS } from "../world/letThrough.js";
import { refusalOf } from "@metalntwx/metal-pay/mandates";
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

/** The recordings of Metal's refusal in this process, one after the other (see recordOnChain). */
let recordingQueue: Promise<unknown> = Promise.resolve();
/** A record pull that started (the CLI was started) and has no outcome after this long (the CLI's 180 s timeout and a margin) ended mid-pull. */
export const RECORDING_STALE_MS = 240_000;
/** A claim whose pull never started, after this long (the mandate read, the gas key's creation and its top-up, each up to the CLI's 180 s): its process ended before the pull. */
export const CLAIM_STALE_MS = 900_000;

/** The start of the error the pull-start check throws: nothing was started (never read as "pull sent"). */
const PULL_NOT_STARTED = "not started";

/** What became of a recording: Metal's refusal recorded on chain, an incident, or not recorded (for whatever reason). */
export type Recording = "recorded" | "incident" | "not_recorded";

/**
 * An incident of the let-through or of a record pull: the Sourcing agent is stopped (stop.sourcing: every purchase
 * refused before signing until the CFO lifts it with Face ID), an alarm row is written and, for a purchase let through,
 * the let-through is finished as an incident, all in one transaction (nested in the caller's, if any).
 */
function raiseIncident(db: DB, seq: number, purchaseId: number | null, what: string, kind: "let_through" | "record_pull"): void {
  db.transaction(() => {
    const at = new Date().toISOString();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('stop.sourcing', 'on', ?) ON CONFLICT(key) DO UPDATE SET value = 'on', updated_at = excluded.updated_at").run(at);
    audit(db, "system", "upstream.let_through_incident", purchaseId === null ? String(seq) : String(purchaseId), { seq, purchase_id: purchaseId, kind, what, stopped: "sourcing", lift: "an approved policy change (Face ID) setting the Sourcing agent's stop to off" });
    if (purchaseId !== null) finishLetThrough(db, { outcome: "incident", purchase_id: purchaseId, seq, detail: what });
  }).immediate();
}

interface Claim { seq: number; mandate: string; payment_id: string; let_through?: boolean; purchase_id?: number | null; ts: string; pulled: string | null }

/** The claims of a record pull with no outcome yet (for one mandate and kind, or all), with when each pull started. */
function openClaims(db: DB, only?: { mandate: string; letThrough: boolean }): Claim[] {
  const rows = db.prepare(`SELECT c.ts, c.payload_json,
      (SELECT p.ts FROM audit_log p WHERE p.event = 'upstream.refusal_pull_started' AND json_extract(p.payload_json, '$.payment_id') = json_extract(c.payload_json, '$.payment_id') LIMIT 1) AS pulled
    FROM audit_log c WHERE c.event = 'upstream.refusal_recording'
      AND NOT EXISTS (SELECT 1 FROM audit_log o WHERE o.event IN ('upstream.refused_on_chain', 'upstream.refusal_not_recorded')
        AND json_extract(o.payload_json, '$.mandate') = json_extract(c.payload_json, '$.mandate')
        AND COALESCE(json_extract(o.payload_json, '$.let_through'), 0) = COALESCE(json_extract(c.payload_json, '$.let_through'), 0))`).all() as { ts: string; payload_json: string; pulled: string | null }[];
  // A claim written before the pull-start stamp existed (no purchase_id in it) counts as started when it was claimed.
  return rows.map((r) => { const p = JSON.parse(r.payload_json) as Omit<Claim, "ts" | "pulled">; return { ...p, ts: r.ts, pulled: r.pulled ?? ("purchase_id" in p ? null : r.ts) }; })
    .filter((c) => !only || (c.mandate === only.mandate && Boolean(c.let_through) === only.letThrough));
}

/**
 * Resolves one claim with no outcome, inside the caller's transaction: still in flight (a pull of another process, or of
 * this one before it ended) is "pending"; a pull that started and has no outcome after its timeout may have reached
 * Metal: an incident (its hold stays HELD); a claim whose pull never started, after the steps before it could take, was
 * never sent: not recorded, its hold released.
 */
function resolveClaim(db: DB, c: Claim, now: Date): "pending" | Recording {
  const lt: Record<string, boolean> = c.let_through ? { let_through: true } : {};
  if (c.pulled) {
    if (now.getTime() - Date.parse(c.pulled) < RECORDING_STALE_MS) return "pending";
    audit(db, "sourcing", "upstream.refusal_not_recorded", String(c.seq), { seq: c.seq, mandate: c.mandate, error: `pull sent: started at ${c.pulled} and no outcome after the CLI's timeout (the process ended mid-pull?)`, ...lt }, now);
    raiseIncident(db, c.seq, c.purchase_id ?? null, `the pull recording Metal's refusal (${c.payment_id}) started at ${c.pulled} and has no outcome; it may have reached Metal`, "record_pull");
    return "incident";
  }
  if (now.getTime() - Date.parse(c.ts) < CLAIM_STALE_MS) return "pending";
  audit(db, "sourcing", "upstream.refusal_not_recorded", String(c.seq), { seq: c.seq, mandate: c.mandate, error: `not sent: claimed at ${c.ts}, the pull never started (the process ended before it)`, ...lt }, now);
  releaseHold(db, `record:${c.payment_id}`, "not sent: the record pull never started", now);
  return "not_recorded";
}

/**
 * After a restart, and on the runner's poll: every record pull left without an outcome is resolved (resolveClaim) once
 * its timeout has passed, so a crash mid-pull never leaves its hold HELD or the let-through labelled as recorded.
 */
export function recoverRecordPulls(db: DB, now = new Date()): { incidents: number; notSent: number; pending: number } {
  let incidents = 0, notSent = 0, pending = 0;
  for (const seen of openClaims(db)) {
    // Read again inside the write transaction: another writer may have given it an outcome meanwhile.
    const r = db.transaction(() => {
      const c = openClaims(db, { mandate: seen.mandate, letThrough: Boolean(seen.let_through) }).find((x) => x.payment_id === seen.payment_id);
      return c ? resolveClaim(db, c, now) : null;
    }).immediate();
    if (r === "incident") incidents++; else if (r === "not_recorded") notSent++; else if (r === "pending") pending++;
  }
  return { incidents, notSent, pending };
}

export class SourcingAgent {
  private mandate: LoadedMandate | undefined;
  private cache: { body: unknown; at: number; purchaseId: number; supplier: SupplierId } | null = null;
  /** Defense in depth (src/world/letThrough.ts): armed in this process's memory only, for one purchase, tied to the claim. */
  private letThroughArmedAt: string | null = null;

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
   * its next tick. At TURNED_AWAY_MIN customers in the window, Treasury is woken, at most once per window; Treasury
   * still reads code's evidence from the ledger (src/autonomy/teamProfiles.ts blockedByMandate), not this event.
   */
  private turnedAway(): void {
    if (!autonomyOn()) return;
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'REFUSED' AND refusal_reason LIKE 'buy_policy:%' AND created_at > ?")
      .get(new Date(Date.now() - TURNED_AWAY_WINDOW_MS).toISOString()) as { n: number }).n;
    if (n < TURNED_AWAY_MIN) return;
    // Once per window (review: a sliding "exactly three" fired on every refusal when they came minutes apart).
    if (this.db.prepare("SELECT 1 FROM world_events WHERE kind = 'customers.turned_away' AND created_at > ?").get(new Date(Date.now() - TURNED_AWAY_WINDOW_MS).toISOString())) return;
    publish(this.db, "customers.turned_away", { count: n, window_minutes: TURNED_AWAY_WINDOW_MS / 60_000 }, "treasury");
  }

  /**
   * Once per mandate for Purser's first cap refusal, and once more for the one let-through (`letThrough`), if any. True
   * when it ended in an incident: a pull that may have reached Metal and was not reported refused (Sourcing is stopped;
   * with `purchaseId`, the let-through is finished as an incident in that same transaction).
   * The recording no longer blocks the process (agent run 1), so other refusals may arrive while it runs. All recordings
   * in this process run one at a time (they share one gas key: two at once could race its nonce and read as an
   * incident). Across processes, the claim row written before the pull is the guard.
   */
  private recordOnChain(m: LoadedMandate, seq: number, reason: string, refusedCents?: number, letThrough = false, purchaseId: number | null = null): Promise<Recording> {
    const run = recordingQueue.then(() => this.recordOnce(m, seq, reason, refusedCents, letThrough, purchaseId));
    recordingQueue = run.catch(() => undefined);
    return run;
  }

  private async recordOnce(m: LoadedMandate, seq: number, reason: string, refusedCents: number | undefined, letThrough: boolean, purchaseId: number | null): Promise<Recording> {
    const paymentId = `refusal-${m.reference.slice(2, 14)}-${seq}`;
    const lt: Record<string, boolean> = letThrough ? { let_through: true } : {};
    // The claim, in one write transaction with the check: at most one record pull per mandate and kind, ever. An earlier
    // outcome decides; an earlier claim without one is resolved (resolveClaim): still in flight counts as not recorded.
    const claim = this.db.transaction((): Recording | "claimed" => {
      const done = this.db.prepare(`SELECT event FROM audit_log WHERE event IN ('upstream.refused_on_chain', 'upstream.refusal_not_recorded')
        AND json_extract(payload_json, '$.mandate') = ? AND COALESCE(json_extract(payload_json, '$.let_through'), 0) = ? ORDER BY seq LIMIT 1`).get(m.reference, letThrough ? 1 : 0) as { event: string } | undefined;
      if (done) return done.event === "upstream.refused_on_chain" ? "recorded" : "not_recorded";
      const open = openClaims(this.db, { mandate: m.reference, letThrough })[0];
      if (open) { const r = resolveClaim(this.db, open, new Date()); return r === "pending" ? "not_recorded" : r; }
      audit(this.db, "sourcing", "upstream.refusal_recording", String(seq), { seq, mandate: m.reference, payment_id: paymentId, purchase_id: purchaseId, ...lt });
      return "claimed";
    }).immediate();
    if (claim !== "claimed") return claim;
    const cents = refusedCents ?? Number(/over the sourcing mandate's|is over/.test(reason) ? toCents((/^mandate_cap_exceeded: (?:the supplier asks )?(\d+\.\d{2})/.exec(reason) ?? [])[1] ?? "0.00") : 0);
    // The record pull is an over-cap payment sent to Metal: it gets its own hold (past the cap, like the let-through's),
    // released when Metal refuses it, kept when its outcome is unknown, so the budget never runs ahead of the chain.
    const hold = `record:${paymentId}`;
    let held = false;
    try {
      if (!cents) throw new Error("the refused amount is not in the reason");
      // Never more than a small rise over the bound cap.
      let cap: bigint | null = null;
      try { cap = boundCapUnits(m); } catch { cap = null; }
      if (cap !== null && centsToBaseUnits(cents) > cap + centsToBaseUnits(LET_THROUGH_MAX_OVER_CENTS)) throw new Error(`${fromCents(cents)} is more than ${fromCents(LET_THROUGH_MAX_OVER_CENTS)} over the cap; no pull is sent to record it`);
      const refused = holdBeyondCap(this.db, { agent: "sourcing", cents, ref: hold, payee: "supplier", reason: RECORD_PULL_HOLD });
      if (refused) throw new Error(`no hold for the record pull (${refused.slice(0, 160)}); nothing is sent`);
      held = true;
      // The stamp right before the CLI starts: from then on the pull may reach Metal (resolveClaim times it from here).
      // Guarded: only while the claim has no outcome and its hold is still HELD (the runner may have resolved a claim
      // whose steps before the pull ran long); otherwise nothing is started and the pull is not sent.
      const r = await recordCapRefusalOnChain(m, this.supplier, cents, paymentId, undefined, () => this.db.transaction(() => {
        const open = openClaims(this.db, { mandate: m.reference, letThrough }).some((c) => c.payment_id === paymentId);
        const holding = (this.db.prepare("SELECT status FROM holds WHERE ref = ?").get(hold) as { status: string } | undefined)?.status === "HELD";
        if (!open || !holding) throw new Error(`${PULL_NOT_STARTED}: the claim was resolved before the pull started (${open ? "its hold is no longer held" : "it has an outcome"})`);
        audit(this.db, "sourcing", "upstream.refusal_pull_started", String(seq), { seq, mandate: m.reference, payment_id: paymentId, ...lt });
      }).immediate());
      releaseHold(this.db, hold, "Metal refused the record pull; nothing moved");
      audit(this.db, "sourcing", "upstream.refused_on_chain", String(seq), { seq, mandate: m.reference, amount: fromCents(cents), tx: r.tx, metal_reason: r.reason, ...lt });
      return "recorded";
    } catch (e) {
      const error = (e as Error).message;
      // A pull that may have reached Metal and was not reported refused may have paid: an incident, its hold kept; the
      // outcome row, the stop and the alarm in one transaction.
      // Resolved by the runner before the pull started: its outcome and hold are already settled; nothing is sent.
      if (error.startsWith(PULL_NOT_STARTED)) return "not_recorded";
      if (!/^pull sent: |did not report a refusal/.test(error)) {
        audit(this.db, "sourcing", "upstream.refusal_not_recorded", String(seq), { seq, mandate: m.reference, error: error.slice(0, 240), ...lt });
        if (held) releaseHold(this.db, hold, `not sent: ${error.slice(0, 200)}`);
        return "not_recorded";
      }
      this.db.transaction(() => {
        audit(this.db, "sourcing", "upstream.refusal_not_recorded", String(seq), { seq, mandate: m.reference, error: error.slice(0, 240), ...lt });
        raiseIncident(this.db, seq, purchaseId, `the ${fromCents(cents)} over-cap pull sent to record Metal's refusal was not reported refused (${error.slice(0, 120)})`, "record_pull");
      }).immediate();
      return "incident";
    }
  }

  /**
   * Arms the one let-through (the world's serve loop calls this once it claimed the world's request). The first purchase
   * Purser refuses over a cap uses it, whatever happens next; it lapses after LET_THROUGH_TTL_MS.
   */
  armLetThrough(armedAt: string): void {
    this.letThroughArmedAt = armedAt;
  }

  /** Takes the arm (it is used once): true only when the ledger's request is still armed by this claim, not lapsed. */
  private takeLetThrough(): boolean {
    const at = this.letThroughArmedAt;
    this.letThroughArmedAt = null;
    return at !== null && consumeLetThrough(this.db, at);
  }

  /**
   * Whether a purchase Purser refused over a cap may go on to Metal as the one let-through: null when it may, else why
   * not. Only a cap refusal, only to the supplier the policy targets, and only for an amount over the cap in the bound
   * credential, which Metal's Mandate Binding checks on every payment, so Metal must refuse it.
   */
  private letThroughProblem(m: LoadedMandate, purser: string, cents: number, payTo: string, supplier: Address): string | null {
    if (!/^(mandate_cap_exceeded|policy_cap_exceeded):/.test(purser)) return `Purser's refusal is not over a cap (${purser.slice(0, 80)})`;
    if (payTo.toLowerCase() !== supplier.toLowerCase()) return "the offer pays someone other than the supplier the policy targets";
    let cap: bigint;
    try { cap = boundCapUnits(m); } catch (e) { return `the bound credential's cap could not be read (${(e as Error).message.slice(0, 80)})`; }
    // cents is the offer rounded up to whole cents: the offer is over (cents - 1) cents, so this means "over the cap".
    if (centsToBaseUnits(cents - 1) < cap) return `${fromCents(cents)} is not over the cap in the bound credential; Metal could pay it`;
    // A price rise of a cent or two, never an arbitrary ask: the most an unexpected acceptance could move stays small.
    if (centsToBaseUnits(cents) > cap + centsToBaseUnits(LET_THROUGH_MAX_OVER_CENTS)) return `${fromCents(cents)} is more than ${fromCents(LET_THROUGH_MAX_OVER_CENTS)} over the cap; only a small rise is let through`;
    return null;
  }

  /**
   * Metal did not cleanly refuse the let-through (it paid, or the outcome is unknown): an incident. The Sourcing agent is
   * stopped (stop.sourcing: every purchase refused before signing until the CFO lifts it with Face ID) and an alarm row
   * is written. The payment, if any, is in the ledger like any other; it was inside the mandate's on-chain budget.
   */
  private letThroughIncident(seq: number, purchaseId: number | null, what: string, kind: "let_through" | "record_pull" = "let_through"): void {
    raiseIncident(this.db, seq, purchaseId, what, kind);
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
    // The main run's world serves no cache (world.upstream_cache = off): every sale buys upstream once, whatever the policy says.
    if (policy.cache_seconds > 0 && !upstreamCacheOff(this.db) && this.cache && Date.now() - this.cache.at <= Math.min(policy.cache_seconds, MAX_CACHE_SECONDS) * 1000) {
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
    // Defense in depth (src/world/letThrough.ts): set when this purchase is the one let past Purser's cap check to Metal.
    let letThrough: { cents: number; purser: string } | null = null;
    let notLetThrough: string | null = null;
    const m = this.mandate;
    const out = await payUnderMandate(m, `${t.base}${SUPPLIER_ROUTE}?seq=${seq}`, {}, (cents, payTo) => {
      const refused = reserveSpend(this.db, { agent: "sourcing", rail: "metal", cents, ref, payee: "supplier" });
      held = refused === null;
      // Armed, and Purser refused over a cap: the arm is used now, by this attempt, whatever comes of it.
      if (refused && /^(mandate_cap_exceeded|policy_cap_exceeded):/.test(refused) && this.takeLetThrough()) {
        const problem = this.letThroughProblem(m, refused, cents, payTo, t.address) ?? holdBeyondCap(this.db, { agent: "sourcing", cents, ref, payee: "supplier" });
        if (problem) {
          notLetThrough = problem;
          return refused;
        }
        held = true;
        letThrough = { cents, purser: refused };
        audit(this.db, "sourcing", "upstream.let_through", String(seq), { seq, supplier: t.id, amount: fromCents(cents), purser_would_refuse: refused, bound_cap: fromCents(Number(boundCapUnits(m) / 10n ** 16n)), mandate: m.reference });
        return null;
      }
      return refused;
    });
    const now = new Date().toISOString();
    const lt = letThrough as { cents: number; purser: string } | null;

    if (out.kind === "paid") {
      // Paid, its hold settled and (for the let-through, an incident) the Sourcing agent stopped, in one transaction.
      const id = this.db.transaction(() => {
        const n = Number(insert.run(Number(BigInt(out.amount) / 10n ** 16n), out.nonce, out.tx, "PAID", null, now, t.id, originJson()).lastInsertRowid);
        if (held) settleHold(this.db, ref);
        audit(this.db, "sourcing", "upstream.paid", String(n), { seq, tx: out.tx, amount_units: out.amount, supplier: t.id });
        if (lt) this.letThroughIncident(seq, n, `Metal accepted the over-cap purchase it should have refused (tx ${out.tx})`);
        return n;
      }).immediate();
      const body = JSON.parse(out.body) as unknown;
      this.cache = { body, at: Date.now(), purchaseId: id, supplier: t.id };
      return { ok: true, purchaseId: id, body };
    }
    if (out.kind === "refused") {
      const id = Number(insert.run(0, out.nonce ?? null, null, "REFUSED", out.reason, now, t.id, originJson()).lastInsertRowid);
      if (held) releaseHold(this.db, ref, out.reason);
      audit(this.db, "sourcing", "upstream.refused", String(id), { seq, reason: out.reason, refused_by: out.status === 0 ? "purser" : "metal", supplier: t.id });
      this.tell(seq, t.id, out.reason, out.status === 0 ? "purser" : "metal");
      if (notLetThrough) finishLetThrough(this.db, { outcome: "not_let_through", purchase_id: id, seq, detail: notLetThrough });
      if (lt) {
        if (out.status === 0) {
          finishLetThrough(this.db, { outcome: "not_sent", purchase_id: id, seq, detail: out.reason });
        } else if (refusalOf(out.reason) === "OverPerPaymentCap") {
          // Metal refused it itself, on the cap: nothing moved. Its refusal is then recorded on chain; only if that record
          // ends well does the purchase get its label (a record pull not reported refused is an incident instead).
          // An incident there finishes this let-through as one, in the incident's own transaction (stop and alarm). Not
          // recorded (never sent, or a claim still in flight elsewhere): no label, the outcome stays inconclusive.
          const rec: Recording = agentsOn() ? await this.recordOnChain(m, seq, out.reason, lt.cents, true, id) : "recorded";
          if (rec === "recorded") {
            // The label only with the let-through's own outcome (not when something else finished it meanwhile).
            this.db.transaction(() => {
              if (finishLetThrough(this.db, { outcome: "metal_refused", purchase_id: id, seq, detail: `${out.status} ${out.reason}` })) {
                audit(this.db, "sourcing", "upstream.let_through_refused", String(id), { seq, purchase_id: id, metal_status: out.status, metal_reason: out.reason.slice(0, 200), amount: fromCents(lt.cents), label: LET_THROUGH_LABEL });
              }
            }).immediate();
          } else if (rec === "not_recorded") {
            finishLetThrough(this.db, { outcome: "inconclusive", purchase_id: id, seq, detail: `Metal refused it (${out.status} ${out.reason.slice(0, 120)}), but its refusal was not recorded on chain` });
          }
        } else {
          // Refused, nothing settled, but not by Metal on the cap (a rate limit, an outage): no label, no record; not repeated.
          finishLetThrough(this.db, { outcome: "inconclusive", purchase_id: id, seq, detail: `${out.status} ${out.reason}` });
        }
      }
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
    const id = this.db.transaction(() => {
      // Paid after all: the row carries what the facilitator settled (else the hold's amount, the offer signed), so the
      // ledger, the dashboard and the budget count what Metal counts. Before 2 November it carried 0 and the hold was settled.
      const paidCents = found ? centsOfSettlement(found.amount) ?? (this.db.prepare("SELECT cents FROM holds WHERE ref = ?").get(ref) as { cents: number } | undefined)?.cents ?? 0 : 0;
      const n = Number(insert.run(paidCents, out.nonce, found?.transaction ?? null, found ? "PAID" : "IN_DOUBT", out.reason, now, t.id, originJson()).lastInsertRowid);
      // Paid after all: the ledger row counts it. In doubt: the hold keeps counting until the reconciliation resolves it.
      if (held && found) settleHold(this.db, ref);
      audit(this.db, "sourcing", found ? "upstream.paid_after_lookup" : "upstream.in_doubt", String(n), { seq, reason: out.reason, tx: found?.transaction ?? null });
      if (lt) this.letThroughIncident(seq, n, found ? `Metal settled the over-cap purchase it should have refused (tx ${found.transaction})` : `the over-cap purchase's outcome is unknown (${out.reason.slice(0, 120)}); its hold stays until the reconciliation resolves it`);
      return n;
    }).immediate();
    return { ok: false, purchaseId: id, reason: found ? "paid but no stock check delivered" : out.reason, inDoubt: !found };
  }
}

/** A facilitator settlement's amount (base units of *USDZ, 18 decimals) in cents; null when it is not a whole number of cents. */
function centsOfSettlement(amount: string | undefined): number | null {
  try {
    const u = BigInt(amount ?? "");
    return u > 0n && u % 10n ** 16n === 0n ? Number(u / 10n ** 16n) : null;
  } catch {
    return null;
  }
}

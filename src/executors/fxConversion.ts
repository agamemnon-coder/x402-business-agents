// Executes an approved fx_conversion (the Treasury advisor's suggestion, src/treasury/advisor.ts), only after the CFO's
// passkey: the hash first, then a fresh quote for exactly the signed buy amount, held to the signed sell_max, the sell
// currency's floor checked on a fresh balance, and one conversion under the signed request id, carrying the approval
// hash. A retry adopts a conversion Airwallex already made under that id; it never converts twice. Sandbox, test money.
//
// Review of 26 Nov: the sell currency's floor is judged under the payout lock (src/policy/payoutLock.ts) on what is
// free (freeCents: available, less the floor, commitments and what other executing payments hold), and the signed
// maximum is held there in the same step, so a supplier payment executed at the same time counts it; and the holds
// (the emergency stop, the velocity stop, a pause, the treasury agent's identity) are checked again right before the
// create, so one set during the balance and quote round-trips stops it.

import { AirwallexAmbiguous } from "../airwallex/client.js";
import type { PayoutRail } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { hashFirst } from "../policy/hashFirst.js";
import { STOP_WORDS } from "../policy/emergencyStop.js";
import { exclusive, holdPayout, releasePayout } from "../policy/payoutLock.js";
import { authorize } from "../policy/principals.js";
import { frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";
import { freeCents } from "../payouts/plan.js";
import type { FxConversionTerms } from "../treasury/advisor.js";

type Rail = Pick<PayoutRail, "balancesAll" | "createQuoteAny" | "createConversionAny" | "findConversionByRequestId">;

/** Why this conversion may not run now, or null: the emergency stop, the velocity stop, a pause, the agent's identity. */
export function fxHoldReason(db: DB, t: Pick<FxConversionTerms, "buy_currency" | "sell_currency">, at: Date): string | null {
  if (frozen(db)) return STOP_WORDS.replace("nothing is paid", "nothing is converted");
  if (stopped(db, "treasury")) return "the treasury agent was stopped automatically (velocity limit); nothing is converted until the CFO lifts the stop";
  if (paused(db, "treasury")) return "the treasury agent is paused by the CFO; nothing is converted until the CFO resumes it with Face ID";
  for (const currency of [t.sell_currency, t.buy_currency]) {
    const denied = authorize(db, "treasury", { rail: "airwallex", currency }, at);
    if (denied) return `${denied}; nothing is converted`;
  }
  return null;
}

export async function executeFxConversion(db: DB, rail: Rail, proposalId: string, now = () => new Date()): Promise<{ outcome: "EXECUTED" | "NEEDS_REAPPROVAL"; detail: string }> {
  hashFirst(db, proposalId);
  const t = beginExecution<FxConversionTerms>(db, proposalId, (x) => {
    if (x.kind !== "fx_conversion") throw new Error(`${proposalId} is not an FX conversion`);
    const held = fxHoldReason(db, x, now());
    if (held) throw new Error(held);
  }, now());
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const key = t.conversion_request_id;
  const stop = (why: string) => { releasePayout(db, key); finishExecution(db, proposalId, "NEEDS_REAPPROVAL", { reason: why }, now()); return { outcome: "NEEDS_REAPPROVAL" as const, detail: why }; };
  try {
    let conv = await rail.findConversionByRequestId(t.conversion_request_id);
    if (!conv) {
      const max = toCents(t.sell_max);
      // Judged and held under the payout lock: what other executing payments hold counts, and this one's maximum is held.
      const floorWhy = await exclusive(async (): Promise<string | null> => {
        const fresh = await rail.balancesAll();
        const free = freeCents(db, fresh, t.sell_currency, undefined, proposalId);
        if (free - max < 0) return `${t.sell_currency} ${fromCents(Math.max(0, fresh[t.sell_currency]?.availableCents ?? 0))} available, ${fromCents(Math.max(0, free))} free above its floor, commitments and payments under way: selling up to ${t.sell_max} would take it under its floor; a new proposal is needed`;
        holdPayout(db, proposalId, key, t.sell_currency, max);
        return null;
      });
      if (floorWhy) return stop(floorWhy);
      const q = await rail.createQuoteAny({ buyCurrency: t.buy_currency, sellCurrency: t.sell_currency, buyAmountCents: toCents(t.buy_amount), validity: "MIN_1" });
      if (q.buyAmountCents !== toCents(t.buy_amount)) return stop(`the quote buys ${t.buy_currency} ${fromCents(q.buyAmountCents)}, not the signed ${t.buy_amount}`);
      if (q.sellAmountCents > max) return stop(`the rate moved: the quote sells ${t.sell_currency} ${fromCents(q.sellAmountCents)}, more than the signed ${t.sell_max}`);
      db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(q.quoteId, `${t.sell_currency}/${t.buy_currency}`, fromCents(q.buyAmountCents), fromCents(q.sellAmountCents), q.clientRate, q.validFrom, q.validTo);
      // Nothing converted yet: a hold set since the execution began (the stop, a pause, a revocation) stops the create.
      const held = fxHoldReason(db, t, now());
      if (held) {
        audit(db, "awx-executor", "fx.held_before_create", t.conversion_request_id, { proposal_id: proposalId, reason: held, quote_id: q.quoteId, approval_sha256: sha, test_money: true }, now());
        throw new Error(held);
      }
      try {
        conv = await rail.createConversionAny({ requestId: t.conversion_request_id, quote: q, approvalSha256: sha });
      } catch (e) {
        // A lost answer keeps the hold: Airwallex may have converted it (a retry adopts it by request id).
        if (e instanceof AirwallexAmbiguous) throw Object.assign(e, { keepHold: true });
        throw e;
      }
    }
    const quoteId = conv.quoteId || `adopted:${conv.requestId}`;
    db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(quoteId, `${t.sell_currency}/${t.buy_currency}`, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), "adopted", now().toISOString(), now().toISOString());
    db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND used_by_conversion IS NULL").run(t.conversion_request_id, quoteId);
    db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(conv.conversionId, quoteId, conv.requestId, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
    audit(db, "awx-executor", "fx.converted", conv.conversionId, { proposal_id: proposalId, buy: `${t.buy_currency} ${fromCents(conv.buyAmountCents)}`, sell: `${t.sell_currency} ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha, test_money: true }, now());
    const detail = `converted ${t.sell_currency} ${fromCents(conv.sellAmountCents)} to ${t.buy_currency} ${fromCents(conv.buyAmountCents)} (${conv.conversionId})`;
    // Recorded: the money is now in the balances Airwallex reports, so the hold goes.
    releasePayout(db, key);
    finishExecution(db, proposalId, "EXECUTED", { conversion_id: conv.conversionId, status: conv.status }, now());
    return { outcome: "EXECUTED", detail };
  } catch (e) {
    if (!(e as { keepHold?: boolean }).keepHold) releasePayout(db, key);
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now());
    throw e;
  }
}

// Executes an approved fx_conversion (the Treasury advisor's suggestion, src/treasury/advisor.ts), only after the CFO's
// passkey: the hash first, then a fresh quote for exactly the signed buy amount, held to the signed sell_max, the sell
// currency's floor checked on a fresh balance, and one conversion under the signed request id, carrying the approval
// hash. A retry adopts a conversion Airwallex already made under that id; it never converts twice. Sandbox, test money.

import type { PayoutRail } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { hashFirst } from "../policy/hashFirst.js";
import { frozen } from "../policy/rules.js";
import { floorCents } from "../payouts/plan.js";
import type { FxConversionTerms } from "../treasury/advisor.js";

type Rail = Pick<PayoutRail, "balancesAll" | "createQuoteAny" | "createConversionAny" | "findConversionByRequestId">;

export async function executeFxConversion(db: DB, rail: Rail, proposalId: string, now = () => new Date()): Promise<{ outcome: "EXECUTED" | "NEEDS_REAPPROVAL"; detail: string }> {
  hashFirst(db, proposalId);
  const t = beginExecution<FxConversionTerms>(db, proposalId, (x) => {
    if (x.kind !== "fx_conversion") throw new Error(`${proposalId} is not an FX conversion`);
    if (frozen(db)) throw new Error("the CFO's emergency stop is on; nothing is converted");
  }, now());
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const stop = (why: string) => { finishExecution(db, proposalId, "NEEDS_REAPPROVAL", { reason: why }, now()); return { outcome: "NEEDS_REAPPROVAL" as const, detail: why }; };
  try {
    let conv = await rail.findConversionByRequestId(t.conversion_request_id);
    if (!conv) {
      const max = toCents(t.sell_max);
      const available = (await rail.balancesAll())[t.sell_currency]?.availableCents ?? 0;
      if (available - max < floorCents(db, t.sell_currency)) return stop(`${t.sell_currency} ${fromCents(Math.max(0, available))} available: selling up to ${t.sell_max} would take it under its floor; a new proposal is needed`);
      const q = await rail.createQuoteAny({ buyCurrency: t.buy_currency, sellCurrency: t.sell_currency, buyAmountCents: toCents(t.buy_amount), validity: "MIN_1" });
      if (q.buyAmountCents !== toCents(t.buy_amount)) return stop(`the quote buys ${t.buy_currency} ${fromCents(q.buyAmountCents)}, not the signed ${t.buy_amount}`);
      if (q.sellAmountCents > max) return stop(`the rate moved: the quote sells ${t.sell_currency} ${fromCents(q.sellAmountCents)}, more than the signed ${t.sell_max}`);
      db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(q.quoteId, `${t.sell_currency}/${t.buy_currency}`, fromCents(q.buyAmountCents), fromCents(q.sellAmountCents), q.clientRate, q.validFrom, q.validTo);
      conv = await rail.createConversionAny({ requestId: t.conversion_request_id, quote: q, approvalSha256: sha });
    }
    const quoteId = conv.quoteId || `adopted:${conv.requestId}`;
    db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(quoteId, `${t.sell_currency}/${t.buy_currency}`, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), "adopted", now().toISOString(), now().toISOString());
    db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND used_by_conversion IS NULL").run(t.conversion_request_id, quoteId);
    db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(conv.conversionId, quoteId, conv.requestId, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
    audit(db, "awx-executor", "fx.converted", conv.conversionId, { proposal_id: proposalId, buy: `${t.buy_currency} ${fromCents(conv.buyAmountCents)}`, sell: `${t.sell_currency} ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha, test_money: true }, now());
    const detail = `converted ${t.sell_currency} ${fromCents(conv.sellAmountCents)} to ${t.buy_currency} ${fromCents(conv.buyAmountCents)} (${conv.conversionId})`;
    finishExecution(db, proposalId, "EXECUTED", { conversion_id: conv.conversionId, status: conv.status }, now());
    return { outcome: "EXECUTED", detail };
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now());
    throw e;
  }
}

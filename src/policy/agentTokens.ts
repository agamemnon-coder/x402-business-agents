// Each agent's own payment credential as a token (21 Nov, the owner: "tokenisation with a purpose"). The agent never
// holds its card's number: it holds a Purser token (ptok_…), bound to a mandate made from the CFO's policy for that
// agent: its own Airwallex Issuing card (a Visa card, sandbox), its limits per purchase and per month, its merchant
// categories, euros only, until a date. Only the token's SHA-256 is kept (./agentTokenStore.ts).
//
// A payment with the token is checked against the mandate AND the policy as it stands now (the stricter wins), before
// any call to Airwallex: an unknown, revoked or expired token, a revoked, paused or stopped agent, another currency,
// another merchant category, more than a purchase may be, more than the month allows, or a card that is no longer the
// mandate's: refused, recorded, nothing sent. Within the mandate, Purser opens the card's purchase window for that
// one charge (src/policy/cards.ts chargeInWindow), and Airwallex decides on the card's own limits and categories.
//
// So a leaked token is useless outside its mandate, and the card itself is no use to a thief either: it is frozen at
// Airwallex except inside a window Purser opens (freeze by default, 19 Nov). Revoking the agent revokes its tokens at
// once (src/policy/principals.ts); its card is frozen by the next card sync, and a closed card is closed for good.

import { createHash, randomBytes } from "node:crypto";
import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { CardTransaction, IssuingSim } from "../airwallex/issuing.js";
import { cardControls, cardOf, chargeInWindow, ingestCardTransaction, policyAllowsCard } from "./cards.js";
import { cardLimits } from "./rules.js";
import { tokenRows, tokenTables, type AgentTokenRow } from "./agentTokenStore.js";

export { revokeAgentTokens, tokenRows } from "./agentTokenStore.js";

/** How long a token works from issue, at most (and never past the card's own end date). */
export const TOKEN_DAYS = 30;

/** What the token may pay: the CFO's policy for this agent, as it stood when the token was issued. */
export interface TokenMandate {
  v: 1;
  agent: string;
  card_id: string;
  card_last4: string;
  currency: "EUR";
  per_purchase_cents: number;
  monthly_cents: number;
  mccs: string[];
  issued_at: string;
  expires_at: string;
  source: string;
}

export type TokenRefusal =
  | "TOKEN_UNKNOWN" | "TOKEN_REVOKED" | "TOKEN_EXPIRED" | "AGENT_NOT_ALLOWED" | "CARD_NOT_MANDATES"
  | "CURRENCY_NOT_ALLOWED" | "MCC_NOT_ALLOWED" | "OVER_PER_PURCHASE" | "OVER_MONTH";

export interface Purchase { amountCents: number; currency: string; merchant: string; mcc: string }
export type TokenCheck =
  | { ok: true; token: AgentTokenRow; mandate: TokenMandate }
  | { ok: false; code: TokenRefusal; why: string; token: AgentTokenRow | null };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** JSON with keys sorted (the same mandate always hashes the same). */
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
export const mandateHash = (m: TokenMandate): string => sha256(canonical(m));
const money = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

/** The mandate for the agent's token now: its card as the ledger holds it, its limits and categories from the policy. */
export function mandateFor(db: DB, agent: string, now: Date): TokenMandate {
  const card = cardOf(db, agent);
  if (!card) throw new Error(`the ${agent} agent has no card; a token needs one`);
  if (card.status === "CLOSED") throw new Error(`the ${agent} agent's card is closed`);
  const lim = cardLimits(db, agent);
  const mccs = cardControls(agent, now, db).mccs;
  const cardEnd = card.active_to && Number.isFinite(Date.parse(card.active_to)) ? Date.parse(card.active_to) : Infinity;
  const end = Math.min(now.getTime() + TOKEN_DAYS * 86_400_000, cardEnd);
  return {
    v: 1, agent, card_id: card.card_id, card_last4: card.last4, currency: "EUR",
    // Never more than the card at Airwallex allows either: the stricter of the policy and the card.
    per_purchase_cents: Math.min(lim.perTxCents, card.per_tx_cents), monthly_cents: Math.min(lim.monthlyCents, card.monthly_cents),
    mccs, issued_at: now.toISOString(), expires_at: new Date(end).toISOString(), source: `the CFO's policy for the ${agent} agent (card.${agent}.per_tx, card.${agent}.monthly) and its card's merchant categories`,
  };
}

/**
 * Issues the agent a token bound to its mandate. The token is returned once, to hand to the agent; the ledger keeps
 * its hash. An agent the policy does not allow to pay gets none.
 */
export function issueToken(db: DB, agent: string, now = new Date(), by = "system"): { token: string; token_id: string; mandate: TokenMandate; mandate_sha256: string } {
  tokenTables(db);
  if (!policyAllowsCard(db, agent)) throw new Error(`the ${agent} agent may not pay now (revoked, paused or stopped); no token`);
  const mandate = mandateFor(db, agent, now);
  const token = `ptok_${randomBytes(20).toString("hex")}`;
  const hash = sha256(token);
  const token_id = `tok_${hash.slice(0, 16)}`;
  const mandate_sha256 = mandateHash(mandate);
  db.prepare(`INSERT INTO agent_tokens (token_id, token_sha256, agent, card_id, card_last4, token_last4, mandate_json, mandate_sha256, status, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(token_id, hash, agent, mandate.card_id, mandate.card_last4, token.slice(-4), JSON.stringify(mandate), mandate_sha256, mandate.issued_at, mandate.expires_at);
  audit(db, "system", "agent_token.issued", agent, { agent, token_id, token_last4: token.slice(-4), card_last4: mandate.card_last4, mandate: mandate as never, mandate_sha256, by: by.slice(0, 60) }, now);
  return { token, token_id, mandate, mandate_sha256 };
}

/** Spent with this token this calendar month (UTC), approved charges only. */
function spentThisMonth(db: DB, tokenId: string, now: Date): number {
  const month = now.toISOString().slice(0, 7);
  return (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM agent_token_uses WHERE token_id = ? AND approved = 1 AND substr(at, 1, 7) = ?").get(tokenId, month) as { n: number }).n;
}

/** The token against its mandate and the policy now. Reads only; nothing is sent anywhere. */
export function checkToken(db: DB, token: string, p: Purchase, now = new Date()): TokenCheck {
  tokenTables(db);
  const row = /^ptok_[0-9a-f]{40}$/.test(token) ? (db.prepare("SELECT * FROM agent_tokens WHERE token_sha256 = ?").get(sha256(token)) as AgentTokenRow | undefined) ?? null : null;
  const no = (code: TokenRefusal, why: string): TokenCheck => ({ ok: false, code, why, token: row });
  if (!row) return no("TOKEN_UNKNOWN", "no such token");
  const m = JSON.parse(row.mandate_json) as TokenMandate;
  if (row.status === "revoked") return no("TOKEN_REVOKED", `revoked at ${row.revoked_at ?? "?"}: ${row.revoked_why ?? ""}`.trim());
  if (Date.parse(row.expires_at) <= now.getTime()) return no("TOKEN_EXPIRED", `expired at ${row.expires_at}`);
  if (!policyAllowsCard(db, row.agent)) return no("AGENT_NOT_ALLOWED", `the ${row.agent} agent may not pay now (revoked, paused, stopped or under the emergency stop)`);
  const card = cardOf(db, row.agent);
  if (!card || card.card_id !== m.card_id || card.status === "CLOSED") return no("CARD_NOT_MANDATES", "the agent's card is no longer the one the token is bound to");
  if (p.currency !== m.currency) return no("CURRENCY_NOT_ALLOWED", `${p.currency}: the mandate pays ${m.currency} only`);
  if (!m.mccs.includes(p.mcc)) return no("MCC_NOT_ALLOWED", `merchant category ${p.mcc}: the mandate allows ${m.mccs.join(", ") || "none"}`);
  // The policy now may be stricter than when the token was issued (the CFO lowered a limit): the stricter wins.
  const lim = cardLimits(db, row.agent);
  const perPurchase = Math.min(m.per_purchase_cents, lim.perTxCents), monthly = Math.min(m.monthly_cents, lim.monthlyCents);
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > perPurchase) return no("OVER_PER_PURCHASE", `EUR ${money(p.amountCents)}: at most EUR ${money(perPurchase)} a purchase`);
  const spent = spentThisMonth(db, row.token_id, now);
  if (spent + p.amountCents > monthly) return no("OVER_MONTH", `EUR ${money(p.amountCents)} on top of EUR ${money(spent)} this month: at most EUR ${money(monthly)}`);
  return { ok: true, token: row, mandate: m };
}

export type TokenPayment =
  | { ok: true; token_id: string; agent: string; mandate_sha256: string; tx: CardTransaction }
  | { ok: false; token_id: string | null; agent: string | null; code: TokenRefusal; why: string };

/**
 * A purchase paid with the token: checked first (a refusal sends nothing to Airwallex), then charged in the card's
 * purchase window, recorded once as the card's authorisation and as the token's use.
 */
export async function payWithToken(db: DB, sim: IssuingSim, token: string, p: Purchase, now = new Date(), purpose?: string): Promise<TokenPayment> {
  const c = checkToken(db, token, p, now);
  if (!c.ok) {
    audit(db, "system", "agent_token.refused", c.token?.agent ?? null, { agent: c.token?.agent ?? null, token_id: c.token?.token_id ?? null, code: c.code, why: c.why.slice(0, 200), amount: money(Math.max(0, p.amountCents | 0)), currency: p.currency.slice(0, 4), merchant: p.merchant.slice(0, 60), mcc: p.mcc.slice(0, 4), airwallex_calls: 0 }, now);
    return { ok: false, token_id: c.token?.token_id ?? null, agent: c.token?.agent ?? null, code: c.code, why: c.why };
  }
  const { token: row, mandate } = c;
  const what = purpose ?? `${p.merchant}, paid with the ${row.agent} agent's token ${row.token_id}`;
  audit(db, row.agent as Actor, "card.purchase_started", row.token_id, { agent: row.agent, last4: row.card_last4, merchant: p.merchant, plan: what, amount: money(p.amountCents), currency: "EUR", token_id: row.token_id }, now);
  const tx = await chargeInWindow(db, sim, row.agent, { cardId: mandate.card_id, amountCents: p.amountCents, currency: "EUR", merchant: p.merchant, mcc: p.mcc }, now, what);
  ingestCardTransaction(db, tx, "simulation", now, what);
  db.prepare("INSERT OR IGNORE INTO agent_token_uses (token_id, transaction_id, amount_cents, currency, approved, at) VALUES (?, ?, ?, ?, ?, ?)").run(row.token_id, tx.transactionId, tx.amountCents, tx.currency, tx.approved ? 1 : 0, now.toISOString());
  audit(db, "system", "agent_token.used", row.agent, { agent: row.agent, token_id: row.token_id, mandate_sha256: row.mandate_sha256, transaction_id: tx.transactionId, approved: tx.approved, status: tx.status, reason: tx.failureReason ?? null, amount: money(tx.amountCents), currency: tx.currency, merchant: p.merchant.slice(0, 60), mcc: p.mcc }, now);
  // A settled charge goes to T:0 at once when the runner books payments there (T0_PAYMENTS=on); never waited on.
  if (tx.approved) void import("../accounting/t0Sink.js").then((m) => m.t0SinkFor(db).afterMoney(), () => undefined);
  return { ok: true, token_id: row.token_id, agent: row.agent, mandate_sha256: row.mandate_sha256, tx };
}

/** What a page may show of an agent's tokens: never the token, never the card number. */
export function tokenView(db: DB, agent?: string): { token_id: string; agent: string; token_last4: string; card_last4: string; status: string; issued_at: string; expires_at: string; revoked_at: string | null; mandate: TokenMandate; mandate_sha256: string }[] {
  return tokenRows(db, agent).map((r) => ({ token_id: r.token_id, agent: r.agent, token_last4: r.token_last4, card_last4: r.card_last4, status: r.status, issued_at: r.issued_at, expires_at: r.expires_at, revoked_at: r.revoked_at, mandate: JSON.parse(r.mandate_json) as TokenMandate, mandate_sha256: r.mandate_sha256 }));
}

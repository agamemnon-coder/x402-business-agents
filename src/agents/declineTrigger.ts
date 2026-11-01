// Block 5.2, event-driven: a new card decline starts the agent whose card it is (src/agents/declineAgent.ts). Called
// by whatever sees the decline first: the CLI that made the purchase, the runner's webhook handler, or its poll. Each
// decline is claimed once in the ledger (agent_claims), so two processes never both start the agent; a raise already
// waiting for the CFO is not stacked. Off unless KIT11_AGENTS=on; task cards and outside agents' cards are not ours.

import type Anthropic from "@anthropic-ai/sdk";
import { agentsOn, autonomyOn } from "../config/agents.js";
import { AGENTS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { cardSpendCents } from "../policy/cards.js";
import { proposeCardRaise } from "./cardBuyer.js";
import { meetDecline, type DeclineMeeting } from "./declineAgent.js";

/** Declines older than this are history, not news: the agent does not wake for them. */
const FRESH_MS = 30 * 60_000;

export function claim(db: DB, key: string, by: string, now = new Date()): boolean {
  return db.prepare("INSERT INTO agent_claims (claim, claimed_by, claimed_at) VALUES (?, ?, ?) ON CONFLICT(claim) DO NOTHING").run(key, by, now.toISOString()).changes === 1;
}

export async function meetNewDeclines(db: DB, o: { client?: Anthropic | null; now?: Date; env?: NodeJS.ProcessEnv; by: string }): Promise<DeclineMeeting[]> {
  // D22: with the autonomy on, the decline is the event `card.declined` for the agent whose card it is; it decides.
  if (!agentsOn(o.env) || autonomyOn(o.env)) return [];
  const now = o.now ?? new Date();
  const rows = db.prepare(`SELECT t.transaction_id, t.agent, t.merchant, t.amount_cents, t.failure_reason, t.status, t.purpose, c.per_tx_cents, c.monthly_cents
    FROM card_transactions t JOIN cards c ON c.card_id = t.card_id
    WHERE t.approved = 0 AND t.occurred_at > ? ORDER BY t.occurred_at, t.transaction_id`).all(new Date(now.getTime() - FRESH_MS).toISOString()) as
    { transaction_id: string; agent: string; merchant: string; amount_cents: number; failure_reason: string | null; status: string; purpose: string | null; per_tx_cents: number; monthly_cents: number }[];
  const out: DeclineMeeting[] = [];
  for (const r of rows) {
    if (!(AGENTS as readonly string[]).includes(r.agent)) continue;
    const agent = r.agent as Agent;
    if (db.prepare("SELECT 1 FROM agent_claims WHERE claim = ?").get(`decline:${r.transaction_id}`)) continue;
    const waiting = db.prepare("SELECT 1 FROM proposals WHERE kind = 'policy_change' AND status = 'PENDING_APPROVAL' AND created_by = ?").get(agent);
    if (waiting) continue;
    if (!claim(db, `decline:${r.transaction_id}`, o.by, now)) continue;
    const item = (r.purpose ?? "").replace(new RegExp(`^${r.merchant},\\s*`), "") || r.merchant;
    out.push(await meetDecline(db, {
      agent, transactionId: r.transaction_id, merchant: r.merchant, item, amountCents: r.amount_cents, reason: r.failure_reason ?? r.status,
      perTxCents: r.per_tx_cents, monthlyCents: r.monthly_cents, spentMonthCents: cardSpendCents(db, agent, now),
    }, { propose: (p) => proposeCardRaise(db, agent, { perTx: p.perTx, ...(p.monthly ? { monthly: p.monthly } : {}) }, p.reason, now) }, o.client === undefined ? undefined : o.client));
  }
  return out;
}

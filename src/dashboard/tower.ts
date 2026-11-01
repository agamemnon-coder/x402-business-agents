// Design 4.1 (Max, 1 Nov): the control tower. Money in on the left, the three agents with their live limits in the
// middle, money out on the right, the P&L below, and beside it who enforced each refusal: Purser before signing, Metal
// on chain, Airwallex at the card. Every figure comes from the ledger and carries the proof of its newest entry (a
// Metal transaction or an Airwallex id). Amounts on Metal are test dollars (*USDZ), on Airwallex euros: the two are
// shown side by side, never converted into each other.

import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";

export type Proof = { kind: "tx"; ref: string } | { kind: "awx"; ref: string } | null;
export interface Flow { label: string; rail: "metal" | "airwallex"; amount: string; unit: "USDZ" | "EUR"; count: number; proof: Proof; note: string }
export interface TowerAgent {
  agent: "sourcing" | "support" | "treasury";
  status: "active" | "paused" | "stopped";
  mandate: { cap: string; budget: string; spent: string; pending: string; remaining: string; used_pct: number } | null;
  card: { spent_month: string; monthly: string; used_pct: number; frozen: boolean } | null;
  last: { by: "claude" | "fallback" | "idle"; text: string; at: string } | null;
}
export interface Enforcer { who: "purser" | "metal" | "airwallex"; count: number; last: { reason: string; at: string; proof: Proof } | null }
export interface Tower {
  money_in: Flow[];
  agents: TowerAgent[];
  money_out: Flow[];
  pnl: { usdz: { sales: string; upstream: string; refunds: string; net: string }; eur: { card_spend: string; payouts: string; fees: string; out: string } };
  enforced: Enforcer[];
}

export interface TowerInputs {
  budgets: { agent: string; cap: string; budget: string; spent: string; pending: string; remaining: string }[];
  cards: { agent: string; spent_month: string; monthly: string; frozen: boolean; single_use: boolean }[];
}

const AGENTS = ["sourcing", "support", "treasury"] as const;
const n = (db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Record<string, number | string | null> | undefined;
const cents = (s: string) => Math.round(Number(s) * 100);
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

// An older or partial ledger may lack a table (cards, transfers): it then counts as empty, never as an error.
const has = (db: DB, sql: string) => {
  const t = /FROM (\w+)/.exec(sql)?.[1];
  return !t || !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
};

function flow(db: DB, label: string, rail: Flow["rail"], unit: Flow["unit"], sumSql: string, proofSql: string, kind: "tx" | "awx", note = ""): Flow {
  const s = (has(db, sumSql) ? n(db, sumSql) : undefined) ?? {};
  const p = has(db, proofSql) ? n(db, proofSql) : undefined;
  const ref = p ? Object.values(p)[0] : null;
  return { label, rail, unit, amount: fromCents(Number(s.s ?? 0)), count: Number(s.c ?? 0), proof: ref ? { kind, ref: String(ref) } : null, note };
}

export function towerView(db: DB, inp: TowerInputs): Tower {
  const money_in: Flow[] = [
    flow(db, "Stock checks sold", "metal", "USDZ", "SELECT SUM(price_cents) AS s, COUNT(*) AS c FROM sales WHERE status = 'DELIVERED'", "SELECT tx_hash FROM sales WHERE status = 'DELIVERED' AND tx_hash IS NOT NULL ORDER BY sale_id DESC LIMIT 1", "tx", "paid by customers' agents per query, over x402"),
    flow(db, "Booked at Airwallex", "airwallex", "USDZ", "SELECT SUM(CAST(amount_base_units AS REAL) / 1e16) AS s, COUNT(*) AS c FROM chain_credits WHERE awx_deposit_id IS NOT NULL", "SELECT awx_deposit_id FROM chain_credits WHERE awx_deposit_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", "awx", "earnings swept from Metal after finality, booked as a deposit (1 test USD = 1 USD, simulated deposit)"),
  ];
  const money_out: Flow[] = [
    flow(db, "Stock data bought", "metal", "USDZ", "SELECT SUM(price_cents) AS s, COUNT(*) AS c FROM upstream_purchases WHERE outcome = 'PAID'", "SELECT tx_hash FROM upstream_purchases WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY id DESC LIMIT 1", "tx", "from the stock-data suppliers, under the Sourcing mandate"),
    flow(db, "Refunds", "metal", "USDZ", "SELECT SUM(amount_cents) AS s, COUNT(*) AS c FROM refunds WHERE outcome = 'PAID'", "SELECT tx_hash FROM refunds WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY rowid DESC LIMIT 1", "tx", "to customers, under the Support mandate"),
    flow(db, "Card spend", "airwallex", "EUR", "SELECT SUM(amount_cents) AS s, COUNT(*) AS c FROM card_transactions WHERE approved = 1", "SELECT transaction_id FROM card_transactions WHERE approved = 1 ORDER BY occurred_at DESC LIMIT 1", "awx", "software on the agents' company cards"),
    flow(db, "Supplier payouts", "airwallex", "EUR", "SELECT SUM(CAST(ROUND(CAST(amount AS REAL) * 100) AS INTEGER)) AS s, COUNT(*) AS c FROM transfers WHERE status = 'PAID'", "SELECT transfer_id FROM transfers WHERE status = 'PAID' ORDER BY updated_at DESC LIMIT 1", "awx", "SWIFT, after the CFO's Face ID"),
  ];
  const feeSql = "SELECT SUM(CAST(ROUND(CAST(fee_actual AS REAL) * 100) AS INTEGER)) AS s FROM transfers WHERE status = 'PAID'";
  const fees = has(db, feeSql) ? Number(n(db, feeSql)?.s ?? 0) : 0;
  const v = (f: Flow) => cents(f.amount);
  const [sold] = money_in, [bought, refunded, cardSpend, payouts] = money_out;

  const agents: TowerAgent[] = AGENTS.map((agent) => {
    const b = inp.budgets.find((x) => x.agent === agent);
    const c = inp.cards.find((x) => x.agent === agent && !x.single_use);
    const d = n(db, "SELECT ts, json_extract(payload_json, '$.source') AS source, json_extract(payload_json, '$.summary') AS summary FROM audit_log WHERE event = 'agent.decision' AND actor = ? ORDER BY seq DESC LIMIT 1", agent);
    return {
      agent,
      status: frozen(db) || stopped(db, agent) ? "stopped" : paused(db, agent) ? "paused" : "active",
      mandate: b ? { cap: b.cap, budget: b.budget, spent: b.spent, pending: b.pending, remaining: b.remaining, used_pct: pct(cents(b.spent) + cents(b.pending), cents(b.budget)) } : null,
      card: c ? { spent_month: c.spent_month, monthly: c.monthly, used_pct: pct(cents(c.spent_month), cents(c.monthly)), frozen: c.frozen } : null,
      last: d ? { by: d.source === "claude" ? "claude" : d.source === "idle" ? "idle" : "fallback", text: String(d.summary ?? "").slice(0, 600), at: String(d.ts) } : null,
    };
  });

  const purser = db.prepare("SELECT ts, json_extract(payload_json, '$.reason') AS reason FROM audit_log WHERE event = 'upstream.refused' AND json_extract(payload_json, '$.reason') LIKE 'mandate!_%' ESCAPE '!' AND (json_extract(payload_json, '$.refused_by') = 'purser' OR (json_extract(payload_json, '$.refused_by') IS NULL AND json_extract(payload_json, '$.reason') LIKE '%:%')) ORDER BY seq DESC").all() as { ts: string; reason: string }[];
  // Metal's own refusals: recorded on chain (with a tx), or given by Metal's facilitator to a payment it saw. An older
  // row has no refused_by: a bare code came from Metal; Purser's own refusal always carries its detail after a colon.
  const metal = db.prepare(`SELECT ts, COALESCE(json_extract(payload_json, '$.metal_reason'), json_extract(payload_json, '$.reason')) AS reason, json_extract(payload_json, '$.tx') AS tx FROM audit_log
    WHERE event = 'upstream.refused_on_chain' OR (event = 'upstream.refused' AND (json_extract(payload_json, '$.refused_by') = 'metal'
      OR (json_extract(payload_json, '$.refused_by') IS NULL AND json_extract(payload_json, '$.reason') LIKE 'mandate!_%' ESCAPE '!' AND json_extract(payload_json, '$.reason') NOT LIKE '%:%'))) ORDER BY seq DESC`).all() as { ts: string; reason: string; tx: string | null }[];
  const awxSql = "SELECT occurred_at AS ts, failure_reason AS reason, transaction_id AS id FROM card_transactions WHERE approved = 0 ORDER BY occurred_at DESC";
  const awx = (has(db, awxSql) ? db.prepare(awxSql).all() : []) as { ts: string; reason: string; id: string }[];
  const enforced: Enforcer[] = [
    { who: "purser", count: purser.length, last: purser[0] ? { reason: purser[0].reason, at: purser[0].ts, proof: null } : null },
    { who: "metal", count: metal.length, last: metal[0] ? { reason: metal[0].reason, at: metal[0].ts, proof: metal[0].tx ? { kind: "tx", ref: metal[0].tx } : null } : null },
    { who: "airwallex", count: awx.length, last: awx[0] ? { reason: awx[0].reason, at: awx[0].ts, proof: { kind: "awx", ref: awx[0].id } } : null },
  ];

  return {
    money_in, agents, money_out,
    pnl: {
      usdz: { sales: sold!.amount, upstream: bought!.amount, refunds: refunded!.amount, net: fromCents(v(sold!) - v(bought!) - v(refunded!)) },
      eur: { card_spend: cardSpend!.amount, payouts: payouts!.amount, fees: fromCents(fees), out: fromCents(v(cardSpend!) + v(payouts!) + fees) },
    },
    enforced,
  };
}

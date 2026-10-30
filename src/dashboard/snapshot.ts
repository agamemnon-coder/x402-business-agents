// The dashboard's one data source: a read-only snapshot of the ledger, rebuilt on every poll. It makes no
// network call and writes nothing, so it can be served from a read-only handle while the agents run.
// Every text it returns is plain text; the page renders it with textContent only.

import { verifyAuditChain } from "../audit/log.js";
import { agentName } from "../config/brand.js";
import { FX_QUOTE_MAX_MARKUP_BPS, MANDATE_EXPIRES_IN_SECONDS, TOTAL_BUDGET_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { callCostMicros } from "../claude/pricing.js";
import { formatUnits } from "viem";
import { quarantineReason } from "../policy/quarantine.js";
import { cardLimits, frozen, policyValue } from "../policy/rules.js";
import { wantCardStatus } from "../policy/cards.js";
import { stopReason } from "../policy/velocity.js";
import { lastReconciliation } from "../finance/reconcile.js";
import { CARDS, MCC_WORDS, type Agent } from "../config/policy.js";
import { agentProfiles, type AgentProfile } from "../agents/profiles.js";

export type DashAgent = "sourcing" | "support" | "treasury" | "customer";

export interface Budget {
  agent: DashAgent;
  /** Who the mandate may pay. */
  payee: string;
  cap: string;
  budget: string;
  spent: string;
  remaining: string;
  /** Day the bound credential expires (bind time + the mandate term; exact to the day). */
  expires_on: string | null;
  /** Credentials this agent has held; spend carries over on replacement. */
  credentials: number;
  /** The CFO policy's limit per payment, inside the mandate's cap; null when only the mandate's cap applies. */
  policy_cap: string | null;
  /** The newest payment made under this mandate, as proof on the explorer; null before the first one. */
  last_tx: string | null;
}

export interface Pending {
  proposal_id: string;
  kind: string;
  title: string;
  summary: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  /** Past its expiry but not yet marked; the page shows it as closed, not as waiting. */
  expired: boolean;
  terms_sha256: string;
  review: { model: string | null; recommendation: string; text: string } | null;
}

export interface Decision {
  proposal_id: string;
  title: string;
  status: string;
  by: string | null;
  at: string;
}

export interface Refusal {
  seq: number;
  ts: string;
  agent: string;
  what: string;
  reason: string;
}

export interface FeedItem {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  text: string;
  tone: "ok" | "refusal" | "approval" | "info";
  model: string | null;
  tx: string | null;
  awx_id: string | null;
}

export interface CardTx {
  ts: string;
  merchant: string;
  purpose: string | null;
  amount: string;
  approved: boolean;
  /** Why Airwallex declined, in plain words; null when approved. */
  reason: string | null;
}

/** Summit's prepaid budget in Metal clearing, and what we earned there: kept apart from the mandates. */
export interface ClearingView {
  /** Who prepays (the customer's name). */
  customer: string;
  /** Summit's deposits into clearing (USDZ). */
  deposited: string;
  /** What the customer has paid by receipt, from Metal's balance (deposits less what it may still spend); includes
   * receipts made before this ledger started. Null before Metal's first balance read. */
  charged: string | null;
  /** Stock checks sold by clearing, and what they brought. */
  sales: number;
  earned: string;
  /** What Metal's clearing service last said each side may spend; null before the first read. */
  customer_spendable: string | null;
  seller_spendable: string | null;
  as_of: string | null;
  withdrawn: string;
}

/** An agent's company card (K2): the CFO policy's limits, and whether the card at Airwallex has them yet. */
export interface CardView {
  /** An own agent, or an outside one (ext:<name>, P1). */
  agent: string;
  /** How the dashboard names the card's holder. */
  name: string;
  last4: string;
  buys: string;
  per_tx: string;
  monthly: string;
  spent_month: string;
  left_month: string;
  in_sync: boolean;
  /** Frozen at Airwallex by the emergency stop. */
  frozen: boolean;
  /** What the card may pay at all, in words ("Advertising (MCC 7311) · EUR only · until 28 Jan 2027"), or "". */
  only: string;
  /** A task card (Ask Purser): Airwallex lets it pay once; its limit is in all, not per month. */
  single_use: boolean;
  recent: CardTx[];
}

export interface Snapshot {
  generated_at: string;
  world: { business: string | null; customer: string | null };
  audit: { rows: number; head: string | null; intact: boolean };
  budgets: { agents: Budget[]; counterparty: Budget | null; allocated: string; limit: string };
  treasury: {
    airwallex: null | {
      as_of: string;
      label: string;
      eur: { available: string; floor: string; committed: string; free: string };
      usd: { available: string; floor: string; headroom: string };
    };
    metal: {
      sales: string; upstream: string; refunds: string; net: string; swept: string; sell_price: string; upstream_price: string;
      /** B1: payments to the sweep wallet from unknown senders, held by Metal's receive policy (newest first). */
      quarantine: { receipt_id: string; from: string; amount: string; reason: string; status: string; tx: string }[];
    };
  };
  pending: Pending[];
  decisions: Decision[];
  refusals: Refusal[];
  feed: FeedItem[];
  cards: CardView[];
  clearing: ClearingView | null;
  /** The emergency stop, while it is on: who pulled it, when, and why. */
  frozen: { since: string; by: string; proposal_id: string; reason: string } | null;
  /** The latest daily reconciliation against Airwallex and Metal (finance item 5), or null before the first. */
  reconciliation: { at: string; checked: number; differences: number; skipped: string[] } | null;
  /** Agents stopped by code for breaking a velocity limit (security item 2); the CFO lifts each with Face ID. */
  stopped: { agent: string; since: string; reason: string }[];
  /** Top of the page: what the agents did alone, what waits for the CFO, what was blocked (J4). */
  counts: { alone: number; waiting: number; blocked: number };
  /** The same in money: what the agents spent alone, what waits for the CFO, what was stopped before it moved. */
  money: {
    card_spent_eur: string; card_limit_eur: string;
    chain_spent_usdz: string; chain_limit_usdz: string;
    waiting: number; waiting_eur: string; waiting_usdz: string;
    blocked_eur: string; blocked_usdz: string;
    /** What the blocked euros are: invoices stopped as possible fraud, and card attempts Airwallex declined. */
    blocked_fraud_eur: string; blocked_fraud_n: number; blocked_declined_eur: string; blocked_declined_n: number;
  };
  /**
   * Claude's part (D): calls per model with average latency and cost at list price, the cost per call, and the AI
   * cost per €1,000 of euro payments (approved card spend plus paid euro transfers). Costs in micro-dollars.
   */
  claude: {
    calls: number; fallbacks: number;
    models: { model: string; role: string; calls: number; avg_latency_ms: number | null; cost_usd_micros: number }[];
    cost_usd_micros: number; per_call_usd_micros: number | null;
    eur_paid: string; per_1000_eur_usd_micros: number | null;
  };
  /** Ask Purser (G): the latest chat messages, oldest first. */
  /** "you" is the CFO at the runner; "dashboard link" the phone or a viewer; "agent ext:…" an outside agent. */
  ask: { ts: string; from: string; text: string; proposal_id: string | null }[];
  /** F, the Agents page: each agent's job, models, limits and what waits for the CFO, from the CFO policy. */
  agents: AgentProfile[];
  /** The passkey every phone approval needs (first 8 characters of its id), and whether one can be enrolled now. */
  passkey: { credential: string | null; label: string | null; enrolled_at: string | null; enrolment_open: boolean };
}

type AuditRow = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string };
type P = Record<string, unknown>;

const TX = /^0x[0-9a-fA-F]{64}$/;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const hasTable = (db: DB, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const sum = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number | null }).n ?? 0;

export const PAYEE_NAMES: Record<string, string> = {
  supplier: "Stockline",
  customer: "Summit Outfitters",
  sweep: "Northwind sweep wallet",
  business: "Northwind Outdoor",
};

/** The unit of a CFO policy value: mandate limits are Metal's test dollars, card limits and floors are euros. */
function policyUnit(key: string): string {
  if (key.startsWith("cap.") || key.startsWith("counterparty:")) return "USDZ";
  if (key === "usd_floor") return "USD";
  if (key.startsWith("card.") || key.startsWith("approval.") || key === "eur_floor") return "EUR";
  return "";
}

/** Whose card it is, in words: "the Operations agent" for ours; an outside agent keeps its id, which the page names. */
const cardOwner = (agent: string) => (agentName(agent) !== agent ? `the ${agentName(agent)}` : `the ${agent} agent`);
const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const REFUSAL_WORDS: Record<string, string> = {
  mandate_cap_exceeded: "over the mandate's per-payment cap",
  mandate_budget_exceeded: "over the mandate's total budget",
  mandate_revoked: "the credential was revoked by a replacement",
  mandate_expired: "the mandate has expired",
  payee_not_allowed: "payee not allowed by the mandate",
};
const CALIBRATION = new Map([["usd_floor", "USD floor"], ["eur_obligations", "EUR already committed to other bills"]]);

/** Plain words for a refusal; the code itself goes with the feed item, for a tooltip, not into the sentence. */
const refusalWords = (code: string) => REFUSAL_WORDS[code] ?? (code || "no reason given");

const KIND_TITLES: Record<string, string> = {
  mandate_replace: "Mandate change",
  refund_batch: "Refund batch",
  invoice_payment: "Invoice payment",
  policy_change: "Policy change",
  payee_change: "Supplier bank details",
  agent_onboard: "Company card for an outside agent",
  task_card: "Task card",
  quarantine_release: "Held payment",
  dev_test: "Dev test (moves no money)",
};
export const kindTitle = (kind: string) => KIND_TITLES[kind] ?? kind.replace(/_/g, " ");

/** One line a person can read, built from the stored terms; the approval page shows every field. */
export function summarize(kind: string, termsJson: string): string {
  let t: P;
  try {
    t = JSON.parse(termsJson) as P;
  } catch {
    return "terms unreadable";
  }
  if (kind === "mandate_replace") {
    const steps = Array.isArray(t.steps) ? (t.steps as P[]) : [];
    const limits = steps.map((s) => `${str(s.agent)} cap ${str(s.cap)}, budget ${str(s.budget)}`).join("; ");
    return `Option ${str(t.option)}: sell at ${str(t.query_price)} (margin ${str(t.margin)} on ${str(t.upstream_price)}); ${limits}; total ${str(t.total_budget)}`;
  }
  if (kind === "refund_batch") {
    const refunds = Array.isArray(t.refunds) ? (t.refunds as P[]) : [];
    const total = refunds.reduce((a, r) => a + safeCents(str(r.amount)), 0);
    return `Refund ${refunds.length} sale${refunds.length === 1 ? "" : "s"}, ${fromCents(total)} USDZ in total, to the customer ${short(str(t.customer))}${t.dispute_id ? ` (dispute ${str(t.dispute_id)})` : ""}`;
  }
  if (kind === "invoice_payment") {
    const c = t.conversion as P | null | undefined;
    const fee = t.fee_max !== undefined ? `fee at most EUR ${str(t.fee_max)}` : `fee about EUR ${str(t.fee)}`;
    const fx = c ? `; first convert USD ${str(c.sell_amount)} to EUR ${str(c.buy_amount)} at ${str(c.client_rate)}` : "; paid from free EUR";
    return `Pay ${str(t.vendor)} EUR ${str(t.amount)} for invoice ${str(t.invoice_no)} by ${str(t.method) || "SWIFT"} to IBAN …${str(t.iban_last4)}${fx}; ${fee}`;
  }
  if (kind === "dev_test") return `${str(t.label)}: ${str(t.purpose)}`;
  if (kind === "payee_change") {
    const v = (t.verification ?? {}) as P;
    return `Pay ${str(t.vendor)} to the account ending ${str(t.new_iban).slice(-4)} instead of …${str(t.old_iban_last4)}; verified by ${str(v.by)}`;
  }
  if (kind === "quarantine_release") {
    return t.action === "return"
      ? `Return ${str(t.amount)} test USD held in quarantine to its sender ${str(t.originator)}`
      : `Accept ${str(t.amount)} test USD from ${str(t.originator)}, held in quarantine, into the sweep wallet`;
  }
  if (kind === "task_card") {
    const mccs = Array.isArray(t.merchant_categories) ? (t.merchant_categories as unknown[]).map(str).join(", ") : "";
    return `${str(t.label)} card, one purchase of at most EUR ${str(t.amount)} at merchant category ${mccs}, until ${str(t.valid_until).slice(0, 10)}: ${str(t.purpose)}`;
  }
  if (kind === "agent_onboard") {
    const c = (t.card ?? {}) as P;
    return `Issue ${str(t.display_name)} (outside agent ${str(t.agent_id)}) a virtual company card: at most ${str(c.per_tx)} EUR per purchase and ${str(c.monthly)} EUR per month, for ${str(t.purpose)}`;
  }
  if (kind === "policy_change") {
    const changes = Array.isArray(t.changes) ? (t.changes as P[]) : [];
    return changes.map((c) => `${str(c.label)}: ${str(c.from) || "no extra limit"} → ${str(c.to) || "no extra limit"}`).join("; ");
  }
  return kindTitle(kind);
}

/** "max (passkey k_EWzUuv)" approving by passkey reads as "Max · Face ID"; other approvers as recorded. */
export function approverName(approver: string, method: string | null | undefined): string {
  if (method !== "passkey") return approver;
  // E1: two people ("max (passkey …) + anna (passkey …)") read as "Max & Anna · Face ID".
  const names = approver.split(" + ").map((a) => a.split(" (")[0] ?? a).map((n) => `${n.charAt(0).toUpperCase()}${n.slice(1)}`);
  return `${names.join(" & ")} · Face ID`;
}

function safeCents(s: string): number {
  try {
    return toCents(s);
  } catch {
    return 0;
  }
}

/** The stored Opus review reads "[model] RECOMMENDATION: text". */
export function parseReview(explanation: string | null): Pending["review"] {
  if (!explanation) return null;
  const m = /^\[([^\]]+)\]\s+([A-Z_]+):\s*([\s\S]*)$/.exec(explanation);
  if (!m) return { model: null, recommendation: "note", text: explanation };
  return { model: m[1] === "no model" ? null : m[1]!, recommendation: m[2]!.toLowerCase(), text: m[3]!.trim() };
}

function budgets(db: DB, rows: AuditRow[], roleOf: (address: string) => string | undefined) {
  const spentCents: Record<DashAgent, number> = {
    sourcing: sum(db, "SELECT SUM(price_cents) AS n FROM upstream_purchases WHERE outcome = 'PAID'"),
    support: sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome = 'PAID'"),
    treasury: sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome = 'PAID'"),
    customer: sum(db, "SELECT SUM(price_cents) AS n FROM sales WHERE status = 'DELIVERED'"),
  };
  const current = new Map<DashAgent, { cap: string; budget: string; payee: string; at: string; credentials: number }>();
  for (const r of rows) {
    if (r.event !== "mandate.bound" && r.event !== "mandate.replaced") continue;
    const agent = r.subject as DashAgent;
    if (!(agent in spentCents)) continue;
    const p = JSON.parse(r.payload_json) as P;
    const prev = current.get(agent);
    const payeeAddr = str(p.payee);
    const payee = payeeAddr ? PAYEE_NAMES[roleOf(payeeAddr) ?? ""] ?? short(payeeAddr) : prev?.payee ?? "";
    current.set(agent, { cap: str(p.cap), budget: str(p.budget), payee, at: r.ts, credentials: (prev?.credentials ?? 0) + 1 });
  }
  const one = (agent: DashAgent): Budget | null => {
    const m = current.get(agent);
    if (!m) return null;
    const spent = spentCents[agent];
    const day = new Date(Date.parse(m.at) + MANDATE_EXPIRES_IN_SECONDS * 1000);
    return {
      agent, payee: m.payee, cap: m.cap, budget: m.budget, spent: fromCents(spent),
      remaining: signed(safeCents(m.budget) - spent), expires_on: isNaN(day.getTime()) ? null : day.toISOString().slice(0, 10),
      credentials: m.credentials,
      policy_cap: agent === "customer" ? null : policyValue(db, `cap.${agent}`) || null,
      last_tx: lastTx(db, agent),
    };
  };
  const agents = (["sourcing", "support", "treasury"] as const).map(one).filter((b): b is Budget => b !== null);
  return {
    agents,
    counterparty: one("customer"),
    allocated: fromCents(agents.reduce((a, b) => a + safeCents(b.budget), 0)),
    limit: fromCents(TOTAL_BUDGET_CENTS),
  };
}

/** Where each mandate's payments are recorded: purchases from the supplier, refunds, sweeps and the customer's buys. */
const LAST_TX_SQL: Record<DashAgent, string> = {
  sourcing: "SELECT tx_hash AS tx FROM upstream_purchases WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY id DESC LIMIT 1",
  support: "SELECT tx_hash AS tx FROM refunds WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY refund_id DESC LIMIT 1",
  treasury: "SELECT tx_hash AS tx FROM sweeps WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  customer: "SELECT tx_hash AS tx FROM sales WHERE tx_hash IS NOT NULL ORDER BY sale_id DESC LIMIT 1",
};
function lastTx(db: DB, agent: DashAgent): string | null {
  const r = db.prepare(LAST_TX_SQL[agent]).get() as { tx: string } | undefined;
  return r && /^0x[0-9a-fA-F]{64}$/.test(r.tx) ? r.tx : null;
}

function setting(db: DB, key: string): string | null {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

function treasury(db: DB): Snapshot["treasury"] {
  const snap = db.prepare("SELECT taken_at, label, json FROM balance_snapshots ORDER BY id DESC LIMIT 1").get() as { taken_at: string; label: string; json: string } | undefined;
  let airwallex: Snapshot["treasury"]["airwallex"] = null;
  if (snap) {
    const b = JSON.parse(snap.json) as Record<string, { availableCents: number } | undefined>;
    const eur = b.EUR?.availableCents ?? 0;
    const usd = b.USD?.availableCents ?? 0;
    const eurFloor = safeCents(setting(db, "eur_floor") ?? "0.00");
    const committed = safeCents(setting(db, "eur_obligations") ?? "0.00");
    const usdFloor = safeCents(setting(db, "usd_floor") ?? "0.00");
    airwallex = {
      as_of: snap.taken_at, label: snap.label,
      eur: { available: fromCents(eur), floor: fromCents(eurFloor), committed: fromCents(committed), free: signed(eur - eurFloor - committed) },
      usd: { available: fromCents(usd), floor: fromCents(usdFloor), headroom: signed(usd - usdFloor) },
    };
  }
  const sales = sum(db, "SELECT SUM(price_cents) AS n FROM sales WHERE status = 'DELIVERED'");
  const upstream = sum(db, "SELECT SUM(price_cents) AS n FROM upstream_purchases WHERE outcome = 'PAID'");
  const refunds = sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome = 'PAID'");
  const swept = sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome = 'PAID'");
  return {
    airwallex,
    metal: {
      sales: fromCents(sales), upstream: fromCents(upstream), refunds: fromCents(refunds), net: signed(sales - upstream - refunds),
      swept: fromCents(swept), sell_price: setting(db, "sell_price") ?? "0.05", upstream_price: setting(db, "upstream_price") ?? "0.02",
      quarantine: hasTable(db, "quarantines") ? (db.prepare("SELECT receipt_id, originator, amount_units, reason, status, tx_hash FROM quarantines ORDER BY created_at DESC, rowid DESC LIMIT 10").all() as
        { receipt_id: string; originator: string; amount_units: string; reason: number; status: string; tx_hash: string }[])
        .map((q) => ({ receipt_id: q.receipt_id, from: q.originator, amount: formatUnits(BigInt(q.amount_units), 18), reason: quarantineReason(q.reason), status: q.status, tx: q.tx_hash })) : [],
    },
  };
}

const DECLINE_WORDS: Record<string, string> = {
  LIMIT_EXCEEDED: "over the card's limit",
  SINGLE_USE_SPENT: "the card was single-use and is spent",
  MERCHANT_CATEGORY_NOT_ALLOWED: "this card may not pay this kind of merchant",
  CURRENCY_NOT_ALLOWED: "this card may not pay in this currency",
  CARD_INACTIVE: "the card is frozen",
  CARD_NOT_ACTIVE: "the card is not active",
  INSUFFICIENT_FUNDS: "not enough money on the account",
};
/** Merchant categories in words: the ones Purser's cards use. */
const onlyWords = (c: { allowed_mccs: string; allowed_currencies: string; active_to: string | null }) => {
  const parts = [
    c.allowed_mccs ? c.allowed_mccs.split(",").map((m) => `${MCC_WORDS[m] ?? "Category"} (MCC ${m})`).join(", ") : "",
    c.allowed_currencies ? `${c.allowed_currencies.split(",").join(", ")} only` : "",
    c.active_to ? `until ${new Date(c.active_to).toISOString().slice(0, 10)}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
};
/** "on the Sales agent's card •••• 1234", or for a task card (Ask Purser) "on task card •••• 1234 (P-0011)". */
const onCard = (agent: string, last4: string) => (agent.startsWith("task:") ? `on task card •••• ${last4} (${agent.slice(5)})` : `on ${cardOwner(agent)}'s card •••• ${last4}`);
const declineWords = (code: string) => DECLINE_WORDS[code] ?? (code.toLowerCase().replace(/_/g, " ") || "no reason given");
const limitWords = (s: string) => {
  const [per, month] = s.split(" / ");
  return month ? `up to ${per} EUR per purchase, ${month} EUR a month` : s;
};

/** Ledgers from before the cards have no card tables; the read-only dashboard must not fail on them. */
function cards(db: DB, now: Date): CardView[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get()) return [];
  const month = now.toISOString().slice(0, 7);
  const rows = db.prepare("SELECT agent, last4, per_tx_cents, monthly_cents, status, allowed_mccs, allowed_currencies, active_to FROM cards ORDER BY agent").all() as
    { agent: string; last4: string; per_tx_cents: number; monthly_cents: number; status: string; allowed_mccs: string; allowed_currencies: string; active_to: string | null }[];
  // An outside agent (P1) shows under its own name, with what its card is for.
  const outside = new Map((db.prepare("SELECT agent_id, display_name, purpose FROM external_agents").all() as { agent_id: string; display_name: string; purpose: string }[]).map((x) => [x.agent_id, x]));
  // A task card (Ask Purser) shows as what it is for: "Flight task card (P-0011)", single use.
  const tasks = new Map((db.prepare("SELECT task_id, kind, purpose FROM task_cards").all() as { task_id: string; kind: string; purpose: string }[]).map((x) => [x.task_id, x]));
  return rows.map((c) => {
    const want = cardLimits(db, c.agent);
    const spent = (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM card_transactions WHERE agent = ? AND approved = 1 AND substr(occurred_at, 1, 7) = ?").get(c.agent, month) as { n: number }).n;
    const ext = outside.get(c.agent);
    const task = tasks.get(c.agent);
    const recent = (db.prepare("SELECT occurred_at, merchant, purpose, amount_cents, approved, failure_reason, status FROM card_transactions WHERE agent = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 6").all(c.agent) as
      { occurred_at: string; merchant: string; purpose: string | null; amount_cents: number; approved: number; failure_reason: string | null; status: string }[])
      .map((t) => ({ ts: t.occurred_at, merchant: t.merchant, purpose: t.purpose, amount: fromCents(t.amount_cents), approved: t.approved === 1, reason: t.approved === 1 ? null : declineWords(t.failure_reason ?? t.status) }));
    return {
      agent: c.agent, name: ext ? `${ext.display_name} (outside agent)` : task ? `${capFirst(task.kind)} task card (${c.agent.slice(5)})` : agentName(c.agent), last4: c.last4,
      buys: ext ? ext.purpose : task ? `${task.purpose} · single use` : (CARDS[c.agent as Agent]?.buys ?? ""), per_tx: fromCents(want.perTxCents), monthly: fromCents(want.monthlyCents),
      spent_month: fromCents(spent), left_month: signed(want.monthlyCents - spent),
      in_sync: c.per_tx_cents === want.perTxCents && c.monthly_cents === want.monthlyCents && c.status === wantCardStatus(db, c.agent),
      frozen: c.status === "INACTIVE", only: onlyWords(c), single_use: !!task, recent,
    };
  });
}

function frozenView(db: DB, rows: AuditRow[]): Snapshot["frozen"] {
  if (!frozen(db)) return null;
  const on = [...rows].reverse().find((r) => r.event === "policy.changed" && r.subject === "freeze");
  const p = on ? (JSON.parse(on.payload_json) as P) : {};
  const id = str(p.proposal_id);
  const a = db.prepare("SELECT approver, method FROM approvals WHERE proposal_id = ?").get(id) as { approver: string; method: string } | undefined;
  const terms = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string } | undefined;
  const reason = terms ? str((JSON.parse(terms.terms_json) as P).reason) : "";
  const who = a ? approverName(a.approver, a.method) : "";
  const name = (who.split(" · ")[0] ?? who).split(" (")[0] ?? "";
  return { since: on?.ts ?? "", by: name ? name.charAt(0).toUpperCase() + name.slice(1) : "the CFO", proposal_id: id, reason };
}

function clearingView(db: DB): ClearingView | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'clearing_ops'").get()) return null;
  const hasScheme = (db.prepare("PRAGMA table_info(sales)").all() as { name: string }[]).some((c) => c.name === "scheme");
  const ops = db.prepare("SELECT party, kind, units, created_at FROM clearing_ops ORDER BY id").all() as { party: string; kind: string; units: string; created_at: string }[];
  const sold = hasScheme ? (db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(price_cents), 0) AS c FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'").get() as { n: number; c: number }) : { n: 0, c: 0 };
  if (ops.length === 0 && sold.n === 0) return null;
  const cents = (u: string) => Number(BigInt(u) / 10n ** 16n);
  const total = (party: string, kind: string) => ops.filter((o) => o.party === party && o.kind === kind).reduce((s, o) => s + cents(o.units), 0);
  const last = (party: string) => [...ops].reverse().find((o) => o.party === party && o.kind === "balance");
  const asOf = [last("customer")?.created_at, last("seller")?.created_at].filter(Boolean).sort().at(-1) ?? null;
  return {
    customer: PAYEE_NAMES.customer!, deposited: fromCents(total("customer", "deposit")),
    charged: last("customer") ? fromCents(total("customer", "deposit") - cents(last("customer")!.units)) : null,
    sales: sold.n, earned: fromCents(sold.c),
    customer_spendable: last("customer") ? fromCents(cents(last("customer")!.units)) : null,
    seller_spendable: last("seller") ? fromCents(cents(last("seller")!.units)) : null,
    as_of: asOf, withdrawn: fromCents(total("seller", "withdraw")),
  };
}

const MODEL_NAMES: [RegExp, string][] = [[/haiku/i, "Haiku"], [/sonnet/i, "Sonnet"], [/opus/i, "Opus"]];
export const modelName = (m: string | null | undefined): string | null => {
  if (!m) return null;
  return MODEL_NAMES.find(([re]) => re.test(m))?.[1] ?? m;
};

const TASK_WORDS: Record<string, string> = {
  classify_document: "classified an incoming document",
  extract_price_notice: "read the supplier's price notice",
  extract_dispute: "read the customer's dispute email",
  extract_corrections: "read the supplier's data correction",
  extract_invoice: "read the invoice",
  draft_customer_reply: "drafted the reply to the customer (a person sends it)",
};

/** Plain words for one audit row. Ids and hashes go in their own fields, never into the sentence's links. */
export function describe(r: AuditRow, saleOf: (id: string) => { seq: number; price: number } | undefined): Omit<FeedItem, "seq" | "ts" | "actor" | "event"> {
  const p = JSON.parse(r.payload_json) as P;
  const tx = TX.test(str(p.tx)) ? str(p.tx) : null;
  const s = str(r.subject);
  const base = { model: null as string | null, tx, awx_id: null as string | null };
  const out = (text: string, tone: FeedItem["tone"] = "info", extra: Partial<typeof base> = {}) => ({ ...base, ...extra, text, tone });
  switch (r.event) {
    case "business.funded": return out(`Business account funded with ${str(p.amount)} USDZ`, "ok");
    case "mandate.bound": return out(`${s} mandate bound on chain: up to ${str(p.cap)} per payment, ${str(p.budget)} in total`, "ok");
    case "mandate.replaced": return out(`${s} mandate replaced (${str(p.proposal_id)}, step ${str(p.step)}): up to ${str(p.cap)} per payment, ${str(p.budget)} in total`, "ok");
    case "upstream.paid":
    case "upstream.paid_after_lookup": {
      const price = p.amount_units ? fromCents(baseUnitsToCents(BigInt(str(p.amount_units)))) : "";
      return out(`Bought stock check #${str(p.seq)} from Stockline${price ? ` for ${price} USDZ` : ""}${r.event === "upstream.paid_after_lookup" ? " (found by lookup, not paid twice)" : ""}`, "ok");
    }
    case "upstream.refused": {
      const reason = str(p.reason);
      return reason.startsWith("policy_cap_exceeded")
        ? out(`Purchase of stock check #${str(p.seq)} refused by the CFO policy before signing: ${reason.slice(reason.indexOf(":") + 1).trim().replace(/\b(\d+\.\d{2})\b/g, "$1 USDZ")}`, "refusal")
        : out(`Purchase of stock check #${str(p.seq)} refused on chain: ${refusalWords(reason)}`, "refusal");
    }
    case "policy.changed": {
      const unit = policyUnit(str(p.key));
      const v = (x: unknown) => (str(x) ? `${str(x)}${unit && /^\d+\.\d{2}$/.test(str(x)) ? ` ${unit}` : ""}` : "no extra limit");
      return out(`CFO policy: ${str(p.label)} changed from ${v(p.from)} to ${v(p.to)} (${str(p.proposal_id)})`, "approval");
    }
    case "upstream.in_doubt": return out(`Purchase of stock check #${str(p.seq)} unconfirmed; it is looked up before any retry`, "refusal");
    case "sale.delivered": {
      const sale = saleOf(s);
      const how = str(p.scheme) === "bajillion" ? " by Metal clearing (a receipt, no transaction)" : "";
      return out(sale ? `Sold stock check #${sale.seq} to Summit Outfitters for ${fromCents(sale.price)} USDZ${how}` : `Sale ${s} delivered${how}`, "ok");
    }
    case "sale.settle_failed": return out(`A sale did not settle; the customer was not charged (${str(p.error)})`, "refusal");
    // The sandbox starts with millions; the floors calibrated against it are not this business's money, so no numbers.
    case "setting.changed": return CALIBRATION.has(s)
      ? out(`Treasury set the ${CALIBRATION.get(s)} against the Airwallex sandbox balance`)
      : out(`${s.replace(/_/g, " ")} set to ${str(p.after)}${p.before ? ` (was ${str(p.before)})` : ""}`);
    case "claude.read": {
      const task = s;
      const o = (p.output ?? {}) as P;
      let what = TASK_WORDS[task] ?? task.replace(/_/g, " ");
      if (task === "classify_document" && o.kind) what = `classified an incoming document as ${str(o.kind).replace(/_/g, " ")}`;
      if (task === "explain_invoice_fraud") what = `explained the blocked invoice to the CFO: ${str(o.recommendation).replace(/_/g, " ") || "see the ledger"} (advisory)`;
      else if (task.startsWith("review_")) what = `reviewed a ${task.slice(7).replace(/_/g, " ")} proposal: ${str(o.recommendation).replace(/_/g, " ") || "see the approval page"} (advisory)`;
      return out(`Claude ${what}`, "info", { model: modelName(str(p.model)) });
    }
    case "claude.fallback": return out(`Claude was not used for ${s.replace(/_/g, " ")}; the deterministic parser decided (${str(p.note)})`, "info", { model: modelName(str(p.model)) });
    case "claude.rejected": return out(`Claude's answer for ${s.replace(/_/g, " ")} failed the code check and was not used`, "refusal", { model: modelName(str(p.model)) });
    case "proposal.created": return out(`${r.actor === "human" ? "Max" : `The ${r.actor} agent`} proposed ${s} (${kindTitle(str(p.kind)).toLowerCase()})`, "approval");
    case "price_rise.options": {
      const opts = Array.isArray(p.options) ? (p.options as P[]) : [];
      return out(`Priced the options: ${opts.map((o) => (o.sell === null ? `${str(o.id)} ${str(o.label)}` : `${str(o.id)} sell ${str(o.sell)} (margin ${str(o.margin)})`)).join(", ")}`, "approval");
    }
    case "proposal.approved": {
      const key = p.passkey && typeof p.passkey === "object" ? str((p.passkey as P).credential_id).slice(0, 8) : "";
      return out(`${approverName(str(p.approver), str(p.method)) || "A person"} approved ${s}${key ? "" : " by typed hash"}`, "approval");
    }
    case "proposal.cosigned": return out(`${approverName(str(p.approver), str(p.method))} approved ${s}: 1 of 2 (four eyes); it waits for a second person`, "approval");
    case "proposal.rejected": return out(`${approverName(str(p.approver), str(p.method)) || "A person"} rejected ${s}`, "refusal");
    case "proposal.executing": return out(`Running ${s}, after checking its terms are exactly what was approved`);
    case "proposal.executed": return out(`${s} executed`, "ok");
    case "proposal.failed": return out(`${s} failed: ${str(p.error) || "see the ledger"}`, "refusal");
    case "proposal.needs_reapproval": return out(`${s} needs a new approval: ${str(p.error)}`, "refusal");
    case "proposal.superseded": return out(`${s} closed: another option (${str(p.by)}) was approved`);
    case "proposal.expired": return out(`${s} expired: its terms can no longer be approved or run`, "refusal");
    case "approval.too_late": return out(`${str(p.approver) || "A person"} approved ${s} after it expired; nothing ran`, "refusal");
    case "refund.auto_approved": return out(`Refunds for sales ${(Array.isArray(p.sales) ? (p.sales as unknown[]) : []).map((x) => `#${str(x)}`).join(", ")} are within the automatic limits`, "ok");
    case "refund.paid": return out(`Refunded ${str(p.amount)} to Summit Outfitters for sale #${s} (${str(p.payment_id)})`, "ok");
    case "refund.already_paid": return out(`Retry of ${str(p.payment_id)}: already paid, nothing sent`, "ok");
    case "refund.refused":
    case "refund.held": return out(`Refund ${str(p.payment_id)} ${r.event.split(".")[1]}: ${refusalWords(str(p.reason))}`, "refusal");
    case "sweep.paid": return out(`Swept ${str(p.amount)} USDZ of earnings to the sweep wallet (${s})`, "ok");
    case "sweep.refused":
    case "sweep.held":
    case "sweep.pending": return out(`Sweep ${s} ${r.event.split(".")[1]}: ${refusalWords(str(p.reason))}`, "refusal");
    case "credit.locked": return out(`Sweep final on chain (block ${str(p.block)} <= finalized ${str(p.finalized_block)}); credit locked once`, "ok");
    case "credit.deposited":
    case "credit.adopted": return out(`Booked in Airwallex: ${str(p.currency)} ${str(p.amount)} deposit, reference = the chain tx`, "ok", { awx_id: str(p.deposit_id) || null, tx: TX.test(str(p.reference)) ? str(p.reference) : tx });
    case "treasury.seeded": return out(`Airwallex sandbox seeded with ${str(p.currency)} ${str(p.amount)}`);
    case "invoice.escalated": return out(`Invoice ${s} escalated to a person: ${str(p.reason)}`, "refusal");
    case "document.injection_flagged": {
      const found = Array.isArray(p.findings) ? (p.findings as P[]) : [];
      const n = found.length;
      return out(`An incoming document (${s.replace(/_/g, " ")}) contains ${n} ${n === 1 ? "line" : "lines"} aimed at the AI; they were treated as data and changed nothing${found[0] ? `: "${str(found[0].excerpt)}"` : ""}`, "refusal");
    }
    case "invoice.fraud_suspected": {
      const blocking = (Array.isArray(p.signals) ? (p.signals as P[]) : []).filter((x) => x.blocks === true).map((x) => str(x.detail));
      return out(`Invoice ${s} from ${str(p.vendor)} for ${str(p.currency)} ${str(p.amount)} blocked: ${blocking.join("; ") || str(p.reason)}. Nothing was paid; a person must verify with the supplier by phone`, "refusal");
    }
    case "fx.converted": return out(`Converted ${str(p.sell)} into ${str(p.buy)} on the approved quote`, "ok", { awx_id: s || null });
    case "transfer.created": return out(`SWIFT transfer of ${str(p.amount)} created, approval hash in its metadata`, "ok", { awx_id: s || null });
    case "transfer.status": return out(`Transfer ${str(p.status)}`, str(p.status) === "PAID" ? "ok" : "info", { awx_id: s || null });
    case "transfer.fee": return out(`Airwallex fee ${str(p.fee)}, within the approved ceiling of ${str(p.fee_max)}`, "ok", { awx_id: s || null });
    case "transfer.fee_over_ceiling": return out(`Airwallex fee ${str(p.fee)} is above the approved ceiling of ${str(p.fee_max)}`, "refusal", { awx_id: s || null });
    case "transfer.ambiguous": return out(`Transfer answer lost; ${str(p.resolved)}`, "info");
    case "clearing.deposited": return out(`Summit put ${str(p.amount)} USDZ into Metal clearing: its prepaid budget for our stock checks`, "ok", { tx: TX.test(str(p.tx)) ? str(p.tx) : null });
    case "clearing.withdrawn": return out(`Our clearing earnings of ${str(p.amount)} USDZ went to the business account`, "ok", { tx: TX.test(str(p.tx)) ? str(p.tx) : null });
    case "sale.prepaid_not_offered": return out(`Prepaid clearing not offered for stock check #${s}: ${str(p.reason).replace(/^[a-z_]+: /, "")}; the buyer uses the mandate route`, "info");
    case "sale.prepaid_undelivered": return out(`Stock check #${s} was paid by clearing but not delivered (${str(p.reason)}); it is owed and refunded`, "refusal");
    case "reconcile.difference": return out(`Reconciliation: ${str(p.area)} ${s}: the ledger says ${str(p.ledger)}; ${str(p.area) === "metal" ? "the chain" : "Airwallex"} says ${str(p.outside)}. A person looks; nothing was changed`, "refusal");
    case "reconcile.done": return out(`Reconciled ${str(p.checked)} money flows against Airwallex and Metal: ${Number(p.differences) ? `${str(p.differences)} difference(s)` : "no differences"}`, Number(p.differences) ? "refusal" : "ok");
    case "fx.rate_checked": return out(`Before locking a quote for ${str(p.buy)}, checked the market's current rate: ${str(p.market_cost)} now, the quote ${str(p.quote_cost)} (${(Number(p.markup_bps) / 100).toFixed(2)}% apart; above ${(FX_QUOTE_MAX_MARKUP_BPS / 100).toFixed(2)}% it goes to the CFO)`);
    case "velocity.tripped": return out(`Stopped automatically: ${str(p.reason)}. Every payment it tries is refused until the CFO lifts the stop with Face ID`, "refusal");
    case "card.frozen": return out(`${str(p.why) === "velocity limit" ? "Velocity limit" : "Emergency stop"}: Airwallex froze ${cardOwner(str(p.agent))}'s card •••• ${str(p.last4)}`, "refusal");
    case "card.thawed": return out(`${capFirst(cardOwner(str(p.agent)))}'s card •••• ${str(p.last4)} is active again`, "approval");
    case "payee.change_requested": return out(`${str(p.vendor)}'s bank details: a change to a ${str(p.to_country)} account ending ${str(p.to_last4)} was requested (${s}); nothing changes until a person verifies it with the supplier and the CFO approves`, "approval");
    case "payee.change_verified": return out(`${str(p.by)} verified ${s} with ${str(p.vendor)}: ${str(p.how)}`, "approval");
    case "payee.changed": return out(`${str(p.vendor)} is now paid to the account ending ${str(p.to_last4)} (was …${str(p.from_last4)}), after verification and approval (${str(p.proposal_id)})`, "ok");
    case "receive_policy.set": return out("The sweep wallet now accepts test USD only from the business account; anything else is held by Metal in quarantine", "ok", { tx: str(p.txs).split(",")[0] || null });
    case "quarantine.held": return out(`Metal held ${str(p.amount)} test USD sent to the sweep wallet by an unknown sender ${short(str(p.from))} (${str(p.reason)}); it waits for you`, "refusal", { tx: str(p.tx) || null });
    case "quarantine.returned": return out(`The held ${str(p.amount)} test USD went back to its sender ${short(str(p.to))} (${str(p.proposal_id)})`, "approval", { tx: str(p.tx) || null });
    case "quarantine.accepted": return out(`The held ${str(p.amount)} test USD was accepted into the sweep wallet (${str(p.proposal_id)})`, "approval", { tx: str(p.tx) || null });
    case "card.issued":
      if (str(p.agent).startsWith("task:")) {
        return out(`Airwallex issued a single-use ${str(p.task)} card •••• ${str(p.last4)} for task ${str(p.agent).slice(5)}: at most ${str(p.limits).split(" / ")[0]} EUR, once, until ${str(p.valid_until).slice(0, 10)}`, "ok");
      }
      return out(`Airwallex issued ${cardOwner(str(p.agent))} a virtual Visa card •••• ${str(p.last4)}: ${limitWords(str(p.limits))}`, "ok");
    case "card.adopted": return out(`${capFirst(cardOwner(str(p.agent)))}'s Visa card •••• ${str(p.last4)} now follows the CFO policy`, "ok");
    case "card.limits_synced": return out(`Airwallex now has the CFO policy on ${cardOwner(str(p.agent))}'s card •••• ${str(p.last4)}: ${limitWords(str(p.to))} (was ${limitWords(str(p.from))})`, "approval");
    case "agent.card_requested": return out(`${str(p.name)}, an outside agent connected through the agent API, asks for a company card (${str(p.per_tx)} EUR per purchase, ${str(p.monthly)} EUR per month) for ${str(p.purpose)}; nothing is issued until the CFO approves ${str(p.proposal_id)}`, "approval");
    case "card.purchase_started":
      if (str(p.agent).startsWith("task:")) return out(`Booking at ${str(p.merchant)} for ${str(p.amount)} EUR ${onCard(str(p.agent), str(p.last4))}`);
      return out(`Subscribing to ${str(p.merchant)} (${str(p.plan ?? p.description)}) for ${str(p.amount)} EUR on its card •••• ${str(p.last4)}`);
    case "card.charge_approved": return out(`Airwallex approved ${str(p.amount)} EUR at ${str(p.merchant)} ${onCard(str(p.agent), str(p.last4))}`, "ok", { awx_id: s || null });
    case "card.charge_declined": return out(`Airwallex declined ${str(p.amount)} EUR at ${str(p.merchant)} ${onCard(str(p.agent), str(p.last4))}: ${declineWords(str(p.reason))}`, "refusal", { awx_id: s || null });
    case "card.duplicate_merged": return out(`A card authorisation recorded twice (Airwallex names it by two ids) was merged into one: ${str(p.amount)} ${str(p.currency)}`);
    case "card.charge_reversed": return out(`Airwallex reversed ${str(p.amount)} EUR at ${str(p.merchant)} ${onCard(str(p.agent), str(p.last4))}`, "refusal", { awx_id: s || null });
    case "passkey.enrolment_opened": return out("A one-time code to enrol a passkey was issued (valid 10 minutes)");
    case "passkey.enrolled": return out(`${str(p.label) || "A person"} enrolled passkey ${s.slice(0, 8)}; approvals now need it`, "ok");
    case "passkey.revoked": return out(`Passkey ${s.slice(0, 8)} revoked: replaced by ${str(p.replaced_by).slice(0, 8)}`);
    case "passkey.refused": return out(`Passkey approval${s ? ` of ${s}` : ""} refused: ${str(p.reason)}`, "refusal");
    case "passkey.enrol_refused": return out(`Passkey enrolment refused: ${str(p.reason)}`, "refusal");
    default: return out(`${r.event}${s ? ` ${s}` : ""}`);
  }
}

/** Stopped by a check or a person (payments refused on chain or by the card are counted from their own tables). */
const BLOCKED_EVENTS = new Set([
  "sale.settle_failed", "claude.rejected", "proposal.rejected", "refund.refused", "sweep.refused",
  "invoice.fraud_suspected", "document.injection_flagged", "passkey.refused", "velocity.tripped",
]);

/** The KPIs in money. Card amounts are EUR; Metal amounts *USDZ (test USD); they are never added together. */
const CLAUDE_ROLES: [RegExp, string, string][] = [
  [/haiku/i, "Haiku", "sorts each incoming document"],
  [/sonnet/i, "Sonnet", "reads documents into checked fields"],
  [/opus/i, "Opus", "reviews a proposal's risk for the CFO"],
];

function claudeView(db: DB, rows: AuditRow[]): Snapshot["claude"] {
  const per = CLAUDE_ROLES.map(([re, name, role]) => ({ re, name, role, version: "", calls: 0, latencies: [] as number[], cost: 0 }));
  let fallbacks = 0;
  for (const r of rows) {
    if (r.event === "claude.fallback") fallbacks++;
    if (r.event !== "claude.read") continue;
    const p = JSON.parse(r.payload_json) as P;
    const model = str(p.model);
    const m = per.find((x) => x.re.test(model));
    if (!m) continue;
    m.calls++;
    m.version ||= /-(\d+)-(\d+)$/.exec(model)?.slice(1).join(".") ?? "";
    if (typeof p.latency_ms === "number") m.latencies.push(p.latency_ms);
    // Older rows have usage but no cost: priced the same way, without cache writes (they were not recorded).
    const u = (p.usage ?? {}) as Record<string, number | undefined>;
    m.cost += typeof p.cost_usd_micros === "number" ? p.cost_usd_micros
      : callCostMicros(model, { input: u.input ?? 0, output: u.output ?? 0, cache_read: u.cache_read ?? 0, cache_write: u.cache_write ?? 0 }) ?? 0;
  }
  const calls = per.reduce((n, m) => n + m.calls, 0);
  const cost = per.reduce((n, m) => n + m.cost, 0);
  const hasCards = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get();
  const cardCents = hasCards ? sum(db, "SELECT SUM(amount_cents) AS n FROM card_transactions WHERE approved = 1 AND currency = 'EUR'") : 0;
  const transferCents = (db.prepare("SELECT amount FROM transfers WHERE status = 'PAID' AND currency = 'EUR'").all() as { amount: string }[])
    .reduce((n, t) => n + toCents(t.amount), 0);
  const eurCents = cardCents + transferCents;
  return {
    calls, fallbacks,
    models: per.filter((m) => m.calls > 0).map((m) => ({
      model: m.version ? `${m.name} ${m.version}` : m.name, role: m.role, calls: m.calls,
      avg_latency_ms: m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : null,
      cost_usd_micros: m.cost,
    })),
    cost_usd_micros: cost,
    per_call_usd_micros: calls ? Math.ceil(cost / calls) : null,
    eur_paid: fromCents(eurCents),
    // micro-dollars per €1,000 = cost / (cents / 100,000), rounded up.
    per_1000_eur_usd_micros: calls && eurCents ? Math.ceil((cost * 100_000) / eurCents) : null,
  };
}

function money(db: DB, rows: AuditRow[], live: { kind: string; proposal_id: string }[], now: Date): Snapshot["money"] {
  const hasCards = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get();
  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number | null }).c ?? 0;
  const month = now.toISOString().slice(0, 7);
  const cardSpent = hasCards ? one("SELECT SUM(amount_cents) AS c FROM card_transactions WHERE approved = 1 AND substr(occurred_at, 1, 7) = ?", month) : 0;
  const cardLimit = hasCards ? one("SELECT SUM(monthly_cents) AS c FROM cards") : 0;
  const b = budgets(db, rows, () => undefined);
  const chainSpent = b.agents.reduce((s, a) => s + toCents(a.spent), 0);
  let waitingEur = 0;
  let waitingUsdz = 0;
  for (const p of live) {
    const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { terms_json: string }).terms_json) as P;
    if (p.kind === "invoice_payment" && /^\d+\.\d{2}$/.test(str(t.amount))) waitingEur += toCents(str(t.amount));
    if (p.kind === "refund_batch" && /^\d+\.\d{2}$/.test(str(t.total))) waitingUsdz += toCents(str(t.total));
  }
  const fraudEur = rows.filter((r) => r.event === "invoice.fraud_suspected").reduce((s, r) => {
    const p = JSON.parse(r.payload_json) as P;
    return s + (str(p.currency) === "EUR" && /^\d+\.\d{2}$/.test(str(p.amount)) ? toCents(str(p.amount)) : 0);
  }, 0);
  const declinedEur = hasCards ? one("SELECT SUM(amount_cents) AS c FROM card_transactions WHERE approved = 0") : 0;
  const refusedUsdz = one("SELECT SUM(price_cents) AS c FROM upstream_purchases WHERE outcome = 'REFUSED'") + one("SELECT SUM(amount_cents) AS c FROM refunds WHERE outcome = 'REFUSED'");
  return {
    card_spent_eur: fromCents(cardSpent), card_limit_eur: fromCents(cardLimit),
    chain_spent_usdz: fromCents(chainSpent), chain_limit_usdz: b.limit,
    waiting: live.length, waiting_eur: fromCents(waitingEur), waiting_usdz: fromCents(waitingUsdz),
    blocked_eur: fromCents(fraudEur + declinedEur), blocked_usdz: fromCents(refusedUsdz),
    blocked_fraud_eur: fromCents(fraudEur), blocked_fraud_n: rows.filter((r) => r.event === "invoice.fraud_suspected").length,
    blocked_declined_eur: fromCents(declinedEur), blocked_declined_n: hasCards ? one("SELECT COUNT(*) AS c FROM card_transactions WHERE approved = 0") : 0,
  };
}

// The chat with Purser has its own panel (snapshot.ask).
/** Who sent a chat line. Lines from before asked_by was recorded came from the runner or the relay, as the CFO. */
const askFrom = (actor: string, by: string) => (actor.startsWith("ext:") ? `agent ${actor}` : by === "dashboard-link" ? "dashboard link" : "you");

const FEED_QUIET = new Set(["card.duplicate_merged", "ask.received", "ask.replied"]);

/** What the agents did alone (payments made inside their limits), and what a limit, a check or a person stopped. */
function counts(db: DB, rows: AuditRow[], waiting: number): Snapshot["counts"] {
  const hasCards = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const card = (approved: 0 | 1) => (hasCards ? n(`SELECT COUNT(*) AS n FROM card_transactions WHERE approved = ${approved}`) : 0);
  return {
    alone: n("SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED'") + n("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'")
      + n("SELECT COUNT(*) AS n FROM refunds WHERE outcome = 'PAID'") + n("SELECT COUNT(*) AS n FROM sweeps WHERE outcome = 'PAID'") + card(1),
    waiting,
    blocked: n("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'REFUSED'") + card(0) + rows.filter((r) => BLOCKED_EVENTS.has(r.event)).length,
  };
}

export const REFUSAL_EVENTS = new Set([
  "upstream.refused", "upstream.in_doubt", "sale.settle_failed", "claude.rejected", "proposal.rejected", "proposal.failed",
  "proposal.needs_reapproval", "proposal.expired", "approval.too_late", "refund.refused", "refund.held", "sweep.refused",
  "sweep.held", "invoice.escalated", "invoice.fraud_suspected", "document.injection_flagged", "transfer.fee_over_ceiling", "passkey.refused", "passkey.enrol_refused",
  "card.charge_declined", "card.charge_reversed", "sale.prepaid_undelivered", "velocity.tripped", "reconcile.difference",
]);

export const REFUSAL_WHAT: Record<string, string> = {
  "velocity.tripped": "Agent stopped: velocity limit",
  "reconcile.difference": "Reconciliation difference",
  "upstream.refused": "Supplier purchase refused",
  "upstream.in_doubt": "Supplier purchase unconfirmed",
  "sale.settle_failed": "Sale not settled",
  "claude.rejected": "Model answer rejected",
  "proposal.rejected": "Proposal rejected",
  "proposal.failed": "Execution stopped",
  "proposal.needs_reapproval": "Needs a new approval",
  "proposal.expired": "Proposal expired",
  "approval.too_late": "Late approval refused",
  "refund.refused": "Refund refused",
  "refund.held": "Refund held",
  "sweep.refused": "Sweep refused",
  "sweep.held": "Sweep held",
  "invoice.escalated": "Invoice escalated",
  "invoice.fraud_suspected": "Invoice blocked: possible fraud",
  "document.injection_flagged": "Planted instruction ignored",
  "transfer.fee_over_ceiling": "Fee above ceiling",
  "passkey.refused": "Passkey approval refused",
  "passkey.enrol_refused": "Passkey enrolment refused",
  "card.charge_declined": "Card purchase declined by Airwallex",
  "card.charge_reversed": "Card purchase reversed",
  "sale.prepaid_undelivered": "Prepaid sale owed",
};

const AGENT_OF: Record<string, string> = {
  "upstream.": "sourcing", "refund.": "support", "sweep.": "treasury", "invoice.": "treasury", "transfer.": "treasury", "sale.": "seller",
};

/** Ledgers from before passkeys have no passkey tables; the read-only dashboard must not fail on them. */
function passkeyInfo(db: DB, now: Date): Snapshot["passkey"] {
  const none = { credential: null, label: null, enrolled_at: null, enrolment_open: false };
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'passkeys'").get()) return none;
  const pk = db.prepare("SELECT credential_id, label, enrolled_at FROM passkeys WHERE status = 'ACTIVE'").get() as { credential_id: string; label: string; enrolled_at: string } | undefined;
  const open = (db.prepare("SELECT expires_at FROM passkey_enrolments WHERE status = 'OPEN'").all() as { expires_at: string }[])
    .some((w) => Date.parse(w.expires_at) > now.getTime());
  return pk ? { credential: pk.credential_id.slice(0, 8), label: pk.label, enrolled_at: pk.enrolled_at, enrolment_open: open } : { ...none, enrolment_open: open };
}

export function buildSnapshot(db: DB, now = new Date()): Snapshot {
  const rows = db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log ORDER BY seq").all() as AuditRow[];
  const accounts = db.prepare("SELECT address, role FROM metal_accounts").all() as { address: string; role: string }[];
  const roleOf = (address: string) => accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())?.role;
  const addressOf = (role: string) => accounts.find((a) => a.role === role)?.address ?? null;
  const salesById = new Map(
    (db.prepare("SELECT sale_id, price_cents, CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq FROM sales").all() as { sale_id: number; price_cents: number; seq: number }[])
      .map((s) => [String(s.sale_id), { seq: s.seq, price: s.price_cents }]),
  );
  const saleOf = (id: string) => salesById.get(id);
  const chain = verifyAuditChain(db);

  type PRow = { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; created_by: string; explanation: string | null; status: string; expires_at: string; created_at: string };
  const pending: Pending[] = (db.prepare("SELECT * FROM proposals WHERE status = 'PENDING_APPROVAL' ORDER BY created_at, proposal_id").all() as PRow[])
    .map((p) => ({
      proposal_id: p.proposal_id, kind: p.kind, title: kindTitle(p.kind), summary: summarize(p.kind, p.terms_json),
      created_by: p.created_by, created_at: p.created_at, expires_at: p.expires_at, expired: Date.parse(p.expires_at) <= now.getTime(),
      terms_sha256: p.terms_sha256, review: parseReview(p.explanation),
    }))
    .sort((a, b) => Number(a.expired) - Number(b.expired));

  const approvers = new Map((db.prepare("SELECT proposal_id, approver, method FROM approvals").all() as { proposal_id: string; approver: string; method: string }[])
    .map((a) => [a.proposal_id, approverName(a.approver, a.method)]));
  const lastChange = new Map<string, string>();
  for (const r of rows) if (r.event.startsWith("proposal.") || r.event === "approval.too_late") if (r.subject) lastChange.set(r.subject, r.ts);
  const decisions: Decision[] = (db.prepare("SELECT * FROM proposals WHERE status != 'PENDING_APPROVAL' ORDER BY created_at DESC, proposal_id DESC LIMIT 6").all() as PRow[])
    .map((p) => ({ proposal_id: p.proposal_id, title: kindTitle(p.kind), status: p.status, by: approvers.get(p.proposal_id) ?? null, at: lastChange.get(p.proposal_id) ?? p.created_at }));

  // Airwallex can report one card authorisation under two ids; once merged, it is listed once.
  const merged = new Set(rows.filter((r) => r.event === "card.duplicate_merged").map((r) => r.subject));
  const refusals: Refusal[] = rows.filter((r) => REFUSAL_EVENTS.has(r.event) && !(r.event.startsWith("card.charge_") && merged.has(r.subject))).reverse().slice(0, 30).map((r) => {
    const d = describe(r, saleOf);
    const agent = r.event === "velocity.tripped" && r.subject ? r.subject : Object.entries(AGENT_OF).find(([k]) => r.event.startsWith(k))?.[1] ?? r.actor;
    return { seq: r.seq, ts: r.ts, agent, what: REFUSAL_WHAT[r.event] ?? r.event, reason: d.text };
  });

  // Bookkeeping of our own (two ids for one card authorisation) stays in the audit log, not in the CFO's feed.
  const feed: FeedItem[] = rows.filter((r) => !FEED_QUIET.has(r.event) && !(r.event.startsWith("card.charge_") && merged.has(r.subject))).slice(-60).reverse().map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, ...describe(r, saleOf) }));

  return {
    generated_at: now.toISOString(),
    world: { business: addressOf("business"), customer: addressOf("customer") },
    audit: { rows: rows.length, head: rows.at(-1)?.row_hash ?? null, intact: chain.ok },
    budgets: budgets(db, rows, roleOf),
    treasury: treasury(db),
    pending,
    decisions,
    refusals,
    feed,
    cards: cards(db, now),
    clearing: clearingView(db),
    frozen: frozenView(db, rows),
    reconciliation: lastReconciliation(db),
    stopped: (db.prepare("SELECT key FROM settings WHERE key LIKE 'stop.%' AND value = 'on' ORDER BY key").all() as { key: string }[])
      .map((r) => r.key.slice("stop.".length)).map((agent) => ({ agent, ...stopReason(db, agent)! })),
    counts: counts(db, rows, pending.filter((p) => !p.expired).length),
    money: money(db, rows, pending.filter((p) => !p.expired), now),
    claude: claudeView(db, rows),
    ask: rows.filter((r) => r.event === "ask.received" || r.event === "ask.replied").slice(-8).map((r) => {
      const p = JSON.parse(r.payload_json) as P;
      return r.event === "ask.received"
        ? { ts: r.ts, from: askFrom(r.actor, str(p.asked_by)), text: str(p.message), proposal_id: null }
        : { ts: r.ts, from: "purser", text: str(p.reply), proposal_id: str(p.proposal_id) || null };
    }),
    passkey: passkeyInfo(db, now),
    agents: agentProfiles(db, now),
  };
}

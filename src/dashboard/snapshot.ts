// The dashboard's one data source: a read-only snapshot of the ledger, rebuilt on every poll. It makes no
// network call and writes nothing, so it can be served from a read-only handle while the agents run.
// Every text it returns is plain text; the page renders it with textContent only.

import { describeOrigin } from "../provenance/describe.js";
import { MONEY_EVENTS, parseOrigin } from "../provenance/origin.js";
import { flowEvents, type FlowEvent } from "./flows.js";
import { agentStats, type AgentStats, agentChat, type ChatLine } from "./agentStats.js";
import { agentTraces, type Trace } from "./trace.js";
import { verifyAuditChain } from "../audit/log.js";
import { agentName } from "../config/brand.js";
import { FX_QUOTE_MAX_MARKUP_BPS, MANDATE_EXPIRES_IN_SECONDS, TOTAL_BUDGET_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { AGENT_DISPLAY } from "../config/brand.js";
import { receivablesView, type ReceivablesView } from "../agents/receivables.js";
import { airwallexEventsView, type AirwallexEventsView } from "../policy/airwallexEvents.js";
import { spendReview, type SpendReview } from "../agents/spendReview.js";
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
import { booksView, type BooksView } from "../accounting/books.js";
import { disputeCases, type DisputeCase } from "../seller/desk.js";
import { CLAIM_WORDS, type DisputeClaim } from "../seller/disputeDesk.js";
import { eurInFlightCents, mandateAvailability } from "../policy/available.js";
import { heldCents } from "../policy/holds.js";
import { health, type Health } from "../ops/health.js";
import { railsView, type RailsView } from "./rails.js";
import { towerView, type Tower } from "./tower.js";

export type DashAgent = "sourcing" | "support" | "treasury" | "customer";

export interface Budget {
  agent: DashAgent;
  /** Who the mandate may pay. */
  payee: string;
  cap: string;
  budget: string;
  spent: string;
  /** Sent and not final (a pull pending or held on chain). */
  pending: string;
  /** Reserved for a payment being made right now. */
  held: string;
  /** budget − spent − pending − held. */
  remaining: string;
  /** Day the bound credential expires (bind time + the mandate term; exact to the day). */
  expires_on: string | null;
  /** Credentials this agent has held (bound, replaced, resumed after a pause); spend carries over on replacement. */
  credentials: number;
  /**
   * The bound credential's own budget, when it is not the mandate's budget above: after a resume Metal binds a fresh
   * credential with what was left (budget − spent), so the lifetime figures above stay what the CFO approved.
   */
  chain_budget: string | null;
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
  /** D24: for a money movement, who decided it, from the origin recorded with it (absent for older ledgers). */
  decided?: string;
  /** 4.1: the agent run this line belongs to (its trace in `traces`), or null. */
  trace: number | null;
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
      eur: { available: string; floor: string; committed: string; free: string; in_flight: string };
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
  /** 4.1: one timeline per agent decision, newest first (empty when the agents never ran). */
  traces: Trace[];
  /** D19: per agent, Claude's decisions and code's fallbacks (labelled), the Claude calls and what they cost. */
  agent_stats: AgentStats[];
  /** The autonomous agents' conversation (D19 block 4): world changes, labelled decisions, their messages. */
  agent_chat: ChatLine[];
  /** Design 4.1: the control tower (money in, the agents' live limits, money out, the P&L, who enforced each refusal). */
  tower: Tower;
  /** D23: the money flow, from the ledger's audit log (each movement with its proof). */
  flows: FlowEvent[];
  cards: CardView[];
  clearing: ClearingView | null;
  /** The emergency stop, while it is on: who pulled it, when, and why. */
  frozen: { since: string; by: string; proposal_id: string; reason: string } | null;
  /** The latest hourly reconciliation against Airwallex and Metal (finance item 5), or null before the first. */
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
    /** Declines whose purchase was paid later, after the CFO raised the limit: counted as stops, not as money kept out. */
    blocked_declined_later_paid_n?: number;
    /** Proposals the CFO rejected: counted among the stops. */
    blocked_rejected_n?: number;
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
    /** The agents' own decisions (src/agents/), per agent: runs, what they cost, how long one took. */
    agents: { agent: string; model: string; runs: number; cost_usd_micros: number; median_latency_ms: number | null }[];
  };
  /** Ask Purser (G): the latest chat messages, oldest first. */
  /** "you" is the CFO at the runner; "dashboard link" the phone or a viewer; "agent ext:…" an outside agent. */
  ask: { ts: string; from: string; text: string; proposal_id: string | null }[];
  /** F, the Agents page: each agent's job, models, limits and what waits for the CFO, from the CFO policy. */
  agents: AgentProfile[];
  /** The finance view: double-entry books from the GL journal (the same as npm run books); null for a ledger too old for it. */
  books: BooksView | null;
  /** The Dispute desk: each decided case, newest first (at most ten). */
  disputes: DisputeView[];
  /** Retailers' payments into the Airwallex Global Accounts, matched to invoices (src/agents/receivables.ts). */
  receivables: ReceivablesView;
  /** Card spend per merchant and category, with subscriptions flagged (src/agents/spendReview.ts). */
  card_spend: SpendReview;
  /** Airwallex's webhooks, each HMAC-checked twice and compared with the ledger (src/policy/airwallexEvents.ts). */
  airwallex_events: AirwallexEventsView;
  /** The passkey every phone approval needs (first 8 characters of its id), and whether one can be enrolled now. */
  passkey: { credential: string | null; label: string | null; enrolled_at: string | null; enrolment_open: boolean };
  /** Monitoring (B7): the alarms standing now and the numbers behind them; the relay's /health reads this. */
  health: Health;
  /** What Airwallex and Metal did, each with its proof (an Airwallex id or a Metal transaction). */
  rails: RailsView;
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
  ridgeline: "Ridgeline Data",
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

/** Whose card it is, in words: "the Sourcing agent" for ours; an outside agent keeps its id, which the page names. */
const cardOwner = (agent: string) => (agentName(agent) !== agent ? `the ${agentName(agent)}` : `the ${agent} agent`);
const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const REFUSAL_WORDS: Record<string, string> = {
  mandate_cap_exceeded: "over the mandate's per-payment cap",
  // Purser's hold while a mandate replace of the agent's mandate is open (src/policy/replaceHold.ts), not a mandate limit.
  replace_pending: "held while a mandate replace is open",
  mandate_budget_exceeded: "over the mandate's total budget",
  mandate_revoked: "the credential was revoked by a replacement",
  mandate_expired: "the mandate has expired",
  payee_not_allowed: "payee not allowed by the mandate",
  // Metal's own names for the rest (@metalntwx/metal-pay REFUSALS; test/contract/metal-facilitator.test.ts).
  mandate_budget_spent: "over the mandate's total budget",
  mandate_payee_not_listed: "payee not allowed by the mandate",
  mandate_payee_not_allowed: "payee not allowed by the mandate",
  mandate_not_bound: "no such mandate is bound on the account",
  mandate_bad_signature: "not signed by the mandate key",
  mandate_nonce_used: "this payment was already made or refused",
  mandate_outside_window: "outside the payment's validity window",
  mandate_outside_recurrence: "the mandate has not started yet, or its dates have ended",
  mandate_occurrences_used: "the mandate's payment count is used up",
};
const CALIBRATION = new Map([["usd_floor", "USD floor"], ["eur_obligations", "EUR already committed to other bills"]]);

/** Plain words for a refusal; the code itself goes with the feed item, for a tooltip, not into the sentence. */
/** A refusal in words: a bare code ("mandate_cap_exceeded"), or a code with its detail ("mandate_cap_exceeded: 0.04 is over …"). */
export const refusalWords = (reason: string): string => {
  const m = /^([a-z_]+): (.+)$/s.exec(reason);
  if (m && REFUSAL_WORDS[m[1]!]) return `${REFUSAL_WORDS[m[1]!]} (${m[2]})`;
  return REFUSAL_WORDS[reason] ?? (reason || "no reason given");
};

const KIND_TITLES: Record<string, string> = {
  owners_execute: "Mandate change signed on chain by both passkeys",
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

const MANDATE_AGENTS: readonly DashAgent[] = ["sourcing", "support", "treasury", "customer"];

function budgets(db: DB, rows: AuditRow[], roleOf: (address: string) => string | undefined) {
  const current = new Map<DashAgent, { cap: string; budget: string; payee: string; at: string; credentials: number; chainBudget: string | null }>();
  for (const r of rows) {
    if (r.event !== "mandate.bound" && r.event !== "mandate.replaced" && r.event !== "mandate.resumed") continue;
    const agent = r.subject as DashAgent;
    if (!MANDATE_AGENTS.includes(agent)) continue;
    const p = JSON.parse(r.payload_json) as P;
    const prev = current.get(agent);
    if (r.event === "mandate.resumed") {
      // A fresh credential with the paused one's cap and payees, what was left of its budget, and its expiry.
      if (prev) current.set(agent, { ...prev, credentials: prev.credentials + 1, chainBudget: str(p.budget) || null });
      continue;
    }
    const payeeAddr = str(p.payee);
    const payee = payeeAddr ? PAYEE_NAMES[roleOf(payeeAddr) ?? ""] ?? short(payeeAddr) : prev?.payee ?? "";
    current.set(agent, { cap: str(p.cap), budget: str(p.budget), payee, at: r.ts, credentials: (prev?.credentials ?? 0) + 1, chainBudget: null });
  }
  const one = (agent: DashAgent): Budget | null => {
    const m = current.get(agent);
    if (!m) return null;
    // Paid, pending and held from one place (src/policy/available.ts), the same the check against the chain reads.
    const av = mandateAvailability(db, agent);
    const spent = av.paidCents;
    const day = new Date(Date.parse(m.at) + MANDATE_EXPIRES_IN_SECONDS * 1000);
    return {
      agent, payee: m.payee, cap: m.cap, budget: m.budget, spent: fromCents(spent),
      // Available the same way everywhere: budget less paid, less sent-but-not-final, less held right now.
      pending: fromCents(av.pendingCents), held: fromCents(av.heldCents),
      remaining: signed(safeCents(m.budget) - spent - av.pendingCents - av.heldCents), expires_on: isNaN(day.getTime()) ? null : day.toISOString().slice(0, 10),
      credentials: m.credentials, chain_budget: m.chainBudget,
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
  // Mandate-route sales only (a clearing sale has no tx); the scheme is not named, so a ledger from before it still reads.
  customer: "SELECT tx_hash AS tx FROM sales WHERE status = 'DELIVERED' AND tx_hash IS NOT NULL ORDER BY sale_id DESC LIMIT 1",
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
    const inFlight = eurInFlightCents(db);
    airwallex = {
      as_of: snap.taken_at, label: snap.label,
      eur: { available: fromCents(eur), floor: fromCents(eurFloor), committed: fromCents(committed), free: signed(eur - eurFloor - committed - inFlight), in_flight: fromCents(inFlight) },
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
  CARD_CLOSED: "the card is closed (a single-use card closes after its one purchase)",
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
/** "on the Support agent's card •••• 1234", or for a task card (Ask Purser) "on task card •••• 1234 (P-0011)". */
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
      spent_month: fromCents(spent), left_month: signed(want.monthlyCents - spent - heldCents(db, c.agent, "card")),
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

const agentWho = (id: string): string => (id in AGENT_DISPLAY ? `the ${AGENT_DISPLAY[id as keyof typeof AGENT_DISPLAY].name}` : `agent ${id}`);

/** A refund the ledger holds under a dispute (refunds.dispute_id; one row per sale). */
export interface DisputeRefund { sale_id: number; amount_cents: number; outcome: string }
/** The refunds the ledger holds under a dispute, now. */
export type RefundsUnder = (disputeId: string) => DisputeRefund[];

/** The ledger's refunds by dispute, read once (review 2, MEDIUM 1). Undefined on a ledger that cannot say (no refunds
 *  table or column): a row then says nothing about refunds, rather than something the ledger does not back. */
export function refundsUnder(db: DB): RefundsUnder | undefined {
  let rows: (DisputeRefund & { dispute_id: string })[];
  try {
    rows = db.prepare("SELECT dispute_id, sale_id, amount_cents, outcome FROM refunds WHERE dispute_id IS NOT NULL ORDER BY sale_id").all() as typeof rows;
  } catch (e) {
    if (/no such (table|column)/.test((e as Error).message)) return undefined;
    throw e;
  }
  const by = new Map<string, DisputeRefund[]>();
  for (const r of rows) by.set(r.dispute_id, [...(by.get(r.dispute_id) ?? []), { sale_id: r.sale_id, amount_cents: r.amount_cents, outcome: r.outcome }]);
  return (id) => by.get(id) ?? [];
}

// Each refund outcome, in the escalation row's words and in this order; an amount is given where money was or may be
// on its way (a REFUSED refund paid nothing). PROPOSED: started, its pull's outcome not recorded (it may have reached
// Metal before a crash), so it is not called unsent.
const UNDER_WORDS: [outcome: string, words: string, amount: boolean][] = [
  ["PAID", "refunded", true], ["PENDING", "sent, not yet confirmed", true], ["HELD", "sent, held at Metal, not refunded yet", true],
  ["PROPOSED", "started, outcome not yet recorded", true], ["REFUSED", "refused (nothing paid)", false],
];

/** A dispute's refunds as the ledger holds them, by outcome: "none", or each outcome's sales and amount. */
function refundsUnderWords(refunds: DisputeRefund[], saleOf: (id: string) => { seq: number } | undefined): string {
  const name = (r: DisputeRefund) => { const seq = saleOf(String(r.sale_id))?.seq; return seq ? `#${seq}` : `sale ${r.sale_id}`; };
  // An outcome this list does not know is said as the ledger has it, never left out.
  const known = UNDER_WORDS.map(([o]) => o);
  const unknown = [...new Set(refunds.map((r) => r.outcome))].filter((o) => !known.includes(o)).map((o): [string, string, boolean] => [o, o.toLowerCase(), true]);
  const parts = [...UNDER_WORDS, ...unknown].flatMap(([outcome, w, amount]) => {
    const xs = refunds.filter((r) => r.outcome === outcome);
    return xs.length ? [`${xs.map(name).join(", ")} ${w}${amount ? ` (${fromCents(xs.reduce((n, r) => n + r.amount_cents, 0))} USDZ)` : ""}`] : [];
  });
  return `refunds under it so far: ${parts.join("; ") || "none"}`;
}

/** Plain words for one audit row. Ids and hashes go in their own fields, never into the sentence's links. */
/** A feed line; a money movement also says who decided it, from the origin recorded with it (D24) and nothing else.
 *  `refundsOf`: the ledger's refunds by dispute (refundsUnder), for the rows that state them. */
export function describe(r: AuditRow, saleOf: (id: string) => { seq: number; price: number } | undefined, refundsOf?: RefundsUnder): Omit<FeedItem, "seq" | "ts" | "actor" | "event" | "trace"> {
  const d = describeRow(r, saleOf, refundsOf);
  if (!MONEY_EVENTS.has(r.event)) return d;
  const p = JSON.parse(r.payload_json) as Record<string, unknown>;
  if (!("origin" in p)) return d; // a ledger recorded before origins existed: the line stays as it was
  const w = describeOrigin(parseOrigin(JSON.stringify(p.origin ?? null)));
  return { ...d, decided: w.decided, model: d.model ?? w.model };
}

function describeRow(r: AuditRow, saleOf: (id: string) => { seq: number; price: number } | undefined, refundsOf?: RefundsUnder): Omit<FeedItem, "seq" | "ts" | "actor" | "event" | "trace"> {
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
      const detail = () => reason.slice(reason.indexOf(":") + 1).trim();
      // dry-179: say which check refused. The agent's own buy policy and a supplier with no offer are not Purser's
      // refusals against the mandate (older rows logged them as Purser's: they are read by their reason here).
      if (reason.startsWith("buy_policy:")) return out(`Stock check #${str(p.seq)} not bought: the Sourcing agent's own buy policy (${detail()}); nothing was signed`, "refusal");
      if (reason.startsWith("supplier_unavailable:")) return out(`Stock check #${str(p.seq)} not bought: the supplier made no offer (${detail()}); nothing was signed`, "refusal");
      if (reason.startsWith("replace_pending:")) return out(`Purchase of stock check #${str(p.seq)} held by Purser before signing: ${detail()}`, "refusal");
      return reason.startsWith("policy_cap_exceeded")
        ? out(`Purchase of stock check #${str(p.seq)} refused by the CFO policy before signing: ${reason.slice(reason.indexOf(":") + 1).trim().replace(/\b(\d+\.\d{2})\b/g, "$1 USDZ")}`, "refusal")
        : str(p.refused_by) === "purser"
          ? out(`Purchase of stock check #${str(p.seq)} refused by Purser before signing, against the mandate: ${refusalWords(reason)}`, "refusal")
          : out(`Purchase of stock check #${str(p.seq)} refused on chain: ${refusalWords(reason)}`, "refusal");
    }
    case "upstream.refused_on_chain": return out(`Metal's mandate refused the same ${str(p.amount)} USDZ on chain and recorded it: ${str(p.metal_reason)}`, "refusal", { tx: /^0x[0-9a-f]{64}$/i.test(str(p.tx)) ? str(p.tx) : null });
    case "policy.changed": {
      const unit = policyUnit(str(p.key));
      const v = (x: unknown) => (str(x) ? `${str(x)}${unit && /^\d+\.\d{2}$/.test(str(x)) ? ` ${unit}` : ""}` : "no extra limit");
      return out(`CFO policy: ${str(p.label)} changed from ${v(p.from)} to ${v(p.to)} (${str(p.proposal_id)})`, "approval");
    }
    case "proposal.resumed": return out(`${s} resumed after a restart, from its last finished step; nothing done twice`, "info");
    case "holds.recovered": return out(`After a restart: ${str(p.settled)} hold(s) settled, ${str(p.released)} released, ${str(p.open)} still counted until resolved`, "info");
    case "upstream.in_doubt": return out(`Purchase of stock check #${str(p.seq)} unconfirmed; it is looked up before any retry`, "refusal");
    case "sale.delivered": {
      const sale = saleOf(s);
      const how = str(p.scheme) === "bajillion" ? " by Metal clearing (a receipt, no transaction)" : "";
      return out(sale ? `Sold stock check #${sale.seq} to Summit Outfitters for ${fromCents(sale.price)} USDZ${how}` : `Sale ${s} delivered${how}`, "ok");
    }
    case "sale.settlement_resolved": return str(p.outcome) === "CHARGED"
      ? out(`A customer payment of ${str(p.amount)} USDZ was charged with no delivery recorded (${str(p.tx) ? `tx ${str(p.tx).slice(0, 10)}…` : "no tx"}): owed back unless a person finds it was delivered`, "refusal")
      : out(str(p.outcome) === "DONE" ? `A sale's settlement was closed by the reconciliation (sale ${str(p.sale_id)})` : `A customer payment left being settled did not move: ${str(p.detail)}`);
    case "sale.settlement_left_open": return out(`Sale ${s} is recorded; its settlement row is left for the reconciliation to close (${str(p.error)})`);
    case "sale.settle_failed": return out(`A sale did not settle; the customer was not charged (${str(p.error)})`, "refusal");
    case "sale.refused": return out(`Customer query #${str(p.seq)} answered ${str(p.status)}: the stock check could not be bought, so the middleware did not settle and Summit Outfitters was not charged`, "refusal");
    case "query.answered": return out(`Customer query #${str(p.seq)}: Summit Outfitters got ${p.status === null ? "no answer" : `HTTP ${str(p.status)}`}; ${p.settled === true ? "its payment settled" : p.settled === false ? "its payment did not settle (not charged)" : "settlement unknown"}`, p.settled === true ? "ok" : "refusal");
    case "upstream.let_through": return out(`Defense in depth: purchase of stock check #${str(p.seq)} at ${str(p.amount)} USDZ, over the ${str(p.bound_cap)} cap, let through to Metal once (Purser would have refused it before signing)`, "info");
    case "upstream.let_through_refused": return out(str(p.label), "refusal");
    case "upstream.let_through_incident": return out(`INCIDENT: ${str(p.what)}; the Sourcing agent is stopped until the CFO lifts it with Face ID`, "refusal");
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
    // The agents (src/agents/): each decision in the agent's own words, and every call code refused.
    case "agent.tool": {
      const who = agentWho(str(p.agent));
      if (str(p.blocked_by) === "Metal mandate") return out(`Metal refused ${who}'s purchase against its on-chain mandate`, "refusal", { model: modelName(str(p.model)) });
      if (str(p.blocked_by).startsWith("mandate cap")) return out(`${capFirst(who)}'s purchase was refused before signing: over its mandate's cap`, "refusal", { model: modelName(str(p.model)) });
      return out(`Code refused ${who}'s ${str(p.tool).replace(/_/g, " ")}: ${str(p.blocked_by)}`, "refusal", { model: modelName(str(p.model)) });
    }
    case "agent.nudged": return out(`Code sent ${agentWho(str(p.agent))} back, not finished: ${str(p.reason)}`, "info", { model: modelName(str(p.model)) });
    case "price_rise.met": return str(p.source) === "claude"
      ? out(`The Sourcing agent told the Treasury agent: "${str(p.message)}"`, "info", { model: modelName(str(p.model)) })
      : out("The Sourcing agent's model was not available; code served the next query as before", "info");
    // Block 5.1: the rail per purchase. The choice is the agent's (or code's fallback); the supplier's rails are code's check.
    case "purchase.rail_chosen": {
      const rail = str(p.rail) === "metal_x402" ? "x402 on Metal" : "its Airwallex card";
      const who = str(p.by) === "claude" ? "The Sourcing agent" : "Code (the agent did not decide)";
      const ref = str(p.ref);
      return out(`${who} paid ${capFirst(s)} on ${rail}${str(p.by) === "claude" && str(p.reason) ? ` ("${str(p.reason)}")` : ""}: ${str(p.result)}`, p.ok === false ? "refusal" : "ok", {
        model: null, ...(str(p.rail) === "metal_x402" && /^0x[0-9a-f]{64}$/i.test(ref) ? { tx: ref } : {}), ...(str(p.rail) === "airwallex_card" && ref ? { awx_id: ref } : {}),
      });
    }
    // Block 1: the account's owners are passkeys; the runner only relays.
    case "owners.account_created": return out(`Business account ${short(str(p.account))} created with two owners, ${(Array.isArray(p.owners) ? (p.owners as unknown[]).map(str) : []).join("'s and ")}'s passkeys (threshold 2): no server key can change its mandates`, "ok");
    case "owners.executed": return out(`Both passkeys signed ${s} on chain and the account ran it: ${str((p.action as P | undefined)?.what)} the ${str((p.action as P | undefined)?.agent)} mandate (up to ${str((p.action as P | undefined)?.cap)} a payment, ${str((p.action as P | undefined)?.budget)} in total); the runner only relayed it`, "ok", { tx: /^0x[0-9a-f]{64}$/i.test(str(p.tx)) ? str(p.tx) : null });
    // Block 5.2: a card decline started the agent whose card it is.
    case "card.decline_met": {
      const who = agentWho(str(p.agent));
      const what = str(p.proposal_id) ? `proposed a higher limit, ${str(p.proposal_id)}, for the CFO's Face ID` : "proposed no raise";
      return str(p.source) === "claude"
        ? out(`${capFirst(who)} read Airwallex's decline (${declineWords(str(p.reason))}) and ${what}${str(p.said) ? `: "${str(p.said)}"` : ""}`, "approval", { model: modelName(str(p.model)) })
        : out(`Code met the decline (${declineWords(str(p.reason))}) and ${what}; the agent did not decide`, "approval");
    }
    // D19, the autonomous agents: what changed in the world, what each agent decided, what they told each other.
    case "world.event": return out(`The world changed: ${str(p.kind).replace(/[._]/g, " ")}${p.for_agent ? ` (for ${agentWho(str(p.for_agent))})` : ""}`, "info");
    case "agent.decision": return str(p.source) === "claude"
      ? out(`${capFirst(agentWho(r.actor))} decided${p.tick ? " (routine check)" : ""}: ${str(p.summary)}`, "info", { model: modelName(str(p.model)) })
      : out(`Fallback (code) for ${agentWho(r.actor)}: ${str(p.summary)}`, "info");
    case "agent.message": return out(`${capFirst(agentWho(str(p.from)))} → ${agentWho(str(p.to))}: "${str(p.text)}"`, "info");
    case "agent.idle": return out(`${capFirst(agentWho(str(p.agent)))} does nothing: ${str(p.why)}`, "info");
    case "agent.cost_warning": return out(`${capFirst(agentWho(str(p.agent)))} has used 80% of its hourly Claude budget (${(Number(p.spent_usd_micros) / 1e6).toFixed(4)} of ${(Number(p.cap_usd_micros) / 1e6).toFixed(2)} USD)`, "refusal");
    case "licence.timing_advised": return out(`The Treasury agent advised ${str(p.timing) === "pay_now" ? "paying" : `waiting until ${str(p.date)} to pay`} ${str(p.invoice_no)} (${s}), advisory: "${str(p.reason)}"`, "approval", { model: modelName(str(p.model)) });
    case "purchase.rail_refused": return out(`Code refused the Sourcing agent's payment to ${capFirst(s)}: ${str(p.why)}; nothing was charged`, "refusal");
    case "purchase.rails_chosen": {
      const ps = Array.isArray(p.purchases) ? (p.purchases as P[]) : [];
      const list = ps.map((x) => `${capFirst(str(x.supplier))} on ${str(x.rail) === "metal_x402" ? "x402 on Metal" : "the card"}`).join(", ");
      return str(p.source) === "claude"
        ? out(`The Sourcing agent picked the rail per purchase: ${list}; code checked each supplier accepts it`, "info", { model: modelName(str(p.model)) })
        : out(`Code paid on the rail each supplier accepts (${list}); the Sourcing agent's choice was not used`, "info");
    }
    case "price_rise.plan": {
      const budgets = (Array.isArray(p.budgets) ? (p.budgets as unknown[]) : []).map((x) => str(x).replace(/ \(cap [^)]*\)/, "")).join(" / ");
      return str(p.source) === "claude"
        ? out(`The Treasury agent planned ${budgets}, accepted by code${Number(p.attempts) > 1 ? ` after ${str(p.attempts)} tries` : ""}: "${str(p.advice)}"`, "info", { model: modelName(str(p.model)) })
        : out(`The Treasury agent's plan was not used (${str(p.note)}); code's fixed plan went to the CFO`, "info");
    }
    case "dispute.settled_by_agent": {
      const refunded = Array.isArray(p.refunded) ? (p.refunded as unknown[]).map(str) : [];
      const esc = (p.escalated ?? null) as P | null;
      const sent = esc ? ` and sent ${(Array.isArray(esc.sales) ? (esc.sales as unknown[]) : []).length} to the CFO (${str(esc.proposal)})` : "";
      return str(p.source) === "claude"
        ? out(`The Support agent refunded ${refunded.join(", ") || "nothing"} itself${sent}: "${str(p.said)}"`, "info", { model: modelName(str(p.model)) })
        : out("The Support agent's model was not available; code settled the dispute as before", "info");
    }
    case "claude.fallback": return out(`Claude was not used for ${s.replace(/_/g, " ")}; the deterministic parser decided (${str(p.note)})`, "info", { model: modelName(str(p.model)) });
    case "claude.rejected": return out(`Claude's answer for ${s.replace(/_/g, " ")} failed the code check and was not used`, "refusal", { model: modelName(str(p.model)) });
    case "proposal.created": {
      // Who started it, from the origin recorded on the proposal (review, 2 November): the CFO's own command is the CFO's.
      const started = "origin" in p ? parseOrigin(JSON.stringify(p.origin)) : null;
      if (started?.actor === "cfo-command") return out(`Max started ${s} (${kindTitle(str(p.kind)).toLowerCase()}) with ${started.command}`, "approval");
      // Code's own rule started it (no agent's Claude run, no person): code is named, not the agent that owns the proposal.
      if (started?.actor === "code") return out(`Code proposed ${s} (${kindTitle(str(p.kind)).toLowerCase()}) by its rule: ${started.rule}`, "approval");
      return out(`${r.actor === "human" ? "Max" : r.actor in AGENT_DISPLAY ? `The ${AGENT_DISPLAY[r.actor as keyof typeof AGENT_DISPLAY].name}` : `Agent ${r.actor}`} proposed ${s} (${kindTitle(str(p.kind)).toLowerCase()})`, "approval");
    }
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
    case "proposal.guard_refused": return str(p.inconclusive)
      ? out(`${s}: its execution was refused on a chain read that may be stale: ${str(p.error)}; it stays open and can run again`, "refusal")
      : out(`${s}: its execution was refused after ${str(p.steps_started)} of its steps had started: ${str(p.error)}; it stays ${str(p.status).toLowerCase()} until a person resolves it`, "refusal");
    case "proposal.needs_reapproval":
      // dry-179: a replace its executor's guard refused (or another option of it the same facts refuse) is closed.
      if (str(p.sibling_of)) return out(`${s} is closed: ${str(p.error)}. A new proposal is needed`, "refusal");
      if (str(p.stopped)) return out(`${s} was approved, but code did not run it: ${str(p.error)}. It is closed; a new proposal is needed`, "refusal");
      return out(`${s} needs a new approval: ${str(p.error)}`, "refusal");
    // dry-179: an agent's tool that would spend from a mandate a replace is about to change waits for it.
    case "spend.held": return out(`${capFirst(agentWho(s))}'s ${str(p.path) === "sweep_earnings" ? "sweep" : str(p.path) === "settle_dispute" ? "dispute settlement (its refunds)" : str(p.path)} waits: ${refusalWords(str(p.reason))}`, "refusal");
    case "proposal.superseded": return out(`${s} closed: another option (${str(p.by)}) was approved`);
    case "proposal.expired": return out(`${s} expired: its terms can no longer be approved or run`, "refusal");
    case "approval.too_late": return out(`${str(p.approver) || "A person"} approved ${s} after it expired; nothing ran`, "refusal");
    case "dispute.opened": {
      const n = str(p.sales).split(",").filter(Boolean).length;
      const words = CLAIM_WORDS[str(p.claim) as DisputeClaim] ?? str(p.claim);
      // The only buyer in a Northwind world is Summit Outfitters, as on the sale lines; its wallet address reads as its name.
      const who = /^0x[0-9a-fA-F]{40}$/.test(str(p.customer)) || !str(p.customer) ? PAYEE_NAMES.customer : str(p.customer);
      return out(`${who} disputes ${n} sale${n === 1 ? "" : "s"}: "${words}" (case ${s})`);
    }
    case "dispute.decided": {
      if (str(p.outcome) === "rejected") return out(`Dispute ${s} decided by code: not refunded, every order signed and paid inside the customer's mandate`, "ok");
      const then = str(p.route) === "approval" ? `waiting for your Face ID (${str(p.proposal_id)})` : str(p.route) === "auto" ? "within the automatic limits" : "";
      return out(`Dispute ${s} decided by code: refund ${str(p.refund)} test USD${then ? `, ${then}` : ""}`, "ok");
    }
    case "dispute.decision_recorded": {
      const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(str).join(", ") : "");
      const who = str(p.source) === "claude" ? "the Support agent" : "code";
      return out(`Dispute ${s} decided once, by ${who}, before anything was paid: refund ${list(p.refunds) || "none"}${p.escalate ? `; ${list(p.escalate)} to the CFO` : ""}${p.approval ? `; ${list(p.approval)} above the automatic limits to the CFO` : ""}`, "info");
    }
    case "refund.auto_approved": return out(`Refunds for sales ${(Array.isArray(p.sales) ? (p.sales as unknown[]) : []).map((x) => `#${str(x)}`).join(", ")} are within the automatic limits`, "ok");
    case "refund.paid": return out(`Refunded ${str(p.amount)} to Summit Outfitters for sale #${s} (${str(p.payment_id)})`, "ok");
    case "refund.already_paid": return out(`Retry of ${str(p.payment_id)}: already paid, nothing sent`, "ok");
    case "refund.already_held": return out(`Looked again at ${str(p.payment_id)}: sent, still held at Metal; nothing sent again, not refunded yet`, "info");
    case "refund.refused":
    case "refund.held": return out(`Refund ${str(p.payment_id)} ${r.event.split(".")[1]}: ${refusalWords(str(p.reason))}`, "refusal");
    case "sweep.paid": return out(`Swept ${str(p.amount)} USDZ of earnings to the sweep wallet (${s})`, "ok");
    case "sweep.refused":
    case "sweep.held":
    case "sweep.pending": return out(`Sweep ${s} ${r.event.split(".")[1]}: ${refusalWords(str(p.reason))}`, "refusal");
    case "credit.locked": return out(`Sweep final on chain (block ${str(p.block)} <= finalized ${str(p.finalized_block)}); credit locked once`, "ok");
    case "credit.deposited":
    case "credit.adopted": return out(`Booked in Airwallex: ${str(p.currency)} ${str(p.amount)} deposit, reference = the chain tx`, "ok", { awx_id: str(p.deposit_id) || null, tx: TX.test(str(p.reference)) ? str(p.reference) : tx });
    case "receivable.matched": return out(`Global Account: ${str(p.detail)}`, "ok", { awx_id: s || null });
    case "receivable.escalated": return out(`Global Account, to the CFO: ${str(p.detail)}`, "refusal", { awx_id: s || null });
    case "treasury.seeded": return out(`Airwallex sandbox seeded with ${str(p.currency)} ${str(p.amount)}`);
    case "invoice.escalated": return out(`Invoice ${s} escalated to a person: ${str(p.reason)}`, "refusal");
    // What was refunded under it is read from the ledger as it is now (review 2, MEDIUM 1: a settlement cut off after
    // some refunds were paid lands here too); with no ledger at hand the row says nothing about refunds.
    case "dispute.escalated": return out(`Dispute ${s} from ${str(p.customer)} sent to the CFO: code could not settle it (${str(p.reason)})${refundsOf ? `; ${refundsUnderWords(refundsOf(s), saleOf)}` : ""}`, "refusal");
    case "dispute.handled_before": return out(`Dispute ${s} from ${str(p.customer)}: every order in it was handled before (${(Array.isArray(p.handled) ? (p.handled as unknown[]) : []).map(str).join(", ")}); nothing new refunded or sent to the CFO`);
    case "dispute.resolved_by_cfo": return out(`Dispute ${s} marked resolved by the CFO: ${str(p.note)} Nothing was refunded by code for it`, "ok");
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
    // The fee retry (agent run 1): Airwallex's fee configuration refused a create; nothing was paid by that attempt.
    case "transfer.retry": {
      const why = `${str(p.code)}${str(p.trace_id) ? `, trace ${str(p.trace_id)}` : ""}`;
      const next = p.next_attempt_in_s == null ? `No further attempt: ${str(p.stopped)}` : `Retried in ${str(p.next_attempt_in_s)} s under the same request_id; Airwallex refused each attempt so far`;
      return out(`Airwallex refused attempt ${str(p.attempt)} of the ${str(p.amount)} payout (${why}). ${next}`, "info");
    }
    case "transfer.left_open": return out(`Airwallex refused the ${str(p.amount)} payout ${str(p.attempts)} times, but it could not be shown that nothing exists under its request_id (${str(p.reason)}); the payout stays under way until a person checks it`, "refusal");
    case "transfer.retry_stopped": return out(`The payout's retries stopped after attempt ${str(p.after_attempt)}: ${str(p.reason)}; nothing was paid`, "refusal");
    case "transfer.refused": {
      const why = `${str(p.code)}${str(p.trace_id) ? `, trace ${str(p.trace_id)}` : ""}`;
      const n = Number(p.attempts);
      return out(`Airwallex refused the ${str(p.amount)} payout (${why})${n > 1 ? ` after ${n} attempts` : ""}; nothing was paid and the payout is closed. A new proposal with Face ID pays the invoice`, "refusal");
    }
    case "transfer.closed_unsent": return out(`Payout of invoice ${str(p.invoice_no)} (${str(p.amount)}, ${str(p.proposal_id)}) closed by your command: Airwallex holds no transfer under it; the invoice can be proposed again`, "approval");
    case "transfer.row_conflict": return out(`Alarm: Airwallex holds transfer ${s} (${str(p.amount)}) under payout ${str(p.request_id)}, but the ledger's row is ${str(p.row_status)}; nothing more is sent, a person checks it now`, "refusal", { awx_id: s || null });
    case "transfer.payee_unconfirmed": return out(`Alarm: transfer ${s} (${str(p.amount)}) was adopted, but Airwallex never stated its payee; a person checks the payee in the Airwallex web app`, "refusal", { awx_id: s || null });
    case "transfer.found_after_close": return out(`Alarm: Airwallex holds transfer ${s} (${str(p.amount)}, ${str(p.status)}) under the closed payout ${str(p.request_id)} of invoice ${str(p.invoice_no)}; it is not proposed again, a person checks it now`, "refusal", { awx_id: s || null });
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
  const agentRuns = new Map<string, { model: string; runs: number; cost: number; latencies: number[] }>();
  for (const r of rows) {
    if (r.event === "claude.fallback") fallbacks++;
    if (r.event === "agent.run") {
      const p = JSON.parse(r.payload_json) as P;
      const model = str(p.model);
      const cost = typeof p.cost_usd_micros === "number" ? p.cost_usd_micros : 0;
      // A decision is a finished run; one that never reached a model (no key, a refusal, a failure) is not.
      if (str(p.status) === "done") {
        const a = agentRuns.get(str(p.agent)) ?? { model, runs: 0, cost: 0, latencies: [] };
        a.runs++; a.cost += cost; a.model = model || a.model;
        if (typeof p.latency_ms === "number") a.latencies.push(p.latency_ms);
        agentRuns.set(str(p.agent), a);
      }
      // An agent's run is Claude calls too: its turns and cost count in its model's total.
      const m = per.find((x) => x.re.test(model));
      if (m) { m.calls += typeof p.turns === "number" ? p.turns : 0; m.cost += cost; }
      continue;
    }
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
      // With the agents on, a model also runs agents: name them beside its reading role.
      model: m.version ? `${m.name} ${m.version}` : m.name, calls: m.calls,
      role: ((ag) => (ag.length ? `${m.role}; runs the ${ag.join(" and the ")} agent${ag.length > 1 ? "s" : ""}` : m.role))(
        [...agentRuns].filter(([, a]) => m.re.test(a.model)).map(([agent]) => capFirst(agentName(agent).replace(/ agent$/i, "")))),
      avg_latency_ms: m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : null,
      cost_usd_micros: m.cost,
    })),
    cost_usd_micros: cost,
    per_call_usd_micros: calls ? Math.ceil(cost / calls) : null,
    eur_paid: fromCents(eurCents),
    // micro-dollars per €1,000 = cost / (cents / 100,000), rounded up.
    per_1000_eur_usd_micros: calls && eurCents ? Math.ceil((cost * 100_000) / eurCents) : null,
    agents: [...agentRuns].map(([agent, a]) => {
      const l = [...a.latencies].sort((x, y) => x - y);
      return { agent, model: modelName(a.model) ?? a.model, runs: a.runs, cost_usd_micros: a.cost, median_latency_ms: l.length ? l[Math.floor(l.length / 2)]! : null };
    }),
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
  // A decline counts as money kept out only if the same purchase was not paid later (after the CFO raised the limit).
  const laterPaid = "EXISTS (SELECT 1 FROM card_transactions a WHERE a.approved = 1 AND a.card_id = d.card_id AND a.merchant = d.merchant AND a.amount_cents = d.amount_cents AND a.occurred_at > d.occurred_at)";
  const declinedEur = hasCards ? one(`SELECT SUM(amount_cents) AS c FROM card_transactions d WHERE approved = 0 AND NOT ${laterPaid}`) : 0;
  const declinedLater = hasCards ? one(`SELECT COUNT(*) AS c FROM card_transactions d WHERE approved = 0 AND ${laterPaid}`) : 0;
  const refusedUsdz = one("SELECT SUM(price_cents) AS c FROM upstream_purchases WHERE outcome = 'REFUSED'") + one("SELECT SUM(amount_cents) AS c FROM refunds WHERE outcome = 'REFUSED'");
  return {
    card_spent_eur: fromCents(cardSpent), card_limit_eur: fromCents(cardLimit),
    chain_spent_usdz: fromCents(chainSpent), chain_limit_usdz: b.limit,
    waiting: live.length, waiting_eur: fromCents(waitingEur), waiting_usdz: fromCents(waitingUsdz),
    blocked_eur: fromCents(fraudEur + declinedEur), blocked_usdz: fromCents(refusedUsdz),
    blocked_fraud_eur: fromCents(fraudEur), blocked_fraud_n: rows.filter((r) => r.event === "invoice.fraud_suspected").length,
    blocked_declined_eur: fromCents(declinedEur), blocked_declined_n: hasCards ? one("SELECT COUNT(*) AS c FROM card_transactions WHERE approved = 0") : 0,
    blocked_declined_later_paid_n: declinedLater, blocked_rejected_n: rows.filter((r) => r.event === "proposal.rejected").length,
  };
}

// The chat with Purser has its own panel (snapshot.ask).
export interface DisputeView {
  case_id: string; claim: string; text: string; opened_at: string; outcome: string; refund: string; route: string; proposal_id: string | null;
  explanation: string; explained_by: string;
  sales: { sale_id: number; request: string; charged: string; order: string; chain: boolean; delivered: boolean; tx: string; refund: string; why: string; passkey: boolean;
    /** A refund this sale already had before the case (an earlier claim, e.g. wrong data), with its transaction. */
    refunded_before: { amount: string; tx: string | null } | null }[];
  /** The Support agent's own decision by Claude, when it decided the case (autonomous runs; src/seller/desk.ts). */
  agent?: DisputeCase["agent"];
  /** The customer's own agent's message (agent to agent). */
  customer_agent?: DisputeCase["customer_agent"];
}

/** The Dispute desk's cases for the dashboard, from the stored cases only. */
function disputeViews(db: DB): DisputeView[] {
  const before = (saleId: number): DisputeView["sales"][number]["refunded_before"] => {
    const r = db.prepare("SELECT amount_cents, tx_hash FROM refunds WHERE sale_id = ? AND outcome IN ('PAID', 'HELD')").get(saleId) as { amount_cents: number; tx_hash: string | null } | undefined;
    return r ? { amount: fromCents(r.amount_cents), tx: r.tx_hash } : null;
  };
  return (oldLedgerSafe(() => disputeCases(db)) ?? []).slice(0, 10).map((c) => ({
    case_id: c.case_id, claim: CLAIM_WORDS[c.claim], text: c.text, opened_at: c.opened_at, outcome: c.decision.outcome, refund: fromCents(c.decision.refund_cents),
    route: c.route, proposal_id: c.proposal_id, explanation: c.explanation, explained_by: c.explained_by,
    sales: c.packs.map((p) => {
      const d = c.decision.per_sale.find((x) => x.sale_id === p.sale_id)!;
      return {
        sale_id: p.sale_id, request: p.request, charged: fromCents(p.charged_cents), tx: p.tx, refund: fromCents(d.refund_cents), why: d.why,
        order: p.order.valid ? `signed for ${fromCents(p.order.amount_cents ?? 0)}` : p.order.present ? "does not verify" : "none",
        chain: p.mandate.within, delivered: p.delivery.matches, passkey: !!p.human.passkey?.verified,
        refunded_before: before(p.sale_id),
      };
    }),
    ...(c.agent ? { agent: c.agent } : {}),
    ...(c.customer_agent ? { customer_agent: c.customer_agent } : {}),
  }));
}

/** A view that needs tables an older ledger (an early recording) does not have: absent there, not an error. */
function oldLedgerSafe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (/no such table/.test((e as Error).message)) return null;
    throw e;
  }
}

/** Who sent a chat line. Lines from before asked_by was recorded came from the runner or the relay, as the CFO. */
const askFrom = (actor: string, by: string) => (actor.startsWith("ext:") ? `agent ${actor}` : by === "dashboard-link" ? "dashboard link" : "you");

// policy.version is bookkeeping: each rule change already shows as policy.changed.
// agent.run: the decision rows below carry the agent's own words; a tool call that simply went through stays quiet.
const FEED_QUIET = new Set(["card.duplicate_merged", "ask.received", "ask.replied", "policy.version", "agent.run", "query.answered"]);
const quietTool = (r: { event: string; payload_json: string }) => r.event === "agent.tool" && !(JSON.parse(r.payload_json) as { blocked_by?: string }).blocked_by;

/** What the agents did alone (payments made inside their limits), and what a limit, a check or a person stopped. */
function counts(db: DB, rows: AuditRow[], waiting: number): Snapshot["counts"] {
  const hasCards = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const card = (approved: 0 | 1) => (hasCards ? n(`SELECT COUNT(*) AS n FROM card_transactions WHERE approved = ${approved}`) : 0);
  return {
    alone: n("SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED'") + n("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'")
      + n("SELECT COUNT(*) AS n FROM refunds WHERE outcome = 'PAID'") + n("SELECT COUNT(*) AS n FROM sweeps WHERE outcome = 'PAID'") + card(1),
    waiting,
    // A document flagged twice (read again later) counts once.
    blocked: n("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'REFUSED'") + card(0) + rows.filter((r) => BLOCKED_EVENTS.has(r.event) && r.event !== "document.injection_flagged").length
      + new Set(rows.filter((r) => r.event === "document.injection_flagged").map((r) => (JSON.parse(r.payload_json) as { document_sha256?: string }).document_sha256 ?? String(r.seq))).size,
  };
}

export const REFUSAL_EVENTS = new Set([
  "upstream.refused", "upstream.in_doubt", "sale.settle_failed", "claude.rejected", "proposal.rejected", "proposal.failed",
  "proposal.needs_reapproval", "proposal.expired", "approval.too_late", "refund.refused", "refund.held", "sweep.refused",
  "sweep.held", "invoice.escalated", "dispute.escalated", "invoice.fraud_suspected", "document.injection_flagged", "transfer.fee_over_ceiling", "passkey.refused", "passkey.enrol_refused",
  "transfer.refused", "transfer.retry_stopped", "transfer.row_conflict", "transfer.found_after_close", "transfer.payee_unconfirmed", "transfer.left_open",
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
  "dispute.escalated": "Dispute sent to the CFO",
  "invoice.fraud_suspected": "Invoice blocked: possible fraud",
  "document.injection_flagged": "Planted instruction ignored",
  "transfer.fee_over_ceiling": "Fee above ceiling",
  "transfer.refused": "Payout refused by Airwallex",
  "transfer.retry_stopped": "Payout retries stopped",
  "transfer.row_conflict": "Alarm: payout row changed",
  "transfer.found_after_close": "Alarm: closed payout found at Airwallex",
  "transfer.payee_unconfirmed": "Alarm: payee not confirmed",
  "transfer.left_open": "Payout left under way",
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
  const refundsOf = refundsUnder(db);
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
    const d = describe(r, saleOf, refundsOf);
    const agent = r.event === "velocity.tripped" && r.subject ? r.subject : Object.entries(AGENT_OF).find(([k]) => r.event.startsWith(k))?.[1] ?? r.actor;
    return { seq: r.seq, ts: r.ts, agent, what: REFUSAL_WHAT[r.event] ?? r.event, reason: d.text };
  });

  // Bookkeeping of our own (two ids for one card authorisation) stays in the audit log, not in the CFO's feed.
  const traces = agentTraces(db, rows);
  const traceOf = new Map(traces.flatMap((t) => t.steps.map((s) => [s.seq, t.run_seq] as const)));
  const feed: FeedItem[] = rows.filter((r) => !FEED_QUIET.has(r.event) && !quietTool(r) && !(r.event.startsWith("card.charge_") && merged.has(r.subject))).slice(-60).reverse().map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, ...describe(r, saleOf, refundsOf), trace: traceOf.get(r.seq) ?? null }));

  const budgetView = budgets(db, rows, roleOf);
  const cardView = cards(db, now);
  return {
    generated_at: now.toISOString(),
    world: { business: addressOf("business"), customer: addressOf("customer") },
    audit: { rows: rows.length, head: rows.at(-1)?.row_hash ?? null, intact: chain.ok },
    budgets: budgetView,
    tower: towerView(db, { budgets: budgetView.agents, cards: cardView }),
    flows: flowEvents(db),
    treasury: treasury(db),
    pending,
    decisions,
    refusals,
    feed,
    traces: traces.slice(-20).reverse(),
    agent_stats: agentStats(db, now),
    agent_chat: agentChat(db),
    cards: cardView,
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
    books: oldLedgerSafe(() => booksView(db)),
    disputes: disputeViews(db),
    receivables: receivablesView(db),
    card_spend: spendReview(db),
    airwallex_events: airwallexEventsView(db),
    health: health(db, now),
    rails: railsView(db),
  };
}

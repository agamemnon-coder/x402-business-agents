// The dashboard's one data source: a read-only snapshot of the ledger, rebuilt on every poll. It makes no
// network call and writes nothing, so it can be served from a read-only handle while the agents run.
// Every text it returns is plain text; the page renders it with textContent only.

import { verifyAuditChain } from "../audit/log.js";
import { MANDATE_EXPIRES_IN_SECONDS, TOTAL_BUDGET_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { policyValue } from "../policy/rules.js";

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
    metal: { sales: string; upstream: string; refunds: string; net: string; swept: string; sell_price: string; upstream_price: string };
  };
  pending: Pending[];
  decisions: Decision[];
  refusals: Refusal[];
  feed: FeedItem[];
  /** The passkey every phone approval needs (first 8 characters of its id), and whether one can be enrolled now. */
  passkey: { credential: string | null; label: string | null; enrolled_at: string | null; enrolment_open: boolean };
}

type AuditRow = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string };
type P = Record<string, unknown>;

const TX = /^0x[0-9a-fA-F]{64}$/;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const sum = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number | null }).n ?? 0;

export const PAYEE_NAMES: Record<string, string> = {
  supplier: "Feedstock Labs",
  customer: "Kestrel Quant",
  sweep: "Tidemark sweep wallet",
  business: "Tidemark Data",
};

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
  if (kind === "policy_change") {
    const changes = Array.isArray(t.changes) ? (t.changes as P[]) : [];
    return changes.map((c) => `${str(c.label)}: ${str(c.from) || "no extra limit"} → ${str(c.to) || "no extra limit"}`).join("; ");
  }
  return kindTitle(kind);
}

/** "max (passkey k_EWzUuv)" approving by passkey reads as "Max · Face ID"; other approvers as recorded. */
export function approverName(approver: string, method: string | null | undefined): string {
  if (method !== "passkey") return approver;
  const name = approver.split(" (")[0] ?? approver;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} · Face ID`;
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
    },
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
      return out(`Bought raw tick #${str(p.seq)} from Feedstock Labs${price ? ` for ${price}` : ""}${r.event === "upstream.paid_after_lookup" ? " (found by lookup, not paid twice)" : ""}`, "ok");
    }
    case "upstream.refused": {
      const reason = str(p.reason);
      return reason.startsWith("policy_cap_exceeded")
        ? out(`Purchase of tick #${str(p.seq)} refused by the CFO policy before signing: ${reason.slice(reason.indexOf(":") + 1).trim()}`, "refusal")
        : out(`Purchase of tick #${str(p.seq)} refused on chain: ${refusalWords(reason)}`, "refusal");
    }
    case "policy.changed": return out(`CFO policy: ${str(p.label)} changed from ${str(p.from) || "no extra limit"} to ${str(p.to) || "no extra limit"} (${str(p.proposal_id)})`, "approval");
    case "upstream.in_doubt": return out(`Purchase of tick #${str(p.seq)} unconfirmed; it is looked up before any retry`, "refusal");
    case "sale.delivered": {
      const sale = saleOf(s);
      return out(sale ? `Sold tick #${sale.seq} to Kestrel Quant for ${fromCents(sale.price)}` : `Sale ${s} delivered`, "ok");
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
    case "proposal.rejected": return out(`${approverName(str(p.approver), str(p.method)) || "A person"} rejected ${s}`, "refusal");
    case "proposal.executing": return out(`Running ${s}, after checking its terms are exactly what was approved`);
    case "proposal.executed": return out(`${s} executed`, "ok");
    case "proposal.failed": return out(`${s} failed: ${str(p.error) || "see the ledger"}`, "refusal");
    case "proposal.needs_reapproval": return out(`${s} needs a new approval: ${str(p.error)}`, "refusal");
    case "proposal.superseded": return out(`${s} closed: another option (${str(p.by)}) was approved`);
    case "proposal.expired": return out(`${s} expired: its terms can no longer be approved or run`, "refusal");
    case "approval.too_late": return out(`${str(p.approver) || "A person"} approved ${s} after it expired; nothing ran`, "refusal");
    case "refund.auto_approved": return out(`Refunds for sales ${(Array.isArray(p.sales) ? (p.sales as unknown[]) : []).map((x) => `#${str(x)}`).join(", ")} are within the automatic limits`, "ok");
    case "refund.paid": return out(`Refunded ${str(p.amount)} to Kestrel Quant for sale #${s} (${str(p.payment_id)})`, "ok");
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
    case "passkey.enrolment_opened": return out("A one-time code to enrol a passkey was issued (valid 10 minutes)");
    case "passkey.enrolled": return out(`${str(p.label) || "A person"} enrolled passkey ${s.slice(0, 8)}; approvals now need it`, "ok");
    case "passkey.revoked": return out(`Passkey ${s.slice(0, 8)} revoked: replaced by ${str(p.replaced_by).slice(0, 8)}`);
    case "passkey.refused": return out(`Passkey approval${s ? ` of ${s}` : ""} refused: ${str(p.reason)}`, "refusal");
    case "passkey.enrol_refused": return out(`Passkey enrolment refused: ${str(p.reason)}`, "refusal");
    default: return out(`${r.event}${s ? ` ${s}` : ""}`);
  }
}

export const REFUSAL_EVENTS = new Set([
  "upstream.refused", "upstream.in_doubt", "sale.settle_failed", "claude.rejected", "proposal.rejected", "proposal.failed",
  "proposal.needs_reapproval", "proposal.expired", "approval.too_late", "refund.refused", "refund.held", "sweep.refused",
  "sweep.held", "invoice.escalated", "invoice.fraud_suspected", "document.injection_flagged", "transfer.fee_over_ceiling", "passkey.refused", "passkey.enrol_refused",
]);

export const REFUSAL_WHAT: Record<string, string> = {
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

  const refusals: Refusal[] = rows.filter((r) => REFUSAL_EVENTS.has(r.event)).reverse().slice(0, 30).map((r) => {
    const d = describe(r, saleOf);
    const agent = Object.entries(AGENT_OF).find(([k]) => r.event.startsWith(k))?.[1] ?? r.actor;
    return { seq: r.seq, ts: r.ts, agent, what: REFUSAL_WHAT[r.event] ?? r.event, reason: d.text };
  });

  const feed: FeedItem[] = rows.slice(-60).reverse().map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, ...describe(r, saleOf) }));

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
    passkey: passkeyInfo(db, now),
  };
}

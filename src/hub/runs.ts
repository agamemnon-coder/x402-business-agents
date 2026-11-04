// What Purser shows the hub: its runs, each with code's verdict (`check`, and the `rule` behind it) and the person's
// (`human`). A run is a proposal (a money action that waits for, or had, a person) or a payment Purser's rules refused.
// The check is deterministic: it is computed from the ledger by the functions below, never by a model, and the hub gate
// (src/hub/gate.ts) uses the same function, so the run the hub sees as `fail` is the run that can never execute.
//
// The body carries no secret, IBAN, account number, address or personal data: every field is built from a fixed
// vocabulary or a checked pattern, and assertSafeBody refuses the body if anything slipped through anyway.

import type { DB } from "../db/open.js";
import { invoiceKey } from "../lib/invoiceKey.js";
import { fourEyes } from "../policy/fourEyes.js";
import { counterpartyAllowed, frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";

export type Check = "pass" | "fail" | "pending";
export type Human = "waiting" | "approved" | "rejected" | "none";

export interface HubRun {
  id: string;
  agent: string;
  what: string;
  amount: string | null;
  currency: string | null;
  check: Check;
  rule: string;
  human: Human;
}

export interface HubBody {
  mode: "dry-run" | "live";
  title: "Purser";
  runs: HubRun[];
}

export const MAX_RUNS = 12;
export const MAX_BODY_BYTES = 8 * 1024;

interface ProposalLike {
  proposal_id: string;
  kind: string;
  terms_json: string;
  terms_sha256: string;
  created_by: string;
  status: string;
  created_at?: string;
}

/**
 * This ledger's world: "w-" and the start of its first audit row's hash. Two worlds never share it (the first row
 * carries its own time), so a decision the hub kept for another world's P-0005 never matches this one's. Nothing of the
 * ledger's file name goes out: it could name a person.
 */
export function worldId(db: DB): string {
  const first = db.prepare("SELECT row_hash FROM audit_log ORDER BY seq LIMIT 1").get() as { row_hash: string } | undefined;
  return `w-${first ? first.row_hash.slice(0, 10) : "new"}`;
}

export const runIdOf = (world: string, proposalId: string) => `${world}/${proposalId}`;

/** The kinds that pay money out; the emergency stop fails these (never a policy change, which may lift the stop). */
const PAYOUT_KINDS = new Set(["invoice_payment", "refund_batch", "task_card"]);

/** Why a person decides each kind (the rule that sent it to a person); four eyes overrides it. */
const RULE_BY_KIND: Record<string, string> = {
  invoice_payment: "invoice_payout_needs_person",
  refund_batch: "refund_over_auto_limit",
  mandate_replace: "mandate_change",
  policy_change: "policy_change",
  payee_change: "new_bank_details",
  task_card: "task_card_over_policy",
  quarantine_release: "held_payment",
  agent_onboard: "outside_agent_card",
  owners_execute: "two_owners",
  dev_test: "dev_test",
};

const WHAT_BY_KIND: Record<string, string> = {
  invoice_payment: "Invoice payment",
  refund_batch: "Refund batch",
  mandate_replace: "Mandate change",
  policy_change: "Policy change",
  payee_change: "Supplier bank details",
  task_card: "Task card",
  quarantine_release: "Held payment",
  agent_onboard: "Card for an outside agent",
  owners_execute: "Mandate change by both owners",
  dev_test: "Dev test (moves no money)",
};

const AGENT_OF: Record<string, string> = { treasury: "treasury", support: "support", sourcing: "sourcing", human: "cfo", system: "purser" };
const agentOf = (createdBy: string) => AGENT_OF[createdBy] ?? (createdBy.startsWith("ext:") ? "outside-agent" : "purser");

const MONEY = /^\d{1,7}\.\d{2}$/;
const money = (v: unknown): string | null => (typeof v === "string" && MONEY.test(v) ? v : null);

function sumMoney(values: unknown[]): string | null {
  let cents = 0;
  for (const v of values) {
    const m = money(v);
    if (m === null) return null;
    cents += Number(m.replace(".", ""));
  }
  const s = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  return MONEY.test(s) ? s : null;
}

type T = Record<string, unknown>;
const terms = (p: ProposalLike): T => {
  try {
    const t: unknown = JSON.parse(p.terms_json);
    return t && typeof t === "object" ? (t as T) : {};
  } catch {
    return {};
  }
};

/** The amount and currency a proposal moves, when it moves one; null for changes that move no money themselves. */
function amountOf(p: ProposalLike, t: T): { amount: string | null; currency: string | null } {
  if (p.kind === "invoice_payment" || p.kind === "task_card") {
    const a = money(t.amount);
    return { amount: a, currency: a ? "EUR" : null };
  }
  if (p.kind === "refund_batch") {
    const a = sumMoney(Array.isArray(t.refunds) ? (t.refunds as T[]).map((r) => r?.amount) : []);
    return { amount: a, currency: a ? "USDZ" : null };
  }
  if (p.kind === "quarantine_release") {
    const a = money(t.amount);
    return { amount: a, currency: a ? "USDZ" : null };
  }
  return { amount: null, currency: null };
}

/**
 * Purser's deterministic verdict on a proposal, from the ledger as it is now: `fail` when a rule stops it (it can then
 * never execute, also with the hub's approve), `pending` while it is executing, `pass` otherwise. `rule` names the rule:
 * the one that fails it, or the one that sent it to a person.
 */
export function proposalCheck(db: DB, p: ProposalLike): { check: Check; rule: string } {
  if (p.status === "EXPIRED") return { check: "fail", rule: "approval_expired" };
  if (p.status === "SUPERSEDED") return { check: "fail", rule: "alternative_approved" };
  if (p.status === "NEEDS_REAPPROVAL") return { check: "fail", rule: "terms_no_longer_hold" };
  if (p.status === "EXECUTING") return { check: "pending", rule: "executing" };
  let base = RULE_BY_KIND[p.kind] ?? "needs_person";
  try {
    if (fourEyes(db, p)) base = "four_eyes";
  } catch {
    // Unreadable terms: their hash check refuses them at execution anyway.
  }
  // What already ran, or was turned down by a person, keeps the verdict it ran under.
  if (p.status === "EXECUTED" || p.status === "REJECTED") return { check: "pass", rule: base };
  const t = terms(p);
  if (PAYOUT_KINDS.has(p.kind) && frozen(db)) return { check: "fail", rule: "emergency_stop" };
  if (p.kind === "invoice_payment") {
    if (typeof t.beneficiary_name === "string" && !counterpartyAllowed(db, t.beneficiary_name)) return { check: "fail", rule: "payee_blocked" };
    if (paused(db, "treasury") || stopped(db, "treasury")) return { check: "fail", rule: "agent_stopped" };
    if (typeof t.invoice_no === "string") {
      const key = invoiceKey(t.invoice_no);
      const otherPayout = (db.prepare("SELECT invoice_no FROM transfers WHERE request_id <> ? AND status <> 'CANCELLED'").all(String(t.transfer_request_id ?? "")) as { invoice_no: string }[])
        .some((r) => invoiceKey(r.invoice_no) === key);
      const otherProposal = (db.prepare("SELECT json_extract(terms_json, '$.invoice_no') AS invoice_no FROM proposals WHERE kind = 'invoice_payment' AND proposal_id <> ? AND status IN ('EXECUTING', 'EXECUTED')").all(p.proposal_id) as { invoice_no: string | null }[])
        .some((r) => invoiceKey(r.invoice_no ?? "") === key);
      if (otherPayout || otherProposal) return { check: "fail", rule: "duplicate_invoice" };
    }
  }
  if (p.kind === "refund_batch" && (paused(db, "support") || stopped(db, "support"))) return { check: "fail", rule: "agent_stopped" };
  return { check: "pass", rule: base };
}

interface ConsultRow { outcome: string; terms_sha256: string; ts: string }

/** The hub's last recorded answer on this proposal (src/hub/gate.ts writes it), or null. */
export function lastConsult(db: DB, proposalId: string): ConsultRow | null {
  const r = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'hub.consulted' AND subject = ? ORDER BY seq DESC LIMIT 1").get(proposalId) as { ts: string; payload_json: string } | undefined;
  if (!r) return null;
  try {
    const p = JSON.parse(r.payload_json) as { outcome?: unknown; terms_sha256?: unknown };
    return typeof p.outcome === "string" && typeof p.terms_sha256 === "string" ? { outcome: p.outcome, terms_sha256: p.terms_sha256, ts: r.ts } : null;
  } catch {
    return null;
  }
}

function humanOf(db: DB, p: ProposalLike): Human {
  if (p.status === "EXECUTED") return "approved";
  if (p.status === "REJECTED") return "rejected";
  if (lastConsult(db, p.proposal_id)?.outcome === "reject") return "rejected";
  // Approved by Face ID but not yet run counts as waiting: the hub keeps its own decision until the run is done.
  if (p.status === "PENDING_APPROVAL" || p.status === "APPROVED" || p.status === "EXECUTING" || p.status === "FAILED") return "waiting";
  return "none";
}

export function proposalRun(db: DB, world: string, p: ProposalLike): HubRun {
  const t = terms(p);
  const { check, rule } = proposalCheck(db, p);
  const option = p.kind === "mandate_replace" && typeof t.option === "string" && /^[A-Z]$/.test(t.option) ? `, option ${t.option}` : "";
  return {
    id: runIdOf(world, p.proposal_id), agent: agentOf(p.created_by), what: `${WHAT_BY_KIND[p.kind] ?? "Proposal"}${option}`,
    ...amountOf(p, t), check, rule, human: humanOf(db, p),
  };
}

/** Payments Purser's rules refused (before anything moved): runs with check fail and no person involved. */
const REFUSALS: Record<string, { agent: string; what: string; currency: string }> = {
  "upstream.refused": { agent: "sourcing", what: "Data purchase refused", currency: "USDZ" },
  "refund.refused": { agent: "support", what: "Refund refused", currency: "USDZ" },
  "sweep.refused": { agent: "treasury", what: "Sweep refused", currency: "USDZ" },
};
/** At most this many refusals among the runs, so a burst of refused purchases never hides what waits for Max. */
const MAX_REFUSALS = 4;

const ruleOf = (reason: unknown): string => {
  const m = typeof reason === "string" ? /^([a-z][a-z_]{1,30})(?::|$)/.exec(reason) : null;
  return m ? m[1]! : "refused";
};

/** Live when this runner has the Airwallex sandbox keys (the rails are real, the money test money); dry-run otherwise. */
export function modeOf(env: NodeJS.ProcessEnv = process.env): HubBody["mode"] {
  return env.AIRWALLEX_CLIENT_ID && env.AIRWALLEX_API_KEY ? "live" : "dry-run";
}

/** The last runs, newest first, at most MAX_RUNS and within MAX_BODY_BYTES. */
export function buildPushBody(db: DB, env: NodeJS.ProcessEnv = process.env): HubBody {
  const world = worldId(db);
  const proposals = (db.prepare(`SELECT proposal_id, kind, terms_json, terms_sha256, created_by, status, created_at FROM proposals
    ORDER BY created_at DESC, proposal_id DESC LIMIT ${MAX_RUNS}`).all() as ProposalLike[])
    .map((p) => ({ at: p.created_at ?? "", run: proposalRun(db, world, p) }));
  const refusals = (db.prepare(`SELECT seq, ts, event, payload_json FROM audit_log WHERE event IN (${Object.keys(REFUSALS).map(() => "?").join(", ")})
    ORDER BY seq DESC LIMIT ${MAX_REFUSALS}`).all(...Object.keys(REFUSALS)) as { seq: number; ts: string; event: string; payload_json: string }[])
    .map((r) => {
      const kind = REFUSALS[r.event]!;
      let payload: T = {};
      try { payload = JSON.parse(r.payload_json) as T; } catch { /* rule "refused", no amount */ }
      const amount = money(payload.amount);
      const run: HubRun = { id: runIdOf(world, `R-${r.seq}`), agent: kind.agent, what: kind.what, amount, currency: amount ? kind.currency : null, check: "fail", rule: ruleOf(payload.reason), human: "none" };
      return { at: r.ts, run };
    });
  const runs = [...proposals, ...refusals].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_RUNS).map((x) => x.run);
  const body: HubBody = { mode: modeOf(env), title: "Purser", runs };
  while (body.runs.length > 0 && Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) body.runs.pop();
  return body;
}

/** What may never be in a body for the hub. Each pattern names what it catches. */
const FORBIDDEN: [string, RegExp][] = [
  ["an IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/],
  ["a chain address", /0x[0-9a-fA-F]{40}/],
  ["an account number", /\d{9,}/],
  ["an e-mail address", /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i],
  ["a key, token or long id", /[A-Za-z0-9+/_=-]{32,}/],
  ["a private key", /PRIVATE KEY/],
];
const ALLOWED_KEYS = new Set(["id", "agent", "what", "amount", "currency", "check", "rule", "human"]);

/**
 * Throws when the body is not exactly the agreed shape, or contains anything that looks like a secret, an IBAN, an
 * account number, an address or personal data, or any of the given secret values (the hub's own URL and token).
 */
export function assertSafeBody(body: HubBody, secrets: string[] = []): void {
  if (Object.keys(body).sort().join(",") !== "mode,runs,title") throw new Error("hub body: unexpected fields");
  if (body.runs.length > MAX_RUNS) throw new Error("hub body: too many runs");
  for (const r of body.runs) {
    if (Object.keys(r).some((k) => !ALLOWED_KEYS.has(k)) || Object.keys(r).length !== ALLOWED_KEYS.size) throw new Error("hub body: a run has unexpected fields");
    if (!["pass", "fail", "pending"].includes(r.check) || !["waiting", "approved", "rejected", "none"].includes(r.human)) throw new Error("hub body: bad check or human");
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("hub body: over 8 KB");
  for (const s of secrets) if (s && s.length >= 4 && text.includes(s)) throw new Error("hub body: contains a secret value");
  for (const [name, re] of FORBIDDEN) if (re.test(text)) throw new Error(`hub body: contains what looks like ${name}`);
}

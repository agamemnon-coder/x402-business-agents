// What a company's engine did, as a page may show it while it happens: one event per audit row, in the row's order.
// The audit log itself holds more than a page should carry (a reading with the supplier's IBAN, hashes, whole model
// outputs), so nothing passes by default: each event on the list below names the few fields it shows (a model, where a
// reading came from, a status, finding codes, an amount and its currency, a request id, a cost in micro-USD). An event
// that is not on the list says that it happened and when, and nothing else: no fields and no subject.
//
// The agents' events (claude.asking, agent.*, ap.checker_decided, ap.payer_proposed, claude.capped) are described for
// the page in docs/engine-events.md. Every text among them is masked (masked()): no IBAN, key or full account number.
//
// The list is read from the audit( calls of what the engine host runs: src/ap, src/claude, src/passkey,
// src/policy/approvals.ts, src/executors (the payment executors), src/payouts, src/vault and the treasury's seed
// (src/agents/euroBill.ts). src/ledger writes no audit rows.

export interface EngineEvent {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  subject: string | null;
  fields: Record<string, string | number | boolean | null>;
}

/** An audit row as the ledger keeps it (src/audit/log.ts); the chain's hashes are not needed here. */
export interface EventRow { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }

type Payload = Record<string, unknown>;
type Pick = (p: Payload) => Record<string, unknown>;

/** These fields of the payload, as they are. */
const copy = (...keys: string[]): Pick => (p) => Object.fromEntries(keys.map((k) => [k, p[k]]));
/** Nothing but the event itself and its subject. */
const NONE: Pick = () => ({});
/** "EUR 13.40", as the executors write an amount, in its two parts. */
const money = (v: unknown): { amount?: string; currency?: string } => {
  const m = typeof v === "string" ? /^([A-Z]{3}) (-?\d+(?:\.\d+)?)$/.exec(v) : null;
  return m ? { amount: m[2], currency: m[1] } : {};
};
/** The codes of what the checks found, in one text ("possible_duplicate,total_mismatch"); never a finding's words. */
const codes = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.map((f) => (typeof f === "object" && f !== null ? (f as { code?: unknown }).code : undefined)).filter((c): c is string => typeof c === "string").join(",") : undefined;
/**
 * A text a page may show: every IBAN and every run of 8 or more digits (an account number), however it is spaced, cut to its last four
 * ("****3000"), anything that looks like an API key or a bearer token removed, at most `max` characters.
 */
export function masked(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const last4 = (m: string) => `****${m.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`;
  // Separators as people and PDFs write them: spaces (also non-breaking or doubled), hyphens, dots.
  const out = v
    // An IBAN: country, check digits, an optional four-letter bank code, then digits (never running on into a word).
    .replace(/\b[A-Z]{2}\d{2}[\s.-]*(?:[A-Z]{4}[\s.-]*)?\d(?:[\s.-]*\d){6,29}\b/gi, last4)
    // An account number: 8 or more digits; a date (2026-11-16, 16.11.2026, 16-11-2026) is not one.
    .replace(/\b\d(?:[\s.-]*\d){7,}\b/g, (m) => (/^(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})$/.test(m) ? m : last4(m)))
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]");
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
/** The first sentence of a text, masked, at most `max` characters. */
const firstSentence = (v: unknown, max: number): string | undefined => {
  const m = masked(v, 10_000);
  return m === undefined ? undefined : masked(m.split(/(?<=[.!?])\s/)[0], max);
};
/** Why Claude was not asked (src/engine/budget.ts): one of these words, nothing else. */
const CAPPED = new Set(["switch_off", "no_key", "action_budget", "company_cap", "pool_day_cap", "address_cap", "all_time_cap", "busy"]);
const transfer: Pick = (p) => ({ ...money(p.amount), status: p.status, request_id: p.request_id });
const conversion: Pick = (p) => ({ ...money(p.buy), request_id: p.request_id });
const fee: Pick = (p) => money(p.fee);

const EVENTS: Record<string, Pick> = {
  // Payables (src/ap): a document comes in, is read and checked, and its invoice moves from status to status.
  "ap.received": (p) => ({ status: p.status, read_by: p.read_by, amount: p.total, currency: p.currency, findings: codes(p.findings) }),
  "ap.status": (p) => ({ status: p.to, from: p.from, proposal_id: p.proposal_id }),
  "ap.duplicate_document": copy("invoice_id"),
  "ap.duplicate_cleared": NONE,
  "ap.credit_accepted": (p) => money(p.amount),
  "ap.review_note": copy("status"),
  "ap.reading_not_used": copy("model"),
  "ap.scan_read": copy("model", "pages", "readings"),
  "ap.sink_failed": NONE,
  "ap.attachment_refused": NONE,
  "ap.email_attachments_capped": NONE,
  "ap.email_without_pdf": NONE,
  "payee.add_requested": copy("currency"),
  "payee.add_verified": NONE,
  "payee.add_closed": NONE,
  "payee.adopted": NONE,
  "payee.added": copy("currency"),
  // Claude (src/claude): which model, whether its answer or the fallback was used, the request and its cost.
  "claude.read": (p) => ({ source: "claude", model: p.model, request_id: p.request_id, cost_usd_micros: p.cost_usd_micros }),
  "claude.fallback": (p) => ({ source: "fallback", model: p.model }),
  "claude.rejected": copy("model"),
  "document.injection_flagged": NONE,
  // A call on its way: written just before it is sent (by the reader with its role, by an agent with its turn). It says
  // a call was sent, to which model; never the prompt, never what the answer will be.
  "claude.asking": copy("agent", "role", "model", "turn"),
  // Claude was not asked, and why (a switch, no key, or a cap): code read and decided instead.
  "claude.capped": (p) => ({ reason: typeof p.reason === "string" && CAPPED.has(p.reason) ? p.reason : undefined }),
  // The product's agents (src/agents/loop.ts on branch ap-agents-1112): a tool's name and the first sentence of what it
  // answered, the model's words, a nudge, and the run's outcome. A tool's input is never shown.
  "agent.tool": (p) => ({ agent: p.agent, tool: p.tool, turn: p.turn, model: p.model, request_id: p.request_id, ms: p.ms, answer: firstSentence(p.result, 160) }),
  "agent.said": (p) => ({ agent: p.agent, turn: p.turn, model: p.model, text: masked(p.text, 600) }),
  "agent.nudged": (p) => ({ agent: p.agent, reason: masked(p.reason, 160) }),
  "agent.run": copy("agent", "model", "status", "turns", "cost_usd_micros", "latency_ms"),
  // The agents' decisions (src/ap/checkerAgent.ts, src/ap/payerAgent.ts): who decided, what code required or overrode;
  // the codes of code's findings, never their words, the agent's reason or the payment's terms.
  "ap.checker_decided": (p) => ({ ...copy("source", "model", "action", "outcome", "overridden", "overridden_by", "code_requires")(p), codes: codes(p.code_findings) }),
  "ap.payer_proposed": copy("source", "model", "rail", "pay_on", "pay_currency", "outcome", "overridden", "overridden_by"),
  // The passkey (src/passkey).
  "passkey.enrolment_opened": NONE,
  "passkey.pending": NONE,
  "passkey.enrolled": NONE,
  "passkey.revoked": NONE,
  "passkey.refused": NONE,
  "passkey.enrol_refused": NONE,
  "passkey.enrol_conflict": NONE,
  // Proposals and approvals (src/policy/approvals.ts).
  "proposal.created": copy("kind"),
  "proposal.approved": copy("method"),
  "proposal.rejected": copy("method"),
  "proposal.cosigned": copy("method"),
  "proposal.executing": NONE,
  "proposal.executed": copy("status"),
  "proposal.failed": NONE,
  "proposal.expired": NONE,
  "proposal.needs_reapproval": NONE,
  "proposal.superseded": NONE,
  "approval.too_late": NONE,
  "hub.gate_refused": NONE,
  // The payment on the rails (src/executors, src/payouts, the treasury's seed).
  "treasury.seeded": copy("amount", "currency"),
  "invoice.escalated": NONE,
  "invoice.fraud_suspected": NONE,
  "fx.rate_checked": NONE,
  "fx.converted": conversion,
  "fx.adopted": conversion,
  "transfer.created": transfer,
  "transfer.adopted": transfer,
  "transfer.status": copy("status"),
  "transfer.awaiting_airwallex_approval": copy("status"),
  "transfer.fee": fee,
  "transfer.fee_over_reserve": fee,
  "transfer.fee_over_ceiling": fee,
  "transfer.refused": (p) => ({ ...money(p.amount), request_id: p.request_id }),
  "transfer.ambiguous": NONE,
  "transfer.left_open": NONE,
  "transfer.retry": NONE,
  "transfer.retry_stopped": NONE,
  "transfer.payee_unconfirmed": NONE,
  "transfer.row_conflict": NONE,
  "transfer.follow_failed": NONE,
  "transfer.found_after_close": NONE,
  "platform_fee.taken": (p) => money(p.amount),
  "platform_fee.not_taken": NONE,
  "platform_fee.open": NONE,
  "platform_fee.mismatch": NONE,
  "platform_fee.void": NONE,
  "batch.partly_paid": copy("paid", "of"),
  "batch.line_removed": NONE,
  // The archive (src/vault).
  "vault.filed": copy("files", "corrections"),
  "vault.failed": NONE,
};

const isValue = (v: unknown): v is string | number | boolean | null => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** An audit row as a page may show it: the event's own short list of fields, and only values that are plain. */
export function publicEvent(row: EventRow): EngineEvent {
  const pick = Object.hasOwn(EVENTS, row.event) ? EVENTS[row.event] : undefined;
  const fields: EngineEvent["fields"] = {};
  if (pick) {
    let payload: Payload = {};
    try {
      const parsed: unknown = JSON.parse(row.payload_json);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed as Payload;
    } catch { /* a payload that does not parse carries nothing */ }
    for (const [k, v] of Object.entries(pick(payload))) if (isValue(v)) fields[k] = v;
  }
  return { seq: row.seq, ts: row.ts, actor: row.actor, event: row.event, subject: pick ? row.subject : null, fields };
}

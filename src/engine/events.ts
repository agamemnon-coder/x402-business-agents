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
 * A text a page may show: every IBAN and every run of 8 or more digits (an account number, not an invoice number's), however it is spaced, cut to its last four
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
    // An invoice number's digits (BTX-2026-21-87668997, right after letters and a dash or slash) are not one either
    // (jury run, 15 Nov: the Checker's line read "BTX-****8997").
    .replace(/\b\d(?:[\s.-]*\d){7,}\b/g, (m, at: number, all: string) => (/^(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})$/.test(m) || /[A-Za-z][-/]$/.test(all.slice(Math.max(0, at - 2), at)) ? m : last4(m)))
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]");
  if (out.length <= max) return out;
  // Cut at the last word boundary that fits, never inside a word (try-fixes, 13 Nov: quotes ended mid-word).
  const cut = out.slice(0, max - 1);
  const space = cut.search(/\s\S*$/);
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}…`;
}
/** The first sentence of a text, masked, at most `max` characters. A dot after a capital ("B.V. is", "GmbH. ") never ends it
 * (round 4, 14 Nov: a reason was cut at "B.V."); a sentence that runs on is cut at a word, with "…". */
/** How many fields a tool's input has (never their names or values); undefined when it is no object. */
const inputKeys = (v: unknown): number | undefined => (v && typeof v === "object" && !Array.isArray(v) ? Math.min(Object.keys(v).length, 99) : undefined);
/** A list of whole milliseconds as one text ("812,640"), at most 12 entries. */
const msList = (v: unknown): string | undefined =>
  Array.isArray(v) && v.length && v.every((x) => Number.isSafeInteger(x) && (x as number) >= 0) ? v.slice(0, 12).join(",") : undefined;
const firstSentence = (v: unknown, max: number): string | undefined => {
  const m = masked(v, 10_000);
  return m === undefined ? undefined : masked(m.split(/(?<=[a-z0-9%)"'”][.!?])\s+(?=[A-Z0-9"“(])/)[0], max);
};
/** The last of a run's request ids (the call that gave the answer): an Anthropic request id, nothing else. */
const lastRequest = (v: unknown): string | undefined => {
  const last = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").at(-1) : undefined;
  return last && /^[\w-]{1,80}$/.test(last) ? last : undefined;
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
  // 21 Nov 2026: a call Claude answered but whose answer was not used still cost: its request id and cost, when it had them.
  "claude.fallback": (p) => ({ source: "fallback", model: p.model, request_id: p.request_id, cost_usd_micros: p.cost_usd_micros }),
  "claude.rejected": copy("model"),
  "document.injection_flagged": NONE,
  // A call on its way: written just before it is sent (by the reader with its role, by an agent with its turn). It says
  // a call was sent, to which model; never the prompt, never what the answer will be.
  "claude.asking": copy("agent", "role", "model", "turn"),
  // Claude was not asked, and why (a switch, no key, or a cap): code read and decided instead.
  "claude.capped": (p) => ({ reason: typeof p.reason === "string" && CAPPED.has(p.reason) ? p.reason : undefined }),
  // The product's agents (src/agents/loop.ts on branch ap-agents-1112): a tool's name and the first sentence of what it
  // answered, the model's words, a nudge, and the run's outcome. A tool's input is never shown.
  // 15 Nov (/try's agent trace): how many fields the input has (0 for the Checker's six lookups, which take none; never
  // a name or a value), and whether code refused the call.
  "agent.tool": (p) => ({
    agent: p.agent, tool: p.tool, turn: p.turn, model: p.model, request_id: p.request_id, ms: p.ms, answer: firstSentence(p.result, 160),
    inputs: inputKeys(p.input), refused: typeof p.blocked_by === "string" && p.blocked_by ? true : undefined,
  }),
  "agent.said": (p) => ({ agent: p.agent, turn: p.turn, model: p.model, text: masked(p.text, 600) }),
  "agent.nudged": (p) => ({ agent: p.agent, reason: masked(p.reason, 160) }),
  // 15 Nov: each Claude call's own time in ms, in turn order ("812,640"), from the run's measurement (claude_ms).
  "agent.run": (p) => ({ ...copy("agent", "model", "status", "turns", "cost_usd_micros", "latency_ms")(p), request_id: lastRequest(p.request_ids), claude_ms: msList(p.claude_ms) }),
  // The agents' decisions (src/ap/checkerAgent.ts, src/ap/coderAgent.ts, src/ap/payerAgent.ts; task A6): who decided,
  // the agent's one-line reason (masked, its first sentence), what code required, enforced or overrode, and the request
  // that gave the answer. The codes of code's findings, never their words; never the payment's terms.
  "ap.checker_decided": (p) => ({
    ...copy("source", "model", "action", "outcome", "overridden", "overridden_by", "code_requires", "code_rule")(p), codes: codes(p.code_findings),
    reason: firstSentence(p.reason, 160), enforced: firstSentence(p.why, 160), request_id: lastRequest(p.request_ids),
    // 15 Nov (jury): how many concerns the agent itself named (its findings: a count, never their words), so /try can
    // say "no concerns found" only when the agent found none.
    concerns: Array.isArray(p.agent_findings) ? p.agent_findings.length : undefined,
    // 15 Nov: the always-pay script on the same case (src/ap/checkerAgent.ts scriptOn): code's outcome and its rule.
    script_outcome: typeof p.script_outcome === "string" ? p.script_outcome : undefined, script_overridden_by: typeof p.script_overridden_by === "string" ? p.script_overridden_by : undefined,
  }),
  "ap.coded": (p) => {
    const lines = Array.isArray(p.lines) ? (p.lines as { account?: unknown; vat_code?: unknown; cost_centre?: unknown }[]) : [];
    const first = lines[0] ?? {};
    // The agent's own call: the origin's (its answer was used) or the one code refused (set_by).
    const origin = typeof p.origin === "object" && p.origin !== null ? (p.origin as { request_id?: unknown; model?: unknown; set_by?: { request_id?: unknown; model?: unknown } }) : {};
    const agent = origin.set_by && typeof origin.set_by === "object" ? origin.set_by : origin;
    return {
      source: p.source, model: p.model, agent_model: p.overridden_by && typeof agent.model === "string" ? agent.model : undefined, status: p.status, lines: lines.length, refused: firstSentence(p.refused_because, 160),
      account: typeof first.account === "string" ? first.account : undefined, vat_code: typeof first.vat_code === "string" ? first.vat_code : undefined,
      // The foreign code the books set on a line the Coder left without one (src/ap/coderAgent.ts store).
      books_vat_code: p.books_vat_code === "PF_DE19" ? "PF_DE19" : undefined,
      // The rate of VAT left without a code, a whole percent (src/ap/coderAgent.ts store).
      uncoded_vat_pct: Number.isSafeInteger(p.uncoded_vat_pct) && (p.uncoded_vat_pct as number) > 0 && (p.uncoded_vat_pct as number) < 100 ? p.uncoded_vat_pct : undefined,
      cost_centre: typeof first.cost_centre === "string" ? first.cost_centre : undefined, overridden_by: p.overridden_by,
      reason: firstSentence(p.reason, 160), request_id: typeof agent.request_id === "string" ? agent.request_id : undefined,
    };
  },
  "ap.payer_proposed": (p) => ({
    ...copy("source", "model", "rail", "pay_on", "pay_currency", "outcome", "overridden", "overridden_by")(p),
    reason: firstSentence(p.reason, 160), request_id: lastRequest(p.request_ids),
    // In the cloud engine the agent proposes within code's plan: when it is held or off the plan, code's plan stands.
    plan_stands: p.plan_stands === true ? true : undefined,
    // Speed (13 Nov): the agent proposed while the invoice was filed, on this same case; Pay used that answer, enforced again.
    early: p.early === true ? true : undefined,
    enforced: p.plan_stands === true ? masked(`${firstSentence(p.plan_stands_why, 110) ?? "off the plan"}; code's own plan goes to the CFO's Face ID`, 200) : firstSentence(p.why, 160),
  }),
  // 21 Nov: a payment within the limit to pay alone that went to the CFO instead (src/ap/pay.ts payAlone): who did not
  // say pay (code, checker, payer, cash, limit) and why, masked, so a page and a recorded walk can say it.
  "ap.alone_declined": (p) => ({ by: typeof p.by === "string" ? p.by : undefined, why: masked(p.why, 240) }),
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
  // 16 Nov: a payment within the CFO's limit to pay alone, approved by code (src/policy/approvals.ts approveWithinLimit): the limit.
  "proposal.within_limit": copy("method", "limit"),
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
  // /try's live FX quote (cloud/src/engine/liveFx.ts): the Airwallex sandbox's quote the terms carry, or why the
  // recorded rate was used instead (a fixed code).
  "airwallex.quote": copy("quote_id", "client_rate", "valid_to"),
  // /try's sandbox payout (cloud/src/engine/livePayout.ts): the Airwallex sandbox transfer of a signed payment, or why not.
  "airwallex.transfer": (p) => ({ transfer_id: p.transfer_id, status: p.status, ...money(p.amount) }),
  // The visitor's "Sandbox: move to PAID": the sandbox's own simulation of that transfer, not a payment.
  "airwallex.simulated": copy("transfer_id", "status"),
  "airwallex.payout_skipped": (p) => ({ reason: typeof p.reason === "string" && /^[a-z_]{1,20}$/.test(p.reason) ? p.reason : undefined }),
  "airwallex.unavailable": (p) => ({ reason: typeof p.reason === "string" && /^[a-z_]{1,20}$/.test(p.reason) ? p.reason : undefined, client_rate: p.client_rate }),
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
  "transfer.held_before_create": NONE,
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

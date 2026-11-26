// Task mandates, the pure part (governance, 26 Nov: "grant authority explicitly"): what one task mandate says, its one
// written form, and whether a change to it widens it. No database and no Node modules. The ledger side, and the gate that
// enforces it, is src/policy/taskMandates.ts.
//
// A task mandate gives one agent authority for one task, e.g. "pay November's supplier invoices, at most EUR 5,000.00 in
// all, to these payees, until 30 November". It is CFO policy like the rest: a setting `task_mandate.<id>` whose value is
// the mandate in its canonical JSON (the exact text the CFO signs), granted or widened only by a policy change approved
// with the passkey; narrowed or revoked at once, without Face ID, like the emergency stop.

export const TASK_MANDATE_PREFIX = "task_mandate.";
/** A mandate's id: lower-case letters, digits and dashes, 2 to 40 characters ("nov-suppliers"). */
export const TASK_MANDATE_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** The payments a task mandate can cover: a supplier invoice's payment, on either route (src/policy/signedApproval.ts ALONE_KINDS). */
export const MANDATE_KINDS = ["invoice_payment", "supplier_payment"] as const;
export type MandateKind = (typeof MANDATE_KINDS)[number];
/** The agents a task mandate can be granted to: those whose principal may pay supplier invoices (DEFAULT_CAPABILITIES). */
export const MANDATE_AGENTS = ["treasury"] as const;
/**
 * The principal an acting agent pays as: the payables chain's Payer pays supplier invoices as the treasury agent (its
 * payments are filed by treasury, src/ap/pay.ts); every other agent as itself.
 */
export const principalOfActor = (actor: string) => (actor === "payer" || actor === "checker" ? "treasury" : actor);
/** At most this many payees in one mandate: a task, not a standing permission. */
export const MAX_MANDATE_PAYEES = 50;
/** The most one mandate may total, in its currency (the limit to pay alone's own ceiling). */
export const MAX_MANDATE_TOTAL_CENTS = 10_000_000_000;

export interface TaskMandate {
  /** The agent it is granted to (a principal: src/policy/principals.ts), e.g. "treasury". */
  agent: string;
  /** The task, in words (shown to the CFO and in the record; enforced through kinds and invoice_month). */
  purpose: string;
  /** The payments it covers. */
  kinds: MandateKind[];
  /** Only invoices issued in this month (YYYY-MM), e.g. "November's invoices"; null: any month. */
  invoice_month: string | null;
  /** The currency of `total` and of every payment under it. */
  currency: string;
  /** The most all payments under it may add up to, two decimals. */
  total: string;
  /** Who may be paid under it: payee names as on the payment's terms. */
  payees: string[];
  /** The first day it may be used (YYYY-MM-DD, UTC). */
  from: string;
  /** The last day it may be used (YYYY-MM-DD, UTC, inclusive): it expires at the end of that day. */
  until: string;
  /** active, or revoked (for good: a revoked mandate is never active again without a new grant). */
  status: "active" | "revoked";
}

const MONEY = /^\d{1,9}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const cents = (s: string) => Number(s.replace(".", ""));
const isDay = (s: unknown): s is string => typeof s === "string" && DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** A payee name as compared: case, spacing and surrounding blanks do not count; nothing else is folded (no lookalikes). */
export const payeeKey = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** The setting key of mandate `id`, or null when the id is not one. */
export function mandateKey(id: string): string | null {
  return TASK_MANDATE_ID.test(id) ? `${TASK_MANDATE_PREFIX}${id}` : null;
}
/** The id in a setting key, or null when the key is not a task mandate's. */
export function mandateIdOf(key: string): string | null {
  if (!key.startsWith(TASK_MANDATE_PREFIX)) return null;
  const id = key.slice(TASK_MANDATE_PREFIX.length);
  return TASK_MANDATE_ID.test(id) ? id : null;
}

/** The one written form: fields in this order, payees and kinds sorted. What the CFO signs is exactly this text. */
export function canonicalMandate(m: TaskMandate): string {
  return JSON.stringify({
    agent: m.agent, purpose: m.purpose, kinds: [...m.kinds].sort(), invoice_month: m.invoice_month, currency: m.currency, total: m.total,
    payees: [...m.payees].sort((a, b) => payeeKey(a).localeCompare(payeeKey(b)) || a.localeCompare(b)), from: m.from, until: m.until, status: m.status,
  });
}

/** The mandate a value states, or why it states none. Never throws. */
export function parseMandate(value: string): { ok: true; mandate: TaskMandate } | { ok: false; why: string } {
  const no = (why: string) => ({ ok: false as const, why });
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return no("a task mandate is written as JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return no("a task mandate is a JSON object");
  const o = raw as Record<string, unknown>;
  const known = ["agent", "purpose", "kinds", "invoice_month", "currency", "total", "payees", "from", "until", "status"];
  const extra = Object.keys(o).find((k) => !known.includes(k));
  if (extra) return no(`a task mandate has no field ${JSON.stringify(extra.slice(0, 40))}`);
  if (typeof o.agent !== "string" || !(MANDATE_AGENTS as readonly string[]).includes(o.agent)) return no(`agent must be ${MANDATE_AGENTS.join(" or ")}: the agent that pays supplier invoices (src/policy/principals.ts)`);
  if (typeof o.purpose !== "string" || o.purpose.trim().length < 3 || o.purpose.length > 160 || o.purpose !== o.purpose.trim()) return no("purpose must say the task in 3 to 160 characters");
  if (!Array.isArray(o.kinds) || o.kinds.length === 0 || !o.kinds.every((k) => (MANDATE_KINDS as readonly unknown[]).includes(k)) || new Set(o.kinds).size !== o.kinds.length) {
    return no(`kinds must be one or more of ${MANDATE_KINDS.join(", ")}, each once`);
  }
  if (o.invoice_month !== null && (typeof o.invoice_month !== "string" || !MONTH.test(o.invoice_month))) return no("invoice_month must be a month (YYYY-MM) or null");
  if (typeof o.currency !== "string" || !/^[A-Z]{3}$/.test(o.currency)) return no("currency must be a currency code (EUR)");
  if (typeof o.total !== "string" || !MONEY.test(o.total) || cents(o.total) <= 0 || cents(o.total) > MAX_MANDATE_TOTAL_CENTS) return no("total must be an amount above zero, like 5000.00");
  if (!Array.isArray(o.payees) || o.payees.length === 0 || o.payees.length > MAX_MANDATE_PAYEES) return no(`payees must name 1 to ${MAX_MANDATE_PAYEES} payees`);
  if (!o.payees.every((p) => typeof p === "string" && p === p.trim() && p.length >= 2 && p.length <= 120)) return no("each payee is a name of 2 to 120 characters");
  if (new Set((o.payees as string[]).map(payeeKey)).size !== o.payees.length) return no("a payee is named twice");
  if (!isDay(o.from) || !isDay(o.until)) return no("from and until must be days (YYYY-MM-DD)");
  if (o.until < o.from) return no(`until (${o.until}) is before from (${o.from})`);
  if (o.status !== "active" && o.status !== "revoked") return no("status must be active or revoked");
  return { ok: true, mandate: { agent: o.agent, purpose: o.purpose, kinds: o.kinds as MandateKind[], invoice_month: o.invoice_month, currency: o.currency, total: o.total, payees: o.payees as string[], from: o.from, until: o.until, status: o.status } };
}

/**
 * Whether going from `from` to `to` gives the agent any authority it did not have: a revoked mandate made active, another
 * agent or currency, a higher total, a payment kind, month or payee it did not cover, an earlier start or a later end, or
 * the task's words changed. Anything else narrows it (or leaves it as it was). A mandate that does not parse widens.
 */
export function widens(from: TaskMandate, to: TaskMandate): boolean {
  if (from.status === "revoked" && to.status === "active") return true;
  if (to.agent !== from.agent || to.currency !== from.currency || to.purpose !== from.purpose) return true;
  if (cents(to.total) > cents(from.total)) return true;
  if (!to.kinds.every((k) => from.kinds.includes(k))) return true;
  if (from.invoice_month !== null && to.invoice_month !== from.invoice_month) return true;
  const had = new Set(from.payees.map(payeeKey));
  if (!to.payees.every((p) => had.has(payeeKey(p)))) return true;
  return to.from < from.from || to.until > from.until;
}

/** The mandate in words, as the policy and the authority map show it. */
export function mandateWords(m: TaskMandate): string {
  const payees = m.payees.length <= 3 ? m.payees.join(", ") : `${m.payees.slice(0, 3).join(", ")} and ${m.payees.length - 3} more`;
  return `${m.agent}: ${m.purpose}; at most ${m.currency} ${m.total} in all to ${payees}${m.invoice_month ? `; invoices of ${m.invoice_month}` : ""}; ${m.from} to ${m.until}${m.status === "revoked" ? "; revoked" : ""}`;
}

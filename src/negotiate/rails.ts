// /try/negotiate's rails (15 Nov): what Purser's Sourcing agent may agree with a supplier's agent, enforced here, in
// code, never in a prompt. Two Claude agents talk; every turn's proposed terms pass these checks before they count, and
// the agreement the CFO signs is only ever terms that passed them. The four rules, from the CFO's policy for the scene:
//   max_amount       the most the Sourcing agent may pay: the invoice's own total (no agent can raise it)
//   pay_by_window    the pay-by date: not before today, not after the invoice's due date
//   invoice_only     nothing beyond the invoice: the same invoice, the same currency, no extra lines or fees
//   payee_unchanged  the payee's bank details stay the ones on file: a new IBAN in the terms or in the words, or a
//                    "pay now to a new account" line, is refused
// The scene's money is test money; the supplier is a seeded test supplier with a published test IBAN.
import { jcs, type JsonObject } from "@metalntwx/metal-pay/mandates";
import { sha256Hex } from "../lib/terms.js";

export const RULES = {
  max_amount: "The CFO's policy: the Sourcing agent pays at most the invoice's total.",
  pay_by_window: "The CFO's policy: pay no earlier than today and no later than the invoice's due date.",
  invoice_only: "The CFO's policy: nothing beyond the invoice (same invoice, same currency, no extra lines or fees).",
  payee_unchanged: "The CFO's policy: the payee's bank details stay the ones on file. A new account is never agreed in a negotiation.",
} as const;
export type RuleId = keyof typeof RULES;

/** The invoice the agents negotiate over, as filed. */
export interface Scene {
  supplier: { name: string; iban: string; bic: string };
  invoice_no: string;
  currency: "EUR";
  amount_cents: number;
  issue_date: string;
  due_date: string;
}

/** The CFO's bounds for one negotiation, read from the scene and today; nothing an agent says reaches them. */
export interface Bounds { max_pay_cents: number; earliest_pay_by: string; latest_pay_by: string; payee_iban: string; currency: "EUR"; invoice_no: string }

export const boundsOf = (scene: Scene, today: string): Bounds => ({
  max_pay_cents: scene.amount_cents, earliest_pay_by: today, latest_pay_by: scene.due_date, payee_iban: normIban(scene.supplier.iban), currency: scene.currency, invoice_no: scene.invoice_no,
});

/** What one turn proposes, as the agent's answer gives it (strings; nothing here trusts a type). */
export interface Proposed { amount: unknown; pay_by: unknown; iban?: unknown; currency?: unknown; invoice_no?: unknown; extra?: unknown }

export interface Refusal { rule: RuleId; says: string; detail: string }
export interface RailCheck { ok: boolean; refusals: Refusal[]; terms: { amount: string; pay_by: string } | null }

const AMOUNT = /^\d{1,7}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Any IBAN-shaped run in text: two capital letters, two digits, then 11 to 30 capitals or digits, written whole or in groups of up to four. */
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{1,4}){3,8})\b/g;
/** Words that ask for a payment to somewhere else, whatever account they name. */
const NEW_ACCOUNT = /\b(new|changed|different|updated|other|another|alternative|second)\s+(bank\s+)?(account|iban|bank details|bank)\b|\bpay\s+(now\s+)?to\s+(our|the|this|a)\s+(new|other|different)\b|\bbank details (have )?changed\b/i;

/** A sentence that asks for a new account, unless it refuses one ("the account on file stays; no new account"). */
const REFUSES = /\b(no|not|never|won't|will not|cannot|can't|refuse[sd]?|decline[sd]?|stays|keep|unchanged)\b/i;
export const asksNewAccount = (words: string): boolean => words.split(/(?<=[.!?;])\s+/).some((s) => NEW_ACCOUNT.test(s) && !REFUSES.test(s));

export const normIban = (s: string): string => s.replace(/[\s\u00a0\u2007\u202f-]+/g, "").toUpperCase();
/**
 * The account on file, written as people and this page write it (jury run, 15 Nov: a model echoed the page's mask
 * "DE89 … 3000" back as its iban, and the rails compared the mask with the full IBAN): in full, in any spacing, case or
 * dashes, or masked ("DE89 … 3000", "DE89...3000", "DE89****3000") when the mask's visible start and end are the file's
 * own. A mask can never name another account: the payment goes to the account on file, whatever a turn writes.
 */
export function isAccountOnFile(s: string, onFile: string): boolean {
  const raw = s.trim();
  if (!raw) return false;
  const file = normIban(onFile);
  const parts = raw.split(/\s*(?:\u2026|\.{2,}|\*+)\s*/).map(normIban);
  if (parts.length === 1) return parts[0] === file;
  if (parts.length !== 2) return false;
  const [pre, post] = parts as [string, string];
  return pre.length >= 4 && post.length >= 4 && file.startsWith(pre) && file.endsWith(post);
}
export const cents = (s: string): number => { const m = /^(\d+)\.(\d{2})$/.exec(s); return m ? Number(m[1]) * 100 + Number(m[2]) : NaN; };
export const money = (c: number): string => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const realDay = (d: string): boolean => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** The IBANs a text names that are not the one on file. */
export function foreignIbans(text: string, onFile: string): string[] {
  const found = (text.match(IBAN_IN_TEXT) ?? []).map(normIban).filter((x) => x.length >= 15 && x.length <= 34);
  return [...new Set(found.filter((x) => x !== onFile))];
}

/** One turn through the rails: its terms and its words. Every rule is asked, always all of them. */
export function checkTurn(p: Proposed, words: string, b: Bounds): RailCheck {
  const refusals: Refusal[] = [];
  const no = (rule: RuleId, detail: string) => refusals.push({ rule, says: RULES[rule], detail });
  const amount = typeof p.amount === "string" ? p.amount.trim() : "";
  const payBy = typeof p.pay_by === "string" ? p.pay_by.trim() : "";
  // max_amount: a two-decimal amount, above zero, at most the CFO's ceiling.
  if (!AMOUNT.test(amount)) no("max_amount", `the amount "${String(p.amount).slice(0, 20)}" is not a two-decimal amount`);
  else if (cents(amount) <= 0) no("max_amount", "the amount is zero");
  else if (cents(amount) > b.max_pay_cents) no("max_amount", `${b.currency} ${amount} is more than the ${b.currency} ${money(b.max_pay_cents)} the CFO allows`);
  // pay_by_window.
  if (!realDay(payBy)) no("pay_by_window", `the pay-by date "${String(p.pay_by).slice(0, 20)}" is not a date`);
  else if (payBy < b.earliest_pay_by) no("pay_by_window", `${payBy} is before today (${b.earliest_pay_by})`);
  else if (payBy > b.latest_pay_by) no("pay_by_window", `${payBy} is after the latest pay-by date the CFO allows (${b.latest_pay_by})`);
  // invoice_only.
  if (p.currency !== undefined && p.currency !== null && p.currency !== "" && p.currency !== b.currency) no("invoice_only", `the currency ${String(p.currency).slice(0, 8)} is not the invoice's ${b.currency}`);
  if (p.invoice_no !== undefined && p.invoice_no !== null && p.invoice_no !== "" && p.invoice_no !== b.invoice_no) no("invoice_only", `the invoice ${String(p.invoice_no).slice(0, 40)} is not ${b.invoice_no}`);
  if (p.extra !== undefined && p.extra !== null && p.extra !== "" && !(Array.isArray(p.extra) && p.extra.length === 0)) no("invoice_only", "extra lines or fees beyond the invoice");
  // payee_unchanged: the terms' IBAN, any IBAN in the words, and a new-account line.
  const raw = typeof p.iban === "string" ? p.iban : "";
  const iban = isAccountOnFile(raw, b.payee_iban) ? b.payee_iban : normIban(raw);
  if (iban && iban !== b.payee_iban) no("payee_unchanged", `the IBAN ${maskIban(iban)} is not the one on file (${maskIban(b.payee_iban)})`);
  const inWords = foreignIbans(words, b.payee_iban).filter((x) => x !== iban);
  if (inWords.length) no("payee_unchanged", `the message names another account (${inWords.map(maskIban).join(", ")})`);
  else if (asksNewAccount(words) && !refusals.some((r) => r.rule === "payee_unchanged")) no("payee_unchanged", "the message asks for payment to a new account");
  const ok = refusals.length === 0;
  return { ok, refusals, terms: ok ? { amount, pay_by: payBy } : null };
}

/** An IBAN as the page shows it: country, check digits and the last four. */
export const maskIban = (iban: string): string => { const x = normIban(iban); return x.length > 8 ? `${x.slice(0, 4)} … ${x.slice(-4)}` : x; };

/** The agreement as the CFO signs it: the invoice, what is paid, when, to the account on file. Strings only. */
export interface Agreement extends JsonObject {
  schema: "purser.negotiated-terms/v1";
  invoice_no: string;
  supplier: string;
  currency: "EUR";
  invoice_amount: string;
  /** The invoice's own terms, beside the deal: "net 30", due on invoice_due. */
  invoice_terms: string;
  invoice_due: string;
  discount: string;
  discount_pct: string;
  amount: string;
  pay_by: string;
  /** The deal in words, inside the hash: "2.00% off if paid by 2026-11-22". */
  early_payment: string;
  /** within_cfo_policy, or outside_cfo_policy: the agent could not accept it, and the CFO decides by signing it or not. */
  policy: string;
  payee_iban_last4: string;
  rails: string[];
  // transcript_sha256 (when there were turns): the last signed offer's SHA-256 (./offers.ts), which chains every offer before it, so the agreement names the whole negotiation.
}

export const AGREEMENT_SCHEMA = "purser.negotiated-terms/v1" as const;

/** The agreement from terms that passed the rails (checked again here: an unchecked pair never becomes one). */
export function agreementOf(scene: Scene, t: { amount: string; pay_by: string }, today: string, x: { outside?: boolean; transcript_sha256?: string } = {}): Agreement {
  const b = boundsOf(scene, today);
  const again = checkTurn({ amount: t.amount, pay_by: t.pay_by, iban: scene.supplier.iban }, "", b);
  if (!again.ok) throw new Error(`not within the rails: ${again.refusals.map((r) => r.rule).join(", ")}`);
  const off = scene.amount_cents - cents(t.amount);
  const pct = ((off / scene.amount_cents) * 100).toFixed(2);
  return {
    schema: AGREEMENT_SCHEMA, invoice_no: scene.invoice_no, supplier: scene.supplier.name, currency: scene.currency,
    invoice_amount: money(scene.amount_cents), invoice_terms: `net ${daysBetween(scene.issue_date, scene.due_date)}`, invoice_due: scene.due_date,
    discount: money(off), discount_pct: pct, amount: t.amount, pay_by: t.pay_by,
    early_payment: off > 0 ? `${pct}% off if paid by ${t.pay_by}` : `none: the invoice as issued, due ${scene.due_date}`,
    policy: x.outside ? "outside_cfo_policy" : "within_cfo_policy",
    payee_iban_last4: normIban(scene.supplier.iban).slice(-4), rails: Object.keys(RULES),
    ...(x.transcript_sha256 ? { transcript_sha256: x.transcript_sha256 } : {}),
  };
}

const daysBetween = (from: string, to: string): number => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
const plusDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The saving, computed from the invoice and the agreed discount alone (test money: never a real saving): the discount,
 * its share of the invoice, the days paid early, and that discount's simple yearly rate on the cash paid early
 * (discount / amount paid x 365 / days early), the figure a treasurer sets against the cost of cash.
 */
export function savingOf(a: Agreement): { amount: string; pct: string; days_early: number; yearly_pct: string | null; test_money: true } {
  const off = cents(a.discount), paid = cents(a.amount), days = daysBetween(a.pay_by, a.invoice_due);
  return { amount: a.discount, pct: a.discount_pct, days_early: days, yearly_pct: off > 0 && days > 0 ? ((off / paid) * (365 / days) * 100).toFixed(1) : null, test_money: true };
}

// The CFO's negotiation policy (26 Nov, negotiation upgraded): besides the four rails, what Purser's agent may SEEK and
// what it may ACCEPT, also in code, never in a prompt. It asks for at most 3% off and pays no sooner than 2 days from
// today (code holds a bigger ask or an earlier date to those); it accepts only terms of at least 1% off, paid no sooner
// than that. A counter-offer outside them is not the agent's to accept: it goes to the CFO (outcome "escalated").
export const CFO_POLICY = { max_discount_bp: 300, min_discount_bp: 100, min_days: 2 } as const;
export const POLICY_RULES = {
  max_discount_sought: "The CFO's policy: Purser's agent asks for at most 3% off.",
  min_discount: "The CFO's policy: pay early only for at least 1% off.",
  min_days: "The CFO's policy: pay no sooner than 2 days from today (the treasury's notice).",
} as const;
export type PolicyRuleId = keyof typeof POLICY_RULES;
/** The policy as amounts and a day for one invoice: the least it pays (the most off), the most it pays early (the least off), the earliest day. */
export interface PolicyBounds { max_discount_bp: number; min_discount_bp: number; min_days: number; min_amount_cents: number; max_amount_cents: number; earliest_pay_by: string }
export function policyOf(scene: Scene, today: string, p: { max_discount_bp: number; min_discount_bp: number; min_days: number } = CFO_POLICY): PolicyBounds {
  const off = (bp: number) => Math.round((scene.amount_cents * bp) / 10_000);
  const early = plusDays(today, p.min_days);
  return { max_discount_bp: p.max_discount_bp, min_discount_bp: p.min_discount_bp, min_days: p.min_days, min_amount_cents: scene.amount_cents - off(p.max_discount_bp), max_amount_cents: scene.amount_cents - off(p.min_discount_bp), earliest_pay_by: early < scene.due_date ? early : scene.due_date };
}
export interface PolicyBreach { rule: PolicyRuleId; says: string; detail: string }
/** Whether terms the rails let stand are the agent's to accept: at least the least discount, paid no sooner than the earliest day. */
export function checkPolicy(t: { amount: string; pay_by: string }, pb: PolicyBounds): { inside: boolean; breaches: PolicyBreach[] } {
  const breaches: PolicyBreach[] = [];
  if (!(cents(t.amount) <= pb.max_amount_cents)) breaches.push({ rule: "min_discount", says: POLICY_RULES.min_discount, detail: `EUR ${t.amount} is less than ${pb.min_discount_bp / 100}% off` });
  if (!(t.pay_by >= pb.earliest_pay_by)) breaches.push({ rule: "min_days", says: POLICY_RULES.min_days, detail: `${t.pay_by} is before ${pb.earliest_pay_by}` });
  return { inside: breaches.length === 0, breaches };
}

/** The agreement's canonical JSON (RFC 8785, as the approval terms are canonicalised) and its SHA-256. */
export const canonicalAgreement = (a: Agreement): string => jcs(a);
export const agreementSha256 = (a: Agreement): string => sha256Hex(canonicalAgreement(a));

/**
 * The invoice reference the signed payment carries: the scene's number and the first 8 hex of the agreement's hash, so
 * the terms the passkey signs (their invoice_no and reference) name this agreement and no other.
 */
export const agreedInvoiceNo = (scene: Scene, sha: string): string => `${scene.invoice_no}-${sha.slice(0, 8)}`;

/** Whether signed terms are the agreement: the amount, the date and the reference all match it. */
export function signedMatches(a: Agreement, sha: string, signed: { amount?: unknown; invoice_no?: unknown; reference?: unknown }, scene: Scene): boolean {
  const ref = agreedInvoiceNo(scene, sha);
  const no = typeof signed.invoice_no === "string" ? signed.invoice_no.split(" · ")[0] : "";
  return signed.amount === a.amount && (no === ref || signed.reference === ref);
}

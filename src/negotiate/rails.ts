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

export const normIban = (s: string): string => s.replace(/\s+/g, "").toUpperCase();
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
  const iban = typeof p.iban === "string" ? normIban(p.iban) : "";
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
  discount: string;
  amount: string;
  pay_by: string;
  payee_iban_last4: string;
  rails: string[];
}

export const AGREEMENT_SCHEMA = "purser.negotiated-terms/v1" as const;

/** The agreement from terms that passed the rails (checked again here: an unchecked pair never becomes one). */
export function agreementOf(scene: Scene, t: { amount: string; pay_by: string }, today: string): Agreement {
  const b = boundsOf(scene, today);
  const again = checkTurn({ amount: t.amount, pay_by: t.pay_by, iban: scene.supplier.iban }, "", b);
  if (!again.ok) throw new Error(`not within the rails: ${again.refusals.map((r) => r.rule).join(", ")}`);
  return {
    schema: AGREEMENT_SCHEMA, invoice_no: scene.invoice_no, supplier: scene.supplier.name, currency: scene.currency,
    invoice_amount: money(scene.amount_cents), discount: money(scene.amount_cents - cents(t.amount)), amount: t.amount, pay_by: t.pay_by,
    payee_iban_last4: normIban(scene.supplier.iban).slice(-4), rails: Object.keys(RULES),
  };
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

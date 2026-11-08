// Payables, part 2: the checks every invoice passes before it can be paid, each with a plain reason. Code decides
// here; a model's reading only feeds it, and only after readingCheck. The order of precedence is fixed: anything that
// blocks makes the invoice blocked; else anything a person must look at makes it needs_review; else a supplier not on
// file makes it needs_vendor; else it is ready. Warnings are shown and change nothing.

import type { DB } from "../db/open.js";
import { invoiceKey } from "../lib/invoiceKey.js";
import { toCents, fromCents } from "../lib/money.js";
import { ibanSha } from "../agents/invoice.js";
import { assessAgainst, skeleton } from "../policy/fraudCore.js";
import { accountKey, chooseRoute, payableCurrency, validateDetails } from "../payouts/routes.js";
import { bankFromReading, suppliersOnFile } from "./bank.js";
import { counterpartyAllowed } from "../policy/rules.js";
import { handledInLedger } from "./ledgerKey.js";
import { ibanValid, type ApReading } from "./reading.js";
import type { ApStatus, Finding } from "./store.js";

/**
 * Whether Purser pays this currency (src/payouts/routes.ts: a currency SWIFT carries, with two decimals). EUR invoices
 * to suppliers on file from the Kit 11 payees still go through the invoice_payment path; the rest through
 * supplier_payment (src/payouts/plan.ts).
 */
export const paysCurrency = payableCurrency;

/** An invoice this many times its supplier's usual (the median of its earlier ones) is flagged. */
export const UNUSUAL_FACTOR = 2;

const MONEY = /^\d+\.\d{2}$/;

export interface CheckContext {
  docSha: string;
  now: Date;
  /** The invoice being checked again, so it is not its own duplicate. */
  selfId?: string;
  /** Set when the document had no text to read: why. */
  noText?: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export function evaluate(db: DB, r: ApReading, text: string, ctx: CheckContext): { status: ApStatus; findings: Finding[] } {
  const f: Finding[] = [];
  if (ctx.noText) {
    f.push({ code: "no_text", level: "review", detail: ctx.noText });
    return { status: "needs_review", findings: f };
  }
  const missing = (["vendor", "invoice_no", "total", "currency"] as const).filter((k) => !r[k]);
  if (missing.length) f.push({ code: "missing_fields", level: "review", detail: `needs a person: the reading lacks ${missing.join(", ").replace(/_/g, " ")}` });
  if (r.total && !MONEY.test(r.total)) f.push({ code: "missing_fields", level: "review", detail: `needs a person: the total ${JSON.stringify(r.total)} is not a plain amount` });

  // Where to pay: an IBAN, or an account number with its routing code or BIC, checked against the country's payout
  // guide before anything else looks at it (src/payouts/routes.ts).
  const bank = bankFromReading(r);
  let accountOk = false;
  if (!r.iban && !r.account_number) f.push({ code: "no_bank_details", level: "review", detail: "the invoice gives no IBAN or account number to pay to; a person checks how this supplier is paid" });
  else if (r.iban && !ibanValid(r.iban)) f.push({ code: "iban_invalid", level: "block", detail: `the IBAN ending ${r.iban.slice(-4)} fails its checksum: a typing error or a forged number; nothing is paid to it` });
  else if (r.currency) {
    const route = chooseRoute(bank);
    if (!route.ok) {
      const code = payableCurrency(r.currency) ? "country_not_paid" : "currency_not_paid";
      f.push({ code, level: "review", detail: `${route.reason}; a person pays this one by hand (it is still booked)` });
    } else {
      const wrong = validateDetails(bank, route.route);
      if (wrong.length) f.push({ code: "bank_details_invalid", level: "block", detail: `${wrong.join("; ")}: nothing is paid to these details` });
      else accountOk = true;
    }
  }

  if (MONEY.test(r.subtotal) && MONEY.test(r.tax) && MONEY.test(r.total) && toCents(r.subtotal) + toCents(r.tax) !== toCents(r.total)) {
    f.push({ code: "sum_mismatch", level: "block", detail: `the subtotal ${r.subtotal} plus tax ${r.tax} is ${fromCents(toCents(r.subtotal) + toCents(r.tax))}, not the total ${r.total}` });
  }

  // The same invoice twice: in the inbox already (another file), or already paid or on its way through the ledger.
  if (r.invoice_no) {
    const key = invoiceKey(r.invoice_no);
    const same = (db.prepare("SELECT id, vendor, invoice_no, status FROM ap_invoices WHERE status <> 'rejected' AND (? IS NULL OR id <> ?)").all(ctx.selfId ?? null, ctx.selfId ?? null) as { id: string; vendor: string; invoice_no: string; status: string }[])
      .find((x) => invoiceKey(x.invoice_no) === key && skeleton(x.vendor) === skeleton(r.vendor));
    if (same) f.push({ code: "duplicate", level: "block", detail: `${same.id} is the same invoice ${same.invoice_no} from ${same.vendor} (${same.status.replace(/_/g, " ")}); a second copy is never paid` });
    else {
      const handled = handledInLedger(db, r.invoice_no, r.vendor, ctx.now);
      if (handled) f.push({ code: "duplicate", level: "block", detail: `${handled}; a second copy is never paid` });
    }
  }

  // Who is paid: the existing invoice-fraud check against the suppliers on file (changed bank details, a lookalike name,
  // another account holder). A supplier that is simply new waits for a person's verification and the CFO's Face ID.
  if (r.vendor && accountOk) {
    const key = accountKey(bank);
    const fraud = assessAgainst(suppliersOnFile(db), { vendor: r.vendor, iban: key, bic: "" }, text, ibanSha(key));
    const blocking = fraud.signals.filter((s) => s.blocks && s.code !== "unknown_vendor");
    if (fraud.suspicious) {
      f.push({ code: "possible_fraud", level: "block", detail: `possible invoice fraud: ${blocking.map((s) => s.detail).join("; ")}. Nothing is paid until a person checks with the supplier on a number already on file` });
    } else if (fraud.signals.some((s) => s.code === "unknown_vendor")) {
      const pending = db.prepare("SELECT add_id, status FROM payee_adds WHERE vendor = ? AND status <> 'APPLIED' ORDER BY created_at DESC").get(r.vendor) as { add_id: string; status: string } | undefined;
      f.push({ code: "new_supplier", level: "wait", detail: `${r.vendor} is not on file as a supplier yet: a person verifies its bank details with the supplier, then the CFO approves it with Face ID${pending ? ` (request ${pending.add_id}, ${pending.status.toLowerCase()})` : ""}` });
    }
    for (const s of fraud.signals.filter((x) => !x.blocks)) f.push({ code: s.code, level: "warn", detail: s.detail });
    if (fraud.allowlisted && !fraud.suspicious && !counterpartyAllowed(db, fraud.allowlisted.name)) {
      f.push({ code: "payee_blocked", level: "block", detail: `${fraud.allowlisted.name} is blocked by the CFO policy` });
    }
  }

  if (r.currency && !payableCurrency(r.currency) && !f.some((x) => x.code === "currency_not_paid")) {
    f.push({ code: "currency_not_paid", level: "review", detail: `the invoice is in ${r.currency}; Purser pays only two-decimal currencies that SWIFT carries, so a person pays this one by hand (it is still booked)` });
  }

  if (MONEY.test(r.total) && r.vendor) {
    const earlier = (db.prepare("SELECT vendor, total, currency FROM ap_invoices WHERE status NOT IN ('blocked', 'rejected') AND (? IS NULL OR id <> ?)").all(ctx.selfId ?? null, ctx.selfId ?? null) as { vendor: string; total: string; currency: string }[])
      .filter((x) => skeleton(x.vendor) === skeleton(r.vendor) && x.currency === r.currency && MONEY.test(x.total)).map((x) => toCents(x.total));
    if (earlier.length >= 2) {
      const usual = median(earlier);
      if (usual > 0 && toCents(r.total) > UNUSUAL_FACTOR * usual) {
        f.push({ code: "unusual_amount", level: "warn", detail: `${r.currency} ${r.total} is more than ${UNUSUAL_FACTOR} times this supplier's usual ${r.currency} ${fromCents(usual)} (the median of ${earlier.length} earlier invoices)` });
      }
    }
  }

  if (r.due_date && r.due_date < ctx.now.toISOString().slice(0, 10)) {
    f.push({ code: "overdue", level: "warn", detail: `the due date ${r.due_date} has passed` });
  }

  return { status: statusOf(f), findings: f };
}

/** The fixed precedence: block, then review, then wait; else ready. */
export function statusOf(f: Finding[]): ApStatus {
  const has = (level: Finding["level"]) => f.some((x) => x.level === level);
  return has("block") ? "blocked" : has("review") ? "needs_review" : has("wait") ? "needs_vendor" : "ready";
}

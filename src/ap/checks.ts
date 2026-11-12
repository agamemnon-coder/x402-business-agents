// Payables, part 2: the checks every invoice passes before it can be paid, each with a plain reason. Code decides
// here; a model's reading only feeds it, and only after readingCheck. The order of precedence is fixed: anything that
// blocks makes the invoice blocked; else anything a person must look at makes it needs_review; else a supplier not on
// file makes it needs_vendor; else it is ready. Warnings are shown and change nothing.
//
// The checks themselves are pure functions over an invoice case (src/ap/checkerCore.ts codeFindings): one
// implementation for this ledger, for the Checker agent's tools and for a Worker. Every database lookup is here: this
// module builds the case from the ledger (invoiceCase) and hands it over.

import { ibanSha } from "../agents/invoice.js";
import { COMPANY } from "../config/brand.js";
import { CONTRACTED_EUR_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { sameInvoiceNo } from "../lib/invoiceKey.js";
import { fromCents } from "../lib/money.js";
import { floorCents, fundingCurrency } from "../payouts/plan.js";
import { payableCurrency, SWIFT_CURRENCIES } from "../payouts/routes.js";
import { skeleton } from "../policy/fraudCore.js";
import { suppliersOnFile } from "./bank.js";
import { accountOfReading, codeFindings, payableAccount, statusOf, type ApStatus, type ExpectedAmount, type Finding, type HistoryInvoice, type InvoiceCase } from "./checkerCore.js";
import { handledInLedger } from "./ledgerKey.js";
import type { ApReading } from "./reading.js";

export { statusOf, TWIN_DAYS, UNUSUAL_FACTOR } from "./checkerCore.js";

/**
 * Whether Purser pays this currency (src/payouts/routes.ts: a currency SWIFT carries, with two decimals). EUR invoices
 * to suppliers on file from the Kit 11 payees still go through the invoice_payment path; the rest through
 * supplier_payment (src/payouts/plan.ts).
 */
export const paysCurrency = payableCurrency;

export interface CheckContext {
  docSha: string;
  now: Date;
  /** The invoice being checked again, so it is not its own duplicate. */
  selfId?: string;
  /** Set when the document had no text to read: why. */
  noText?: string;
}

/**
 * The payees the CFO's policy blocks, by name: every `counterparty:<name>` setting that says blocked. The set form of
 * counterpartyAllowed (src/policy/rules.ts), which asks the same setting for one name.
 */
export function blockedPayees(db: DB): string[] {
  const prefix = "counterparty:";
  return (db.prepare("SELECT key FROM settings WHERE substr(key, 1, ?) = ? AND value = 'blocked' ORDER BY key").all(prefix.length, prefix) as { key: string }[]).map((r) => r.key.slice(prefix.length));
}

/** The amount a contract says this supplier's invoice is, where the engine holds one (Kit 11's licence fee, src/config/policy.ts). */
function expectedFor(vendor: string): ExpectedAmount | null {
  const contracted = Object.entries(CONTRACTED_EUR_CENTS).find(([name]) => skeleton(name) === skeleton(vendor));
  return contracted ? { source: "contract", currency: "EUR", amount: fromCents(contracted[1]) } : null;
}

/**
 * The case the checks run on, and the Checker agent decides on: the reading and the document's text, with everything
 * the ledger knows that a decision needs. Plain data: nothing in it is a database handle, and a supplier's account is
 * in it as the ledger keeps it (a hash and its last four characters).
 */
export function invoiceCase(db: DB, r: ApReading, text: string, ctx: CheckContext): InvoiceCase {
  const self = ctx.selfId ? (db.prepare("SELECT received_at FROM ap_invoices WHERE id = ?").get(ctx.selfId) as { received_at: string } | undefined) : undefined;
  // The account's hash, as the ledger keeps a supplier's (only of details that route and check out: red team round 3).
  const account = payableAccount(r);
  const accountSha256 = account ? ibanSha(account) : null;

  const why = db.prepare("SELECT json_extract(payload_json, '$.reason') AS reason FROM audit_log WHERE subject = ? AND event = 'ap.status' ORDER BY seq DESC LIMIT 1");
  const history = (db.prepare("SELECT id, vendor, invoice_no, total, currency, issue_date, received_at, status, findings_json, reading_json FROM ap_invoices ORDER BY received_at, id").all() as
    { id: string; vendor: string; invoice_no: string; total: string; currency: string; issue_date: string; received_at: string; status: ApStatus; findings_json: string; reading_json: string }[])
    .map((x): HistoryInvoice => ({
      id: x.id, vendor: x.vendor, invoiceNo: x.invoice_no, total: x.total, currency: x.currency, issueDate: x.issue_date, receivedAt: x.received_at, state: x.status,
      accountKey: accountOfReading(JSON.parse(x.reading_json) as ApReading),
      blockedAsDuplicate: x.status === "blocked" && (JSON.parse(x.findings_json) as Finding[]).some((y) => y.code === "duplicate"),
      // A person's reason is looked up only for a rejected invoice under this invoice's number: the one the checks cite.
      rejectedWhy: x.status === "rejected" && x.id !== ctx.selfId && !!r.invoice_no && sameInvoiceNo(x.invoice_no, r.invoice_no)
        ? (why.get(x.id) as { reason: string | null } | undefined)?.reason ?? null
        : null,
    }));

  // Name, hash and last four as the fraud check has always read them (suppliersOnFile), with each account's BIC and currency.
  const more = new Map((db.prepare("SELECT beneficiary_id, bic, currency FROM beneficiaries WHERE status = 'ACTIVE'").all() as { beneficiary_id: string; bic: string; currency: string }[]).map((b) => [b.beneficiary_id, b]));
  const suppliers = suppliersOnFile(db).map((b) => ({ id: b.beneficiary_id, name: b.name, accountSha256: b.iban_sha256, last4: b.iban_last4, bic: more.get(b.beneficiary_id)?.bic ?? "", currency: more.get(b.beneficiary_id)?.currency ?? "" }));

  const blocked = blockedPayees(db);
  const floors = [...new Set([fundingCurrency(db), r.currency].filter(payableCurrency))];
  const pending = r.vendor ? db.prepare("SELECT add_id, status FROM payee_adds WHERE vendor = ? AND status <> 'APPLIED' ORDER BY created_at DESC").get(r.vendor) as { add_id: string; status: string } | undefined : undefined;

  return {
    invoice: { id: ctx.selfId ?? null, reading: r, text, ...(ctx.noText ? { noText: ctx.noText } : {}), receivedAt: self?.received_at ?? null, accountSha256 },
    company: { name: process.env.KIT11_COMPANY ?? COMPANY },
    policy: {
      // No invoice is paid without the CFO's Face ID (src/ap/pay.ts files every payment for approval): the agent has no limit to pay alone.
      aloneLimit: null,
      cashFloors: Object.fromEntries(floors.map((cur) => [cur, fromCents(floorCents(db, cur))])),
      payees: { allowed: [...new Set(suppliers.map((s) => s.name))].filter((name) => !blocked.includes(name)), blocked },
      currencies: SWIFT_CURRENCIES.filter(payableCurrency),
    },
    suppliers,
    history,
    // Already paid or on its way through the payment ledger, under the supplier's number for it (src/ap/ledgerKey.ts).
    alreadyInLedger: r.invoice_no ? handledInLedger(db, r.invoice_no, r.vendor, ctx.now, accountSha256) : null,
    supplierRequest: pending ? { id: pending.add_id, status: pending.status } : null,
    clearedTwins: ctx.selfId ? (db.prepare("SELECT twin_id FROM ap_duplicate_clearances WHERE invoice_id = ?").all(ctx.selfId) as { twin_id: string }[]).map((x) => x.twin_id) : [],
    expected: expectedFor(r.vendor),
    today: ctx.now.toISOString().slice(0, 10),
  };
}

export function evaluate(db: DB, r: ApReading, text: string, ctx: CheckContext): { status: ApStatus; findings: Finding[] } {
  const findings = codeFindings(invoiceCase(db, r, text, ctx));
  return { status: statusOf(findings), findings };
}

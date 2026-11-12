// The payables checks' pure part. An invoice case is plain data: the invoice as it was read and its document's text,
// the company's policy, the suppliers on file, the invoice history and today's date. Over that case this module holds
// the plain-code checks every invoice passes (codeFindings): the ONE implementation. src/ap/checks.ts keeps the
// database lookups, builds the case from the ledger and calls it. No database and no Node modules, so a Worker runs
// the very same checks on a case it builds itself. The pattern is src/policy/fraudCore.ts.

import { invoiceKey, sameInvoiceNo } from "../lib/invoiceKey.js";
import { fromCents, toCents } from "../lib/money.js";
import { accountKey, chooseRoute, payableCurrency, validateDetails, type BankDetails, type Route } from "../payouts/routes.js";
import { assessAgainst, skeleton, type Beneficiary, type FraudFinding } from "../policy/fraudCore.js";
import { ibanValid, totalAmbiguity, totalIsNegative, type ApReading } from "./reading.js";

// ── The case ──

/** An invoice's state in the inbox. */
export type ApStatus = "blocked" | "needs_review" | "needs_vendor" | "ready" | "waiting_cfo" | "paid" | "rejected";

/** One thing the checks found. block stops payment; review needs a person; wait is a new supplier; warn is shown. */
export interface Finding {
  code: string;
  level: "block" | "review" | "wait" | "warn";
  detail: string;
  /** A possible duplicate by the same supplier and total only: the earlier invoice it may copy (a person may clear it). */
  twin_of?: string;
  /** possible_fraud only: the signals that make it suspicious (a changed account, a lookalike name), each with its reason. */
  signals?: { code: string; detail: string }[];
}

/**
 * A supplier on file. Its account is known one of two ways: as the runner's ledger keeps it, the SHA-256 of its
 * account key (`accountSha256`) and its last four characters; or with its bank details in the clear (`bank`), where
 * the caller has them (a test world). An invoice's account is the supplier's only when code can show it is: by the
 * clear details, else by the two hashes; with neither to compare, it counts as another account.
 */
export interface SupplierOnFile {
  /** The ledger's id for this payee. */
  id: string;
  name: string;
  /** The last four characters of its account, as people are shown it. */
  last4: string;
  bic: string;
  /** The currency the account receives. */
  currency: string;
  accountSha256?: string;
  bank?: BankDetails;
}

/** An invoice the inbox already holds. */
export interface HistoryInvoice {
  id: string;
  vendor: string;
  invoiceNo: string;
  /** Two decimals, or "". */
  total: string;
  currency: string;
  /** YYYY-MM-DD, or "". */
  issueDate: string;
  /** When it came in (an ISO time); what "earlier" means. */
  receivedAt: string;
  state: ApStatus;
  /** The account it asked to be paid to, as accountOfReading gives it; null when it named none. */
  accountKey: string | null;
  /** It was itself blocked as a second copy: a refused copy is never what a later invoice is compared with. */
  blockedAsDuplicate: boolean;
  /** For a rejected one: the reason the person gave, when it is known. */
  rejectedWhy: string | null;
}

/** What a contract or a purchase order says the invoice should be. */
export interface ExpectedAmount { source: "contract" | "purchase_order"; currency: string; amount: string; reference?: string }

/** Everything a decision on one invoice needs, as plain data. */
export interface InvoiceCase {
  invoice: {
    /** Its id in the inbox, or null before it has one. An invoice checked again is not its own duplicate. */
    id: string | null;
    /** The fields read from the document (src/ap/reading.ts): by Claude when code's check of the reading passed, else by the parser. */
    reading: ApReading;
    /** The document's own text (for a scan: the transcription of its pages). Data, never instructions. */
    text: string;
    /** Set when the document had no text to read: why. Nothing else is checked then. */
    noText?: string;
    /** When the invoice itself came in, once the inbox holds it: only invoices received before it count as earlier. */
    receivedAt: string | null;
    /** The SHA-256 (hex) of payableAccount(reading), taken by the caller (src/agents/invoice.ts ibanSha): needed to compare with suppliers on file by hash. */
    accountSha256: string | null;
  };
  company: { name: string };
  policy: {
    /** The most the agent may pay without the CFO, and in which currency; null: nothing is paid without the CFO. */
    aloneLimit: { currency: string; amount: string } | null;
    /** The balance each currency may not go below ("EUR": "25000.00"). */
    cashFloors: Record<string, string>;
    /** The payees the CFO's policy allows and blocks, by name. Allowed are the suppliers on file it does not block. */
    payees: { allowed: string[]; blocked: string[] };
    /** The currencies the company pays in. */
    currencies: string[];
  };
  suppliers: SupplierOnFile[];
  history: HistoryInvoice[];
  /** What the payment ledger already holds for this invoice (paid, a payout on its way, a payment waiting), in code's words; null when nothing. */
  alreadyInLedger: string | null;
  /** The open request to add this invoice's supplier, if any. */
  supplierRequest: { id: string; status: string } | null;
  /** Earlier invoices a person said this one is no copy of (same supplier and total: monthly rent, a subscription). */
  clearedTwins: string[];
  expected: ExpectedAmount | null;
  /** YYYY-MM-DD. */
  today: string;
}

// ── Code's checks ──

/** An invoice this many times its supplier's usual (the median of its earlier ones) is flagged. */
export const UNUSUAL_FACTOR = 2;
/** Invoices from one supplier for the same total dated this close together are a possible duplicate under another number (past a month). */
export const TWIN_DAYS = 45;

const MONEY = /^\d+\.\d{2}$/;
const DAY_MS = 86_400_000;

/** An account key as it is compared: no spaces, upper case (the form its hash is taken of, src/agents/invoice.ts ibanSha). */
const sameForm = (key: string) => key.replace(/\s+/g, "").toUpperCase();

/** The invoice's account: its IBAN, or account number and routing code; the bank's country; the invoice's currency. */
export function bankFromReading(r: ApReading): BankDetails {
  const routing = r.routing_type === "aba" || r.routing_type === "sort_code" || r.routing_type === "cnaps" ? r.routing_type : "";
  return {
    country: r.bank_country || (r.iban ? r.iban.slice(0, 2) : r.bic.length >= 6 ? r.bic.slice(4, 6) : ""),
    currency: r.currency, accountName: r.vendor, iban: r.iban, accountNumber: r.account_number,
    routingType: routing, routingValue: r.routing_value, swiftCode: r.bic,
  };
}

function keyOf(bank: BankDetails): string | null {
  try {
    const key = accountKey(bank);
    return key ? sameForm(key) : null;
  } catch {
    return null;
  }
}

/** The account a reading asks to be paid to, as one identity per account (src/payouts/routes.ts accountKey), whether or not it checks out. */
export const accountOfReading = (r: ApReading): string | null => keyOf(bankFromReading(r));

interface BankCheck { details: BankDetails; ok: boolean; route: Route | null; findings: Finding[] }

/**
 * Where to pay: an IBAN, or an account number with its routing code or BIC, checked against the country's payout guide
 * before anything else looks at it (src/payouts/routes.ts).
 */
function checkBank(r: ApReading): BankCheck {
  const details = bankFromReading(r);
  const findings: Finding[] = [];
  let ok = false;
  let route: Route | null = null;
  if (!r.iban && !r.account_number) findings.push({ code: "no_bank_details", level: "review", detail: "the invoice gives no IBAN or account number to pay to; a person checks how this supplier is paid" });
  else if (r.iban && !ibanValid(r.iban)) findings.push({ code: "iban_invalid", level: "block", detail: `the IBAN ending ${r.iban.slice(-4)} fails its checksum: a typing error or a forged number; nothing is paid to it` });
  else if (r.currency) {
    const chosen = chooseRoute(details);
    if (!chosen.ok) {
      const code = payableCurrency(r.currency) ? "country_not_paid" : "currency_not_paid";
      findings.push({ code, level: "review", detail: `${chosen.reason}; a person pays this one by hand (it is still booked)` });
    } else {
      const wrong = validateDetails(details, chosen.route);
      if (wrong.length) findings.push({ code: "bank_details_invalid", level: "block", detail: `${wrong.join("; ")}: nothing is paid to these details` });
      else { ok = true; route = chosen.route; }
    }
  }
  return { details, ok, route, findings };
}

/** The account a reading asks to be paid to when its details route and check out; null when they do not. */
export function payableAccount(r: ApReading): string | null {
  const bank = checkBank(r);
  return bank.ok ? keyOf(bank.details) : null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** What assessAgainst is told a supplier's account is: this invoice's, or another. */
const THIS_ACCOUNT = "this invoice's account";

/**
 * The suppliers on file as the fraud check compares an account with them: by name and by account identity, not by BIC
 * (an IBAN names its account on its own). Whether a supplier's account is this invoice's is worked out here, from its
 * clear details or the two hashes, and handed to the check as a token.
 */
function comparedWith(c: InvoiceCase, key: string): Beneficiary[] {
  const mine = sameForm(key);
  const sha = c.invoice.accountSha256;
  return c.suppliers.map((s) => {
    const same = s.bank ? keyOf(s.bank) === mine : !!s.accountSha256 && !!sha && s.accountSha256.toLowerCase() === sha.toLowerCase();
    return { beneficiary_id: s.id, name: s.name, iban_last4: s.last4, iban_sha256: same ? THIS_ACCOUNT : `another account (${s.id})`, bic: "" };
  });
}

interface Examined {
  findings: Finding[];
  bank: BankCheck;
  /** The fraud check's answer, when there was a supplier name and an account that checks out to compare. */
  fraud: FraudFinding | null;
  /** The inbox's other invoices from the same supplier (its name, or the same account), any state, oldest first. */
  sameSupplier: HistoryInvoice[];
  /** Code's own phrases with a small number in them, as its findings write them ("45 days"). */
  phrases: string[];
}

/** The checks, with what they worked out on the way (the tools show it). */
function examine(c: InvoiceCase): Examined {
  const { reading: r, text } = c.invoice;
  const f: Finding[] = [];
  const phrases: string[] = [];
  const bank = checkBank(r);
  // The same supplier is the same name, or the same account under another name (red team round 3: a supplier added
  // again under a new name, the same invoice paid twice).
  const account = bank.ok ? keyOf(bank.details) : null;
  const sameParty = (x: HistoryInvoice) => skeleton(x.vendor) === skeleton(r.vendor) || (!!account && !!x.accountKey && sameForm(x.accountKey) === account);
  const others = c.history.filter((x) => x.id !== c.invoice.id)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sameSupplier = others.filter(sameParty);
  if (c.invoice.noText) return { findings: [{ code: "no_text", level: "review", detail: c.invoice.noText }], bank, fraud: null, sameSupplier, phrases };

  const missing = (["vendor", "invoice_no", "total", "currency"] as const).filter((k) => !r[k]);
  if (missing.length) f.push({ code: "missing_fields", level: "review", detail: `needs a person: the reading lacks ${missing.join(", ").replace(/_/g, " ")}` });
  if (r.total && !MONEY.test(r.total)) f.push({ code: "missing_fields", level: "review", detail: `needs a person: the total ${JSON.stringify(r.total)} is not a plain amount` });

  f.push(...bank.findings);

  if (MONEY.test(r.subtotal) && MONEY.test(r.tax) && MONEY.test(r.total) && toCents(r.subtotal) + toCents(r.tax) !== toCents(r.total)) {
    f.push({ code: "sum_mismatch", level: "block", detail: `the subtotal ${r.subtotal} plus tax ${r.tax} is ${fromCents(toCents(r.subtotal) + toCents(r.tax))}, not the total ${r.total}` });
  }

  // A total written as negative or in brackets is a credit, never paid as an invoice (red team E).
  if (totalIsNegative(text)) f.push({ code: "credit_note", level: "review", detail: "the total is written as negative, with CR or in brackets: a credit note; nothing is paid, a person sets it against this supplier's invoices" });

  // Total lines with different amounts (a deposit, an early-payment discount, a line item starting "Total"): code never
  // picks which one is due (red team round 2).
  const ambiguous = totalAmbiguity(text);
  if (ambiguous) {
    f.push({ code: "ambiguous_total", level: "review", detail: ambiguous });
    phrases.push(...(ambiguous.match(/\d+ different totals/) ?? []));
  }

  // The same invoice twice: in the inbox already (another file), or already paid or on its way through the ledger. Only
  // invoices received before this one count, and not copies that were themselves refused as a copy: a resent copy never
  // blocks its original (review, 8 November).
  if (r.invoice_no) {
    const key = invoiceKey(r.invoice_no);
    const self = c.invoice.id !== null ? c.invoice.receivedAt : null;
    const earlier = others
      .filter((x) => x.state !== "rejected")
      .filter((x) => !self || x.receivedAt < self || (x.receivedAt === self && x.id < c.invoice.id!))
      .filter((x) => !x.blockedAsDuplicate)
      .filter(sameParty);
    const same = earlier.find((x) => invoiceKey(x.invoiceNo) === key);
    const loose = same ? undefined : earlier.find((x) => sameInvoiceNo(x.invoiceNo, r.invoice_no));
    if (same) f.push({ code: "duplicate", level: "block", detail: `${same.id} is the same invoice ${same.invoiceNo} from ${same.vendor} (${same.state.replace(/_/g, " ")}); a second copy is never paid` });
    else if (loose) f.push({ code: "possible_duplicate", level: "review", detail: `${loose.id} is invoice ${loose.invoiceNo} from the same supplier, written differently; a person checks it is not the same invoice` });
    else if (c.alreadyInLedger) f.push({ code: "duplicate", level: "block", detail: `${c.alreadyInLedger}; a second copy is never paid` });
    // A copy of an invoice a person rejected goes back to a person, citing that rejection (red team round 4: resent with
    // one line more, it came back ready to pay as if never rejected).
    if (!same && !f.some((x) => x.code === "duplicate")) {
      const rejected = others
        .filter((x) => x.state === "rejected" && (!self || x.receivedAt <= self))
        .filter(sameParty)
        .find((x) => sameInvoiceNo(x.invoiceNo, r.invoice_no));
      if (rejected) {
        const why = rejected.rejectedWhy;
        f.push({ code: "rejected_before", level: "review", detail: `${rejected.id}, invoice ${rejected.invoiceNo} from ${rejected.vendor}, was rejected by a person${why ? ` (${why})` : ""}; a person decides whether this copy is any different` });
      }
    }
    // The same supplier, the same total, dated within TWIN_DAYS: possibly the same invoice under another number (red team
    // C; round 2 widened a week to 45 days, past a month). A monthly invoice for the same amount (rent, a subscription)
    // therefore waits for a person once: their clearance is kept per pair (clearPossibleDuplicate in src/ap/inbox.ts).
    if (!f.some((x) => x.code === "duplicate" || x.code === "possible_duplicate") && MONEY.test(r.total)) {
      const day = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
      const mine = day(r.issue_date || c.today);
      const cleared = new Set(c.clearedTwins);
      const twin = earlier.find((x) => !["blocked", "needs_review"].includes(x.state) && !cleared.has(x.id)
        && x.total === r.total && x.currency === r.currency && Math.abs(day(x.issueDate || x.receivedAt) - mine) <= TWIN_DAYS * DAY_MS);
      if (twin) {
        f.push({ code: "possible_duplicate", level: "review", twin_of: twin.id, detail: `${twin.id} from the same supplier has the same total ${r.currency} ${r.total} within ${TWIN_DAYS} days; a person checks it is not the same invoice under another number (once cleared, this pair is not asked again)` });
        phrases.push(`${TWIN_DAYS} days`);
      }
    }
  }

  // Who is paid: the invoice-fraud check against the suppliers on file (changed bank details, a lookalike name, another
  // account holder). A supplier that is simply new waits for a person's verification and the CFO's Face ID.
  let fraud: FraudFinding | null = null;
  if (r.vendor && bank.ok) {
    const key = accountKey(bank.details);
    fraud = assessAgainst(comparedWith(c, key), { vendor: r.vendor, iban: key, bic: "" }, text, THIS_ACCOUNT);
    const blocking = fraud.signals.filter((s) => s.blocks && s.code !== "unknown_vendor");
    if (fraud.suspicious) {
      f.push({ code: "possible_fraud", level: "block", detail: `possible invoice fraud: ${blocking.map((s) => s.detail).join("; ")}. Nothing is paid until a person checks with the supplier on a number already on file`,
        signals: blocking.map((s) => ({ code: s.code, detail: s.detail })) });
    } else if (fraud.signals.some((s) => s.code === "unknown_vendor")) {
      const pending = c.supplierRequest;
      f.push({ code: "new_supplier", level: "wait", detail: `${r.vendor} is not on file as a supplier yet: a person verifies its bank details with the supplier, then the CFO approves it with Face ID${pending ? ` (request ${pending.id}, ${pending.status.toLowerCase()})` : ""}` });
    }
    for (const s of fraud.signals.filter((x) => !x.blocks)) f.push({ code: s.code, level: "warn", detail: s.detail });
    const known = fraud.allowlisted && !fraud.suspicious ? fraud.allowlisted : null;
    if (known && c.policy.payees.blocked.includes(known.name)) f.push({ code: "payee_blocked", level: "block", detail: `${known.name} is blocked by the CFO policy` });
    // A known supplier's account receives one currency: an invoice in another is not paid to it (it would escalate at
    // planning anyway); a person checks which account and currency are right before it can be paid.
    const onFile = known ? c.suppliers.find((s) => s.id === known.beneficiary_id) : undefined;
    if (known && onFile?.currency && r.currency && onFile.currency !== r.currency) {
      f.push({ code: "account_currency", level: "review", detail: `${known.name}'s account on file receives ${onFile.currency}, but the invoice is in ${r.currency}: a person checks which account to pay` });
    }
  }

  if (r.currency && !payableCurrency(r.currency) && !f.some((x) => x.code === "currency_not_paid")) {
    f.push({ code: "currency_not_paid", level: "review", detail: `the invoice is in ${r.currency}; Purser pays only two-decimal currencies that SWIFT carries, so a person pays this one by hand (it is still booked)` });
  }

  if (MONEY.test(r.total) && r.vendor) {
    const before = others.filter((x) => x.state !== "blocked" && x.state !== "rejected")
      .filter((x) => skeleton(x.vendor) === skeleton(r.vendor) && x.currency === r.currency && MONEY.test(x.total)).map((x) => toCents(x.total));
    if (before.length >= 2) {
      const usual = median(before);
      if (usual > 0 && toCents(r.total) > UNUSUAL_FACTOR * usual) {
        f.push({ code: "unusual_amount", level: "warn", detail: `${r.currency} ${r.total} is more than ${UNUSUAL_FACTOR} times this supplier's usual ${r.currency} ${fromCents(usual)} (the median of ${before.length} earlier invoices)` });
        phrases.push(`${UNUSUAL_FACTOR} times`, `${before.length} earlier invoices`);
      }
    }
  }

  if (r.due_date && r.due_date < c.today) f.push({ code: "overdue", level: "warn", detail: `the due date ${r.due_date} has passed` });

  return { findings: f, bank, fraud, sameSupplier, phrases };
}

/**
 * The checks every invoice passes before it can be paid, each with a plain reason. Code decides here; a model's
 * reading only feeds it. Pure: the same case gives the same findings, in the same order.
 */
export function codeFindings(c: InvoiceCase): Finding[] {
  return examine(c).findings;
}

/** The fixed precedence: block, then review, then wait; else ready. Warnings are shown and change nothing. */
export function statusOf(f: Finding[]): ApStatus {
  const has = (level: Finding["level"]) => f.some((x) => x.level === level);
  return has("block") ? "blocked" : has("review") ? "needs_review" : has("wait") ? "needs_vendor" : "ready";
}

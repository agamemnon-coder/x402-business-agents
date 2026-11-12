// The payables checks' core (src/ap/checkerCore.ts): the plain-code checks over an invoice case. No database, no
// network and no model here: the case is plain data.
import { describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import {
  TWIN_DAYS, UNUSUAL_FACTOR, bankFromReading, codeFindings, payableAccount, statusOf,
  type Finding, type HistoryInvoice, type InvoiceCase, type SupplierOnFile,
} from "../src/ap/checkerCore.js";
import { parseApFallback, type ApReading } from "../src/ap/reading.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { UK, US } from "./fakes/fxInvoices.js";
import { importGraph } from "./support/importGraph.js";

const BERGTEX_IBAN = "DE89370400440532013000";
/** Bergtex as a test world keeps it: the bank details in the clear. */
const BERGTEX: SupplierOnFile = {
  id: "ben_bergtex", name: "Bergtex Textil GmbH", last4: "3000", bic: "COBADEFFXXX", currency: "EUR",
  bank: { country: "DE", currency: "EUR", accountName: "Bergtex Textil GmbH", iban: BERGTEX_IBAN, swiftCode: "COBADEFFXXX" },
};
/** Bergtex as the runner's ledger keeps it: only the hash of its account and its last four characters. */
const BERGTEX_HASHED: SupplierOnFile = { id: "ben_bergtex", name: "Bergtex Textil GmbH", last4: "3000", bic: "COBADEFFXXX", currency: "EUR", accountSha256: ibanSha(BERGTEX_IBAN) };

type Patch = Partial<Omit<InvoiceCase, "invoice" | "policy">> & { invoice?: Partial<InvoiceCase["invoice"]>; policy?: Partial<InvoiceCase["policy"]>; reading?: Partial<ApReading> };

/** A case from an invoice's text, read by the parser: Bergtex on file, an agent that may pay EUR 500.00 alone. */
function caseOf(text: string, p: Patch = {}): InvoiceCase {
  const { invoice, policy, reading, ...rest } = p;
  return {
    invoice: { id: null, reading: { ...parseApFallback(text), ...reading }, text, receivedAt: null, accountSha256: null, ...invoice },
    company: { name: "Northwind Outdoor (test)" },
    policy: { aloneLimit: { currency: "EUR", amount: "500.00" }, cashFloors: { EUR: "25000.00" }, payees: { allowed: ["Bergtex Textil GmbH"], blocked: [] }, currencies: ["EUR", "GBP", "USD"], ...policy },
    suppliers: [BERGTEX],
    history: [],
    alreadyInLedger: null,
    supplierRequest: null,
    clearedTwins: [],
    expected: null,
    today: "2026-11-08",
    ...rest,
  };
}

const earlier = (over: Partial<HistoryInvoice> = {}): HistoryInvoice => ({
  id: "AP-0001", vendor: "Bergtex Textil GmbH", invoiceNo: "BTX-2026-21", total: "1850.00", currency: "EUR", issueDate: "2026-11-02", receivedAt: "2026-11-03T09:00:00.000Z",
  state: "ready", accountKey: BERGTEX_IBAN, blockedAsDuplicate: false, rejectedWhy: null, ...over,
});
const codes = (c: InvoiceCase) => codeFindings(c).map((f) => f.code);
const finding = (c: InvoiceCase, code: string) => codeFindings(c).find((f) => f.code === code);
/** EN without its subtotal and tax lines, so its total can change without a sum mismatch. */
const EN_PLAIN = EN.replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\n", "");
const OTHER_IBAN = "DE02 1203 0000 0000 2020 51";
describe("code's checks over a case", () => {
  it("finds nothing in a known supplier's clean invoice, in a test world (bank details in the clear) and as the ledger keeps them (hashes)", () => {
    expect(codeFindings(caseOf(EN))).toEqual([]);
    expect(codeFindings(caseOf(EN, { suppliers: [BERGTEX_HASHED], invoice: { accountSha256: ibanSha(BERGTEX_IBAN) } }))).toEqual([]);
    expect(statusOf(codeFindings(caseOf(EN)))).toBe("ready");
  });

  it("no_text: a document with no text is only that, for a person", () => {
    const f = codeFindings(caseOf("", { invoice: { noText: "needs a person: there is no text in this PDF (a scan)" } }));
    expect(f).toEqual([{ code: "no_text", level: "review", detail: "needs a person: there is no text in this PDF (a scan)" }]);
  });

  it("missing_fields: a reading without a number, or with a total that is no plain amount", () => {
    expect(finding(caseOf(EN.replace("INVOICE BTX-2026-21\n", "").replace("Payment reference: BTX-2026-21", "")), "missing_fields")).toMatchObject({ level: "review", detail: "needs a person: the reading lacks invoice no" });
    expect(codeFindings(caseOf(EN, { reading: { total: "1,850" } })).filter((f) => f.code === "missing_fields").map((f) => f.detail)).toEqual(['needs a person: the total "1,850" is not a plain amount']);
  });

  it("no_bank_details, iban_invalid, bank_details_invalid: where to pay is checked before anything looks at who", () => {
    expect(finding(caseOf(EN.replace(/IBAN:.*\n/, "")), "no_bank_details")).toMatchObject({ level: "review" });
    expect(finding(caseOf(EN.replace("0130 00", "0130 01")), "iban_invalid")).toMatchObject({ level: "block", detail: "the IBAN ending 3001 fails its checksum: a typing error or a forged number; nothing is paid to it" });
    const badAba = caseOf(US.replace("021000021", "021000022"), { suppliers: [] });
    expect(finding(badAba, "bank_details_invalid")).toMatchObject({ level: "block", detail: "the ABA routing number 021000022 fails its checksum: nothing is paid to these details" });
    // Details that do not check out are never compared with a supplier: no fraud or new-supplier finding beside them.
    expect(codes(badAba)).toEqual(["bank_details_invalid"]);
  });

  it("country_not_paid and currency_not_paid: a person pays where Purser has no route", () => {
    expect(finding(caseOf(EN.replace("DE89 3704 0044 0532 0130 00", "FR14 2004 1010 0505 0001 3M02 606")), "country_not_paid")).toMatchObject({ level: "review" });
    const jpy = caseOf(DE.replace(/EUR/g, "JPY"), { suppliers: [] });
    expect(codes(jpy).filter((c) => c === "currency_not_paid")).toHaveLength(1);
    expect(statusOf(codeFindings(jpy))).toBe("needs_review");
    // Without bank details no route is looked up: the currency is still said, once.
    expect(codes(caseOf(DE.replace(/EUR/g, "JPY").replace(/IBAN:.*\n/, ""), { suppliers: [] }))).toEqual(["no_bank_details", "currency_not_paid"]);
  });

  it("sum_mismatch, credit_note, ambiguous_total: the document's own arithmetic", () => {
    expect(finding(caseOf(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00")), "sum_mismatch")).toMatchObject({ level: "block", detail: "the subtotal 1554.62 plus tax 295.00 is 1849.62, not the total 1850.00" });
    expect(finding(caseOf(EN_PLAIN.replace("Total due EUR 1,850.00", "Total due EUR -1,850.00")), "credit_note")).toMatchObject({ level: "review" });
    expect(finding(caseOf(`${EN_PLAIN}\nTotal EUR 2,000.00`), "ambiguous_total")).toMatchObject({ level: "review" });
  });

  it("duplicate: the same number from the same supplier, received earlier", () => {
    expect(finding(caseOf(EN, { history: [earlier()] }), "duplicate")).toMatchObject({ level: "block", detail: "AP-0001 is the same invoice BTX-2026-21 from Bergtex Textil GmbH (ready); a second copy is never paid" });
    // The same supplier is the same name, or the same account under another name.
    expect(codes(caseOf(EN, { history: [earlier({ vendor: "Bergtex Trading Ltd" })] }))).toContain("duplicate");
    expect(codes(caseOf(EN, { history: [earlier({ vendor: "Bergtex Trading Ltd", accountKey: "DE02120300000000202051" })] }))).not.toContain("duplicate");
  });

  it("duplicate: an invoice checked again is not its own copy, and a later copy never blocks its original", () => {
    const self = { id: "AP-0001", receivedAt: "2026-11-03T09:00:00.000Z" };
    expect(codeFindings(caseOf(EN, { invoice: self, history: [earlier()] }))).toEqual([]);
    expect(codeFindings(caseOf(EN, { invoice: self, history: [earlier(), earlier({ id: "AP-0002", receivedAt: "2026-11-04T09:00:00.000Z" })] }))).toEqual([]);
    // Received in the same instant: the lower id came first.
    expect(codes(caseOf(EN, { invoice: { id: "AP-0002", receivedAt: "2026-11-03T09:00:00.000Z" }, history: [earlier()] }))).toContain("duplicate");
  });

  it("duplicate: a copy that was itself refused as a copy, or rejected, is not what a new one is compared with", () => {
    expect(codes(caseOf(EN, { history: [earlier({ state: "blocked", blockedAsDuplicate: true })] }))).not.toContain("duplicate");
    const rejected = caseOf(EN, { history: [earlier({ state: "rejected", rejectedWhy: "rejected on the payables page: wrong order" })] });
    expect(codes(rejected)).not.toContain("duplicate");
    expect(finding(rejected, "rejected_before")).toMatchObject({ level: "review", detail: "AP-0001, invoice BTX-2026-21 from Bergtex Textil GmbH, was rejected by a person (rejected on the payables page: wrong order); a person decides whether this copy is any different" });
    expect(finding(caseOf(EN, { history: [earlier({ state: "rejected" })] }), "rejected_before")!.detail).toContain("was rejected by a person; a person decides");
  });

  it("duplicate: what the payment ledger already holds for the number", () => {
    expect(finding(caseOf(EN, { alreadyInLedger: "invoice BTX-2026-21 is already paid" }), "duplicate")).toMatchObject({ level: "block", detail: "invoice BTX-2026-21 is already paid; a second copy is never paid" });
    // An invoice on file with the same number is named first; the ledger is asked only when the inbox has none.
    expect(codeFindings(caseOf(EN, { history: [earlier()], alreadyInLedger: "invoice BTX-2026-21 is already paid" })).filter((f) => f.code === "duplicate")).toHaveLength(1);
  });

  it("possible_duplicate: the same number written differently, or the same total within the twin window", () => {
    const loose = finding(caseOf(EN, { history: [earlier({ invoiceNo: "BTX/2026/021" })] }), "possible_duplicate")!;
    expect(loose).toMatchObject({ level: "review" });
    expect(loose.twin_of).toBeUndefined();
    const twin = finding(caseOf(EN, { history: [earlier({ invoiceNo: "BTX-2026-17", issueDate: "2026-10-20" })] }), "possible_duplicate")!;
    expect(twin).toMatchObject({ level: "review", twin_of: "AP-0001" });
    expect(twin.detail).toContain(`the same total EUR 1850.00 within ${TWIN_DAYS} days`);
    const far = earlier({ invoiceNo: "BTX-2026-17", issueDate: "2026-09-01" });
    expect(codeFindings(caseOf(EN, { history: [far] }))).toEqual([]);
    // A person's clearance of the pair, and a twin that is itself blocked or waiting for a person, ask nothing.
    expect(codeFindings(caseOf(EN, { history: [earlier({ invoiceNo: "BTX-2026-17" })], clearedTwins: ["AP-0001"] }))).toEqual([]);
    expect(codeFindings(caseOf(EN, { history: [earlier({ invoiceNo: "BTX-2026-17", state: "needs_review" })] }))).toEqual([]);
    // Without its own date, the invoice is dated today.
    expect(codes(caseOf(EN.replace("Invoice date: 2 November 2026\n", ""), { history: [earlier({ invoiceNo: "BTX-2026-17", issueDate: "", receivedAt: "2026-10-01T09:00:00.000Z" })] }))).toContain("possible_duplicate");
  });

  it("possible_fraud: a known supplier's invoice that asks for another account, compared in the clear or by hash", () => {
    const changed = EN.replace("DE89 3704 0044 0532 0130 00", OTHER_IBAN);
    const f = finding(caseOf(changed), "possible_fraud")!;
    expect(f).toMatchObject({ level: "block", signals: [{ code: "bank_details_changed", detail: "the invoice asks for IBAN ...2051 (DE); on file: IBAN ...3000" }] });
    expect(f.detail).toBe("possible invoice fraud: the invoice asks for IBAN ...2051 (DE); on file: IBAN ...3000. Nothing is paid until a person checks with the supplier on a number already on file");
    expect(codes(caseOf(changed, { suppliers: [BERGTEX_HASHED], invoice: { accountSha256: ibanSha("DE02120300000000202051") } }))).toEqual(["possible_fraud"]);
    // A supplier on file by hash only, and no hash of the invoice's account: nothing to compare, so it is not the same.
    expect(codes(caseOf(EN, { suppliers: [BERGTEX_HASHED] }))).toEqual(["possible_fraud"]);
  });

  it("possible_fraud: a lookalike name, letters from another alphabet, another account holder", () => {
    expect(finding(caseOf(EN.replace("Bergtex Textil GmbH", "Bergtex Texitl GmbH")), "possible_fraud")!.signals!.map((s) => s.code)).toEqual(["lookalike_vendor"]);
    expect(finding(caseOf(EN.replace("Bergtex Textil GmbH", "Bеrgtex Textil GmbH")), "possible_fraud")!.signals!.map((s) => s.code)).toContain("mixed_scripts");
    expect(finding(caseOf(`${EN}\nAccount name: Someone Else Ltd`), "possible_fraud")!.signals!.map((s) => s.code)).toEqual(["account_name_mismatch"]);
  });

  it("new_supplier: a supplier not on file waits, with its open request", () => {
    const f = finding(caseOf(NL), "new_supplier")!;
    expect(f).toMatchObject({ level: "wait" });
    expect(f.detail).toBe("Zeeland Verpakkingen B.V. is not on file as a supplier yet: a person verifies its bank details with the supplier, then the CFO approves it with Face ID");
    expect(finding(caseOf(NL, { supplierRequest: { id: "PA-0001", status: "REQUESTED" } }), "new_supplier")!.detail).toMatch(/Face ID \(request PA-0001, requested\)$/);
    expect(statusOf(codeFindings(caseOf(NL)))).toBe("needs_vendor");
  });

  it("bank_change_language and pressure_language: shown, and change nothing on their own", () => {
    const c = caseOf(`${EN}\nPlease note our bank details have changed. Pay urgently.`);
    expect(codeFindings(c).map((f) => [f.code, f.level])).toEqual([["bank_change_language", "warn"], ["pressure_language", "warn"]]);
    expect(statusOf(codeFindings(c))).toBe("ready");
  });

  it("payee_blocked and account_currency: the CFO's policy and the account on file", () => {
    expect(finding(caseOf(EN, { policy: { payees: { allowed: [], blocked: ["Bergtex Textil GmbH"] } } }), "payee_blocked")).toMatchObject({ level: "block", detail: "Bergtex Textil GmbH is blocked by the CFO policy" });
    expect(finding(caseOf(EN, { suppliers: [{ ...BERGTEX, currency: "USD" }] }), "account_currency")).toMatchObject({ level: "review", detail: "Bergtex Textil GmbH's account on file receives USD, but the invoice is in EUR: a person checks which account to pay" });
  });

  it("unusual_amount and overdue: warnings", () => {
    const history = [earlier({ id: "AP-0001", invoiceNo: "BTX-1" }), earlier({ id: "AP-0002", invoiceNo: "BTX-2", state: "paid" })];
    const big = caseOf(EN_PLAIN.replace("1,850.00", "9,250.00"), { history, today: "2026-11-20" });
    expect(codeFindings(big)).toEqual([
      { code: "unusual_amount", level: "warn", detail: `EUR 9250.00 is more than ${UNUSUAL_FACTOR} times this supplier's usual EUR 1850.00 (the median of 2 earlier invoices)` },
      { code: "overdue", level: "warn", detail: "the due date 2026-11-16 has passed" },
    ]);
    // Blocked and rejected invoices are not what is usual; one earlier invoice is no pattern yet.
    expect(codes(caseOf(EN_PLAIN.replace("1,850.00", "9,250.00"), { history: [history[0]!, earlier({ id: "AP-0002", invoiceNo: "BTX-2", state: "rejected" })] }))).toEqual([]);
  });

  it("statusOf: block, then review, then wait; warnings change nothing", () => {
    const f = (level: Finding["level"]): Finding => ({ code: level, level, detail: level });
    expect(statusOf([f("warn"), f("wait"), f("review"), f("block")])).toBe("blocked");
    expect(statusOf([f("warn"), f("wait"), f("review")])).toBe("needs_review");
    expect(statusOf([f("warn"), f("wait")])).toBe("needs_vendor");
    expect(statusOf([f("warn")])).toBe("ready");
  });

  it("payableAccount: the account's key when the details route and check out, else null", () => {
    expect(payableAccount(parseApFallback(EN))).toBe(BERGTEX_IBAN);
    expect(payableAccount(parseApFallback(UK))).toBe("GB:601613:31926819");
    expect(payableAccount(parseApFallback(EN.replace("0130 00", "0130 01")))).toBeNull();
    expect(payableAccount(parseApFallback(EN.replace(/IBAN:.*\n/, "")))).toBeNull();
    expect(bankFromReading(parseApFallback(US))).toMatchObject({ country: "US", currency: "USD", accountNumber: "50001121", routingType: "aba", routingValue: "021000021" });
  });
});

describe("Worker-safe", () => {
  it("has no node: built-in and no native package anywhere in its module graph", () => {
    const g = importGraph("src/ap/checkerCore.ts");
    expect(g.files).toContain("src/ap/reading.ts");
    expect(g.files).toContain("src/policy/fraudCore.ts");
    expect(Object.keys(g.packages).filter((p) => p.startsWith("node:"))).toEqual([]);
    expect(Object.keys(g.packages)).not.toContain("better-sqlite3");
    // zod is the one package below it (the reading's schema); the database handle and the audit log are nowhere below it.
    expect(Object.keys(g.packages)).toEqual(["zod"]);
    for (const f of ["src/db/open.ts", "src/audit/log.ts", "src/ap/store.ts", "src/ap/bank.ts", "src/ap/checks.ts"]) expect(g.files).not.toContain(f);
  });

  it("the walk itself sees a node: import where there is one", () => {
    expect(Object.keys(importGraph("src/ap/checks.ts").packages)).toEqual(expect.arrayContaining(["better-sqlite3", "node:crypto"]));
  });
});

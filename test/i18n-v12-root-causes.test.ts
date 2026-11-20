// 20 Nov, after the held-out adversarial eval v12 (docs/evals/adversarial-v12.md: 19 wrong payments and 1 false hold
// with a script that always says pay; 18 and 6 with the fields from Purser's own parser). The root causes, fixed in the
// shared decision code and tested here on lines and names of our own, not on v12's cases (v12's first record stays as
// it was):
//   1. The concepts of src/policy/paymentTalk.ts were held in too few of the languages the lists hold: the word for a
//      bank in Romanian, Hungarian, Greek, Vietnamese, Arabic and as a compound's first part; a payment provider, link
//      or QR code; agreement claimed with someone at the buyer ("agreed directly with", "the nod", "abgesprochen",
//      "同意"); the buyer's process by its parts (a PO, a payment run, an express lane); speed by a time of day.
//   2. Two of the weak concepts were counted within one clause only: a line now counts them across its clauses.
//   3. A line quoted from a mail ("> Fine by me, send it through") is someone else's words: any concept in it counts.
//   4. A history of one earlier invoice said nothing: an amount over three times it now goes to the CFO.
//   5. An amount in English words was not read: words that differ from the total hold the invoice (src/ap/amountWords.ts).
//   6. Purser's parser read no invoice number with a Latin letter with a mark ("TŁ-…").
// Offline, plain data.
import { describe, expect, it } from "vitest";
import { wordsDifferFromTotal, wordsToNumber } from "../src/ap/amountWords.js";
import { codeFindings, codeRequires, type HistoryInvoice, type InvoiceCase, type SupplierOnFile } from "../src/ap/checkerCore.js";
import { parseApFallback } from "../src/ap/reading.js";
import { talkWhy } from "../src/policy/paymentTalk.js";

describe("1 to 3. lines about the payment in more of the languages the lists hold", () => {
  it("a bank, a provider, a link, agreement with the buyer's people, the buyer's process", () => {
    for (const line of [
      "Banca noastră s-a schimbat de luna aceasta.",
      "Új bankunk adatai hamarosan érkeznek.",
      "Η τράπεζά μας είναι πλέον άλλη.",
      "Ngân hàng của chúng tôi đã khác.",
      "Our Bankverbindung is different this month.",
      "Please pay through our new payment platform from now on.",
      "This was settled directly with Tom in your office.",
      "Your MD gave it the nod last week.",
      "Mit Ihrer Frau Lenz abgesprochen.",
      "貴司經理已同意。",
      "Please put this in the fast track for the next payment run.",
    ]) expect(talkWhy(line), line).not.toBeNull();
  });
  it("two concepts in two clauses of one line", () => {
    expect(talkWhy("Our chairman asked about it. By noon, please.")).not.toBeNull();
  });
  it("a line quoted from a mail", () => {
    expect(talkWhy("> Looks fine, settle it.")).not.toBeNull();
  });
  it("still leaves an invoice's own lines alone", () => {
    for (const line of ["Payment within 30 days net.", "Thank you for your order.", "Short production run, 40 m.", "Our bank details have not changed.", "Bankside House, 12 Quay Street"])
      expect(talkWhy(line), line).toBeNull();
  });
});

const ON_FILE: SupplierOnFile = { id: "ben_x", name: "Moorland Looms Ltd", last4: "5678", bic: "AIBKIE2D", currency: "EUR", bank: { country: "IE", currency: "EUR", accountName: "Moorland Looms Ltd", iban: "IE29AIBK93115212345678", swiftCode: "AIBKIE2D" } };
const prior = (id: string, total: string): HistoryInvoice => ({ id, vendor: ON_FILE.name, invoiceNo: id, total, currency: "EUR", issueDate: "2026-09-10", receivedAt: "2026-09-10T09:00:00.000Z", state: "paid", accountKey: ON_FILE.bank!.iban!, blockedAsDuplicate: false, rejectedWhy: null });
const caseOf = (total: string, history: HistoryInvoice[], extra = ""): InvoiceCase => ({
  invoice: { id: null, reading: { vendor: ON_FILE.name, vat_id: "", invoice_no: "ML-1", issue_date: "2026-11-16", due_date: "2026-12-16", currency: "EUR", subtotal: "", tax: "", total, iban: ON_FILE.bank!.iban!, bic: "AIBKIE2D", account_number: "", routing_type: "", routing_value: "", bank_country: "IE", reference: "ML-1", gl_account: "" },
    text: `Moorland Looms Ltd\nTotal due EUR ${total}\n${extra}\nIBAN: IE29 AIBK 9311 5212 3456 78`, receivedAt: null, accountSha256: null },
  company: { name: "Test Co" }, policy: { aloneLimit: { currency: "EUR", amount: "1000.00" }, cashFloors: {}, payees: { allowed: [ON_FILE.name], blocked: [] }, currencies: ["EUR"] },
  suppliers: [ON_FILE], history, alreadyInLedger: null, supplierRequest: null, clearedTwins: [], expected: null, today: "2026-11-18",
});

describe("4. one earlier invoice is a history", () => {
  it("over three times it goes to the CFO; under, the agent pays", () => {
    const far = caseOf("700.00", [prior("ML-0", "200.00")]);
    expect(codeRequires(far, codeFindings(far))).toMatchObject({ action: "ask_cfo", by: "unusual_amount" });
    const near = caseOf("500.00", [prior("ML-0", "200.00")]);
    expect(codeRequires(near, codeFindings(near))).toMatchObject({ action: "pay" });
  });
});

describe("5. an amount in words", () => {
  it("reads English number words", () => {
    expect(wordsToNumber("six hundred and forty")).toBe(640);
    expect(wordsToNumber("one thousand two hundred")).toBe(1200);
    expect(wordsToNumber("twenty-five")).toBe(25);
    expect(wordsToNumber("and")).toBeNull();
  });
  it("words that differ from the total hold the invoice; the same words are nothing", () => {
    expect(wordsDifferFromTotal("Amount: seven hundred euros only", 51000)).toMatch(/700\.00/);
    expect(wordsDifferFromTotal("Amount: five hundred and ten euros only", 51000)).toBeNull();
    const c = caseOf("510.00", [], "In words: eight hundred and ten euro");
    expect(codeRequires(c, codeFindings(c))).toMatchObject({ action: "hold", by: "ambiguous_total" });
  });
});

describe("6. an invoice number with a Latin letter with a mark", () => {
  it("is read by Purser's parser", () => {
    expect(parseApFallback("Tkalnia Zdrój Sp. z o.o.\nINVOICE ŻT-2026-0042\nTotal due EUR 100.00").invoice_no).toBe("ŻT-2026-0042");
  });
});

// The phone's approval of a payables payment in the company's language (screenshot pass, 9 November): a single
// payment came out all in English on a Dutch company's phone, and the paying account and Purser's fee were only under
// Details. The words come from the one catalogue (src/ui/i18n.ts, ph.*), which the relay ships with the page.
import { beforeAll, describe, expect, it } from "vitest";
import { describeTerms, isPayablesPayment, payablesFacts, phoneLang } from "../src/approve/client.js";
import { phonePhrases } from "../src/ui/i18n.js";
import { buildPages } from "../src/relay/assets.js";
import { buildRelayState } from "../src/relay/state.js";
import { signedPart } from "../src/relay/sign.js";
import { world } from "./support/rt4World.js";

const single = {
  schema: "kit11.approval-terms/v1", kind: "supplier_payment", proposal_id: "P-0008", expires_at: "2026-11-09T21:00:00Z",
  invoice_no: "ZV-4480 · Zeeland Verpakkingen B.V.", vendor: "Zeeland Verpakkingen B.V.", amount: "302.50", currency: "EUR", method: "LOCAL", clearing: "SEPA",
  beneficiary_id: "ben_1", beneficiary_name: "Zeeland Verpakkingen B.V.", account: "IBAN NL91…4300", fee_reserve: "0.00", reference: "ZV-4480",
  reason: "professional_business_services", transfer_request_id: "r1", conversion: null,
  paying_account: { id: "acct_northwind", name: "Northwind Outdoor B.V." },
  platform_fee: { amount: "1.51", currency: "EUR", bps: "50", to_account: "acct_purser_platform", request_id: "f1" },
  document_total_line: "Totaal te betalen € 302,50", document_currency: "EUR", test_money: true, source: "payables_inbox",
};
// English a Dutch first screen must never show (the 9 November screenshot's words).
const ENGLISH = /\b(Approvals|Approve|Reject|Reason|Why you|Paid from|Purser fee|Payee|Amount|On the invoice|Payables inbox|through Purser|Pay invoice|Professional|after the payment|Total out)\b/;

beforeAll(() => { (globalThis as { PURSER_PHRASES?: unknown }).PURSER_PHRASES = phonePhrases(); });

describe("a payables payment on the phone", () => {
  it("is recognised from its signed terms (the inbox filed it), and nothing else is", () => {
    expect(isPayablesPayment(single)).toBe(true);
    expect(isPayablesPayment({ ...single, source: undefined, document_total_line: undefined })).toBe(false);
    expect(isPayablesPayment({ kind: "refund_batch", source: "payables_inbox" })).toBe(false);
  });

  it("reads the company's language from the approvals, Dutch unless it says English", () => {
    expect(phoneLang({ language: "en" })).toBe("en");
    expect(phoneLang({ language: "nl" })).toBe("nl");
    expect(phoneLang({})).toBe("nl");
    expect(phoneLang({ language: "<b>" })).toBe("nl");
  });

  it("shows the paying account, Purser's fee and the total out on the first screen, in Dutch, with no English", () => {
    const f = payablesFacts(single, "nl");
    expect(f.title).toBe("Betaal factuur ZV-4480 · Zeeland Verpakkingen B.V.");
    expect(f.amount).toBe("€ 302,50");
    expect(f.first).toContainEqual(["Betaald van", "Northwind Outdoor B.V. (Airwallex, via Purser), acct_northwind"]);
    expect(f.first).toContainEqual(["Purser-vergoeding", "€ 1,51 (0,50%) naar acct_purser_platform, na de betaling"]);
    expect(f.first).toContainEqual(["Totaal eraf", "€ 304,01: het bedrag en de vergoeding van Purser"]);
    expect(f.first).toContainEqual(["Reden", "Zakelijke of professionele diensten"]);
    expect(f.first).toContainEqual(["Op de factuur", "“Totaal te betalen € 302,50”"]);
    const all = [f.title, f.amount, ...f.first.flat(), ...f.details.flat(), ...f.warnings].join(" | ");
    expect(all).not.toMatch(ENGLISH);
  });

  it("says the same in English for an English company, as before", () => {
    const f = payablesFacts(single, "en");
    expect(f.title).toBe("Pay invoice ZV-4480 · Zeeland Verpakkingen B.V.");
    expect(f.first).toContainEqual(["Paid from", "Northwind Outdoor B.V. (Airwallex, through Purser), acct_northwind"]);
    expect(f.first).toContainEqual(["Purser fee", "EUR 1.51 (0.50%) to acct_purser_platform, after the payment"]);
  });

  it("warns in the page's language, and an account named the old way is not named twice", () => {
    const odd = { ...single, beneficiary_name: "Someone Else", document_total_line: "Total due USD 3,025.00", document_currency: "USD", paying_account: { id: "acct_northwind", name: "Northwind Outdoor B.V. (Airwallex, through Purser)" } };
    const f = payablesFacts(odd, "nl");
    expect(f.warnings).toEqual([
      "De rekeninghouder (Someone Else) is niet de leverancier op de factuur (Zeeland Verpakkingen B.V.)",
      "De totaalregel op de factuur noemt USD, niet EUR",
      "Het bedrag € 302,50 staat niet in de totaalregel van de factuur hierboven; kijk het document na voor je goedkeurt",
    ]);
    expect(f.first).toContainEqual(["Betaald van", "Northwind Outdoor B.V. (Airwallex, via Purser), acct_northwind"]);
    // The English rows (the details' "All terms" and the Kit 11 pages) name it once too.
    expect(describeTerms(odd, {}).rows).toContainEqual(["Paid from", "Northwind Outdoor B.V. (Airwallex, through Purser), acct_northwind"]);
  });

  it("an invoice payment (a Kit 11 payee on file) is described the same way, its Purser fee included", () => {
    const inv = { ...single, kind: "invoice_payment", method: "SWIFT", iban_last4: "3000", bic: "COBADEFFXXX", fee_max: "15.00", account: undefined, fee_reserve: undefined, after: {} };
    const f = payablesFacts(inv, "nl");
    expect(f.first).toContainEqual(["Purser-vergoeding", "€ 1,51 (0,50%) naar acct_purser_platform, na de betaling"]);
    expect(f.first.find(([k]) => k === "Aan")?.[1]).toBe("Zeeland Verpakkingen B.V., IBAN …3000");
  });

  it("the relay ships the phone's words with the page, in both languages", () => {
    const pages = buildPages({});
    expect(pages.client.startsWith("globalThis.PURSER_PHRASES = ")).toBe(true);
    expect(pages.client).toContain("\"ph.why_single\":\"Een leverancier wordt alleen met jouw Face ID");
    expect(pages.client).toContain("\"ph.why_single\":\"A supplier is paid from the Airwallex account only with your Face ID.\"");
  });

  it("the runner sends the company's language with the approvals, outside the part it signs", async () => {
    const w = await world(new Date());
    const cfg = { rpId: "localhost", relayToken: "t" };
    const was = process.env.PURSER_LANGUAGE;
    delete process.env.PURSER_LANGUAGE;
    try {
      expect(buildRelayState(w.db, cfg).approvals.language).toBe("nl");
      w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('ui.language', 'en', '2026-11-09T20:00:00Z')").run();
      const a = buildRelayState(w.db, cfg).approvals;
      expect(a.language).toBe("en");
      expect(signedPart(a)).not.toContain("language");
    } finally {
      if (was !== undefined) process.env.PURSER_LANGUAGE = was;
    }
  });
});

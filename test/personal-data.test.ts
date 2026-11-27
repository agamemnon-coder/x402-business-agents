// A payer's reference on its way to Purser Cloud (GDPR Art. 5(1)(c)): src/receivables/ar.ts referenceForCloud takes
// out every name the runner knows, every IBAN and every e-mail address, and the cloud's schema (cloud/src/moneyLoop.ts)
// refuses a snapshot that still holds an account or an address. Round 2 of the v1.5.3 red team found what got past both:
// a name with a letter outside ASCII ("Ångström Ölçer BV", "Émile Ørsted"), an IBAN written with dashes, dots, a space
// after the country code or in groups of three, and an e-mail address written "jan @ example.com" or "jan(at)example.com".
// The audit log's masking (accountsMaskedJson) reads accounts the same way. A hash, an id or a VAT number is no account.
// Test money only; every person here is made up.
import { describe, expect, it } from "vitest";
import { MoneyLoopSnapshot } from "../cloud/src/moneyLoop.js";
import { openDb } from "../src/db/open.js";
import { accountsMasked, accountsMaskedJson, holdsAccountOrAddress, withoutAccountsOrAddresses, withoutNames } from "../src/lib/personalData.js";
import { issueInvoice, matchPayment } from "../src/receivables/ar.js";
import { moneyLoopSnapshot } from "../src/treasury/cloudSnapshot.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const IBAN_FORMS = ["NL91-ABNA-0417-1643-00", "NL 91 ABNA 0417 1643 00", "NL91ABNA 041 716 4300", "NL91.ABNA.0417.1643.00", "NL91/ABNA/0417/1643/00", "NL91_ABNA_0417_1643_00", "NL91 ABNA  0417 1643 00"];
const EMAIL_FORMS = ["jan.devries @ example.com", "jan.devries@ example.com", "jan.devries(at)example.com", "jan.devries (at) example.com", "jan.devries[at]example.com", "jan.devries [AT] example.com"];
const LEAK = /Zoë|Müller|Ångström|Ölçer|Émile|Ørsted|ABNA|0417|1643|devries/i;

describe("a payer's reference as it reaches Purser Cloud", () => {
  it("holds no name, account or e-mail address, however written, and the cloud's schema takes what is left", async () => {
    const db = openDb(":memory:");
    await issueInvoice(db, { invoice_no: "NW-10", customer: "Ångström Ölçer BV", currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-11-20", due_date: "2026-12-04" }, null, NOW);
    await issueInvoice(db, { invoice_no: "NW-11", customer: "Zoë Müller", currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-11-20", due_date: "2026-12-04" }, null, NOW);
    const cases: [string, string | null][] = [
      ["payment from Zoë Müller", "Zoë Müller"], ["Ångström Ölçer BV invoice", null], ["from Émile Ørsted", "Émile Ørsted"], ["ÅNGSTRÖM ÖLÇER BV order 7", null],
      ...IBAN_FORMS.map((f): [string, string] => [`iban ${f}`, "X"]), ...EMAIL_FORMS.map((f): [string, string] => [`mail ${f}`, "X"]), ["paid by Will", "Will"],
    ];
    cases.forEach(([reference, payer], i) => matchPayment(db, { payment_id: `dep-${i}`, currency: "EUR", amount_cents: 777 + i, reference, payer, received_at: NOW.toISOString() }, NOW));
    const snap = moneyLoopSnapshot(db, NOW);
    expect(MoneyLoopSnapshot.safeParse(snap).success).toBe(true);
    const byId = new Map(snap.receivables.review.map((r) => [r.payment_id, r.reference]));
    const refs = cases.map((_, i) => byId.get(`dep-${i}`)!);
    for (const r of refs) expect(r, r).not.toMatch(LEAK);
    // What is left still helps a person find the payment.
    expect(refs.slice(0, 4)).toEqual(["payment from [name]", "[name] invoice", "from [name]", "[name] order 7"]);
    expect(refs.slice(4, 4 + IBAN_FORMS.length)).toEqual(IBAN_FORMS.map(() => "iban [account]"));
    expect(refs.slice(4 + IBAN_FORMS.length)).toEqual([...EMAIL_FORMS.map(() => "mail [e-mail]"), "paid by [name]"]);
  });

  it("is refused by the cloud's schema while it still holds such an account or address", () => {
    const db = openDb(":memory:");
    matchPayment(db, { payment_id: "dep-1", currency: "EUR", amount_cents: 100, reference: "order 12", payer: null, received_at: NOW.toISOString() }, NOW);
    const snap = moneyLoopSnapshot(db, NOW);
    expect(MoneyLoopSnapshot.safeParse(snap).success).toBe(true);
    for (const f of [...IBAN_FORMS, ...EMAIL_FORMS]) {
      const bad = { ...snap, receivables: { ...snap.receivables, review: snap.receivables.review.map((r) => ({ ...r, reference: `ref ${f} thanks` })) } };
      expect(MoneyLoopSnapshot.safeParse(bad).success, f).toBe(false);
    }
  });
});

describe("the shapes of personal data (src/lib/personalData.ts)", () => {
  it("finds a name next to letters outside ASCII, whole word only, its regex characters as written", () => {
    expect(withoutNames("from Émile Ørsted, thanks", ["Émile Ørsted"])).toBe("from [name], thanks");
    expect(withoutNames("ÉMILE paid", ["émile"])).toBe("[name] paid");
    expect(withoutNames("Émilee paid", ["Émile"])).toBe("Émilee paid");
    expect(withoutNames("paid by A.B. (Jr.) today", ["A.B. (Jr.)"])).toBe("paid by [name] today");
    // A name in another Unicode normal form is the same name.
    expect(withoutNames("from Émile", ["Émile"])).toBe("from [name]");
  });

  it("takes out an IBAN written with spaces, dashes, dots, slashes or underscores, and the separators with it", () => {
    for (const f of IBAN_FORMS) {
      expect(holdsAccountOrAddress(`pay ${f} today`), f).toBe(true);
      expect(withoutAccountsOrAddresses(`pay ${f} today`), f).toBe("pay [account] today");
      expect(accountsMasked(`pay ${f} today`), f).toBe("pay …4300 today");
    }
    expect(accountsMaskedJson({ note: "to DE89.3704.0044.0532.0130.00 please", deep: ["GB29-NWBK-6016-1331-9268-19"] })).toEqual({ note: "to …3000 please", deep: ["…6819"] });
  });

  it("takes out an e-mail address written with spaces round the @, or (at) or [at]", () => {
    for (const f of EMAIL_FORMS) {
      expect(holdsAccountOrAddress(`mail ${f} please`), f).toBe(true);
      expect(withoutAccountsOrAddresses(`mail ${f} please`), f).toBe("mail [e-mail] please");
    }
  });

  it("leaves what is not an account or an address: invoice numbers, a hash, an id, a VAT number, a date", () => {
    const sha = "be12" + "a".repeat(60);
    for (const s of ["NW-2026-501", "BTX-2026-21 part", "order 12", "NL123456789B01", "VAT NL123456789B01 for NW-11", sha, "be1234567890cafe", "req_011CVa1b2c3d4e5f6a7b8c9d0e", "2026-11-27", "DE 2026-11 invoice"]) {
      expect(accountsMasked(s), s).toBe(s);
    }
    for (const s of ["NW-2026-501", "BTX-2026-21 part", "order 12", "NL123456789B01", "VAT NL123456789B01 for NW-11", sha, "req_011CVa1b2c3d4e5f6a7b8c9d0e", "2026-11-27"]) {
      expect(holdsAccountOrAddress(s), s).toBe(false);
      expect(withoutAccountsOrAddresses(s), s).toBe(s);
    }
  });
});

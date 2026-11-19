// Tests written from the mutation run (docs/evidence/mutation-testing.md, `npm run mutation`), group "payee": each one
// fails on a mutant of the payee checks that survived the existing tests, and passes on the code as it is. Changed bank
// details (src/policy/fraudCore.ts: only the IBAN, or only the BIC), lookalike names at the edges of their thresholds,
// the account holder line, and duplicate invoice numbers (src/lib/invoiceKey.ts). Offline, no database.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountWords, assessAgainst, editDistance, skeleton, type Beneficiary } from "../src/policy/fraudCore.js";
import { invoiceKey, invoiceKeyLoose, ledgerParts, sameInvoiceNo, sameLedgerInvoice } from "../src/lib/invoiceKey.js";

const hex = (s: string) => createHash("sha256").update(s).digest("hex");
const IBAN = "DE89370400440532013000";
const BIC = "COBADEFFXXX";
const LIZ = "Bergtex Textil GmbH";
const onFile = (name: string, o: Partial<Beneficiary> = {}): Beneficiary => ({ beneficiary_id: "b-1", name, iban_last4: "3000", iban_sha256: hex(IBAN), bic: BIC, ...o });
const assess = (vendor: string, o: { all?: Beneficiary[]; iban?: string; bic?: string; text?: string } = {}) => {
  const iban = o.iban ?? IBAN;
  return assessAgainst(o.all ?? [onFile(LIZ)], { vendor, iban, bic: o.bic ?? BIC }, o.text ?? "", hex(iban.replace(/\s+/g, "").toUpperCase()));
};
const codes = (f: ReturnType<typeof assess>) => f.signals.map((s) => s.code);
const signal = (f: ReturnType<typeof assess>, code: string) => f.signals.find((s) => s.code === code);

describe("changed bank details (src/policy/fraudCore.ts)", () => {
  it("the supplier's own name, IBAN and BIC raise nothing", () => {
    const f = assess(LIZ);
    expect(f.signals).toEqual([]);
    expect(f.blocked).toBe(false);
    expect(f.allowlisted?.name).toBe(LIZ);
  });

  it("only the IBAN changed blocks, and says what is asked and what is on file", () => {
    const f = assess(LIZ, { iban: "DE89 3704 0044 0532 0130 99" });
    const asked = "IBAN ...3099 (DE) and BIC COBADEFFXXX";
    const was = "IBAN ...3000 (DE) and BIC COBADEFFXXX";
    expect(f.signals).toEqual([{ code: "bank_details_changed", blocks: true, detail: `the invoice asks for ${asked}; on file: ${was}`, asked, on_file: was }]);
    expect(f.blocked).toBe(true);
    expect(f.suspicious).toBe(true);
  });

  it("only the BIC changed blocks too", () => {
    const f = assess(LIZ, { bic: "PBNKDEFFXXX" });
    expect(codes(f)).toEqual(["bank_details_changed"]);
    expect(signal(f, "bank_details_changed")?.asked).toBe("IBAN ...3000 (DE) and BIC PBNKDEFFXXX");
  });

  it("an account in words: trimmed, leaving out what is not known", () => {
    expect(accountWords(" 3000 ", " DE ", " COBADEFFXXX ")).toBe("IBAN ...3000 (DE) and BIC COBADEFFXXX");
    expect(accountWords("3000", "", "")).toBe("IBAN ...3000");
    expect(accountWords("", "DE", "")).toBe("an account with no IBAN");
    expect(accountWords(undefined as unknown as string, undefined as unknown as string, undefined as unknown as string)).toBe("an account with no IBAN");
  });
});

describe("lookalike names (src/policy/fraudCore.ts)", () => {
  it("a name is what a reader sees: accents and case gone", () => {
    expect(skeleton("Bérgtex Téxtil")).toBe("bergtextextil");
  });

  it("edit distance: inserts, deletes, changes and a swap of neighbours, each one edit", () => {
    const cases: [string, string, number][] = [
      ["abc", "", 3], ["", "ab", 2], ["kitten", "sitting", 3], ["ab", "ba", 1], ["abc", "acb", 1], ["ca", "abc", 3],
      ["abcd", "badc", 2], ["xaby", "xbay", 1], ["abcdef", "bacdfe", 2], ["ab", "b", 1], ["ba", "a", 1], ["a", "ab", 1],
    ];
    for (const [a, b, d] of cases) expect(editDistance(a, b), `${a} / ${b}`).toBe(d);
  });

  it("two edits make a lookalike of a name of eight letters or more, one below; three never", () => {
    const two = assess("Bergtex Textl GmbX");
    expect(signal(two, "lookalike_vendor")?.detail).toBe(`"Bergtex Textl GmbX" is not the allowlisted "${LIZ}" but looks like it (2 letters differ)`);
    expect(codes(assess("Bergtx Textl GmbX"))).toContain("unknown_vendor");
    // Exactly eight letters: two edits still count.
    expect(codes(assess("Alpanhuf", { all: [onFile("Alpenhof")] }))).toContain("lookalike_vendor");
    // Seven letters on file: one edit only, even when the invoice's name is longer.
    expect(codes(assess("Nordlix", { all: [onFile("Nordlys")] }))).toContain("unknown_vendor");
    expect(codes(assess("Nordlyxx", { all: [onFile("Nordlys")] }))).toContain("unknown_vendor");
    expect(codes(assess("Nordlyx", { all: [onFile("Nordlys")] }))).toContain("lookalike_vendor");
  });

  it("a name on file of four letters can have a lookalike; one of three cannot", () => {
    expect(signal(assess("Acne", { all: [onFile("Acme")] }), "lookalike_vendor")?.detail).toBe('"Acne" is not the allowlisted "Acme" but looks like it (1 letter differs)');
    expect(codes(assess("Abd", { all: [onFile("Abc")] }))).toEqual(["unknown_vendor"]);
  });

  it("the same name written differently in Latin letters is that supplier", () => {
    const f = assess("BERGTEX-TEXTIL GMBH");
    expect(f.signals).toEqual([]);
    expect(f.allowlisted?.name).toBe(LIZ);
  });

  it("a supplier on file under a name in another alphabet is matched by that exact name, flagged only for its script", () => {
    const f = assess("Ωmega Ltd", { all: [onFile("Ωmega Ltd")] });
    expect(codes(f)).toEqual(["mixed_scripts"]);
    expect(f.allowlisted?.name).toBe("Ωmega Ltd");
  });

  it("letters from another alphabet block, with the name in the detail", () => {
    const name = "Bеrgtеx Tеxtil GmbH";
    expect(signal(assess(name), "mixed_scripts")).toEqual({ code: "mixed_scripts", blocks: true, detail: `the vendor name "${name}" contains letters from a non-Latin alphabet` });
  });
});

describe("the invoice's text (src/policy/fraudCore.ts)", () => {
  it("the account holder line, however it is spaced, against the supplier", () => {
    const f = assess(LIZ, { text: "Account name:J. Smith Consulting   \n" });
    expect(signal(f, "account_name_mismatch")).toEqual({
      code: "account_name_mismatch", blocks: true, detail: `the account holder on the invoice is "J. Smith Consulting", not ${LIZ}`, asked: "J. Smith Consulting", on_file: LIZ,
    });
    expect(assess(LIZ, { text: `Account name:   ${LIZ}   ` }).signals).toEqual([]);
    // Only a line that starts with it is the account holder line.
    expect(assess(LIZ, { text: "Our old Account name: J. Smith" }).signals).toEqual([]);
  });

  it("a change of bank and a push for speed are quoted, each line trimmed", () => {
    const f = assess(LIZ, { text: "Please update your records.   \n   Pay today   \n" });
    expect(f.signals).toEqual([
      { code: "bank_change_language", blocks: false, detail: 'the invoice announces a change of bank: "Please update your records."' },
      { code: "pressure_language", blocks: false, detail: 'the invoice pushes for speed: "Pay today"' },
    ]);
    expect(f.blocked).toBe(false);
  });
});

describe("duplicate invoice numbers (src/lib/invoiceKey.ts)", () => {
  it("invisible format characters are not part of a number", () => {
    expect(invoiceKey("BTX​-2026-21")).toBe("BTX-2026-21");
    expect(invoiceKey("BTX-20­26-21")).toBe("BTX-2026-21");
  });

  it("the same number however written: leading zeros, I for 1, accents; a zero inside a number stays", () => {
    expect(sameInvoiceNo("BTX-2026-0021", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("BTX-2026-2I", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("ÉTX-2026-21", "ETX-2026-21")).toBe(true);
    expect(sameInvoiceNo("INV-2050", "INV-250")).toBe(false);
    expect(invoiceKeyLoose("—")).toBe("");
  });

  it("a ledger number splits into the supplier's number and the supplier", () => {
    expect(ledgerParts("BTX-21 · Bergtex Textil GmbH")).toEqual({ no: "BTX-21", vendor: "Bergtex Textil GmbH" });
    expect(ledgerParts("BTX-21")).toEqual({ no: "BTX-21", vendor: null });
    expect(ledgerParts("BTX-21 ·  ")).toEqual({ no: "BTX-21", vendor: null });
    expect(ledgerParts(" · Bergtex")).toEqual({ no: "", vendor: "Bergtex" });
  });

  it("the same invoice: the same number from the same supplier, by name or by account; an unknown supplier matches any", () => {
    expect(sameLedgerInvoice("BTX-21 · Bergtex Textil GmbH", {}, "BTX-21", { vendor: "BERGTEX TEXTIL GMBH" })).toBe(true);
    expect(sameLedgerInvoice("BTX-21", { vendor: LIZ }, "BTX-21", { vendor: "Alpine Packaging" })).toBe(false);
    expect(sameLedgerInvoice("BTX-21", { vendor: "A Corp", accountSha256: "x" }, "BTX-21", { vendor: "B Corp", accountSha256: "x" })).toBe(true);
    expect(sameLedgerInvoice("BTX-21", { vendor: "A Corp", accountSha256: "x" }, "BTX-21", { vendor: "B Corp", accountSha256: "y" })).toBe(false);
    expect(sameLedgerInvoice("BTX-21", { vendor: "A Corp" }, "BTX-21", { vendor: "B Corp" })).toBe(false);
    expect(sameLedgerInvoice("BTX-21", {}, "BTX-21", { vendor: "B Corp" })).toBe(true);
    expect(sameLedgerInvoice("BTX-21", { vendor: "A Corp" }, "BTX-22", { vendor: "A Corp" })).toBe(false);
  });
});

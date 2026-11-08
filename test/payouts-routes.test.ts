// Payables FX payouts: the route table and the bank-detail checks code makes before anything reaches Airwallex. Each
// country's rules come from its Airwallex payout network guide (cited in src/payouts/routes.ts).
import { describe, expect, it } from "vitest";
import { abaValid, accountKey, chooseRoute, maskAccount, payableCurrency, validateDetails, type BankDetails } from "../src/payouts/routes.js";

const US_LOCAL: BankDetails = { country: "US", currency: "USD", accountName: "Pinecrest Outdoor Supply LLC", accountNumber: "50001121", routingType: "aba", routingValue: "021000021" };
const UK_LOCAL: BankDetails = { country: "GB", currency: "GBP", accountName: "Harbour Rope Ltd", accountNumber: "31926819", routingType: "sort_code", routingValue: "601613" };
const CN_SWIFT: BankDetails = { country: "CN", currency: "CNY", accountName: "Ningbo Textile Co Ltd", accountNumber: "6222021001115222", swiftCode: "ICBKCNBJNBO" };
const TR_IBAN: BankDetails = { country: "TR", currency: "TRY", accountName: "Bursa Tekstil AS", iban: "TR330006100519786457841326" };
const NL_IBAN: BankDetails = { country: "NL", currency: "EUR", accountName: "Zeeland Verpakkingen BV", iban: "NL91ABNA0417164300" };

describe("routes from Airwallex's payout network guides", () => {
  it("pays locally where the guide offers it: ACH for USD in the US, Faster Payments for GBP, FAST/EFT for TRY, SEPA for EUR", () => {
    expect(chooseRoute(US_LOCAL)).toMatchObject({ ok: true, route: { method: "LOCAL", clearing: "ACH" } });
    expect(chooseRoute(UK_LOCAL)).toMatchObject({ ok: true, route: { method: "LOCAL", clearing: "FASTER_PAYMENTS" } });
    expect(chooseRoute(TR_IBAN)).toMatchObject({ ok: true, route: { method: "LOCAL" } });
    expect(chooseRoute(NL_IBAN)).toMatchObject({ ok: true, route: { method: "LOCAL" } });
  });

  it("pays China by SWIFT only: LOCAL CNY needs declarant information Purser does not collect", () => {
    expect(chooseRoute(CN_SWIFT)).toMatchObject({ ok: true, route: { method: "SWIFT" } });
    expect(chooseRoute({ ...CN_SWIFT, currency: "USD" })).toMatchObject({ ok: true, route: { method: "SWIFT" } });
  });

  it("falls back to SWIFT for a currency the country has no local rail for (USD to a Turkish IBAN)", () => {
    expect(chooseRoute({ ...TR_IBAN, currency: "USD" })).toMatchObject({ ok: true, route: { method: "SWIFT" } });
  });

  it("refuses a country it has no guide for, and a currency SWIFT does not carry", () => {
    expect(chooseRoute({ ...NL_IBAN, country: "BR", iban: "" , accountNumber: "123456" })).toMatchObject({ ok: false });
    expect((chooseRoute({ ...NL_IBAN, currency: "BRL" }) as { ok: false; reason: string }).reason).toMatch(/BRL/);
  });

  it("pays only currencies with two decimals (Purser counts in cents)", () => {
    expect(payableCurrency("USD")).toBe(true);
    expect(payableCurrency("TRY")).toBe(true);
    expect(payableCurrency("JPY")).toBe(false);
    expect(payableCurrency("XYZ")).toBe(false);
  });
});

describe("bank details are checked in code before anything is sent", () => {
  it("accepts the documented shapes", () => {
    for (const d of [US_LOCAL, UK_LOCAL, CN_SWIFT, TR_IBAN, NL_IBAN]) {
      const r = chooseRoute(d);
      if (!r.ok) throw new Error(r.reason);
      expect(validateDetails(d, r.route), d.country).toEqual([]);
    }
  });

  it("checks an ABA routing number's checksum", () => {
    expect(abaValid("021000021")).toBe(true);
    expect(abaValid("021000022")).toBe(false);
    const r = chooseRoute(US_LOCAL);
    if (!r.ok) throw new Error(r.reason);
    expect(validateDetails({ ...US_LOCAL, routingValue: "021000022" }, r.route).join(" ")).toMatch(/ABA/);
  });

  it("refuses a bad account number, a sort code of the wrong length, an IBAN of another country, a bad IBAN and a BIC of another country", () => {
    const uk = chooseRoute(UK_LOCAL);
    if (!uk.ok) throw new Error(uk.reason);
    expect(validateDetails({ ...UK_LOCAL, accountNumber: "3192681" }, uk.route).join(" ")).toMatch(/account number/);
    expect(validateDetails({ ...UK_LOCAL, routingValue: "60161" }, uk.route).join(" ")).toMatch(/sort code/);
    const tr = chooseRoute(TR_IBAN);
    if (!tr.ok) throw new Error(tr.reason);
    expect(validateDetails({ ...TR_IBAN, iban: "NL91ABNA0417164300" }, tr.route).join(" ")).toMatch(/TR/);
    expect(validateDetails({ ...TR_IBAN, iban: "TR330006100519786457841327" }, tr.route).join(" ")).toMatch(/checksum/);
    const cn = chooseRoute(CN_SWIFT);
    if (!cn.ok) throw new Error(cn.reason);
    expect(validateDetails({ ...CN_SWIFT, swiftCode: "DEUTDEFF" }, cn.route).join(" ")).toMatch(/BIC/);
    expect(validateDetails({ ...CN_SWIFT, accountName: "X" }, cn.route).join(" ")).toMatch(/name/);
  });

  it("gives one account identity per account (the IBAN where there is one) and masks it for the CFO", () => {
    expect(accountKey(NL_IBAN)).toBe("NL91ABNA0417164300");
    expect(accountKey(US_LOCAL)).toBe("US:aba:021000021:50001121");
    expect(accountKey(CN_SWIFT)).toBe("CN:swift:ICBKCNBJ:6222021001115222");
    expect(maskAccount(US_LOCAL)).toBe("account …1121, ABA 021000021 (US)");
    expect(maskAccount(TR_IBAN)).toBe("IBAN TR33…1326");
    expect(maskAccount(UK_LOCAL)).toBe("account …6819, sort code 60-16-13 (GB)");
  });
});

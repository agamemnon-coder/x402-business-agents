// An ERP connector's settings from the environment (src/erp/registry.ts, src/erp/exact.ts, src/erp/rest.ts): a map
// setting that is missing or not a JSON object of strings is a config error naming the setting, never its value; the
// defaults are the documented ones; Exact needs its division as a number and a VAT code for every Purser code; Odoo's
// journal and tax ids must be numbers; a pull may run before the tax rates it lists are filled in.
import { describe, expect, it } from "vitest";
import { exactConfigFromEnv } from "../src/erp/exact.js";
import { bcConfigFromEnv, missingSettings, odooConfigFromEnv } from "../src/erp/registry.js";
import { jsonMap } from "../src/erp/rest.js";

const VAT = JSON.stringify({ NL21: "1", NL9: "2", NL0: "3", EU_RC: "4", NONEU_RC: "5", EXEMPT: "6", NONE: "7" });

describe("ERP settings from the environment", () => {
  it("a map setting: missing (unless optional), not JSON, an array or nested values are config errors that name it", () => {
    expect(() => jsonMap({}, "ERP_X_MAP")).toThrow("ERP_X_MAP is not set");
    expect(jsonMap({}, "ERP_X_MAP", true)).toEqual({});
    for (const raw of ["{oops", "[1,2]", JSON.stringify({ a: { b: 1 } }), "null"]) expect(() => jsonMap({ ERP_X_MAP: raw }, "ERP_X_MAP")).toThrow(`ERP_X_MAP must be a JSON object of strings, like {"NL21":"2"}`);
    expect(jsonMap({ ERP_X_MAP: JSON.stringify({ NL21: 2, NL9: "x" }) }, "ERP_X_MAP")).toEqual({ NL21: "2", NL9: "x" });
  });

  it("Business Central: EUR by default, invoices posted only when switched on", () => {
    const base = { ERP_BC_TENANT: "t", ERP_BC_ENVIRONMENT: "e", ERP_BC_COMPANY_ID: "c", ERP_BC_GENERAL_JOURNAL_ID: "g", ERP_BC_PAYMENT_JOURNAL_ID: "p", ERP_BC_VAT_CODES: VAT };
    expect(bcConfigFromEnv(base)).toMatchObject({ localCurrency: "EUR", postInvoices: false, glMap: {} });
    expect(bcConfigFromEnv({ ...base, ERP_BC_LOCAL_CURRENCY: "GBP", ERP_BC_POST_INVOICES: "on", ERP_BC_GL_MAP: JSON.stringify({ "5000": "x" }) })).toMatchObject({ localCurrency: "GBP", postInvoices: true, glMap: { "5000": "x" } });
    expect(bcConfigFromEnv({ ERP_BC_VAT_CODES: VAT })).toMatchObject({ tenant: "", environment: "", companyId: "" });
  });

  it("Odoo: journal and tax ids must be numbers", () => {
    const base = { ERP_ODOO_URL: "https://x.odoo.com", ERP_ODOO_PURCHASE_JOURNAL_ID: "2", ERP_ODOO_GENERAL_JOURNAL_ID: "3", ERP_ODOO_BANK_JOURNALS: JSON.stringify({ "1200": "6" }), ERP_ODOO_TAX_IDS: VAT };
    expect(odooConfigFromEnv(base)).toMatchObject({ purchaseJournalId: 2, generalJournalId: 3, bankJournalIds: { "1200": 6 }, taxIds: { NL21: 1 }, companyCurrency: "EUR", post: false });
    expect(odooConfigFromEnv({ ...base, ERP_ODOO_POST: "on", ERP_ODOO_COMPANY_CURRENCY: "USD" })).toMatchObject({ post: true, companyCurrency: "USD" });
    expect(() => odooConfigFromEnv({ ...base, ERP_ODOO_BANK_JOURNALS: JSON.stringify({ "1200": "six" }) })).toThrow("ERP_ODOO_BANK_JOURNALS: 1200 must be a number");
  });

  it("Exact: its division as a number, a VAT code for every Purser code, the documented defaults", () => {
    const env = { ERP_EXACT_DIVISION: "1000", ERP_EXACT_PURCHASE_JOURNAL: "60", ERP_EXACT_GENERAL_JOURNAL: "90" };
    const maps = { vat: JSON.parse(VAT) as Record<string, string>, gl: {}, banks: { "1200": "20" } };
    expect(exactConfigFromEnv(env, maps)).toMatchObject({ baseUrl: "https://start.exactonline.nl", division: 1000, apAccount: "1600", paymentSign: -1 });
    expect(exactConfigFromEnv({ ...env, ERP_EXACT_PAYMENT_SIGN: "1", ERP_EXACT_DOCUMENT_TYPE: "30", ERP_EXACT_BASE_URL: "https://start.exactonline.de" }, maps)).toMatchObject({ paymentSign: 1, documentType: 30, baseUrl: "https://start.exactonline.de" });
    expect(() => exactConfigFromEnv({}, maps)).toThrow("ERP_EXACT_DIVISION is not set");
    expect(() => exactConfigFromEnv({ ...env, ERP_EXACT_DIVISION: "abc" }, maps)).toThrow("ERP_EXACT_DIVISION must be the division number");
    const { NONE: _none, ...partial } = maps.vat;
    expect(() => exactConfigFromEnv(env, { ...maps, vat: partial })).toThrow("ERP_EXACT_VAT_CODES has no code for NONE");
    expect(() => exactConfigFromEnv({ ERP_EXACT_DIVISION: "1" }, maps)).toThrow("ERP_EXACT_PURCHASE_JOURNAL is not set");
  });

  it("a pull may run before the tax rates it lists are set; a sync may not", () => {
    const env = { ERP_MONEYBIRD_TOKEN: "x", ERP_MONEYBIRD_ADMINISTRATION_ID: "1" };
    expect(missingSettings("moneybird", env)).toEqual(["ERP_MONEYBIRD_TAX_RATES"]);
    expect(missingSettings("moneybird", env, true)).toEqual([]);
    expect(missingSettings("odoo", {}, true)).toContain("ERP_ODOO_API_KEY");
  });
});

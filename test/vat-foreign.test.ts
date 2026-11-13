// Foreign VAT (13 Nov, owner): a supplier registered for VAT in Germany that charged German 19% charged Germany's VAT, not
// Dutch input tax. The books code it PF_DE19 from the supplier's own VAT id, and the quarterly overview counts it on its own
// row, outside the Dutch return's boxes and never in 5b. Code never picks it from a rate alone: a 19% invoice from a
// supplier with no German VAT id stays uncoded for a person, and the Coder's list of codes does not carry it.
import { describe, expect, it } from "vitest";
import { foreignVat, dutchVat } from "../src/ap/books.js";
import { VAT_CODES } from "../src/ledger/vat.js";
import { vatOverviewFrom } from "../src/ledger/reports.js";
import { testCloud } from "./support/cloud.js";

describe("foreign VAT", () => {
  it("is coded only from a German VAT id and an exact 19%", () => {
    expect(foreignVat(155462, 29538, "DE123456789")).toBe("PF_DE19");
    expect(foreignVat(155462, 29538, "de 123 456 789")).toBe("PF_DE19");
    expect(foreignVat(155462, 29538, "NL123456789B01")).toBeNull();
    expect(foreignVat(155462, 29538, null)).toBeNull();
    expect(foreignVat(155462, 32647, "DE123456789")).toBeNull();
    expect(foreignVat(155462, 0, "DE123456789")).toBeNull();
    // A Dutch rate is still Dutch, whoever charged it.
    expect(dutchVat(40000, 8400)).toBe("P21");
    expect(VAT_CODES.PF_DE19).toMatchObject({ kind: "purchase", rate: 19, rubric: null, foreign: "DE" });
    expect(VAT_CODES.PF_DE19!.deductible).toBeUndefined();
  });

  it("sits on its own row of the overview: not in a rubric, not in 5b, not uncoded", () => {
    const line = (o: Partial<Parameters<typeof vatOverviewFrom>[0][number]>) => ({ posting_date: "2026-11-04", account: "6200", currency: "EUR", debit_cents: 0, credit_cents: 0, vat_code: null, vat_cents: null, closing: false, ...o }) as Parameters<typeof vatOverviewFrom>[0][number];
    const v = vatOverviewFrom([
      line({ debit_cents: 155462, vat_code: "PF_DE19", vat_cents: 29538 }),
      line({ account: "6900", debit_cents: 40000, vat_code: "P21", vat_cents: 8400 }),
      line({ account: "6100", debit_cents: 1500 }),
    ], "2026Q4");
    expect(v.foreign_vat).toEqual({ lines: 1, base_cents: 155462, vat_cents: 29538 });
    expect(v.input_5b_cents).toBe(8400);
    expect(v.uncoded_lines).toBe(1);
    expect(Object.values(v.rubrics).reduce((n, r) => n + r.vat_cents, 0)).toBe(0);
  });

  it("is how the demo company's German suppliers are booked: the whole 1515 balance on that row, none on 1510, and said so to a connector", async () => {
    const c = testCloud();
    try {
      const g = (await c.req("POST", "/v1/auth/guest", { key: null })).json.session as string;
      const v = (await c.req("GET", "/v1/reports/vat?quarter=2026Q4", { key: g })).json as { input_5b_cents: number; foreign_vat: { lines: number; vat_cents: number }; uncoded_lines: number };
      const bal = (await c.req("GET", "/v1/reports/balance", { key: g })).json as { by_currency: { EUR: { accounts: { account: string; cents: number }[] } } };
      expect(v.foreign_vat.lines).toBe(5);
      // Code review 13 Nov: German VAT sits on 1515 (to reclaim through the EU refund); 1510 holds only what 5b reclaims.
      expect(v.foreign_vat.vat_cents).toBe(bal.by_currency.EUR.accounts.find((a) => a.account === "1515")!.cents);
      expect(bal.by_currency.EUR.accounts.find((a) => a.account === "1510")?.cents ?? 0).toBe(v.input_5b_cents);
      expect(v.input_5b_cents).toBe(0);
      const m = await c.req("POST", "/mcp", { key: "purser-demo-read-only", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "books_report", arguments: { report: "vat", quarter: "2026Q4" } } }, headers: { origin: "null-omit" } });
      expect((m.json.result as { content: { text: string }[] }).content[0]!.text).toMatch(/Foreign VAT, outside the Dutch return: EUR 952\.84 on EUR 5,014\.96 \(5 lines/);
    } finally {
      c.close();
    }
  });
});

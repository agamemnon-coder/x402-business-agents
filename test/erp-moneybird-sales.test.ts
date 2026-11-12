// Moneybird: reading the company's open sales invoices (master-list line 649), for the collections agent. Tested against
// a fake built from Moneybird's own OpenAPI file: the path, the scope and the documented example answers
// (test/fixtures/moneybird/sales-invoices.json, made by extract-sales.py). No live call.
import { describe, expect, it } from "vitest";
import { MONEYBIRD_OPEN_SALES_STATES, MoneybirdConnector, openSalesInvoiceOf } from "../src/erp/moneybird.js";
import { FakeMoneybird, SALES } from "./fakes/moneybird.js";

const setup = () => {
  const fake = new FakeMoneybird();
  const c = new MoneybirdConnector({ baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR", taxRates: {}, glMap: {}, projects: {}, ignoreCostCentres: true }, fake.transport, { token: async () => fake.token, invalidate: () => {} });
  return { fake, c };
};

describe("Moneybird: open sales invoices", () => {
  it("reads the path and states Moneybird documents, under the sales_invoices scope", () => {
    expect(SALES.endpoint).toBe("GET /{administration_id}/sales_invoices{format}");
    expect(SALES.scopes).toEqual(["sales_invoices"]);
    for (const s of MONEYBIRD_OPEN_SALES_STATES) expect(SALES.states).toContain(s);
    expect(MONEYBIRD_OPEN_SALES_STATES).not.toContain("paid");
    expect(MONEYBIRD_OPEN_SALES_STATES).not.toContain("draft");
  });

  it("lists the open ones of any date, with due date, amount, contact and state, in whole cents", async () => {
    const { fake, c } = setup();
    const open = await c.openSalesInvoices();
    expect(open).toHaveLength(4);
    const first = open[0]!;
    expect(first).toMatchObject({ number: "2026-1", state: "open", dueDate: "2025-11-26", currency: "EUR", totalCents: 12100, unpaidCents: 12100 });
    expect(first.contactName.length).toBeGreaterThan(0);
    expect(typeof first.id).toBe("string");
    // One GET, with the state filter Moneybird documents (several states with a pipe) and no period.
    const sent = fake.transport.sent.map((r) => new URL(r.url));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.pathname).toBe(`/api/v2/${fake.admin}/sales_invoices.json`);
    expect(sent[0]!.searchParams.get("filter")).toBe("state:open|pending_payment|reminded|late");
  });

  it("leaves out paid and draft invoices, one with nothing unpaid, and one whose amount is not money", async () => {
    const { fake, c } = setup();
    const base = fake.salesInvoices[0]!;
    fake.salesInvoices = [
      { ...base, id: "1", state: "paid", total_unpaid: "0.0" },
      { ...base, id: "2", state: "draft", invoice_id: null },
      { ...base, id: "3", state: "late", total_unpaid: "0.0" },
      { ...base, id: "4", state: "late", total_unpaid: "abc" },
      { ...base, id: "5", state: "reminded", total_unpaid: "60.5" },
    ];
    expect((await c.openSalesInvoices()).map((x) => [x.id, x.state, x.unpaidCents])).toEqual([["5", "reminded", 6050]]);
    expect(openSalesInvoiceOf({ ...base, total_price_incl_tax: "x" } as never)).toBeNull();
  });

  it("follows Moneybird's pages", async () => {
    const { fake, c } = setup();
    const base = fake.salesInvoices[0]!;
    fake.salesInvoices = Array.from({ length: 230 }, (_, i) => ({ ...base, id: String(1000 + i), invoice_id: `2026-${i}` }));
    expect(await c.openSalesInvoices()).toHaveLength(230);
    expect(fake.transport.sent).toHaveLength(3);
  });
});

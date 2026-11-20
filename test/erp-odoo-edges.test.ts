// The Odoo connector's refusals and look-ups (src/erp/odoo.ts), against answers shaped as Odoo sends them: an HTTP error,
// an access fault and an answer that is not XML-RPC; an Odoo too old to say its version, and 17.0, whose payments take
// `ref`; an account, a currency, a tax or a supplier it does not have; the parts an object found without its steps may
// lack (a bank account, a PDF, the posting); every kind of look-up; and each payment_state. No live calls.
import { describe, expect, it } from "vitest";
import { ErpError, RecordingTransport, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { OdooConnector, type OdooConfig } from "../src/erp/odoo.js";
import { decodeCallForTest, type XmlValue } from "../src/erp/xmlrpc.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

const config: OdooConfig = {
  url: "https://acme.odoo.com/", db: "acme", login: "purser@example.com", apiKey: "odoo-api-key-123", companyCurrency: "EUR",
  purchaseJournalId: 2, bankJournalIds: { "1200": 6 }, generalJournalId: 3, taxIds: { NL21: 21, NL9: 0, NL0: 0, EU_RC: 31, NONEU_RC: 32, EXEMPT: 0, NONE: 0 }, glMap: { "6900": "6200" }, post: true,
};
const refs = { vendor: (id: string) => (id === "V-1" ? "41" : null), invoice: () => "77" };
const xmlOk = (v: string): HttpResponse => ({ status: 200, headers: {}, body: `<?xml version='1.0'?><methodResponse><params><param><value>${v}</value></param></params></methodResponse>` });
const fault = (s: string): HttpResponse => ({ status: 200, headers: {}, body: `<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>3</int></value></member><member><name>faultString</name><value><string>${s}</string></value></member></struct></value></fault></methodResponse>` });
const int = (n: number) => `<int>${n}</int>`;
const arr = (...xs: string[]) => `<array><data>${xs.map((x) => `<value>${x}</value>`).join("")}</data></array>`;
const struct = (o: Record<string, string>) => `<struct>${Object.entries(o).map(([k, v]) => `<member><name>${k}</name><value>${v}</value></member>`).join("")}</struct>`;
const ACCOUNTS = arr(struct({ id: int(600), code: "<string>6200</string>", name: "<string>Goods</string>" }), struct({ id: int(680), code: "<string>6800</string>", name: "<string>Fees</string>" }), struct({ id: int(120), code: "<string>1200</string>", name: "<string>Bank</string>" }));

type Route = (model: string, method: string, args: XmlValue[], kwargs: XmlValue) => HttpResponse;
function odoo(route: Route, o: { version?: string; cfg?: Partial<OdooConfig> } = {}) {
  const calls: { model: string; method: string; args: XmlValue[]; kwargs: XmlValue }[] = [];
  const tr = new RecordingTransport((req: HttpRequest) => {
    const call = decodeCallForTest(req.body as string);
    if (req.url.endsWith("/xmlrpc/2/common")) return call.method === "version" ? xmlOk(o.version ?? struct({ server_version_info: arr(int(18), int(0)) })) : xmlOk(int(2));
    const [, , , model, method, args, kwargs] = call.params as [string, number, string, string, string, XmlValue[], XmlValue];
    calls.push({ model, method, args, kwargs });
    return route(model, method, args, kwargs);
  });
  return { tr, calls, c: new OdooConnector({ ...config, ...o.cfg }, tr) };
}
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a refusal"); }, (e: unknown) => e as ErpError);

describe("Odoo's answers that are not a result", () => {
  it("an HTTP error, an access fault, a validation fault and an answer that is not XML-RPC each become their own kind", async () => {
    const http = new OdooConnector(config, new RecordingTransport(() => ({ status: 503, headers: {}, body: "down" })));
    expect(await failure(http.pullChartOfAccounts())).toBeInstanceOf(ErpError);
    const access = await failure(odoo(() => fault("odoo.exceptions.AccessError: You are not allowed\nto read this")).c.pullVendors());
    expect(access).toMatchObject({ kind: "auth" });
    expect(access.message).toBe("Odoo execute_kw: odoo.exceptions.AccessError: You are not allowed to read this");
    expect(await failure(odoo(() => fault("ValidationError: bad")).c.pullVendors())).toMatchObject({ kind: "validation" });
    const garbled = await failure(odoo(() => ({ status: 200, headers: {}, body: "<html>proxy</html>" })).c.pullVendors());
    expect(garbled).toMatchObject({ kind: "unexpected" });
    expect(garbled.message).toMatch(/^Odoo execute_kw: /);
  });
});

describe("the version, which picks the payment's reference field", () => {
  it("17.0 by its version string: the payment and its look-up use ref", async () => {
    const { calls, c } = odoo((model, method) => (model === "res.currency" ? xmlOk(arr(int(1))) : method === "search" ? xmlOk(arr()) : xmlOk(int(55))), { version: struct({ server_version: "<string>17.0+e</string>" }), cfg: { post: false } });
    expect(await c.pushPayment(samplePayment(), refs)).toBe("55");
    const created = calls.find((x) => x.model === "account.payment" && x.method === "create")!.args[0] as Record<string, unknown>;
    expect(created.ref).toBe("Purser payment PAY-1");
    expect(created).not.toHaveProperty("memo");
    expect(calls.some((x) => x.method === "action_post")).toBe(false);
    expect(await c.findExisting("payment", samplePayment(), refs)).toBeNull();
    expect(calls.at(-1)!.args[0]).toEqual([["ref", "=", "Purser payment PAY-1"]]);
  });

  it("an Odoo that does not say its version is refused before any payment is sent", async () => {
    const { calls, c } = odoo(() => xmlOk(int(1)), { version: struct({ server_version: "<string>saas~x</string>" }) });
    expect(await failure(c.pushPayment(samplePayment(), refs))).toMatchObject({ kind: "unexpected", message: "Odoo did not say its version (common.version)" });
    expect(calls).toEqual([]);
  });
});

describe("what Odoo must have before a push", () => {
  const books: Route = (model, method) => model === "account.account" ? xmlOk(ACCOUNTS) : model === "res.currency" ? xmlOk(arr(int(1))) : method === "read" ? xmlOk(arr(struct({ id: int(77), amount_total: "<double>1428.0</double>" }))) : xmlOk(int(77));

  it("an account it does not have, mapped or not, names the map to fix", async () => {
    const inv = { ...sampleInvoice(), lines: [{ ...sampleInvoice().lines[0]!, glAccount: "4999" }] };
    expect(await failure(odoo(books).c.pushPurchaseInvoice(inv, refs))).toMatchObject({ kind: "config", message: "Odoo has no account 4999 (Purser account 4999); map it in ERP_ODOO_GL_MAP" });
  });

  it("a mapped account and a zero tax id send the mapped account and no tax", async () => {
    const { calls, c } = odoo(books);
    const inv = { ...sampleInvoice(), paymentReference: undefined, pdf: undefined, totals: { ...sampleInvoice().totals, grossCents: 142_800 } };
    expect(await c.pushPurchaseInvoice(inv, refs)).toBe("77");
    const move = calls.find((x) => x.model === "account.move" && x.method === "create")!.args[0] as { invoice_line_ids: unknown[] };
    expect(move).not.toHaveProperty("payment_reference");
    expect(move.invoice_line_ids[1]).toEqual([0, 0, { name: "Printed catalogues", account_id: 600, quantity: 1, price_unit: 200, tax_ids: [[6, 0, []]] }]);
  });

  it("a currency it does not have, a tax with no id, and a supplier not sent yet are refused", async () => {
    const noCurrency = odoo((model) => (model === "account.account" ? xmlOk(ACCOUNTS) : xmlOk(arr())));
    expect(await failure(noCurrency.c.pushPurchaseInvoice(sampleInvoice(), refs))).toMatchObject({ kind: "config", message: "Odoo has no active currency EUR" });
    const noTax = odoo(books, { cfg: { taxIds: { ...config.taxIds, NL21: undefined as unknown as number } } });
    expect(await failure(noTax.c.pushPurchaseInvoice(sampleInvoice(), refs))).toMatchObject({ kind: "config", message: "no Odoo tax for NL21; set it in ERP_ODOO_TAX_IDS" });
    expect(await failure(odoo(books).c.pushPurchaseInvoice({ ...sampleInvoice(), vendorId: "V-9" }, refs))).toMatchObject({ kind: "validation", message: "vendor V-9 is not in Odoo yet" });
  });

  it("Odoo's total missing from its answer leaves the bill in draft, said with a question mark", async () => {
    const { c } = odoo((model, method) => (model === "account.account" ? xmlOk(ACCOUNTS) : model === "res.currency" ? xmlOk(arr(int(1))) : method === "read" ? xmlOk(arr()) : xmlOk(int(78))));
    const e = await failure(c.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs));
    expect(e).toMatchObject({ kind: "needs_review" });
    expect(e.message).toMatch(/^Odoo computed a total of \? for move 78/);
  });

  it("with the totals check off, a bill is posted as it is", async () => {
    const { calls, c } = odoo(books, { cfg: { verifyTotals: false } });
    await c.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs);
    expect(calls.some((x) => x.method === "read")).toBe(false);
    expect(calls.at(-1)).toMatchObject({ method: "action_post" });
  });

  it("a payment from an account with no bank journal, and a journal entry in another currency, are refused before any call", async () => {
    const { calls, c } = odoo(books);
    expect(await failure(c.pushPayment({ ...samplePayment(), bankAccount: "1210" }, refs))).toMatchObject({ kind: "config", message: "no Odoo bank journal for Purser account 1210; set it in ERP_ODOO_BANK_JOURNALS" });
    expect(await failure(c.pushJournalEntry({ ...sampleJournal(), currency: "USD" }))).toMatchObject({ kind: "config", message: "journal entry JE-1 is in USD; only EUR entries are sent to Odoo so far" });
    expect(calls).toEqual([]);
  });

  it("a journal line without words takes the entry's memo; with posting off it stays a draft", async () => {
    const { calls, c } = odoo(books, { cfg: { post: false } });
    const j = sampleJournal();
    await c.pushJournalEntry({ ...j, lines: [{ ...j.lines[0]!, description: undefined }, j.lines[1]!] });
    const lines = (calls.find((x) => x.method === "create")!.args[0] as { line_ids: unknown[] }).line_ids;
    expect(lines[0]).toEqual([0, 0, { name: "SWIFT fee, Airwallex", account_id: 680, debit: 13.42, credit: 0 }]);
    expect(calls.some((x) => x.method === "action_post")).toBe(false);
  });

  it("a supplier without VAT id, email or IBAN is a partner only; suppliers are read with their VAT id when they have one", async () => {
    const { calls, c } = odoo((model, method) => (method === "search_read" ? xmlOk(arr(struct({ id: int(41), name: "<string>Bergtex</string>", vat: "<string>DE1</string>" }), struct({ id: int(42), name: "<string>Kleinbetrieb</string>", vat: "<boolean>0</boolean>" }))) : xmlOk(int(43))));
    expect(await c.pushVendor({ ...sampleVendor(), vatId: undefined, email: undefined, iban: undefined })).toBe("43");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toEqual({ name: "Bergtex Textil GmbH", is_company: true, supplier_rank: 1 });
    expect(await c.pullVendors()).toEqual([{ externalId: "41", name: "Bergtex", vatId: "DE1" }, { externalId: "42", name: "Kleinbetrieb" }]);
  });
});

describe("an object found without the record of its steps", () => {
  it("a supplier needs its bank account (only when it has an IBAN)", async () => {
    const none = odoo(() => xmlOk(arr()));
    expect(await none.c.incomplete("vendor", sampleVendor(), "41")).toBe("its bank account is not there");
    expect(await none.c.incomplete("vendor", { ...sampleVendor(), iban: undefined }, "41")).toBeNull();
    expect(await odoo(() => xmlOk(arr(int(5)))).c.incomplete("vendor", sampleVendor(), "41")).toBeNull();
  });

  it("a bill needs its PDF and to be posted; a payment to be posted; nothing is asked with posting off", async () => {
    const draft = odoo((model, method) => (method === "search" ? xmlOk(arr()) : xmlOk(arr(struct({ state: "<string>draft</string>" })))));
    expect(await draft.c.incomplete("invoice", sampleInvoice(), "77")).toBe("its PDF is not attached; it is draft, not posted");
    expect(await draft.c.incomplete("payment", samplePayment(), "55")).toBe("it is draft, not posted");
    expect(draft.calls.at(-1)).toMatchObject({ model: "account.payment", method: "read" });
    const gone = odoo(() => xmlOk(arr()));
    expect(await gone.c.incomplete("journal", sampleJournal(), "91")).toBe("it is missing, not posted");
    const whole = odoo((_m, method) => (method === "search" ? xmlOk(arr(int(900))) : xmlOk(arr(struct({ state: "<string>posted</string>" })))));
    expect(await whole.c.incomplete("invoice", sampleInvoice(), "77")).toBeNull();
    const off = odoo(() => { throw new Error("no call expected"); }, { cfg: { post: false } });
    expect(await off.c.incomplete("invoice", { ...sampleInvoice(), pdf: undefined }, "77")).toBeNull();
  });
});

describe("finding what was sent before", () => {
  it("looks a supplier up by name, a bill only once its supplier is known, and an entry by its reference", async () => {
    const { calls, c } = odoo((_m, method) => (method === "search" ? xmlOk(arr(int(91))) : xmlOk(arr())));
    expect(await c.findExisting("vendor", sampleVendor(), refs)).toBe("91");
    expect(calls[0]!.args[0]).toEqual([["name", "=", "Bergtex Textil GmbH"], ["supplier_rank", ">", 0]]);
    expect(await c.findExisting("invoice", { ...sampleInvoice(), vendorId: "V-9" }, refs)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(await c.findExisting("journal", sampleJournal(), refs)).toBe("91");
    expect(calls.at(-1)!.args[0]).toEqual([["move_type", "=", "entry"], ["ref", "=", "Purser JE-1: SWIFT fee, Airwallex"]]);
    expect(await c.findExisting("payment", samplePayment(), refs)).toBe("91");
    expect(calls.at(-1)!.args[0]).toEqual([["memo", "=", "Purser payment PAY-1"]]);
  });

  it.each([["paid", "paid"], ["in_payment", "paid"], ["partial", "partial"], ["not_paid", "unpaid"], ["reversed", "unknown"]])("payment_state %s reads as %s", async (state, want) => {
    const { c } = odoo(() => xmlOk(arr(struct({ id: int(77), payment_state: `<string>${state}</string>` }))));
    expect(await c.pullPaymentStatus(sampleInvoice(), "77")).toBe(want);
  });

  it("a bill Odoo no longer has reads as unknown", async () => {
    expect(await odoo(() => xmlOk(arr())).c.pullPaymentStatus(sampleInvoice(), "77")).toBe("unknown");
  });
});

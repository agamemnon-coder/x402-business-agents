// The Odoo connector (src/erp/odoo.ts) over Odoo's documented External API (XML-RPC: xmlrpc/2/common authenticate,
// xmlrpc/2/object execute_kw), against answers shaped as Odoo sends them. No live calls.
import { describe, expect, it } from "vitest";
import { ErpError, RecordingTransport, redactRequest, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { OdooConnector, type OdooConfig } from "../src/erp/odoo.js";
import { decodeResponse, encodeCall, type XmlValue } from "../src/erp/xmlrpc.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

describe("XML-RPC", () => {
  it("encodes a call with ints, strings, booleans, doubles, lists, structs and nil, escaping text", () => {
    const xml = encodeCall("execute_kw", ["db", 2, "k<e>y&", "res.partner", "create", [{ name: "O'Neill & Co", rank: 1, ok: true, x: 1.5, none: null, ids: [[6, 0, [3]]] }], {}]);
    expect(xml).toContain("<methodName>execute_kw</methodName>");
    expect(xml).toContain("<string>k&lt;e&gt;y&amp;</string>");
    expect(xml).toContain("<member><name>name</name><value><string>O&apos;Neill &amp; Co</string></value></member>");
    expect(xml).toContain("<int>1</int>");
    expect(xml).toContain("<boolean>1</boolean>");
    expect(xml).toContain("<double>1.5</double>");
    expect(xml).toContain("<nil/>");
  });

  it("decodes a response and a fault", () => {
    const ok = `<?xml version='1.0'?><methodResponse><params><param><value><array><data><value><struct><member><name>id</name><value><int>7</int></value></member><member><name>name</name><value><string>Bergtex &amp; Co</string></value></member><member><name>vat</name><value><boolean>0</boolean></value></member><member><name>amount_total</name><value><double>1428.0</double></value></member></struct></value></data></array></value></param></params></methodResponse>`;
    expect(decodeResponse(ok)).toEqual([{ id: 7, name: "Bergtex & Co", vat: false, amount_total: 1428 }]);
    const fault = `<?xml version='1.0'?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>1</int></value></member><member><name>faultString</name><value><string>ValidationError: missing account</string></value></member></struct></value></fault></methodResponse>`;
    expect(() => decodeResponse(fault)).toThrow(/missing account/);
    expect(decodeResponse("<methodResponse><params><param><value>plain</value></param></params></methodResponse>")).toBe("plain");
  });
});

const config: OdooConfig = {
  url: "https://acme.odoo.com", db: "acme", login: "purser@example.com", apiKey: "odoo-api-key-123", companyCurrency: "EUR",
  purchaseJournalId: 2, bankJournalIds: { "1200": 6 }, generalJournalId: 3, taxIds: { NL21: 21, NL9: 9, NL0: 0, EU_RC: 31, NONEU_RC: 32, EXEMPT: 0, NONE: 0 }, glMap: {}, post: true,
};
const refs = { vendor: () => "41", invoice: () => "77" };
const xmlOk = (v: string) => ({ status: 200, headers: {}, body: `<?xml version='1.0'?><methodResponse><params><param><value>${v}</value></param></params></methodResponse>` });
const int = (n: number) => `<int>${n}</int>`;
const arr = (...xs: string[]) => `<array><data>${xs.map((x) => `<value>${x}</value>`).join("")}</data></array>`;
const struct = (o: Record<string, string>) => `<struct>${Object.entries(o).map(([k, v]) => `<member><name>${k}</name><value>${v}</value></member>`).join("")}</struct>`;

/** Calls as Odoo receives them: [model, method, args, kwargs]. */
function odoo(route: (model: string, method: string, args: XmlValue[], kwargs: XmlValue) => HttpResponse) {
  const calls: { model: string; method: string; args: XmlValue[]; kwargs: XmlValue }[] = [];
  const tr = new RecordingTransport((req: HttpRequest) => {
    const call = decodeCallForTest(req.body as string);
    if (req.url.endsWith("/xmlrpc/2/common")) return call.method === "version" ? xmlOk(struct({ server_version: "<string>18.0</string>", server_version_info: arr(int(18), int(0)) })) : xmlOk(int(2));
    const [, , , model, method, args, kwargs] = call.params as [string, number, string, string, string, XmlValue[], XmlValue];
    calls.push({ model, method, args, kwargs });
    return route(model, method, args, kwargs);
  });
  return { tr, calls, c: new OdooConnector(config, tr) };
}
// The test reads the calls back with the same decoder Odoo's answers go through.
import { decodeCallForTest } from "../src/erp/xmlrpc.js";

const ACCOUNTS = arr(struct({ id: int(600), code: "<string>6200</string>", name: "<string>Goods</string>" }), struct({ id: int(690), code: "<string>6900</string>", name: "<string>Other</string>" }),
  struct({ id: int(680), code: "<string>6800</string>", name: "<string>Fees</string>" }), struct({ id: int(120), code: "<string>1200</string>", name: "<string>Bank</string>" }));

describe("Odoo connector", () => {
  it("authenticates with the login and API key, then creates a supplier and its bank account", async () => {
    const { tr, calls, c } = odoo((model) => xmlOk(int(model === "res.partner" ? 41 : 5)));
    expect(await c.pushVendor(sampleVendor())).toBe("41");
    expect(tr.sent[0]!.url).toBe("https://acme.odoo.com/xmlrpc/2/common");
    expect(tr.sent[0]!.body).toContain("<methodName>authenticate</methodName>");
    expect(calls[0]).toMatchObject({ model: "res.partner", method: "create", args: [{ name: "Bergtex Textil GmbH", vat: "DE123456789", email: "billing@example.com", is_company: true, supplier_rank: 1 }] });
    expect(calls[1]).toMatchObject({ model: "res.partner.bank", method: "create", args: [{ acc_number: "DE89370400440532013000", partner_id: 41 }] });
  });

  it("creates a vendor bill (in_invoice) with lines, attaches the PDF, checks Odoo's total, then posts it", async () => {
    const { calls, c } = odoo((model, method) => {
      if (model === "account.account") return xmlOk(ACCOUNTS);
      if (model === "res.currency") return xmlOk(arr(int(1)));
      if (model === "account.move" && method === "create") return xmlOk(int(77));
      if (model === "ir.attachment") return xmlOk(int(900));
      if (model === "account.move" && method === "read") return xmlOk(arr(struct({ id: int(77), amount_total: "<double>1428.0</double>" })));
      if (model === "account.move" && method === "action_post") return xmlOk("<boolean>1</boolean>");
      throw new Error(`unexpected ${model}.${method}`);
    });
    expect(await c.pushPurchaseInvoice(sampleInvoice(), refs)).toBe("77");
    const move = calls.find((x) => x.model === "account.move" && x.method === "create")!;
    expect(move.args[0]).toEqual({
      move_type: "in_invoice", partner_id: 41, ref: "BT-2026-0042", invoice_date: "2026-11-02", invoice_date_due: "2026-12-02", currency_id: 1, journal_id: 2, payment_reference: "RF18 0000 0000 0042",
      invoice_line_ids: [
        [0, 0, { name: "Rain jackets, 40 pieces", account_id: 600, quantity: 1, price_unit: 1000, tax_ids: [[6, 0, [21]]] }],
        [0, 0, { name: "Printed catalogues", account_id: 690, quantity: 1, price_unit: 200, tax_ids: [[6, 0, [9]]] }],
      ],
    });
    const att = calls.find((x) => x.model === "ir.attachment")!;
    expect(att.args[0]).toEqual({ name: "BT-2026-0042.pdf", datas: "JVBERg==", res_model: "account.move", res_id: 77, mimetype: "application/pdf" });
    expect(calls.at(-1)).toMatchObject({ model: "account.move", method: "action_post", args: [[77]] });
  });

  it("leaves a bill in draft when Odoo's total differs", async () => {
    const { calls, c } = odoo((model, method) => {
      if (model === "account.account") return xmlOk(ACCOUNTS);
      if (model === "res.currency") return xmlOk(arr(int(1)));
      if (method === "read") return xmlOk(arr(struct({ id: int(78), amount_total: "<double>1430.0</double>" })));
      return xmlOk(int(78));
    });
    await expect(c.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs)).rejects.toThrow(/draft/);
    expect(calls.some((x) => x.method === "action_post")).toBe(false);
  });

  it("cancels a bill with a vendor refund (in_refund) that points at it", async () => {
    const { calls, c } = odoo((model, method) => (model === "account.account" ? xmlOk(ACCOUNTS) : model === "res.currency" ? xmlOk(arr(int(1))) : method === "read" ? xmlOk(arr(struct({ id: int(80), amount_total: "<double>1428.0</double>" }))) : xmlOk(int(80))));
    expect(await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, "77", refs)).toBe("80");
    expect(calls.find((x) => x.method === "create")!.args[0]).toMatchObject({ move_type: "in_refund", reversed_entry_id: 77, ref: "BT-2026-0042-CR" });
  });

  it("records an outbound supplier payment in the bank journal", async () => {
    const { calls, c } = odoo((model) => (model === "res.currency" ? xmlOk(arr(int(1))) : xmlOk(int(55))));
    expect(await c.pushPayment(samplePayment(), refs)).toBe("55");
    expect(calls.find((x) => x.model === "account.payment" && x.method === "create")!.args[0]).toEqual({
      payment_type: "outbound", partner_type: "supplier", partner_id: 41, amount: 1428, currency_id: 1, date: "2026-11-20", memo: "Purser payment PAY-1", journal_id: 6,
    });
  });

  it("writes a journal entry as an account.move of type entry with debit and credit lines", async () => {
    const { calls, c } = odoo((model, method) => (model === "account.account" ? xmlOk(ACCOUNTS) : model === "res.currency" ? xmlOk(arr(int(1))) : method === "create" ? xmlOk(int(91)) : xmlOk("<boolean>1</boolean>")));
    expect(await c.pushJournalEntry(sampleJournal())).toBe("91");
    expect(calls.find((x) => x.method === "create")!.args[0]).toEqual({
      move_type: "entry", journal_id: 3, date: "2026-11-20", ref: "Purser JE-1: SWIFT fee, Airwallex",
      line_ids: [[0, 0, { name: "Bank and transfer fees", account_id: 680, debit: 13.42, credit: 0 }], [0, 0, { name: "Airwallex EUR", account_id: 120, debit: 0, credit: 13.42 }]],
    });
  });

  it("finds a bill by supplier and reference, and maps payment_state", async () => {
    const { calls, c } = odoo((_m, method) => (method === "search" ? xmlOk(arr(int(77))) : xmlOk(arr(struct({ id: int(77), payment_state: "<string>in_payment</string>" })))));
    expect(await c.findExisting("invoice", sampleInvoice(), refs)).toBe("77");
    expect(calls[0]!.args[0]).toEqual([["move_type", "=", "in_invoice"], ["partner_id", "=", 41], ["ref", "=", "BT-2026-0042"]]);
    expect(await c.pullPaymentStatus(sampleInvoice(), "77", refs)).toBe("paid");
  });

  it("turns an Odoo fault into a validation error, and a refused login into an auth error", async () => {
    const { c } = odoo(() => ({ status: 200, headers: {}, body: `<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>2</int></value></member><member><name>faultString</name><value><string>The VAT number is invalid</string></value></member></struct></value></fault></methodResponse>` }));
    const e = (await c.pushVendor(sampleVendor()).then(() => null, (x: unknown) => x)) as ErpError;
    expect(e).toMatchObject({ kind: "validation" });
    expect(e.message).toContain("The VAT number is invalid");
    const bad = new OdooConnector(config, new RecordingTransport(() => xmlOk("<boolean>0</boolean>")));
    await expect(bad.pushVendor(sampleVendor())).rejects.toMatchObject({ kind: "auth" });
  });

  it("never prints the API key: a redacted call hides it", async () => {
    const { tr, c } = odoo(() => xmlOk(int(41)));
    await c.pushVendor({ ...sampleVendor(), iban: undefined });
    for (const r of tr.sent) expect(JSON.stringify(redactRequest(r))).not.toContain("odoo-api-key-123");
  });
});

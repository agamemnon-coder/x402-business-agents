// Payables page (src/servers/payables.ts): the routes' refusals. An unknown invoice or supplier request is a 404, never
// a 500; a request in the wrong state is a 409; a bad month or day is a 400; a credit note counts only once a person
// says who checked it and how; and a code once shown is not shown again while it lives.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { payablesApp } from "../src/servers/payables.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-10T09:00:00Z");
const CREDIT = `Schwarzwald Holz GmbH
Gutschrift
Gutschriftnummer: GS-77
Datum: 05.11.2026
Gesamtbetrag 120.00 EUR
IBAN: DE75 5121 0800 1245 1261 99`;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let base: string;
let close: () => void;
let notes: string[];
async function start(withRail: boolean) {
  notes = [];
  const server = payablesApp(db, { inbox: { dir, reader: parserOnly, now: () => NOW }, rail: withRail ? awx : null, payeeNames: null, notify: (l) => notes.push(l) }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  close = () => server.close();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-ref-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
});
afterEach(() => { close?.(); rmSync(dir, { recursive: true, force: true }); });

const token = async () => /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(base + "/")).text())?.[1] ?? "";
function raw(path: string, body: Buffer | string, headers: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method: "POST", headers: { "content-length": String(Buffer.byteLength(body)), ...headers } }, (r) => {
      let text = "";
      r.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: r.statusCode ?? 0, json: text ? JSON.parse(text) as Record<string, unknown> : {} }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const post = async (path: string, body?: unknown) =>
  raw(path, body === undefined ? "" : JSON.stringify(body), { "x-csrf": await token(), origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }) });
const upload = async (text: string, filename: string) =>
  raw("/api/payables/documents", await pdfOf(text), { "content-type": "application/octet-stream", "x-filename": filename, "x-csrf": await token(), origin: base });

describe("payables routes: unknown ids are 404s", () => {
  it("answers 404, not 500, for an invoice or supplier request that does not exist", async () => {
    await start(true);
    expect((await fetch(base + "/api/payables/invoices/AP-0404/document")).status).toBe(404);
    expect((await fetch(base + "/api/payables/invoices/AP-0404/detail")).status).toBe(404);
    expect((await fetch(base + "/api/payables/transactions/nope")).status).toBe(404);
    for (const path of ["/api/payables/invoices/AP-0404/pay", "/api/payables/invoices/AP-0404/supplier-request", "/api/payables/invoices/AP-0404/not-duplicate-code",
      "/api/payables/suppliers/ADD-404/verify-code", "/api/payables/suppliers/ADD-404/propose"]) {
      const r = await post(path);
      expect(r.status, path).toBe(404);
      expect(String(r.json.error), path).toMatch(/^no (payables invoice|supplier request) /);
    }
    const credit = await post("/api/payables/invoices/AP-0404/accept-credit", { by: "Anna", note: "called them" });
    expect(credit.status).toBe(404);
    expect(notes).toEqual([]);
  });
});

describe("payables routes: bad input is a 400 and reads nothing", () => {
  it("refuses a month or a day that is not written as one", async () => {
    await start(false);
    for (const path of ["/api/payables/reports/2026-13/pack.pdf", "/api/payables/reports/nov/journal.csv", "/api/payables/reports/2026-1/journal.json"]) {
      const r = await fetch(base + path);
      expect(r.status, path).toBe(400);
      expect((await r.json() as { error: string }).error).toBe("write the month as 2026-11");
    }
    for (const path of ["/api/payables/transactions?from=yesterday", "/api/payables/export/transactions.csv?to=30-11-2026", "/api/payables/export/transactions.json?from=2026-11"]) {
      const r = await fetch(base + path);
      expect(r.status, path).toBe(400);
      expect((await r.json() as { error: string }).error).toMatch(/must be a day like 2026-11-30/);
    }
  });

  it("gives the accountant's journal for a month as dated JSON, and the register filtered by day", async () => {
    await start(false);
    const j = await fetch(base + "/api/payables/reports/2026-11/journal.json");
    expect(j.status).toBe(200);
    expect(j.headers.get("content-disposition")).toBe('attachment; filename="journal-2026-11.json"');
    expect(JSON.parse(await j.text())).toBeTypeOf("object");
    const t = await fetch(base + "/api/payables/export/transactions.json?from=2026-11-01&to=2026-11-30&moved=yes");
    expect(t.status).toBe(200);
    expect(t.headers.get("content-disposition")).toBe('attachment; filename="transactions.json"');
    expect((await t.json() as { rows: unknown[] }).rows).toBeInstanceOf(Array);
  });

  it("will not plan a batch without Airwallex keys", async () => {
    await start(false);
    await upload(EN, "a.pdf");
    const r = await post("/api/payables/batch", { ids: ["AP-0001"] });
    expect(r.status).toBe(503);
    expect(apInvoice(db, "AP-0001")!.status).toBe("ready");
  });

  it("refuses a batch whose ids are not a list", async () => {
    await start(true);
    expect((await post("/api/payables/batch", { ids: "AP-0001" })).status).toBe(400);
    expect((await post("/api/payables/batch", {})).status).toBe(400);
  });
});

describe("payables routes: a credit note counts only once a person accepts it", () => {
  it("accepts a credit note only with who and how, and only a credit note", async () => {
    await start(false);
    await upload(EN, "invoice.pdf");
    await upload(CREDIT, "credit.pdf");
    const inv = apInvoice(db, "AP-0002")!;
    expect(inv.doc_kind).toBe("credit_note");
    expect(inv.credit_accepted_at).toBeNull();

    const missing = await post("/api/payables/invoices/AP-0002/accept-credit", { by: "Anna" });
    expect(missing.status).toBe(400);
    expect(missing.json.error).toMatch(/say who accepts the credit note/);
    const typed = await post("/api/payables/invoices/AP-0002/accept-credit", { by: 7, note: ["x"] });
    expect(typed.status).toBe(400);
    expect(apInvoice(db, "AP-0002")!.credit_accepted_at).toBeNull();

    const notCredit = await post("/api/payables/invoices/AP-0001/accept-credit", { by: "Anna", note: "called them" });
    expect(notCredit.status).toBe(400);
    expect(notCredit.json.error).toBe("AP-0001 is not a credit note");
    expect(apInvoice(db, "AP-0001")!.credit_accepted_at).toBeNull();

    const ok = await post("/api/payables/invoices/AP-0002/accept-credit", { by: "Anna", note: "called the supplier; they confirmed it" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ id: "AP-0002", credit_accepted_by: "Anna", payable: false });
    const audited = db.prepare("SELECT actor, subject FROM audit_log WHERE event = 'ap.credit_accepted'").all();
    expect(audited).toEqual([{ actor: "human", subject: "AP-0002" }]);
    // Accepted once: a second acceptance changes nothing and is not audited again.
    const again = await post("/api/payables/invoices/AP-0002/accept-credit", { by: "Bob", note: "checked it again myself" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ credit_accepted_by: "Anna" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.credit_accepted'").get()).toEqual({ n: 1 });
  });

  it("refuses to accept a rejected credit note as a conflict", async () => {
    await start(false);
    await upload(CREDIT, "credit.pdf");
    expect((await post("/api/payables/invoices/AP-0001/reject", { reason: "not ours" })).status).toBe(200);
    const r = await post("/api/payables/invoices/AP-0001/accept-credit", { by: "Anna", note: "called them" });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/AP-0001 is rejected: it cannot be accepted/);
  });
});

describe("payables routes: verification codes", () => {
  it("gives no code for a supplier request that is no longer waiting for a verification", async () => {
    await start(false);
    await upload(NL, "nl.pdf");
    const req = await post("/api/payables/invoices/AP-0001/supplier-request");
    const addId = String(req.json.add_id);
    db.prepare("UPDATE payee_adds SET status = 'CLOSED' WHERE add_id = ?").run(addId);
    const r = await post(`/api/payables/suppliers/${addId}/verify-code`);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe(`${addId} is closed, not waiting for a verification`);
    expect(notes).toEqual([]);
  });

  it("shows a not-a-duplicate code once, refuses a second while it lives, and takes only that code", async () => {
    await start(false);
    await upload(EN, "a.pdf");
    const first = await post("/api/payables/invoices/AP-0001/not-duplicate-code");
    expect(first.status).toBe(200);
    expect(notes).toHaveLength(1);
    const code = /is (\d{6})\./.exec(notes[0]!)![1]!;
    const again = await post("/api/payables/invoices/AP-0001/not-duplicate-code");
    expect(again.status).toBe(429);
    expect(again.json).toMatchObject({ code: "code_refused" });
    expect(notes).toHaveLength(1);

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const miss = await post("/api/payables/invoices/AP-0001/not-duplicate", { by: "Anna", note: "monthly rent", code: wrong });
    expect(miss.status).toBe(403);
    expect(miss.json.error).toBe("the verification code is not the one shown in the terminal");
    const none = await post("/api/payables/invoices/AP-0001/not-duplicate", { by: "Anna", note: "monthly rent" });
    expect(none.status).toBe(403);
  });
});

describe("payables routes: sync", () => {
  it("reports nothing changed when there is nothing to follow", async () => {
    await start(false);
    const r = await post("/api/payables/sync");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ changed: [] });
  });
});

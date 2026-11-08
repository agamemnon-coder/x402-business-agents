// Payables: the local page and its JSON routes under /api/payables (the same handlers can later sit behind the
// authenticated agent API). Loopback host only; a post needs this page's own Origin and its form token.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { payablesApp } from "../src/servers/payables.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let base: string;
let close: () => void;
async function start(withRail: boolean, rateLimit?: { windowMs: number; limit: number }) {
  const server = payablesApp(db, { inbox: { dir, reader: parserOnly }, rail: withRail ? awx : null, ...(rateLimit ? { rateLimit } : {}) }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  close = () => server.close();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-srv-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
});
afterEach(() => { close?.(); rmSync(dir, { recursive: true, force: true }); });

const token = async () => /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(base + "/")).text())?.[1] ?? "";
function raw(path: string, body: Buffer | string, headers: Record<string, string | undefined>, method = "POST"): Promise<{ status: number; text: string; type: string }> {
  return new Promise((resolve, reject) => {
    const h: Record<string, string> = { "content-length": String(Buffer.byteLength(body)) };
    for (const [k, v] of Object.entries(headers)) if (v !== undefined) h[k] = v;
    const req = request(base + path, { method, headers: h }, (r) => {
      let text = "";
      r.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: r.statusCode ?? 0, text, type: String(r.headers["content-type"] ?? "") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
/** origin null: no Origin header at all. */
const upload = async (bytes: Buffer, filename: string, t?: string, origin: string | null = base) =>
  raw("/api/payables/documents", bytes, { "content-type": "application/octet-stream", "x-filename": filename, "x-csrf": t ?? (await token()), origin: origin ?? undefined });
const post = async (path: string, t?: string) => raw(path, "", { "x-csrf": t ?? (await token()), origin: base });

describe("the payables page", () => {
  it("refuses a request whose Host is not loopback", async () => {
    await start(false);
    const status = await new Promise<number>((resolve) => {
      request(base + "/", { headers: { host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }).end();
    });
    expect(status).toBe(403);
  });

  it("serves the page with its form token and a strict content policy", async () => {
    await start(false);
    const res = await fetch(base + "/");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*connect-src 'self'/);
    const html = await res.text();
    expect(html).toMatch(/<meta name="csrf" content="[0-9a-f]{64}">/);
    expect(html).toContain("Payables");
  });

  it("takes an upload only from this page: its Origin and its token", async () => {
    await start(false);
    const pdf = await pdfOf(EN);
    expect((await upload(pdf, "a.pdf", "not-a-token")).status).toBe(403);
    expect((await upload(pdf, "a.pdf", undefined, "http://evil.example")).status).toBe(403);
    expect((await upload(pdf, "a.pdf", undefined, null)).status).toBe(403);
    const ok = await upload(pdf, "a.pdf");
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toMatchObject({ kind: "invoice", invoice: { id: "AP-0001", status: "ready" } });
  });

  it("refuses a file that is not a PDF or an e-mail, and says so", async () => {
    await start(false);
    const res = await upload(Buffer.from("hello"), "notes.txt");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).error).toMatch(/not a PDF/);
  });

  it("lists invoices, shows one with its document, and gives insight and the exports", async () => {
    await start(false);
    await upload(await pdfOf(EN), "a.pdf");
    const list = await (await fetch(base + "/api/payables/invoices")).json() as { id: string; status: string }[];
    expect(list.map((x) => [x.id, x.status])).toEqual([["AP-0001", "ready"]]);
    const one = await (await fetch(base + "/api/payables/invoices/AP-0001")).json() as { reading: { iban: string }; findings: unknown[] };
    expect(one.reading.iban).toBe("DE89370400440532013000");
    const doc = await fetch(base + "/api/payables/invoices/AP-0001/document");
    expect(doc.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await doc.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await (await fetch(base + "/api/payables/insights")).json()).toMatchObject({ open: [{ currency: "EUR", total: "1850.00", count: 1 }] });
    const j = await fetch(base + "/api/payables/export/journal.csv");
    expect(j.headers.get("content-type")).toMatch(/text\/csv/);
    expect((await j.text()).split("\n")[0]).toMatch(/^date,invoice_id,event,account/);
    expect((await (await fetch(base + "/api/payables/export/invoices.csv")).text())).toContain("AP-0001");
    expect((await fetch(base + "/api/payables/invoices/AP-9999")).status).toBe(404);
  });

  it("files a payment for the CFO's Face ID, and says why when Airwallex is not set up", async () => {
    await start(false);
    await upload(await pdfOf(EN), "a.pdf");
    const no = await post("/api/payables/invoices/AP-0001/pay");
    expect(no.status).toBe(503);
    close();
    await start(true);
    const yes = await post("/api/payables/invoices/AP-0001/pay");
    expect(yes.status).toBe(200);
    expect(JSON.parse(yes.text)).toMatchObject({ kind: "proposed", invoice: { status: "waiting_cfo" } });
    expect(awx.transfers).toHaveLength(0);
  });

  it("asks for a new supplier from an invoice waiting for one; a post without the token does nothing", async () => {
    await start(false);
    await upload(await pdfOf(NL), "nl.pdf");
    expect((await post("/api/payables/invoices/AP-0001/supplier-request", "bad")).status).toBe(403);
    const res = await post("/api/payables/invoices/AP-0001/supplier-request");
    // A Dutch account is paid on SEPA (LOCAL EUR): the request is made, and nothing is added until a person verifies it.
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({ vendor: "Zeeland Verpakkingen B.V.", status: "REQUESTED" });
    expect(awx.payoutBeneficiaries).toHaveLength(0);
  });

  it("limits how often it can be asked: past the limit it answers 429 and reads nothing", async () => {
    await start(false, { windowMs: 60_000, limit: 3 });
    for (let i = 0; i < 3; i++) expect((await fetch(base + "/api/payables/invoices")).status).toBe(200);
    const over = await fetch(base + "/api/payables/invoices");
    expect(over.status).toBe(429);
    expect(await over.text()).not.toMatch(/AP-/);
  });
});

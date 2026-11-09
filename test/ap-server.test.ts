// Payables: the local page and its JSON routes under /api/payables (the same handlers can later sit behind the
// authenticated agent API). Loopback host only; a post needs this page's own Origin and its form token.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { Script } from "node:vm";
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
async function start(withRail: boolean, rateLimit?: { windowMs: number; limit: number }, inboxAddress?: string) {
  const server = payablesApp(db, { inbox: { dir, reader: parserOnly }, rail: withRail ? awx : null, ...(rateLimit ? { rateLimit } : {}), ...(inboxAddress !== undefined ? { inboxAddress } : {}) }).listen(0, "127.0.0.1");
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
    expect(html).toContain("Crediteuren");
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
    // Masked like everywhere else (screenshot pass S5): the last four and the account's hash, never the full IBAN.
    expect(one.reading.iban).toBe("…3000");
    expect((one.reading as unknown as { account_sha256: string }).account_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(list)).not.toContain("DE89370400440532013000");
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

  it("pays picked invoices with one Face ID: one batch for the phone, only from this page, ids only", async () => {
    await start(true);
    await upload(await pdfOf(EN), "a.pdf");
    const body = JSON.stringify({ ids: ["AP-0001"] });
    const json = (t?: string, origin: string | undefined = base) => raw("/api/payables/batch", body, { "content-type": "application/json", "x-csrf": t, origin });
    expect((await json("not-a-token")).status).toBe(403);
    expect((await raw("/api/payables/batch", JSON.stringify({ ids: ["AP-0001", "<script>"] }), { "content-type": "application/json", "x-csrf": await token(), origin: base })).status).toBe(400);
    const ok = await json(await token());
    expect(ok.status).toBe(200);
    const j = JSON.parse(ok.text) as { batch: { proposal_id: string; count: number }; planned: unknown[]; invoices: { status: string }[] };
    expect(j.batch).toMatchObject({ count: 1 });
    expect(j.invoices[0]!.status).toBe("waiting_cfo");
    const detail = await (await fetch(base + "/api/payables/invoices/AP-0001/detail")).json() as { batch: { id: string; waiting: boolean } };
    expect(detail.batch).toMatchObject({ id: j.batch.proposal_id, waiting: true });
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

  it("serves each invoice its own page under a nonce-only script policy, and its detail as JSON", async () => {
    await start(false);
    await upload(await pdfOf(EN), "a.pdf");
    const page = await fetch(base + "/invoices/AP-0001");
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const html = await page.text();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toMatch(/<meta name="csrf" content="[0-9a-f]{64}">/);
    expect((await fetch(base + "/invoices/AP-9999")).status).toBe(404);
    // Every page gets a fresh nonce.
    const again = (await fetch(base + "/")).headers.get("content-security-policy") ?? "";
    expect(again).not.toContain(nonce!);
    const d = await (await fetch(base + "/api/payables/invoices/AP-0001/detail")).json() as { checks: { result: string }[]; timeline: { what: string }[]; total_line: string; actions: { pay: { allowed: boolean } } };
    expect(d.checks.every((c) => c.result === "passed")).toBe(true);
    expect(d.timeline[0]!.what).toBe("Received");
    expect(d.total_line).toMatch(/1,850\.00/);
    expect(d.actions.pay.allowed).toBe(true);
    expect((await fetch(base + "/api/payables/invoices/AP-9999/detail")).status).toBe(404);
  });

  it("ships page scripts that parse (a broken quote in a template would blank the page)", async () => {
    await start(false);
    await upload(await pdfOf(EN), "a.pdf");
    for (const path of ["/", "/invoices/AP-0001", "/transactions"]) {
      const code = /<script type="module" nonce="[^"]+">([\s\S]*?)<\/script>/.exec(await (await fetch(base + path)).text())?.[1] ?? "";
      expect(code.length).toBeGreaterThan(500);
      expect(() => new Script(code)).not.toThrow();
    }
  });

  it("serves the document viewer's script and the font from this page's own origin", async () => {
    await start(false);
    const js = await fetch(base + "/assets/pdfjs.mjs");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    const font = await fetch(base + "/assets/inter.woff2");
    expect(font.headers.get("content-type")).toMatch(/font\/woff2/);
    expect((await fetch(base + "/assets/../package.json")).status).toBe(404);
  });

  it("rejects an invoice only with this page's token and a reason", async () => {
    await start(false);
    await upload(await pdfOf(EN), "a.pdf");
    const reject = async (body: string, t?: string) => raw("/api/payables/invoices/AP-0001/reject", body, { "content-type": "application/json", "x-csrf": t ?? (await token()), origin: base });
    expect((await reject(JSON.stringify({ reason: "ordered twice" }), "bad")).status).toBe(403);
    expect((await reject(JSON.stringify({ reason: " " }))).status).toBe(400);
    const ok = await reject(JSON.stringify({ reason: "ordered twice" }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toMatchObject({ id: "AP-0001", status: "rejected", status_words: "Rejected" });
    expect((await reject(JSON.stringify({ reason: "again" }))).status).toBe(409);
  });

  it("does not echo the asked-for id on an unknown invoice page", async () => {
    await start(false);
    const res = await fetch(base + "/invoices/" + encodeURIComponent("<script>alert(1)</script>"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<script>");
  });

  it("shows the company's inbox address when one is configured, and none when it is not", async () => {
    await start(false, undefined, "northwind@in.purser.test");
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("northwind@in.purser.test");
    expect(html).toMatch(/Mail facturen naar/);
    close();
    await start(false, undefined, "");
    expect(await (await fetch(base + "/")).text()).not.toMatch(/Mail facturen naar/);
    close();
    // Something that is not an address is never shown (it would come from a setting someone typed).
    await start(false, undefined, "<script>x</script>");
    const bad = await (await fetch(base + "/")).text();
    expect(bad).not.toMatch(/Mail facturen naar/);
    expect(bad).not.toContain("<script>x");
  });

  it("limits how often it can be asked: past the limit it answers 429 and reads nothing", async () => {
    await start(false, { windowMs: 60_000, limit: 3 });
    for (let i = 0; i < 3; i++) expect((await fetch(base + "/api/payables/invoices")).status).toBe(200);
    const over = await fetch(base + "/api/payables/invoices");
    expect(over.status).toBe(429);
    expect(await over.text()).not.toMatch(/AP-/);
  });
});

// The hands-on demo's world (src/engine/tryWorld.ts, cloud/src/try/engineRoutes.ts): the sample invoices, the suppliers
// on file and "write your own", through the cloud's routes on the Node engine (the parser reads; test money on a
// simulated bank). Every outcome asserted here is the engine's own answer, measured, never written into the sample.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfOf } from "../src/e2e/documents.js";
import { SAMPLE_SOURCES, samplesFile } from "../src/engine/tryWorld.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

interface Invoice { id: string; status: string; payable: boolean; findings: { code: string; message: string }[] }
interface Upload { kind: string; sha256: string; invoice: Invoice | null }

let c: TestCloud;
beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
});
afterAll(() => c.close());

let n = 0;
async function visitor(): Promise<string> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `198.51.100.${++n}` } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.session as string;
}
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const typed = (o: Record<string, string> = {}) => ({ supplier_key: "bergtex", invoice_no: "BTX-9001", amount: "1234.56", issue_date: day(0), due_date: day(14), iban: "DE89 3704 0044 0532 0130 00", ...o });

describe("the generated samples file", () => {
  it("is up to date with its sources and their PDFs", async () => {
    const pdfs = await Promise.all(SAMPLE_SOURCES.map(async (s) => (await pdfOf(s.text)).toString("base64")));
    expect(readFileSync("cloud/src/engine/samples.gen.ts", "utf8")).toBe(samplesFile(pdfs));
  });
});

describe("the sample tray", () => {
  it("lists five samples, the clean one first, each titled by what the visitor does", async () => {
    const s = await visitor();
    const r = await c.req("GET", "/v1/engine/samples", { key: s });
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([
      { key: "clean", title: "A supplier's invoice", filename: "bergtex-BTX-2026-21.pdf" },
      { key: "again", title: "The same invoice, sent twice", filename: "bergtex-BTX-2026-21.pdf" },
      { key: "renumbered", title: "The same invoice under a new number", filename: "bergtex-BTX-2026-21A.pdf" },
      { key: "bank", title: "An invoice with new bank details", filename: "bergtex-BTX-2026-22.pdf" },
      { key: "unknown", title: "An invoice from a new supplier", filename: "zeeland-ZV-4471.pdf" },
    ]);
    expect((await c.req("POST", "/v1/engine/samples/nope", { key: s })).status).toBe(404);
  });

  it("after the seed, every sample in the tray's order gives the engine's measured answer", async () => {
    const s = await visitor();
    for (const src of SAMPLE_SOURCES) {
      const r = await c.req("POST", `/v1/engine/samples/${src.key}`, { key: s });
      expect(r.status, `${src.key} ${JSON.stringify(r.json)}`).toBe(200);
      const u = r.json as unknown as Upload;
      expect(u.kind, src.key).toBe(src.expect.kind);
      if (src.expect.status) expect(u.invoice?.status, src.key).toBe(src.expect.status);
      if (src.expect.finding) expect(u.invoice?.findings.map((f) => f.code), src.key).toContain(src.expect.finding);
    }
  });

  it("the clean one goes through propose, approve and settle to paid (a company the admin made, which pays at once)", async () => {
    const T = await c.tenant("sample-co");
    const up = await c.req("POST", "/v1/engine/samples/clean", { key: T.session });
    const inv = (up.json as unknown as Upload).invoice!;
    expect(inv).toMatchObject({ status: "ready", payable: true, findings: [] });
    const p = await c.req("POST", `/v1/engine/invoices/${inv.id}/pay`, { key: T.session });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    const proposal = p.json.proposal as { id: string; terms_sha256: string; challenge: string };
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: T.session });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: T.session, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
    const a = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: T.session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json).toMatchObject({ status: "approved", settled: { invoice_status: "paid", error: null } });
  });
});

describe("the suppliers on file", () => {
  it("are the ones the engine's seed recorded, never one made up", async () => {
    const s = await visitor();
    const r = await c.req("GET", "/v1/engine/suppliers", { key: s });
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([
      { key: "bergtex", name: "Bergtex Textil GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
      { key: "stockline", name: "Stockline Data GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001" },
    ]);
  });
});

describe("write your own", () => {
  it("a composed invoice for a supplier on file, with its own IBAN, is ready to pay", async () => {
    const s = await visitor();
    const r = await c.req("POST", "/v1/engine/compose", { key: s, body: typed() });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const u = r.json as unknown as Upload;
    expect(u.kind).toBe("invoice");
    expect(u.invoice).toMatchObject({ status: "ready", payable: true, findings: [] });
    expect(u.invoice).toMatchObject({ vendor: "Bergtex Textil GmbH", invoice_no: "BTX-9001", total: "1234.56", currency: "EUR" });
  });

  it("the same invoice with a changed IBAN gets the engine's changed-bank-details answer", async () => {
    const s = await visitor();
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed() })).status).toBe(200);
    const r = await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ iban: "DE44 5001 0517 5407 3249 31" }) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const inv = (r.json as unknown as Upload).invoice!;
    expect(inv.payable).toBe(false);
    expect(inv.findings.map((f) => f.code)).toContain("possible_fraud");
    expect(inv.findings.find((f) => f.code === "possible_fraud")!.message).toMatch(/…?4931/);
  });

  it("a repeated invoice number gets the engine's duplicate answer", async () => {
    const s = await visitor();
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed() })).status).toBe(200);
    const r = await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ amount: "99.00" }) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const inv = (r.json as unknown as Upload).invoice!;
    expect(inv.payable).toBe(false);
    expect(inv.findings.map((f) => f.code).join(" ")).toMatch(/duplicate/);
    // The very same fields again are the very same file.
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed() })).json.kind).toBe("duplicate_document");
  });

  it("refuses each field that does not fit, naming it, and files nothing", async () => {
    const s = await visitor();
    const cases: [Record<string, string>, string][] = [
      [{ supplier_key: "zeeland" }, "supplier_key"],
      [{ invoice_no: "" }, "invoice_no"], [{ invoice_no: "-BTX" }, "invoice_no"], [{ invoice_no: "BTX 1" }, "invoice_no"], [{ invoice_no: "A".repeat(33) }, "invoice_no"],
      [{ amount: "0.99" }, "amount"], [{ amount: "5000.01" }, "amount"], [{ amount: "12.555" }, "amount"], [{ amount: "1.85.0" }, "amount"], [{ amount: "abc" }, "amount"], [{ amount: "10k" }, "amount"],
      [{ issue_date: "2026-13-01" }, "issue_date"], [{ issue_date: day(-61) }, "issue_date"], [{ due_date: day(61) }, "due_date"], [{ due_date: "tomorrow" }, "due_date"],
      [{ issue_date: day(5), due_date: day(1) }, "due_date"],
      [{ iban: "DE89 3704 0044 0532 0130 01" }, "iban"], [{ iban: "DE89" }, "iban"], [{ iban: "XX".repeat(20) }, "iban"],
    ];
    for (const [o, field] of cases) {
      const r = await c.req("POST", "/v1/engine/compose", { key: s, body: typed(o) });
      expect(r.status, JSON.stringify(o)).toBe(400);
      expect(r.json, JSON.stringify(o)).toMatchObject({ code: `invalid_${field}`, field, message: expect.stringContaining(field) });
    }
    // Shapes the route itself refuses: a field too long, a field more.
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ invoice_no: "A".repeat(10_000) }) })).status).toBe(400);
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: { ...typed(), extra: "x" } })).status).toBe(400);
    expect((await c.req("GET", "/v1/engine/invoices", { key: s })).json.items).toEqual([]);
  });

  it("is for a test company only", async () => {
    const T = await c.tenant("compose-co");
    expect((await c.req("POST", "/v1/engine/compose", { key: T.session, body: typed() })).status).toBe(403);
  });
});

describe("one document cap per company", () => {
  it("refuses the ninth document through compose, through a sample and through upload, in the engine's words", async () => {
    const s = await visitor();
    for (let i = 1; i <= 8; i++) expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ invoice_no: `CAP-${i}`, amount: `${100 + i}.00` }) })).status).toBe(200);
    const viaCompose = await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ invoice_no: "CAP-9", amount: "109.00" }) });
    expect(viaCompose.status).toBe(400);
    expect(viaCompose.json.error).toMatch(/limit of 8; nothing was filed$/);
    expect((await c.req("POST", "/v1/engine/samples/clean", { key: s })).json.error).toMatch(/limit of 8; nothing was filed$/);
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "own_upload", value: "on" } })).status).toBe(200);
    const pdf = (await pdfOf("Not an invoice at all")).toString("base64");
    const viaUpload = await c.req("POST", "/v1/engine/documents", { key: s, body: { filename: "mine.pdf", mime: "application/pdf", base64: pdf } });
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "own_upload", value: "off" } })).status).toBe(200);
    expect(viaUpload.status).toBe(400);
    expect(viaUpload.json.error).toMatch(/limit of 8; nothing was filed$/);
    // A file already held is still the inbox's duplicate, not a ninth document.
    expect((await c.req("POST", "/v1/engine/compose", { key: s, body: typed({ invoice_no: "CAP-1", amount: "101.00" }) })).json.kind).toBe("duplicate_document");
  });

  it("takes PDF files only from a test company, so one e-mail cannot carry twenty documents past the cap", async () => {
    const s = await visitor();
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "own_upload", value: "on" } })).status).toBe(200);
    const eml = Buffer.from("From: a@b.example\r\nTo: c@d.example\r\nSubject: x\r\n\r\nhello").toString("base64");
    const r = await c.req("POST", "/v1/engine/documents", { key: s, body: { filename: "mail.eml", base64: eml } });
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "own_upload", value: "off" } })).status).toBe(200);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/PDF files only; nothing was filed$/);
  });

  it("does not apply to a company the admin made (the engine is unchanged without it)", async () => {
    const T = await c.tenant("no-cap-co");
    for (let i = 1; i <= 9; i++) {
      const pdf = (await pdfOf(`Note ${i}`)).toString("base64");
      expect((await c.req("POST", "/v1/engine/documents", { key: T.session, body: { filename: `n${i}.pdf`, mime: "application/pdf", base64: pdf } })).status).toBe(200);
    }
  });
});

// /try's last step (owner, 14 Nov: the one-line JSON was "ugly and poor"): the company's records as a PDF a person reads
// (src/engine/recordsPdf.ts, GET /v1/engine/export.pdf), and the JSON as a quiet link for developers, pretty-printed with
// a readme first (GET /v1/engine/export). A company is filed, approved with a test passkey and paid on the simulated bank
// through the cloud's routes, then both downloads are read back: the PDF builds, stays small, and says the company's
// name, its figures and its trail, every one of them the export's own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_README } from "../cloud/src/try/engineRoutes.js";
import { COMPANY } from "../cloud/src/tryCopy.js";
import { pdfText } from "../src/ap/pdfText.js";
import { readBy, recordsOf, summaryOf, type CompanyExport } from "../src/engine/recordsPdf.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
let session = "";
let json: CompanyExport & { readme: string };
let jsonText = "";
let pdf: Uint8Array;
let text = "";
let pages = 0;

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  const T = await c.tenant("records-co");
  session = T.session;
  const up = await c.req("POST", "/v1/engine/samples/clean", { key: session });
  const inv = (up.json.invoice as { id: string });
  const p = await c.req("POST", `/v1/engine/invoices/${inv.id}/pay`, { key: session });
  const proposal = p.json.proposal as { id: string; terms_sha256: string; challenge: string };
  const phone = new FakeAuthenticator();
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: session });
  await c.req("POST", "/v1/engine/passkey/finish", { key: session, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
  const a = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: session, body: { terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } });
  expect(a.json).toMatchObject({ status: "approved", settled: { invoice_status: "paid" } });
  const j = await c.req("GET", "/v1/engine/export", { key: session });
  jsonText = await j.res.text();
  json = JSON.parse(jsonText) as typeof json;
  const r = await c.req("GET", "/v1/engine/export.pdf", { key: session });
  expect(r.status).toBe(200);
  expect(r.res.headers.get("content-type")).toBe("application/pdf");
  expect(r.res.headers.get("content-disposition")).toBe('attachment; filename="purser-test-company-records.pdf"');
  pdf = new Uint8Array(await r.res.arrayBuffer());
  ({ text, pages } = await pdfText(pdf));
}, 120_000);
afterAll(() => c.close());

describe("the records as a PDF", () => {
  it("builds, is a PDF, and stays small", () => {
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(3_000);
    expect(pdf.byteLength).toBeLessThan(150_000);
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it("says the company, what it is, and its totals, as the export has them", () => {
    const flat = text.replace(/\s+/g, " ");
    const s = summaryOf(json);
    expect(s).toEqual({ invoices: 1, paid: 1, signed: 1, totals: [{ currency: "EUR", cents: 185000 }] });
    expect(flat.replace(/ /g, "")).toContain("COMPANYRECORDS"); // spaced capitals on the cover
    expect(flat).toContain(json.company);
    expect(flat).toContain("Test company · test money · simulated bank");
    expect(flat).toContain("EUR 1,850.00");
    expect(flat).toMatch(/Total EUR · balanced/);
    expect(flat).not.toMatch(/NOT balanced/);
  });

  it("shows each invoice's trail: read, checked, signed with the passkey (its terms' hash), paid, booked", () => {
    const flat = text.replace(/\s+/g, " ");
    const { invoices, audit } = recordsOf(json);
    const approved = audit.find((a) => a.event === "proposal.approved")!;
    const terms = (JSON.parse(approved.payload_json) as { terms_sha256: string }).terms_sha256;
    expect(flat).toContain(`Read by ${readBy(invoices[0]!.body?.read_by)}`);
    expect(flat).toContain("Checked by Purser's code");
    expect(flat).toContain(`Signed with the passkey · terms ${terms.slice(0, 12)}`);
    expect(flat).toMatch(/Paid on the simulated bank: EUR 1,850\.00, fee EUR \d+\.\d{2}/);
    expect(flat).toMatch(/Booked in the ledger: entries #\d+/);
  });

  it("has the journal, the audit log and the appendix with every document's full SHA-256", () => {
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("Journal");
    expect(flat).toContain("Audit log");
    expect(flat).toContain("The CFO signed the exact terms with the passkey");
    for (const d of recordsOf(json).documents) expect(flat.replace(/ /g, "")).toContain(d.sha256);
  });

  it("puts the footer on every page: page x of y, made-up data, and where the demo lives", () => {
    const flat = text.replace(/\s+/g, " ");
    for (let i = 1; i <= pages; i++) expect(flat).toContain(`Page ${i} of ${pages}`);
    expect(flat.split("Made-up data · test money · nothing real moved").length - 1).toBe(pages);
    expect(flat).toContain(`${ORIGIN}/try`);
  });
});

describe("the records as JSON, for developers", () => {
  it("is pretty-printed with two spaces and starts with a readme that says what the file is", () => {
    expect(jsonText.startsWith(`{\n  "readme": ${JSON.stringify(EXPORT_README)},\n  "format": "purser.cloud-sync/v1",`)).toBe(true);
    expect(json.readme).toMatch(/purser\.cloud-sync\/v1/);
    expect(json.readme).toMatch(/nothing real moved/);
    expect(jsonText.endsWith("}\n")).toBe(true);
  });

  it("the page offers it as a quiet link under the PDF's button", () => {
    expect(COMPANY.json).toBe("Download as JSON (for developers)");
  });
});

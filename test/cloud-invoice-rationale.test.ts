// "Why it was paid this way" in Purser Cloud (26 Nov): the runner's invoice page shows the payment's rationale record
// (src/payouts/rationale.ts, audited as payment.rationale), and the record reaches the cloud with the audit log, but the
// console showed none of it. Now GET /v1/invoices/{id} carries the newest payment.rationale of the invoice's payment as
// stored (no value written by the cloud), and the console's invoice page words it with the runner's own sentences
// (src/servers/rationaleWords.ts). Test money: the engine pays on its stand-in bank; no network.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { RATIONALE_WORDS_JS } from "../src/servers/rationaleWords.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

describe("the payment's rationale on Purser Cloud's invoice", () => {
  let c: TestCloud, A: TestTenant;
  const phone = new FakeAuthenticator("platform");
  beforeAll(async () => {
    c = testCloud({ engine: true });
    A = await c.tenant("northwind");
    const start = await c.req("POST", "/v1/engine/passkey/start", { key: A.session });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: start.json.code, credential: phone.register({ challenge: start.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
  });
  afterAll(() => c.close());

  it("GET /v1/invoices/{id} carries none before the payment, and the record as stored once it is paid", async () => {
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } })).status).toBe(200);
    expect((await c.req("POST", "/v1/engine/sync", { key: A.session })).status).toBe(200);
    const before = await c.req("GET", "/v1/invoices/AP-0001", { key: A.session });
    expect(before.status).toBe(200);
    expect(before.json.rationale).toBeNull();
    const p = (await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session })).json.proposal as { id: string; terms_sha256: string; challenge: string };
    const ok = await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: A.session, body: { terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } });
    expect(ok.json).toMatchObject({ status: "approved" });
    const inv = (await c.req("GET", "/v1/invoices/AP-0001", { key: A.session })).json;
    expect(inv.status).toBe("paid");
    expect(inv.rationale).toMatchObject({ proposal_id: p.id, outcome: "executed", amount: "1850.00", currency: "EUR", approval: { decision: "APPROVED", method: "passkey", terms_sha256: p.terms_sha256 } });
    // Worded with the runner's own sentences.
    const words = new Function(`${RATIONALE_WORDS_JS}; return rationaleWords;`)() as (r: unknown) => { funding: string; approval: string };
    expect(words(inv.rationale).approval).toMatch(/approved the exact terms \(hash [0-9a-f]{8}\) by passkey \(Face ID\)$/);
  });

  it("the console's invoice page draws it, with the runner's words and labels", () => {
    const page = consolePage("bg==", { origin: ORIGIN, rpId: RP, mailDomain: "in.cloud.test", engine: true });
    expect(page).toContain(RATIONALE_WORDS_JS);
    expect(page).toContain("whyCard(i)");
  });
});

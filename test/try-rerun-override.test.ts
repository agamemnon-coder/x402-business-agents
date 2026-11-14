// A second run in the same test company, and the sandbox override of a hold (14 Nov, owner: "with the sandbox you should
// always be able to override and try it again"): the clean sample filed again is a fresh invoice that reaches Paid; a
// possible duplicate by the same total is cleared by the inbox's own person's path and then still needs the passkey's
// signature over the exact terms, which a one-cent change still breaks; other holds can only be rejected. Test money,
// a simulated bank, the Node engine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

interface Inv { id: string; status: string; invoice_no: string; total: string; findings: { code: string; twin_of?: string }[] }
let c: TestCloud;
let s: string;
const phone = new FakeAuthenticator();
let counter = 0;

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
  s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "203.0.113.90" } })).json.session as string;
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
  await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
});
afterAll(() => c.close());

/** Pay an invoice as the page does: propose, sign the exact terms, pay with the stored terms (or changed ones). */
async function payIt(id: string, change?: (t: Record<string, string>) => Record<string, string>) {
  const p = await c.req("POST", `/v1/engine/invoices/${id}/pay`, { key: s });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  const proposal = p.json.proposal as { id: string; challenge: string; terms_sha256: string };
  const credential = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
  expect((await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential } })).json).toMatchObject({ held: true });
  const terms = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json.terms as Record<string, string>;
  return (await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: change ? change(terms) : terms, credential } })).json;
}

describe("the clean sample, run again in the same company", () => {
  it("is a fresh invoice each time, never held by the visitor's own earlier run, and reaches Paid", async () => {
    const seen: Inv[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await c.req("POST", "/v1/engine/samples/clean", { key: s });
      expect(r.json.kind, JSON.stringify(r.json)).toBe("invoice");
      const inv = r.json.invoice as Inv;
      expect(inv.status, JSON.stringify(inv.findings)).toBe("ready");
      seen.push(inv);
      expect(await payIt(inv.id)).toMatchObject({ outcome: "paid" });
    }
    expect(seen.map((x) => x.invoice_no)).toEqual(["BTX-2026-21", "BTX-2026-31"]);
    expect(seen.map((x) => x.total)).toEqual(["1850.00", "1862.50"]);
    // A third is fresh too (filed, not paid here: the simulated bank holds a USD floor that allows a few payments a company).
    const third = (await c.req("POST", "/v1/engine/samples/clean", { key: s })).json.invoice as Inv;
    expect([third.invoice_no, third.total, third.status]).toEqual(["BTX-2026-32", "1875.00", "ready"]);
  });
  it("keeps the deliberate duplicate a choice: the paid original's own file is still the same file", async () => {
    expect((await c.req("POST", "/v1/engine/samples/again", { key: s })).json.kind).toBe("duplicate_document");
  });
});

describe("the sandbox override of a hold", () => {
  let held: Inv;
  it("clears a possible duplicate by the same total, then the passkey still signs the exact terms; a cent changed is still refused", async () => {
    // The visitor's own invoice from the same supplier for the same total as one paid earlier: held as a possible duplicate.
    const sup = ((await c.req("GET", "/v1/engine/suppliers", { key: s })).json.items as { key: string; iban: string }[])[0]!;
    const day = c.clock.now.toISOString().slice(0, 10);
    const r = await c.req("POST", "/v1/engine/compose", { key: s, body: { supplier_key: sup.key, invoice_no: "INV-8807", amount: "1850.00", issue_date: day, due_date: day, iban: sup.iban } });
    held = r.json.invoice as Inv;
    expect(held.status).toBe("needs_review");
    expect(held.findings.some((f) => f.code === "possible_duplicate" && f.twin_of)).toBe(true);
    expect((await c.req("POST", `/v1/engine/invoices/${held.id}/pay`, { key: s })).status).toBe(409);
    const cleared = await c.req("POST", `/v1/engine/invoices/${held.id}/clear`, { key: s });
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
    expect((cleared.json.invoice as Inv).status).toBe("ready");
    const tampered = await payIt(held.id, (t) => ({ ...t, amount: (Number(t.amount) - 0.01).toFixed(2) }));
    expect(tampered).toMatchObject({ outcome: "refused" });
  });
  it("never clears another kind of hold: new bank details can only be rejected, and Reject pays nothing", async () => {
    const bank = (await c.req("POST", "/v1/engine/samples/bank", { key: s })).json.invoice as Inv;
    expect(bank.status).toBe("blocked");
    const no = await c.req("POST", `/v1/engine/invoices/${bank.id}/clear`, { key: s });
    expect(no.status).toBe(409);
    const rej = await c.req("POST", `/v1/engine/invoices/${bank.id}/reject`, { key: s });
    expect(rej.status, JSON.stringify(rej.json)).toBe(200);
    expect((rej.json.invoice as Inv).status).toBe("rejected");
    expect((await c.req("POST", `/v1/engine/invoices/${bank.id}/pay`, { key: s })).status).toBe(409);
  });
  it("is only a test company's", async () => {
    const t = await c.tenant("someone");
    expect((await c.req("POST", `/v1/engine/invoices/${held.id}/clear`, { key: t.session })).status).toBe(404);
  });
});

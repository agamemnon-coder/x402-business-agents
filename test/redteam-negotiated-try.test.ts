// Red team, round 2 on v1.5.3 (finding D): on /try's engine path a negotiated bill was paid twice. The seeded scene was
// negotiated, its agreed invoice BTX-2026-25-<sha8> filed and paid (EUR 1,813.00); then the bill as issued, BTX-2026-25 at
// EUR 1,850.00, was composed, filed "ready" and paid again. Pay (src/ap/pay.ts) never carried the negotiation in the
// terms, so no ledger guard linked the two numbers, and the inbox's checks never asked. Now Pay signs the ap.negotiated
// facts into the terms (terms.negotiation), and the inbox sends an invoice whose number is the original of a negotiated
// invoice from the same supplier to a person (negotiated_before), never paid alone or filed ready. Also the other order:
// the bill as issued paid first, its agreed invoice filed afterwards is not paid. The cloud with a Node engine, a
// stand-in bank and a stand-in for Claude; test money only, no network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { negotiateClaudeOf } from "../cloud/src/try/negotiateRoutes.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
const d = (n: number) => new Date(Date.parse("2026-11-08T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const fakeClaude = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ message: "Agreed.", amount: "1813.00", pay_by: d(7), iban: "", accept: true }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })) as typeof fetch;

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  c.env.negotiateClaude = negotiateClaudeOf(c.env.sql, "on", "not-a-real-key", fakeClaude);
  for (const [k, v] of [["starts", "on"], ["claude", "on"], ["cap_action_micros", 50_000], ["cap_company_micros", 200_000], ["cap_addr_micros", 300_000], ["cap_day_micros_public", 1_000_000], ["cap_all_micros", 2_000_000], ["max_inflight", 5]] as const)
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: k, value: String(v) } })).status).toBe(200);
});
afterAll(() => c.close());

let ip = 0;
async function company() {
  const s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `198.51.100.${++ip}` } })).json.session as string;
  const phone = new FakeAuthenticator();
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
  expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
  let counter = 0;
  /** Pay: propose, sign and pay the signed terms; the outcome, or why it was refused. */
  const pay = async (invId: string): Promise<{ outcome: string; terms?: Record<string, unknown>; why?: string }> => {
    const p = await c.req("POST", `/v1/engine/invoices/${invId}/pay`, { key: s });
    if (p.status !== 200) return { outcome: "refused", why: JSON.stringify(p.json) };
    const proposal = p.json.proposal as { id: string; challenge: string; terms_sha256: string };
    const t = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json as { terms: Record<string, unknown> };
    const cred = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
    await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: cred } });
    const good = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: t.terms, credential: cred } });
    return { outcome: String(good.json.outcome), terms: t.terms, why: JSON.stringify(good.json).slice(0, 300) };
  };
  const negotiate = async () => (await c.req("POST", "/v1/try/negotiate", { key: s })).json as { sha256: string; turns: { offer: unknown; signature: unknown }[]; compose: Record<string, string>; agreement: unknown; keys: unknown };
  const agreed = (n: Awaited<ReturnType<typeof negotiate>>) => c.req("POST", "/v1/try/negotiate/agreed", { key: s, body: { agreement: n.agreement, keys: n.keys, offers: n.turns.map((t) => ({ offer: t.offer, signature: t.signature })), agreement_sha256: n.sha256, turns: n.turns.length, compose: n.compose } });
  const compose = (body: Record<string, string>) => c.req("POST", "/v1/engine/compose", { key: s, body });
  return { pay, negotiate, agreed, compose };
}

describe("a negotiated bill is paid once on /try's engine (red team round 2, finding D)", () => {
  it("the agreed invoice paid carries the negotiation in its signed terms; the bill as issued goes to a person and is not paid", async () => {
    const w = await company();
    const n = await w.negotiate();
    const original = n.compose.invoice_no!.replace(/-[0-9a-f]{8}$/, "");
    const ok = await w.agreed(n);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const first = await w.pay((ok.json.invoice as { id: string }).id);
    expect(first.outcome, first.why).toBe("paid");
    expect(first.terms!.negotiation).toMatchObject({ agreement_sha256: n.sha256, original_invoice_no: original, original_amount: "1850.00", agreed_amount: "1813.00", discount: "37.00" });

    const again = await w.compose({ ...n.compose, invoice_no: original, amount: "1850.00" });
    const inv = again.json.invoice as { id: string; status: string; findings: { code: string; level: string }[] };
    // The ledger now knows the agreed payout pays this bill: a second copy, blocked.
    expect(inv.status).toBe("blocked");
    expect(inv.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate", level: "block" })]));
    expect((await w.pay(inv.id)).outcome).not.toBe("paid");
  }, 120_000);

  it("the agreed invoice filed but not yet paid: the bill as issued goes to a person (negotiated_before), and only the agreed one is paid", async () => {
    const w = await company();
    const n = await w.negotiate();
    const original = n.compose.invoice_no!.replace(/-[0-9a-f]{8}$/, "");
    const ok = await w.agreed(n);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const again = await w.compose({ ...n.compose, invoice_no: original, amount: "1850.00" });
    const inv = again.json.invoice as { id: string; status: string; findings: { code: string; level: string }[] };
    expect(inv.status).toBe("needs_review");
    expect(inv.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "negotiated_before", level: "review" })]));
    expect((await w.pay(inv.id)).outcome).toBe("refused");
    expect((await w.pay((ok.json.invoice as { id: string }).id)).outcome).toBe("paid");
  }, 120_000);

  it("the other order: the bill as issued paid, its agreed invoice is not paid again", async () => {
    const w = await company();
    const n = await w.negotiate();
    const original = n.compose.invoice_no!.replace(/-[0-9a-f]{8}$/, "");
    const filed = await w.compose({ ...n.compose, invoice_no: original, amount: "1850.00" });
    const inv = filed.json.invoice as { id: string; status: string };
    expect(inv.status).toBe("ready");
    expect((await w.pay(inv.id)).outcome).toBe("paid");
    const ok = await w.agreed(n);
    if (ok.status === 200) expect((await w.pay((ok.json.invoice as { id: string }).id)).outcome).not.toBe("paid");
    else expect(ok.status).toBe(409);
  }, 120_000);
});

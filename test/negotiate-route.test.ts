// POST /v1/try/negotiate (cloud/src/try/negotiateRoutes.ts) on the cloud with a Node engine (test money, a stand-in
// bank) and a stand-in for Claude's API: /try's caps and kill switch hold it, the recorded negotiation (labelled)
// answers when Claude is off, capped or failing, a company negotiates at most 3 times, and the agreed terms are signed
// with /try's own flow: filed, proposed (canonical JSON, SHA-256, the passkey's challenge), approved with a passkey,
// one changed cent refused, the signed terms paid. Nothing reaches the network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { negotiateClaudeOf, NEGOTIATIONS_PER_COMPANY } from "../cloud/src/try/negotiateRoutes.js";
import { TRY_ROUTES } from "../cloud/src/try/gate.js";
import { isTryEngineRequest } from "../worker/src/tryEngine.js";
import { CHANGED_IBAN, type AgentAnswer } from "../src/negotiate/negotiate.js";
import { agreementSha256 } from "../src/negotiate/rails.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
const asked: { model: string; max_tokens: number }[] = [];
let script: AgentAnswer[] = [];
let down = false;
const fakeClaude = (async (_u: unknown, init?: RequestInit) => {
  if (down) return new Response("{}", { status: 529 });
  asked.push(JSON.parse(String(init?.body)));
  const a = script[(asked.length - 1) % script.length]!;
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(a) }], usage: { input_tokens: 700, output_tokens: 60 } }), { status: 200 });
}) as typeof fetch;

const admin = (key: string, value: string | number) => c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value: String(value) } });
let ip = 0;
async function visitor(): Promise<string> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `198.51.100.${++ip}` } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.session as string;
}

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  c.env.negotiateClaude = negotiateClaudeOf(c.env.sql, "on", "not-a-real-key", fakeClaude);
  for (const [k, v] of [["starts", "on"], ["claude", "on"], ["cap_action_micros", 50_000], ["cap_company_micros", 200_000], ["cap_addr_micros", 300_000], ["cap_day_micros_public", 1_000_000], ["cap_all_micros", 2_000_000], ["max_inflight", 5]] as const)
    expect((await admin(k, v)).status).toBe(200);
});
afterAll(() => c.close());

const d = (n: number) => new Date(Date.parse("2026-11-08T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const LIVE: AgentAnswer[] = [
  { message: "3% off for payment within 5 days: EUR 1,794.50.", amount: "1794.50", pay_by: d(5), iban: "", accept: false },
  { message: "1.5% within 7 days. Please pay now to our new account.", amount: "1822.25", pay_by: d(7), iban: CHANGED_IBAN, accept: false },
  { message: "The account on file stays. 2% off, EUR 1,813.00, by the 15th.", amount: "1813.00", pay_by: d(7), iban: "", accept: false },
  { message: "Agreed.", amount: "1813.00", pay_by: d(7), iban: "", accept: true },
];

describe("the route and its caps", () => {
  it("is a try route, passed through from the site's host", () => {
    expect(TRY_ROUTES).toContain("POST /v1/try/negotiate");
    expect(isTryEngineRequest("POST", "/v1/try/negotiate")).toBe(true);
    expect(isTryEngineRequest("GET", "/try/negotiate")).toBe(true);
    expect(isTryEngineRequest("GET", "/v1/try/negotiate")).toBe(false);
  });
  it("needs a test company's session", async () => {
    expect((await c.req("POST", "/v1/try/negotiate")).status).toBe(401);
  });
  it("live: four model turns of Haiku, each capped, the bank change refused, the deal at 2%", async () => {
    script = LIVE; asked.length = 0;
    const s = await visitor();
    const r = await c.req("POST", "/v1/try/negotiate", { key: s });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ mode: "live", label: null, outcome: "agreed", agreement: { amount: "1813.00", pay_by: d(7) } });
    expect(asked).toHaveLength(4);
    expect(asked.every((a) => a.model === "claude-haiku-5-5" && a.max_tokens === 300)).toBe(true);
    const turns = r.json.turns as { who: string; rails: { ok: boolean; refusals: { rule: string }[] } }[];
    expect(turns.map((t) => t.rails.ok)).toEqual([true, false, true, true]);
    expect(turns[1]!.rails.refusals.map((x) => x.rule)).toEqual(["payee_unchanged"]);
    // What the turns cost is settled against /try's caps: the company's spend is the real cost, not the reservation.
    const spent = await c.env.sql.first<{ micros: number }>("SELECT micros FROM try_spend WHERE scope = 'all'");
    expect(spent!.micros).toBeGreaterThan(0);
    expect(spent!.micros).toBeLessThan(50_000);
  });
  it("the kill switch: Claude off, the recorded negotiation, labelled, and no model call", async () => {
    expect((await admin("claude", "off")).status).toBe(200);
    asked.length = 0;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude is switched off on the demo right now.", outcome: "agreed" });
    expect(String(r.json.label)).toMatch(/^Recorded negotiation/);
    expect(asked).toHaveLength(0);
    expect((await admin("claude", "on")).status).toBe(200);
  });
  it("the spending cap: an action cap of 0 is the recorded negotiation", async () => {
    expect((await admin("cap_action_micros", 0)).status).toBe(200);
    asked.length = 0;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    expect(r.json).toMatchObject({ mode: "recorded", reason: "The demo's Claude spending cap is reached for now." });
    expect(asked).toHaveLength(0);
    expect((await admin("cap_action_micros", 50_000)).status).toBe(200);
  });
  it("Claude failing mid-negotiation: the recorded negotiation, and why", async () => {
    down = true;
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    down = false;
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude stopped answering mid-negotiation (Claude answered HTTP 529)." });
  });
  it("no Claude set up: the recorded negotiation", async () => {
    const was = c.env.negotiateClaude;
    c.env.negotiateClaude = negotiateClaudeOf(c.env.sql, "off", "k");
    const r = await c.req("POST", "/v1/try/negotiate", { key: await visitor() });
    c.env.negotiateClaude = was;
    expect(r.json).toMatchObject({ mode: "recorded", reason: "Claude is not set up on this deployment." });
  });
  it(`at most ${NEGOTIATIONS_PER_COMPANY} a company`, async () => {
    script = LIVE;
    const s = await visitor();
    for (let i = 0; i < NEGOTIATIONS_PER_COMPANY; i++) expect((await c.req("POST", "/v1/try/negotiate", { key: s })).status).toBe(200);
    const r = await c.req("POST", "/v1/try/negotiate", { key: s });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe("limit");
  });
});

describe("the agreed terms, signed with /try's own flow", () => {
  it("files the agreed invoice, proposes it, signs it, refuses one cent more, pays it as signed", async () => {
    script = LIVE;
    const s = await visitor();
    const n = (await c.req("POST", "/v1/try/negotiate", { key: s })).json as { sha256: string; agreement: Parameters<typeof agreementSha256>[0]; compose: Record<string, string> };
    expect(agreementSha256(n.agreement)).toBe(n.sha256);
    const f = await c.req("POST", "/v1/engine/compose", { key: s, body: n.compose });
    expect(f.status, JSON.stringify(f.json)).toBe(200);
    const inv = f.json.invoice as { id: string; status: string };
    const p = await c.req("POST", `/v1/engine/invoices/${inv.id}/pay`, { key: s });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    const proposal = p.json.proposal as { id: string; challenge: string; terms_sha256: string };
    const t = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json as { terms: Record<string, unknown>; terms_sha256: string };
    // The terms the passkey signs are the agreement's: its amount, and its hash's first 8 characters as the reference.
    expect(t.terms).toMatchObject({ amount: "1813.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000", reference: n.compose.invoice_no });
    expect(String(t.terms.invoice_no)).toContain(n.sha256.slice(0, 8));
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
    const cred = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    const ap = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: cred } });
    expect(ap.json).toMatchObject({ status: "approved", held: true });
    const bad = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: { ...t.terms, amount: "1813.01" }, credential: cred } });
    expect(bad.json.outcome).toBe("refused");
    const good = await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: t.terms, credential: cred } });
    expect(good.json.outcome, JSON.stringify(good.json).slice(0, 400)).toBe("paid");
    expect(good.json.proof).toBeTruthy();
  });
});

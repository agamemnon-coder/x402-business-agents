// The hands-on demo's attack surface as tests (C5): tenancy, the pay route under parallel requests, limits under
// parallel requests, bodies, and the admin route. Each hole found is fixed in the module that owns it. On the Node
// engine (test money on a simulated bank), with software authenticators; nothing reaches the network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { TRY_ROUTES } from "../cloud/src/try/gate.js";
import { termsHash, type Terms } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

interface Proposal { id: string; terms_sha256: string; challenge: string }
interface Visitor { s: string; tenant: string; visitor_token: string; phone: FakeAuthenticator; proposal: Proposal; approval: unknown; signed: Record<string, unknown> }

let c: TestCloud;
const admin = (body: Record<string, unknown>, key: string | null = ADMIN_TOKEN, headers: Record<string, string> = {}) => c.req("POST", "/v1/try/admin", { key, body, headers });
const set = async (key: string, value: string | number) => expect((await admin({ op: "set", key, value })).status).toBe(200);
beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  await set("starts", "on");
  await set("starts_per_address_hour", 50);
});
afterAll(() => c.close());

let n = 0;
const ip = () => `198.18.${Math.floor(++n / 250)}.${n % 250}`;
/** A visitor's company with the clean sample filed, the passkey set up and the approval held. */
async function visitor(): Promise<Visitor> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": ip() } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  const s = r.json.session as string;
  const up = await c.req("POST", "/v1/engine/samples/clean", { key: s });
  const phone = new FakeAuthenticator();
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
  await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
  const p = await c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: s });
  const proposal = p.json.proposal as Proposal;
  const approval = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
  const a = await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: approval } });
  expect(a.json.held, JSON.stringify(a.json)).toBe(true);
  const signed = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json.terms as Record<string, unknown>;
  return { s, tenant: r.json.tenant as string, visitor_token: r.json.visitor_token as string, phone, proposal, approval, signed };
}
const pay = (v: Visitor, t: Record<string, unknown>, credential: unknown = v.approval, id = v.proposal.id, key = v.s) =>
  c.req("POST", `/v1/engine/proposals/${id}/pay`, { key, body: { terms: t, credential } });
const transfers = async (v: Visitor) => ((await c.req("GET", "/v1/payments", { key: v.s })).json.items as unknown[]).length;

describe("the pay route under parallel requests", () => {
  it("20 parallel pays with changed terms make no transfer and leave the stored terms as signed", async () => {
    const v = await visitor();
    const before = (await c.req("GET", `/v1/engine/proposals/${v.proposal.id}/terms`, { key: v.s })).json.canonical;
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => pay(v, { ...v.signed, amount: `${1851 + i}.00` })));
    for (const r of out) expect(r.json.outcome, JSON.stringify(r.json)).toBe("refused");
    expect(await transfers(v)).toBe(0);
    const after = (await c.req("GET", `/v1/engine/proposals/${v.proposal.id}/terms`, { key: v.s })).json;
    expect(after.canonical).toBe(before);
    expect(after.status).toBe("APPROVED");
  });

  it("20 parallel pays with the signed terms make exactly one transfer; the rest answer paid_once", async () => {
    const v = await visitor();
    const out = await Promise.all(Array.from({ length: 20 }, () => pay(v, v.signed)));
    const outcomes = out.map((r) => r.json.outcome as string);
    expect(outcomes.filter((o) => o === "paid")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "paid_once")).toHaveLength(19);
    expect(await transfers(v)).toBe(1);
  });

  it("approve with a fresh signature over edited terms is refused: the challenge is the stored terms' hash", async () => {
    const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": ip() } });
    const s = r.json.session as string;
    const up = await c.req("POST", "/v1/engine/samples/clean", { key: s });
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    const p = (await c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: s })).json.proposal as Proposal;
    const t = (await c.req("GET", `/v1/engine/proposals/${p.id}/terms`, { key: s })).json.terms as Record<string, unknown>;
    const edited = termsHash({ ...t, amount: "1.00" } as unknown as Terms);
    const forEdited = phone.sign({ challenge: challengeFor(edited), origin: ORIGIN, rpId: RP, counter: 1 });
    // Sent with the edited hash: refused before the signature is read. Sent with the stored hash: the signature does not fit.
    expect((await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: s, body: { terms_sha256: edited, credential: forEdited } })).json.status).toBe("refused");
    expect((await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: s, body: { terms_sha256: p.terms_sha256, credential: forEdited } })).json.status).toBe("refused");
    expect((await c.req("GET", `/v1/engine/proposals/${p.id}/terms`, { key: s })).json.approved).toBe(false);
  });
});

describe("tenancy", () => {
  let A: Visitor;
  let B: Visitor;
  beforeAll(async () => { A = await visitor(); B = await visitor(); });

  it("a replayed approval signature is refused on another proposal and in another company", async () => {
    // B's own approval sent to A's company with A's session: A's passkey did not make it.
    expect((await pay(A, A.signed, B.approval)).json).toMatchObject({ outcome: "refused", layers: { signature: { verified: false } } });
    // A's approval, sent by B on B's proposal: B's passkey did not make it either.
    expect((await pay(B, B.signed, A.approval)).json).toMatchObject({ outcome: "refused", layers: { signature: { verified: false } } });
    expect(await transfers(A)).toBe(0);
    expect(await transfers(B)).toBe(0);
  });

  it("another company's visitor token renews nothing", async () => {
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: B.visitor_token } })).status).toBe(401);
  });

  it("a try session reaches only its own company on every engine route, and is refused outside the try list", async () => {
    for (const r of ROUTES) {
      // Signing out would end the session the walk uses: it is in the list, and tested elsewhere.
      if (r.need === "public" || r.need === "platform" || r.path === "/v1/auth/logout") continue;
      const path = r.path.replace("{id}", "P-0001").replace("{key}", "clean").replace(/\{\w+\}/g, "x");
      const res = await c.req(r.method, path, { key: A.s, ...(r.method === "POST" ? { body: {} } : {}) });
      const listed = TRY_ROUTES.includes(`${r.method} ${r.path}`);
      if (!listed) {
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
        expect(res.json.code, `${r.method} ${r.path}`).toBe("try_only");
      }
      expect(JSON.stringify(res.json), `${r.method} ${r.path}`).not.toContain(B.tenant);
    }
  });
});

describe("limits under parallel requests", () => {
  it("20 parallel starts against starts_per_day_public = 3 admit exactly 3", async () => {
    const d = testCloud({ engine: true, tryIt: {} });
    try {
      for (const [key, value] of [["starts", "on"], ["starts_per_day_public", "3"], ["starts_per_address_hour", "50"]]) {
        expect((await d.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } })).status).toBe(200);
      }
      const out = await Promise.all(Array.from({ length: 20 }, (_, i) => d.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `192.0.2.${i + 1}` } })));
      expect(out.filter((r) => r.status === 201)).toHaveLength(3);
      expect(out.filter((r) => r.status === 429)).toHaveLength(17);
    } finally { d.close(); }
  });

  it("one /64 cannot pass the address limit by changing its last 64 bits", async () => {
    const d = testCloud({ engine: true, tryIt: {} });
    try {
      for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", "2"]]) await d.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } });
      const hosts = ["2001:db8:aa:bb::1", "2001:db8:aa:bb:1::1", "2001:db8:aa:bb:ffff:ffff:ffff:fffe", "2001:DB8:AA:BB:0:0:0:9", "2001:0db8:00aa:00bb::7", "[2001:db8:aa:bb::8]"];
      const out = [];
      for (const h of hosts) out.push((await d.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": h } })).status);
      expect(out).toEqual([201, 201, 429, 429, 429, 429]);
    } finally { d.close(); }
  });

  it("20 expired-session polls from one address do not block a second visitor at that address", async () => {
    const v = await visitor();
    const w = await visitor();
    const at = { "cf-connecting-ip": "198.51.100.200" };
    const old = v.s;
    c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
    const polls = await Promise.all(Array.from({ length: 20 }, () => c.req("GET", "/v1/engine/events", { key: old, headers: at })));
    for (const p of polls) expect(p.status).toBe(401);
    const fresh = await c.req("POST", "/v1/try/session", { body: { tenant_id: w.tenant, visitor_token: w.visitor_token }, headers: at });
    expect(fresh.status).toBe(200);
    expect((await c.req("GET", "/v1/engine/events", { key: fresh.json.session as string, headers: at })).status).toBe(200);
  });
});

describe("the admin route", () => {
  it("answers the right token after a parallel flood of 100 wrong ones from one address", async () => {
    const at = { "cf-connecting-ip": "198.51.100.201" };
    const flood = await Promise.all(Array.from({ length: 100 }, (_, i) => admin({ op: "get" }, `wrong-${i}`, at)));
    for (const r of flood) expect(r.status).toBe(401);
    expect((await admin({ op: "get" }, ADMIN_TOKEN, at)).status).toBe(200);
  });
});

describe("bodies and origins", () => {
  const OMIT = { origin: "null-omit" };
  const CROSS = { origin: "https://evil.example" };

  it("refuses a body one byte over each cap", async () => {
    const v = await visitor();
    /** A JSON body of exactly `bytes` bytes: one string field padded to fit. */
    const sized = (field: string, bytes: number) => { const shell = JSON.stringify({ [field]: "" }).length; return JSON.stringify({ [field]: "x".repeat(bytes - shell) }); };
    const cases: [string, string, number, string | null, string][] = [
      ["POST", "/v1/try/start", 2_000, null, "token"],
      ["POST", "/v1/try/session", 2_000, null, "tenant_id"],
      ["POST", "/v1/try/admin", 8_000, ADMIN_TOKEN, "op"],
      ["POST", "/v1/engine/compose", 4_000, v.s, "invoice_no"],
      ["POST", `/v1/engine/proposals/${v.proposal.id}/pay`, 8_000, v.s, "terms"],
    ];
    for (const [m, p, cap, key, field] of cases) {
      const r = await c.req(m, p, { key, raw: sized(field, cap + 1), headers: { "cf-connecting-ip": ip() } });
      expect(r.status, p).toBe(400);
      expect(r.json.error, p).toBe(`the body is larger than ${cap} bytes`);
    }
  });

  it("refuses a cross-site Origin on every POST of the demo, and a missing one on the start, the renewal and a test company's writes", async () => {
    const v = await visitor();
    const posts = ROUTES.filter((r) => r.method === "POST" && TRY_ROUTES.includes(`POST ${r.path}`)).map((r) => r.path.replace("{id}", v.proposal.id).replace("{key}", "clean"));
    for (const p of [...posts, "/v1/try/start", "/v1/try/session", "/v1/try/admin"]) {
      const cross = await c.req("POST", p, { key: p === "/v1/try/admin" ? ADMIN_TOKEN : v.s, body: {}, headers: CROSS });
      expect(cross.status, p).toBe(403);
    }
    for (const p of [...posts, "/v1/try/start", "/v1/try/session"]) {
      const none = await c.req("POST", p, { key: v.s, body: {}, headers: OMIT });
      expect(none.status, p).toBe(403);
    }
    // The admin's tool is a program with the platform token: it sends no Origin.
    expect((await admin({ op: "get" }, ADMIN_TOKEN, OMIT)).status).toBe(200);
    // Nothing moved.
    expect(await transfers(v)).toBe(0);
  });

  it("refuses a composed invoice with control characters, a 10,000-character field or an IBAN with a bad check digit", async () => {
    const v = await visitor();
    const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
    const base = { supplier_key: "bergtex", invoice_no: "RT-1", amount: "100.00", issue_date: day(0), due_date: day(10), iban: "DE89370400440532013000" };
    for (const o of [{ invoice_no: "RT\u00001" }, { invoice_no: "RT-1\n" }, { supplier_key: "bergtex\u0007" }, { iban: "DE89370400440532013000\u0000" }, { amount: "100.00‮" },
      { invoice_no: "x".repeat(10_000) }, { iban: "DE88370400440532013000" }]) {
      const r = await c.req("POST", "/v1/engine/compose", { key: v.s, body: { ...base, ...o } });
      expect(r.status, JSON.stringify(o).slice(0, 60)).toBe(400);
    }
    // One invoice so far: the clean sample.
    expect(((await c.req("GET", "/v1/engine/invoices", { key: v.s })).json.items as unknown[]).length).toBe(1);
  });
});

describe("Claude's spend under 20 parallel actions (lane A's ledger, cloud/src/engine/spend.ts)", () => {
  it("never reserves past a company, address, pool-day or all-time cap", async () => {
    const { d1Spend } = await import("../cloud/src/engine/spend.js");
    const caps = { claude: "on", cap_action_micros: "100000", max_inflight: "20" };
    const scenarios: [Record<string, string>, { tenantId: string; pool: string; address: string | null }, number][] = [
      [{ cap_company_micros: "300000", cap_addr_micros: "3000000", cap_day_micros_public: "30000000", cap_all_micros: "78000000" }, { tenantId: "t_try_a", pool: "public", address: "h1" }, 3],
      [{ cap_company_micros: "1000000", cap_addr_micros: "400000", cap_day_micros_public: "30000000", cap_all_micros: "78000000" }, { tenantId: "t_try_b", pool: "public", address: "h2" }, 4],
      [{ cap_company_micros: "1000000", cap_day_micros_jury: "500000", cap_all_micros: "78000000" }, { tenantId: "t_try_c", pool: "jury", address: null }, 5],
      [{ cap_company_micros: "1000000", cap_day_micros_event: "30000000", cap_all_micros: "200000" }, { tenantId: "t_try_d", pool: "event", address: null }, 2],
    ];
    for (const [more, who, expected] of scenarios) {
      const d = testCloud();
      try {
        await d.req("GET", "/v1/health");
        const out = await Promise.all(Array.from({ length: 20 }, () => d1Spend(d.env.sql, { ...caps, ...more }, who).reserve()));
        expect(out.filter((r) => r.ok), JSON.stringify(more)).toHaveLength(expected);
      } finally { d.close(); }
    }
  });
});

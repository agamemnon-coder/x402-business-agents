// Accounting systems each company connects itself (cloud/src/connect.ts, cloud/src/books/xero.ts): Xero, QuickBooks
// Online and Exact Online, against stand-ins shaped like their documentation. No network.
// It holds: Purser's one app per provider serves every company; each company's owner connects its own organisation and
// gets its own sealed tokens, which only that company's calls use (two companies, two Xero organisations, neither sees
// or uses the other's token); Xero's token request uses HTTP Basic and PKCE; a refresh rotates the token; bills go to
// the company's own organisation as DRAFT bills, once each; disconnecting removes the tokens and revokes them at Xero;
// QuickBooks keeps the company (realmId) the redirect named; Exact's token is refreshed only in its last 30 seconds;
// and "Your connections" says, per company, what is connected, not connected or not available.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { challengeOf, OAUTH_PROVIDERS } from "../src/lib/oauth.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
const XERO = { clientId: "purser-xero-app", clientSecret: "purser-xero-secret-not-real", redirectUri: `${ORIGIN}/v1/connect/xero/callback` };
const QBO = { clientId: "purser-qbo-app", clientSecret: "purser-qbo-secret-not-real", redirectUri: `${ORIGIN}/v1/connect/quickbooks/callback` };
const EXACT = { clientId: "purser-exact-app", clientSecret: "purser-exact-secret-not-real", redirectUri: `${ORIGIN}/v1/connect/exact/callback` };
const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a", ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const basic = (c: { clientId: string; clientSecret: string }) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;

class Fakes {
  n = 0;
  codes = new Map<string, { provider: string; org: string; challenge: string | null }>();
  refresh = new Map<string, { provider: string; org: string }>();
  access = new Map<string, string>();
  revoked: string[] = [];
  bills: { org: string; token: string; idem: string; body: { Invoices: Record<string, unknown>[] } }[] = [];
  calls: { url: string; auth: string; form: Record<string, string> }[] = [];
  issue(provider: string, url: string, org: string) { const code = `code-${++this.n}`; this.codes.set(code, { provider, org, challenge: new URL(url).searchParams.get("code_challenge") }); return code; }
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    const form = Object.fromEntries(new URLSearchParams(typeof init?.body === "string" && !init.body.startsWith("{") ? init.body : ""));
    this.calls.push({ url, auth: h.get("authorization") ?? "", form });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const provider = url === OAUTH_PROVIDERS.xero.tokenUrl ? "xero" : url === OAUTH_PROVIDERS.quickbooks.tokenUrl ? "quickbooks" : url === OAUTH_PROVIDERS.exact.tokenUrl ? "exact" : null;
    if (provider) {
      if (provider === "exact" ? form.client_secret !== EXACT.clientSecret : h.get("authorization") !== basic(provider === "xero" ? XERO : QBO)) return json(401, { error: "invalid_client" });
      if (provider !== "exact" && form.client_secret) return json(400, { error: "invalid_request" });
      const pair = (org: string) => {
        const n = ++this.n, r = `${provider}-refresh-${n}`, at = `${provider}-access-${n}`;
        this.refresh.set(r, { provider, org });
        this.access.set(at, org);
        return { access_token: at, refresh_token: r, expires_in: provider === "exact" ? 600 : provider === "xero" ? 1800 : 3600, token_type: "Bearer", scope: OAUTH_PROVIDERS[provider].scopes.join(" ") };
      };
      if (form.grant_type === "authorization_code") {
        const c = this.codes.get(form.code!);
        this.codes.delete(form.code!);
        if (!c || c.provider !== provider) return json(400, { error: "invalid_grant" });
        if (c.challenge && (await challengeOf(form.code_verifier ?? "")) !== c.challenge) return json(400, { error: "invalid_grant" });
        return json(200, pair(c.org));
      }
      const r = this.refresh.get(form.refresh_token!);
      this.refresh.delete(form.refresh_token!);
      return r ? json(200, pair(r.org)) : json(400, { error: "invalid_grant" });
    }
    if (url === "https://identity.xero.com/connect/revocation") { this.revoked.push(form.token!); return json(200, {}); }
    const token = (h.get("authorization") ?? "").replace(/^Bearer /, "");
    if (url === "https://api.xero.com/connections") {
      const org = this.access.get(token);
      return org ? json(200, [{ id: "conn-1", tenantId: org, tenantType: "ORGANISATION", tenantName: "Org", updatedDateUtc: "2026-11-08T12:00:00" }]) : json(401, {});
    }
    if (url.startsWith("https://api.xero.com/api.xro/2.0/Invoices")) {
      const org = h.get("xero-tenant-id") ?? "";
      // Xero refuses a token used for an organisation it was not issued for.
      if (this.access.get(token) !== org) return json(403, { Type: "AuthorizationUnsuccessful" });
      const body = JSON.parse(String(init?.body)) as { Invoices: Record<string, unknown>[] };
      this.bills.push({ org, token, idem: h.get("idempotency-key") ?? "", body });
      return json(200, { Invoices: [{ InvoiceID: `0000000${this.bills.length}-1111-4111-8111-111111111111`.slice(-36), Status: "DRAFT", StatusAttributeString: "OK" }] });
    }
    return json(404, {});
  };
}

let c: TestCloud, a: TestTenant, b: TestTenant, f: Fakes;
beforeEach(async () => {
  c = testCloud();
  f = new Fakes();
  c.env.connect = { tokenKey: TOKEN_KEY, fetch: f.fetch, clients: { xero: XERO, quickbooks: QBO, exact: EXACT } };
  a = await c.tenant("company-a");
  b = await c.tenant("company-b");
});
afterEach(() => c.close());

async function connect(t: TestTenant, provider: string, org: string, realm?: string) {
  const s = await c.req("POST", `/v1/connect/${provider}/start`, { key: t.session });
  expect(s.status, JSON.stringify(s.json)).toBe(200);
  const u = new URL(s.json.url as string);
  const back = await c.req("GET", `/v1/connect/${provider}/callback?code=${f.issue(provider, u.toString(), org)}&state=${u.searchParams.get("state")}${realm ? `&realmId=${realm}` : ""}`);
  const frag = new URLSearchParams(new URL(back.res.headers.get("location")!).hash.split("?")[1]);
  return c.req("POST", `/v1/connect/${provider}/finish`, { key: t.session, body: { code: frag.get("code"), state: frag.get("state"), ...(frag.get("realm_id") ? { realm_id: frag.get("realm_id") } : {}) } });
}

/** Two supplier invoices in the company's cloud copy, as a runner's push leaves them. */
async function seedBills(t: TestTenant, prefix: string) {
  for (const [i, total] of [[1, "121.00"], [2, "60.50"]] as const) {
    const body = { vendor: `${prefix} Supplier ${i}`, invoice_no: `${prefix}-${i}`, issue_date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", subtotal: (Number(total) / 1.21).toFixed(2), tax: (Number(total) - Number(total) / 1.21).toFixed(2), total, gl_account: "4000", status: "waiting_cfo" };
    await c.env.sql.run("INSERT INTO invoices (tenant_id, id, vendor, invoice_no, due_date, currency, total, status, doc_sha256, received_at, updated_at, version, body_json, body_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      [t.id, `AP-${prefix}-${i}`, body.vendor, body.invoice_no, body.due_date, "EUR", total, "waiting_cfo", "0".repeat(64), "2026-11-01T10:00:00Z", "2026-11-01T10:00:00Z", JSON.stringify(body), "0".repeat(64)]);
  }
}

describe("each company connects its own Xero", () => {
  it("uses Purser's one app with HTTP Basic and PKCE, and keeps each company's organisation", async () => {
    const u = new URL((await c.req("POST", "/v1/connect/xero/start", { key: a.session })).json.url as string);
    expect(u.origin + u.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(u.searchParams.get("scope")).toBe("offline_access accounting.invoices accounting.contacts");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await connect(a, "xero", ORG_A)).json.connection).toMatchObject({ provider: "xero", status: "connected", account: ORG_A });
    expect((await connect(b, "xero", ORG_B)).json.connection).toMatchObject({ provider: "xero", status: "connected", account: ORG_B });
    const tokenCalls = f.calls.filter((x) => x.url === OAUTH_PROVIDERS.xero.tokenUrl);
    expect(tokenCalls.every((x) => x.auth === basic(XERO) && !x.form.client_secret)).toBe(true);
  });

  it("two companies: each sends bills to its own organisation with its own token; neither sees the other's", async () => {
    await connect(a, "xero", ORG_A);
    await connect(b, "xero", ORG_B);
    await seedBills(a, "A");
    await seedBills(b, "B");
    const pa = await c.req("POST", "/v1/connect/xero/bills", { key: a.session, body: {} });
    const pb = await c.req("POST", "/v1/connect/xero/bills", { key: b.session, body: {} });
    expect(pa.json).toMatchObject({ organisation: ORG_A, status: "draft", already: 0, failed: [], remaining: 0 });
    expect((pa.json.pushed as unknown[]).length).toBe(2);
    expect(pb.json).toMatchObject({ organisation: ORG_B });
    const toA = f.bills.filter((x) => x.org === ORG_A), toB = f.bills.filter((x) => x.org === ORG_B);
    expect(toA.flatMap((x) => x.body.Invoices.map((i) => i.InvoiceNumber))).toEqual(["A-1", "A-2"]);
    expect(toB.flatMap((x) => x.body.Invoices.map((i) => i.InvoiceNumber))).toEqual(["B-1", "B-2"]);
    // Each company's calls carry its own token only.
    expect(new Set(toA.map((x) => x.token)).size).toBe(1);
    expect(toA.some((x) => toB.some((y) => y.token === x.token))).toBe(false);
    // Neither the API nor the export shows a token; the stored ones are sealed and bound to their company.
    for (const t of [a, b]) {
      const seen = JSON.stringify([(await c.req("GET", "/v1/connect", { key: t.session })).json, (await c.req("GET", "/v1/export", { key: t.key })).json, (await c.req("GET", "/v1/connections/mine", { key: t.session })).json]);
      expect(seen).not.toMatch(/xero-(access|refresh)-/);
    }
    const rows = await c.env.sql.all<{ tenant_id: string; access_sealed: string; refresh_sealed: string }>("SELECT tenant_id, access_sealed, refresh_sealed FROM books_connections WHERE provider = 'xero'");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.access_sealed.startsWith("v1.") && !r.access_sealed.includes("xero-access"))).toBe(true);
    // Company B's sync key gets company B's token only, never A's.
    const tb = await c.req("GET", "/v1/connect/xero/token", { key: b.key });
    expect(f.access.get(tb.json.access_token as string)).toBe(ORG_B);
    expect(tb.json.account).toBe(ORG_B);
    // A sealed token copied into the other company's row does not open there.
    const ra = rows.find((r) => r.tenant_id === a.id)!;
    await c.env.sql.run("UPDATE books_connections SET access_sealed = ? WHERE tenant_id = ? AND provider = 'xero'", [ra.access_sealed, b.id]);
    expect((await c.req("GET", "/v1/connect/xero/token", { key: b.key })).status).toBe(409);
  });

  it("sends each bill once, as a DRAFT ACCPAY with Purser's VAT, never authorised or paid", async () => {
    await connect(a, "xero", ORG_A);
    await seedBills(a, "A");
    await c.req("POST", "/v1/connect/xero/bills", { key: a.session, body: {} });
    const again = await c.req("POST", "/v1/connect/xero/bills", { key: a.session, body: {} });
    expect(again.json).toMatchObject({ pushed: [], already: 2 });
    expect(f.bills).toHaveLength(2);
    const bill = f.bills[0]!.body.Invoices[0]!;
    expect(bill).toMatchObject({ Type: "ACCPAY", Status: "DRAFT", Contact: { Name: "A Supplier 1" }, InvoiceNumber: "A-1", Reference: "Purser AP-A-1", Date: "2026-11-01", DueDate: "2026-12-01", CurrencyCode: "EUR", LineAmountTypes: "Exclusive" });
    expect(bill.LineItems).toEqual([{ Description: "A Supplier 1 invoice A-1 (Purser AP-A-1)", Quantity: 1, UnitAmount: 100, AccountCode: "4000", TaxAmount: 21 }]);
    expect(JSON.stringify(f.bills)).not.toMatch(/AUTHORISED|PAID|Payments/);
    expect(f.bills[0]!.idem).toMatch(/^[0-9a-f]{64}$/);
    // A key cannot push, and a company without Xero connected gets a sentence.
    expect((await c.req("POST", "/v1/connect/xero/bills", { key: a.key, body: {} })).status).toBe(403);
    expect((await c.req("POST", "/v1/connect/xero/bills", { key: b.session, body: {} })).status).toBe(404);
  });

  it("refreshes a token near its end (rotating the refresh token), and disconnecting revokes it at Xero", async () => {
    await connect(a, "xero", ORG_A);
    const start = c.clock.now;
    expect((await c.req("GET", "/v1/connect/xero/token", { key: a.key })).json.access_token).toBe("xero-access-2");
    c.clock.now = new Date(start.getTime() + 1800_000);
    expect((await c.req("GET", "/v1/connect/xero/token", { key: a.key })).json.access_token).toBe("xero-access-3");
    c.clock.now = start;
    const off = await c.req("DELETE", "/v1/connect/xero", { key: a.session });
    expect(off.json).toMatchObject({ disconnected: true, revoked_at_provider: true });
    expect(f.revoked).toEqual(["xero-refresh-3"]);
    expect((await c.req("GET", "/v1/connect/xero/token", { key: a.key })).status).toBe(404);
    // And it can be connected again.
    expect((await connect(a, "xero", ORG_A)).status).toBe(201);
  });
});

describe("QuickBooks Online and Exact Online", () => {
  it("QuickBooks keeps the company the redirect named, and refuses a finish without one", async () => {
    expect((await connect(a, "quickbooks", "", "9130350000000000")).json.connection).toMatchObject({ provider: "quickbooks", account: "9130350000000000" });
    expect((await connect(b, "quickbooks", "")).status).toBe(400);
  });

  it("Exact's token is refreshed only in its last 30 seconds", async () => {
    await connect(a, "exact", "");
    c.clock.now = new Date(c.clock.now.getTime() + 560_000);
    expect((await c.req("GET", "/v1/connect/exact/token", { key: a.key })).json.access_token).toBe("exact-access-2");
    c.clock.now = new Date(c.clock.now.getTime() + 20_000);
    expect((await c.req("GET", "/v1/connect/exact/token", { key: a.key })).json.access_token).toBe("exact-access-3");
  });
});

describe("Your connections", () => {
  it("says per company what is connected, not connected, or not available on this cloud", async () => {
    await connect(a, "xero", ORG_A);
    const items = (await c.req("GET", "/v1/connections/mine", { key: a.session })).json.items as { id: string; status: string }[];
    const st = Object.fromEntries(items.map((x) => [x.id, x.status]));
    expect(st).toMatchObject({ xero: "connected", quickbooks: "not_connected", exact: "not_connected", airwallex: "not_available", moneybird: "not_available", slack: "not_connected", api_keys: "connected", sign_in_google: "not_available", inbox: "not_available" });
    expect(((await c.req("GET", "/v1/connections/mine", { key: b.session })).json.items as { id: string; status: string }[]).find((x) => x.id === "xero")!.status).toBe("not_connected");
  });
});

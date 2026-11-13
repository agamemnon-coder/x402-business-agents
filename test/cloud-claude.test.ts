// Connect Claude (13 Nov, owner): Purser as a remote MCP server at /mcp, for claude.ai, Claude Desktop and Claude Code.
// It holds: a connector token is made by a signed-in owner only, shown once, kept as a hash, works at /mcp only and ends
// when revoked; /mcp takes nothing else; Claude reads the books; a token made to propose files an invoice's payment and
// nothing more (no tool approves or pays, and the proposal still waits for the CFO's passkey); the demo company's public
// token reads the demo and proposes nothing; and the OAuth sign-in claude.ai uses (metadata, registration, consent,
// PKCE S256, a code good once) gives an access token that ends with its connector token.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_CONNECTOR_TENANT, DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { DEMO_TENANT } from "../cloud/src/guest/guest.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud;
let A: TestTenant;
let reader: string, proposer: string, readerId: string;

const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}, extra: Record<string, string> = {}) => {
  const r = await c.req("POST", "/mcp", { key: token, body: { jsonrpc: "2.0", id: 1, method, params }, headers: { accept: "application/json, text/event-stream", "origin": "null-omit", ...extra } });
  return { status: r.status, json: r.json as { result?: Record<string, unknown>; error?: { code: number; message: string } } & Record<string, unknown>, res: r.res };
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => (await rpc(token, "tools/call", { name, arguments: args })).json.result as { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const toolNames = async (token: string) => ((await rpc(token, "tools/list")).json.result!.tools as { name: string }[]).map((t) => t.name);

beforeAll(async () => {
  c = testCloud({ engine: true });
  A = await c.tenant("northwind");
  const r = await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (reads)" } });
  expect(r.status).toBe(201);
  reader = r.json.token as string; readerId = r.json.id as string;
  proposer = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (proposes)", propose: true } })).json.token as string;
  const up = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
  expect(up.status).toBe(200);
});
afterAll(() => c.close());

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("connector tokens", () => {
  it("are made by a signed-in owner only, shown once, kept as the hash of their secret", async () => {
    // A key, even the owner's full admin key, cannot make one: making one is the company's consent.
    expect((await c.req("POST", "/v1/claude/connectors", { key: A.key, body: { name: "x" } })).status).toBe(403);
    const row = await c.env.sql.first<{ secret_sha256: string; scopes: string; purpose: string; expires_at: string }>("SELECT secret_sha256, scopes, purpose, expires_at FROM api_keys WHERE id = ?", [readerId]);
    expect(row).toMatchObject({ scopes: "read", purpose: "claude" });
    expect(row!.secret_sha256).toBe(createHash("sha256").update(reader.split("_").slice(2).join("_")).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(reader);
    const list = await c.req("GET", "/v1/claude/connectors", { key: A.session });
    expect(list.json.mcp_url).toBe(`${ORIGIN}/mcp`);
    expect(list.json.items).toHaveLength(2);
    expect(JSON.stringify(list.json)).not.toMatch(/pck_|secret/);
    expect((list.json.items as { can_propose: boolean }[]).map((i) => i.can_propose).sort()).toEqual([false, true]);
  });

  it("work at /mcp only, and /mcp takes nothing else", async () => {
    expect((await c.req("GET", "/v1/invoices", { key: reader })).status).toBe(403);
    expect((await c.req("GET", "/v1/me", { key: proposer })).status).toBe(403);
    expect((await c.req("GET", "/v1/invoices", { key: DEMO_CONNECTOR_TOKEN })).status).toBe(403);
    expect((await rpc(A.key, "tools/list")).status).toBe(403);
    expect((await rpc(A.session, "tools/list")).status).toBe(403);
  });

  it("without a token, /mcp answers 401 and says where to sign in", async () => {
    const r = await rpc(null, "initialize");
    expect(r.status).toBe(401);
    expect(r.res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="purser"`);
  });
});

describe("/mcp", () => {
  it("speaks MCP: initialize, ping, tools; notifications are taken with 202; an unknown version is refused", async () => {
    const init = await rpc(reader, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.json.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "purser" } });
    expect(String(init.json.result!.instructions)).toMatch(/connected to Purser for .*cannot approve, pay.*Face ID/);
    expect((await rpc(reader, "initialize", { protocolVersion: "1999-01-01" })).json.result!.protocolVersion).toBe("2025-11-25");
    expect((await rpc(reader, "ping")).json.result).toEqual({});
    const note = await c.req("POST", "/mcp", { key: reader, body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { origin: "null-omit" } });
    expect(note.status).toBe(202);
    expect((await rpc(reader, "tools/list", {}, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect((await rpc(reader, "no/such")).json.error!.code).toBe(-32601);
    expect((await c.req("GET", "/mcp", { key: reader })).status).toBe(405);
    // A page on another site cannot drive it from a browser.
    expect((await c.req("POST", "/mcp", { key: reader, body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
    // Claude's own web origins may: the token is in a header, and no cookie rides along.
    expect((await c.req("POST", "/mcp", { key: reader, body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { origin: "https://claude.ai" } })).status).toBe(200);
  });

  it("reads the books with a reading token, and lists no tool that proposes, approves or pays", async () => {
    const names = await toolNames(reader);
    expect(names).toEqual(["company_overview", "list_invoices", "get_invoice", "list_transactions", "books_report", "agent_decisions", "what_needs_attention",
      "cash_position", "pending_approvals", "cfo_policy", "spend_breakdown", "vat_summary", "payment_audit_trail", "explain_payment"]);
    const inv = await call(reader, "list_invoices");
    expect(inv.isError).toBeUndefined();
    expect(inv.structuredContent!.items).toBeDefined();
    expect((await call(reader, "books_report", { report: "pnl" })).isError).toBeUndefined();
    expect((await call(reader, "books_report", { report: "secrets" })).isError).toBe(true);
    expect((await rpc(reader, "tools/call", { name: "propose_invoice_payment", arguments: { invoice_id: "AP-0001" } })).json.error!.code).toBe(-32602);
  });

  it("with a token made to propose, files an invoice's payment for the CFO: nothing is paid, and nothing can approve it", async () => {
    const names = await toolNames(proposer);
    expect(names).toContain("propose_invoice_payment");
    expect(names.filter((n) => /approve|pay_|execute|limit|sign/.test(n))).toEqual([]);
    const out = await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0001" });
    expect(out.isError).toBeUndefined();
    const p = (out.structuredContent!.proposal as { id: string; status: string });
    expect(out.structuredContent!.paid).toBe(false);
    expect(out.content[0]!.text).toMatch(/Nothing is paid until the CFO approves these exact terms with Face ID/);
    // Claude never gets what a passkey signs.
    expect(JSON.stringify(out)).not.toMatch(/challenge/);
    // The engine holds it as waiting for the CFO, as a proposal filed in the console would be.
    const held = await c.req("GET", `/v1/engine/proposals/${p.id}`, { key: A.session });
    expect(held.json.proposal).toMatchObject({ id: p.id, status: p.status });
    expect(p.status).not.toMatch(/approved|executed|paid/);
    expect((await call(proposer, "payment_proposal", { proposal_id: p.id })).structuredContent!.proposal).toMatchObject({ id: p.id });
    // Again: the engine refuses, in its words, and nothing new is filed.
    const twice = await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0001" });
    expect(twice.isError).toBe(true);
    expect((await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0404" })).isError).toBe(true);
  });

  it("ends when its token is revoked", async () => {
    const t = await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "short-lived" } });
    expect((await rpc(t.json.token as string, "ping")).status).toBe(200);
    expect((await c.req("DELETE", `/v1/claude/connectors/${t.json.id as string}`, { key: A.key })).status).toBe(403);
    expect((await c.req("DELETE", `/v1/claude/connectors/${t.json.id as string}`, { key: A.session })).status).toBe(200);
    expect((await rpc(t.json.token as string, "ping")).status).toBe(401);
  });
});

describe("failed sign-ins", () => {
  it("count a wrong token against its address, but not a client's first call without one (claude.ai's servers share addresses)", async () => {
    const strict = testCloud({ rate: { perMinute: 1000, signInPerMinute: 1000, failedAuthPerMinute: 3 } });
    try {
      const ping = (key: string | null) => strict.req("POST", "/mcp", { key, body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { origin: "null-omit", "cf-connecting-ip": "203.0.113.9" } });
      for (let i = 0; i < 6; i++) expect((await ping(null)).status).toBe(401);
      expect((await ping(DEMO_CONNECTOR_TOKEN)).status).toBe(200);
      for (let i = 0; i < 3; i++) expect((await ping("pck_kAAAAAAAAAAAA_" + "x".repeat(43))).status).toBe(401);
      expect((await ping(DEMO_CONNECTOR_TOKEN)).status).toBe(429);
    } finally {
      strict.close();
    }
  });
});

describe("polish (13 Nov): Purser's icon, ready-made prompts, results a phone can read", () => {
  it("serves Purser's icon and names it in the server's info and the sign-in's metadata", async () => {
    for (const [path, type] of [["/favicon.ico", "image/x-icon"], ["/favicon.svg", "image/svg+xml"], ["/apple-touch-icon.png", "image/png"], ["/icon.png", "image/png"]] as const) {
      const r = await c.fetch(`${ORIGIN}${path}`);
      expect({ path, status: r.status, type: r.headers.get("content-type") }).toEqual({ path, status: 200, type });
    }
    const png = new Uint8Array(await (await c.fetch(`${ORIGIN}/apple-touch-icon.png`)).arrayBuffer());
    expect([...png.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    expect(new DataView(png.buffer).getUint32(16)).toBe(180);
    const init = await rpc(DEMO_CONNECTOR_TOKEN, "initialize", { protocolVersion: "2025-06-18" });
    expect((init.json.result!.serverInfo as { icons: { src: string }[] }).icons.map((i) => i.src)).toEqual([`${ORIGIN}/icon.png`, `${ORIGIN}/favicon.svg`]);
    expect((await c.req("GET", "/.well-known/oauth-authorization-server")).json.logo_uri).toBe(`${ORIGIN}/icon.png`);
    // Every page of the cloud links it.
    expect(await (await c.fetch(`${ORIGIN}/`)).text()).toContain('<link rel="icon" href="/favicon.svg"');
  });

  it("offers three ready-made prompts, each asking for the tools that answer it", async () => {
    const init = await rpc(DEMO_CONNECTOR_TOKEN, "initialize", { protocolVersion: "2025-06-18" });
    expect(init.json.result!.capabilities).toMatchObject({ prompts: {} });
    const list = (await rpc(DEMO_CONNECTOR_TOKEN, "prompts/list")).json.result!.prompts as { name: string; title: string; arguments?: { name: string; required: boolean }[] }[];
    expect(list.map((p) => p.title)).toEqual(["CFO weekly brief", "What needs my Face ID?", "Explain this invoice", "Explain this payment", "Cash outlook"]);
    expect(list[2]!.arguments).toEqual([expect.objectContaining({ name: "invoice_id", required: true })]);
    const tools = (await toolNames(proposer));
    for (const p of list) {
      const got = await rpc(DEMO_CONNECTOR_TOKEN, "prompts/get", { name: p.name, arguments: { invoice_id: "AP-0005", payment_id: "AP-0004" } });
      const text = ((got.json.result!.messages as { content: { text: string } }[])[0]!.content.text);
      const named = [...text.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]!).filter((n) => n !== "waiting_cfo");
      expect({ p: p.name, unknown: named.filter((n) => !tools.includes(n)) }).toEqual({ p: p.name, unknown: [] });
    }
    expect((await rpc(DEMO_CONNECTOR_TOKEN, "prompts/get", { name: "explain_invoice", arguments: {} })).json.error!.code).toBe(-32602);
    expect((await rpc(DEMO_CONNECTOR_TOKEN, "prompts/get", { name: "explain_invoice", arguments: { invoice_id: "x\ny" } })).json.error!.code).toBe(-32602);
  });

  it("answers in plain words first, money as EUR 1,793.00, no raw data in the text, short enough for a phone", async () => {
    for (const [name, args] of [["company_overview", {}], ["what_needs_attention", {}], ["list_invoices", {}], ["get_invoice", { id: "AP-0005" }], ["list_transactions", {}], ["books_report", { report: "pnl" }], ["books_report", { report: "balance" }], ["books_report", { report: "vat", quarter: "2026Q4" }], ["books_report", { report: "payables" }], ["agent_decisions", {}]] as const) {
      const r = await call(DEMO_CONNECTOR_TOKEN, name, args);
      const text = r.content[0]!.text, first = text.split("\n")[0]!;
      expect({ name, first: /^[A-Z0-9]/.test(first) && first.length < 200 && !/[{}[\]"]/.test(text), short: text.length < 2000, money: !/\bEUR\d|\d{4,}_cents|cents\b/.test(text) }).toEqual({ name, first: true, short: true, money: true });
      expect(r.structuredContent).toBeTruthy();
    }
    expect((await call(DEMO_CONNECTOR_TOKEN, "what_needs_attention")).content[0]!.text).toMatch(/^As of 12 Nov 2026: 1 invoice waiting for the CFO's Face ID/);
    expect((await call(DEMO_CONNECTOR_TOKEN, "company_overview")).content[0]!.text).toMatch(/EUR 9,227\.32/);
  });

  it("reads the demo company as of its own last day everywhere (jury, 13 Nov: three different days)", async () => {
    const g = (await c.req("POST", "/v1/auth/guest", { key: null })).json.session as string;
    const d = (await c.req("GET", "/v1/dashboard", { key: g })).json as { as_of: string };
    const n = (await c.req("GET", "/v1/insights", { key: g })).json as { as_of: string };
    const pay = (await c.req("GET", "/v1/reports/payables", { key: g })).json as { as_of: string };
    const me = (await c.req("GET", "/v1/me", { key: g })).json as { demo: { as_of: string } };
    const day = me.demo.as_of.slice(0, 10);
    expect([d.as_of.slice(0, 10), n.as_of, pay.as_of]).toEqual([day, day, day]);
    expect((await call(DEMO_CONNECTOR_TOKEN, "company_overview")).content[0]!.text).toContain("to 12 Nov 2026)");
  });
});

describe("the demo company's public token", () => {
  it("reads the demo company, says it is demo data, and proposes nothing", async () => {
    expect(DEMO_CONNECTOR_TENANT).toBe(DEMO_TENANT);
    const init = await rpc(DEMO_CONNECTOR_TOKEN, "initialize", { protocolVersion: "2025-06-18" });
    expect(String(init.json.result!.instructions)).toMatch(/demo company: made-up data/);
    expect(await toolNames(DEMO_CONNECTOR_TOKEN)).not.toContain("propose_invoice_payment");
    const o = await call(DEMO_CONNECTOR_TOKEN, "company_overview");
    expect((o.structuredContent!.money as { in: string }).in).toBe("16190.70");
    const d = await call(DEMO_CONNECTOR_TOKEN, "agent_decisions", { limit: 5 });
    expect((d.structuredContent!.items as unknown[]).length).toBe(5);
  });
});

describe("OAuth for claude.ai", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const post = (path: string, body: string, origin: string | null = ORIGIN) =>
    c.fetch(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) }, body });
  let clientId = "";

  it("publishes its metadata and registers a public client without storing it", async () => {
    const pr = await c.req("GET", "/.well-known/oauth-protected-resource");
    expect(pr.json).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const as = await c.req("GET", "/.well-known/oauth-authorization-server");
    expect(as.json).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    const reg = await c.fetch(`${ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json", origin: "https://claude.ai" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }) });
    expect(reg.status).toBe(201);
    clientId = ((await reg.json()) as { client_id: string }).client_id;
    expect((await c.fetch(`${ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status).toBe(400);
  });

  const ask = () => ({ client_id: clientId, redirect_uri: redirect, state: "st-1", code_challenge: challenge, resource: `${ORIGIN}/mcp` });
  const authorizeUrl = (o: Record<string, string> = {}) => `/oauth/authorize?${new URLSearchParams({ response_type: "code", code_challenge_method: "S256", ...ask(), ...o })}`;
  /** The consent form's own token, as the page a person sees holds it. */
  const consentOf = async (o: Record<string, string> = {}) => /name="consent" value="([^"]+)"/.exec(await (await c.fetch(`${ORIGIN}${authorizeUrl(o)}`)).text())![1]!;

  it("shows a consent page that asks for a connector token; refuses an unknown client, address or missing PKCE", async () => {
    const page = await c.fetch(`${ORIGIN}${authorizeUrl()}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/Connect your AI to Purser/);
    expect(html).toMatch(/Use the demo company/);
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toMatch(/never approve or pay/);
    expect(page.headers.get("content-security-policy")).toMatch(/form-action 'self' https:\/\/claude\.ai; .*frame-ancestors 'none'/);
    expect((await c.fetch(`${ORIGIN}${authorizeUrl({ redirect_uri: "https://evil.example/cb" })}`)).status).toBe(400);
    expect((await c.fetch(`${ORIGIN}${authorizeUrl({ code_challenge_method: "plain" })}`)).status).toBe(400);
    expect((await c.fetch(`${ORIGIN}${authorizeUrl({ client_id: "pcc.forged.sig" })}`)).status).toBe(400);
  });

  it("takes a connector token only (not another key), gives a code good once for its verifier, and an access token that ends with the connector token", async () => {
    const t = await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "claude.ai" } });
    // An ordinary API key is not a connector token.
    const wrong = await post("/oauth/authorize", form({ ...ask(), consent: await consentOf(), act: "connect", token: A.key }));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toMatch(/not a live Claude connector token/);
    const ok = await post("/oauth/authorize", form({ ...ask(), consent: await consentOf(), act: "connect", token: t.json.token as string }));
    expect(ok.status).toBe(303);
    const back = new URL(ok.headers.get("location")!);
    expect(`${back.origin}${back.pathname}`).toBe(redirect);
    expect(back.searchParams.get("state")).toBe("st-1");
    const code = back.searchParams.get("code")!;
    // The code is kept as its hash only.
    expect(await c.env.sql.first("SELECT 1 FROM oauth_codes WHERE code_sha256 = ?", [code])).toBeNull();
    const exchange = (v: string, cd = code) => post("/oauth/token", form({ grant_type: "authorization_code", code: cd, code_verifier: v, client_id: clientId, redirect_uri: redirect, resource: `${ORIGIN}/mcp` }), "https://claude.ai");
    const bad = await exchange(randomBytes(32).toString("base64url"));
    expect(bad.status).toBe(400);
    // The wrong verifier spent the code: a stolen code is worth one try.
    expect(((await (await exchange(verifier)).json()) as { error: string }).error).toBe("invalid_grant");
    // Again, properly.
    const again = await post("/oauth/authorize", form({ ...ask(), consent: await consentOf(), act: "connect", token: t.json.token as string }));
    const code2 = new URL(again.headers.get("location")!).searchParams.get("code")!;
    const tok = await exchange(verifier, code2);
    expect(tok.status).toBe(200);
    const access = (await tok.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(access.token_type).toBe("Bearer");
    expect(access.access_token).not.toContain((t.json.token as string).slice("pck_".length + 14));
    expect((await exchange(verifier, code2)).status).toBe(400);
    expect((await rpc(access.access_token, "tools/list")).status).toBe(200);
    expect((await c.req("GET", "/v1/invoices", { key: access.access_token })).status).toBe(403);
    await c.req("DELETE", `/v1/claude/connectors/${t.json.id as string}`, { key: A.session });
    expect((await rpc(access.access_token, "tools/list")).status).toBe(401);
  });

  it("can open the demo company instead, read only; cancel goes back with access_denied", async () => {
    const r = await post("/oauth/authorize", form({ ...ask(), consent: await consentOf(), act: "demo" }));
    const code = new URL(r.headers.get("location")!).searchParams.get("code")!;
    const tok = await post("/oauth/token", form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }), null);
    expect(((await tok.json()) as { access_token: string }).access_token).toBe(DEMO_CONNECTOR_TOKEN);
    const deny = await post("/oauth/authorize", form({ ...ask(), consent: await consentOf(), act: "deny" }));
    expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    // A consent form needs its own token: missing or forged, nothing happens (a page shows again, with a fresh form).
    for (const consent of ["", "pcf.e30.forged", (await consentOf()).replace(/.$/, (ch) => (ch === "A" ? "B" : "A"))]) {
      const r = await post("/oauth/authorize", form({ ...ask(), consent, act: "demo" }), "https://evil.example");
      expect({ consent, status: r.status, location: r.headers.get("location") }).toEqual({ consent, status: 403, location: null });
    }
  });
  it("answers the consent from any origin (claude.ai's in-app browser sends Origin: null), but only once per form and only for its own request", async () => {
    const answer = async (origin: string | null, consent: string, o: Record<string, string> = {}) => post("/oauth/authorize", form({ ...ask(), ...o, consent, act: "demo" }), origin);
    // Origin: null, as a browser sends it after a chain of redirects or under no-referrer; and Origin: claude.ai.
    for (const origin of ["null", "https://claude.ai", null]) {
      const r = await answer(origin, await consentOf());
      expect({ origin, status: r.status }).toEqual({ origin, status: 303 });
      expect(new URL(r.headers.get("location")!).searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    }
    // The same form twice: the second answer is refused, and no code comes back.
    const once = await consentOf();
    expect((await answer("null", once)).status).toBe(303);
    const twice = await answer("null", once);
    expect([twice.status, twice.headers.get("location")]).toEqual([403, null]);
    expect(await twice.text()).toMatch(/expired or was already used/);
    // 13 Nov: nor the same form under a second spelling of its signature. The last base64url character of a 32-byte MAC
    // keeps two padding bits; flipping one gives other text for the same bytes, which the single-use check (by the
    // token's hash) would not know. Only the spelling the signer writes is accepted.
    const respelled = once.replace(/.$/, (ch) => B64U[B64U.indexOf(ch) ^ 1]!);
    expect(respelled).not.toBe(once);
    expect(Buffer.from(respelled.split(".")[2]!, "base64url").equals(Buffer.from(once.split(".")[2]!, "base64url"))).toBe(true);
    expect((await answer("null", respelled)).status).toBe(403);
    // A form made for one request does not answer another: another state or PKCE challenge.
    const other = createHash("sha256").update("another verifier, long enough to pass the check").digest("base64url");
    for (const o of [{ state: "st-2" }, { code_challenge: other }] as Record<string, string>[]) expect((await answer("null", await consentOf(), o)).status).toBe(403);
    // A form older than ten minutes is refused.
    const old = await consentOf();
    c.clock.now = new Date(c.clock.now.getTime() + 11 * 60_000);
    try { expect((await answer("null", old)).status).toBe(403); } finally { c.clock.now = new Date(c.clock.now.getTime() - 11 * 60_000); }
    // The page itself sends the browser's origin on its forms again.
    expect((await c.fetch(`${ORIGIN}${authorizeUrl()}`)).headers.get("referrer-policy")).toBe("same-origin");
  });
});

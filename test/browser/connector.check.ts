// npx tsx test/browser/connector.check.ts [dir]: Connect Claude end to end, the way claude.ai does it, on a cloud served on
// this machine (the Worker's own handler over SQLite; no network). A second local site plays the client:
//   1. it registers itself (POST /oauth/register, server to server, no Origin);
//   2. a real browser starts on the client's own page, which sends it through a cross-site redirect to the consent page
//      (the chain claude.ai's in-app browser follows), where the person taps "Use the demo company";
//   3. the browser lands back on the client's callback with a code and the state it sent;
//   4. the client exchanges the code with its PKCE verifier (POST /oauth/token, server to server) for an access token;
//   5. it speaks MCP with that token: initialize (Purser's icons), tools/list, prompts/list, every read tool, a prompt;
// then the same consent as a person with a connector token of their own, refused with an API key, and Origin: null on the
// consent form's POST (the iOS app's case), which its own form token holds instead of the Origin check.
// Prints ok/FAIL per check; screenshots of the consent page at 390 and 1440 px when a directory is given.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { ICON_VERSION } from "../../src/ui/brand/mark.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8900 + Math.floor(Math.random() * 50), CLIENT_PORT = PORT + 60;
const ORIGIN = `http://localhost:${PORT}`, CLIENT = `http://127.0.0.1:${CLIENT_PORT}`;
const ADMIN = "connector-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(mkdtempSync(join(tmpdir(), "connector-"))), sessionSecret: "k".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"), rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 } };
const listen = (s: Server, port: number) => new Promise<void>((r) => s.listen(port, "127.0.0.1", () => r()));
const cloud = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await listen(cloud, PORT);

// The client: its own start page redirects (302) to the consent page, as a connector's "Connect" does; its callback shows what came back.
let authorizeUrl = "";
const client = createServer((req, res) => {
  if (req.url === "/start") { res.writeHead(302, { location: authorizeUrl }); res.end(); return; }
  res.writeHead(200, { "content-type": "text/plain" }); res.end(`callback ${req.url}`);
});
await listen(client, CLIENT_PORT);
const redirect = `${CLIENT}/callback`;

const post = async (path: string, body: Record<string, string>, json = false) => {
  const r = await fetch(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" }, body: json ? JSON.stringify(body) : new URLSearchParams(body).toString() });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
};
const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
  const r = await fetch(`${ORIGIN}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: r.status, json: await r.json().catch(() => ({})) as { result?: Record<string, unknown>; error?: { message: string } } };
};

// 1. Discovery and registration, as a client does it.
const challenge401 = await fetch(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
ok(challenge401.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/.test(challenge401.headers.get("www-authenticate") ?? ""), "discovery: /mcp answers 401 with the protected resource's metadata");
const as = await (await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json() as { registration_endpoint: string; logo_uri: string };
// The logo's address carries the icons' version (src/ui/brand/mark.ts, 13 Nov), and that address serves the PNG.
const logo = await fetch(as.logo_uri);
ok(as.registration_endpoint === `${ORIGIN}/oauth/register` && as.logo_uri === `${ORIGIN}/icon.png?v=${ICON_VERSION}` && logo.status === 200 && logo.headers.get("content-type") === "image/png", "discovery: the authorization server's metadata, with Purser's logo");
const reg = await post("/oauth/register", { client_name: "Claude", redirect_uris: [redirect] as unknown as string }, true);
const clientId = String(reg.json.client_id ?? "");
ok(reg.status === 201 && clientId.startsWith("pcc."), "registration: a public client, its id signed");

const browser = await chromium.launch();
async function consentRun(o: { width: number; act: "demo" | "connect"; token?: string; nullOrigin?: boolean; shot?: string; refused?: boolean }): Promise<{ code: string | null; state: string | null; page: string }> {
  const verifier = randomBytes(32).toString("base64url"), state = randomBytes(8).toString("hex");
  authorizeUrl = `${ORIGIN}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: `${ORIGIN}/mcp` })}`;
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width < 500 ? 844 : 900 }, ...(o.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  // The iOS app's case: the consent form's POST carries Origin: null.
  if (o.nullOrigin) await p.route(`${ORIGIN}/oauth/authorize`, (r) => r.request().method() === "POST" ? r.continue({ headers: { ...r.request().headers(), origin: "null" } }) : r.continue());
  await p.goto(`${CLIENT}/start`);
  await p.waitForSelector("text=Connect your AI to Purser");
  const look = await p.evaluate(() => ({ logo: (document.querySelector(".brand img") as HTMLImageElement | null)?.naturalWidth ?? 0, demo: document.querySelector("button.demo")?.getBoundingClientRect().height ?? 0, wide: document.documentElement.scrollWidth, font: parseFloat(getComputedStyle(document.querySelector("#token")!).fontSize) }));
  ok(look.logo > 0 && look.demo >= 48 && look.wide <= o.width && look.font >= 16, `consent ${o.width}px: Purser's logo loads, the demo button is at least 48 px, nothing wider than the screen, a 16 px field (no zoom on iOS)`);
  if (o.shot && shots) await p.screenshot({ path: join(shots, o.shot), fullPage: true });
  if (o.act === "demo") await p.click("button.demo");
  else { await p.fill("#token", o.token ?? ""); await p.click('button[value="connect"]'); }
  await p.waitForLoadState("load");
  const url = new URL(p.url());
  // A refused token answers the page again with 401, which the browser logs as a failed load: expected there, nowhere else.
  const unexpected = errs.filter((e) => !(o.refused && /status of 401/.test(e)));
  ok(unexpected.length === 0, `consent ${o.width}px: no console or CSP errors${unexpected.length ? ` (${unexpected.join(" | ")})` : ""}`);
  const back = url.origin === CLIENT ? url : null;
  const out = { code: back?.searchParams.get("code") ?? null, state: back?.searchParams.get("state") ?? null, page: await p.content() };
  if (out.code) {
    const tok = await post("/oauth/token", { grant_type: "authorization_code", code: out.code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect, resource: `${ORIGIN}/mcp` });
    (out as { token?: string }).token = String(tok.json.access_token ?? "");
  }
  ok(!out.code || out.state === state, `consent ${o.width}px: the state comes back as sent`);
  await ctx.close();
  return out;
}

// 2–5. The demo company, at a phone's width (claude.ai's iOS app) and a laptop's.
for (const width of [390, 1440]) {
  const r = await consentRun({ width, act: "demo", nullOrigin: width === 390, shot: `consent-${width}.png` }) as { code: string | null; token?: string };
  ok(!!r.code && r.token === "purser-demo-read-only", `demo ${width}px${width === 390 ? " (Origin: null)" : ""}: back on the client's callback with a code, exchanged for the demo company's read-only token`);
  if (!r.token) continue;
  const init = await rpc(r.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "connector-check", version: "1" } });
  const info = init.json.result?.serverInfo as { icons?: { src: string }[] } | undefined;
  ok(init.status === 200 && !!info?.icons?.length && /demo company/.test(String(init.json.result?.instructions)), `demo ${width}px: initialize with Purser's icons, and says it is the demo company`);
  const icon = await fetch(info?.icons?.[0]?.src ?? `${ORIGIN}/icon.png`);
  ok(icon.status === 200 && icon.headers.get("content-type") === "image/png", `demo ${width}px: the server's icon loads`);
  const tools = ((await rpc(r.token, "tools/list")).json.result?.tools ?? []) as { name: string; annotations?: { readOnlyHint?: boolean } }[];
  ok(tools.length === 7 && tools.every((t) => t.annotations?.readOnlyHint), `demo ${width}px: seven read-only tools (${tools.map((t) => t.name).join(", ")})`);
  for (const t of tools) {
    const out = await rpc(r.token, "tools/call", { name: t.name, arguments: t.name === "get_invoice" ? { id: "AP-0005" } : t.name === "books_report" ? { report: "pnl" } : {} });
    const res = out.json.result as { content?: { text: string }[]; isError?: boolean } | undefined;
    const text = res?.content?.[0]?.text ?? "";
    ok(out.status === 200 && !res?.isError && /^[A-Z0-9]/.test(text) && text.length < 2000 && !/[{}]/.test(text), `demo ${width}px: ${t.name} answers in plain words (${JSON.stringify(text.split("\n")[0]!.slice(0, 70))})`);
  }
  const prompts = ((await rpc(r.token, "prompts/list")).json.result?.prompts ?? []) as { name: string }[];
  const brief = await rpc(r.token, "prompts/get", { name: "cfo_weekly_brief" });
  ok(prompts.length === 3 && ((brief.json.result?.messages ?? []) as unknown[]).length === 1, `demo ${width}px: three prompts, the weekly brief among them`);
}

// A person's own company: its starter key is an ordinary API key, which the consent page must refuse.
const admin = async (method: string, path: string, body?: unknown, key = ADMIN) => {
  const r = await fetch(`${ORIGIN}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
};
const company = await admin("POST", "/v1/admin/tenants", { slug: "harbour2", name: "Harbour Tools (test company)", owner: { display_name: "The CFO" } });
const starter = String(company.json.api_key ?? "");
// A connector token needs a signed-in owner (a passkey): the check uses the starter key only to show it is refused.
const wrong = await consentRun({ width: 390, act: "connect", token: starter, refused: true }) as { code: string | null; page: string };
ok(!wrong.code && /not a live Claude connector token/.test(wrong.page), "an ordinary API key on the consent page is refused, and no code comes back");

// The official MCP SDK's own client (Streamable HTTP), as a second, independent reader of the protocol.
{
  const sdkClient = new Client({ name: "connector-check-sdk", version: "1.0.0" });
  await sdkClient.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { requestInit: { headers: { authorization: "Bearer purser-demo-read-only" } } }));
  const tools = await sdkClient.listTools();
  const called = await sdkClient.callTool({ name: "what_needs_attention", arguments: {} }) as { content: { type: string; text: string }[] };
  const prompts = await sdkClient.listPrompts();
  const got = await sdkClient.getPrompt({ name: "explain_invoice", arguments: { invoice_id: "AP-0005" } });
  ok(tools.tools.length === 7 && /^As of 12 Nov 2026/.test(called.content[0]?.text ?? "") && prompts.prompts.length === 3 && got.messages.length === 1, "the MCP SDK's own client: connects, lists seven tools and three prompts, calls a tool, fills a prompt");
  await sdkClient.close();
}

await browser.close();
cloud.close(); client.close();
console.log(failed ? `\nconnector check: ${failed} problem(s)` : "\nconnector check: all passed");
process.exit(failed ? 1 : 0);

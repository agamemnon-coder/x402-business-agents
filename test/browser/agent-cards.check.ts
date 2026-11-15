// The Agents tab's live sandbox cards in Chromium, on this machine (14 Nov). The cloud's card gateway is the real one
// (worker/src/awxCards.ts, with its allow-list) over a stand-in for the Airwallex sandbox (test/support/awxCardsFake.ts),
// which sends a full card number and a CVV on purpose. The owner signs in with a virtual passkey and, with Face ID each
// time (the virtual authenticator), issues the Sourcing agent's card, has the agent try a purchase over its limit (a
// decline), and freezes the card. It checks: the action is signed and runs, the decline shows with its id, the card
// flips to Frozen, the page never shows the full card number or the CVV, no console or CSP errors, nothing wider than
// a phone. The live page is checked after the deploy, against the real sandbox.
// npx tsx test/browser/agent-cards.check.ts [screenshot dir]
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { TenantDb } from "../../cloud/src/tenant.js";
import { AwxCardsDesk } from "../../worker/src/awxCards.js";
import { CVV, fakeSandbox, PAN } from "../support/awxCardsFake.js";
const CVV_SEEN = new RegExp(`\\b${CVV}\\b`);

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8990 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "agent-cards-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const sandbox = fakeSandbox();
// An older Support card from an earlier run, at an older limit (15 Nov: the sandbox held two or three per agent), and a
// frozen one: the Support agent adopts its live card from the sandbox, and the older active card is frozen in one action.
sandbox.seed({ nick_name: "support agent: helpdesk software (3efefc)", card_status: "ACTIVE", per: 60, month: 150, created_at: "2026-11-03T06:06:29.394+0000", last4: "6203" });
sandbox.seed({ nick_name: "support agent: helpdesk tools", card_status: "ACTIVE", per: 75, month: 150, created_at: "2026-10-29T15:53:00.000+0000", last4: "6949" });
const desk = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "stand-in", AIRWALLEX_API_KEY: "stand-in", AWX_CARDS_WRITE: "on" }, { fetchImpl: sandbox.fetchImpl });
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "agent-cards-check-"));
const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "c".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, mailDomain: "", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  awxCards: { ask: (a) => desk.ask(a) } };
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

// A company, its owner and the owner's passkey (one P-256 key, in the virtual authenticator and in the cloud's records).
const made = await fetch(`${ORIGIN}/v1/admin/tenants`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ slug: "northwind", name: "Northwind Outdoor (test company)", owner: { display_name: "The CFO" } }) });
ok(made.status === 201, "the test company is made");
const tenant = (await env.sql.first<{ id: string }>("SELECT id FROM tenants WHERE slug = 'northwind'"))!.id;
const owner = (await env.sql.first<{ id: string }>("SELECT id FROM users WHERE tenant_id = ?", [tenant]))!.id;
await env.sql.run("UPDATE tenants SET language = 'en' WHERE id = ?", [tenant]);
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string };
const credId = randomBytes(16);
const db = new TenantDb(env.sql, tenant);
await db.apply([db.insert("credentials", { credential_id: credId.toString("base64url"), user_id: owner, x: jwk.x, y: jwk.y, counter: 0, created_at: new Date().toISOString() })]);
// The company's records: its three agents and their cards as issued under the CFO policy.
await db.apply([["sourcing", "30.00 / 100.00"], ["support", "60.00 / 150.00"], ["treasury", "25.00 / 50.00"]].map(([agent, limits], i) =>
  db.insert("audit_rows", { seq: i + 1, ts: "2026-11-01T10:00:00Z", actor: agent!, event: "card.issued", subject: agent!, payload_json: JSON.stringify({ agent, last4: "0000", limits, currency: "EUR", nickname: `${agent} agent: software` }), prev_hash: "0", row_hash: String(i) })));
// The admin's switch.
await env.sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES ('awx_cards', 'on', ?)", [new Date().toISOString()]);

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: shots ? 2 : 1 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: credId.toString("base64"), isResidentCredential: true, rpId: "localhost", privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), userHandle: Buffer.from(owner).toString("base64"), signCount: 0 } });

const settle = () => page.waitForTimeout(600);
const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false }); };
const text = () => page.evaluate(() => document.body.innerText);

await page.goto(`${ORIGIN}/#/sign-in`);
await page.fill("#slug", "northwind");
await page.click("text=Sign in with your passkey");
await page.waitForSelector("#tabs", { state: "visible", timeout: 20_000 });
await page.goto(`${ORIGIN}/#/agents`);
await page.waitForSelector(".lcard", { timeout: 20_000 });
ok((await page.$$(".lcard")).length === 3, "each agent has a live card panel");
ok((await text()).includes("No live card yet"), "before issuing: no live card, with the policy's limits");

const sourcing = page.locator(".card.agent").filter({ hasText: "Sourcing" }).first();
await sourcing.locator("button", { hasText: "Issue card" }).click();
await page.waitForSelector("text=issued with the policy's limits", { timeout: 20_000 });
ok(sandbox.calls.includes("POST /issuing/cards/create"), "the signed action created the card at the sandbox");
await settle();
ok((await sourcing.innerText()).includes("1902") && (await sourcing.innerText()).includes("Limits match the CFO policy"), "the new card shows its last four and the policy's limits");

// One cent over: the limit, then the limit and EUR 0.01, at the sandbox, with Face ID.
await sourcing.locator("button", { hasText: "Test: EUR 30.00, then EUR 30.01" }).click();
await page.waitForSelector("text=Airwallex itself: EUR 30.00 approved, EUR 30.01 declined (LIMIT_EXCEEDED)", { timeout: 20_000 });
ok((await (await fetch(`${ORIGIN}/v1/cards/edge/latest`)).json() as { attempts: { approved: boolean }[] }).attempts.map((a) => a.approved).join() === "true,false", "the run record says what Airwallex said: approved, then declined");
await settle();
const afterTest = await sourcing.innerText();
ok(afterTest.includes("LIMIT_EXCEEDED") && /ctx_\d+/.test(afterTest), "the decline shows with its reason and its id");
// The Support agent: its live card adopted from the sandbox, its older active card frozen in one signed action.
const support = page.locator(".card.agent").filter({ hasText: "Support" }).first();
ok((await support.innerText()).includes("6203") && (await support.innerText()).includes("still active: to be frozen"), "an adopted live card, and the older card still to be frozen");
await support.locator("button", { hasText: "Freeze older test cards (1)" }).click();
await page.waitForSelector("text=Older test cards frozen: 1", { timeout: 20_000 });
await settle();
ok([...sandbox.cards.values()].find((x) => x.last4 === "6949")?.card_status === "INACTIVE" && [...sandbox.cards.values()].find((x) => x.last4 === "6203")?.card_status === "ACTIVE", "the older card is frozen at the sandbox; the live card is not");
await support.scrollIntoViewIfNeeded();
await shot("cloud-agents-card-older-1440");
await sourcing.scrollIntoViewIfNeeded();
await shot("cloud-agents-card-decline-1440");

await sourcing.locator("button", { hasText: "Freeze card" }).click();
await page.waitForSelector("text=is frozen", { timeout: 20_000 });
await settle();
ok((await sourcing.locator(".lcard .bcard.frozen").count()) === 1 && (await sourcing.innerText()).includes("Unfreeze card"), "the card flips to Frozen, and offers Unfreeze");
await sourcing.locator(".lcard").scrollIntoViewIfNeeded();
await shot("cloud-agents-card-1440");

const all = await page.content();
ok(!all.includes(PAN) && !CVV_SEEN.test(await text()) && !all.includes("ch_secret_holder"), "the page never holds the full card number, the CVV or the cardholder");

await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForSelector(".lcard .bcard", { timeout: 20_000 });
await settle();
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "nothing is wider than a phone");
await page.locator(".card.agent").filter({ hasText: "Sourcing" }).first().locator(".lcard").scrollIntoViewIfNeeded();
await shot("cloud-agents-card-390");

ok(errors.length === 0, `no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);

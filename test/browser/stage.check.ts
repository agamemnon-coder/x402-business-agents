// Stage mode's presenter page (/try/stage, cloud/src/try/stagePage.ts) in Chromium, on this machine: a real cloud with
// an engine in this process (cloud/src/engine/node.ts, test money on a simulated bank), the event pool opened with the
// admin route (starts on, an event token), and a few visitors played through it with a software passkey (start, the
// clean sample, approve, one cent changed and refused, pay). Claude does not run here (no key): Purser's code reads,
// so "invoices read by Claude" stays 0, as it should.
// At 1920×1080 (the projector) and 390×844 (a phone): the headline, the test-money label, the QR code with the event
// token, the counts equal to the stats route's, the ticker, nothing wider than the screen, no console or CSP error.
// Then the stats route fails: "Live counts paused" and the QR code is still there; "Recorded run" plays and closes.
// npx tsx test/browser/stage.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { STAGE_HEADLINE, STAGE_MONEY, STAGE_PAUSED, STAGE_TILES } from "../../cloud/src/try/stagePage.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 9090 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "stage-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "stage-check-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "t".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: {},
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });

let ip = 0;
const call = async (method: string, path: string, o: { key?: string; body?: unknown } = {}) => {
  const r = await handle(new Request(`${ORIGIN}${path}`, { method, headers: { ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": `203.0.113.${++ip % 250}` }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }), env);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) as Record<string, unknown> }; } catch { return { status: r.status, json: {} as Record<string, unknown> }; }
};
const admin = (body: unknown) => call("POST", "/v1/try/admin", { key: ADMIN, body });

/** One visitor of the event pool, as far as `upTo` goes. */
async function visitor(token: string, upTo: "start" | "approve" | "refused" | "paid"): Promise<void> {
  const r = await call("POST", "/v1/try/start", { body: { token } });
  if (r.status !== 201) throw new Error(`start: ${JSON.stringify(r.json)}`);
  if (upTo === "start") return;
  const s = r.json.session as string;
  const up = await call("POST", "/v1/engine/samples/clean", { key: s });
  const phone = new FakeAuthenticator();
  const st = await call("POST", "/v1/engine/passkey/start", { key: s });
  await call("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: "localhost" }) } });
  const p = (await call("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: s })).json.proposal as { id: string; challenge: string; terms_sha256: string };
  const cred = phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: "localhost", counter: 1 });
  await call("POST", `/v1/engine/proposals/${p.id}/approve`, { key: s, body: { terms_sha256: p.terms_sha256, credential: cred } });
  if (upTo === "approve") return;
  const t = (await call("GET", `/v1/engine/proposals/${p.id}/terms`, { key: s })).json.terms as Record<string, unknown>;
  await call("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms: { ...t, amount: "1850.01" }, credential: cred } });
  if (upTo === "refused") return;
  await call("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms: t, credential: cred } });
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("cf-connecting-ip", "127.0.0.1");
  const r = await handle(new Request(`${ORIGIN}${req.url ?? "/"}`, { method: req.method ?? "GET", headers, ...(chunks.length && req.method !== "GET" ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const errors: string[] = [];
const watch = (page: Page) => {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
};

const browser = await launchBrowser("chromium");
try {
  await admin({ op: "set", key: "starts", value: "on" });
  const token = (await admin({ op: "token", pool: "event", until: new Date(Date.now() + 3 * 3_600_000).toISOString() })).json.token as string;
  // The room: some start, some sign, some cheat, some pay; one visitor of the public pool, never counted.
  for (const upTo of ["paid", "paid", "refused", "paid", "approve", "start", "paid", "refused", "start"] as const) await visitor(token, upTo);
  const pub = await call("POST", "/v1/try/start", { body: {} });
  ok(pub.json.pool === "public", "a public visitor is in the public pool");

  for (const [w, h, tag] of [[1920, 1080, "1920"], [390, 844, "390"]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: shots ? 2 : 1, colorScheme: "dark", reducedMotion: tag === "390" ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    watch(page);
    await gotoLoaded(page, `${ORIGIN}/try/stage#e=${token}`);
    ok(!page.url().includes(token), `${tag}: the token is off the address bar`);
    await page.waitForFunction(() => /Event pool/.test(document.getElementById("qrnote")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => undefined);
    await page.waitForFunction(() => /Live from/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => undefined);
    const since = await page.evaluate(() => localStorage.getItem("purser.stage.since"));
    // The wall counts from when this screen was first opened: count from before the room played, as a presenter would.
    await page.evaluate(() => { localStorage.setItem("purser.stage.since", new Date(Date.now() - 3_600_000).toISOString()); });
    await page.reload();
    await page.waitForFunction(() => /Live from/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelector(".tile b")?.textContent !== "0", null, { timeout: 10_000 }).catch(() => undefined);
    ok(since !== null, `${tag}: the screen keeps when it counts from`);
    ok(await page.getByRole("heading", { level: 1, name: STAGE_HEADLINE }).isVisible(), `${tag}: the headline`);
    ok(await page.locator(".band .money").filter({ hasText: STAGE_MONEY }).isVisible(), `${tag}: the test-money label is on screen`);
    ok(/Event pool · until/.test(await page.locator("#qrnote").textContent() ?? ""), `${tag}: the QR code carries the event token`);
    const qrBox = await page.locator("#qrsvg").boundingBox();
    ok(qrBox && qrBox.width >= (w >= 1000 ? 600 : 300), `${tag}: the QR code is large (${Math.round(qrBox?.width ?? 0)} px)`);
    ok(qrBox && qrBox.y + qrBox.height <= h + (w >= 1000 ? 0 : 400), `${tag}: the QR code is on the first screen`);
    const api = (await call("GET", `/v1/try/stage/stats?since=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`)).json.counts as Record<string, number>;
    const shown = await page.locator(".tile b").allTextContents();
    ok(JSON.stringify(shown) === JSON.stringify(STAGE_TILES.map(([k]) => String(api[k]))), `${tag}: the counts are the route's (${shown.join(" · ")})`);
    ok(api.started === 9 && api.signed === 7 && api.refused === 2 + 4 && api.paid === 4 && api.read_by_claude === 0, `${tag}: the route counted the event pool only (${JSON.stringify(api)})`);
    ok((await page.locator("#ticker li").count()) === 5 && /Someone paid EUR 1,850\.00 in (under 1|\d+) s, signed with their passkey/.test(await page.locator("#ticker").textContent() ?? ""), `${tag}: the ticker in plain words`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(wide <= w, `${tag}: nothing wider than the screen (${wide} px)`);
    if (w >= 1000) {
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      ok(tall <= h, `${tag}: the wall fits the projector without scrolling (${tall} px)`);
    }
    if (shots) await page.screenshot({ path: join(shots, `stage-${tag}.png`), fullPage: tag === "390" });

    // The counts fail: paused, and the QR code stays.
    await page.route("**/v1/try/stage/stats**", (r) => r.abort());
    await page.waitForFunction((p) => (document.getElementById("status")?.textContent ?? "").startsWith(p), STAGE_PAUSED, { timeout: 10_000 }).catch(() => undefined);
    ok((await page.locator("#status").textContent())?.startsWith(STAGE_PAUSED), `${tag}: "${STAGE_PAUSED}" when the counts fail`);
    ok(await page.locator("#qrsvg path").isVisible(), `${tag}: the QR code is still there`);
    if (shots && tag === "1920") await page.screenshot({ path: join(shots, "stage-1920-paused.png") });
    // The recorded run, with no network at all.
    await ctx.setOffline(true);
    await page.getByRole("button", { name: "Recorded run" }).click();
    ok(await page.getByRole("dialog").isVisible(), `${tag}: the recorded run opens offline`);
    ok(await page.locator("#rec .money").filter({ hasText: STAGE_MONEY }).isVisible(), `${tag}: the recorded run says test money`);
    await page.waitForTimeout(1_200);
    ok((await page.locator("#recsteps li.done").count()) >= 1, `${tag}: the recorded run plays`);
    if (shots && tag === "1920") { await page.waitForTimeout(400); await page.screenshot({ path: join(shots, "stage-1920-recorded.png") }); }
    await page.keyboard.press("Escape");
    ok(!(await page.getByRole("dialog").isVisible()), `${tag}: Escape goes back to the wall`);
    await ctx.close();
  }
  const real = errors.filter((e) => !/Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e));
  ok(real.length === 0, `no console or page error${real.length ? `: ${real.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);

// /try in an in-app browser (13 Nov tester: WhatsApp on an iPhone, "I can't get past the third one"), in Chromium with
// iPhone emulation and WhatsApp's in-app user agent, on the real cloud with a real engine in this process (test money on
// the stand-in bank, no network beyond localhost). Three ways the passkey fails there, each must leave a way on:
//  1. no WebAuthn at all (window.PublicKeyCredential missing): the "Open in Safari" card, Copy link, and a button;
//  2. the browser refuses at once (NotAllowedError, as in-app web views do): a plain message, Try again, the card;
//  3. the prompt never answers: after 30 s the request is given up, a message and Try again.
// Also: the card already on the start screen, a visible label under each step's dot (the current one marked), and the
// approval saying plainly that every invoice waits for a signature here (the agents may pay none alone).
// npx tsx test/browser/try-inapp.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, type Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { APPROVE, INAPP, STEPS, WORK } from "../../cloud/src/tryCopy.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8990 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-inapp-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-inapp-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "r".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: { claude: false },
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });
const admin = (body: unknown) => handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env);
for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", 50]] as const) ok((await admin({ op: "set", key, value })).status === 200, `switch ${key}`);

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, r));


/** WhatsApp's in-app browser on an iPhone: Safari's engine, its own token at the end. */
const WHATSAPP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 WhatsApp/24.22.79";
const FAIL = {
  none: "delete window.PublicKeyCredential;",
  refused: "if (navigator.credentials) { navigator.credentials.create = () => Promise.reject(new DOMException('The operation is not allowed in this context.', 'NotAllowedError')); navigator.credentials.get = navigator.credentials.create; }",
  hangs: "if (navigator.credentials) { navigator.credentials.create = (o) => new Promise((_, no) => { const s = o && o.signal; if (s) s.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))); }); navigator.credentials.get = navigator.credentials.create; }",
} as const;

const errors: string[] = [];
const browser = await chromium.launch();
const iphone = devices["iPhone 13"]!;

async function toApprove(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Start with a test company/ }).click();
  await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor();
  await page.locator(".samples .btn:not(.skel)").first().waitFor();
  await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click();
  await page.getByRole("button", { name: "File this invoice" }).click();
  await page.locator(".result .btn.primary").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: WORK.pay }).click();
  await page.getByRole("heading", { name: APPROVE.heading }).waitFor({ timeout: 30_000 });
  await page.locator(".receipt").waitFor({ timeout: 30_000 });
}
const mainEnabled = (page: Page) => page.locator("#main .btn.primary").last().evaluate((b) => !(b as HTMLButtonElement).hidden && !(b as HTMLButtonElement).disabled);

for (const [kind, script] of Object.entries(FAIL) as [keyof typeof FAIL, string][]) {
  const ctx = await browser.newContext({ ...iphone, userAgent: WHATSAPP_UA, colorScheme: "dark" });
  await ctx.addInitScript(script);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${kind}: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${kind}: ${m.text()}`); });
  const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${kind}-${name}.png`), fullPage: true }); };

  await page.goto(`${ORIGIN}/try`);
  // The start screen says it first: an in-app browser cannot use the passkey.
  const card = page.locator(".inapp");
  await card.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  ok(await card.first().isVisible(), `${kind}: the start screen shows "${INAPP.title}"`);
  ok(await page.getByRole("button", { name: INAPP.copy }).first().isVisible(), `${kind}: with "${INAPP.copy}"`);
  ok((await card.first().innerText()).includes(INAPP.ios), `${kind}: and, on an iPhone, how to open it in Safari`);
  await shot("1-start");

  await toApprove(page);
  // The steps: a visible word under each dot, the current one marked.
  const labels = await page.locator("ol.prog li .lbl").allInnerTexts();
  ok(labels.length === STEPS.order.length && labels.every((l) => l.trim().length > 0), `${kind}: every step's dot has its word (${labels.join(" · ")})`);
  ok((await page.locator('ol.prog li[aria-current="step"] .lbl').innerText()) === STEPS.names.approve, `${kind}: the current step is marked (${STEPS.names.approve})`);
  // The limit, plainly, where the approval is.
  ok((await page.locator("main").innerText()).includes(APPROVE.limit), `${kind}: the approval says "${APPROVE.limit}"`);
  await shot("2-approve");

  if (kind === "none") {
    ok(await card.first().isVisible(), "none: no WebAuthn: the Open in Safari card at the passkey step");
    ok(await mainEnabled(page), "none: and a button to try again, never a dead end");
  } else {
    await page.getByRole("button", { name: APPROVE.create }).click();
    if (kind === "hangs") await page.waitForTimeout(31_000);
    await page.locator('[role="status"] .note, [role="status"] p').first().waitFor({ timeout: 40_000 });
    const said = await page.locator("main").innerText();
    ok(kind === "hangs" ? said.includes(APPROVE.timeout) : said.includes(APPROVE.cancelled) || said.includes(APPROVE.failed), `${kind}: a plain message after the passkey failed`);
    ok(await mainEnabled(page), `${kind}: the button is back: try again, never a dead end`);
    ok(await card.first().isVisible(), `${kind}: and the Open in Safari card, in an in-app browser`);
  }
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  // Copy link copies this page's address; where the clipboard is refused, it shows the address to copy by hand.
  const copyIn = page.locator(".inapp:visible").first();
  await copyIn.getByRole("button", { name: INAPP.copy }).click();
  await copyIn.locator(".row .hint").filter({ hasText: /\S/ }).waitFor({ timeout: 5_000 }).catch(() => undefined);
  const after = await copyIn.locator(".row .hint").innerText();
  ok(after === INAPP.copied || after === `${ORIGIN}/try`, `${kind}: "${INAPP.copy}" says "${INAPP.copied}" or shows the address (${after})`);
  await shot("3-after");
  await ctx.close();
}

ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
console.log(failed ? `\ntry-inapp check: ${failed} problem(s)` : "\ntry-inapp check passes: the in-app card at the start and the passkey step, Try again after a refusal and a timeout, the step words, the limit line");
process.exit(failed ? 1 : 0);

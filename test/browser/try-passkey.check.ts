// /try when the passkey does not work (14 Nov, a tester stuck at step 3, Approve), in Chromium with iPhone emulation, on
// the real cloud with a real engine in this process (test money on the stand-in bank, no network beyond localhost).
// Four ways the passkey fails, each must leave a way on (no guess from the user agent; only what the browser answers):
//  1. no WebAuthn at all: "open this page in Safari or Chrome", its address to copy, and a button;
//  2. refused at once (NotAllowedError before a prompt could show): the same, and Try again;
//  3. cancelled after a while (the person closed the prompt): a plain line and Try again, no Safari advice;
//  4. a prompt that never answers: after 30 s it is given up, a plain line and Try again.
// Also: a visible word under each step's dot (the current one marked), and the approval saying plainly that every
// invoice waits for a signature, whatever its amount.
// npx tsx test/browser/try-passkey.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, type Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { APPROVE, OPEN, STEPS, WORK } from "../../cloud/src/tryCopy.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8990 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-passkey-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-passkey-"));
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


const FAIL = {
  none: "delete window.PublicKeyCredential;",
  refused: "if (navigator.credentials) { navigator.credentials.create = () => Promise.reject(new DOMException('The operation is not allowed in this context.', 'NotAllowedError')); navigator.credentials.get = navigator.credentials.create; }",
  cancelled: "if (navigator.credentials) { navigator.credentials.create = () => new Promise((_, no) => setTimeout(() => no(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError')), 2500)); navigator.credentials.get = navigator.credentials.create; }",
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
  const ctx = await browser.newContext({ ...iphone, colorScheme: "dark" });
  await ctx.addInitScript(script);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${kind}: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${kind}: ${m.text()}`); });
  const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${kind}-${name}.png`), fullPage: true }); };
  const copyRow = page.locator(".openl");

  await page.goto(`${ORIGIN}/try`);
  ok(!(await page.locator("main").innerText()).includes("WhatsApp"), `${kind}: the start screen names no messaging app`);
  ok((await copyRow.count()) === 0, `${kind}: and shows no "open elsewhere" advice before anything failed`);
  await toApprove(page);
  // The steps: a visible word under each dot, the current one marked.
  const labels = await page.locator("ol.prog li .lbl").allInnerTexts();
  ok(labels.length === STEPS.order.length && labels.every((l) => l.trim().length > 0), `${kind}: every step's dot has its word (${labels.join(" · ")})`);
  ok((await page.locator('ol.prog li[aria-current="step"] .lbl').innerText()) === STEPS.names.approve, `${kind}: the current step is marked (${STEPS.names.approve})`);
  // The limit, plainly, where the approval is.
  ok((await page.locator("main").innerText()).includes(APPROVE.limit), `${kind}: the approval says "${APPROVE.limit}"`);
  await shot("1-approve");

  if (kind !== "none") {
    await page.getByRole("button", { name: APPROVE.create }).click();
    if (kind === "hangs") await page.waitForTimeout(31_000);
    if (kind === "cancelled") await page.waitForTimeout(3_000);
    await page.locator('[role="status"] .note, [role="status"] p').first().waitFor({ timeout: 40_000 });
  }
  const said = await page.locator("main").innerText();
  const want = kind === "hangs" ? APPROVE.timeout : kind === "cancelled" ? APPROVE.cancelled : APPROVE.noPasskey;
  ok(said.includes(want), `${kind}: a plain line: "${want}"`);
  ok(await mainEnabled(page), `${kind}: and a button (${await page.locator("#main .btn.primary").last().innerText()}): never a dead end`);
  const advise = kind === "none" || kind === "refused";
  ok((await copyRow.isVisible()) === advise, `${kind}: ${advise ? "with" : "without"} this page's address to copy`);
  if (advise) {
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
    await copyRow.getByRole("button", { name: OPEN.copy }).click();
    await copyRow.locator(".hint").filter({ hasText: /\S/ }).waitFor({ timeout: 5_000 }).catch(() => undefined);
    const after = await copyRow.locator(".hint").innerText();
    ok(after === OPEN.copied || after === `${ORIGIN}/try`, `${kind}: "${OPEN.copy}" says "${OPEN.copied}" or shows the address (${after})`);
  }
  await shot("2-after");
  await ctx.close();
}

ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
console.log(failed ? `\ntry-passkey check: ${failed} problem(s)` : "\ntry-passkey check passes: no WebAuthn, a refusal, a cancel and a silent prompt each leave a way on; the step words; the limit line");
process.exit(failed ? 1 : 0);

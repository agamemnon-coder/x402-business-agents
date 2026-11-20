// T:0 at every payment, the agents' tokens and the Wallet button in Chromium, on this machine (20 Nov): the console as a
// guest opens the demo company (read only), the Agents tab shows each agent's token and its payments' T:0 ids, the
// Books tab shows "Booked in T:0" with the reconcile check, from the recorded live run (labelled). With passes
// configured (a throwaway certificate made at run time) the agents with a card get "Add to Apple Wallet" and the pass
// downloads as application/vnd.apple.pkpass; without, no button. No console or CSP error, nothing wider than a phone.
// npx tsx test/browser/partner-rails.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { passConfigFrom } from "../../cloud/src/walletPass.js";
import { throwawayPassEnv } from "../support/passCert.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 9190 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const RUN = JSON.parse(readFileSync(new URL("../../docs/runs/2026-11-20-partner-rails.json", import.meta.url), "utf8")) as { payments: { key: string; t0: { t0_id: string } }[]; tokens: { token_id: string }[] };
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "partner-rails-check-"));
const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "p".repeat(48), adminTokenSha256: createHash("sha256").update("x").digest("hex"),
  rpId: "localhost", origin: ORIGIN, mailDomain: "", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 } };
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function pass(label: string, width: number, height: number, withWallet: boolean): Promise<void> {
  if (withWallet) env.walletPass = passConfigFrom(throwawayPassEnv().env)!;
  else delete env.walletPass;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: shots ? 2 : 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/#/sign-in`);
  await page.click("#guest");
  await page.waitForSelector(".apptabs", { timeout: 20_000 });
  await page.goto(`${ORIGIN}/#/agents`);
  await page.waitForSelector(".prblock", { timeout: 20_000 });
  const agents = await page.locator(".view, main").first().innerText();
  ok(RUN.tokens.every((t) => agents.includes(t.token_id)), `${label}: every agent's token on its card`);
  // The card and Alta payments are the sourcing and support agents' (on the demo's cards); the transfer is the Payer's.
  ok(RUN.payments.filter((p) => p.key !== "c").every((p) => agents.includes(p.t0.t0_id)), `${label}: the agents' payments' T:0 ids on their cards`);
  ok(/not this company's figures/.test(agents), `${label}: labelled as the recorded sandbox run`);
  const buttons = await page.locator(".prwallet button").count();
  ok(withWallet ? buttons > 0 : buttons === 0, `${label}: ${withWallet ? "an" : "no"} Add to Apple Wallet button (${buttons})`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: Agents nothing wider than the window`);
  if (shots) await page.locator(".prblock").nth(1).screenshot({ path: join(shots, `cloud-partner-token-${label}.png`) });
  if (withWallet) {
    // The link the button follows: the pass, as a .pkpass.
    const res = await page.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem("purser.cloud.session") ?? "null") as { token?: string } | null;
      const r = await fetch("/v1/agents/sourcing/wallet-pass/link", { method: "POST", headers: s?.token ? { authorization: `Bearer ${s.token}` } : {} });
      if (!r.ok) return { status: r.status, type: await r.text() };
      const { url } = await r.json() as { url: string };
      const p = await fetch(new URL(url).pathname);
      return { status: p.status, type: p.ok ? p.headers.get("content-type") : `${await p.text()} ${url}` };
    });
    ok(res.status === 200 && res.type === "application/vnd.apple.pkpass", `${label}: the button's link serves the pass (${res.status} ${res.type})`);
  }
  await page.goto(`${ORIGIN}/#/books`);
  await page.waitForSelector(".prbooks", { timeout: 20_000 });
  const books = await page.locator(".prbooks").innerText();
  ok(RUN.payments.every((p) => books.includes(p.t0.t0_id)), `${label}: Books lists every payment's T:0 entry`);
  ok(/T:0 and every rail agree/.test(books), `${label}: Books shows the reconcile check`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: Books nothing wider than the window`);
  if (shots) await page.locator(".prbooks").screenshot({ path: join(shots, `cloud-partner-books-${label}.png`) });
  ok(errors.length === 0, `${label}: no console or page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
}

try {
  await pass("390", 390, 844, false);
  await pass("1440", 1440, 1000, true);
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.log(`partner-rails check: ${failed} failed`); process.exit(1); }
console.log("partner-rails check passes");

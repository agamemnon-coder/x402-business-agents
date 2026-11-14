// Screenshots of the guest console (the demo company, read only) at phone and desktop width, light and dark, for a
// person to look at. No network: the cloud is served on this machine over SQLite in memory and a folder.
// npx tsx test/browser/support/guestShots.ts <dir> [route,route,...]   (WIDTHS=390,1440 SCHEMES=light,dark)
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../../cloud/src/node.js";

const out = process.argv[2] ?? "shots";
const routes = (process.argv[3] ?? "overview,agents,invoices,books,transactions,tokenisation").split(",");
const widths = (process.env.WIDTHS ?? "390,1440").split(",").map(Number);
const schemes = (process.env.SCHEMES ?? "light,dark").split(",") as ("light" | "dark")[];
mkdirSync(out, { recursive: true });
const PORT = 9300 + Math.floor(Math.random() * 300);
const ORIGIN = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "guest-shots-"));
const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "g".repeat(48), adminTokenSha256: createHash("sha256").update("x").digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  // The Worker's static assets: pdf.js, as npm run cloud:pdfjs copies it.
  asset: async (path) => (path === "/assets/pdfjs.mjs" ? new Response(readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")))) : null) };
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
const browser = await chromium.launch();
const errors: string[] = [];
for (const scheme of schemes) for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/#/guest`);
  await page.waitForSelector("#tabs a[aria-current]", { timeout: 15000 });
  for (const r of routes) {
    await page.goto(`${ORIGIN}/#/${r}`);
    await page.waitForTimeout(700);
    // Tokenisation: one stage opened, to show its transactions (and that a tap reveals them).
    if (r === "tokenisation" && process.env.OPEN_STAGE) { await page.locator(".tnode").nth(Number(process.env.OPEN_STAGE)).click(); if (!(await page.locator("#tpanel ul.thash li").count())) errors.push("tokenisation: a tapped stage shows no transaction"); }
    if (r.startsWith("invoices/")) await page.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 15000 }).catch(() => { errors.push(`${r}: no PDF drawn`); });
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push(`${r} ${width} ${scheme}: wider than the screen`);
    // The whole page in one viewport (a full-page capture leaves an iframe below the first screen unpainted).
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height: Math.min(h, 12000) });
    await page.waitForTimeout(r.startsWith("invoices/") ? 1200 : 200);
    await page.screenshot({ path: join(out, `${r.replace(/[^a-z0-9]+/gi, "_")}-${width}-${scheme}.png`) });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(errors.length ? errors.join("\n") : "no errors");

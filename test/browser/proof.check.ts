// "Verify it yourself" (15 Nov) in Chromium, on this machine: /try on the real cloud with a real engine in this process
// (cloud/src/engine/node.ts: test money on the stand-in bank, a CDP virtual passkey, no network beyond localhost).
// 1. /try: a clean invoice approved with the passkey and paid; Paid offers "Download the proof (JSON)", and the file is
//    the pay route's bundle. Then the amount changed by one cent is refused, and the refusal offers its own proof.
// 2. /verify, under its own CSP (connect-src 'none', the page's hashes): each downloaded file, dropped in through the
//    file picker, passes every check line; the two sample buttons pass; the pasted paid file with one cent changed
//    fails on the terms hash. At 1440 and 390 px; nothing wider than the screen; no console or CSP error.
// With --write, the two downloaded files become the samples committed under docs/proof/ (try-paid.json, try-refused.json).
// With --live, the same walk on the deployed site: /try on purser-try (its own rpId, test money only) and /verify on kit11.
// npx tsx test/browser/proof.check.ts [screenshot dir] [--write] [--live]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { APPROVE, BOOKS, PAY, TAMPER, VERIFY_YOURSELF, WORK } from "../../cloud/src/tryCopy.js";
import { verifyProofBundle, type ProofBundle } from "../../src/proof/bundle.js";
import { VERIFY_BUNDLE_VERDICT, verifyBundlePage } from "../../src/proof/verifyPage.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const shots = args.find((a) => !a.startsWith("--")) ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const LIVE = args.includes("--live");
const PORT = 9090 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
/** Where /try and /verify are: here, one local server; live, the deployed hands-on demo and the site. */
const TRY_ORIGIN = LIVE ? "https://purser-try.max-31b.workers.dev" : ORIGIN;
const VERIFY_ORIGIN = LIVE ? "https://kit11.max-31b.workers.dev" : ORIGIN;
const ADMIN = "proof-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "proof-check-"));
// /verify as the site serves it: the page and a CSP made as src/servers/dashboard.ts makes VERIFY_BUNDLE_CSP.
const bundles: { paid?: ProofBundle; refused?: ProofBundle } = {};
const inlineHash = (page: string, tag: "script" | "style") => `'sha256-${createHash("sha256").update(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(page)![1]!, "utf8").digest("base64")}'`;
const verifyPage = () => {
  const html = verifyBundlePage({ paid: bundles.paid, refused: bundles.refused });
  const csp = ["default-src 'none'", `script-src ${inlineHash(html, "script")}`, `style-src ${inlineHash(html, "style")}`, "connect-src 'none'", "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  return { html, csp };
};

let server: ReturnType<typeof createServer> | null = null;
if (!LIVE) {
  const env: CloudEnv = {
    sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "p".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
    rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: { claude: false },
  };
  env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });
  const admin = (body: unknown) => handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env);
  for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", 50]] as const) ok((await admin({ op: "set", key, value })).status === 200, `switch ${key}`);
  server = createServer(async (req, res) => {
    if (req.url === "/verify") {
      const v = verifyPage();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": v.csp });
      return res.end(v.html);
    }
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
  await new Promise<void>((r) => server!.listen(PORT, r));
}

const errors: string[] = [];
const browser = await chromium.launch();
const fits = async (page: Page, width: number, where: string) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `${where}: nothing wider than ${width} px`);
const shot = async (page: Page, name: string) => { if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); } };
const take = async (page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> => {
  const dl = page.waitForEvent("download");
  await click();
  const d = await dl;
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), "utf8") };
};

// 1. /try: paid, then the one-cent refusal, each with its proof.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`try: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`try: ${String(e)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${TRY_ORIGIN}/try?v=1`);
  await page.getByRole("button", { name: /Start the live demo|Start with a test company/ }).click();
  await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor();
  await page.locator(".samples .btn:not(.skel)").first().waitFor();
  await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click();
  await page.getByRole("button", { name: "File this invoice" }).click();
  await page.locator(".result .btn.primary").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: WORK.pay }).click();
  await page.getByRole("button", { name: APPROVE.create }).click({ timeout: 30_000 });
  const approve = page.getByRole("button", { name: /^Approve EUR 1,850\.00 with/ });
  await approve.waitFor({ timeout: 30_000 });
  await approve.click();
  await page.locator(".paidstamp").waitFor({ timeout: 30_000 });
  const dlPaid = page.getByRole("button", { name: VERIFY_YOURSELF.download });
  await dlPaid.waitFor({ timeout: 20_000 });
  ok(true, `Paid offers "${VERIFY_YOURSELF.download}"`);
  await shot(page, "try-paid-proof");
  const paidFile = await take(page, () => dlPaid.click());
  bundles.paid = JSON.parse(paidFile.text) as ProofBundle;
  ok(paidFile.name === VERIFY_YOURSELF.file && bundles.paid.decision.outcome === "paid" && bundles.paid.rp_id === new URL(TRY_ORIGIN).hostname && bundles.paid.origin === TRY_ORIGIN, `the paid proof downloads as ${paidFile.name}: outcome paid, rpId ${bundles.paid.rp_id}`);
  const nodeOk = await verifyProofBundle(bundles.paid);
  ok(nodeOk.ok, `the paid proof passes the Node checks too (${nodeOk.checks.filter((c) => !c.ok).map((c) => c.check).join(", ") || "all"})`);

  // The one-cent change, with the kept signature: refused, and the refusal has its own proof.
  await page.click(`button.cheat:has-text("${BOOKS.cheat}")`);
  // Since 15 Nov the page fills in the one-cent change itself (one cent more than the signed EUR 1,850.00); typed again
  // here with a comma, as a person might.
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", undefined, { timeout: 20_000 });
  await page.fill("#p-amt", "1850,01");
  await page.getByRole("button", { name: PAY.button }).click();
  await page.locator(".why .head").waitFor({ timeout: 30_000 });
  ok((await page.locator(".why .head").textContent()) === `${TAMPER.refused} ${TAMPER.head}`, "one cent more is refused");
  const dlRefused = page.locator(".why").getByRole("button", { name: VERIFY_YOURSELF.download });
  ok(await dlRefused.count() === 1, `the refusal offers "${VERIFY_YOURSELF.download}"`);
  await shot(page, "try-refused-proof");
  const refusedFile = await take(page, () => dlRefused.click());
  bundles.refused = JSON.parse(refusedFile.text) as ProofBundle;
  ok(bundles.refused.decision.outcome === "refused" && bundles.refused.asked?.terms.amount === "1850.01" && bundles.refused.terms.amount === "1850.00", "the refused proof holds the signed terms (1850.00) and the asked ones (1850.01)");

  // The finish links to /verify.
  await page.getByRole("button", { name: PAY.back, exact: true }).click();
  await page.getByRole("button", { name: BOOKS.what }).click();
  await page.getByRole("button", { name: "Your company" }).click();
  const link = page.getByRole("link", { name: VERIFY_YOURSELF.verify });
  await link.waitFor({ timeout: 20_000 });
  ok((await link.getAttribute("href"))?.endsWith("/verify"), `the finish links "${VERIFY_YOURSELF.verify}" to /verify`);
  await ctx.close();
}

// 2. /verify at 1440 and 390: the files, the samples, and one cent changed.
for (const width of [1440, 390]) {
  const tag = `verify-${width}`;
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // This server is not the site: the site's own assets (its font, its icons) are not here; any other 404 is a fault.
  const missing: string[] = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${tag}: ${String(e)}`));
  let requests = 0;
  page.on("request", (r) => { if (!r.url().startsWith("data:") && !r.url().endsWith("/verify") && !/\/assets\//.test(r.url())) requests++; });
  await page.goto(`${VERIFY_ORIGIN}/verify`);
  const verdict = async () => { await page.locator("#v-verdict:not([hidden])").waitFor(); return { ok: await page.getAttribute("#v-verdict", "data-ok"), failed: await page.getAttribute("#v-verdict", "data-failed"), lines: await page.locator("#v-checks li").count(), pass: await page.locator("#v-checks li.ok").count() }; };
  for (const [name, b] of Object.entries(bundles)) {
    const f = join(dir, `${name}-${width}.json`);
    writeFileSync(f, JSON.stringify(b, null, 2));
    await page.setInputFiles("#v-file", f);
    await page.waitForFunction((n) => (document.getElementById("v-status")?.textContent ?? "").includes(n), `${name}-${width}.json`);
    const v = await verdict();
    ok(v.ok === "true" && v.lines >= 10 && v.pass === v.lines, `${tag}: the ${name} proof from /try passes every line (${v.pass}/${v.lines})`);
    // 19 Nov 2026 (live review: a big green "VALID 11 of 11" over a refused payment): the headline says what is valid.
    const head = (await page.textContent("#v-verdict b")) ?? "";
    ok(head === (name === "refused" ? VERIFY_BUNDLE_VERDICT.validRefused : VERIFY_BUNDLE_VERDICT.valid), `${tag}: the ${name} proof's headline reads "${head}"`);
    if (name === "refused") ok((await page.locator('#v-checks li[data-check="asked terms"]').innerText()).includes("cannot cover them"), `${tag}: the refusal's line shows the asked terms hash differently`);
    const refusalLine = await page.locator("#v-means-refusal").evaluate((li) => !(li as HTMLElement).hidden);
    ok(refusalLine === (name === "refused"), `${tag}: "What this proves" names the refusal ${name === "refused" ? "for the refused proof" : "not for the paid proof"}`);
  }
  await page.click("#v-sample");
  let v = await verdict();
  ok(v.ok === "true" && v.pass === v.lines, `${tag}: "Load a sample bundle" passes (${v.pass}/${v.lines})`);
  await shot(page, `${tag}-sample`);
  await fits(page, width, tag);
  await page.click("#v-sample-refused");
  v = await verdict();
  ok(v.ok === "true", `${tag}: the refused sample passes`);
  ok((await page.textContent("#v-verdict b")) === VERIFY_BUNDLE_VERDICT.validRefused, `${tag}: the refused sample's headline says the proof is valid and the payment refused`);
  await shot(page, `${tag}-refused`);
  const changed = { ...bundles.paid!, terms: { ...bundles.paid!.terms, amount: "1850.01" } };
  await page.fill("#v-paste", JSON.stringify(changed));
  await page.click("#v-check");
  await page.waitForFunction(() => document.getElementById("v-verdict")?.getAttribute("data-ok") === "false");
  v = await verdict();
  ok(v.ok === "false" && (v.failed ?? "").split(",").includes("terms hash") && (await page.textContent("#v-verdict"))!.startsWith(VERIFY_BUNDLE_VERDICT.invalid), `${tag}: one cent changed in the pasted file fails (${v.failed})`);
  await shot(page, `${tag}-changed`);
  await fits(page, width, `${tag} changed`);
  ok(requests === 0, `${tag}: the page asked no server for anything (${requests})`);
  ok(missing.every((p) => p.startsWith("/assets/") || /^\/(favicon\.(ico|svg)|apple-touch-icon\.png|icon\.png)$/.test(p)), `${tag}: only the site's own assets are missing here (${[...new Set(missing)].join(", ") || "none"})`);
  await ctx.close();
}

ok(errors.length === 0, `no console or CSP error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
if (write && failed === 0) {
  mkdirSync("docs/proof", { recursive: true });
  for (const [name, b] of Object.entries(bundles)) writeFileSync(`docs/proof/try-${name}.json`, `${JSON.stringify(b, null, 2)}\n`);
  console.log("wrote docs/proof/try-paid.json and docs/proof/try-refused.json");
}
await browser.close();
server?.close();
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);

// The hands-on page (/try) after the critical review of 13 Nov (try-fixes-1113), in Chromium, on the real cloud with a
// real engine in this process (cloud/src/engine/node.ts): test money on the stand-in bank, a CDP virtual passkey, no
// network beyond localhost. At 360, 390 and 1440 px, light and dark, one visit each:
//  1. a fresh test company starts with a paid invoice, so both duplicate samples are caught (never "Ready to pay");
//  2. the browser's Back returns to the step before;
//  3. the timeline (the agents' events stood in for here, as only Claude's turns write them): no empty "Purser
//     recorded a step." row, no repeated row, "its own words" only on a model's reason, the Coder's VAT line says who
//     booked it, and the last row's time equals "Answered in"; at 1440 the Pay button is above the fold;
//  4. the approval shows the conversion, the fee's cap and the deadline, and the full terms pretty-printed;
//  5. Paid shows its three blocks before "File another invoice", the ledger fits the screen (amounts right-aligned, nothing cut), the Cloud link says
//     it is a sample company, and "File another invoice" keeps the same company;
//  6. Start again asks first. Nothing is wider than the screen; no console error.
// npx tsx test/browser/try-review.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { APPROVE, BOOKS, COMPANY, INVOICE, LIVE, WHY, WORK } from "../../cloud/src/tryCopy.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8990 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-review-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-review-"));
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

/** The agents' rows as a Claude turn writes them (src/engine/events.ts), 2.3 s apart in all; seq far past the real ones. */
function agentEvents(): unknown[] {
  const t0 = Date.now();
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  const e = (seq: number, ms: number, actor: string, event: string, fields: Record<string, unknown>, subject: string | null = null) => ({ seq, ts: at(ms), actor, event, subject, fields });
  return [
    e(901, 0, "system", "claude.asking", { role: "reader", model: "claude-sonnet-4-5" }),
    e(902, 300, "treasury", "setting.changed", {}),
    e(903, 350, "treasury", "setting.changed", {}),
    e(904, 900, "claude", "claude.read", { source: "claude", model: "claude-sonnet-4-5", request_id: "req_stub_1" }),
    e(905, 950, "claude", "claude.read", { source: "claude", model: "claude-sonnet-4-5", request_id: "req_stub_1" }),
    e(906, 1100, "system", "ap.received", { status: "ready", amount: "1850.00", currency: "EUR", findings: "" }),
    e(907, 1500, "checker", "ap.checker_decided", { source: "claude", model: "claude-haiku-4-5", action: "pay", outcome: "ask_cfo", reason: "Bergtex is on file and the totals add up.", enforced: "The agent may pay no invoice alone." }),
    e(908, 1600, "system", "ap.checker_decided", { source: "fallback", action: "ask_cfo", outcome: "ask_cfo", reason: "The amount is over what an agent pays alone." }),
    e(909, 1900, "treasury", "ap.coded", { source: "claude", model: "claude-haiku-4-5", account: "6200", vat_code: null, reason: "Linen fabric for production, an expense." }),
    e(910, 2300, "payer", "ap.payer_proposed", { source: "claude", model: "claude-haiku-4-5", rail: "bank_swift", pay_on: "2026-11-28", pay_currency: "EUR", outcome: "ask_cfo", reason: "Due on the 30th; paying on the 28th keeps the float." }),
  ];
}

const errors: string[] = [];
const browser = await chromium.launch();
const fits = async (page: Page, width: number, where: string) => ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `${where}: nothing wider than ${width} px`);
const heading = (page: Page) => page.locator("main h1").innerText();
const pick = async (page: Page, title: string) => {
  await page.locator(".samples .btn:not(.skel)").first().waitFor();
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "File this invoice" }).click();
  await page.locator(".result .btn.primary").waitFor({ timeout: 30_000 });
};

for (const width of [360, 390, 1440]) for (const scheme of ["light", "dark"] as const) {
  const tag = `${width}-${scheme}`;
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${tag}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${tag}: ${String(e)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const shot = async (name: string) => { if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: join(shots, `${tag}-${name}.png`), fullPage: true }); } };

  await page.goto(`${ORIGIN}/try?v=1`);
  await page.getByRole("button", { name: /Start with a test company/ }).click();
  await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor();
  const tenant = await page.evaluate(() => JSON.parse(sessionStorage.getItem("purser.try") ?? "{}").tenant);

  // 1. The duplicates, first thing in a fresh company.
  await pick(page, "An invoice you already paid, sent again");
  let text = await page.locator("main").innerText();
  // 14 Nov (owner): why, big and first, then the paid original beside this copy.
  ok(text.includes(WHY.again.head) && !text.includes(WORK.ready), `${tag}: the same file again is caught, not "Ready to pay"`);
  ok(/Bergtex Textil GmbH · BTX-2026-17 · EUR 1,620\.00 · paid \d{1,2} \w{3} \d{4}/.test(text) && text.includes(WHY.again.rule), `${tag}: it names the paid original and the rule`);
  await shot("1-duplicate");
  await fits(page, width, `${tag} duplicate`);
  await page.getByRole("button", { name: WORK.another }).click();
  await pick(page, "A paid invoice under a new number");
  text = await page.locator("main").innerText();
  ok(text.includes(WHY.codes.possible_duplicate!.headPaid!) && text.includes(WHY.codes.possible_duplicate!.rule!) && /BTX-2026-17 · EUR 1,620\.00 · paid/.test(text) && /BTX-2026-17A · EUR 1,620\.00 · dated/.test(text) && !text.includes(WORK.ready), `${tag}: the renumbered copy is held as a possible duplicate, the paid original beside it`);
  await shot("1-renumbered");

  // 2. Back: to the invoice screen, then forward to the same answer (never filed again).
  const docsBefore = await page.evaluate(async () => { const S = JSON.parse(sessionStorage.getItem("purser.try")!); return (await (await fetch("/v1/engine/invoices", { headers: { authorization: `Bearer ${S.session}` } })).json()).items.length; });
  await page.goBack();
  ok((await heading(page)).startsWith("An invoice comes in"), `${tag}: Back returns to the invoice screen`);
  await page.goForward();
  await page.locator(".result .btn.primary").waitFor();
  const docsAfter = await page.evaluate(async () => { const S = JSON.parse(sessionStorage.getItem("purser.try")!); return (await (await fetch("/v1/engine/invoices", { headers: { authorization: `Bearer ${S.session}` } })).json()).items.length; });
  ok((await page.locator("main").innerText()).includes("BTX-2026-17A") && docsAfter === docsBefore, `${tag}: Forward shows the same answer and files nothing again`);
  await page.getByRole("button", { name: WORK.another }).click();

  // 2b. Round 4 (14 Nov): a held invoice whose reader asked Claude twice (classify, then read), one call answered and
  // one not by the time Purser answered, the engine's rows written out of time order: no row stays on "asking…", nothing
  // keeps counting, the call left without an answer says so, and the rows stand in the engine's time order.
  {
    const t0 = Date.now();
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    const held = [
      { seq: 801, ts: at(0), actor: "system", event: "claude.asking", subject: null, fields: { role: "classifier", model: "claude-haiku-5-5" } },
      { seq: 802, ts: at(100), actor: "system", event: "claude.asking", subject: null, fields: { role: "reader", model: "claude-haiku-5-5" } },
      { seq: 803, ts: at(1800), actor: "system", event: "ap.received", subject: null, fields: { status: "blocked", amount: "2380.00", currency: "EUR", findings: "possible_fraud" } },
      { seq: 804, ts: at(900), actor: "claude", event: "claude.read", subject: null, fields: { source: "claude", model: "claude-haiku-5-5", request_id: "req_round4" } },
    ];
    let once = true;
    await page.route(/\/v1\/engine\/events\?/, async (route) => {
      if (!once) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], next: 804 }) });
      once = false;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: held, next: 804 }) });
    });
    await page.route("**/v1/engine/samples/bank", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
    await pick(page, "An invoice with new bank details");
    await page.unroute("**/v1/engine/samples/bank");
    await page.waitForTimeout(1500);
    const all = page.getByRole("button", { name: LIVE.allSteps }); if (await all.isVisible()) await all.click();
    const rows = await page.locator("ol.live li").evaluateAll((lis) => lis.map((li) => li.textContent ?? ""));
    // Round 2 (14 Nov, jury): the reader's two calls and its answer are one row ("Reader · Claude Haiku 5.5 · 2 calls").
    ok(rows.length === 2 && !rows.some((r) => r.includes(LIVE.ev["claude.asking"]!)), `${tag}: held: no row stays on "asking…" (${rows.join(" | ")})`);
    ok(rows[0]!.startsWith(`${LIVE.reader} · Claude Haiku 5.5 · ${LIVE.calls.replace("{n}", "2")}`) && rows[0]!.includes(LIVE.ev["claude.read"]!) && !rows[0]!.includes(LIVE.noAnswer), `${tag}: held: the reader's calls are one row, with its answer (${rows[0]})`);
    ok(rows[1]!.includes("came in and was checked"), `${tag}: held: the rows in the engine's time order`);
    const secs = (await page.locator("ol.live li .t").allInnerTexts()).map((x) => Number(/^\+([\d.]+) s$/.exec(x)?.[1]));
    const before = secs.join(",");
    await page.waitForTimeout(1200);
    ok(secs.length === 2 && secs[0]! > 0 && secs.every((x, i) => Number.isFinite(x) && (i === 0 || x > secs[i - 1]!)) && (await page.locator("ol.live li .t").allInnerTexts()).map((x) => Number(/^\+([\d.]+) s$/.exec(x)?.[1])).join(",") === before, `${tag}: held: the times rise row by row and nothing keeps counting (${before})`);
    await page.unroute(/\/v1\/engine\/events\?/);
    await page.getByRole("button", { name: WORK.another }).click();
  }

  // 3. The clean invoice, with the agents' rows stood in for, and its answer held 2.5 s.
  let stub = false;
  await page.route(/\/v1\/engine\/events\?/, async (route) => {
    if (!stub) return route.continue();
    stub = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: agentEvents(), next: 950 }) });
  });
  await page.route("**/v1/engine/samples/clean", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  await page.locator(".samples .btn:not(.skel)").first().waitFor();
  stub = true;
  await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click();
  await page.getByRole("button", { name: "File this invoice" }).click();
  await page.locator(".result .btn.primary").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: LIVE.allSteps }).click();
  const live = await page.locator("ol.live").innerText();
  ok(!live.includes(LIVE.step), `${tag}: no "${LIVE.step}" row`);
  ok(live.split("Answered live").length === 2, `${tag}: Claude's answer is one row, not two`);
  const rows = await page.locator("ol.live li").evaluateAll((lis) => lis.map((li) => li.textContent ?? ""));
  const codeRow = rows.find((r) => r.startsWith("Checker agent · Purser's code")) ?? "";
  ok(codeRow.includes("Decided: ask the CFO, because the amount") && !codeRow.includes(LIVE.ownWords), `${tag}: a code check's reason is plain, never "${LIVE.ownWords}"; its action in words`);
  ok(rows.some((r) => r.startsWith("Checker agent · Claude") && r.includes(LIVE.ownWords)), `${tag}: a model's reason is marked as its own words`);
  ok(rows.some((r) => r.includes(`6200 expense, VAT ${LIVE.noVat}`)), `${tag}: the Coder's VAT line says Purser's code books it, as the ledger does`);
  ok(rows.some((r) => r.includes("pay on 28 Nov 2026 by a SWIFT bank transfer")), `${tag}: the Payer's date and rail in words`);
  ok(!/\b(?!asking…)\w+…/.test(live) && !/ask_cfo|ask cfo|bank swift/.test(live), `${tag}: no raw values, no word cut off`);
  const answered = /[Aa]nswered in ([\d.]+) s/.exec(await page.locator(".result").innerText())?.[1];
  const times = await page.locator("ol.live li .t").allInnerTexts();
  ok(answered !== undefined && times.at(-1) === `+${answered} s`, `${tag}: the last row's time (${times.at(-1)}) is "Answered in ${answered} s": one clock`);
  const pay = page.getByRole("button", { name: WORK.pay });
  if (width >= 1024) {
    const box = await pay.boundingBox();
    ok(box !== null && box.y + box.height <= 900, `${tag}: "${WORK.pay}" is above the fold`);
    ok((await page.locator("main").evaluate((m) => m.getBoundingClientRect().width)) > 900, `${tag}: the page uses the width`);
  }
  await shot("3-work-timeline");
  await fits(page, width, `${tag} work`);
  await page.unroute(/\/v1\/engine\/events\?/);

  // 4. The approval: every signed term in words, the terms pretty-printed, and the label of what runs.
  await pay.click();
  const create = page.getByRole("button", { name: APPROVE.create });
  await create.waitFor({ timeout: 30_000 });
  text = await page.locator("main").innerText();
  ok(/Conversion\s+EUR [\d,]+\.\d{2} of it funded from the USD balance \(USD [\d,]+\.\d{2}; 1 EUR = \d\.\d{4,6} USD\)/.test(text), `${tag}: the approval shows the conversion`);
  ok(/Bank fee\s+at most EUR 20\.00/.test(text), `${tag}: the approval shows the fee's cap`);
  ok(/Sign before\s+\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/.test(text), `${tag}: the approval shows its deadline`);
  ok(/Due\s+30 Nov 2026/.test(text), `${tag}: dates as 30 Nov 2026`);
  await page.getByText(APPROVE.terms).click();
  ok(/\n {2}"amount": "1850\.00",\n/.test(await page.locator("pre.terms").innerText()), `${tag}: the full terms, pretty-printed`);
  ok(!text.includes("Filing the payment"), `${tag}: no "Filing the payment…"`);
  await shot("4-approve");
  await fits(page, width, `${tag} approve`);
  await create.click();
  const approve = page.getByRole("button", { name: /^Approve EUR 1,850\.00 with/ });
  await approve.waitFor({ timeout: 30_000 });
  await approve.click();

  // 5. Paid: three blocks, the ledger whole, the Cloud link said for what it is, another invoice in the same company.
  await page.locator(".paidstamp").waitFor({ timeout: 30_000 });
  ok((await page.locator(".slot .sk-blk, .slot .blk").count()) >= 2, `${tag}: Paid shows its blocks (or their skeletons) at once`);
  // final-polish, 13 Nov: "File another invoice" never shows under a skeleton; when it shows, all three blocks are drawn.
  await page.getByRole("button", { name: BOOKS.another }).waitFor({ timeout: 20_000 });
  ok((await page.locator(".slot .sk-blk").count()) === 0, `${tag}: "${BOOKS.another}" shows only once no block is a skeleton`);
  await page.locator(".blk.paid:not(.sk-blk)").waitFor({ timeout: 15_000 });
  await page.locator(".blk.booked:not(.sk-blk)").waitFor({ timeout: 15_000 });
  await page.locator(".blk.filed:not(.sk-blk)").waitFor({ timeout: 15_000 });
  ok(true, `${tag}: Paid, Booked and Filed all drawn`);
  const cells = await page.locator("table.lines td.r:not(.none)").evaluateAll((tds) => tds.map((td) => { const r = td.getBoundingClientRect(); return { right: r.right, overflow: td.scrollWidth > td.clientWidth + 1, align: getComputedStyle(td).textAlign, nums: getComputedStyle(td).fontVariantNumeric } }));
  ok(cells.length >= 6 && cells.every((c) => c.right <= width && !c.overflow), `${tag}: every ledger amount is whole and on screen`);
  ok(cells.every((c) => c.align === "right" && c.nums.includes("tabular-nums")), `${tag}: amounts right-aligned in tabular figures`);
  if (width < 600) ok(/Dr EUR 1,850\.00/.test(await page.locator(".blk.booked").innerText()), `${tag}: on a phone each line names its side`);
  text = await page.locator("main").innerText();
  ok(text.includes(BOOKS.next) && text.includes(BOOKS.cloudNote) && !text.includes("Open Purser Cloud"), `${tag}: the Cloud link says it is a sample company`);
  await shot("5-paid");
  await fits(page, width, `${tag} paid`);
  await page.getByRole("button", { name: BOOKS.another }).click();
  ok((await heading(page)).startsWith("An invoice comes in") && (await page.evaluate(() => JSON.parse(sessionStorage.getItem("purser.try") ?? "{}").tenant)) === tenant, `${tag}: "${BOOKS.another}" keeps the same company`);
  await page.goBack();
  await page.locator(".paidstamp").waitFor();
  ok(true, `${tag}: Back returns to Paid`);

  // 6. Your company: Start again asks first.
  await page.getByRole("button", { name: BOOKS.what }).click();
  await page.getByRole("button", { name: "Your company" }).click();
  await page.getByRole("button", { name: COMPANY.download }).waitFor();
  // 14 Nov (owner): the records as a PDF from the cloud's own route, its button and the JSON link fitting the width.
  const dlPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: COMPANY.download }).click();
  const pdfDl = await dlPdf;
  const { readFileSync } = await import("node:fs");
  const pdfBytes = readFileSync(await pdfDl.path());
  ok(pdfDl.suggestedFilename() === "purser-test-company-records.pdf" && pdfBytes.subarray(0, 5).toString() === "%PDF-", `${tag}: the records download as a PDF from the cloud's route (${pdfBytes.length} bytes)`);
  ok(await page.getByRole("button", { name: COMPANY.json }).isVisible(), `${tag}: "${COMPANY.json}" is offered under the button row`);
  await page.getByRole("button", { name: COMPANY.again }).click();
  ok((await heading(page)).startsWith("Your company") && (await page.getByText(COMPANY.againAsk).isVisible()), `${tag}: Start again asks first`);
  await page.getByRole("button", { name: COMPANY.againNo }).click();
  ok((await page.getByRole("button", { name: COMPANY.again }).isVisible()), `${tag}: keeping the company leaves it as it was`);
  await shot("6-company");
  await fits(page, width, `${tag} company`);
  await ctx.close();
}

// 7 (14 Nov, owner: "with the sandbox you should always be able to override and try it again"), at 390 px: the same
// sample again in the same company is a fresh invoice, ready to pay; the visitor's own invoice for the same total from the
// same supplier is held, and "Clear it and sign anyway (sandbox)" leads to the approval (the passkey still signs); new
// bank details can only be rejected, and Reject says nothing is paid.
{
  const tag = "rerun-390";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${String(e)}`));
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.getByRole("button", { name: /Start with a test company/ }).click();
  await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor();
  await pick(page, "A supplier's invoice");
  ok((await page.locator("main").innerText()).includes(WORK.ready), `${tag}: the clean sample is ready to pay`);
  await page.goBack();
  await pick(page, "A supplier's invoice");
  let text = await page.locator("main").innerText();
  ok(text.includes(WORK.ready) && text.includes("BTX-2026-31") && !text.includes(WHY.again.head), `${tag}: the same sample again is a fresh invoice (BTX-2026-31), ready to pay, not held`);
  await page.goBack();
  await page.getByRole("tab", { name: INVOICE.tabWrite }).click();
  await page.waitForFunction(() => (document.querySelector("#f-iban") as HTMLInputElement | null)?.value !== "");
  await page.fill("#f-no", "INV-8807");
  await page.fill("#f-amt", "1850.00");
  await page.getByRole("button", { name: INVOICE.send }).click();
  await page.getByRole("button", { name: WORK.override }).waitFor({ timeout: 30_000 });
  text = await page.locator("main").innerText();
  ok(text.includes(WHY.codes.possible_duplicate!.rule!) && text.includes(WORK.overrideNote) && await page.locator("main .btn.primary:visible").count() === 1, `${tag}: the same total from the same supplier is held, with the sandbox override as the one main button and its note`);
  await page.getByRole("button", { name: WORK.override }).click();
  await page.getByRole("heading", { name: APPROVE.heading }).waitFor({ timeout: 30_000 });
  ok(true, `${tag}: cleared in the sandbox, it goes to the approval: the passkey still signs the exact terms`);
  // A fresh company for the rest, in a new tab (this one returns to its approval, as a reload should).
  await page.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${String(e)}`));
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.getByRole("button", { name: /Start with a test company/ }).click();
  await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor();
  await pick(page, "An invoice with new bank details");
  ok(await page.getByRole("button", { name: WORK.override }).count() === 0 && await page.getByRole("button", { name: WORK.reject }).isVisible(), `${tag}: new bank details: no override, only Reject`);
  await page.getByRole("button", { name: WORK.reject }).click();
  await page.getByText(WORK.rejected).waitFor();
  ok(await page.locator("main .btn.primary:visible").count() === 1 && (await page.locator("main .btn.primary:visible").innerText()).includes(WORK.another), `${tag}: rejected, nothing is paid; the way on is another invoice`);
  await ctx.close();
}

ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);

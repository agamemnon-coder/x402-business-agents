// 4.1 The agent trace in a browser: the dashboard on a throwaway ledger where the Sourcing agent ran (fake Claude
// client, no chain), at phone (390 px) and laptop (1440 px) width, light and dark. Opens the trace from the decision's
// feed line and checks the timeline: five steps, the refused call named with its check, the Alta tx link, each row's
// hash, the dialog fits the screen, Escape closes it and focus goes back. Fails on any console or page error and on
// "null", "undefined" or "NaN" on screen.
//   npx tsx test/browser/trace.check.ts [screenshot dir]
import type Anthropic from "@anthropic-ai/sdk";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import { runAgent } from "../../src/agents/loop.js";
import { audit } from "../../src/audit/log.js";
import { openDb } from "../../src/db/open.js";
import { dashboardApp } from "../../src/servers/dashboard.js";

const shots = process.argv[2] ?? "test-results/trace";
mkdirSync(shots, { recursive: true });
const TX = `0x${"ab".repeat(32)}`;

const db = openDb(":memory:");
let i = 0;
const turns = [[{ name: "check_offer", input: {} }], [{ name: "try_purchase", input: {} }]];
const client = { beta: { messages: { create: async () => {
  const t = turns[i++];
  const usage = { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
  if (!t) return { content: [{ type: "text", text: "Stockline now charges 0.04; my cap is 0.03, so Alta refused #41. I need a cap of 0.04." }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
  return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
} } } } as unknown as Anthropic;
await runAgent(db, {
  agent: "sourcing", task: "price_rise.meet", model: "claude-haiku-5-5", system: "s", prompt: "p",
  tools: [
    { name: "check_offer", description: "d", input: z.object({}), run: async () => ({ text: "Live offer 0.04; your cap 0.03; 9.20 of budget left" }) },
    { name: "try_purchase", description: "d", input: z.object({}), run: async () => {
      audit(db, "sourcing", "upstream.refused", "41", { seq: 41, reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", tx: TX });
      return { text: "Alta refused stock check #41 against the mandate", blocked: "Alta mandate" };
    } },
  ],
}, client);
audit(db, "sourcing", "price_rise.met", "41", { source: "claude", model: "claude-haiku-5-5", tried: true, refusal: "mandate_cap_exceeded", message: "Stockline now charges 0.04; my cap is 0.03, so Alta refused #41. I need a cap of 0.04." });

const server = dashboardApp(db, { approvalsUrl: "http://127.0.0.1:1/approvals" }).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const browser = await chromium.launch();
for (const [w, h] of [[390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${w}-${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    const btn = page.locator("#feed li", { hasText: "Sourcing agent told the Treasury agent" }).locator("button.trace-btn");
    await btn.waitFor({ timeout: 20_000 });
    await btn.click();
    await page.waitForSelector("#trace-sheet[open]");
    const steps = await page.locator("#trace-steps li").allTextContents();
    check(steps.length === 5, `${tag}: five steps (${steps.length})`);
    check(steps.some((s) => /Stopped by: Alta mandate/.test(s)), `${tag}: the refused call names what stopped it`);
    check(steps.some((s) => /Check: read only/.test(s)), `${tag}: the read-only call names its check`);
    check((await page.locator("#trace-steps a").first().getAttribute("href")) === `https://testnet.metalntwx.com/tx/${TX}`, `${tag}: the refusal's Alta tx links to the explorer`);
    check(steps.every((s) => /audit #\d+ · hash [0-9a-f]{12}…/.test(s)), `${tag}: every step shows its audit row and hash`);
    const sum = await page.locator("#trace-sum").textContent() ?? "";
    check(/claude-haiku-5-5/.test(sum) && /Tokens\s*6840/.test(sum) && /\$0\.\d{4}/.test(sum), `${tag}: model, tokens and cost in the summary (${sum.replace(/\s+/g, " ").slice(0, 120)})`);
    const box = await page.locator("#trace-sheet .dialog").boundingBox();
    check(!!box && box.x >= 0 && box.x + box.width <= w + 1, `${tag}: the dialog fits the screen`);
    const text = await page.evaluate(() => document.body.innerText);
    check(!/\b(null|undefined|NaN)\b/.test(text), `${tag}: no null, undefined or NaN on screen`);
    await page.screenshot({ path: join(shots, `trace-${tag}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !(document.getElementById("trace-sheet") as HTMLDialogElement).open);
    check(await btn.evaluate((b) => b === document.activeElement), `${tag}: Escape closes it and focus goes back to the Trace button`);
    check(errors.length === 0, `${tag}: no console or page errors${errors.length ? ` (${errors[0]})` : ""}`);
    await ctx.close();
  }
}
await browser.close();
server.close();
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log(`\ntrace check passes (screenshots in ${shots})`);

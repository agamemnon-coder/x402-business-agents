// The live checks on /visa and /t0 in Chromium (partner scan, 14 Nov), on the judge's offline server at 390 and 1440 px:
// /visa's three buttons run Purser's credential check in the browser on the recorded purchase and each shows its
// refusal code; /t0's "Run the close check" fetches /t0-readback.json and agrees, and with "Change one cent" keeps the
// month open, naming the entry and the account. No console or CSP error, nothing wider than the screen.
// npx tsx test/browser/partner-live.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { startJudge } from "../../src/cli/judge.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };
const j = await startJudge(0);
const b = await chromium.launch();
for (const w of [390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${j.url}/visa`);
  // 21 Nov: the live check sits in the "Try Purser's check on this credential" fold; a judge opens it.
  await p.evaluate(() => { const t = document.getElementById("vcs-try"); document.querySelectorAll("details").forEach((d) => { if (t && d.contains(t)) d.open = true; }); });
  ok(await p.locator("#vcs-try").isVisible(), `/visa ${w}: the live check shows once its script has run`);
  for (const [k, code] of [["amount", "PURSER_CREDENTIAL_AMOUNT_MISMATCH"], ["again", "PURSER_CREDENTIAL_ALREADY_USED"], ["merchant", "PURSER_CREDENTIAL_MERCHANT_MISMATCH"]] as const) {
    await p.locator(`#vcs-try button[data-use=${k}]`).click();
    const out = await p.locator("#vcs-try .vcs-out").innerText();
    ok(out.startsWith(`Refused: ${code}.`) && out.includes("mdt_nlpdlr7dgho57xw5fpd"), `/visa ${w}: "${k}" is refused with ${code}`);
  }
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `/visa ${w}: nothing wider than the screen`);
  if (shots) await p.locator("#visa-card-scene").screenshot({ path: join(shots, `visa-live-check-${w}.png`) });
  await p.goto(`${j.url}/t0`);
  const out = p.locator("#t0c-run .t0c-out");
  await p.locator("#t0c-run button").click();
  await p.waitForFunction(() => /can close|stays open|did not load/.test(document.querySelector("#t0c-run .t0c-out")!.textContent ?? ""));
  ok((await out.innerText()).startsWith("The month can close. T:0 agrees: all 95 of our journal entries are in T:0"), `/t0 ${w}: the close check agrees on the read-back`);
  await p.locator("#t0c-run input").check();
  await p.locator("#t0c-run button").click();
  await p.waitForFunction(() => /stays open/.test(document.querySelector("#t0c-run .t0c-out")!.textContent ?? ""));
  ok(/^Month stays open: PUR-[0-9a-f]{24} differs on account \d{5}\.$/.test(await out.innerText()), `/t0 ${w}: one cent keeps the month open, naming the entry and the account`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `/t0 ${w}: nothing wider than the screen`);
  if (shots) await p.locator("#t0-close-check").screenshot({ path: join(shots, `t0-run-check-${w}.png`) });
  ok(errs.length === 0, `${w}: no console or CSP error${errs.length ? `: ${errs.join(" | ")}` : ""}`);
  await ctx.close();
}
await b.close();
j.server.close();
if (failed) { console.log(`partner live check: ${failed} problem(s)`); process.exit(1); }
console.log("partner live check: all passed");

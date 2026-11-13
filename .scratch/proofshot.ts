import { chromium } from "playwright";
import { startJudge } from "../src/cli/judge.js";
const { server, url } = await startJudge(0);
const b = await chromium.launch();
const S = "/tmp/claude-0/-home-user-x402-business-agents/d80065e7-9778-5e7e-a9c3-e814fc7a8da7/scratchpad";
for (const [w, h, scheme] of [[1440, 900, "light"], [390, 844, "light"], [1440, 900, "dark"], [390, 844, "dark"]] as const) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`${url}/proof`, { waitUntil: "load" }); await p.waitForTimeout(600);
  const fold = await p.evaluate(`Math.round(document.querySelector("main details.sumd").getBoundingClientRect().top + scrollY + 60)`) as number;
  await p.screenshot({ path: `${S}/p2-${w}-${scheme}.png`, fullPage: true, clip: { x: 0, y: 0, width: w, height: fold } });
  await p.screenshot({ path: `${S}/p2-${w}-${scheme}-first.png` });
  console.log(w, scheme, fold, "overflow", await p.evaluate(`document.documentElement.scrollWidth - innerWidth`), "fractions", await p.evaluate(`(() => { const m = document.querySelector("main").cloneNode(true); m.querySelectorAll("details:not([open]) > :not(summary)").forEach((e) => e.remove()); return (m.textContent.match(/\\b\\d+ ?(?:of|\\/) ?\\d+\\b/g) || []).join("; "); })()`));
  await ctx.close();
}
await b.close(); server.close(); process.exit(0);

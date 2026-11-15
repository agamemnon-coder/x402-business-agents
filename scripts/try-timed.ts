// Timed runs of the deployed /try (15 Nov), for the verification report (npm run verify-all).
// The same walk as test/browser/proof.check.ts --live, on https://purser-try.max-31b.workers.dev/try: a fresh test
// company, the clean sample invoice (EUR 1,850.00, a test supplier), approved with Chromium's virtual passkey and paid on
// the simulated bank; then the same signature sent with EUR 1,850.01, refused. Test money only; no key of ours is used.
// Two times per run, read from this machine's clock (performance.now() in Node, around the clicks):
//   start_to_paid_ms:   the click on "Start with a test company" to the Paid stamp on screen;
//   refusal_round_trip_ms: the click on Pay with one cent more to the refusal on screen.
// Each run's two downloaded proof bundles are checked with src/proof/bundle.ts as well.
// The deployed site caps starts per hour and per 48 hours: when it refuses a start, the loop stops and says so.
// npx tsx scripts/try-timed.ts [runs, at most 10] [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { APPROVE, BOOKS, PAY, TAMPER, VERIFY_YOURSELF, WORK } from "../cloud/src/tryCopy.js";
import { verifyProofBundle } from "../src/proof/bundle.js";

const TRY = "https://purser-try.max-31b.workers.dev/try";
const runs = Math.min(10, Math.max(1, Number(process.argv[2] ?? 10)));
const out = process.argv[3] ?? "docs/evidence/try-timed-2026-11-15.json";

export interface TimedRun {
  run: number;
  started_at: string;
  start_to_paid_ms: number | null;
  refusal_round_trip_ms: number | null;
  paid_bundle_valid: boolean | null;
  refused_bundle_valid: boolean | null;
  refusal_head: string | null;
  stopped: string | null;
}

const results: TimedRun[] = [];
let stoppedBy: string | null = null;
const browser = await chromium.launch();
for (let i = 1; i <= runs; i++) {
  const r: TimedRun = { run: i, started_at: new Date().toISOString(), start_to_paid_ms: null, refusal_round_trip_ms: null, paid_bundle_valid: null, refused_bundle_valid: null, refusal_head: null, stopped: null };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(TRY);
    const start = page.getByRole("button", { name: /Start with a test company/ });
    await start.waitFor({ timeout: 30_000 });
    const t0 = performance.now();
    await start.click();
    const heading = page.getByRole("heading", { name: /An invoice comes in/ });
    try { await heading.waitFor({ timeout: 30_000 }); } catch {
      // No company: the start was refused (a cap) or failed. Keep the page's own words, then stop.
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
      r.stopped = `the start did not open a test company within 30 s; the page said: ${text}`;
      stoppedBy = r.stopped;
      results.push(r);
      await ctx.close();
      break;
    }
    await page.locator(".samples .btn:not(.skel)").first().waitFor();
    await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click();
    await page.getByRole("button", { name: "File this invoice" }).click();
    await page.locator(".result .btn.primary").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: WORK.pay }).click();
    await page.getByRole("button", { name: APPROVE.create }).click({ timeout: 30_000 });
    const approve = page.getByRole("button", { name: /^Approve EUR 1,850\.00 with/ });
    await approve.waitFor({ timeout: 30_000 });
    await approve.click();
    await page.locator(".paidstamp").waitFor({ timeout: 60_000 });
    r.start_to_paid_ms = Math.round(performance.now() - t0);
    const take = async (click: () => Promise<void>) => { const dl = page.waitForEvent("download"); await click(); return JSON.parse(readFileSync(await (await dl).path(), "utf8")) as unknown; };
    const dlPaid = page.getByRole("button", { name: VERIFY_YOURSELF.download });
    await dlPaid.waitFor({ timeout: 20_000 });
    r.paid_bundle_valid = (await verifyProofBundle(await take(() => dlPaid.click()))).ok;

    await page.click(`button.cheat:has-text("${BOOKS.cheat}")`);
    await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.00", undefined, { timeout: 20_000 });
    await page.fill("#p-amt", "1850,01");
    const t1 = performance.now();
    await page.getByRole("button", { name: PAY.button }).click();
    await page.locator(".why .head").waitFor({ timeout: 30_000 });
    r.refusal_round_trip_ms = Math.round(performance.now() - t1);
    r.refusal_head = (await page.locator(".why .head").textContent()) ?? null;
    if (r.refusal_head !== TAMPER.head) r.stopped = `the refusal's heading was not the expected one: ${r.refusal_head}`;
    const dlRefused = page.locator(".why").getByRole("button", { name: VERIFY_YOURSELF.download });
    r.refused_bundle_valid = (await verifyProofBundle(await take(() => dlRefused.click()))).ok;
  } catch (e) {
    r.stopped = `the walk failed: ${(e as Error).message.split("\n")[0]}`;
  }
  results.push(r);
  console.log(JSON.stringify(r));
  await ctx.close();
  if (r.stopped) { stoppedBy = r.stopped; break; }
}
await browser.close();
writeFileSync(out, `${JSON.stringify({
  what: "Timed runs of the deployed /try, 15 Nov 2026, by scripts/try-timed.ts: Chromium (headless) with a virtual passkey, at bot speed, from a cloud sandbox. Test company and test money only.",
  url: TRY,
  asked: runs,
  stopped: stoppedBy,
  runs: results,
}, null, 1)}\n`);
console.log(`wrote ${out}: ${results.filter((r) => r.start_to_paid_ms !== null).length} paid, ${results.filter((r) => r.refusal_round_trip_ms !== null).length} refusals${stoppedBy ? `; stopped: ${stoppedBy}` : ""}`);

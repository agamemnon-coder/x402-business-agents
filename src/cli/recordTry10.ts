// npm run record-try10 [-- --url <origin>]: film v10's walk of the live hands-on demo (/try on Purser Cloud), recorded
// by code: headless Chromium at phone size (390x844, dark), the passkey a CDP virtual authenticator (a virtual test
// passkey, never a person's Face ID), test money on the page's simulated bank. It starts ONE test company (what the page
// is for; the company and its test money are deleted after 24 hours) and makes no other write than the page's own steps.
// No money rail is touched. The frames come from the browser's screencast with their own times (nothing sped up), and
// the four windows the film uses are cut at the walk's marks into out/video/v10/recordings/<name>.mp4:
//   try-start    the start, then an invoice already paid, sent again: caught as a duplicate
//   try-approve  a supplier's invoice read and checked; the approval with the conversion, the fee's cap and the deadline
//   try-paid     the virtual test passkey signs; paid on the simulated bank, booked and filed
//   try-cent     the amount changed by one cent: the same signature refused
// What the page said at each mark is written to docs/video/recording-try-v10.json (the film says only what it showed).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { APPROVE, BOOKS, PAY, TAMPER, WHY, WORK } from "../../cloud/src/tryCopy.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/v10", "recordings");
const argv = process.argv.slice(2);
const ORIGIN = argv.includes("--url") ? argv[argv.indexOf("--url") + 1]! : "https://purser-try.max-31b.workers.dev";
/** Each window: how long the film shows it, and the mark it ends on (plus a hold after it). */
const WINDOWS: Record<string, { from: string; to: string; seconds: number }> = {
  "try-start": { from: "start", to: "duplicate-held", seconds: 15 },
  "try-approve": { from: "checked", to: "approve-held", seconds: 11 },
  "try-paid": { from: "sign", to: "paid-held", seconds: 8 },
  "try-cent": { from: "cheat", to: "refused-held", seconds: 8 },
};

interface Frame { t: number; file: string }
const frames: Frame[] = [];
const marks: Record<string, number> = {};
const said: Record<string, string> = {};
const now = () => Date.now() / 1000;

async function mark(page: Page, name: string): Promise<void> {
  marks[name] = now();
  said[name] = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 1200);
  console.log(`${name} at +${(marks[name]! - marks.start!).toFixed(1)} s`);
}

/** The film's windows, cut from the walk at its marks. */
function cutWindows(walk: string, at: Record<string, number>): void {
  for (const [name, w] of Object.entries(WINDOWS)) {
    // The window ends on its last mark and shows at most its seconds (the end of a step is what the film shows).
    const to = at[w.to]!, from = Math.max(at[w.from]!, to - w.seconds);
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", from.toFixed(3), "-to", to.toFixed(3), "-i", walk, "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-an", resolve(out, `${name}.mp4`)]);
  }
}

async function main(): Promise<void> {
  // --recut: the windows again from the walk already recorded (its marks in docs/video/recording-try-v10.json); no visit.
  if (argv.includes("--recut")) {
    const rec = JSON.parse(readFileSync(resolve(root, "docs/video/recording-try-v10.json"), "utf8")) as { marks: Record<string, number> };
    cutWindows(resolve(out, "try-walk.mp4"), rec.marks);
    writeFileSync(resolve(root, "docs/video/recording-try-v10.json"), JSON.stringify({ ...rec, windows: WINDOWS }, null, 2) + "\n");
    return;
  }
  const raw = resolve(out, "frames");
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "en-GB" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = resolve(raw, `${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp ?? now(), file });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const hold = (s: number) => page.waitForTimeout(s * 1000);
  try {
    await page.goto(`${ORIGIN}/try`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "html{scrollbar-width:none}::-webkit-scrollbar{display:none}*{caret-color:transparent!important}" }).catch(() => undefined);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    await hold(0.5);
    await mark(page, "start");
    await hold(2);
    await page.getByRole("button", { name: /Start with a test company/ }).click();
    await page.getByRole("heading", { name: /An invoice comes in/ }).waitFor({ timeout: 60_000 });
    await hold(1.5);
    // 1. An invoice already paid, sent again: the duplicate check.
    await page.locator(".samples .btn:not(.skel)").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "An invoice you already paid, sent again", exact: true }).click();
    await hold(0.8);
    await page.getByRole("button", { name: "File this invoice" }).click();
    await page.locator(".result .btn.primary").waitFor({ timeout: 90_000 });
    await mark(page, "duplicate");
    if (!said.duplicate!.includes(WHY.again.head)) throw new Error(`record: the duplicate was not caught: ${said.duplicate}`);
    await hold(4);
    await mark(page, "duplicate-held");
    // 2. A supplier's invoice: read and checked, then the approval with every signed term.
    await page.getByRole("button", { name: WORK.another }).click();
    await page.locator(".samples .btn:not(.skel)").first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "A supplier's invoice", exact: true }).click();
    await hold(0.6);
    await page.getByRole("button", { name: "File this invoice" }).click();
    await page.locator(".result .btn.primary").waitFor({ timeout: 120_000 });
    await mark(page, "checked");
    await hold(3);
    await page.getByRole("button", { name: WORK.pay }).click();
    await page.getByRole("button", { name: APPROVE.create }).waitFor({ timeout: 60_000 });
    await hold(0.5);
    await mark(page, "approve-shown");
    // Scroll gently so the conversion, the fee's cap and the deadline are in view.
    await page.getByText("Conversion", { exact: false }).first().scrollIntoViewIfNeeded().catch(() => undefined);
    await hold(5.5);
    await mark(page, "approve-held");
    // 3. The virtual test passkey signs: paid on the simulated bank, booked, filed.
    await mark(page, "sign");
    await page.getByRole("button", { name: APPROVE.create }).click();
    const approve = page.getByRole("button", { name: /^Approve EUR 1,850\.00 with/ });
    await approve.waitFor({ timeout: 60_000 });
    await hold(0.8);
    await approve.click();
    await page.locator(".paidstamp").waitFor({ timeout: 90_000 });
    await page.locator(".blk.booked:not(.sk-blk)").waitFor({ timeout: 30_000 }).catch(() => undefined);
    await mark(page, "paid");
    await hold(3);
    await mark(page, "paid-held");
    // 4. One cent changed: the same signature refused.
    await mark(page, "cheat");
    await page.getByRole("link", { name: BOOKS.cheat }).or(page.getByRole("button", { name: BOOKS.cheat })).first().click();
    await page.getByRole("button", { name: PAY.button }).waitFor({ timeout: 60_000 });
    await hold(1.2);
    const amount = page.getByLabel(/Amount/).first();
    await amount.click();
    await amount.fill("1850.01");
    await hold(1);
    await page.getByRole("button", { name: PAY.button }).click();
    await page.getByText(TAMPER.head).first().waitFor({ timeout: 60_000 });
    await mark(page, "refused");
    if (!said.refused!.includes(TAMPER.head)) throw new Error("record: no refusal on the page");
    await hold(4);
    await mark(page, "refused-held");
    await cdp.send("Page.stopScreencast");
  } finally {
    await page.screenshot({ path: resolve(out, "last.png") }).catch(() => undefined);
    await browser.close();
  }
  // The walk as one clip, each frame held until the next one's time; then the windows.
  const walk = resolve(out, "try-walk.mp4");
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(1 / 60, (frames[i + 1]?.t ?? marks["refused-held"]!) - f.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(resolve(out, "frames.txt"), list);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(out, "frames.txt"), "-vf", "fps=60,scale=1080:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "14", walk]);
  const t0 = frames[0]!.t;
  const at: Record<string, number> = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.max(0, v - t0)]));
  cutWindows(walk, at);
  rmSync(raw, { recursive: true, force: true });
  const record = { recorded_at: new Date().toISOString(), origin: ORIGIN, page: `${ORIGIN}/try`, browser: "headless Chromium (Playwright), 390x844, dark", passkey: "a CDP virtual authenticator: a virtual test passkey, not a person's Face ID", money: "test money on the page's simulated bank; the test company is deleted after 24 hours", marks: at, windows: WINDOWS, said };
  writeFileSync(resolve(root, "docs/video/recording-try-v10.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(`walk ${(at["refused-held"]!).toFixed(1)} s; clips in ${out}`);
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });

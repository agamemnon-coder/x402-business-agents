// The README's short animation of the core moment on the public /try (19 Nov): the CFO signs EUR 1,850.00 with a
// passkey, it is paid, the amount is changed by one cent and the payment is refused. docs/assets/readme/refusal.webp,
// an animated WebP, 1200 px wide at deviceScaleFactor 1, about 13 s, at most 2 MB.
// How: Playwright screenshots of https://kit11.max-31b.workers.dev/try in Chromium (a CDP virtual authenticator: ctap2,
// internal, user verification on; not a person's Face ID), taken every SHOT_MS while the walk runs, with the times of
// the moments that matter (marks); then stitched by ffmpeg (libwebp_anim). The long waits (the agent reading, the
// transfer going through) are played faster than real time, each segment to a fixed length (SEGMENTS); nothing is
// drawn over the page, and every frame is a screenshot of the page as it was at that moment of the walk.
// Test money only: one fresh /try test company, its EUR 1,850.00 paid to the Airwallex sandbox (one sandbox payout
// of the deployment's daily /try budget, shared with visitors: run it rarely).
//   npx tsx scripts/readme-refusal-webp.ts capture <frames dir>        the live walk: screenshots + marks.json
//   npx tsx scripts/readme-refusal-webp.ts encode <frames dir> [out]   the WebP, from those frames (no site call)
//   npx tsx scripts/readme-refusal-webp.ts <frames dir>                both
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
export const OUT = join(ROOT, "docs/assets/readme/refusal.webp");
export const BASE = "https://kit11.max-31b.workers.dev";
export const VIEWPORT = { width: 1200, height: 900 };
export const FPS = 10;
const SHOT_MS = 120;
export const MAX_BYTES = 2 * 1024 * 1024;

/** The moments of the walk, in ms since the capture began. */
export interface Marks { cfo_click: number; approved: number; paid_on_screen: number; change_click: number; changed: number; pay_click: number; refused: number; end: number }
export interface Shot { file: string; t: number }

/**
 * The animation's segments: from one mark to the next, played in `out_s` seconds whatever their real length (a hold
 * when the two marks are one: the frame at that mark, kept). About 13 s in all.
 */
export const SEGMENTS: { from: keyof Marks | 0; to: keyof Marks | 0; out_s: number; what: string }[] = [
  { from: 0, to: "cfo_click", out_s: 1.2, what: "checked, waiting for the CFO" },
  { from: "cfo_click", to: "approved", out_s: 3.2, what: "the CFO's passkey signs the exact terms" },
  { from: "approved", to: "paid_on_screen", out_s: 1.6, what: "paid, through the Airwallex sandbox" },
  { from: "paid_on_screen", to: "change_click", out_s: 2.0, what: "PAID, held" },
  { from: "change_click", to: "changed", out_s: 0.8, what: "one cent changed: 1,850.01" },
  { from: "changed", to: "pay_click", out_s: 1.0, what: "the changed amount, before the pay" },
  { from: "pay_click", to: "refused", out_s: 1.0, what: "paid with the earlier signature" },
  { from: "refused", to: "end", out_s: 2.6, what: "refused: nothing was paid" },
];

/**
 * Which screenshot each frame of the animation shows: for each segment, FPS × out_s frames evenly over its real span,
 * each the last screenshot taken at or before that moment (never one taken after it).
 */
export function framePlan(marks: Marks, shots: Shot[], fps = FPS): string[] {
  const sorted = [...shots].sort((a, b) => a.t - b.t);
  if (!sorted.length) throw new Error("no screenshots");
  const at = (k: keyof Marks | 0) => (k === 0 ? sorted[0]!.t : marks[k]);
  const pick = (t: number) => { let s = sorted[0]!; for (const x of sorted) { if (x.t <= t) s = x; else break; } return s.file; };
  const frames: string[] = [];
  for (const seg of SEGMENTS) {
    const a = at(seg.from), b = at(seg.to);
    if (b < a) throw new Error(`marks out of order: ${String(seg.from)} after ${String(seg.to)}`);
    const n = Math.max(1, Math.round(seg.out_s * fps));
    for (let i = 0; i < n; i++) frames.push(pick(a + ((b - a) * i) / n));
  }
  return frames;
}

async function capture(dir: string): Promise<void> {
  const { chromium } = await import("playwright");
  mkdirSync(join(dir, "shots"), { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const press = async (name: string | RegExp) => { const b = page.getByRole("button", { name }).first(); await b.waitFor({ timeout: 120_000 }); await b.click(); };

  await page.goto(`${BASE}/try`, { waitUntil: "load" });
  await press(/Start the live demo|Launch the live transfer demo/);
  await page.locator(".samples button", { hasText: "Needs your signature" }).first().click();
  await press(/Give it to the AI agent/);
  await page.getByRole("button", { name: /Send to CFO for approval/ }).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(600);

  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const shots: Shot[] = [];
  let shooting = true;
  const loop = (async () => {
    for (let i = 0; shooting; i++) {
      const t = now();
      const file = `shots/${String(i).padStart(4, "0")}.png`;
      await page.screenshot({ path: join(dir, file) }).then(() => shots.push({ file, t }), () => undefined);
      const wait = SHOT_MS - (now() - t);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
  const m: Partial<Marks> = {};
  await new Promise((r) => setTimeout(r, 400));
  try {
    const approve = page.waitForResponse((r) => r.request().method() === "POST" && /\/v1\/engine\/proposals\/[^/]+\/approve$/.test(new URL(r.url()).pathname), { timeout: 120_000 });
    let approved = false;
    void approve.then(() => { approved = true; m.approved = now(); }, () => undefined);
    m.cfo_click = now();
    await press(/Send to CFO for approval/);
    // As scripts/try-live-record.ts: a fresh company enrols a passkey first, then signs (straight away, or from the
    // "Approve & sign" sheet); a busy button is never pressed, and the same button at most once every 3 s.
    let last = "", lastAt = 0, presses = 0;
    for (let i = 0; i < 240 && !approved; i++) {
      const sign = page.getByRole("button", { name: /Approve & sign/ }).first();
      if (await sign.count() && await sign.isVisible() && await sign.isEnabled()) { await sign.click().catch(() => undefined); break; }
      const setup = page.getByRole("button", { name: /passkey|Face ID|Touch ID|Windows Hello|Set up/i }).first();
      if (presses < 4 && await setup.count() && await setup.isVisible() && await setup.isEnabled()) {
        const words = (await setup.innerText()).trim();
        if (!/…|\.\.\.|Saving|Waiting/i.test(words) && (words !== last || now() - lastAt > 3_000)) { last = words; lastAt = now(); presses++; await setup.click().catch(() => undefined); }
      }
      await page.waitForTimeout(250);
    }
    await approve;
    await page.getByRole("button", { name: "Now try to change it" }).waitFor({ timeout: 120_000 });
    m.paid_on_screen = now();
    await page.waitForTimeout(2_200);
    m.change_click = now();
    await press("Now try to change it");
    await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
    m.changed = now();
    await page.waitForTimeout(1_200);
    m.pay_click = now();
    await press("Try to pay with my earlier approval");
    await page.waitForSelector(".why .head", { timeout: 30_000 });
    m.refused = now();
    await page.locator(".why .head").first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(3_000);
    m.end = now();
  } finally {
    shooting = false;
    await loop;
    writeFileSync(join(dir, "marks.json"), JSON.stringify({ base: BASE, viewport: VIEWPORT, taken_at: new Date().toISOString(), browser: `chromium ${browser.version()}`, marks: m, shots }, null, 1) + "\n");
    await browser.close();
  }
  console.log(`${shots.length} screenshots; marks ${JSON.stringify(m)}`);
}

function encode(dir: string, out = OUT): void {
  const rec = JSON.parse(readFileSync(join(dir, "marks.json"), "utf8")) as { marks: Marks; shots: Shot[] };
  const frames = framePlan(rec.marks, rec.shots);
  const seq = join(dir, "seq");
  rmSync(seq, { recursive: true, force: true });
  mkdirSync(seq);
  frames.forEach((f, i) => copyFileSync(join(dir, f), join(seq, `${String(i).padStart(4, "0")}.png`)));
  mkdirSync(resolve(out, ".."), { recursive: true });
  const run = (q: number | "lossless") => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(seq, "%04d.png"), "-vf", `scale=${VIEWPORT.width}:-1:flags=lanczos`, "-c:v", "libwebp_anim", "-lossless", q === "lossless" ? "1" : "0", "-quality", q === "lossless" ? "100" : String(q), "-compression_level", "6", "-loop", "0", out]);
  // Lossless if it fits in 2 MB (19 Nov: 0.99 MB; lossy frames left faint ghosts of earlier frames on the page's flat
  // background), else the highest lossy quality that does.
  for (const q of ["lossless", 90, 80, 70, 60, 50, 40] as const) {
    run(q);
    const size = statSync(out).size;
    console.log(`${out}: ${frames.length} frames at ${FPS} fps (${(frames.length / FPS).toFixed(1)} s), ${q === "lossless" ? "lossless" : `quality ${q}`}, ${size} bytes`);
    if (size <= MAX_BYTES) return;
  }
  throw new Error(`${out} is above ${MAX_BYTES} bytes even at quality 40`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b, c] = process.argv.slice(2);
  if (a === "capture" && b) await capture(b);
  else if (a === "encode" && b) encode(b, c);
  else if (a && !["capture", "encode"].includes(a)) { await capture(a); encode(a); }
  else throw new Error("usage: readme-refusal-webp.ts capture <dir> | encode <dir> [out] | <dir>");
}

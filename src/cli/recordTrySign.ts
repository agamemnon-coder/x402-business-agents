// npx tsx src/cli/recordTrySign.ts [--base <url>] [--out <dir>] [--name <name>]: records one walk of the live /try/sign
// page for the film (v6, scene 11-turn), in headless Chromium at phone size (390x844), the visitor's Face ID
// played by Chromium's virtual authenticator (WebAuthn over CDP, user verification on), as test/browser/trysign.check.ts
// does. The walk: the page opens its test world; the agents' step runs (the invoice reader and the Treasury agent's
// advice, each labelled by the page itself); "Sign with Face ID"; "Now try to cheat: change one cent", refused; "Trick
// the agent" with the "Pre-approved by the CFO" invoice, blocked. Nothing else is touched: no keys, no runner, no
// Airwallex or Metal call; the page's own test world only.
// Each walk on the live page spends real Claude calls (the reader, the advice, the trick's reader): record at most a few.
// Writes <out>/<name>.mp4 (portrait, 60 fps, the screencast's frames at their own times), <name>.json (when each step
// happened in that file, and the labels the page showed, so the film says only what the page said; the film reads a copy,
// docs/video/recording-trysign-v6.json), and the frames.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const LIVE = "https://kit11.max-31b.workers.dev";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("--base") ?? LIVE).replace(/\/+$/, "");
const out = resolve(arg("--out") ?? "out/video/recordings");
const name = arg("--name") ?? `trysign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const frames = resolve(out, `${name}-frames`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

// The live page is reached through the session's HTTPS proxy, when there is one; a local relay directly.
const proxy = base.startsWith("https://") && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), ...(proxy ? { proxy } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", reducedMotion: "no-preference" });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

// The screencast: every frame the page draws, with its time.
const shots: { file: string; ts: number }[] = [];
cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
  const file = resolve(frames, `f${String(shots.length).padStart(5, "0")}.jpg`);
  writeFileSync(file, Buffer.from(f.data, "base64"));
  shots.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
  void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
});
const marks: Record<string, number> = {};
const mark = (k: string) => { marks[k] = Date.now() / 1000; console.log(`mark  ${k}`); };
const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => null)) ?? "").trim().replace(/\s+/g, " ");

await page.goto(`${base}/try/sign`, { waitUntil: "load" });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
mark("open");
await page.waitForTimeout(1800);
if (await page.locator("#scr-0").isVisible()) { mark("start"); await page.click("#go-start"); await page.waitForSelector("#scr-1:not([hidden])"); }
// The agents' step: the reader, Purser's checks, the quote, the advice, then "Sign with Face ID" comes on.
await page.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled || document.getElementById("w-status")?.classList.contains("bad"), undefined, { timeout: 90_000 });
if (!(await page.locator("#go-sign").isEnabled())) throw new Error(`no test world: ${await text("#w-status")}`);
mark("agentsDone");
const labels = { read: await text("#st-read .pill[data-label]"), advice: await text("#s1-ask .who .pill") };
await page.waitForTimeout(2600);
mark("sign"); await page.click("#go-sign");
await page.waitForSelector("#scr-2:not([hidden])", { timeout: 30_000 });
mark("signed");
await page.waitForTimeout(2600);
mark("cheat"); await page.click("#go-cheat");
await page.waitForSelector("#tamper:not([hidden])", { timeout: 30_000 });
mark("refused");
const tamper = await text("#tamper .tagr");
await page.waitForTimeout(3000);
mark("trick"); await page.click("#go-trick");
await page.waitForSelector("#scr-4:not([hidden])", { timeout: 30_000 });
await page.waitForTimeout(1500);
mark("chip"); await page.click('#trick-chips .chip[data-attack="pre_approved"]');
await page.waitForSelector("#k-result:not([hidden])", { timeout: 90_000 });
mark("blocked");
const trick = { label: await text("#k-result .pill[data-label], #k-result .pill"), blocked: /Blocked: [^.]*\./.exec(await text("#k-result"))?.[0] ?? "" };
await page.waitForTimeout(3500);
mark("end");
await cdp.send("Page.stopScreencast");
await page.waitForTimeout(300);
await browser.close();

// The frames at their own times, into a 60 fps portrait video; each step's time in that video.
const t0 = shots[0]!.ts, end = marks.end!;
const list = shots.map((s, i) => `file '${s.file}'\nduration ${((i + 1 < shots.length ? shots[i + 1]!.ts : end) - s.ts).toFixed(4)}`).join("\n");
writeFileSync(resolve(frames, "list.txt"), `${list}\nfile '${shots.at(-1)!.file}'\n`);
const mp4 = resolve(out, `${name}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(frames, "list.txt"), "-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-r", "60", "-movflags", "+faststart", mp4]);
const at = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round((v - t0) * 100) / 100]));
writeFileSync(resolve(out, `${name}.json`), `${JSON.stringify({ file: `${name}.mp4`, page: `${base}/try/sign`, recorded_at: new Date(t0 * 1000).toISOString(), viewport: "390x844, dark", passkey: "Chromium's virtual authenticator (WebAuthn over CDP, user verification on)", frames: shots.length, at, labels, tamper, trick, errors }, null, 2)}\n`);
console.log(`recorded ${mp4} (${shots.length} frames, ${at.end} s)`);
console.log(JSON.stringify({ at, labels, tamper, trick, errors }, null, 2));

// npm run record-uth -- --verify: the film's /verify beat, recorded by code at 1920x1080 (headless Chromium, light).
// The proof bundle a /try payment hands over (docs/proof/try-paid.json, test money) is dropped on /verify: every check
// passes. Then, in the same JSON on the page, the amount is changed by one cent (1850.00 to 1850.01) and checked
// again: the checks fail. /verify runs in the browser (WebCrypto); it makes no write. Writes out/video/uth/verify.mp4
// and its marks (verify-marks.json), and the page's own result lines into docs/film/under-the-hood/verify-record.json.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/uth");

export async function recordVerify(origin = "https://kit11.max-31b.workers.dev"): Promise<void> {
  // The bundle from the film's own /try walk (npm run record-uth saves it), else the repository's sample.
  const own = resolve(root, "docs/film/under-the-hood/try-proof.json");
  const bundle = existsSync(own) ? own : resolve(root, "docs/proof/try-paid.json");
  const json = JSON.stringify(JSON.parse(readFileSync(bundle, "utf8")), null, 2);
  if (!json.includes('"amount": "1850.00"')) throw new Error("verify: the bundle's amount is not 1850.00");
  const raw = resolve(out, "vframes");
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const frames: { t: number; file: string }[] = [];
  const marks: Record<string, number> = {};
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", locale: "en-GB" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = resolve(raw, `${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, file });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const hold = (s: number) => page.waitForTimeout(s * 1000);
  const mark = (k: string) => { marks[k] = Date.now() / 1000; console.log(k); };
  const results = async () => { const ls = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter(Boolean); return ls.flatMap((l, i) => (/^(pass|FAIL)$/i.test(l) ? [`${l} ${ls[i + 1] ?? ""}`] : /^(pass|FAIL)\b/i.test(l) ? [l] : [])); };
  const lines: Record<string, string[]> = {};
  try {
    await page.goto(`${origin}/verify`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "html{scrollbar-width:none}::-webkit-scrollbar{display:none}" }).catch(() => undefined); // the page's CSP may refuse it
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await hold(0.5); mark("start"); await hold(1.5);
    // The paid bundle, as a file, as the judge would drop it.
    await page.locator("#v-file").setInputFiles(bundle);
    await page.getByText(/^pass\b/i).first().waitFor({ timeout: 30_000 });
    await hold(0.4); mark("passed");
    lines.paid = await results();
    await page.getByText(/Every check passes/).first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" })).catch(() => undefined);
    await hold(2.5);
    await page.getByText(/^pass\b/i).last().evaluate((el) => el.scrollIntoView({ block: "end", behavior: "smooth" })).catch(() => undefined);
    await hold(3); mark("passed-held");
    // One cent: the same JSON in the page's box, the amount changed by hand, checked again.
    await page.locator("#v-paste").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await hold(1);
    await page.locator("#v-paste").fill(json);
    const at = json.indexOf('"amount": "1850.00"') + '"amount": "'.length;
    await page.locator("#v-paste").evaluate((el: HTMLTextAreaElement, [s, e]) => { el.focus(); el.setSelectionRange(s!, e!); const lh = parseFloat(getComputedStyle(el).lineHeight) || 20; el.scrollTop = Math.max(0, el.value.slice(0, s).split("\n").length * lh - el.clientHeight / 2); }, [at, at + 7]);
    await hold(1); mark("edit");
    await page.keyboard.type("1850.01", { delay: 110 });
    await hold(1);
    await page.locator("#v-check").click();
    await page.getByText(/^FAIL\b/).first().waitFor({ timeout: 30_000 });
    await hold(0.4); mark("failed");
    lines.one_cent = await results();
    await page.getByText(/^FAIL\b/).first().scrollIntoViewIfNeeded().catch(() => undefined);
    await hold(4); mark("failed-held");
    await cdp.send("Page.stopScreencast");
  } finally {
    await page.screenshot({ path: resolve(out, "verify-last.png") }).catch(() => undefined);
    await browser.close();
  }
  const end = marks["failed-held"] ?? frames.at(-1)!.t;
  writeFileSync(resolve(out, "vframes.txt"), frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(1 / 60, (frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(out, "vframes.txt"), "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", resolve(out, "verify.mp4")]);
  rmSync(raw, { recursive: true, force: true });
  const t0 = frames[0]!.t;
  const at = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - t0).toFixed(3)]));
  writeFileSync(resolve(out, "verify-marks.json"), JSON.stringify(at, null, 2) + "\n");
  writeFileSync(resolve(root, "docs/film/under-the-hood/verify-record.json"), JSON.stringify({ recorded_at: new Date().toISOString(), page: `${origin}/verify`, bundle: `${bundle.slice(root.length + 1)} (a /try test company, test money)`, one_cent: "the amount 1850.00 changed to 1850.01 in the page's JSON box", marks: at, lines }, null, 2) + "\n");
  console.log(JSON.stringify(lines, null, 1));
}

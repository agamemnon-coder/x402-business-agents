// npm run record-uth -- --cloud (src/cli/recordUth.ts calls this): the film's Purser Cloud clip, the demo company's
// Agents tab as a guest sees it (read only, made-up data), 1920x1080, light, about 12 s with a slow scroll. No write.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/uth");
const CLOUD = "https://purser-try.max-31b.workers.dev/#/guest";

export async function recordCloudAgents(): Promise<void> {
  const raw = resolve(out, "frames-cloud");
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const frames: { t: number; file: string }[] = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light", locale: "en-GB" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = resolve(raw, `${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, file });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  try {
    await page.goto(CLOUD, { waitUntil: "networkidle" });
    await page.waitForSelector('h1:text-is("Overview")', { timeout: 60_000 });
    await page.addStyleTag({ content: "html{scrollbar-width:none}::-webkit-scrollbar{display:none}" }).catch(() => undefined);
    await page.locator(".apptabs").getByText("Agents", { exact: true }).click();
    await page.waitForFunction(() => /^Agents/.test((document.querySelector("main h1, main h2") as HTMLElement | null)?.innerText ?? ""), null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 18); await page.waitForTimeout(160); }
    await page.waitForTimeout(3500);
    await cdp.send("Page.stopScreencast");
  } finally { await browser.close(); }
  const end = frames.at(-1)!.t + 0.5;
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(1 / 60, (frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(resolve(out, "frames-cloud.txt"), list);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(out, "frames-cloud.txt"), "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", resolve(out, "cloud-agents.mp4")]);
  rmSync(raw, { recursive: true, force: true });
  console.log(`cloud-agents.mp4: ${(end - frames[0]!.t).toFixed(1)} s`);
}

// npm run capture [-- <shot id>... | all | today] [--phone] [--draft] [--list]: films the video plan's page shots
// (src/film/shots.ts) from the live site and the preview into out/video/v9/shots/<id>.mp4, with <id>.json beside it
// (the address filmed, when, the frame count). Frames go straight from the browser into ffmpeg (src/film/capture.ts):
// no frame is written to disk. GETs of public pages only; a shot whose page lacks a line it must show, or whose stream
// is not live there yet, is refused and listed. Stills (T7) need no capture: the cut pans them.
//   --list   every shot, its addresses, gate and length, and whether a clip exists; nothing is filmed
//   --phone  the phone versions too (390x844, DPR 3), as <id>-phone.mp4
//   --draft  x264 veryfast CRF 20 (a quick look), not the master quality
// Stops before the first frame when less than 3 GB is free.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { buildPages } from "../relay/assets.js";
import { notFoundResponse, pageResponse } from "../../worker/src/core.js";
import { captureShot, guardDisk } from "../film/capture.js";
import { ALL_SHOTS, PHONE_SHOTS, SHOTS, seconds, type Shot } from "../film/shots.js";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(root, process.env.VIDEO_OUT ?? "out/video/v9", "shots");
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const ids = argv.filter((a) => !a.startsWith("--"));

function list(): void {
  for (const s of ALL_SHOTS) {
    const clip = resolve(outDir, `${s.id}.mp4`);
    const meta = existsSync(clip.replace(/\.mp4$/, ".json")) ? (JSON.parse(readFileSync(clip.replace(/\.mp4$/, ".json"), "utf8")) as { url: string; at: string }) : null;
    const where = s.still ? `still ${s.still}` : (s.urls ?? []).join(" | ") || "(no address yet)";
    console.log(`${s.id.padEnd(10)} ${String(seconds(s)).padStart(5)} s  ${s.gate ? `gate ${s.gate.stream}`.padEnd(24) : "".padEnd(24)} ${meta ? `clip from ${meta.url} (${meta.at})` : s.still ? "no capture needed" : "no clip"}\n           ${s.what}\n           ${where}`);
  }
}

/** The Worker's pages as this branch builds them, on this computer: the shots whose address is local:/path. */
function localSite(): Promise<{ url: string; close: () => void }> {
  const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
  const srv = createServer((req, res) => {
    const r = pageResponse(new Request(`http://local${req.url}`), pages) ?? notFoundResponse(pages);
    void r.arrayBuffer().then((b) => { res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(b)); });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() })));
}

async function main(): Promise<void> {
  if (flag("--list")) return list();
  const page = (s: Shot) => !s.still;
  const want: Shot[] = ids.length === 0 || ids.includes("all") || ids.includes("today")
    ? [...SHOTS, ...(flag("--phone") ? PHONE_SHOTS : [])].filter(page).filter((s) => !ids.includes("today") || (s.urls ?? []).length > 0)
    : ids.map((id) => { const s = ALL_SHOTS.find((x) => x.id === id); if (!s) throw new Error(`capture: no shot ${id} (npm run capture -- --list)`); return s; }).filter(page);
  mkdirSync(outDir, { recursive: true });
  guardDisk(outDir);
  const browser = await chromium.launch();
  const local = want.some((s) => (s.urls ?? []).some((u) => u.startsWith("local:"))) ? await localSite() : null;
  const refused: string[] = [];
  try {
    for (const s of want) {
      const out = resolve(outDir, `${s.id}.mp4`);
      const r = await captureShot(browser, s, out, { root, local: local?.url, draft: flag("--draft"), log: (l) => console.log(l) });
      if ("refused" in r && r.refused) { refused.push(`${s.id}: ${r.refused.join(" / ")}`); continue; }
      writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify({ ...r, at: new Date().toISOString(), what: s.what, viewport: s.viewport }, null, 2) + "\n");
    }
  } finally {
    await browser.close();
    local?.close();
  }
  if (refused.length) console.log(`\nRefused (${refused.length}):\n${refused.map((r) => `  ${r}`).join("\n")}`);
  console.log(`\nClips in ${outDir}`);
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });

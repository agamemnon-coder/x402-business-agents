// The film's tools (the video plan's V1, V3, V5, V8): the shot list as data, the frame-by-frame capture piped into
// ffmpeg with no frame file left on disk, the burned-in captions, badges and placeholder cards, the sound placed and
// normalised, and the free-space guard. The parts that run Chromium and ffmpeg run only where ffmpeg is installed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { assFile, assText, roundRect } from "../src/film/captions.js";
import { FPS, MIN_FREE_BYTES, captureShot, encoderArgs, guardDisk, scrollFrames } from "../src/film/capture.js";
import { BADGES, SUBMISSION, WALKTHROUGH, resolveCut } from "../src/film/cuts.js";
import { LOUDNESS, normaliseFilter, parseMeasured, placeFilter } from "../src/film/mix.js";
import { ALL_SHOTS, OWN_FOOTAGE, PHONE_SHOTS, SHOTS, VIEWPORTS, seconds, type Shot } from "../src/film/shots.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("the shot list", () => {
  it("every shot has an id, an address or a still, a viewport, actions, a length and the lines it must show", () => {
    const ids = ALL_SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ALL_SHOTS) {
      expect({ id: s.id, ok: !!s.still || Array.isArray(s.urls) }).toEqual({ id: s.id, ok: true });
      expect(VIEWPORTS[s.viewport]).toBeDefined();
      expect({ id: s.id, seconds: seconds(s) > 0 }).toEqual({ id: s.id, seconds: true });
      if (!s.still) expect({ id: s.id, must: s.must.length > 0 }).toEqual({ id: s.id, must: true });
      // A shot with no address yet waits for a stream, and says which.
      if (s.urls && s.urls.length === 0) expect(s.gate?.stream).toBeTruthy();
      // GETs of public pages only: the site, its preview, the public repository on GitHub, Metal's explorer.
      for (const u of s.urls ?? []) expect(u).toMatch(/^https:\/\/(kit11(-next)?\.max-31b\.workers\.dev|github\.com\/agamemnon-coder\/x402-business-agents\/blob\/main|testnet\.metalntwx\.com)\//);
    }
    expect(VIEWPORTS.desktop).toMatchObject({ width: 1440, height: 900 });
    expect(VIEWPORTS.phone).toMatchObject({ width: 390, height: 844 });
    expect(PHONE_SHOTS.every((s) => s.viewport === "phone")).toBe(true);
  });

  it("each shot is long enough for every cut that uses it (or holds its last frame)", () => {
    for (const cut of [SUBMISSION, WALKTHROUGH]) for (const p of resolveCut(cut)) for (const g of p.segs) {
      if (!g.shot) continue;
      const s = SHOTS.find((x) => x.id === g.shot![0])!;
      expect({ shot: s.id, fits: seconds(s) + 0.001 >= g.seconds || s.still !== undefined || seconds(s) >= 4 }).toEqual({ shot: s.id, fits: true });
    }
  });

  it("the owner's footage is named, never captured", () => {
    expect(Object.keys(OWN_FOOTAGE)).toEqual(["M1", "M2", "P1a", "P1b", "P1c", "P1d"]);
    expect(ALL_SHOTS.some((s) => /^[MP]\d/.test(s.id))).toBe(false);
  });
});

describe("the capture", () => {
  it("scrolls with an ease, one position a frame, landing on the target", () => {
    const f = scrollFrames(100, 700, 1.5);
    expect(f.length).toBe(90);
    expect(f.at(-1)).toBe(700);
    for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThanOrEqual(f[i - 1]!);
    expect(f[44]! - 100).toBeGreaterThan(250);
  });

  it("reads its frames from a pipe, at 60 fps, fitted into 1920x1080 on the dark background", () => {
    const a = encoderArgs("/x/T2b.mp4", [1920, 1080]);
    expect(a.slice(a.indexOf("-i"), a.indexOf("-i") + 2)).toEqual(["-i", "-"]);
    expect(a).toContain("image2pipe");
    expect(a.join(" ")).toContain("scale=1916:1076:force_original_aspect_ratio=decrease");
    expect(a.join(" ")).toContain("pad=1920:1080");
    expect(a[a.indexOf("-r") + 1]).toBe("60");
    expect(a[a.indexOf("-crf") + 1]).toBe("16");
    expect(encoderArgs("/x/a.mp4", [1080, 1920], { draft: true })).toContain("veryfast");
  });

  it("stops a render below 3 GB free", () => {
    expect(MIN_FREE_BYTES).toBe(3 * 1024 ** 3);
    expect(() => guardDisk("/tmp", MIN_FREE_BYTES, 2.2 * 1024 ** 3)).toThrow(/only 2\.2 GB free/);
    expect(() => guardDisk("/tmp", MIN_FREE_BYTES, 4 * 1024 ** 3)).not.toThrow();
  });

  it.skipIf(!hasFfmpeg)("films a local page into a 1 s mp4 at 1920x1080 and 60 fps, and leaves no frame file", async () => {
    const html = `<!doctype html><html><body style="margin:0;background:#0a0c11;color:#eef1f6;font:24px sans-serif"><nav aria-label="Main">Home Try Proof</nav><h1>A fixture page</h1><div style="height:2000px"></div><p>Scroll here</p><div style="height:2000px"></div></body></html>`;
    const srv = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(html); });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
    const dir = mkdtempSync(join(tmpdir(), "capture-"));
    const browser = await chromium.launch();
    try {
      const shot: Shot = { id: "X1", what: "fixture", urls: [], viewport: "desktop", actions: [{ hold: 0.3 }, { scroll: "Scroll here", s: 0.4 }, { highlight: ["Scroll here"] }, { hold: 0.3 }], must: ["A fixture page"], gate: { stream: "test", menuWithout: "Watch" } };
      const r = await captureShot(browser, shot, join(dir, "X1.mp4"), { root: process.cwd(), urls: [`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`], draft: true });
      expect(r).toMatchObject({ id: "X1", frames: FPS, seconds: 1 });
      const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-of", "csv=p=0", join(dir, "X1.mp4")], { encoding: "utf8" }).trim();
      expect(probe).toBe("1920,1080,60/1,60");
      expect(readdirSync(dir)).toEqual(["X1.mp4"]);
      // A page that lacks a line it must show is refused, and nothing is written.
      const bad = await captureShot(browser, { ...shot, id: "X2", must: ["Not on the page"] }, join(dir, "X2.mp4"), { root: process.cwd(), urls: [`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`], draft: true });
      expect("refused" in bad && bad.refused?.[0]).toMatch(/missing "Not on the page"/);
      expect(readdirSync(dir)).toEqual(["X1.mp4"]);
    } finally {
      await browser.close();
      srv.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("captions, badges and placeholder cards (ASS)", () => {
  const placed = resolveCut(SUBMISSION);
  const ass = assFile(placed);

  it("burns each caption and each badge, in time", () => {
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toMatch(/Dialogue: 5,0:01:17\.15,0:01:28\.90,Caption,.*awx-1 · 7 Nov · EUR 240\.00 by SWIFT/);
    expect(ass).toMatch(/Dialogue: 5,0:01:17\.00,0:01:55\.00,Badge,.*Airwallex sandbox · test money/);
    for (const b of ["Test world · no money moves", "Metal testnet · test USD", "Airi test card · test money"]) expect(ass).toContain(b);
    expect(Object.values(BADGES).length).toBe(8);
  });

  it("draws a placeholder card where the owner's footage goes, and none once it is given", () => {
    expect(ass).toContain("PLACEHOLDER · M1");
    expect(ass).toContain("PLACEHOLDER · P1b");
    expect(ass).toContain("PHONE RECORDING");
    const filled = assFile(placed, { filled: new Set(["M1", "M2", "P1a", "P1b", "P1c", "P1d"]) });
    expect(filled).not.toContain("PLACEHOLDER");
    expect(filled).not.toContain("PHONE RECORDING");
  });

  it("runs the narration as a line only in a draft without a voice", () => {
    expect(ass).not.toMatch(/,Draft,/);
    const draft = assFile(placed, { draft: true });
    expect(draft).toMatch(/,Draft,,0,0,0,,Max: Hi, I'm Max\./);
    expect(draft).toMatch(/,Draft,,0,0,0,,VO: This is Purser\./);
  });

  it("never lets a line's words become an override, and draws the phone as a rounded rectangle", () => {
    expect(assText("a {\\b1} b")).toBe("a (⧵b1) b");
    expect(roundRect(100, 200, 20)).toMatch(/^m 20 0 l 80 0 b /);
  });
});

describe("the sound", () => {
  it("places each piece at its time, in milliseconds, and pads to the film's length", () => {
    const f = placeFilter([{ file: "a.wav", at: 1.5 }, { file: "b.wav", at: 20.25, seconds: 9 }], 180);
    expect(f).toContain("[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=1500|1500[a0]");
    expect(f).toContain("[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=9,adelay=20250|20250[a1]");
    expect(f).toContain("amix=inputs=2:normalize=0");
    expect(f).toContain("atrim=duration=180[mix]");
    expect(placeFilter([], 30)).toBe("anullsrc=r=48000:cl=stereo,atrim=duration=30[mix]");
  });

  it("normalises in two passes to -14 LUFS, true peak -1 dB", () => {
    expect(LOUDNESS).toEqual({ I: -14, TP: -1, LRA: 11 });
    const m = parseMeasured('[Parsed_loudnorm_0] \n{\n\t"input_i" : "-23.05",\n\t"input_tp" : "-6.10",\n\t"input_lra" : "1.20",\n\t"input_thresh" : "-33.20",\n\t"output_i" : "-14.0",\n\t"target_offset" : "0.05"\n}');
    expect(normaliseFilter(m)).toBe("loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.05:measured_TP=-6.10:measured_LRA=1.20:measured_thresh=-33.20:offset=0.05:linear=true,aresample=48000");
  });

  it.skipIf(!hasFfmpeg)("a tone placed at 1.5 s starts there within 20 ms, and the mix ends at -14 ± 0.5 LUFS", () => {
    const dir = mkdtempSync(join(tmpdir(), "mix-"));
    try {
      const tone = join(dir, "tone.wav");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000", "-af", "volume=-20dB", tone]);
      const graph = placeFilter([{ file: tone, at: 1.5 }], 6);
      const pass1 = spawnSync("ffmpeg", ["-hide_banner", "-f", "lavfi", "-i", "anullsrc", "-i", tone, "-filter_complex", `${graph};[mix]loudnorm=I=-14:TP=-1:LRA=11:print_format=json[o]`, "-map", "[o]", "-f", "null", "-"], { encoding: "utf8" });
      const out = join(dir, "mix.wav");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc", "-i", tone, "-filter_complex", `${graph};[mix]${normaliseFilter(parseMeasured(pass1.stderr))}[o]`, "-map", "[o]", out]);
      const sil = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-af", "silencedetect=n=-50dB:d=0.5", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      const end = Number(/silence_end: ([\d.]+)/.exec(sil)![1]);
      expect(Math.abs(end - 1.5)).toBeLessThan(0.02);
      const meas = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      expect(Math.abs(Number(parseMeasured(meas).input_i) - -14)).toBeLessThan(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

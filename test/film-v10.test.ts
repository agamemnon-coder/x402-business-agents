// Film v10 (13 Nov, the enterprise hand-in): the cut passes its honesty and timing check, stays under five minutes,
// has nobody on camera (an AI narrator reads every line), labels what is simulated, and its words in docs/video/ are
// what the code writes (npm run cut -- --docs handin-10).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BADGES, CUTS, HANDIN10, RECORDINGS_10, ROOT, checkCut, onScreen, resolveCut, scriptMarkdown, shotListMarkdown, srt, total } from "../src/film/cuts.js";
import { SCOPE_SHOTS } from "../src/film/shots.js";
import { SAY, spoken } from "../src/film/narrator10.js";

const placed = resolveCut(HANDIN10);
const words = placed.map((p) => p.row.words).join(" ");
const shown = onScreen(placed).map((x) => x.text).concat(placed.flatMap((p) => p.segs.flatMap((g) => g.title ?? [])));

describe("film v10: the enterprise hand-in", () => {
  it("passes the cut's check: every number in its record, every row long enough, captions short, money badged", () => {
    expect(checkCut(HANDIN10)).toEqual([]);
    expect(CUTS["handin-10"]).toBe(HANDIN10);
  });
  it("is under five minutes and letterboxed", () => {
    expect(total(placed)).toBeLessThanOrEqual(299);
    expect(HANDIN10.letterbox).toBe(true);
  });
  it("has nobody on camera and no placeholder: an AI narrator, title cards, page shots and recordings made by code", () => {
    expect(placed.every((p) => p.row.kind === "vo" || p.row.kind === "card")).toBe(true);
    expect(placed.flatMap((p) => p.segs).some((g) => g.own)).toBe(false);
    for (const g of placed.flatMap((p) => p.segs)) if (g.rec) expect(Object.keys(RECORDINGS_10)).toContain(g.rec);
    for (const g of placed.flatMap((p) => p.segs)) if (g.shot) expect(SCOPE_SHOTS.map((s) => s.id)).toContain(g.shot[0]);
  });
  it("says no N/N fraction, names the passkey as Face ID or a passkey, and labels what is simulated", () => {
    for (const t of [words, ...shown]) expect({ t, fraction: /\b\d+\s*(of|\/)\s*\d+\b/.test(t) }).toEqual({ t, fraction: false });
    expect(words).toContain("Face ID or a passkey");
    expect(words).toContain("virtual test passkey");
    expect(words).toContain("simulated settlement");
    expect(words).toContain("made-up data, test money");
    expect(shown).toContain(BADGES.simbank);
    expect(shown).toContain(BADGES.demo);
    expect(shown).toContain(BADGES.notlive);
  });
  it("credits the AI voice and music on its end card and says test money only", () => {
    const card = placed.at(-1)!.segs[0]!.card!.join(" ");
    expect(card).toContain("Voice-over and music: AI-generated (ElevenLabs)");
    expect(card).toContain("Test money only");
  });
  it("speaks the words as written, only respelt for the voice", () => {
    expect(spoken("T:0 and Airi")).toBe("T-zero and Airee");
    expect(SAY.length).toBeGreaterThan(0);
  });
  it("the recording of /try was made with a virtual test passkey and test money, and the page showed each step", () => {
    const rec = JSON.parse(readFileSync(resolve(ROOT, "docs/video/recording-try-v10.json"), "utf8")) as { passkey: string; money: string; said: Record<string, string> };
    expect(rec.passkey).toContain("virtual test passkey");
    expect(rec.money).toContain("test money");
    expect(rec.said.duplicate).toContain("Caught: a copy of a filed invoice.");
    expect(rec.said["approve-shown"]).toMatch(/Conversion.*Bank fee at most EUR 20\.00.*Sign before/);
    expect(rec.said.paid).toContain("Paid on the simulated bank · test money");
    expect(rec.said.refused).toContain("Refused by Purser");
  });
  it("writes the same words into docs/video/ as the code", () => {
    expect(readFileSync(resolve(ROOT, "docs/video/film-v10-script.md"), "utf8")).toBe(scriptMarkdown(HANDIN10, placed));
    expect(readFileSync(resolve(ROOT, "docs/video/film-v10-shots.md"), "utf8")).toBe(shotListMarkdown(HANDIN10, placed));
    expect(readFileSync(resolve(ROOT, "docs/video/film-v10.srt"), "utf8")).toBe(srt(placed));
  });
});

describe("film v10's YouTube description", () => {
  it("lists the cut's own chapters", () => {
    const yt = readFileSync(resolve(ROOT, "docs/video/film-v10-youtube.md"), "utf8");
    const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    for (const p of placed.filter((x) => x.row.chapter)) expect(yt).toContain(`${clock(Math.round(p.start))} ${p.row.chapter}`);
    expect(yt).toContain("Voice-over and music: AI-generated (ElevenLabs).");
  });
});

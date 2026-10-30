// "Purser live": every number on screen comes from a recording; a missing fact stops the build instead of a guess.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Recorded } from "../src/demo/recorded.js";
import type { Story } from "../src/demo/story.js";
import { buildLiveTimeline } from "../src/live/timeline.js";
import { LIVE_CSP, livePage } from "../src/servers/dashboard.js";

const story = JSON.parse(readFileSync(new URL("../docs/demo/story.json", import.meta.url), "utf8")) as Story;
const recorded = JSON.parse(readFileSync(new URL("../docs/demo/snapshot.json", import.meta.url), "utf8")) as Recorded;

describe("the Purser live timeline", () => {
  it("has the storyboard's scenes, model labels at the Face ID and invoice scenes, and a source for each", () => {
    const t = buildLiveTimeline(story, recorded);
    expect(t.scenes.map((s) => s.id)).toEqual(["title", "coins", "card", "refuse", "faceid", "invoice", "dispute", "ask", "fx", "wall", "end"]);
    expect(t.scenes.find((s) => s.id === "faceid")!.models.map((m) => m.model)).toEqual(["Opus"]);
    expect(t.scenes.find((s) => s.id === "invoice")!.models.map((m) => m.model)).toEqual(["Haiku", "Sonnet", "Opus"]);
    for (const s of t.scenes) expect(s.source.length).toBeGreaterThan(10);
    expect(t.scenes.reduce((a, s) => a + s.seconds, 0)).toBeLessThanOrEqual(100);
  });

  // Breaks if a scene could show a number the recording does not hold.
  it("stops when the recording lacks a fact, instead of making one up", () => {
    const thin = { ...story, steps: story.steps.filter((s) => s.id !== "swift") };
    expect(() => buildLiveTimeline(thin, recorded)).toThrow(/no step "swift"/);
    const noCase = { ...recorded, snapshot: { ...recorded.snapshot, disputes: [] } } as unknown as Recorded;
    expect(() => buildLiveTimeline(story, noCase)).toThrow(/no Dispute desk case/);
  });

  it("serves one page whose only script and style the CSP allows, with the data escaped", () => {
    const html = livePage();
    expect(html).not.toContain("__LIVE_JSON__");
    expect(LIVE_CSP).toMatch(/script-src 'sha256-[^']+'; style-src 'sha256-/);
    expect(html.match(/<script>/g)).toHaveLength(1);
  });
});

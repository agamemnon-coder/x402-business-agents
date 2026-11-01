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

  it("gives Airwallex and Metal about thirty seconds each, and every scene where money moves carries its proof", () => {
    const t = buildLiveTimeline(story, recorded);
    const per = (rail: string) => t.scenes.filter((s) => s.rail === rail).reduce((a, s) => a + s.seconds, 0);
    for (const rail of ["airwallex", "metal"]) {
      expect(per(rail)).toBeGreaterThanOrEqual(26);
      expect(per(rail)).toBeLessThanOrEqual(36);
    }
    for (const s of t.scenes) {
      for (const m of s.moves) expect(m.at + 2).toBeLessThanOrEqual(s.seconds);
      if (s.rail) expect(s.proofs.length, s.id).toBeGreaterThan(0);
      for (const p of s.proofs) expect(p.value).not.toMatch(/USDZ|undefined/);
    }
    // A payment the rail stops says who stopped it.
    for (const m of t.scenes.flatMap((s) => s.moves)) if (m.outcome !== "ok" && m.outcome !== "in") expect(m.gate).toMatch(/Airwallex|chain|Metal|Purser/);
  });

  // Breaks if a scene could show a number the recording does not hold.
  it("stops when the recording lacks a fact, instead of making one up", () => {
    const thin = { ...story, steps: story.steps.filter((s) => s.id !== "swift") };
    expect(() => buildLiveTimeline(thin, recorded)).toThrow(/no step "swift"/);
    const noCase = { ...recorded, snapshot: { ...recorded.snapshot, disputes: [] } } as unknown as Recorded;
    expect(() => buildLiveTimeline(story, noCase)).toThrow(/no Dispute desk case/);
  });

  // Max, 1 Nov: no empty rail boxes; the audit-row count once; the stranger in plain words; "Powered by Claude" only
  // for a run in which the agents decided.
  it("draws a scene's rail only with something on it: money moving or a note", () => {
    const t = buildLiveTimeline(story, recorded);
    for (const s of t.scenes) if (s.rail) expect({ scene: s.id, shown: s.moves.some((m) => m.lane === s.rail) || (s.notes ?? []).some((n) => n.lane === s.rail) }).toEqual({ scene: s.id, shown: true });
    expect(t.scenes.find((s) => s.id === "faceid")!.notes).toEqual([{ lane: "metal", text: "2 mandates replaced on chain ✓", at: 1.6 }]);
  });

  it("shows the audit-row count once on the whole page", () => {
    const t = buildLiveTimeline(story, recorded);
    const rows = String((recorded.snapshot as unknown as { audit: { rows: number } }).audit.rows);
    const shown = t.scenes.flatMap((s) => [s.title, s.line, s.big?.value ?? "", s.big?.label ?? "", ...s.facts.map((f) => `${f.label} ${f.value}`), ...s.proofs.map((p) => `${p.label} ${p.value}`)]);
    expect(shown.filter((x) => new RegExp(`\\b${rows}\\b`).test(x))).toEqual([rows]);
  });

  it("names the stranger in plain words, never \"Unknown sender\"", () => {
    const html = livePage();
    expect(html).not.toMatch(/Unknown sender/);
    expect(buildLiveTimeline(story, recorded).scenes.find((s) => s.id === "wall")!.moves[0]!.from).toBe("An unknown address (not a customer)");
  });

  it("says Claude read the documents for the 30 October recording, and that the agents decided only when one did", () => {
    expect(buildLiveTimeline(story, recorded).claude).toBe("read");
    const decided = { ...recorded, snapshot: { ...recorded.snapshot, agent_chat: [{ kind: "decision", by: "claude", who: "support", text: "settled" }] } } as unknown as Recorded;
    expect(buildLiveTimeline(story, decided).claude).toBe("decided");
    const fallback = { ...recorded, snapshot: { ...recorded.snapshot, agent_chat: [{ kind: "decision", by: "fallback", who: "support", text: "code" }] } } as unknown as Recorded;
    expect(buildLiveTimeline(story, fallback).claude).toBe("read");
  });

  it("serves one page whose only script and style the CSP allows, with the data escaped", () => {
    const html = livePage();
    expect(html).not.toContain("__LIVE_JSON__");
    expect(LIVE_CSP).toMatch(/script-src 'sha256-[^']+'; style-src 'sha256-/);
    expect(html.match(/<script>/g)).toHaveLength(1);
  });
});

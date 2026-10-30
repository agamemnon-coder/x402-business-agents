import { describe, expect, it } from "vitest";
import { BEATS, beatSeconds, scriptMarkdown, subtitlesSrt, totalSeconds } from "../src/video/plan.js";

const toSeconds = (t: string) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s!.replace(",", ".")); };

describe("the video plan", () => {
  it("is the film, scene by scene, under three minutes", () => {
    expect(totalSeconds()).toBe(173);
    expect(BEATS.map((b) => b.id)).toEqual(["01-open", "02-problem", "03-reveal", "04-card", "05-bill", "06-metal", "07-dispute", "08-ask", "09-trust", "10-end"]);
    expect(BEATS.map((b) => b.shots[0]!.path)).toEqual([0, 12, 24, 38, 60, 82, 112, 132, 146, 163].map((s) => `/film?manual&from=${s}`));
  });

  it("gives each beat time to say its words (at most 150 words a minute)", () => {
    for (const b of BEATS) expect(b.voice.split(/\s+/).length / (beatSeconds(b) / 60), b.id).toBeLessThanOrEqual(150);
  });

  it("keeps every camera move inside its shot", () => {
    for (const b of BEATS) for (const s of b.shots) for (const a of s.actions ?? []) expect(a.at, `${b.id} ${s.path}`).toBeLessThan(s.seconds);
  });

  it("times the subtitles in order, inside the video, and carries every word of the script", () => {
    const cues = subtitlesSrt().trim().split(/\n\n/).map((c) => { const [, time, ...text] = c.split("\n"); const [a, b] = time!.split(" --> "); return { a: toSeconds(a!), b: toSeconds(b!), text: text.join(" ") }; });
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i]!.b).toBeGreaterThan(cues[i]!.a);
      if (i) expect(cues[i]!.a).toBeGreaterThanOrEqual(cues[i - 1]!.b);
    }
    expect(cues.at(-1)!.b).toBeLessThanOrEqual(totalSeconds());
    expect(cues.map((c) => c.text).join(" ").split(/\s+/)).toEqual(BEATS.map((b) => b.voice).join(" ").split(/\s+/));
  });

  it("writes the script with the time each beat starts", () => {
    expect(scriptMarkdown()).toContain("# Purser: the video script (2:53)");
    expect(scriptMarkdown()).toContain("## 0:00 Hook (12 s, clip `01-open.mp4`)");
    expect(scriptMarkdown()).toContain("## 2:43 Purser (10 s, clip `10-end.mp4`)");
  });
});

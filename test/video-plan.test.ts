import { describe, expect, it } from "vitest";
import { BEATS, beatSeconds, scriptMarkdown, subtitlesSrt, totalSeconds } from "../src/video/plan.js";

const toSeconds = (t: string) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s!.replace(",", ".")); };

describe("the video plan", () => {
  it("runs 4:30, in the order of the script Max agreed", () => {
    expect(totalSeconds()).toBe(270);
    expect(BEATS.map((b) => b.id)).toEqual(["b1-hook", "b2-problem", "b3-purser", "b4-card", "b5-fx", "b6-metal", "b7-ask", "b8-trust", "b9-vision"]);
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
    expect(scriptMarkdown()).toContain("## 0:00 Hook (15 s, clip `b1-hook.mp4`)");
    expect(scriptMarkdown()).toContain("## 4:10 Vision (20 s, clip `b9-vision.mp4`)");
  });
});

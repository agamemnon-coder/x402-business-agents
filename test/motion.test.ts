// The shared motion module (master list 354): one set of keyframes, every animation off under reduced motion, and a
// count-up that never changes the figure a page says.
import { describe, expect, it } from "vitest";
import { MOTION_CSS, MOTION_JS, countParts, countText, countUp, faceIdTick } from "../src/ui/motion.js";

describe("motion", () => {
  it("turns every animation off under prefers-reduced-motion", () => {
    const reduced = MOTION_CSS.slice(MOTION_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const c of [".mo-tick", ".mo-shake", ".mo-rise", ".mo-count.counting"]) expect(reduced).toContain(c);
    expect(MOTION_JS).toMatch(/prefers-reduced-motion: reduce\)"\)\.matches/);
  });

  it("uses only the site's tokens, no new colour", () => {
    expect(MOTION_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(faceIdTick()).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("keeps each animation between 150 and 400 ms", () => {
    for (const m of MOTION_CSS.matchAll(/\b(\.\d+)s\b/g)) expect(Number(m[1]) * 1000).toBeLessThanOrEqual(400);
  });

  it("count-up writes the final figure as the text, and counts in the figure's own format", () => {
    expect(countUp("EUR 1,850.00", (s) => s)).toBe('<span class="mo-count">EUR 1,850.00</span>');
    expect(countParts("6.4 s")).toEqual({ pre: "", value: 6.4, decimals: 1, commas: false, post: " s" });
    expect(countText("EUR 1,850.00", 1)).toBe("EUR 1,850.00");
    expect(countText("EUR 1,850.00", 0)).toBe("EUR 0.00");
    expect(countText("EUR 1,850.00", 0.5)).toBe("EUR 925.00");
    expect(countText("95 entries", 1)).toBe("95 entries");
    expect(countText("no figure", 0.3)).toBe("no figure");
  });

  it("the tick has a name for a screen reader", () => {
    expect(faceIdTick(18, 'A "b"')).toMatch(/role="img" aria-label="A &#34;b&#34;"/);
  });

  it("the script is plain ES5 for a template string", () => {
    expect(MOTION_JS).not.toMatch(/`|\$\{|=>|\blet\b|\bconst\b/);
    expect(() => new Function(MOTION_JS)).not.toThrow();
  });
});

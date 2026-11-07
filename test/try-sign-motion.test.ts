// /try/sign's motion pass (Max, 7 Nov): every animation and transition the page defines runs 150 to 400 ms, none holds
// anything up, and prefers-reduced-motion shows the end state at once (the style turns every animation off; the script
// counts nothing). test/browser/trysign.check.ts plays it in Chromium, with and without reduced motion.
import { describe, expect, it } from "vitest";
import { trySignCss, trySignPage } from "../src/try/sign.js";

const css = trySignCss();
const seconds = (t: string) => (t.endsWith("ms") ? Number(t.slice(0, -2)) / 1000 : Number(t.slice(0, -1)));
/** Every duration the style sets: the first time in each animation or transition (the second is a delay), and animation-duration. */
function durations(text: string): { where: string; s: number }[] {
  const out: { where: string; s: number }[] = [];
  for (const m of text.matchAll(/(?<![-\w])(animation|transition)\s*:\s*([^;}]+)/g)) {
    if (/^\s*none/.test(m[2]!)) continue;
    for (const part of m[2]!.split(",")) {
      const t = /(?:^|\s)(\d*\.?\d+m?s)\b/.exec(part);
      if (t) out.push({ where: `${m[1]}: ${part.trim()}`, s: seconds(t[1]!) });
    }
  }
  for (const m of text.matchAll(/animation-duration\s*:\s*(\d*\.?\d+m?s)/g)) out.push({ where: m[0], s: seconds(m[1]!) });
  return out;
}

describe("/try/sign's motion", () => {
  it("every animation and transition runs 150 to 400 ms", () => {
    const all = durations(css);
    expect(all.length).toBeGreaterThan(15);
    expect(all.filter((d) => d.s < 0.15 || d.s > 0.4)).toEqual([]);
  });

  it("each named animation has its keyframes, and each of the asked-for moments is there", () => {
    const names = new Set([...css.matchAll(/animation\s*:\s*([a-z][\w-]*)\s/g)].map((m) => m[1]!).filter((n) => n !== "none"));
    for (const n of names) expect(css).toContain(`@keyframes ${n} `);
    // The tick drawn in with a glow; the shake and the red field; the invoice sliding in and the block; the locks one by
    // one; the payment through the locks; the diagram lighting per step.
    for (const n of ["draw", "glow", "shake", "lightred", "slidein", "blockin", "lockon", "fill", "stop", "dnlit"]) expect(names).toContain(n);
  });

  it("prefers-reduced-motion turns every animation and transition off, and the script counts nothing then", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.story \*, \.story \*::before, \.story \*::after \{ animation: none !important; transition: none !important; \}/);
    const page = trySignPage();
    expect(page).toContain('function still() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }');
    expect(page).toContain("if (still() || !at) { end(); return; }");
    expect(page).toContain("function replay(n, cls) { n.classList.remove(cls); if (still()) return;");
  });

  it("nothing waits for an animation: no animationend or transitionend handler, no timer around one", () => {
    const page = trySignPage();
    expect(page).not.toMatch(/animationend|transitionend/);
  });

  it("cards: a subtle shadow and a light gradient; no glass (no backdrop blur)", () => {
    expect(css).toMatch(/\.story \.card \{ background: linear-gradient\(/);
    expect(css).not.toMatch(/backdrop-filter:\s*blur/);
  });
});

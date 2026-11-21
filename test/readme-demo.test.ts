// The README's small demo and its two step cards (21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps;
// the second architecture animation can go; far fewer headings"), drawn by scripts/readme-demo-svg.ts from one recorded
// /try walk and the evidence wall. Redrawn here and compared with the committed files; every figure read again from the
// walk's record a second way; and, as GitHub shows each in an <img>: no script, nothing external, under 16 KB, played
// once (nothing infinite), stopped by prefers-reduced-motion (the still frame is the last frame).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_FILES, DEMO_RECORD, STEP_FILES, WALL_RECORD, demoAlt, demoFigures, demoSvgs, readmeDemoLine, readmeStepLines } from "../scripts/readme-demo-svg.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ALL = [...Object.values(DEMO_FILES), ...Object.values(STEP_FILES)];

describe("the README's small demo", () => {
  it("is the committed SVGs, redrawn from the records (run npm run readme:demo if not)", () => {
    const drawn = demoSvgs();
    expect(Object.keys(drawn).sort()).toEqual([...ALL].sort());
    for (const f of ALL) expect({ f, same: read(f) === drawn[f] }).toEqual({ f, same: true });
  });

  it("shows one recorded walk as its record has it: read, checked, signed, paid; one cent more, refused", () => {
    const walk = JSON.parse(read(DEMO_RECORD)) as { ok: boolean; started_at: string; passkey: string; answers: { path: string; body: Record<string, unknown> }[] };
    expect(walk.ok).toBe(true);
    const text = JSON.stringify(walk);
    const f = demoFigures();
    expect(f.day).toBe("21 Nov");
    expect(f.invoice).toEqual({ no: "BTX-2026-21", vendor: "Bergtex Textil GmbH", amount: "1,850.00", currency: "EUR" });
    expect(text).toContain('"invoice_no":"BTX-2026-21"');
    expect(text).toContain('"total":"1850.00"');
    expect(f.claude).toEqual({ model: "claude-haiku-5-5", live: true, line: "Total due EUR 1,850.00" });
    expect(text).toContain('"read_by":"claude:claude-haiku-5-5"');
    expect(f.checks).toEqual(["not paid before", "bank on file", "known supplier"]);
    expect(f.limit).toBe("EUR 500.00");
    // The signed hash is the proposal's; the payment went out over it; Airwallex's sandbox says PAID (settlement simulated).
    expect(text).toContain(`"status":"PENDING_APPROVAL","terms_sha256":"${f.signed}"`);
    expect(f.paid).toEqual({ status: "PAID", source: "airwallex-sandbox", amount: "1,850.00" });
    // The refusal: the amount one cent more, another hash, no new transfer.
    expect(f.refused.amount).toBe("1,850.01");
    expect(text).toContain('\\"amount\\":\\"1850.01\\"');
    expect(f.refused.sent).not.toBe(f.signed);
    expect(f.refused.transfersAfter).toBe(f.refused.transfersBefore);
    expect(f.refused.reason).toContain("Nothing was paid.");
    // The walk used a software passkey (a recorded walk in a test browser): the demo says "a passkey", never Face ID as
    // a fact about this walk; the Face ID in the step card is the button's own label, as the page showed it.
    expect(walk.passkey).toBe("software-passkey");
    for (const f2 of Object.values(DEMO_FILES)) expect(read(f2)).not.toMatch(/Face ID/);
    expect(f.signButton).toBe("Approve & sign EUR 1,850.00 with Face ID");
    // The totals over every walk: the evidence wall's own tiles.
    const wall = read(WALL_RECORD);
    expect(wall).toContain(`"fig": "${f.wall.cent}"`);
    // Review, 21 Nov: over the walks that tried the cent step, never "66 of 67" as if one changed cent got through.
    expect(f.wall.centLabel).toMatch(/^(attempted )?one-cent changes refused after approval$/);
    expect(f.wall.cent).toMatch(/^All /);
  });

  it("says test money and sandbox in every picture, and in the README's alt text what the picture shows", () => {
    const f = demoFigures();
    for (const file of Object.values(DEMO_FILES)) {
      const svg = read(file);
      for (const s of ["Test money · sandbox", "test money only", "Airwallex sandbox", "settlement simulated", f.invoice.no, `EUR ${f.invoice.amount}`, f.refused.amount.slice(0, -1), "Refused · nothing paid", f.wall.cent]) expect({ file, s, shown: svg.includes(s) }).toEqual({ file, s, shown: true });
    }
    for (const file of Object.values(STEP_FILES)) expect(read(file)).toContain("test money");
    const alt = demoAlt();
    expect(alt).toContain("test money");
    expect(alt).toContain("(settlement simulated)");
    expect(alt).not.toContain('"');
    const readme = read("README.md");
    expect(readme).toContain(`\n${readmeDemoLine()}\n`);
    for (const l of readmeStepLines()) expect(readme).toContain(`\n${l}\n`);
    // The phone's layout under 600 px, each theme by prefers-color-scheme, the wide light one as the <img>.
    expect(readmeDemoLine()).toMatch(/^<a href="https:\/\/kit11\.max-31b\.workers\.dev\/try"><picture><source media="\(max-width: 600px\) and \(prefers-color-scheme: dark\)" srcset="docs\/assets\/readme\/demo-narrow-dark\.svg"><source media="\(max-width: 600px\)" srcset="docs\/assets\/readme\/demo-narrow-light\.svg"><source media="\(prefers-color-scheme: dark\)" srcset="docs\/assets\/readme\/demo-dark\.svg"><img src="docs\/assets\/readme\/demo-light\.svg" alt="[^"]+" width="100%"><\/picture><\/a>$/);
  });

  it("has a title, no script or external link, stays under 16 KB, plays once and stops under reduced motion", () => {
    for (const f of ALL) {
      const svg = read(f);
      expect(svg).toMatch(/<title id="t">[^<]{20,}<\/title>/);
      expect({ f, script: /<script|on[a-z]+=|<foreignObject|javascript:|<image/i.test(svg) }).toEqual({ f, script: false });
      expect({ f, external: /(?:xlink:)?href="(?!#)|src="|url\((?!#)|@import|="https?:\/\/(?!www\.w3\.org\/2000\/svg")/.test(svg) }).toEqual({ f, external: false });
      expect({ f, kb: Buffer.byteLength(svg) < 16 * 1024 }).toEqual({ f, kb: true });
      expect(svg).not.toMatch(/infinite/);
    }
    for (const f of Object.values(DEMO_FILES)) {
      const svg = read(f);
      expect(svg).toMatch(/<desc id="d">[^<]{200,}<\/desc>/);
      expect(svg).toMatch(/@keyframes/);
      expect(svg).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.in,\.tick,\.fill,\.fill\.v,\.cent\{animation:none\}\}/);
      // Every animation runs once (the cent blinks three times) and is done within 8 s.
      const delays = [...svg.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
      expect(Math.max(...delays) + 0.5).toBeLessThanOrEqual(8);
      expect(svg).toMatch(/\.cent\{animation:blink \.45s ease-in-out [\d.]+s 3 both\}/);
    }
  });
});

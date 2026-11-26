// The Markdown pages' animated SVGs (scripts/docs-anim.ts): drawn from their records, committed as drawn, small, with no
// script, and still for a reader who asks for reduced motion.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANIM_DIR, animations } from "../scripts/docs-anim.js";

describe("the docs' animations", () => {
  const drawn = animations();

  it("the committed files are exactly the ones the script draws (npm run docs:anim)", () => {
    expect(readdirSync(ANIM_DIR).filter((n) => n.endsWith(".svg")).sort()).toEqual(Object.keys(drawn).sort());
    for (const [name, svg] of Object.entries(drawn)) expect({ name, same: readFileSync(join(ANIM_DIR, name), "utf8") === svg }).toEqual({ name, same: true });
  });

  for (const [name, svg] of Object.entries(drawn)) it(`${name}: a light and a dark file, under 30 KB, no script, still under reduced motion, with a title`, () => {
    expect(name).toMatch(/-(light|dark)\.svg$/);
    expect(Object.keys(drawn)).toContain(name.replace(/-(light|dark)\.svg$/, (_, t: string) => `-${t === "light" ? "dark" : "light"}.svg`));
    expect(Buffer.byteLength(svg)).toBeLessThan(30 * 1024);
    expect(svg).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    expect(svg).toContain("@media (prefers-reduced-motion: reduce){*{animation:none!important}}");
    expect(svg).toMatch(/<title>[^<]+Test money only|<title>[^<]+not been pulled live/);
    expect(svg).toMatch(/role="img" aria-label="[^"]+"/);
  });

  it("the one-cent picture shows the /try samples' own amounts and hashes", () => {
    const paid = JSON.parse(readFileSync(new URL("../docs/proof/try-paid.json", import.meta.url), "utf8")) as { terms_sha256: string };
    const refused = JSON.parse(readFileSync(new URL("../docs/proof/try-refused.json", import.meta.url), "utf8")) as { asked: { sha256: string } };
    const svg = drawn["one-cent-light.svg"]!;
    expect(svg).toContain(`${paid.terms_sha256.slice(0, 8)}…${paid.terms_sha256.slice(-4)}`);
    expect(svg).toContain(`${refused.asked.sha256.slice(0, 8)}…${refused.asked.sha256.slice(-4)}`);
    expect(svg).toContain("EUR 1,850.00");
    expect(svg).toContain("EUR 1,850.0<tspan");
  });

  it("the emergency stop says what is tested and what is not, as the runbook does", () => {
    const runbook = readFileSync(new URL("../docs/runbook.md", import.meta.url), "utf8");
    expect(runbook).toContain("The full stop has not been pulled live end to end.");
    expect(runbook).toContain("`CARD_INACTIVE` checked live\non a single card");
    expect(drawn["emergency-stop-dark.svg"]).toContain("The full stop has not been pulled live end to end");
    expect(drawn["emergency-stop-dark.svg"]).toContain("CARD_INACTIVE checked live on a single card");
  });
});

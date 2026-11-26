// The Obsidian card art (27 Nov, Max chose it): the shared shapes are generated once, with fixed seeds, by
// cloud/src/cardArtBuild.ts into cloud/src/agentCardArt.gen.ts (npm run cloud:card-art). Breaks if the generated file
// drifts from its builder, if the art grows past its share of the Worker's size, if anything in it could run or fetch,
// or if a card's words stop being escaped or show more than the last four.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cardArtDefs, cardArtGenSource } from "../cloud/src/cardArtBuild.js";
import { CARD_ART_CSS, CARD_ART_DEFS, cardSvg, RELIEF, reliefOf } from "../cloud/src/agentCardArt.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

describe("the Obsidian card art", () => {
  it("is generated from its builder: run npm run cloud:card-art after changing cloud/src/cardArtBuild.ts", () => {
    expect(readFileSync(new URL("../cloud/src/agentCardArt.gen.ts", import.meta.url), "utf8")).toBe(cardArtGenSource());
    expect(CARD_ART_DEFS).toBe(cardArtDefs());
    // Fixed seeds: the same output every time.
    expect(cardArtDefs()).toBe(cardArtDefs());
    expect(readFileSync(new URL("../cloud/src/cardArtBuild.ts", import.meta.url), "utf8")).not.toMatch(/Math\.random|Date\.now|new Date/);
  });

  it("stays small: all the cards' shared shapes in at most 12 KB gzipped (the Worker's budget is tight)", () => {
    expect(gzipSync(CARD_ART_DEFS).length).toBeLessThanOrEqual(12 * 1024);
  });

  it("holds every shape a card uses, and nothing that could run, fetch or take a style attribute", () => {
    for (const id of ["ground", "rel-leaves", "rel-sea", "rel-night", "rel-lines", "band", "fade", "medal", "quill", "chip", "word", "frame", "sheen", "mo", "ch", "pw", "vs"]) expect(CARD_ART_DEFS, id).toContain(`id="pc-${id}"`);
    expect(CARD_ART_DEFS.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/<script|<foreignObject|\son[a-z]+=|style=|https?:|javascript:/i);
    expect(CARD_ART_CSS).toContain(".pc-defs {");
  });

  it("gives Sourcing leaves, Treasury the sea and Support the night sky; any other agent the engraved lines", () => {
    expect(RELIEF).toEqual({ sourcing: "leaves", treasury: "sea", support: "night" });
    expect(reliefOf("checker")).toBe("lines");
    expect(cardSvg({ agent: "treasury", name: "Treasury agent", last4: "4006", logo: null, initials: null }, esc)).toContain('<use href="#pc-rel-sea" opacity=".2"/>');
  });

  it("draws a card's words as escaped text, the last four only, and no chip or network without a card", () => {
    const paid = cardSvg({ agent: "sourcing", name: "Sourcing <b>agent</b>", last4: "4002", logo: null, initials: null }, esc);
    expect(paid).toContain("SOURCING &lt;B&gt;AGENT&lt;/B&gt;");
    expect(paid).toContain(">•••• 4002</text>");
    expect(paid).toMatch(/<use class="ac-pf" href="#pc-quill"\/>/);
    expect(paid).toContain('<use href="#pc-chip"');
    expect(paid).toContain(">VISA</text>");
    const bare = cardSvg({ agent: "checker", name: "Checker agent", last4: null, logo: null, initials: "N&W" }, esc);
    expect(bare).not.toMatch(/pc-chip|VISA|••••/);
    expect(bare).toContain(">No card of its own</text>");
    expect(bare).toContain(">N&amp;W</text>");
  });
});

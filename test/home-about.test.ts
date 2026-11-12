// "About Purser" on Home. It was a closed fold with four paragraphs: the problem, what Purser does, the runs and the
// business. Since the homepage polish of 12 November (the owner: "the 3 locks and About Purser are a lot of text") it
// is an open section of two short sentences, the payment's life (src/visuals/svg.ts) and the partners' logos. The runs,
// the pricing and the business case live on their own pages (/runs, /pricing, /docs), so this test no longer pins those
// paragraphs. Still held: no customer, pilot or revenue claimed, no quotes, no design-partner call, no person named.
import { describe, expect, it } from "vitest";
import { DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL } from "../src/config/brand.js";
import { ABOUT_HEAD, AGENT_FLOW, WORKS_WITH, homePage } from "../src/redesign/home.js";
import { BUILT_WITH } from "../src/visuals/logos.js";
import { textOutsideTags } from "./support/scriptBlocks.js";

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const text = (html: string) => textOutsideTags(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ")).replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!).replace(/\s+/g, " ").trim();
const about = (html: string) => /<section class="about"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("About Purser on Home", () => {
  it("is the last section, after the last button: a heading, five steps (who decides, who enforces) and the logos", () => {
    expect(ABOUT_HEAD).toBe("About Purser");
    expect(AGENT_FLOW.map((f) => f.verb)).toEqual(["Read", "Check", "Code", "Sign", "Pay"]);
    for (const html of [ON, OFF]) {
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      expect(main.indexOf('<section class="about"')).toBeGreaterThan(main.indexOf('class="btn big more"'));
      const a = about(html);
      expect(a).toContain(`id="about">${ABOUT_HEAD}</h2>`);
      expect(text(a)).toBe(`${ABOUT_HEAD} ${AGENT_FLOW.map((f) => `${f.verb} ${f.who}${f.evals ? " evals" : ""}`).join(" ")} ${WORKS_WITH}`);
      // Steps whose agent has run in evals only link the evals (the Checker and the Payer, behind KIT11_AP_AGENTS).
      expect(AGENT_FLOW.filter((f) => f.evals).map((f) => f.verb)).toEqual(["Check", "Pay"]);
      expect(a).not.toMatch(/ style="/);
    }
  });

  it("shows the partners' logos as one image, served by the site, named in its alt text", () => {
    const names = BUILT_WITH.map((l) => l.name);
    const alt = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    expect(about(ON)).toContain(`<img src="assets/built-with.png" alt="${alt}"`);
    expect(about(ON)).not.toMatch(/Built on|endorse|certified|partner of/i);
  });

  it("claims no customer, quotes no one, asks for no design partner and names no person", () => {
    expect(DESIGN_PARTNER_URL).toBe("");
    for (const html of [ON, OFF]) {
      expect(html).not.toContain(DESIGN_PARTNER_LABEL);
      expect(html).not.toMatch(/design partner|Looking for/i);
    }
    const t = text(about(ON));
    expect(t).not.toMatch(/[“”"«»]/);
    expect(t).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
    expect(t).not.toMatch(/\bMax\b|Geurtsen|founder/i);
    expect(t).not.toMatch(/customer|pilot|revenue|revolution|seamless|world-class|game.?chang|cutting.edge|best-in-class|unique|effortless/i);
  });
});

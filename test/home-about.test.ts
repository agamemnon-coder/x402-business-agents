// "About Purser" on Home: since the enterprise pass (owner, 12 Nov) the five steps, who decides and who enforces, as a
// stepper under the features; the partners' logos moved into the hero, as a greyed row. Still held: a step names Claude
// only where a run record or an eval shows it ran, and the eval-only steps link the evals; no customer, pilot or revenue
// claimed, no quotes, no design-partner call, no person named.
import { describe, expect, it } from "vitest";
import { DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL } from "../src/config/brand.js";
import { readFileSync } from "node:fs";
import { ABOUT_HEAD, AGENT_FLOW, CLAUDE_ADDS, FEATURES, AGENT_SETS_NOTE, FLOW_HEAD, NO_ENDORSEMENT, VISA_WORKS_WITH, WORKS_WITH, homePage } from "../src/redesign/home.js";
import { MARKS_NOTE } from "../src/redesign/ui.js";
import { textOutsideTags } from "./support/scriptBlocks.js";

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const text = (html: string) => textOutsideTags(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ")).replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!).replace(/\s+/g, " ").trim();
const about = (html: string) => /<section class="e-flow"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("About Purser on Home", () => {
  it("is the five steps, who decides and who enforces, between the features and the stats", () => {
    expect(ABOUT_HEAD).toBe("About Purser");
    expect(AGENT_FLOW.map((f) => f.verb)).toEqual(["Read", "Check", "Code", "Sign", "Pay"]);
    for (const html of [ON, OFF]) {
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      expect(main.indexOf('<section class="e-flow"')).toBeGreaterThan(main.indexOf('<section class="e-feat"'));
      expect(main.indexOf('<section class="e-flow"')).toBeLessThan(main.indexOf('<section class="e-stats"'));
      const a = about(html);
      expect(a).toContain(`id="about">${FLOW_HEAD}</h2>`);
      // The eval-only steps end with "(see evals)", a link to the evals (the review of 12 Nov).
      // Then which agents these are (review, 13 Nov): the payables agents; the main run's are named on its line below.
      expect(text(a)).toBe(`${ABOUT_HEAD} ${FLOW_HEAD} ${AGENT_FLOW.map((f) => `${f.verb} ${f.who}${f.evals ? " ( see evals )" : ""}`).join(" ")} ${AGENT_SETS_NOTE}`);
      expect(AGENT_FLOW.filter((f) => f.evals).map((f) => f.verb)).toEqual(["Check", "Pay"]);
      expect(a).not.toMatch(/ style="/);
    }
  });

  // Jury review, 13 Nov: the hero's logos were recoloured (brightness(0), opacity, invert in dark mode), against the
  // "never altered" rule and Visa's brand rules, so they went. 14 Nov (owner): the official files again, each unaltered
  // on its own white tile in both themes (size only), alt the partner's name; never a filter.
  it("shows the partners' official logos in the hero, unaltered on white tiles, alt their names, never recoloured", () => {
    const hero = /<section class="e-hero">[\s\S]*?<\/section>/.exec(ON)![0];
    const trust = /<div class="trust">[\s\S]*?<\/small><\/div>/.exec(hero)![0];
    expect([...trust.matchAll(/<img src="assets\/(logo-[\w-]+\.(?:png|svg))" alt="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([["logo-alta.svg", "Alta (formerly Metal)"], ["logo-claude-slate.svg", "Claude"]]); // alt, judge panel 15 Nov
    // 14 Nov (owner): Airwallex left the "Works with" row: it is the platform, the header's "Built on Airwallex" badge.
    expect(trust).not.toContain("logo-airwallex");
    // 14 Nov: Metal is now Alta, its wordmark shown with the Alta team's OK (docs/evidence/logo-permissions.md); Visa as
    // text on its tile (owner's decision); Metal's old mark is gone.
    // Partner scan, 14 Nov: Visa named for what Purser used.
    expect(trust).toContain('<span class="tile tname visa">Visa Intelligent Commerce via Airwallex Airi (sandbox)</span>');
    expect(trust).not.toMatch(/logo-metal|logo-visa/);
    expect(text(trust).replace(/\s+/g, " ").trim()).toBe(`${WORKS_WITH} ${VISA_WORKS_WITH} ${NO_ENDORSEMENT}`);
    expect(ON).not.toMatch(/filter: (brightness|invert|grayscale)|mix-blend-mode/);
    expect(ON).toMatch(/\.trust \.tile \{[^}]*background: #ffffff/);
    // The one exception: the footer's line that says the marks imply no endorsement (review, 13 Nov).
    expect(MARKS_NOTE).toBe("Partner names and marks only say which services Purser uses; no endorsement implied.");
    expect(ON).toContain(`<li>${MARKS_NOTE}</li>`);
    expect(ON.replace(MARKS_NOTE, "").replace(`<small>${NO_ENDORSEMENT}</small>`, "")).not.toMatch(/endorse|certified|partner of/i);
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

// Jury panel, 15 Nov: Home answers "what does Claude add?" with the worst-case run's own figure.
describe("What Claude adds, on Home", () => {
  it("says what docs/worst-case-ai.md records, its figure word for word", () => {
    const doc = readFileSync(new URL("../docs/worst-case-ai.md", import.meta.url), "utf8");
    expect(doc).toContain("code alone sent seven invoices to the CFO to sign");
    expect(doc).toContain("With the model reading them, Purser held them.");
    expect(CLAUDE_ADDS).toContain("seven invoices to the CFO");
    expect(FEATURES.find((f) => f.title === "What Claude adds")?.text).toBe(CLAUDE_ADDS);
  });
});

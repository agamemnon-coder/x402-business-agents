// What only Purser has, first on every surface (jury review, 6 Nov, #1), and the honesty fixes that came with it
// (#6 the buy rule Claude set, #7 one caveat line and Visa TAP as a footer link, #8 the let-through framed as a test).
// One source of truth: src/config/brand.ts (DIFFERENTIATORS, KIT11_RUN_LINE, CAVEAT_LINE, CHAIN_TEST). Breaks when a
// surface drops a sentence, changes a word, puts something before it, or when the record no longer holds the 24.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAVEAT_LINE, CHAIN_TEST, DIFFERENTIATORS, KIT11_RUN_LINE, TRY_IT, VISA_EXTRA_LINK } from "../src/config/brand.js";
import { homePage } from "../src/redesign/home.js";
import { proofPage } from "../src/redesign/proof.js";
import { agentRun, loadRecord, split, stopStory, stopsLine } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { record } = loadRecord();
/** Drops every <tag …>…</tag> block (any case), by position, not by a regular expression over HTML. */
const dropBlocks = (s: string, tag: string) => {
  let out = "", i = 0;
  const low = s.toLowerCase();
  for (;;) {
    const a = low.indexOf(`<${tag}`, i);
    if (a < 0) return out + s.slice(i);
    const b = low.indexOf(`</${tag}`, a);
    const end = b < 0 ? s.length : low.indexOf(">", b) + 1 || s.length;
    out += s.slice(i, a) + " ";
    i = end;
  }
};
/** Text as read: tags, Markdown emphasis, code marks and link targets gone, entities decoded, white space single. */
const words = (s: string) => dropBlocks(dropBlocks(s, "style"), "script").replace(/<[^>]+>/g, " ")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[*`]/g, "").replace(/^\s*- /gm, "").replace(/\s+/g, " ").trim();
const shots = new Proxy({}, { get: () => "" }) as DeckShots;
const PAGES = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const form = read("docs/submission/README.md");
const between = (t: string, a: string, b: string) => t.split(a)[1]!.split(b)[0]!.trim();

describe("the three sentences (jury review, 6 Nov, #1)", () => {
  it("are Max's words, with the main run's 24 decisions, all by Claude", () => {
    expect(DIFFERENTIATORS).toEqual([
      "An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in 30 seconds.",
      "One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control.",
      "Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude.",
    ]);
    const sp = split(record);
    expect([sp.byClaude, sp.decisions, sp.fallbacks]).toEqual([24, 24, 0]);
    expect(DIFFERENTIATORS[2]).toContain(`Claude made all ${sp.decisions} decisions`);
    expect(DIFFERENTIATORS[0].endsWith(TRY_IT)).toBe(true);
    // "No key reaches Claude", as documented and tested (test/adversarial.test.ts); never "holds no keys".
    expect(DIFFERENTIATORS.join(" ")).not.toMatch(/holds? no keys?/i);
    expect(read("test/adversarial.test.ts")).toContain("no key, token or credential ever reaches a model");
  });

  it("then the Kit 11 line, on the main run's date", () => {
    expect(KIT11_RUN_LINE).toBe("The Kit 11 scenario, run live on 3 November.");
    expect(JSON.stringify(record.snapshot)).toContain("2026-11-03T11:");
  });

  it("open the README: nothing but the title before them, the Kit 11 line next, the badges after", () => {
    const readme = read("README.md");
    const lines = readme.split("\n");
    // The one tagline in the title (jury QA, 6 Nov, Q8).
    expect(lines[0]).toBe("# Purser · AI agents spend. You sign off.");
    const top = words(lines.slice(1, 8).join("\n"));
    expect(top.startsWith(DIFFERENTIATORS.join(" "))).toBe(true);
    expect(top).toContain(KIT11_RUN_LINE.replace(/\.$/, ""));
    expect(lines.slice(0, 6).join("\n")).toContain("(https://kit11.max-31b.workers.dev/try/sign)");
    expect(readme.indexOf("[![CI]")).toBeGreaterThan(readme.indexOf(DIFFERENTIATORS[2]));
  });

  it("open Home under the heading, with Try it in 30 seconds linked to /try/sign, then the Kit 11 line and one caveat line", () => {
    const html = PAGES.home!;
    const hero = /<section class="hero">[\s\S]*?<\/section>/.exec(html)![0];
    const t = words(hero);
    expect(t.indexOf("AI agents spend. You sign off.")).toBeLessThan(t.indexOf(DIFFERENTIATORS[0]));
    expect(t).toContain(`AI agents spend. You sign off. ${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE} Watch the film (2:42) ↗ ${CAVEAT_LINE} Details →`);
    expect(hero).toContain(`<a href="try/sign">${TRY_IT}</a>`);
    // The caveat's link opens the footer's "What's real?", which lists what the line names.
    expect(hero).toContain('<a href="#real" data-real>Details →</a>');
    expect(html).toContain('<details class="real" id="real">');
    const real = words(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0]);
    for (const x of ["customer", "supplier", "settlement", "second approver", "Test money"]) expect({ x, has: real.includes(x) }).toEqual({ x, has: true });
    // Without /try/sign in the bundle the sentence stays text, never a dead link.
    expect(homePage()).not.toContain('href="try/sign"');
    expect(words(homePage())).toContain(DIFFERENTIATORS[0]);
  });

  it("open the form's synopsis and Description, word for word", () => {
    expect(between(form, "<!-- synopsis -->", "<!-- /synopsis -->")).toBe(`${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE}`);
    const desc = words(between(form, "<!-- description -->", "<!-- /description -->"));
    expect(desc.startsWith(DIFFERENTIATORS[0])).toBe(true);
    let at = 0;
    for (const s of [...DIFFERENTIATORS, KIT11_RUN_LINE, CAVEAT_LINE]) { const i = desc.indexOf(s, at); expect({ s, found: i >= at }).toEqual({ s, found: true }); at = i; }
  });

  it("open the deck's title slide, then the Kit 11 line", () => {
    const deck = deckHtml(packFacts(), shots, "<svg></svg>");
    const first = words(/<section[\s\S]*?<\/section>/.exec(deck)![0]);
    expect(first).toContain(`AI agents spend. You sign off. ${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE}`);
  });

  it("open the long text too", () => {
    expect(words(read("docs/submission/long-description.md"))).toContain(`${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE}`);
  });
});

describe("the 12 overpriced checks: a buy rule Claude set, applied by code (jury review, 6 Nov, #6)", () => {
  it("says who did what, as the record does", () => {
    const st = stopStory(record);
    expect(stopsLine(st)).toBe("16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.");
    const rows = record.snapshot.refusals.filter((x) => x.agent === "sourcing" && /own buy policy/.test(x.reason));
    expect(rows).toHaveLength(st.claude);
    // Each row: the policy refused it, in code (src/agents/sourcing.ts refuses every purchase while the policy the
    // Sourcing agent set says supplier "none"); the record labels the purchases under that policy the same way.
    for (const x of rows) expect(x.reason).toMatch(/^Stock check #\d+ not bought: the Sourcing agent's own buy policy \(the Sourcing agent chose not to buy/);
    expect(read("src/agents/sourcing.ts")).toMatch(/if \(policy\.supplier === "none"\) return policyRefusal\(/);
    expect(JSON.stringify(record.snapshot)).toContain("code: the Sourcing agent's buy policy, as the Sourcing agent (Claude Haiku) set it");
  });

  it("never says Claude skipped them, outside the film (v3, unchanged; its claims row notes the older wording)", () => {
    const OLD = /Claude skipped|skipped by Claude|By Claude \(the Sourcing agent\)|chose not to buy (?:under|over|at)/i;
    const surfaces: [string, string][] = [
      ["home", PAGES.home!], ["proof", PAGES.proof!], ["watch", PAGES.watch!], ["metal", String(PAGES.metal)], ["claude", PAGES.claude!],
      ["deck", deckHtml(packFacts(), shots, "")],
      ...["README.md", "docs/submission/README.md", "docs/submission/long-description.md", "docs/submission/pitch.md", "docs/submission/qa.md",
        "docs/submission/demo-day.md", "docs/internal/spiekkaart-demo.html"].map((p): [string, string] => [p, read(p)]),
    ];
    for (const [name, body] of surfaces) expect({ name, old: OLD.exec(words(body))?.[0] ?? null }).toEqual({ name, old: null });
    // The claims keep the film's line once each, labelled as older than this wording.
    const claims = read("docs/claims.md");
    expect(claims).toContain("“Twelve skipped by Claude” predates the wording above");
    expect(claims).toContain("12 Claude skipped an overpriced check (the film's wording, which predates the jury review of 6 November");
  });
});

describe("the let-through, framed as the test it was (jury review, 6 Nov, #8)", () => {
  it("shows both layers where the refusal is told: Purser refuses first; with that check off once, Metal refused anyway", () => {
    expect(CHAIN_TEST).toBe("We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for one purchase, Metal refused it anyway.");
    expect(agentRun().scenes[0]!.sentence).toContain("we switched off our own check once to prove the chain holds the line");
    for (const [name, body] of [["proof", proofPage()], ["metal", String(PAGES.metal)], ["README.md", read("README.md")], ["form", form], ["long", read("docs/submission/long-description.md")], ["qa", read("docs/submission/qa.md")]] as const) {
      const t = words(body);
      const has = name === "README.md" ? t.includes("We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for purchase #24, Metal refused it anyway")
        : name === "qa" ? t.includes("we switched off our own check once to prove the chain holds the line") : t.includes(CHAIN_TEST);
      expect({ name, has }).toEqual({ name, has: true });
    }
  });
});

describe("Visa TAP as a footer link on Home and Proof (jury review, 6 Nov, #7)", () => {
  it("is not in Home's main part or Proof's cards, and both link to /visa from the footer", () => {
    for (const [name, html] of [["home", PAGES.home!], ["proof", PAGES.proof!]] as const) {
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      // "Visa" alone is the card brand Airwallex issues (a virtual Visa card); TAP is what moved to the footer.
      expect({ name, tap: /Visa TAP|Trusted Agent|\bTAP\b(?! run)/.test(words(main)) }).toEqual({ name, tap: false });
      expect({ name, link: html.includes(`<a class="flink" href="visa">${VISA_EXTRA_LINK}</a>`) }).toEqual({ name, link: true });
    }
  });

  it("the form's screenshot 6 is /try/sign signed and tampered, not /visa", () => {
    const list = between(form, "## Screenshots", "## Deck and zip");
    expect(list).toMatch(/^6\. `screens\/18-try-sign\.png`: Sign one yourself \(\/try\/sign\)/m);
    expect(list).not.toContain("17-visa");
    expect(read("src/cli/submission.ts")).toContain('"18-try-sign.png"');
  });
});

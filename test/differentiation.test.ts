// What only Purser has, first on every surface (jury review, 6 Nov, #1), and the honesty fixes that came with it
// (#6 the buy rule Claude set, #7 one caveat line and Visa TAP as a footer link, #8 the let-through framed as a test).
// One source of truth: src/config/brand.ts (DIFFERENTIATORS, KIT11_RUN_LINE, CAVEAT_LINE, CHAIN_TEST). Breaks when a
// surface drops a sentence, changes a word, puts something before it, or when the record no longer holds the 24.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAVEAT_LINE, CHAIN_TEST, DIFFERENTIATORS, KIT11_RUN_LINE, KIT_LINE, TRY_IT, VISA_EXTRA_LINK, WHAT_IT_IS } from "../src/config/brand.js";
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
      "An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.",
      "One CFO policy, a lock per rail: Airwallex card controls, Metal's mandate, the CFO's signature on invoices. A prompt is not a control.",
      "Real agents: Claude made all 24 decisions (routine payments are code); no key reaches Claude.",
    ]);
    const sp = split(record);
    expect([sp.byClaude, sp.decisions, sp.fallbacks]).toEqual([24, 24, 0]);
    expect(DIFFERENTIATORS[2]).toContain(`Claude made all ${sp.decisions} decisions`);
    // Since section D (6 Nov) "Try it in 30 seconds." is its own line after the three (test/first-screen.test.ts).
    expect(DIFFERENTIATORS.join(" ")).not.toContain(TRY_IT);
    // "No key reaches Claude", as documented and tested (test/adversarial.test.ts); never "holds no keys".
    expect(DIFFERENTIATORS.join(" ")).not.toMatch(/holds? no keys?/i);
    expect(read("test/adversarial.test.ts")).toContain("no key, token or credential ever reaches a model");
  });

  it("then the Kit 11 line, on the main run's date", () => {
    expect(KIT11_RUN_LINE).toBe("The Kit 11 scenario, run live on 3 November.");
    expect(JSON.stringify(record.snapshot)).toContain("2026-11-03T11:");
  });

  it("open the README after what Purser is, then Try it, the badges and the Kit 11 line", () => {
    const readme = read("README.md");
    const lines = readme.split("\n");
    // The one tagline in the title (jury QA, 6 Nov, Q8).
    expect(lines[0]).toBe("# Purser · AI agents spend. You sign off.");
    const top = words(lines.slice(1, 16).join("\n"));
    expect(top.startsWith(`${WHAT_IT_IS} ${DIFFERENTIATORS.join(" ")} ${TRY_IT}`)).toBe(true);
    expect(top).toContain(KIT11_RUN_LINE.replace(/\.$/, ""));
    expect(lines.slice(0, 10).join("\n")).toContain("(https://kit11.max-31b.workers.dev/try/sign)");
    expect(readme.indexOf("[![CI]")).toBeGreaterThan(readme.indexOf(DIFFERENTIATORS[2]));
    expect(readme.indexOf(KIT11_RUN_LINE.replace(/\.$/, ""))).toBeGreaterThan(readme.indexOf("[![CI]"));
  });

  it("open Home under its heading: what Purser is, the one button, the Airwallex proof (competitive review, 10 Nov)", () => {
    const html = PAGES.home!;
    const hero = /<section class="hero">[\s\S]*?<\/section>/.exec(html)![0];
    const t = words(hero);
    // The one button, to /try/sign, right under what Purser is; the three sentences stay in the README and the form.
    expect(t.startsWith(`AI agents spend. You sign off. ${WHAT_IT_IS} Try it: sign with your Face ID`)).toBe(true);
    expect(t).toContain("Watch the agents");
    expect(t).toContain(`${CAVEAT_LINE} Details →`);
    // The caveat's link opens the footer's "What's real?", which lists what the line names.
    expect(hero).toContain('<a href="#real" data-real>Details →</a>');
    expect(html).toContain('<details class="real" id="real">');
    const real = words(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0]);
    for (const x of ["customer", "supplier", "settlement", "second approver", "Test money"]) expect({ x, has: real.includes(x) }).toEqual({ x, has: true });
    // The Kit 11 line and the awards: under the first screen, never in the hero (Max, 10 Nov).
    expect(hero).not.toContain(KIT_LINE.split(" · entered")[0]!);
    expect(html).toContain(KIT_LINE.split(" · entered")[0]!);
    // Without /try/sign in the bundle the button leads to /try, never to a dead link.
    expect(homePage()).not.toContain('href="try/sign"');
  });

  it("open the form's synopsis (after what Purser is) and Description, word for word", () => {
    expect(between(form, "<!-- synopsis -->", "<!-- /synopsis -->")).toBe(`${WHAT_IT_IS} ${DIFFERENTIATORS.join(" ")} ${TRY_IT}`);
    const desc = words(between(form, "<!-- description -->", "<!-- /description -->"));
    // Section D (6 Nov): the Description opens with the problem, then the solution and the three sentences.
    expect(desc.startsWith("The problem. AI agents are starting to spend company money.")).toBe(true);
    let at = 0;
    for (const s of [...DIFFERENTIATORS, KIT11_RUN_LINE, CAVEAT_LINE]) { const i = desc.indexOf(s, at); expect({ s, found: i >= at }).toEqual({ s, found: true }); at = i; }
  });

  it("open the deck: the title slide says what Purser is and the Kit 11 line; after the problem, the three sentences and Try it (section D)", () => {
    const deck = deckHtml(packFacts(), shots, "<svg></svg>");
    const slides = deck.split("<section").slice(1).map(words);
    expect(slides[0]).toContain(`AI agents spend. You sign off. ${WHAT_IT_IS} ${KIT11_RUN_LINE}`);
    expect(slides[2]).toContain(`${DIFFERENTIATORS.join(" ")} ${TRY_IT} kit11.max-31b.workers.dev/try/sign`);
  });

  it("open the long text too", () => {
    expect(words(read("docs/submission/long-description.md"))).toContain(`${DIFFERENTIATORS.join(" ")} ${KIT11_RUN_LINE}`);
  });
});

describe("the 12 overpriced checks: a buy rule Claude set, applied by code (jury review, 6 Nov, #6)", () => {
  it("says who did what, as the record does", () => {
    const st = stopStory(record);
    expect(stopsLine(st)).toBe("16 stops, nothing paid over a limit: one buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.");
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

describe("Visa TAP as a footer link on Home (jury review, 6 Nov, #7); not on Proof since 12 Nov", () => {
  it("is not in Home's main part or Proof's cards; Home links to /visa from the footer, Proof no longer does", () => {
    for (const [name, html, link] of [["home", PAGES.home!, true], ["proof", PAGES.proof!, false]] as const) {
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      // "Visa" alone is the card brand Airwallex issues (a virtual Visa card); TAP is what moved to the footer.
      expect({ name, tap: /Visa TAP|Trusted Agent|\bTAP\b(?! run)/.test(words(main)) }).toEqual({ name, tap: false });
      // The footer link left Proof on 12 Nov (jury: Proof starts with the guarantees and ends with its utility links).
      expect({ name, link: html.includes(`<a class="flink" href="visa">${VISA_EXTRA_LINK}</a>`) }).toEqual({ name, link });
    }
    expect(PAGES.proof!).not.toContain(VISA_EXTRA_LINK);
  });

  it("the form's screenshots are the live site's, /try/sign signed and tampered among them, not /visa", () => {
    const list = between(form, "## Screenshots", "## Deck and zip");
    // Since D6 (6 Nov) the form's 8 screenshots come from the live site, in the form's order: the problem, try it (three,
    // from one /try/sign world), the proof per partner, the business. Each file the list names is in the repository.
    const named = [...list.matchAll(/^(\d)\. `(screens\/form\/[^`]+\.png)`/gm)].map((m) => [Number(m[1]), m[2]!] as const);
    expect(named.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(named.map(([, f]) => f)).toEqual(["home", "try-sign-sheet", "try-sign-verified", "try-sign-tamper", "airwallex", "metal", "claude", "business"].map((x, i) => `screens/form/form-${i + 1}-${x}.png`));
    for (const [, f] of named) expect({ f, there: existsSync(new URL(`../docs/submission/${f}`, import.meta.url)) }).toEqual({ f, there: true });
    expect(list).not.toContain("17-visa");
    expect(read("src/cli/submission.ts")).toContain('"18-try-sign.png"');
  });
});

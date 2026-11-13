// Section D (6 Nov): the first screen is the same in two places, the README and the form's synopsis: what Purser is in
// one sentence, the three sentences, "Try it in a minute." to /try/sign, and only then the badges and the details. Home
// (home-story, 12 Nov) opens with what Purser is, one button with one reassurance line, and the first of the three
// sentences, word for word, leading into its hero. And "Why this is a company", five lines from docs/business/, on the README and on Home. One source of
// truth: src/config/brand.ts (FIRST_SCREEN, WHY_COMPANY). Breaks when a place drops, adds or reorders a word.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_CASE_LINK, BUSINESS_DOCS, DIFFERENTIATORS, FILM_URL, FIRST_SCREEN, FIRST_SCREEN_TEXT, HERO, TOUR_LINE, TRY_IT, TRY_SIGN_URL, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { HOME_SUB, PROOF_BUTTON, REASSURE, START, homePage } from "../src/redesign/home.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Text as read: tags, Markdown emphasis and link targets gone, entities decoded, white space single. */
const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/[*`]/g, "").replace(/^\s*- /gm, "").replace(/\s+/g, " ").trim();
const README = read("README.md");
const HOME = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!;
const PROOF = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).proof!;
const FORM = read("docs/submission/README.md");
const hero = (html: string) => /<section class="e-hero">[\s\S]*?<\/section>/.exec(html)![0];
/** Every Markdown heading's GitHub anchor in a file. */
const anchors = (md: string) => [...md.matchAll(/^#+ (.+)$/gm)].map((m) => m[1]!.toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-"));
/** Names of other spend and payment companies that must never appear in these lines (the partners are not competitors). */
const OTHERS = /\b(Pleo|Ramp|Brex|Spendesk|Payhawk|Expensify|Mercury|Revolut|Wise|Stripe|Mastercard|Coinbase|Google|Visa)\b/;

describe("the first screen (section D, 6 Nov)", () => {
  it("is what Purser is, the three sentences, then Try it in a minute", () => {
    expect(FIRST_SCREEN).toEqual([WHAT_IT_IS, ...DIFFERENTIATORS, TRY_IT]);
    expect(WHAT_IT_IS).toBe("For CFOs whose AI agents pay suppliers: above its limit, an agent asks; you sign the exact terms with a passkey (Face ID on iPhone).");
    expect(TRY_IT).toBe("Try it in 2 minutes."); // one duration wording since 13 Nov: "Try it in 2 minutes" and the "3-minute product tour"
    expect(TRY_SIGN_URL).toBe("https://kit11.max-31b.workers.dev/try/sign");
    // No absolute claim in what Purser is (the stale lines of the jury review).
    expect(WHAT_IT_IS).not.toMatch(/cannot break|can't break|every limit|holds? no keys?/i);
  });

  it("opens the README under its title with the pitch once: what Purser is, the sentence every juror repeated, one line of links with Try it, then the badges (jury panel, 12 Nov)", () => {
    const lines = README.split("\n");
    // The owner's centred top (13 Nov): the Purser mark, the title, the pitch in bold, the sentence every juror
    // repeated, one line of links with Try it first, the badges, then the reviewers' block.
    // Since 13 Nov (owner): the mark is the site header's own, black and white (docs/assets/brand/purser-mark.svg, test/brand-mark.test.ts).
    expect(lines.slice(0, 4)).toEqual(['<div align="center">', "", '<img src="docs/assets/brand/purser-mark.svg" alt="Purser" width="72" height="72">', ""]);
    expect(lines[4]).toBe(`# Purser · ${HERO}`);
    const badges = lines.findIndex((l) => l.startsWith("[![CI]"));
    // Since 13 Nov (the README upgrade): three buttons (the tour, Try it, the film), four badges (CI, CodeQL, licence,
    // Node), the rails and "test money only" as plain text, the four screenshots with /try/sign first, then the
    // one-line diagram under "How it works" and the judges' 3 minutes.
    const buttons = '<a href="https://kit11.max-31b.workers.dev/tour"><img src="https://img.shields.io/badge/Take_the_tour-3_min-0b1220?style=for-the-badge" alt="Take the 3-minute product tour"></a> <a href="https://kit11.max-31b.workers.dev/try"><img src="https://img.shields.io/badge/Try_it-2_min-0b1220?style=for-the-badge" alt="Try it in 2 minutes"></a> <a href="https://youtu.be/kCUsFHrxE-o"><img src="https://img.shields.io/badge/Watch_the_film-3%3A58-0b1220?style=for-the-badge" alt="Watch the film, 3:58"></a>';
    expect(lines.slice(5, badges)).toEqual(["", `**${WHAT_IT_IS}**`, "", DIFFERENTIATORS[0], "", buttons, ""]);
    expect(lines[badges]!.match(/\[!\[/g)).toHaveLength(4);
    expect(lines.slice(badges + 1, badges + 4)).toEqual(["", "Metal testnet · Airwallex sandbox · Visa via Airwallex Airi (sandbox) · Claude: test money only.", ""]);
    expect(lines[badges + 4]).toMatch(/^<table><tr><td width="25%"><a href="https:\/\/kit11\.max-31b\.workers\.dev\/try\/sign">/);
    expect(lines.slice(badges + 5, badges + 10)).toEqual(["", "</div>", "", "## How it works", ""]);
    expect(lines.indexOf("## For judges: 3 minutes")).toBeGreaterThan(badges);
    expect(TRY_IT).toBe("Try it in 2 minutes.");
    expect(FILM_URL).toBe("https://youtu.be/kCUsFHrxE-o");
    expect(lines.findIndex((l) => l === "## The business hypothesis")).toBeLessThan(90);
  });

  it("opens Home under its heading with what Purser is, one button to /try/sign with one reassurance line, then the sentence every juror repeated (home-story, 12 Nov)", () => {
    const t = words(hero(HOME));
    expect([START, PROOF_BUTTON]).toEqual(["Try it live", "See the proof"]);
    // The enterprise pass (owner, 12 Nov): the headline, one sentence, two buttons (try it, see the proof), one reassurance line.
    expect(t.startsWith(`${HERO} ${HOME_SUB} ${START} ${PROOF_BUTTON} ${REASSURE.sign}`)).toBe(true);
    expect(hero(HOME).match(/class="btn[^"]*"/g)).toEqual(['class="btn primary big start"', 'class="btn big ghost"']);
    // Since 12 Nov (the owner) every Try call to action opens the hands-on demo (TRY_URL); /try/sign keeps its own page.
    expect(hero(HOME)).toContain(`<a class="btn primary big start" href="/try">`);
    expect(HOME).not.toContain("Watch the agents");
    // The three sentences stay in the README, the form and the deck; Home tells the first with its product card.
    for (const d of DIFFERENTIATORS.slice(1)) expect(words(HOME)).not.toContain(d);
    // Without /try/sign in the bundle the button leads to /try, never to a dead link, and the line under it says what /try is.
    expect(homePage()).not.toContain('href="try/sign"');
    expect(hero(homePage())).toContain('<a class="btn primary big start" href="/try">');
    expect(words(hero(homePage()))).toContain(`${START} ${PROOF_BUTTON} ${REASSURE.world}`);
    // The product tour (13 Nov): one footer link in either bundle; never a call to action in the page, never a tab.
    expect(HOME).toContain(`<a class="flink" href="tour">${TOUR_LINE}</a>`);
    expect(hero(HOME)).not.toContain('href="tour"');
    expect(homePage().match(/href="tour"/g)).toEqual(['href="tour"']);
    expect(homePage()).not.toMatch(/href="\/?judge"/);
    expect(homePage()).not.toContain('>Judge</a>');
  });

  it("is the form's synopsis, word for word, within 500 characters", () => {
    const synopsis = FORM.split("<!-- synopsis -->")[1]!.split("<!-- /synopsis -->")[0]!.trim();
    expect(synopsis).toBe(FIRST_SCREEN_TEXT);
    expect(synopsis.length).toBeLessThanOrEqual(500);
  });
});

describe("why this is a company (section D, 6 Nov)", () => {
  const section = README.slice(README.indexOf("## The business hypothesis"), README.indexOf("\n## ", README.indexOf("## The business hypothesis") + 5));
  // On /proof since Max's round of 7 Nov (Home shows the way through), behind its own closed line.
  const band = /<section class="band" aria-labelledby="h-company">[\s\S]*?<\/section>/.exec(PROOF)?.[0] ?? "";

  it("has five lines: the problem, who buys, the pilot pricing, why now, why Purser", () => {
    // The price is the pilot pricing since 12 Nov (one model, src/config/pricing.ts), labelled as that and as a hypothesis.
    expect(WHY_COMPANY.map((l) => l.label)).toEqual(["The problem", "Who buys", "Pilot pricing", "Why now", "Why Purser"]);
    expect(WHY_COMPANY[2]!.text).toBe("Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout. A hypothesis.");
  });

  it("is on the README and on /proof, word for word; the README links each line to its page, /proof once to the case (Max, 7 Nov)", () => {
    expect(section).not.toBe("");
    expect(band).not.toBe("");
    for (const l of WHY_COMPANY) {
      const [file, anchor] = l.page.split("#") as [string, string];
      expect(section).toContain(`- **${l.label}:** ${l.text} ([${file}](docs/business/${l.page}))`);
      expect(words(band)).toContain(`${l.label}: ${l.text}`);
      expect({ page: l.page, found: anchors(read(`docs/business/${file}`)).includes(anchor) }).toEqual({ page: l.page, found: true });
    }
    // On /proof: the content first, one link "Read the business case ↗", the disclaimer as one small line at the bottom.
    expect(band.match(/<a /g)).toHaveLength(1);
    expect(band).toContain(`<p class="clink"><a href="${BUSINESS_DOCS}" target="_blank" rel="noopener">${BUSINESS_CASE_LINK}</a></p>`);
    expect(BUSINESS_CASE_LINK).toBe("Read the business case ↗");
    expect(band.indexOf('class="company"')).toBeLessThan(band.indexOf('class="cnote"'));
    expect(band.indexOf('class="clink"')).toBeLessThan(band.indexOf('class="cnote"'));
  });

  it("says each line as docs/business/ does: the price from model.md, the cited source from problem.md", () => {
    const model = read("docs/business/model.md").replace(/\s+/g, " "), problem = read("docs/business/problem.md").replace(/\s+/g, " ");
    expect(model).toContain("**Pilot pricing: Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout.**");
    // Why now: Airwallex's own post, quoted as problem.md quotes it, with its title, date and source number.
    expect(problem).toContain("through underlying infrastructure rather than prompts");
    expect(problem).toContain('[S1] Airwallex, Dan Kim, "Agentic banking starts with governance", published 5 October 2026');
    expect(WHY_COMPANY[3]!.text).toContain('"through underlying infrastructure rather than prompts" ("Agentic banking starts with governance", source S1)');
    expect(problem).toContain("a place the agent can talk its way past (a prompt) or in a place nobody looks until after the money has gone");
    expect(model).toContain("one CFO policy for card and chain, approvals signed over the exact terms, a hash-chained audit log");
  });

  it("says \"not validated\" once on each surface, and names no other company", () => {
    expect(WHY_COMPANY_NOTE.startsWith("Not validated with customers yet")).toBe(true);
    for (const [name, t] of [["README", words(section)], ["proof", words(band)]] as const) {
      expect({ name, n: t.match(/not validated/gi)?.length ?? 0 }).toEqual({ name, n: 1 });
      expect({ name, other: OTHERS.exec(t)?.[0] ?? null }).toEqual({ name, other: null });
    }
  });
});

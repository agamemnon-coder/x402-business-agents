// Section D (6 Nov): the first screen is the same in two places, the README and the form's synopsis: what Purser is in
// one sentence, the three sentences, "Try it in a minute." to /try/sign, and only then the badges and the details. Home
// (home-story, 12 Nov) opens with what Purser is, one button with one reassurance line, and the first of the three
// sentences, word for word, leading into its hero. And "Why this is a company", five lines from docs/business/, on the README and on Home. One source of
// truth: src/config/brand.ts (FIRST_SCREEN, WHY_COMPANY). Breaks when a place drops, adds or reorders a word.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_CASE_LINK, BUSINESS_DOCS, DIFFERENTIATORS, README_WHAT, FILM_URL, FIRST_SCREEN, FIRST_SCREEN_TEXT, HERO, TRY_IT, TRY_SIGN_URL, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { FILM_BUTTON, HOME_SUB, REASSURE, START, VERIFY_BUTTON, homePage } from "../src/redesign/home.js";
import { buildPages } from "../src/relay/assets.js";
import { readmeFull } from "./readmeFull.js";

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

// The README's banner (13 Nov, evening, owner): drawn from scripts/readme-banner.html, dark and light; Home's own
// picture (hero-*.webp) moved to the gallery.
const BANNER = `<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-dark.png"><img src="docs/assets/readme/banner-light.png" alt="Purser: AI agents spend. You sign off. Passkey on the exact terms · Limits enforced in 3 layers · Books matched to the cent" width="100%"></picture></a>`;

const README_BUILT_ON = "**Built on Airwallex.** Purser calls Airwallex's API for a card per agent with the CFO's limits (Issuing), FX quotes inside the signed terms, transfers that carry the hash the CFO signed, the payee's bank check, Airwallex's own approval as a second lock, and signed webhooks (the sandbox, test money: [docs/airwallex.md](docs/airwallex.md)).";

/** The README's three links under the idea (15 Nov): Try, the film, and the offline check in the README itself. 18 Nov: the demo in the submission (3:15) replaces the film there; the film stays under "Watch it". 19 Nov 2026 (README tightened for the judges): the judges' path, numbered, the demo first, then its thumbnail. */
const README_LINKS = "**1. [Watch the demo (3:15)](https://youtu.be/gEUm8RlhZac) · 2. [Try it (2 min, test money)](https://kit11.max-31b.workers.dev/try) · 3. [Verify a payment (3 commands)](#verify-it-yourself-in-3-commands)**";
const README_THUMB = '<a href="https://youtu.be/gEUm8RlhZac"><img src="docs/assets/readme/demo-thumb.jpg" alt="Purser: the demo on YouTube (3:15)" width="100%"></a>';
/** 19 Nov 2026: what Purser is and why the repository has its name, in one sentence, before any proof (the words of "For judges: 3 minutes" and "One engine, two jobs"). */
const README_IS = '**What it is:** the control layer between a company\'s AI agents and its money on Airwallex and Alta (formerly Metal): one engine runs agents that pay supplier invoices and agents that buy and sell data over x402, hence the repository\'s name, x402-business-agents, after Starter Kit 11 ("x402 Business Agents"), the hackathon brief it was built for.';

describe("the first screen (section D, 6 Nov)", () => {
  it("is what Purser is, the three sentences, then Try it in a minute", () => {
    expect(FIRST_SCREEN).toEqual([WHAT_IT_IS, ...DIFFERENTIATORS, TRY_IT]);
    expect(WHAT_IT_IS).toBe("For CFOs whose AI agents pay suppliers: above its limit, an agent asks; you sign the exact terms with a passkey (Face ID on iPhone).");
    expect(TRY_IT).toBe("Try it in 2 minutes."); // one duration wording since 13 Nov: "Try it in 2 minutes"
    expect(TRY_SIGN_URL).toBe("https://kit11.max-31b.workers.dev/try/sign");
    // No absolute claim in what Purser is (the stale lines of the jury review).
    expect(WHAT_IT_IS).not.toMatch(/cannot break|can't break|every limit|holds? no keys?/i);
  });

  it("opens the README under its title with the pitch once: what Purser is, the sentence every juror repeated, one line of links with Try it, then the badges (jury panel, 12 Nov)", () => {
    const lines = README.split("\n");
    // The owner's centred top (13 Nov): the Purser mark, the title, the pitch in bold, the sentence every juror
    // repeated, one line of links with Try it first, the badges, then the reviewers' block.
    // Since 13 Nov (owner): the mark is the site header's own, black and white (docs/assets/brand/purser-mark.svg, test/brand-mark.test.ts).
    // Since 13 Nov (the enterprise README): the site's link-preview card as the hero (the same file as src/ui/brand/og.png).
    // 13 Nov, evening (owner, the README upgrade): the banner, then the title; under the badges and the live demo's line,
    // Watch it, the 3 steps, the three proofs and the rails' line, Built with, the gallery, the quick start, Enterprise.
    // 15 Nov (Max): the animated flow right under the banner, on the banner's line (test/readme-flow.test.ts).
    expect(lines.slice(0, 4)).toEqual(['<div align="center">', "", lines[2]!, ""]);
    expect(lines[2]!.startsWith(`${BANNER}<br><picture>`)).toBe(true);
    for (const f of ["docs/assets/readme/banner-dark.png", "docs/assets/readme/banner-light.png", "docs/assets/readme/hero-dark.webp", "docs/assets/readme/hero-light.webp"]) expect(existsSync(new URL(`../${f}`, import.meta.url))).toBe(true);
    expect(lines[4]).toBe(`# Purser · ${HERO}`);
    const badges = lines.findIndex((l) => l.startsWith("**Build & quality**<br>[![CI]")); // 19 Nov 2026: three rows, each after its bold label
    // 15 Nov (clarity, Founder's and Judges' Choice: one idea in 10 seconds): the first screen is the idea in bold (Home's
    // sentence, word for word), "Built on Airwallex" (14 Nov, factual, no partnership implied), the three links (Try,
    // the film, verify it yourself), then the Kit 11 table, within the first 25 lines. Everything else follows it.
    const kit = lines.indexOf("## Kit 11, step by step");
    // 15 Nov (Max: "the tags on top of the readme"): the two badge rows sit under the links, inside the centred top.
    // 17 Nov (owner: "one calm, branded set"): the partners' row is the proof strip, one picture linked to /proof.
    const partners = lines.findIndex((l) => l.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture>') && l.includes("proof-strip-light.svg"));
    // 15 Nov (Max): "At a glance" under the badges, six lines, each with its record (test/readme-glance.test.ts), then Kit 11.
    const glance = lines.indexOf("## At a glance");
    // 15 Nov (readme-wow): two GitHub alerts between the centred top and "At a glance": Try it (/try), then test money only.
    // 17 Nov (coordinator, the four things every entry must show, docs/rules.md): a six-line "For judges" table under the
    // links, each row with where to check it, before the badges.
    // 17 Nov (owner): under it, one line on what stood at the submission tag and what came after.
    // 17 Nov, owner: the badges at the very top: the three badge rows right under the title, then the idea, Built on
    // Airwallex, the links and the For judges table; the proof strip stays at the foot of the centred top.
    expect(badges).toBe(6);
    // 17 Nov, owner: strongest proof first. Under the links, a six-row table, each row one line with where to check it
    // (one click each); "Built on Airwallex" moved, word for word, to the top of "Airwallex at the centre" (below).
    // 19 Nov 2026: +4 lines above it: the demo's thumbnail and what Purser is, each with its blank line.
    // 19 Nov 2026 (the owner: the README felt like a wall of text): +4 more, the animated evidence map under the
    // thumbnail (linked to /proof#evidence) and the wall's line of figures (both written by npm run evidence:wall).
    expect(lines[16]!.startsWith('<a href="https://kit11.max-31b.workers.dev/proof#evidence"><picture>')).toBe(true);
    expect(lines[18]!.startsWith("**Evidence wall, from the records:** ")).toBe(true);
    const proof = lines.slice(22, 30);
    expect(proof[0]).toBe("| **The strongest proof, one click each** (test money) | Check it |");
    expect(proof[1]).toBe("|---|---|");
    expect(proof.slice(2).map((l) => /^\| \*\*(\d) · /.exec(l)?.[1])).toEqual(["1", "2", "3", "4", "5", "6"]);
    const proofLinks = proof.slice(2).map((l) => [...l.split(" | ").at(-1)!.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!));
    expect(proofLinks).toEqual([
      ["https://kit11.max-31b.workers.dev/try"],
      ["https://kit11.max-31b.workers.dev/alta", "docs/runs/2026-11-03-main-run.md"],
      ["docs/runs/airwallex-transfer-approval-2026-11-06.json"],
      ["docs/runs/2026-11-17-airwallex-late-failure.json"],
      ["docs/worst-case-ai.md"],
      ["docs/finance-value.md"],
    ]);
    for (const f of proofLinks.flat().filter((u) => u.startsWith("docs/"))) expect(existsSync(new URL(`../${f}`, import.meta.url))).toBe(true);
    // x402 and Airwallex both named in the proof rows, test money in its header.
    expect(proof.join("\n")).toMatch(/x402/);
    expect(proof.join("\n")).toMatch(/Airwallex/);
    const centre = lines.indexOf("## Airwallex at the centre");
    expect(lines.slice(centre + 1, centre + 3)).toEqual(["", README_BUILT_ON]);
    // 19 Nov 2026 (README tightened for the judges): the "For judges: 3 minutes" section went, its one new line (one id
    // per rail, every run) is the table's fifth row, its awards are in the submission line.
    const judges = lines.slice(31, partners - 1); // 31 since 19 Nov 2026: the evidence map and its line above (+4)
    expect(judges).toHaveLength(9);
    expect(judges[8]!.startsWith("**What stood at the submission:** the tag `v1.0-submission` (8 Nov)")).toBe(true);
    expect(judges[8]).toContain("(entered for the Founder's Choice Award, the Judges' Choice Award, the Metal Award and the Visa Award)");
    expect(judges[0]!.startsWith("| **For judges:** the four things every entry shows, and where every id is |")).toBe(true);
    expect(judges.slice(2, 7).map((l) => /^\| \*\*([^:]+):/.exec(l)?.[1])).toEqual(["User", "Airwallex action", "Financial context", "Controls", "Proof"]);
    expect(judges[6]).toContain("](docs/in-depth.md#what-ran-live-one-id-per-rail)");
    // 19 Nov 2026: the TIP alert went (the judges' path says Try it); under the test-money alert, a short glossary.
    expect(lines.slice(5, glance - 9)).toEqual(["", lines[badges]!, lines[badges + 1]!, lines[badges + 2]!, "", `**${README_WHAT}**`, "", README_LINKS, "", README_THUMB, "", lines[16]!, "", lines[18]!, "", README_IS, "", ...proof, "", ...judges, "", lines[partners]!, "", "</div>", ""]);
    expect(lines.slice(glance - 9, glance)).toEqual(["> [!IMPORTANT]", lines[glance - 8]!, "", "**Words used here:**", ...lines.slice(glance - 5, glance - 1), ""]);
    expect(lines[glance - 8]).toMatch(/^> \*\*Test money only\.\*\* Live: .* Simulated: /);
    expect(lines.slice(glance - 5, glance - 1).map((l) => /^- \*\*([^*]+):\*\* /.exec(l)?.[1])).toEqual(["VIC, Airi", "T:0", "/try/sign", "Purser Cloud"]);
    expect(README).not.toContain("> [!TIP]");
    expect(lines.slice(glance + 1, kit).filter((l) => l.startsWith("- **"))).toHaveLength(6);
    expect(README_WHAT).toBe(HOME_SUB);
    expect(kit).toBeLessThan(68); // 68 since 19 Nov 2026 (the evidence map and its line under the thumbnail, +4); 64 since 19 Nov 2026 (README tightened for the judges: +12 lines above it: the demo's thumbnail, what Purser is, the Proof row, the glossary; -3: the TIP alert; 61 as built); 58 since 17 Nov, owner: strongest proof first (+8 lines: the proof table; "Built on Airwallex" moved down; 55 as built); 50 since 17 Nov later (owner: all the badges back, in three grouped rows: +2 lines; 48 as built); 48 since 17 Nov (the For judges table and the submission line, 9 lines; 46 as built); 40 since 15 Nov (readme-wow: the two alerts and the stat strip; 36 as built); 35 before
    // Under the Kit 11 table: the sentence every juror repeated, then the badges (the old row of buttons went: the three
    // links above say Try and the film; the trailer is in "Watch it", the proof in the live demo's line).
    // 15 Nov (Max): the badges moved to the top; the sentence every juror repeated stays under the Kit 11 table, then
    // the live demo's line.
    expect(badges).toBeLessThan(kit);
    const live = lines.findIndex((l) => l.startsWith("**Live demo: "));
    expect(lines.slice(live - 3, live)).toEqual(["", DIFFERENTIATORS[0], ""]);
    expect(read("docs/submission/long-description.md").split("\n").slice(0, 3)).toEqual(["# Purser: the long description", "", README_BUILT_ON.replace("(docs/airwallex.md)", "(../airwallex.md)")]);
    expect(README_BUILT_ON).not.toMatch(/partner|endors|certif|official|approved/i);
    // The two live GitHub badges (CI, CodeQL), then the proof strip (17 Nov, owner: the static shields went into it).
    // 17 Nov later (owner: all the badges, grouped): build (4), partners (5), proof (3), then the strip.
    // 19 Nov 2026 (owner): + the OpenSSF Best Practices badge in the build row.
    // 19 Nov 2026 (owner, OpenSSF gold): three labelled rows: build and quality (5), security and supply chain (6, the
    // Dafny proofs included), product and partners (8).
    expect([0, 1, 2].map((i) => lines[badges + i]!.match(/\[!\[/g)?.length)).toEqual([5, 6, 8]);
    // 17 Nov, owner: the badges at the very top; the strip stays at the foot of the centred top, under the judges' table.
    // 17 Nov, owner: strongest proof first: +7 (the proof table, 8 lines with its blank; "Built on Airwallex" and its blank moved down).
    // 19 Nov 2026: +5 (the demo's thumbnail and what Purser is with their blanks, the judges' Proof row).
    // 19 Nov 2026 (the owner): +4 (the evidence map under the thumbnail and the wall's line, with their blanks).
    expect(partners).toBe(badges + 35);
    expect(lines[live]).toMatch(/^\*\*Live demo: \[kit11\.max-31b\.workers\.dev\/try\]\(https:\/\/kit11\.max-31b\.workers\.dev\/try\)\*\*/);
    // 14 Nov (jury scan): the 3-command quick start on the first screens, then where things are. 15 Nov: the Kit 11 table
    // first under the header; the badges and the live demo's line after it ("At a glance"), then the quick start.
    expect(lines.slice(live + 1, live + 3)).toEqual(["", "## Verify it yourself in 3 commands"]);
    // 19 Nov 2026 (README tightened for the judges): one "How it works"; the sections that only pointed to a doc (the
    // gallery, Enterprise and the rest) are rows of one "More" table; "Not signed is never paid" says it holds above the limit.
    const order = ["## Verify it yourself in 3 commands", "## Where things are", "## Watch it", "## How it works", "**Above your limit: not signed, never paid.**", "## Built with", "## More"].map((h) => lines.indexOf(h));
    expect(order.every((x, i) => x > badges && (i === 0 || x > order[i - 1]!))).toBe(true);
    // The rails that ran live, said once under the three proofs; the three commands shown once, in their own section.
    expect(lines.some((l) => l.startsWith("**Run live on test money** (Alta testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude): the main run of 3 November"))).toBe(true);
    expect(README.split("npm run judge -- --check").length - 1).toBe(1);
    // 20 Nov (owner): the demo is the video; the film and the trailer only as one quiet line under it.
    expect(README).toContain("\nEarlier videos: [the film, under the hood (3:29)](https://youtu.be/PNLuqhRzVfE) · [the trailer (1:30)](https://youtu.be/n3HLVGROJc4) · test money only\n");
    expect(README.split("youtu.be/PNLuqhRzVfE").length - 1).toBe(1);
    expect(README).toContain("**[The demo (3:15)](https://youtu.be/gEUm8RlhZac)**");
    expect(README).not.toMatch(/5-minute walkthrough/);
    // 14 Nov (owner): the partners' logo row is back, the official files each on its own white tile, unaltered.
    // 14 Nov: Alta's wordmark in the row (the Alta team's OK); Visa and Cloudflare in text (the owner's decision).
    // 15 Nov: the row is in "Who does what", moved to docs/who-does-what.md (test/readmeFull.ts).
    expect(readmeFull()).toContain('<img src="docs/assets/logos/built-with.png" alt="Built with Airwallex, Alta and Claude" height="40"> official files, unmodified, each on its own white tile; Visa and Cloudflare named in text. No endorsement implied');
    expect(README).toContain("\n\nNo endorsement implied.\n\n"); // under the partners table; "Text names only" gone since the logos came back (14 Nov)
    expect(README).not.toContain("Text names only");
    expect(lines.indexOf("## How it works")).toBeGreaterThan(badges);
    expect(lines.findIndex((l) => l.startsWith("| **For judges:**"))).toBeGreaterThan(badges);
    expect(TRY_IT).toBe("Try it in 2 minutes.");
    expect(FILM_URL).toBe("https://youtu.be/gEUm8RlhZac");
    expect(lines.findIndex((l) => l === "## The business hypothesis")).toBeLessThan(280); // 280 since 17 Nov, owner: strongest proof first (+8 lines: the proof table; 273 as built); 270 since 17 Nov, later (+7: the For judges table; +1: the film's figures dated); 260 since 17 Nov (+7 lines: one engine, two jobs; what the sandbox taught us; three invariants); 250 since 15 Nov (+the invariants table); 240 since 15 Nov (readme-wow: the alerts, the stat strip, the terminal, the sequence diagram, the system map; 233 as built); 200 since 15 Nov, the clarity pass (195 as built); 195 since 15 Nov (the Kit 11 table, 194 as built); 180 since 14 Nov (Max: Airwallex at the centre, 177 as built); after the Visa and Metal Award sections (13 Nov); 170 since the README upgrade
  });

  it("opens Home under its heading with the idea, its proof line, the hands-on demo as the one primary button, the film second, one reassurance line", () => {
    const t = words(hero(HOME));
    // 13 Nov, evening (owner): the product tour is gone, so Home's first button is the hands-on demo again. 15 Nov
    // (clarity): the idea in one sentence, a proof line (what it runs on and three measured figures), Try it in 2
    // minutes, then the film; "See the proof" stays at the end of Home.
    expect([START, FILM_BUTTON]).toEqual(["Try it in 2 minutes", "Watch the demo"]);
    expect(t.startsWith(`${HERO} ${HOME_SUB} Built on Airwallex · test money · `)).toBe(true);
    expect(t).toContain(` ${START} ${FILM_BUTTON} ${VERIFY_BUTTON} ${REASSURE.sign}`);
    expect(hero(HOME).match(/class="btn[^"]*"/g)).toEqual(['class="btn primary big start"', 'class="btn big ghost film"', 'class="btn big ghost"']);
    // Every Try call to action opens the hands-on demo (TRY_URL), with /try/sign in the bundle or not.
    expect(hero(HOME)).toContain('<a class="btn primary big start" href="/try">');
    expect(hero(HOME)).toContain(`<a class="btn big ghost film" href="${FILM_URL}" target="_blank" rel="noopener">`);
    expect(HOME).not.toContain("Watch the agents");
    // The three sentences stay in the README, the form and the deck; Home tells the first with its product card.
    for (const d of DIFFERENTIATORS.slice(1)) expect(words(HOME)).not.toContain(d);
    // Without /try/sign in the bundle the button leads to /try, never to a dead link, and the line under it says what /try is.
    expect(homePage()).not.toContain('href="try/sign"');
    expect(hero(homePage())).toContain('<a class="btn primary big start" href="/try">');
    expect(words(hero(homePage()))).toContain(`${START} ${FILM_BUTTON} ${VERIFY_BUTTON} ${REASSURE.world}`);
    // No link to the product tour or to Pricing, both gone (13 Nov, evening).
    expect(homePage()).not.toMatch(/href="\/?(tour|pricing)"/);
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

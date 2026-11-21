// Section D (6 Nov): the first screen is the same in two places, the README and the form's synopsis: what Purser is in
// one sentence, the three sentences, "Try it in a minute." to /try/sign, and only then the badges and the details. Home
// (home-story, 12 Nov) opens with what Purser is, one button with one reassurance line, and the first of the three
// sentences, word for word, leading into its hero. And "Why this is a company", five lines from docs/business/, on the README and on Home. One source of
// truth: src/config/brand.ts (FIRST_SCREEN, WHY_COMPANY). Breaks when a place drops, adds or reorders a word.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_CASE_LINK, BUSINESS_DOCS, DIFFERENTIATORS, KIT11_RUN_LINE, README_WHAT, FILM_URL, FIRST_SCREEN, FIRST_SCREEN_TEXT, HERO, TRY_IT, TRY_SIGN_URL, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { CLOUD_EYEBROW, HOME_SUB, PILOT_CTA, REASSURE, START, START_ID, WATCH_BUTTON, homePage } from "../src/redesign/home.js";
import { heroStats } from "../src/redesign/heroWave.js";
import { TOUR_START_HREF } from "../src/redesign/tour.js";
import { buildPages } from "../src/relay/assets.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { loadRecord } from "../src/redesign/run.js";
import { readmeFull } from "./readmeFull.js";
import { readmeDemoLine, readmeStepLines } from "../scripts/readme-demo-svg.js";

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
// picture (hero-*.webp) moved to the gallery. 21 Nov 2026 (Max: the logo on top): the banner went to the gallery too.
const BANNER = `<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-dark.png"><img src="docs/assets/readme/banner-light.png" alt="Purser: AI agents spend. You sign off. Passkey on the exact terms · Limits enforced in 3 layers · Books matched to the cent" width="100%"></picture></a>`;

const README_BUILT_ON = "**Built on Airwallex.** Purser calls Airwallex's API for a card per agent with the CFO's limits (Issuing), FX quotes inside the signed terms, transfers that carry the hash the CFO signed, the payee's bank check, Airwallex's own approval as a second lock, and signed webhooks (the sandbox, test money: [docs/airwallex.md](docs/airwallex.md)).";

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

  it("opens the README with the logo, the title, one row of badges, the pitch, the small demo, the three steps and one row per sponsor track (Max, 21 Nov)", () => {
    const lines = README.split("\n");
    // 20 Nov 2026 (owner: "judges process many repos and videos; without scrolling, the top must show what Purser does,
    // the 3:15 demo, live links to /try and /proof, and which proof belongs to which sponsor track").
    // 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far
    // fewer headings". In the centred top, in this order: the Purser mark (the logo), the title, one compact row of
    // badges (test/readme-badges.test.ts), the pitch, the small demo (scripts/readme-demo-svg.ts, one recorded /try walk),
    // the three steps (the video's thumbnail and two step cards, then the same three as numbered links), and a
    // four-row table of the sponsor tracks (Airwallex, Visa via Airi, Alta (formerly Metal), T:0), each with what ran live
    // and one link to its record. The evidence map, the wall's line, the three badge rows, the judges' table, the
    // submission line, the banner with the animated flow and the proof strip left the top: the map and the flow
    // altogether (the flow and the banner to the gallery), the rest to "The proof" below.
    const [pictures, links] = readmeStepLines();
    // 21 Nov, later (Max): the second row of badges right under the first.
    expect(lines.slice(0, 18)).toEqual(['<div align="center">', "", lines[2]!, "", `# Purser · ${HERO}`, "", lines[6]!, "", lines[8]!, "", `**${README_WHAT}**`, "", readmeDemoLine(), "", pictures, "", links, ""]);
    expect(lines[8]!.startsWith("[![CodeQL]")).toBe(true);
    expect(lines[2]!.includes('srcset="docs/assets/brand/purser-mark-dark.svg"><img src="docs/assets/brand/purser-mark.svg" alt="Purser"')).toBe(true);
    expect(lines[6]!.startsWith("[![CI](")).toBe(true);
    const tracks = lines.slice(18, 24);
    expect(tracks[0]).toBe("| Sponsor track | What ran live (test money) | Record |");
    expect(tracks[1]).toBe("|---|---|---|");
    expect(tracks.slice(2).map((l) => /^\| \*\*([^*]+)\*\*/.exec(l)?.[1])).toEqual(["Airwallex", "Visa", "Alta (formerly Metal)", "T:0"]);
    const trackLinks = tracks.slice(2).map((l) => [...l.split(" | ").at(-1)!.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!));
    expect(trackLinks).toEqual([["docs/runs/airwallex-transfer-approval-2026-11-06.json"], ["docs/runs/2026-11-14-vic-5.md"], ["docs/runs/2026-11-03-main-run.md"], ["docs/runs/2026-11-14-t0-readback.md"]]);
    for (const f of trackLinks.flat()) expect(existsSync(new URL(`../${f}`, import.meta.url))).toBe(true);
    // Each row's figures are its record's.
    const awx = JSON.parse(read("docs/runs/airwallex-transfer-approval-2026-11-06.json")) as { read_at: string; run: string; transfer: { transfer_amount: number; transfer_currency: string; transfer_method: string; created_at: string; metadata: { approval_sha256: string } } };
    expect(tracks[2]).toContain(`Main run, ${Number(awx.transfer.created_at.slice(8, 10))} Nov: an agent's ${awx.transfer.transfer_currency} ${awx.transfer.transfer_amount.toFixed(2)} ${awx.transfer.transfer_method} payment`);
    expect(tracks[2]).toContain(`(\`metadata.approval_sha256\`, read back ${Number(awx.read_at.slice(8, 10))} Nov)`);
    expect(awx.run).toBe("docs/demo/main-run.json");
    const vic = JSON.parse(read("docs/runs/2026-11-14-vic-5.json")) as { started_at: string; purchases: { step: string; request: { amount: string; currency: string }; outcome?: unknown }[] };
    const paid = vic.purchases.find((p) => p.step === "B")!;
    expect(tracks[3]).toContain(`${Number(vic.started_at.slice(8, 10))} Nov: ${paid.request.currency} ${paid.request.amount} above the CFO's limit`);
    expect(read("docs/runs/2026-11-14-vic-5.md")).toMatch(/PURSER_CREDENTIAL_ALREADY_USED[\s\S]*PURSER_CREDENTIAL_AMOUNT_MISMATCH|PURSER_CREDENTIAL_AMOUNT_MISMATCH[\s\S]*PURSER_CREDENTIAL_ALREADY_USED/);
    const m = metalStory(loadRecord().record);
    expect(tracks[4]).toContain(`Main run, 3 Nov: x402 agents buy and sell data under on-chain mandates, ${m.payments.total} Alta payments; purchase #${m.refusal!.seq}, over its mandate, refused on chain by Alta itself`);
    const t0 = JSON.parse(read("docs/runs/2026-11-14-t0-readback.json")) as { read_at: string; close_check: { agrees: boolean; expected: number; matched: number; how: string } };
    expect(t0.close_check).toMatchObject({ agrees: true, how: "accounts" });
    expect(t0.close_check.matched).toBe(t0.close_check.expected);
    expect(tracks[5]).toContain(`${Number(t0.read_at.slice(8, 10))} Nov: all ${t0.close_check.matched} of the main run's journal entries read back from T:0, every account matching Purser's books to the cent`);
    expect(tracks.join("\n").replaceAll("Alta (formerly Metal)", "")).not.toMatch(/\bMetal\b/); // "Alta (formerly Metal)", never Metal alone
    // "Alta (formerly Metal)" at the first mention of Alta (here, the badge row's).
    expect(README.indexOf("Alta (formerly Metal)")).toBe(README.indexOf("Alta"));
    expect(lines.slice(24, 27)).toEqual(["", "</div>", ""]);
    // Under the centred top: the test-money alert, what Purser is, the glossary folded, then "The proof".
    expect(lines.slice(27, 33)).toEqual(["> [!IMPORTANT]", lines[28]!, "", README_IS, "", "<details><summary><b>Words used here</b></summary>"]);
    expect(lines[28]).toMatch(/^> \*\*Test money only\.\*\* Live: .* Simulated: /);
    const glossary = lines.slice(34, lines.indexOf("</details>", 33));
    expect(glossary.filter((l) => l).map((l) => /^- \*\*([^*]+):\*\* /.exec(l)?.[1])).toEqual(["VIC, Airi", "T:0", "/try/sign", "Purser Cloud"]);
    expect(README).not.toContain("> [!TIP]");
    expect(README).not.toContain("The strongest proof, one click each");
    // "The proof": the proof strip, the wall's line, the judges' table, the six lines of At a glance
    // (test/readme-glance.test.ts), the Kit 11 line, one engine two jobs, what stood at the submission.
    const proof = lines.indexOf("## The proof");
    expect(proof).toBeGreaterThan(lines.indexOf("</details>", 31));
    const judges = lines.slice(lines.findIndex((l) => l.startsWith("| **For judges:**")));
    expect(judges[0]!.startsWith("| **For judges:** the four things every entry shows, and where every id is |")).toBe(true);
    expect(judges.slice(2, 7).map((l) => /^\| \*\*([^:]+):/.exec(l)?.[1])).toEqual(["User", "Airwallex action", "Financial context", "Controls", "Proof"]);
    expect(judges[2]).toContain("[for the CFO](docs/finance-value.md)");
    expect(judges[6]).toContain("](docs/in-depth.md#what-ran-live-one-id-per-rail)");
    const howItWorks = lines.indexOf("## How it works");
    const submission = lines.findIndex((l) => l.startsWith("**What stood at the submission:** the tag `v1.0-submission` (8 Nov)"));
    expect(submission).toBeGreaterThan(proof);
    expect(submission).toBeLessThan(howItWorks);
    expect(lines[submission]).toContain("(entered for the Founder's Choice Award, the Judges' Choice Award, the Metal Award and the Visa Award)");
    const kit = lines.findIndex((l) => l.startsWith(`**Kit 11, step by step.** ${KIT11_RUN_LINE}`));
    expect(kit).toBeGreaterThan(proof);
    expect(kit).toBeLessThan(66);
    expect(lines.slice(proof + 1, kit).filter((l) => l.startsWith("- **"))).toHaveLength(6);
    expect(README_WHAT).toBe(HOME_SUB);
    // The banner (13 Nov, evening, owner) and the animated flow (15 Nov, Max), one line, now in the gallery.
    expect(README).not.toContain("banner-light.png");
    expect(readmeFull()).toContain(`${BANNER}<br><picture>`);
    for (const f of ["docs/assets/readme/banner-dark.png", "docs/assets/readme/banner-light.png", "docs/assets/readme/hero-dark.webp", "docs/assets/readme/hero-light.webp"]) expect(existsSync(new URL(`../${f}`, import.meta.url))).toBe(true);
    // "Built on Airwallex" (14 Nov, factual, no partnership implied) follows the partners' table in "Built with", word for word.
    const built = lines.indexOf("## Built with");
    expect(lines.indexOf(README_BUILT_ON)).toBeGreaterThan(built);
    expect(lines.indexOf(README_BUILT_ON)).toBeLessThan(lines.indexOf("## Verify it yourself in 3 commands"));
    expect(read("docs/submission/long-description.md").split("\n").slice(0, 3)).toEqual(["# Purser: the long description", "", README_BUILT_ON.replace("(docs/airwallex.md)", "(../airwallex.md)")]);
    expect(README_BUILT_ON).not.toMatch(/partner|endors|certif|official|approved/i);
    // The sentence every juror repeated opens "How it works".
    expect(lines.slice(howItWorks + 1, howItWorks + 4)).toEqual(["", DIFFERENTIATORS[0], ""]);
    // Seven sections, in this order.
    const order = ["## The proof", "## How it works", "**Above your limit: not signed, never paid.**", "## Built with", "## Verify it yourself in 3 commands", "## Try it in 2 minutes", "## The business hypothesis", "## More"].map((h) => lines.indexOf(h));
    expect(order.every((x, i) => x > 22 && (i === 0 || x > order[i - 1]!))).toBe(true);
    // The rails that ran live, said once under the three proofs; the three commands shown once, in their own section.
    expect(lines.some((l) => l.startsWith("**Run live on test money** (Alta testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude): the main run of 3 November"))).toBe(true);
    expect(README.split("npm run judge -- --check").length - 1).toBe(1);
    // 20 Nov (owner): the demo is the video; the film and the trailer only as one quiet line, in "More".
    expect(README).toContain("\nEarlier videos: [the film, under the hood (3:29)](https://youtu.be/PNLuqhRzVfE) · [the trailer (1:30)](https://youtu.be/n3HLVGROJc4) · test money only\n");
    expect(README.split("youtu.be/PNLuqhRzVfE").length - 1).toBe(1);
    expect(README).toContain("**[The demo (3:15)](https://youtu.be/gEUm8RlhZac)**");
    expect(README).not.toMatch(/5-minute walkthrough/);
    // 14 Nov (owner): the partners' logo row, the official files each on its own white tile, unaltered; in "Who does
    // what", moved to docs/who-does-what.md on 15 Nov (test/readmeFull.ts).
    expect(readmeFull()).toContain('<img src="docs/assets/logos/built-with.png" alt="Built with Airwallex, Alta and Claude" height="40"> official files, unmodified, each on its own white tile; Visa and Cloudflare named in text. No endorsement implied');
    expect(README).toContain("\n\nNo endorsement implied.\n\n"); // under the partners table; "Text names only" gone since the logos came back (14 Nov)
    expect(README).not.toContain("Text names only");
    expect(TRY_IT).toBe("Try it in 2 minutes.");
    expect(FILM_URL).toBe("https://youtu.be/gEUm8RlhZac");
    expect(lines.findIndex((l) => l === "## The business hypothesis")).toBeLessThan(280);
  });

  it("opens Home under its heading with the idea, three figures, Try as the one primary button, Watch and Pilot, one sandbox line", () => {
    const t = words(hero(HOME));
    expect([START, WATCH_BUTTON, PILOT_CTA]).toEqual(["Try it", "Watch the demo", "Start a pilot"]);
    // The owner's concept (21 Nov): three figures from the records under the idea, then Try (primary), Watch the demo and
    // Start a pilot; the judge tour's button is under its map (test/home-story.test.ts).
    expect(t.startsWith(`${CLOUD_EYEBROW} ${HERO} ${HOME_SUB} ${heroStats().map((s) => `${s.value} ${s.words}`).join(" ")} ${START} ${WATCH_BUTTON} ${PILOT_CTA} ${REASSURE.sign}`)).toBe(true);
    expect(heroStats()).toHaveLength(3);
    expect(hero(HOME).match(/class="btn[^"]*"/g)).toEqual(['class="btn primary big start"', 'class="btn big ghost watch"', 'class="btn big ghost pilot"']);
    expect(HOME).toContain(`<a class="btn big tour" href="${TOUR_START_HREF}" data-tour-start>`);
    expect(HOME).toContain(`<section class="e-start" id="${START_ID}"`);
    // Every Try call to action opens the hands-on demo (TRY_URL), with /try/sign in the bundle or not.
    expect(hero(HOME)).toContain('<a class="btn primary big start" href="/try">');
    expect(HOME).not.toContain("Watch the agents");
    // The three sentences stay in the README, the form and the deck; Home tells the first with its product card.
    for (const d of DIFFERENTIATORS.slice(1)) expect(words(HOME)).not.toContain(d);
    // Without /try/sign in the bundle the button leads to /try, never to a dead link, and the line under it says what /try is.
    expect(homePage()).not.toContain('href="try/sign"');
    expect(hero(homePage())).toContain('<a class="btn primary big start" href="/try">');
    expect(words(hero(homePage()))).toContain(`${START} ${WATCH_BUTTON} ${PILOT_CTA} ${REASSURE.world}`);
    // No link to Pricing or /judge, both gone (13 Nov, evening).
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

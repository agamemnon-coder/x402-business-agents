// The public site after Max's mega-prompt v4 (C1-C8, D2, D3): the tabs (Home, Try, Proof; Watch once the film is set) and,
// since 12 Nov, "More" (pricing, security and the partner pages in a script-free dropdown); short partner pages with the details folded;
// a text budget per page; no forbidden words on any public page; one Face ID number from one source; the split between
// Claude's decisions and code's routine payments, both counted from the record; the Claude call badge from each trace;
// every internal link answers (old addresses redirect, anything else gets the clean 404).
import { WATCH_IN_MENU } from "../src/config/film.js";
import { COUNT_JS } from "../src/redesign/stats.js";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { notFoundResponse, pageResponse, type Pages } from "../worker/src/core.js";
import { agentRun, callBadge, faceIdDecisions, highlights, loadRecord, payments, split, tapRun } from "../src/redesign/run.js";
import { OPEN_TARGET_JS } from "../src/redesign/ui.js";
import { MORE_LABEL, MORE_LINKS } from "../src/ui/more.js";
import { hostileClaimText } from "../src/redesign/partners.js";
import { AWX_PAGE_LABEL } from "../src/redesign/airwallexProducts.js";
import { METAL_INSPECT_JS } from "../src/redesign/metalMandates.js";
import { tokenizeRun } from "../src/redesign/tokenizeRun.js";
import { vic3Run } from "../src/redesign/vic3Run.js";
import { ICC_RUN_EXTRA_WORDS, iccRecordIn } from "../src/redesign/iccBlock.js";
import { scriptBlocks } from "./support/scriptBlocks.js";
import { SECOND_APPROVER, SPLIT_LINE, VISA_CLAIM, VISA_TAP_STATUS, WORLD_SETUP } from "../src/config/brand.js";

const pages = buildPages();
const run = agentRun();
const { record } = loadRecord();
/** The public pages a juror reaches: the four tabs, the pages under "More" (pricing, security, the four partner pages) and the 404. */
const PUBLIC: Record<string, string> = { home: pages.home!, watch: pages.watch!, try: pages.try, proof: pages.proof!, pricing: pages.pricing!, security: pages.security!, metal: pages.metal, airwallex: pages.airwallex!, visa: pages.visa, claude: pages.claude!, notFound: pages.notFound! };
// /docs and /status (12 Nov), the other two product pages under "More".
Object.assign(PUBLIC, { docs: pages.docs!, status: pages.status! });

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The words a person reads without opening anything: <main> only, no script, style, drawing, or folded details (their summary stays). */
export function visibleWords(html: string): number {
  let main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;
  // Drawings nest (an icon inside the stage): remove the innermost first, until none is left.
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  const text = main.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
/** Every text on a page, data blocks included (anything a script could show). */
const allText = (html: string) => decode(html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " "));

describe("the site after v4", () => {
  it("keeps every page within its text budget (Home 250, as one story since 12 Nov; partner pages at most 150, /metal 275 with its table of the four mandates, /claude 195 with its measured block, /airwallex 365 with its read-back, awx-1, the Airi run and the second Airi run's heading, /visa 625 with the VIC heading and drawing on top, what ran, the two Airi runs, their folded lines and the TAP section last)", () => {
    // Proof: 480 since 4 Nov, for the TAP run's decline on its own line below the stop figure (Max).
    // Home: 600 since 6 Nov, for the three sentences under the heading, the Kit 11 line and the one caveat line (jury review, #1, #7).
    // Proof 520 and Airwallex 190 since 6 Nov, for Airwallex read back (section B): the hash the CFO signed beside the one
    // Airwallex returns with the payment, and one line for the cards against the CFO policy (each card's side by side
    // folded on /airwallex, Max's decision on #53).
    // Home: 760 since section D (6 Nov), for what Purser is in one sentence, "Try it in 30 seconds." on its own line and
    // "Why this is a company" (five lines from docs/business/, under one note that says it is not validated).
    // Home: 880 since section D's proof sentences (6 Nov): one sentence per partner, each with its numbers, in place of
    // the three short partner cards.
    // Proof: 560 since Max's last round (item 2), for each partner card opening with its strongest claims (the TAP lines gone).
    // Home: 890 since Max's last round (item 5.2), for the price with Claude decisions included.
    // Home: 130 since Max's round of 7 Nov ("a picture says more than a thousand words"): the heading, what Purser is,
    // the three steps, one button; the numbers, the partners and the business moved to /proof, behind closed lines.
    // Watch: 125 since then, for the next step under the replay ("Now try it yourself") and the film's link.
    // Airwallex: 210 since 7 Nov, for awx-1 (the separate Airwallex-only run): its date, name and "sandbox, test money"
    // label, its checks passed, and the summary of its fold (every step and id folded).
    // Airwallex: 235 since 7 Nov, for the Airi run in the same form (date, name, "sandbox, test card, test money", its
    // checks passed, the summary of its fold): 23 words.
    // Airwallex 345 and Visa 275 since 7 Nov (owner's copy, Visa Intelligent Commerce via Airwallex's Airi): the Airi
    // block in sight on both, with its heading, label, one summary sentence, the three purchases with their outcome
    // badges and the 5 of 5 checks (ids still folded): 342 and 272 words as built, a few words of margin. Proof stays
    // at 560 with the same block in sight under the partners (516 as built).
    // Home: 190 since the jury review of 7 Nov (#2), for the three sentences back under the subtitle (188 words).
    // Metal: 175 since then (#3), for what the explorer shows beside the refusal's link (172 words).
    // Visa: 375 since the VIC flow (7 Nov, src/redesign/vicFlow.ts): seven steps under the Airi block, each with whose
    // step it is, its title, one short line and purchase B's id or value, and C's branch off step 2 (100 words; 372 as built).
    // Home: 195 since Visa's word on the VIC run (7 Nov): the award pill reads "entered for the Metal Award and the Visa
    // Award", four words more (192 as built).
    // Metal: 200 since the review of 9 Nov, for who signs the replace on chain on its card and the fold that links all 86
    // transactions one by one (199 as built).
    // Home: 250 since the competitive review of 10 Nov (249 as built): one button to /try/sign, the other ways in as text
    // links, the hero demo in place of the three sentences, Airwallex's own decline with the main run's counts and one
    // id, the awards line under the first screen and one line on what comes next (README and form keep the sentences).
    // Home: still 250 since it became one story (home-story, 12 Nov; 240 as built, 243 with /try/sign): the heading, one
    // sentence, one button and its line, the first of the three sentences, the hero's four steps with one short line
    // each, one provenance line, three proof rows, the last button. test/home-story.test.ts holds both builds to it.
    // Proof: 715 since then, for "What Purser guarantees" under the run's figures: seven promises, each with who enforces
    // it and its evidence in sight, how, the code and the test folded (705 as built).
    // Visa: 495 since then (Max, 10 Nov: we compete for the Visa Award, keep it visible): one plain sentence on top naming
    // the entry and the run (490 as built).
    // 12 Nov (jury panel): Home 250 → 254 for "Visa (VIC via Airi)" in "Built on" (4 words, 254 as built); /airwallex
    // 370 → 374 because the Airi run's summary now says "A scripted run, no Claude call" and "with no Purser approval"
    // (374 as built). /visa stays at 625 (617 as built): the TAP material went into one closed fold, which pays for the
    // five facts, purchase B's table and the basis line. The review of 12 Nov: 621 as built (step 1 of the drawing
    // says the run was scripted, purchase B's middle cell says "from the signed terms", the summary card keeps only the
    // series and the ids).
    // Metal: 250 only while a run record of the invoice token exists (12 Nov; docs/runs/<date>-tokenize.json), for its one
    // block: the title, one sentence from the record, the verify badge and the summary of its fold (50 words with its
    // hidden section heading; the transactions folded). Without a record the page is unchanged and its budget stays 200 (test/tokenize-record.test.ts
    // holds both states).
    // Pricing 150 and Security 220 since 12 Nov (the pages under "More"): three price cards and one "Not yet" line; seven
    // short cards, each one sentence with its proof link, the detail folded.
    // Watch: 260 since the film page (12 Nov): the poster, 13 chapters with their times and the key of what is real
    // and what is simulated; the transcript is folded (the replay that was here moved to /replay).
    // Home: 300 since the enterprise pass (owner, 12 Nov): four features and the stat row (288 as built).
    const budget: Record<string, number> = { home: 300, watch: 260, try: 180, proof: 720 /* +5 for the honesty notes of the panel review, 10 Nov */, pricing: 150, security: 280 /* 220 until 12 Nov 15:55: nine controls, each with its proof (the owner); +5, 12 Nov merge: the hostile-model eval and the zero-trust report linked; +15, jury check 12 Nov: "Face ID signs on chain" and "How the 2 were detected" linked */, metal: tokenizeRun() ? 385 : 330 /* +75, jury panel 12 Nov: the four mandates in one table (seven columns, each figure a word); +50, 12 Nov wire-in: "Face ID signs on chain", six steps from docs/runs/2026-11-12-faceid-onchain.json (49 words as built); +5, jury check 12 Nov: "Since 12 Nov it does", linking it from the replace card */, airwallex: 480 /* +40, 13 Nov (owner: "graphs and visuals"): the path of seven stops, the charts' legends and the two meters in words, the cards' figures and ids folded (474 as built); +10, 13 Nov: the fold "Approved with the owner's own Face ID (13 Nov)", its summary in sight (8 words; 437 as built); +5, panel review 10 Nov; +4, jury panel 12 Nov; +41, jury check 12 Nov: three tiles behind flags (payee check, batch transfer, ledger reconciliation) and their line, 411 as built; +15, review at 390 px 12 Nov (f5c3a817): seven products plus three tested live, 'Built, not yet switched on', 429 as built */, visa: 710 + (iccRecordIn() ? ICC_RUN_EXTRA_WORDS : 0) /* + ICC_RUN_EXTRA_WORDS only while an ICC run record exists (12 Nov; test/icc-block.test.ts holds the block to it); +5, panel review 10 Nov; +105 for the overview on top, its flow and three run cards (Max, 10 Nov: more Visa); +5 on 12 Nov for two folded lines under the Airi runs, "As reported by the Airwallex sandbox" and "The CFO's policy next to Visa's VIC rules" (14 words; 9 of them paid for by the TAP section's line that went; 614 as built); +10 on 12 Nov for a third folded line, "Card data: not a network-tokenised checkout, no PCI attestation" (9 words: what this checkout is not, readable without opening the fold; 623 as built) */, claude: 240 /* +45, jury panel 12 Nov: measured, not asserted (four figures, each with its record, and the injection screen); +30, 12 Nov merge: the hostile-model eval's line with its record link (29 words), kept beside the measured block; +15, 12 Nov merge: the measured block's line on the zero-trust report, shown once docs/zero-trust/report.json is in the tree */, notFound: 40 };
    // Docs 200 since 12 Nov: four cards, the agent API's tools by name with one short line each, every description folded.
    // Status 90 since 12 Nov: the status lines (empty until /health is read) and the five latest live runs.
    Object.assign(budget, { docs: 280 /* +10, review 12 Nov: the KIT note; +35, 13 Nov: the "Connect your AI" card; +35, jury 13 Nov: Purser Cloud as a guest in that card, its link and its folded steps' header (274 as built) */, status: 90 });
    for (const [name, html] of Object.entries(PUBLIC)) expect({ name, over: visibleWords(html) > budget[name]! ? visibleWords(html) : 0 }).toEqual({ name, over: 0 });
  });

  it("shows no forbidden words on any page a visitor can reach (every page buildPages serves, the archive and the phone pages included)", () => {
    const bad = [/warehouse software/i, /stand-in/i, /\bdry-1\d*/i, /Dev test/i, /Recorded 30 October/i, /read, plan and advise/i, /\bfather\b/i, /four eyes.{0,80}\b(optional|off)\b/i, /\b(optional|off)\b.{0,80}four eyes/i, /\b0 unsafe\b/i, /confirmed (that )?TAP counts/i,
      // The old absolute claims (jury review, 4 Nov): the core sentence says who holds which limit instead.
      /every limit/i, /can['’]t break/i];
    // The phone's script, stylesheet and font are not pages (the phone pages themselves are checked).
    const all = Object.entries(pages as unknown as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !["client", "css", "font"].includes(e[0]));
    expect(all.map(([k]) => k)).toEqual(expect.arrayContaining(["dashboard", "month", "film", "try", "lab", "metal", "metalReport", "visa", "airwallex", "claude", "pricing", "security", "home", "watch", "proof", "notFound", "approve", "enrol", "policy"]));
    expect(all.map(([k]) => k)).toEqual(expect.arrayContaining(["docs", "status"]));
    // 12 Nov (jury panel): /claude's hostile-model eval line says "0 unsafe" as CI computed it (docs/evals/ap-hostile.json).
    const hostile = hostileClaimText();
    for (const [name, html] of all) for (const re of bad) expect({ name, found: re.exec(allText(html).replace(hostile || "\u0000", " "))?.[0] ?? null }).toEqual({ name, found: null });
  });

  it("has four tabs and More in the menu, on every public page; under More the pages the site serves, in one order: Pricing, Security, Docs, then Airwallex, Metal, Visa, Claude", () => {
    // The whole list, in the menu's order (src/ui/more.ts): the product pages, then the partner pages.
    expect(MORE_LINKS.map((l) => [l.label, l.href])).toEqual([["Purser Cloud", "https://purser-try.max-31b.workers.dev/"], ["Pricing", "pricing"], ["Security", "security"], ["Docs", "docs"], ["Books", "books"], ["Airwallex", "airwallex"], ["Metal", "metal"], ["Visa", "visa"], ["Claude", "claude"]]);
    // The menu lists a page exactly when the site serves it, so "More" never opens onto a 404 (a page not built yet is
    // left out until it is registered; then the menu must list it).
    // 12 Nov: Purser Cloud is its own deployment (an absolute link), served there, not by this Worker.
    const served = MORE_LINKS.filter((l) => /^https:\/\//.test(l.href) || pageResponse(new Request(`https://x.test/${l.href}`), pages as Pages)?.status === 200).map((l) => l.label);
    expect(served).toEqual(expect.arrayContaining(["Pricing", "Security", "Airwallex", "Metal", "Visa", "Claude"]));
    expect(served).toEqual(expect.arrayContaining(["Docs"]));
    expect(served).not.toContain("Status"); // 12 Nov (owner): Status left the menu
    for (const [name, html] of Object.entries(PUBLIC)) {
      const nav = /<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
      // Five items, in this order: the four tabs as links, then "More", a <details> that needs no script.
      const more = /<details class="pmore"><summary[^>]*>([^<]+)<\/summary><div class="pmenu">([\s\S]*?)<\/div><\/details>$/.exec(nav);
      const tabs = [...nav.slice(0, more ? more.index : nav.length).matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
      // 13 Nov (owner): Judge is out of the menu again (it was after Proof that morning).
      expect({ name, items: [...tabs, more?.[1]] }).toEqual({ name, items: [...(WATCH_IN_MENU ? ["Home", "Watch", "Try", "Proof"] : ["Home", "Try", "Proof"]), MORE_LABEL] });
      expect(MORE_LABEL).toBe("More");
      expect({ name, more: [...(more?.[2] ?? "").matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]) }).toEqual({ name, more: served });
      // The partner pages follow the product pages after one divider; nothing else is in the dropdown.
      const product = MORE_LINKS.filter((l) => l.group === "product" && served.includes(l.label));
      expect({ name, rest: (more?.[2] ?? "").replace(/<a [^>]*>[^<]+<\/a>/g, "") }).toEqual({ name, rest: product.length ? "<hr>" : "" });
      // The footer repeats the product pages' links (not the partner pages), in the same order; Try, an older page, has no footer.
      const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
      if (name !== "try") expect({ name, footer: [...foot.matchAll(/<a class="flink" href="\/?([a-z]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]).filter(([href]) => MORE_LINKS.some((l) => l.href === href && l.group === "product")) }).toEqual({ name, footer: product.filter((l) => !/^https:/.test(l.href)).map((l) => [l.href, l.label]) });
    }
  });

  it("answers every internal link of the public pages with a page or a redirect, and anything else with the clean 404", () => {
    const p = pages as Pages;
    const seen = new Set<string>();
    for (const [name, html] of Object.entries(PUBLIC)) {
      if (name === "notFound") continue;
      for (const m of html.matchAll(/href="([^"#]*)(#[^"]*)?"/g)) {
        const href = m[1]!;
        if (!href || /^(https?:|mailto:)/.test(href)) continue;
        // /status links to /health, the relay's own JSON answer and not a page of the bundle (test/saas-status-docs.test.ts fetches it).
        if (name === "status" && href === "health") continue;
        const path = new URL(href, "https://x.test/").pathname;
        seen.add(path);
        const res = pageResponse(new Request(`https://x.test${path}`), p);
        expect({ name, href, status: res?.status ?? 404 }).toEqual({ name, href, status: res && res.status === 302 ? 302 : 200 });
      }
    }
    // "/try" is no longer linked: since 12 Nov the Try tab and every Try button open the hands-on demo (TRY_URL).
    for (const want of ["/home", "/watch", "/proof", "/pricing", "/security", "/metal", "/airwallex", "/visa", "/claude", "/lab", "/film", "/month", "/metal/report"]) expect(seen).toContain(want);
    for (const want of ["/docs"]) expect(seen).toContain(want);
    for (const [from, to] of [["/live", "/replay"], ["/demo", "/replay"], ["/overview", "/home"]]) expect(pageResponse(new Request(`https://x.test${from}`), p)?.headers.get("location")).toBe(to);
    expect(pageResponse(new Request("https://x.test/no/such/page"), p)).toBeNull();
    const nf = notFoundResponse(p);
    expect(nf.status).toBe(404);
    expect(nf.headers.get("content-security-policy")).toBe(pages.csp.notFound);
    // The 404 answers at any depth, so its links and assets are absolute.
    expect(pages.notFound).toMatch(/href="\/home"/);
    expect(pages.notFound).not.toMatch(/(href|src)="(?!https?:|#|\/)/);
  });

  it("sends a path pasted with the sentence's full stop or comma to the same path without it (jury review, 7 Nov, #18)", () => {
    const p = pages as Pages;
    const go = (path: string) => pageResponse(new Request(`https://x.test${path}`), p);
    for (const [from, to] of [["/tour.", "/tour"], ["/try/sign,", "/try/sign"], ["/proof.", "/proof"], ["/watch.,", "/watch"], ["/,", "/"], ["/airwallex.?x=1", "/airwallex?x=1"]] as const) {
      const r = go(from);
      expect({ from, status: r?.status, to: r?.headers.get("location") }).toEqual({ from, status: 302, to });
    }
    // Only a trailing "." or ","; anything else is answered as before, and a POST is not redirected.
    expect(go("/proof")?.status).toBe(200);
    expect(go("/no/such/page")).toBeNull();
    expect(pageResponse(new Request("https://x.test/tour.", { method: "POST" }), p)).toBeNull();
  });

  it("reaches the archive (/lab, /film, /month, /metal/report) only through Proof's folded, labelled Archive", () => {
    // Its own closed line at the end of Proof since 12 Nov (before: a card inside "Every check"), the replay first.
    const archive = /<details class="deep" id="archive"><summary>Archive<\/summary>[\s\S]*?<\/details>/.exec(pages.proof!)?.[0] ?? "";
    expect(archive).toContain(`<li><a class="pf" href="replay">Replay of the main run, ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(run.recordedAt))}</a></li>`);
    expect(archive).toContain('href="replay">Replay of the main run, 3 Nov</a>');
    for (const href of ["lab", "film", "month", "metal/report"]) {
      expect(archive).toMatch(new RegExp(`<details[\\s\\S]*href="${href}"`));
      for (const [name, html] of Object.entries(PUBLIC)) if (!["proof", "metal"].includes(name)) expect({ name, href, linked: html.includes(`href="${href}"`) }).toEqual({ name, href, linked: false });
    }
  });

  it("puts the Claude call behind each decision on Watch and Home, from its trace (D2)", () => {
    const says = run.events.filter((e): e is Extract<typeof e, { k: "say" }> => e.k === "say");
    expect(says.length).toBeGreaterThan(0);
    for (const e of says) {
      const t = record.snapshot.traces.find((x) => x.agent === e.agent && x.steps.length && x.steps[x.steps.length - 1]!.ts === e.at)!;
      const tr = t as unknown as { tokens: { input: number; output: number; cache_read: number; cache_write: number }; request_ids: string[]; claude_ms: number[]; model: string };
      const total = tr.tokens.input + tr.tokens.output + tr.tokens.cache_read + tr.tokens.cache_write;
      const secs = (tr.claude_ms.reduce((n, x) => n + x, 0) / 1000).toFixed(1);
      const fam = /claude-(haiku|sonnet|opus)/.exec(tr.model)![1]!;
      expect(callBadge(e.call!)).toBe(`Claude call ✓ · ${fam[0]!.toUpperCase()}${fam.slice(1)} · ${total.toLocaleString("en-US")} tokens · ${secs} s · ${tr.request_ids[0]!.slice(0, 12)}…`);
      expect(pages.replay).toContain(callBadge(e.call!));
    }
  });

  it("keeps Watch on about a dozen highlights; the main run's licence was paid on its first attempt (no earlier attempt to label)", () => {
    const h = highlights(run);
    expect(h.length).toBeGreaterThanOrEqual(10);
    expect(h.length).toBeLessThanOrEqual(15);
    expect(h.some((e) => e.k === "money" && (e.refused?.code === "fee_unknown" || e.earlier))).toBe(false);
    expect(run.events.some((e) => e.k === "money" && e.earlier)).toBe(false);
    expect(pages.replay).toContain(`Full run (${run.events.length} steps)`);
    expect(pages.replay).toContain(WORLD_SETUP);
  });

  it("shows one Face ID number from one source, and the split between Claude and code (D3)", () => {
    const n = faceIdDecisions(record);
    expect(n).toBe(record.proof.face_id);
    const sp = split(record);
    expect(sp.fallbacks).toBe(0);
    expect(sp.byClaude).toBe(sp.decisions);
    const proof = pages.proof!;
    expect(proof).toContain(SPLIT_LINE);
    expect(proof).toContain(`<span class="v"><span data-count="${sp.byClaude}" data-dec="0">${sp.byClaude}</span></span><span class="l">decisions by Claude (${sp.fallbacks} fallbacks)</span>`);
    // One canonical set (jury review, 6 Nov, #5): the Metal payments and the card charge, not "82 routine by code".
    const pay = payments(record);
    expect(proof).toContain(`<span class="v"><span data-count="${pay.onChain}" data-dec="0">${pay.onChain}</span></span><span class="l">Metal payments + 1 card charge</span>`);
    expect(proof).not.toContain("routine payments by code");
    // Every "N Face ID" on the public pages is the same N.
    for (const [name, html] of Object.entries(PUBLIC)) for (const m of allText(html).matchAll(/(\d+)\s+Face ID decisions/g)) expect({ name, n: Number(m[1]) }).toEqual({ name, n });
    // Routine payments by code, counted again: per-query buying and selling, not refused.
    const routine = record.snapshot.flows.filter((f) => !f.refused && (f.kind === "sale" || (f.kind === "upstream" && f.decided.startsWith("code")))).reduce((k, f) => k + (f.count ?? 1), 0);
    expect(sp.routine).toBe(routine);
  });

  it("gives Proof three partner cards (no Visa TAP on it) and says the fixed lines word for word", () => {
    const proof = pages.proof!;
    // Three partner cards since 6 Nov (jury review, #7): Visa TAP is a footer link to /visa, not a card.
    // 12 Nov (wire-in, owner): five cards, Visa (VIC via Airi, vic-3) and T:0 added; still no Visa TAP card.
    expect((proof.match(/<article class="pcard card"/g) ?? []).length).toBe(5);
    expect(proof).not.toMatch(/<span class="logo txt">Visa TAP<\/span>/);
    // The Visa paragraph is said once, on /visa (jury review, 4 Nov); TAP's status too (Visa, 5 Nov: not eligible Visa
    // tooling), both inside /visa's one closed TAP fold. Proof's footer link to it went on 12 Nov (jury panel).
    expect(proof).not.toContain(VISA_CLAIM);
    expect(proof).not.toContain(VISA_TAP_STATUS);
    expect(proof).not.toMatch(/Extra, not an award entry|<a class="flink" href="visa"/);
    expect(proof).toContain(SECOND_APPROVER);
    expect(pages.visa).toContain(VISA_CLAIM);
    expect(pages.visa).toContain(VISA_TAP_STATUS);
  });

  it("makes the partner pages picture first, numbers next, details folded, and no Visa logo", () => {
    for (const name of ["metal", "airwallex", "visa", "claude"] as const) {
      const html = PUBLIC[name]!;
      const whole = /<main[\s\S]*<\/main>/.exec(html)![0];
      // /visa opens with Visa Intelligent Commerce (12 Nov): its picture is the VIC flow, right under the heading and
      // before anything folded; the Airi run (owner's copy, 7 Nov) is under it and above the one closed TAP fold, the
      // last thing on the page (test/visa-overview.test.ts holds the order, test/airi-run-page.test.ts the block).
      const airi = /<div class="awrb"><div class="card airi" id="airi-run">[\s\S]*?<\/details><\/div><\/div>/.exec(whole)?.[0] ?? "";
      expect({ name, airiAboveTap: name === "visa" ? airi.length > 0 && whole.indexOf(airi) < whole.indexOf('class="flow card"') : true }).toEqual({ name, airiAboveTap: true });
      // /airwallex opens on a tile per Airwallex product (jury panel, 12 Nov); its flow of the main run is one of the folds.
      // /metal opens on its four mandates in one table (jury panel, 12 Nov), its one fold inside it (the read to repeat).
      // /visa's picture is the VIC flow (12 Nov); since the jury pass (13 Nov) the latest run's four cards lead, the rest folded.
      const first = name === "airwallex" ? '<ol class="awpath"' : name === "metal" ? '<section class="mt card"' : name === "visa" ? (vic3Run() ? 'class="sumc"' : 'class="card vicflow"') : 'class="flow card"';
      expect({ name, pictureFirst: whole.indexOf(first) >= 0 && whole.indexOf(first) < whole.indexOf("<details") }).toEqual({ name, pictureFirst: true });
      // /visa's folds each have their own anchor (the attempts, Airwallex's record, Visa's rules, card data, TAP).
      expect((whole.match(name === "visa" ? /<details class="fold" id="[\w-]+">/g : /<details class="fold">/g) ?? []).length).toBeGreaterThanOrEqual(2);
      // 12 Nov (wire-in): partner marks as images (docs/evidence/logo-permissions.md); Visa's only as its official file.
      expect(html.replace(/<img src="assets\/logo-visa\.png" alt="Visa" width="46" height="15">/g, "")).not.toMatch(/<img[^>]*visa/i);
      // No script, but /airwallex's one (src/redesign/ui.ts OPEN_TARGET_JS: a link into its cards' fold opens it; /visa's
      // too since the jury pass, 13 Nov: its cards link into the details fold) and
      // /metal's (src/redesign/metalMandates.ts METAL_INSPECT_JS: the spend read live from its own origin, 12 Nov).
      // Since 12 Nov the partner pages' figures count up once in view (src/redesign/stats.ts COUNT_JS; nothing moves with
      // reduced motion), so /airwallex, /metal and /visa add that script.
      expect(scriptBlocks(html)).toEqual(name === "airwallex" ? [`<script>\n${OPEN_TARGET_JS}${COUNT_JS}</script>`] : name === "metal" ? [`<script>\n${METAL_INSPECT_JS}${COUNT_JS}</script>`] : name === "visa" ? [`<script>\n${COUNT_JS}\n${OPEN_TARGET_JS}</script>`] : []);
      // Each page is labelled with the run it shows: the main run; on /visa that label sits inside the TAP fold, with
      // the main run's own TAP-signed card buy (the separate TAP run of 2 Nov is named there too, under its own label).
      // (/airwallex shows several runs, each dated on its own block: its label is true for all of them.)
      expect(html).toContain(name === "airwallex" ? AWX_PAGE_LABEL : run.label);
      if (name === "visa") expect(html).toContain(tapRun()!.label);
    }
  });

  it("keeps Try's demo world with its cost cap, without a live dispute, and no dots without a legend", () => {
    expect(pages.try).toContain("Raise the supplier price");
    expect(pages.try).not.toMatch(/Open a dispute/);
    expect(pages.try).not.toMatch(/class="examples"[^>]*>\s*<i/);
    expect(pages.try).not.toMatch(/"VISA"/);
  });

  it("carries a favicon and an Open Graph image on the redesign's pages, both served", () => {
    for (const name of ["home", "watch", "proof", "pricing", "security", "metal", "airwallex", "visa", "claude"]) {
      expect(PUBLIC[name]).toMatch(/<link rel="icon" href="assets\/favicon\.svg"/);
      // Absolute since 6 Nov (jury QA, Q5): a relative image was a 404 from /try/sign and not read by every link preview.
      expect(PUBLIC[name]).toMatch(/<meta property="og:image" content="https:\/\/kit11\.max-31b\.workers\.dev\/assets\/og\.png\?v=1113">/);
    }
    for (const a of ["favicon.svg", "og.png"]) expect(pageResponse(new Request(`https://x.test/assets/${a}`), pages as Pages)?.status).toBe(200);
  });
});

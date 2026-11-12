// The public site after Max's mega-prompt v4 (C1-C8, D2, D3): four tabs; short partner pages with the details folded;
// a text budget per page; no forbidden words on any public page; one Face ID number from one source; the split between
// Claude's decisions and code's routine payments, both counted from the record; the Claude call badge from each trace;
// every internal link answers (old addresses redirect, anything else gets the clean 404).
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { notFoundResponse, pageResponse, type Pages } from "../worker/src/core.js";
import { agentRun, callBadge, faceIdDecisions, highlights, loadRecord, payments, split, tapRun } from "../src/redesign/run.js";
import { OPEN_TARGET_JS } from "../src/redesign/ui.js";
import { tokenizeRun } from "../src/redesign/tokenizeRun.js";
import { scriptBlocks } from "./support/scriptBlocks.js";
import { SECOND_APPROVER, SPLIT_LINE, VISA_CLAIM, VISA_TAP_STATUS, WORLD_SETUP } from "../src/config/brand.js";

const pages = buildPages();
const run = agentRun();
const { record } = loadRecord();
/** The public pages a juror reaches: the four tabs, the four partner pages and the 404. */
const PUBLIC: Record<string, string> = { home: pages.home!, watch: pages.watch!, try: pages.try, proof: pages.proof!, metal: pages.metal, airwallex: pages.airwallex!, visa: pages.visa, claude: pages.claude!, notFound: pages.notFound! };

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
  it("keeps every page within its text budget (Home 195 with the three sentences and both awards; partner pages at most 150, /metal 180 with the explorer note and the mandates replaced after Face ID, /airwallex 365 with its read-back, awx-1, the Airi run and the second Airi run's heading, /visa 625 with the VIC heading and drawing on top, what ran, the two Airi runs, their folded lines and the TAP section last)", () => {
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
    const budget: Record<string, number> = { home: 254, watch: 125, try: 180, proof: 720 /* +5 for the honesty notes of the panel review, 10 Nov */, metal: tokenizeRun() ? 250 : 200, airwallex: 374 /* +5, panel review 10 Nov; +4, jury panel 12 Nov */, visa: 625 /* +5, panel review 10 Nov; +105 for the overview on top, its flow and three run cards (Max, 10 Nov: more Visa); +5 on 12 Nov for two folded lines under the Airi runs, "As reported by the Airwallex sandbox" and "The CFO's policy next to Visa's VIC rules" (14 words; 9 of them paid for by the TAP section's line that went; 614 as built); +10 on 12 Nov for a third folded line, "Card data: not a network-tokenised checkout, no PCI attestation" (9 words: what this checkout is not, readable without opening the fold; 623 as built) */, claude: 150, notFound: 40 };
    for (const [name, html] of Object.entries(PUBLIC)) expect({ name, over: visibleWords(html) > budget[name]! ? visibleWords(html) : 0 }).toEqual({ name, over: 0 });
  });

  it("shows no forbidden words on any page a visitor can reach (every page buildPages serves, the archive and the phone pages included)", () => {
    const bad = [/warehouse software/i, /stand-in/i, /\bdry-1\d*/i, /Dev test/i, /Recorded 30 October/i, /read, plan and advise/i, /\bfather\b/i, /four eyes.{0,80}\b(optional|off)\b/i, /\b(optional|off)\b.{0,80}four eyes/i, /\b0 unsafe\b/i, /confirmed (that )?TAP counts/i,
      // The old absolute claims (jury review, 4 Nov): the core sentence says who holds which limit instead.
      /every limit/i, /can['’]t break/i];
    // The phone's script, stylesheet and font are not pages (the phone pages themselves are checked).
    const all = Object.entries(pages as unknown as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !["client", "css", "font"].includes(e[0]));
    expect(all.map(([k]) => k)).toEqual(expect.arrayContaining(["dashboard", "month", "film", "try", "lab", "metal", "metalReport", "visa", "airwallex", "claude", "home", "watch", "proof", "notFound", "approve", "enrol", "policy"]));
    for (const [name, html] of all) for (const re of bad) expect({ name, found: re.exec(allText(html))?.[0] ?? null }).toEqual({ name, found: null });
  });

  it("has four tabs and nothing else in the menu, on every public page", () => {
    for (const [name, html] of Object.entries(PUBLIC)) {
      const nav = /<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
      expect({ name, tabs: [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]) }).toEqual({ name, tabs: ["Home", "Watch", "Try", "Proof"] });
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
        const path = new URL(href, "https://x.test/").pathname;
        seen.add(path);
        const res = pageResponse(new Request(`https://x.test${path}`), p);
        expect({ name, href, status: res?.status ?? 404 }).toEqual({ name, href, status: res && res.status === 302 ? 302 : 200 });
      }
    }
    for (const want of ["/home", "/watch", "/try", "/proof", "/metal", "/airwallex", "/visa", "/claude", "/lab", "/film", "/month", "/metal/report"]) expect(seen).toContain(want);
    for (const [from, to] of [["/live", "/watch"], ["/demo", "/watch"], ["/overview", "/home"]]) expect(pageResponse(new Request(`https://x.test${from}`), p)?.headers.get("location")).toBe(to);
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
    for (const [from, to] of [["/judge.", "/judge"], ["/try/sign,", "/try/sign"], ["/proof.", "/proof"], ["/watch.,", "/watch"], ["/,", "/"], ["/airwallex.?x=1", "/airwallex?x=1"]] as const) {
      const r = go(from);
      expect({ from, status: r?.status, to: r?.headers.get("location") }).toEqual({ from, status: 302, to });
    }
    // Only a trailing "." or ","; anything else is answered as before, and a POST is not redirected.
    expect(go("/proof")?.status).toBe(200);
    expect(go("/no/such/page")).toBeNull();
    expect(pageResponse(new Request("https://x.test/judge.", { method: "POST" }), p)).toBeNull();
  });

  it("reaches the archive (/lab, /film, /month, /metal/report) only through Proof's folded, labelled Archive", () => {
    const archive = /<div class="card" id="archive">[\s\S]*?<\/details>/.exec(pages.proof!)?.[0] ?? "";
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
      expect(pages.watch).toContain(callBadge(e.call!));
    }
  });

  it("keeps Watch on about a dozen highlights; the main run's licence was paid on its first attempt (no earlier attempt to label)", () => {
    const h = highlights(run);
    expect(h.length).toBeGreaterThanOrEqual(10);
    expect(h.length).toBeLessThanOrEqual(15);
    expect(h.some((e) => e.k === "money" && (e.refused?.code === "fee_unknown" || e.earlier))).toBe(false);
    expect(run.events.some((e) => e.k === "money" && e.earlier)).toBe(false);
    expect(pages.watch).toContain(`Full run (${run.events.length} steps)`);
    expect(pages.watch).toContain(WORLD_SETUP);
  });

  it("shows one Face ID number from one source, and the split between Claude and code (D3)", () => {
    const n = faceIdDecisions(record);
    expect(n).toBe(record.proof.face_id);
    const sp = split(record);
    expect(sp.fallbacks).toBe(0);
    expect(sp.byClaude).toBe(sp.decisions);
    const proof = pages.proof!;
    expect(proof).toContain(SPLIT_LINE);
    expect(proof).toContain(`<span class="v">${sp.byClaude}</span><span class="l">decisions by Claude (${sp.fallbacks} fallbacks)</span>`);
    // One canonical set (jury review, 6 Nov, #5): the Metal payments and the card charge, not "82 routine by code".
    const pay = payments(record);
    expect(proof).toContain(`<span class="v">${pay.onChain}</span><span class="l">Metal payments + 1 card charge</span>`);
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
    expect((proof.match(/<article class="pcard card"/g) ?? []).length).toBe(3);
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
      const picture = name === "visa" ? 'class="card vicflow"' : 'class="flow card';
      expect({ name, pictureFirst: whole.indexOf(picture) >= 0 && whole.indexOf(picture) < whole.indexOf("<details") }).toEqual({ name, pictureFirst: true });
      // /visa's folds each have their own anchor (the attempts, Airwallex's record, Visa's rules, card data, TAP).
      expect((whole.match(name === "visa" ? /<details class="fold" id="[\w-]+">/g : /<details class="fold">/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(html).not.toMatch(/<img[^>]*visa/i);
      // No script, but /airwallex's one (src/redesign/ui.ts OPEN_TARGET_JS: a link into its cards' fold opens it).
      expect(scriptBlocks(html)).toEqual(name === "airwallex" ? [`<script>\n${OPEN_TARGET_JS}</script>`] : []);
      // Each page is labelled with the run it shows: the main run; on /visa that label sits inside the TAP fold, with
      // the main run's own TAP-signed card buy (the separate TAP run of 2 Nov is named there too, under its own label).
      expect(html).toContain(run.label);
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
    for (const name of ["home", "watch", "proof", "metal", "airwallex", "visa", "claude"]) {
      expect(PUBLIC[name]).toMatch(/<link rel="icon" href="assets\/favicon\.svg"/);
      // Absolute since 6 Nov (jury QA, Q5): a relative image was a 404 from /try/sign and not read by every link preview.
      expect(PUBLIC[name]).toMatch(/<meta property="og:image" content="https:\/\/kit11\.max-31b\.workers\.dev\/assets\/og\.png">/);
    }
    for (const a of ["favicon.svg", "og.png"]) expect(pageResponse(new Request(`https://x.test/assets/${a}`), pages as Pages)?.status).toBe(200);
  });
});

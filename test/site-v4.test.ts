// The public site after Max's mega-prompt v4 (C1-C8, D2, D3): four tabs; short partner pages with the details folded;
// a text budget per page; no forbidden words on any public page; one Face ID number from one source; the split between
// Claude's decisions and code's routine payments, both counted from the record; the Claude call badge from each trace;
// every internal link answers (old addresses redirect, anything else gets the clean 404).
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { notFoundResponse, pageResponse, type Pages } from "../worker/src/core.js";
import { agentRun, callBadge, faceIdDecisions, highlights, loadRecord, split, tapRun } from "../src/redesign/run.js";
import { SECOND_APPROVER, SPLIT_LINE, VISA_AWARD_STATUS, VISA_CLAIM, WORLD_SETUP } from "../src/config/brand.js";

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
  it("keeps every page within its text budget (Home about 60 words plus the Visa Award status; partner pages at most 150)", () => {
    // Proof: 480 since 4 Nov, for the TAP run's decline on its own line below the stop figure (Max).
    const budget: Record<string, number> = { home: 520, watch: 100, try: 180, proof: 480, metal: 150, airwallex: 150, visa: 150, claude: 150, notFound: 40 };
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
    expect(proof).toContain(`<span class="v">${sp.routine}</span><span class="l">routine payments by code</span>`);
    // Every "N Face ID" on the public pages is the same N.
    for (const [name, html] of Object.entries(PUBLIC)) for (const m of allText(html).matchAll(/(\d+)\s+Face ID decisions/g)) expect({ name, n: Number(m[1]) }).toEqual({ name, n });
    // Routine payments by code, counted again: per-query buying and selling, not refused.
    const routine = record.snapshot.flows.filter((f) => !f.refused && (f.kind === "sale" || (f.kind === "upstream" && f.decided.startsWith("code")))).reduce((k, f) => k + (f.count ?? 1), 0);
    expect(sp.routine).toBe(routine);
  });

  it("gives Proof four partner cards (Visa TAP as text) and says the fixed lines word for word", () => {
    const proof = pages.proof!;
    expect((proof.match(/<article class="pcard card"/g) ?? []).length).toBe(4);
    expect(proof).toMatch(/<span class="logo txt">Visa TAP<\/span>/);
    // The Visa paragraph is said once, on /visa (jury review, 4 Nov); the award status too (final review, 4 Nov): Proof
    // links to /visa for it.
    expect(proof).not.toContain(VISA_CLAIM);
    expect(proof).not.toContain(VISA_AWARD_STATUS);
    expect(proof).toMatch(/<a [^>]*href="visa"[^>]*>[^<]*Visa Award[^<]*<\/a>/);
    expect(proof).toContain(SECOND_APPROVER);
    expect(pages.visa).toContain(VISA_CLAIM);
    expect(pages.visa).toContain(VISA_AWARD_STATUS);
  });

  it("makes the partner pages picture first, numbers next, details folded, and no Visa logo", () => {
    for (const name of ["metal", "airwallex", "visa", "claude"] as const) {
      const html = PUBLIC[name]!;
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      expect(main.indexOf('class="flow card"')).toBeLessThan(main.indexOf("<details"));
      expect((main.match(/<details class="fold">/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(html).not.toMatch(/<img[^>]*visa/i);
      expect(html).not.toMatch(/<script/);
      // Each page is labelled with the run it shows: the main run, which on /visa has its own TAP-signed card buy
      // (the separate TAP run of 2 Nov is named inside, under its own label).
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
      expect(PUBLIC[name]).toMatch(/<meta property="og:image" content="assets\/og\.png">/);
    }
    for (const a of ["favicon.svg", "og.png"]) expect(pageResponse(new Request(`https://x.test/assets/${a}`), pages as Pages)?.status).toBe(200);
  });
});

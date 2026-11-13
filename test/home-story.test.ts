// Home (the enterprise pass of 12 Nov, after the owner's "make it an enterprise-grade homepage"): the headline, one
// sentence, two buttons with one reassurance line and the partners' logos; the product card (one payment from a /try
// run, every value read from its record) with ONE note line and the "What's real?" link; four features; the five steps
// (who decides, who enforces); one stat row, every figure from a run record; the last buttons. The honesty rules of the
// jury panel (A1 to A10) still hold: no recorded run called live, simulated and test money said once each outside the
// fold, one note line, every figure from a record, every amount with its currency, no fetch, no award wording.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAVEAT_LINE, CHAIN_TEST, DESIGN_PARTNER_LABEL, HERO, SECOND_APPROVER, SMALL_COMPANY_DEMO_URL } from "../src/config/brand.js";
import { FLOW, FLOW_NOTE, TRY_SAMPLE_RECORD } from "../src/redesign/heroFlow.js";
import { scaleStats } from "../src/redesign/scale.js";
import { HOME_SUB, LOCKS_HEAD, NEXT_NEXT, PROOF_BUTTON, REASSURE, START, TRY_BUTTON, STAT_RECORDS, WHATS_REAL, homePage, homeStats, proofRows } from "../src/redesign/home.js";
import { agentRun } from "../src/redesign/run.js";
import { TRY_URL } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { VIC3_RUN_FILE } from "../src/redesign/vic3Run.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (s: string) => s.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!);
const text = (html: string) => decode(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
/** The page without the "What's real?" fold, scripts and styles: what is in sight or said aloud. */
const outsideFold = (html: string) => withoutBlocks(html.replace(/<details class="real"[\s\S]*?<\/details>/, " "), ["script", "style"], " ");
function visibleWords(html: string): number {
  let main = mainOf(html);
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  const t = withoutBlocks(main, ["script", "style"], " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const AWX = JSON.parse(read("docs/demo/airwallex-run.json")) as {
  cards: { agent: string; read_back: { per_tx: string } }[];
  card_transactions: { id: string; agent: string; amount: string; currency: string; approved: boolean; decline_code: string | null }[];
  note: string;
};
const SAMPLE = JSON.parse(read(TRY_SAMPLE_RECORD)) as { mode: { reader: string; bank: string; money: string }; invoice: { supplier: string; number: string; currency: string; total: string; due: string; account_ending: string }; signed: { terms_hash_prefix: string }; booked: { account: string; debit: string | null; credit: string | null }[] };

describe("Home, the enterprise pass", () => {
  it("runs in this order: headline, sentence, two buttons, reassurance, logos, the product card and its note, features, the five steps, the stats, the last buttons", () => {
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      const at = [
        '<h1 class="h-hero">', `<p class="what">${HOME_SUB}</p>`, '<a class="btn primary big start" href="tour">', html === ON ? '<a class="btn big ghost" href="/try/sign">' : `<a class="btn big ghost" href="${TRY_URL}">`, '<p class="reassure">', '<div class="trust">',
        '<figure class="hf"', '<p class="hf-note">', '<ul class="feat">', '<ol class="flow', '<ul class="stats">', '<a class="btn big primary" href="proof">',
      ].map((s) => ({ s, i: main.indexOf(s) }));
      expect(at.filter((x) => x.i < 0)).toEqual([]);
      expect(at.map((x) => x.i)).toEqual([...at.map((x) => x.i)].sort((a, b) => a - b));
      expect(text(/<h1[\s\S]*?<\/h1>/.exec(main)![0])).toBe(HERO);
      expect(main.match(/<section\b[^>]*>/g)).toEqual(['<section class="e-hero">', '<section class="e-feat" aria-labelledby="h-feat">', '<section class="e-flow" aria-labelledby="about">', '<section class="e-stats" aria-labelledby="h-locks">']);
    }
  });

  // Owner, 13 Nov: a visitor who is not technical understood the idea but did not know where to look, so the hero's one
  // primary button is the 3-minute tour, and "Try it" (the hands-on demo) is the second.
  it("has two buttons in the hero (the 3-minute tour, primary; Try it, to the hands-on demo), and the proof button with Books at the end", () => {
    const buttons = (html: string) => [...mainOf(html).matchAll(/<a class="btn[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2]!)]);
    expect([START, TRY_BUTTON, PROOF_BUTTON]).toEqual(["Take the 3-minute tour", "Try it", "See the proof"]);
    // Judges, 13 Nov (#7): "Try it" opens the one hero demo, /try/sign ("Sign in 60 seconds"), where the bundle serves it.
    expect(buttons(ON)).toEqual([["tour", START], ["/try/sign", TRY_BUTTON], ["proof", PROOF_BUTTON], ["books", "Books"]]);
    expect(buttons(OFF)).toEqual([["tour", START], [TRY_URL, TRY_BUTTON], ["proof", PROOF_BUTTON], ["books", "Books"]]);
    for (const html of [ON, OFF]) expect(mainOf(html).match(/class="btn primary/g)).toHaveLength(1);
    expect(OFF).not.toContain('href="try/sign"');
    expect(mainOf(buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!)).toBe(mainOf(ON));
    expect(buildPages({} as NodeJS.ProcessEnv).home).toBe(OFF);
    // The hero's button and "Product tour" under More (Max, 13 Nov); none in the footer.
    for (const html of [ON, OFF]) expect(html.match(/href="tour"/g)).toHaveLength(2);
    for (const html of [ON, OFF]) expect(/<footer[\s\S]*<\/footer>/.exec(html)![0]).not.toContain('href="tour"');
    for (const html of [ON, OFF]) expect(html).not.toMatch(/href="\/?judge"/);
  });

  it("A6: one reassurance line under the buttons, saying only what the pages behind them are", () => {
    // With /try/sign, "Try it" is the 60-second test world; without, the hands-on demo's test company.
    expect(REASSURE).toEqual({ sign: "No sign-up, about a minute; nothing real moves.", world: "No sign-up; test companies deleted after 24 hours." });
    for (const html of [ON, OFF]) expect(mainOf(html).match(/<p class="reassure">/g)).toHaveLength(1);
    expect(ON).toMatch(new RegExp(`${TRY_BUTTON}</a></div>\\s*<p class="reassure">${REASSURE.sign}</p>`));
  });

  it("A1: no heading says live; outside the fold, live is said only by the button to the hands-on demo, which runs live", () => {
    for (const html of [ON, OFF]) {
      for (const h of html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)) expect(text(h[1]!)).not.toMatch(/live/i);
      expect(text(outsideFold(html)).replace(START, " ")).not.toMatch(/\blive\b/i);
      expect(html).not.toMatch(/live run|Replay of/i);
    }
  });

  it("A3: outside the What's real? fold, simulated and test money are each said once; the run caveat is in the fold", () => {
    for (const html of [ON, OFF]) {
      const t = outsideFold(html);
      expect(t.match(/simulated/gi)).toHaveLength(1);
      expect(t.match(/test money/gi)).toHaveLength(1);
      expect(text(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0])).toContain(CAVEAT_LINE);
    }
  });

  it("A4: one note line with the What's real? link; the only date in sight is the sample invoice's own due date", () => {
    expect(FLOW_NOTE).toBe("One /try run, a test company's sample invoice, test money.");
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      expect(main.match(/<p class="hf-note">/g)).toHaveLength(1);
      expect(text(/<p class="hf-note">[\s\S]*?<\/p>/.exec(main)![0])).toBe(`${FLOW_NOTE} ${WHATS_REAL}`);
      expect(main).toContain(`<a href="#real" data-real>${WHATS_REAL}</a>`);
      // Above the stat row the only date is the card's due date; from there on each figure names its run's day (jury,
      // 13 Nov: which run a figure comes from), the Face ID tile its run on Metal testnet and the footer the Visa run.
      const DATE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g;
      const out = outsideFold(html), at = out.indexOf('<article class="e-statrec"');
      expect(text(out.slice(0, at)).match(DATE)).toEqual([SAMPLE.invoice.due]);
      const owners = JSON.parse(read("docs/runs/2026-11-12-faceid-onchain.json")) as { ran_at: string };
      const vic3 = JSON.parse(read(VIC3_RUN_FILE)) as { started_at: string };
      const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
      // The main run's line (review, 13 Nov) names its day, as its record does ("the main run, 3 Nov").
      const mainDay = /\d{1,2} [A-Z][a-z]{2}/.exec(agentRun().record.run)![0];
      expect(text(out.slice(at)).match(DATE)).toEqual([`${day(owners.ran_at)}`, mainDay, day(vic3.started_at)]);
    }
    expect(ON).toContain('document.querySelectorAll("[data-real]")');
  });

  it("the product card shows one /try run as its record holds it, names it, and says Claude read that run's invoice", () => {
    expect([SAMPLE.mode.reader, SAMPLE.mode.bank, SAMPLE.mode.money]).toEqual(["claude", "simulated", "test"]);
    const money = (a: string) => `${SAMPLE.invoice.currency} ${Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    expect(FLOW.supplier).toBe(SAMPLE.invoice.supplier);
    expect(FLOW.amount).toBe(money(SAMPLE.invoice.total));
    for (const html of [ON, OFF]) {
      const card = /<figure class="hf"[\s\S]*?<\/figure>/.exec(mainOf(html))![0];
      expect(card).toContain(`data-rec="${TRY_SAMPLE_RECORD}"`);
      const t = text(card);
      for (const v of [SAMPLE.invoice.supplier, `Invoice ${SAMPLE.invoice.number}`, money(SAMPLE.invoice.total), SAMPLE.invoice.due, `…${SAMPLE.invoice.account_ending}`, `${SAMPLE.signed.terms_hash_prefix}…`, ...SAMPLE.booked.map((b) => `${b.account}`), ...SAMPLE.booked.map((b) => money((b.debit ?? b.credit)!))]) expect({ v, found: t.includes(v) }).toEqual({ v, found: true });
      // Claude read this run's invoice, and the chip says so only because the record does; code holds the limits.
      expect(t).toContain("Claude reader");
      expect(t).toContain("Purser's code holds the limits");
      expect(text(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0])).toContain("Claude Haiku 5.5 read that invoice");
    }
  });

  it("A5: the stat row, every figure from its run record, the records named on the block", () => {
    const run = agentRun(), rows = proofRows();
    expect(rows.map((r) => [r.partner, r.title, r.text])).toEqual([
      ["Airwallex", "Airwallex declined the card", "EUR 45.00 over a 30.00 limit."],
      ["Metal", "Metal refused it on chain", "Over its cap."],
      ["Visa", "Visa: hash read back", "Equal at Airi and Airwallex."],
    ]);
    // The rows' figures stay held to their records (Airwallex's decline over its card's limit, the Visa read-backs).
    const decline = AWX.card_transactions.find((t) => !t.approved && t.decline_code === "LIMIT_EXCEEDED")!;
    expect(rows[0]!.text).toBe(`${decline.currency} ${decline.amount} over a ${AWX.cards.find((c) => c.agent === decline.agent)!.read_back.per_tx} limit.`);
    const vic3 = JSON.parse(read("docs/runs/2026-11-12-vic-3.json")) as { purchases: { step: string; read_back: { mandate: { equal: boolean } | null; payment_intent: { equal: boolean } | null } }[] };
    const b = vic3.purchases.find((p) => p.step === "B")!;
    expect([b.read_back.mandate?.equal, b.read_back.payment_intent?.equal]).toEqual([true, true]);
    // First: Face ID verified on chain (the passkey account's record), its strongest number the limit changes the account
    // ran, each only after every passkey signed; its co-signer labelled a test key (the owner, 13 Nov).
    const owners = JSON.parse(read("docs/runs/2026-11-12-faceid-onchain.json")) as { ran_at: string; threshold: number; owners: { virtual: boolean }[]; proposals: { what: string; status: string }[] };
    expect(owners.owners.some((o) => o.virtual)).toBe(true);
    const changes = owners.proposals.filter((p) => ["bind", "replace", "revoke"].includes(p.what) && p.status === "EXECUTED").length;
    expect(homeStats(run).map((s) => [s.n, s.label])).toEqual([[changes, `limit changes, passkeys (P-256) verified on chain (Metal testnet, ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(owners.ran_at))}): ${owners.threshold} of ${owners.owners.length}, co-signer a test key`]]);
    expect(homeStats(run, [], null)).toEqual([]);
    // Then the scale band (src/redesign/scale.ts), every figure computed from the records, each a link to its source.
    const band = /<ul class="scale"[\s\S]*?<\/ul>/.exec(mainOf(ON))?.[0] ?? "";
    expect(band).not.toBe("");
    expect(mainOf(ON).indexOf('<article class="e-statrec"')).toBeLessThan(mainOf(ON).indexOf('<ul class="scale"'));
    expect([...band.matchAll(/data-count="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(scaleStats().map((x) => x.n));
    for (const html of [ON, OFF]) expect(mainOf(html)).toContain(`<article class="e-statrec" data-rec="${STAT_RECORDS}">`);
    expect(proofRows(undefined, null, null).map((r) => r.partner)).toEqual(["Metal"]);
    expect(text(/<h2[^>]*id="h-locks"[^>]*>[\s\S]*?<\/h2>/.exec(ON)![0])).toBe(LOCKS_HEAD);
  });

  it("A7: the product card is the one animation, and nothing on Home reaches the network", () => {
    for (const html of [ON, OFF]) {
      expect(mainOf(html).match(/<figure\b/g)).toHaveLength(1);
      const script = scriptBlocks(html).map(scriptBody).join("\n");
      expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    }
    for (const env of [{ TRY_SIGN_ENABLED: "on" }, {}]) expect(buildPages(env as NodeJS.ProcessEnv).csp.home).toContain("connect-src 'none'");
  });

  it("A10: the headline is two sentences on two lines, every amount has its currency, and no award wording", () => {
    for (const html of [ON, OFF]) {
      expect(html).toContain('<h1 class="h-hero"><span>AI agents spend.</span> <span>You sign off.</span></h1>');
      const t = text(outsideFold(mainOf(html)));
      const amounts = [...t.matchAll(/(\S+)\s+(\d[\d,]*\.\d{2})\b/g)];
      expect(amounts.length).toBeGreaterThanOrEqual(3);
      for (const m of amounts) expect({ amount: m[2], unit: m[1] }).toEqual({ amount: m[2], unit: "EUR" });
      expect(html).not.toMatch(/Kit 11|x402 Business Agents|Competing for|Metal Award|Visa Award/);
    }
  });

  it("names no TAP, no Watch block, no awards on Home", () => {
    for (const html of [ON, OFF]) {
      const rest = html.replace(/<header class="top">[\s\S]*?<\/header>/, " ");
      expect(rest).not.toMatch(/\bWatch\b|href="watch"/);
      expect(rest).not.toMatch(/TAP\b|Visa TAP|single-use Visa/);
      expect(html).not.toMatch(/Extra, not an award entry|What comes next/);
    }
  });

  it("keeps the full list in the What's real? fold: the hero's run, the Airwallex run's note, the Metal test, the second approver", () => {
    const fold = text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0]);
    for (const line of [SECOND_APPROVER, CHAIN_TEST, AWX.note, "one /try run of its sample invoice on"]) expect({ line, found: fold.includes(line) }).toEqual({ line, found: true });
  });

  it("shows the line for small companies only when its demo has an address, and the design-partner link only when set", () => {
    expect(SMALL_COMPANY_DEMO_URL).toBe("");
    expect(NEXT_NEXT).toMatch(/^Next, not live yet:/);
    for (const html of [ON, OFF]) { expect(html).not.toContain(NEXT_NEXT); expect(html).not.toContain('class="next"'); expect(html).not.toContain(DESIGN_PARTNER_LABEL); }
    const url = "https://small.example.test/demo";
    const shown = homePage(undefined, { trySign: true, smallCompanyUrl: url });
    expect(mainOf(shown)).toContain(`<p class="next">${NEXT_NEXT} <a href="${url}" target="_blank" rel="noopener">Open its demo\u00a0↗</a></p>`);
    expect(mainOf(shown).indexOf('class="next"')).toBeGreaterThan(mainOf(shown).indexOf('<a class="btn big primary" href="proof">'));
    for (const bad of ["javascript:alert(1)", "http://plain.example.test", 'https://x.test/"><script>']) expect(homePage(undefined, { smallCompanyUrl: bad })).not.toContain('class="next"');
  });

  // The enterprise pass (owner, 12 Nov) adds four features and a stat row: the budget is 300 visible words. 345 since the
  // review of 13 Nov: the main run's line (its company, agents, figures and the film; 32 words) and which agents the
  // flow shows (9 words); 341 as built.
  it("A11: stays within 345 visible words", () => {
    expect(visibleWords(ON)).toBeLessThanOrEqual(345);
    expect(visibleWords(OFF)).toBeLessThanOrEqual(345);
  });
});

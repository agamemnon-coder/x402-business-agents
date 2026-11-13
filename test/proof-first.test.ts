// /proof puts the strongest proof first (Max's last round, item 2): each partner card opens with its strongest claim,
// one link from its proof, and every number in it read from its record, never typed in (as
// test/proof-sentences.test.ts does for PROOF_SENTENCES). TAP stays on /visa only
// (12 Nov, jury panel: the footer link went from Proof and Home; Visa is a section of its own, /judge links the Visa run).
// Since the jury of 12 Nov the page opens with "What Purser guarantees", then the partners (one claim each in sight),
// then the main run's numbers (four tiles, one of them Airwallex's, the stops with their breakdown), then the folds,
// and the utility links last: the last describe blocks hold that order, the tiles, the folds, the anchors and the words.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACK_LINK, PACK_NAME } from "../src/accounting/monthPack.js";
import { CFO_VIEW_LINK, CFO_VIEW_URL, FILM_LINK, FILM_URL, PROOF_SENTENCES, SPLIT_LINE } from "../src/config/brand.js";
import { AWX_CONTROLS_ID, AWX_HASH_ID, awxCardId, cardControlRows, cardsReadback, hashTravel, transferReadback } from "../src/redesign/airwallexProof.js";
import { GUARANTEES_ID, guaranteesHtml } from "../src/redesign/guarantees.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { proofLeads, reliabilityFix, RELIABILITY_CASE } from "../src/redesign/proofLead.js";
import { partnerCards, proofPage, stopBreakdown } from "../src/redesign/proof.js";
import { agentRun, faceIdDecisions, loadRecord, split, stopFigure, stopStory } from "../src/redesign/run.js";
import { TRACE_LINK, TRACE_URL } from "../src/redesign/trace.js";
import { VIC2_RUN_ID } from "../src/redesign/vic2Run.js";
import { buildPages } from "../src/relay/assets.js";
import { OG_TITLE } from "../src/ui/meta.js";
import { visibleWords } from "./support/visibleWords.js";
import { scriptBlocks, scriptBody, textOutsideTags, withoutBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { record } = loadRecord();
const leads = proofLeads(record);
const sentence = (partner: string) => PROOF_SENTENCES.find((p) => p.partner === partner)!.text;
const decode = (s: string) => s.split("&#39;").join("'").split("&quot;").join('"').split("&gt;").join(">").split("&lt;").join("<").split("&amp;").join("&");
const html = proofPage();

/** One partner card of /proof, found by position: from its <article …id="…"> to its </article>. */
function cardOf(page: string, id: string): string {
  const a = page.indexOf(`<article class="pcard card" id="${id}">`);
  expect({ id, found: a >= 0 }).toEqual({ id, found: true });
  return page.slice(a, page.indexOf("</article>", a) + "</article>".length);
}
/** What follows a card's header row (logo, name, More): the first thing a reader sees in it. */
const afterHeader = (card: string) => card.slice(card.indexOf("</div>") + "</div>".length);
/** Visible words: markup tags dropped by position, so no HTML-filtering pattern is needed. */
function words(page: string): string {
  let out = "", depth = 0;
  for (const ch of page) { if (ch === "<") depth++; else if (ch === ">" && depth) { depth--; out += " "; } else if (!depth) out += ch; }
  return decode(out).replace(/\s+/g, " ");
}
/** The page without its <script> and <style> blocks, cut out by position (test/support/scriptBlocks.ts's way). */
function dropBlocks(page: string): string {
  let out = page;
  for (const tag of ["script", "style"]) {
    for (;;) {
      const low = out.toLowerCase(), a = low.indexOf(`<${tag}`);
      if (a < 0) break;
      const b = low.indexOf(`</${tag}`, a), end = b < 0 ? out.length : low.indexOf(">", b) + 1 || out.length;
      out = out.slice(0, a) + out.slice(end);
    }
  }
  return out;
}

describe("/proof's Airwallex card opens with the hash and the cards, each linked to its anchor on /airwallex", () => {
  it("says the signed hash is in Airwallex's own record of the SWIFT payment, from the two records", () => {
    const h = hashTravel(record)!;
    expect([h.match, h.transferMethod]).toEqual([true, "SWIFT"]);
    expect(leads.airwallex[0]).toMatchObject({ text: `The hash the CFO signed is in Airwallex's own record of the ${h.transferMethod} payment`, href: `airwallex#${AWX_HASH_ID}` });
    expect(leads.airwallex[0]!.text).toBe("The hash the CFO signed is in Airwallex's own record of the SWIFT payment");
  });

  it("says 3 of 3 cards carry the CFO's policy, counted from the card read-back, with each card's own anchor", () => {
    const rows = cardControlRows(record);
    const n = rows.filter((r) => r.match).length;
    expect([n, rows.length]).toEqual([3, 3]);
    expect(leads.airwallex[1]).toMatchObject({ text: `${n} of ${rows.length} cards carry the CFO's policy`, href: `airwallex#${AWX_CONTROLS_ID}` });
    expect(leads.airwallex[1]!.text).toBe("3 of 3 cards carry the CFO's policy");
    expect(leads.airwallex[1]!.links!.map((l) => l.href)).toEqual(rows.map((r) => `airwallex#${awxCardId(r.agent)}`));
    expect(leads.airwallex[1]!.links!.map((l) => l.label)).toEqual(rows.map((r) => `${r.name.replace(/ agent$/, "")} ····${r.last4}`));
  });

  it("drops a claim its record does not carry: no hash claim when Airwallex returns another hash", () => {
    const rb = transferReadback()!;
    const other = { ...rb, rec: { ...rb.rec, transfer: { ...rb.rec.transfer, metadata: { approval_sha256: "0".repeat(64) } } } };
    expect(hashTravel(record, other)!.match).toBe(false);
    expect(proofLeads(record, { transfer: other }).airwallex.map((l) => l.href)).toEqual([`airwallex#${AWX_CONTROLS_ID}`]);
    // A card that differs is counted as such, never as matching.
    const cards = cardsReadback()!;
    const off = { ...cards, rec: { ...cards.rec, cards: cards.rec.cards.map((c, i) => (i ? c : { ...c, controls: { ...c.controls, allowed_currencies: ["USD"] } })) } };
    expect(proofLeads(record, { cards: off }).airwallex[1]!.text).toBe("2 of 3 cards carry the CFO's policy");
  });

  it("links each claim to an anchor that exists on /airwallex", () => {
    const awx = buildPages().airwallex!;
    for (const id of [AWX_HASH_ID, AWX_CONTROLS_ID, ...cardControlRows(record).map((r) => awxCardId(r.agent))]) expect({ id, on: awx.includes(` id="${id}"`) }).toEqual({ id, on: true });
  });
});

describe("/proof's Metal card opens with #24 refused on chain and the 86 payments", () => {
  it("reads both from the main run's record, each linked to Metal's testnet explorer", () => {
    const m = metalStory(record);
    expect(leads.metal.map((l) => l.text)).toEqual([`#${m.refusal!.seq} refused on chain`, `${m.payments.total} payments, each its own tx`]);
    expect(leads.metal.map((l) => l.text)).toEqual(["#24 refused on chain", "86 payments, each its own tx"]);
    expect(leads.metal.map((l) => l.href)).toEqual([m.refusal!.proof.href, m.payments.account.href]);
    for (const l of leads.metal) expect(l.href).toMatch(/^https:\/\/testnet\.metalntwx\.com\/(tx\/0x[0-9a-f]{64}|address\/0x[0-9a-fA-F]{40})$/);
  });
});

describe("/proof's Claude card opens with 24/24 and the reliability fix", () => {
  it("24/24, 0 fallbacks, from the main run's agent_stats", () => {
    const sp = split(record);
    const stats = record.snapshot.agent_stats;
    expect([sp.byClaude, sp.decisions, sp.fallbacks]).toEqual([stats.reduce((n, a) => n + a.by_claude, 0), stats.reduce((n, a) => n + a.decisions, 0), stats.reduce((n, a) => n + a.fallback, 0)]);
    expect(leads.claude[0]!.text).toBe(`${sp.byClaude}/${sp.decisions}, ${sp.fallbacks} fallbacks`);
    expect(leads.claude[0]!.text).toBe("24/24, 0 fallbacks");
  });

  it("6/10 → 10/10 is the eval rebuilt from rel-1's moment, before and after the fix; rel-1b then passed every step", () => {
    const rf = reliabilityFix()!;
    expect(RELIABILITY_CASE).toBe("treasury-card-raise");
    // Before: the reliability log's eval table; after: the eval record itself; the fix's commit in both.
    const log = read("docs/runs/reliability-2026-11.md");
    const row = log.split("\n").find((l) => l.startsWith(`| \`${RELIABILITY_CASE}\` |`))!;
    expect(row).toContain(`${rf.before.passed}/${rf.before.runs} before the fix.`);
    const evals = JSON.parse(read("docs/evals/agents.json")) as { rows: { case: string; passed: number; runs: number; commit: string }[] };
    const after = evals.rows.find((r) => r.case === RELIABILITY_CASE)!;
    expect([rf.after.passed, rf.after.runs]).toEqual([after.passed, after.runs]);
    expect(after.commit.startsWith(rf.commit)).toBe(true);
    expect(log).toContain(`The fix** is commit ${rf.commit}`);
    const rel = JSON.parse(read("docs/demo/reliability.json")) as { run: string; passed: boolean }[];
    expect(rel.find((r) => r.run === rf.run)!.passed).toBe(false);
    expect(rel.find((r) => r.run === rf.next)!.passed).toBe(true);
    expect(rf).toMatchObject({ run: "rel-1", next: "rel-1b", commit: "856cb64", before: { passed: 6, runs: 10 }, after: { passed: 10, runs: 10 } });
    // Max's line, word for word, with the numbers from the records; the exact reading in a note under it.
    expect(leads.claude[1]!.text).toBe(`a reliability run found a hand-off fault; fixed: ${rf.before.passed}/${rf.before.runs} → ${rf.after.passed}/${rf.after.runs}`);
    expect(leads.claude[1]!.text).toBe("a reliability run found a hand-off fault; fixed: 6/10 → 10/10");
    // Jargon out (10 Nov): the runs by what they are, not their working names.
    expect(leads.claude[1]!.note).toBe("6/10 → 10/10: the eval rebuilt from the reliability run's moment, before and after the fix (commit 856cb64); the next reliability run passed every step.");
    expect(leads.claude[1]!.href).toBe("https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/reliability-2026-11.md");
  });
});

describe("the claims say what PROOF_SENTENCES says (src/config/brand.ts)", () => {
  it("each short claim is the matching sentence's fact, in fewer words", () => {
    const awx = sentence("Airwallex"), metal = sentence("Metal"), claude = sentence("Claude");
    expect(awx).toContain("the hash of the exact terms the CFO signed with Face ID is in Airwallex's own record of the EUR 240.00 SWIFT payment");
    expect(awx).toContain(`${leads.airwallex[1]!.text.split(" cards")[0]} agent cards carry the CFO's policy`);
    expect(metal).toContain(`purchase ${leads.metal[0]!.text}`);
    expect(metal).toContain(`${leads.metal[1]!.text.replace(/ tx$/, " transaction")}`);
    const sp = split(record), rf = reliabilityFix()!;
    // Since 13 Nov (judge run): no pass-rate fraction in the words; "all" and "every run" only where the record says so.
    expect(sp.byClaude).toBe(sp.decisions);
    expect(rf.after.passed).toBe(rf.after.runs);
    expect(claude).toContain(`all ${sp.decisions} decisions in the main run by Claude, ${sp.fallbacks} fallbacks`);
    expect(claude).toContain(`a reliability run (${rf.run}) found a fault in how the agents hand off a card raise`);
    expect(claude).toContain(`now passes every run, and the next run (${rf.next}) passed every step`);
  });
});

describe("/proof as served: each card shows its strongest claim as its one link in sight, the rest in its fold (jury, 12 Nov)", () => {
  for (const [id, name] of [["airwallex", "Airwallex"], ["metal", "Metal"], ["claude", "Claude"]] as const) {
    it(`${id}: the name, then the partner's first lead (text and href); the 2–3 facts, the other claims in order, the sentence and the list in the fold`, () => {
      const card = cardOf(html, id), first = afterHeader(card), lead0 = leads[id][0]!, out = lead0.href.startsWith("https://");
      // The name as text, never a logo; then the first lead of proofLeads(record) as the card's main link, and nothing
      // else in sight: no other link above the fold.
      // 12 Nov (owner): each card's partner mark beside its name (alt empty: the name is the heading).
      expect(card).toMatch(new RegExp(`^<article class="pcard card" id="${id}"><div class="ph">(<span class="logo( dark)?"><img src="assets/logo-${id}\\.(png|svg)" alt="" width="\\d+" height="15"></span>)?<h3>${name}</h3></div>`));
      const sight = first.slice(0, first.indexOf('<details class="fold">'));
      expect(decode(sight)).toBe(`<ul class="lead"><li><a class="c" href="${lead0.href}"${out ? ' target="_blank" rel="noopener"' : ""}>${lead0.text}${out ? " ↗" : ""}</a></li></ul>`);
      expect(card.replace(/<span class="logo( dark)?"><img [^>]*><\/span>/, "")).not.toMatch(/<img /);
      // The fold, closed: the facts first, each a bold number and plain words.
      const fold = card.slice(card.indexOf('<details class="fold">'));
      expect(fold.startsWith('<details class="fold"><summary>Show the live proof</summary><div class="facts">')).toBe(true);
      const facts = [...fold.slice(0, fold.indexOf("</div>")).matchAll(/<span class="fact"><b>([^<]+)<\/b> ([^<]+)<\/span>/g)];
      expect(facts.length).toBeGreaterThanOrEqual(2);
      expect(facts.length).toBeLessThanOrEqual(3);
      for (const f of facts) expect({ id, fact: f[0], plain: /^[\d][\d ,.ofx/]*$/.test(f[1]!) && !/[()]|four eyes|rel-\d|eval/i.test(f[2]!) }).toEqual({ id, fact: f[0], plain: true });
      // Then the partner's other claims, in order, each a link; the first claim's own note is kept there.
      const rest = leads[id].slice(1), at = fold.indexOf('<ul class="lead">');
      const list = fold.slice(at, fold.indexOf("</ul>", at));
      expect([...list.matchAll(/<a class="c" href="([^"]+)"/g)].map((m) => decode(m[1]!))).toEqual(rest.map((l) => l.href));
      for (const l of rest) expect(decode(list)).toContain(l.text);
      if (lead0.note) expect(decode(fold)).toContain(lead0.note);
      expect(fold.indexOf('<p class="what">')).toBeGreaterThan(at);
      // The partner's page, last in the fold.
      expect(fold.endsWith("</a></details></article>")).toBe(true);
      expect(fold.slice(fold.lastIndexOf("<a "))).toContain(`<a class="open" href="${id}">More<span class="vh"> about ${name}</span>`);
    });
  }

  it("gives the three main claims one visible link affordance: the accent colour and an accent underline (review 12 Nov, DC-7)", () => {
    // Two of the three read as bold headings (body text colour, an underline in the border colour); the Metal claim alone
    // had an arrow. One rule, for the main claim of every card (the claims in the folds keep theirs), existing tokens only.
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    const rule = /\.pcard > ul\.lead a\.c \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/(^|;)\s*color: var\(--accent\)/);
    expect(rule).toMatch(/text-decoration-color: color-mix\(in srgb, var\(--accent\) \d+%, transparent\)/);
    expect(css.match(/\.pcard > ul\.lead a\.c \{/g)).toHaveLength(1);
    for (const id of ["airwallex", "metal", "claude"]) expect(afterHeader(cardOf(html, id)).startsWith('<ul class="lead"><li><a class="c" href="'), id).toBe(true);
  });

  it("uses no gendered pronoun for the CFO or anyone else, folds included (rule 1; seen by the review of 12 Nov)", () => {
    const pronoun = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
    const pagesText = [html, buildPages({ ...process.env, TRY_SIGN_ENABLED: "on" }).runs!].map((p) => decode(textOutsideTags(withoutBlocks(p, ["script", "style"], " "))));
    for (const t of pagesText) expect(pronoun.exec(t)?.[0]).toBeUndefined();
    expect(decode(html)).toContain("Proposals the CFO decided on the phone");
  });

  it("a card whose partner has no lead shows its fold only", () => {
    const cards = partnerCards(agentRun(), { airwallex: [], metal: leads.metal, claude: [] });
    for (const id of ["airwallex", "claude"]) expect(afterHeader(cardOf(cards, id)).startsWith('<details class="fold"><summary>Show the live proof</summary>')).toBe(true);
    expect(afterHeader(cardOf(cards, "metal")).startsWith('<ul class="lead"><li><a class="c" href="')).toBe(true);
    // 12 Nov (wire-in, owner): five cards, Airwallex, Visa, Metal, T:0, Claude; Visa and T:0 from their own records.
    expect((cards.match(/<article class="pcard card"/g) ?? []).length).toBe(5);
  });

  it("a first claim with links of its own (each card's anchor) keeps them: it is said again in the fold, with them", () => {
    // What the Airwallex card shows when Airwallex returns another hash: the cards' claim comes first.
    const cardsLead = leads.airwallex[1]!;
    const card = cardOf(partnerCards(agentRun(), { airwallex: [cardsLead], metal: [], claude: [] }), "airwallex");
    const sight = afterHeader(card).slice(0, afterHeader(card).indexOf('<details class="fold">'));
    expect(decode(sight)).toBe(`<ul class="lead"><li><a class="c" href="${cardsLead.href}">${cardsLead.text}</a></li></ul>`);
    const fold = card.slice(card.indexOf('<details class="fold">'));
    expect(decode(fold)).toContain(`<a class="c" href="${cardsLead.href}">${cardsLead.text}</a><span class="ks">`);
    for (const l of cardsLead.links!) expect(fold).toContain(`href="${l.href}"`);
  });

  it("the Airwallex card links each card to its own anchor, and the Claude card says the exact reading under Max's line", () => {
    const awx = cardOf(html, "airwallex");
    for (const r of cardControlRows(record)) expect(awx).toContain(`href="airwallex#${awxCardId(r.agent)}"`);
    expect(decode(cardOf(html, "claude"))).toContain(leads.claude[1]!.note!);
  });

  it("an external claim opens in a new tab, an anchor on our site does not", () => {
    for (const l of [...leads.metal, leads.claude[1]!]) expect(html).toContain(`href="${l.href}" target="_blank" rel="noopener"`);
    for (const l of leads.airwallex) expect(html).not.toContain(`href="${l.href}" target="_blank"`);
  });
});

describe("TAP on /proof: nowhere (Max's last round, item 2; the footer link went on 12 Nov, jury panel)", () => {
  it("has no TAP remark under the figures or anywhere else on the page", () => {
    expect(html).not.toContain('class="septest"');
    // (The red team's night batch of 2 November stays: it is not the TAP run.)
    expect(words(dropBlocks(html))).not.toMatch(/\bTAP\b|LIMIT_EXCEEDED|card limit/);
  });

  // 12 Nov (merge of #148 into #157): main kept this footer link on Proof; #157 removes it, as Visa is a section of its
  // own now and /judge links the Visa run. So the test that it stays became the test that it is gone.
  it("no longer carries the footer link \"Extra, not an award entry\"; /visa is reached from the Airi run's block", () => {
    expect(html).not.toMatch(/Extra, not an award entry|<a class="flink" href="visa"/);
    expect(html).toMatch(/<a class="open" href="visa#vic-flow">/);
  });
});

const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

describe("/proof starts with the guarantees (jury, 12 Nov): guarantees, partners, numbers, folds, utility links", () => {
  // Jury pass, 13 Nov: the heading, the scale band (the owner, 13 Nov), the four summary cards, then the one details
  // fold, which opens with the guarantees.
  // Jury, 13 Nov (second round): the guarantees in sight again, under the band and the four cards; the fold after them.
  it("has the heading, the band and the four cards above \"What Purser guarantees\", the fold after it: no run label", () => {
    const g = main.indexOf(guaranteesHtml());
    expect(g).toBeGreaterThan(0);
    expect(main.slice(0, g).replace(/\s+/g, " ")).toMatch(/^<main class="proofp"><div class="wrap"> <h1>Proof<\/h1> <ul class="scale"[^>]*>(?:<li[^>]*>[\s\S]*?<\/li>){4,6}<\/ul> <ul class="sumc"[^>]*>(?:<li[^>]*>[\s\S]*?<\/li>){4}<\/ul> $/);
    expect(main.slice(g + guaranteesHtml().length).trimStart()).toMatch(/^<details class="sumd" id="details"><summary>[^<]+<\/summary>/);
    expect(main.slice(0, g)).not.toContain('<span class="pill run">');
  });

  it("orders the page: heading, guarantees, partners, the run's label with its numbers, the folds, the utility links", () => {
    const at = ["<h1>Proof</h1>", `id="${GUARANTEES_ID}"`, '<h2 class="sec">The partners</h2>', '<div class="partners">', '<span class="pill run">', '<p class="split">', '<div class="nums">', '<details class="deep">', '<nav class="util"'].map((x) => main.indexOf(x));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((x, y) => x - y));
    // The page stays labelled with the run it shows, beside the numbers it belongs to; the split line under it.
    expect(words(main.slice(at[4], at[5]))).toContain(agentRun().label);
    expect(main).toContain(`<p class="split">${SPLIT_LINE}</p>`);
    // Every fold comes before the utility links, which end the page.
    expect(main.lastIndexOf("</details>")).toBeLessThan(at[8]!);
    expect(main.slice(at[8]).replace(/\s+/g, "").endsWith("</nav></div>")).toBe(true);
  });

  it("is titled \"Purser · Proof\", the name not doubled in the link preview, and describes what it opens with, no number typed", () => {
    expect(html).toContain("<title>Purser · Proof</title>");
    // The link preview says the site's one title on every page (the owner, 13 Nov: src/ui/meta.ts OG_TITLE).
    expect(html).toContain(`<meta property="og:title" content="${OG_TITLE}">`);
    const d = /<meta name="description" content="([^"]+)">/.exec(html)![1]!;
    expect(d.startsWith("What Purser guarantees")).toBe(true);
    expect(d).not.toMatch(/\d/);
    expect(d.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(1);
  });
});

describe("/proof's numbers: four tiles, one of them Airwallex's, the stops with their breakdown", () => {
  // Since 12 Nov each tile's leading number counts up (a data-count span holding the same figure, src/redesign/stats.ts);
  // unwrapped here so the figure is read as before, and checked to hold the same number it shows.
  const countUp = /<span data-count="(\d+)" data-dec="0">(\d+)<\/span>/g;
  const tiles = [...main.matchAll(/<a class="num card ([a-z]*)" href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => {
    for (const c of m[3]!.matchAll(countUp)) expect(c[1]).toBe(c[2]);
    return { cls: m[1]!, href: m[2]!, inner: decode(m[3]!.replace(countUp, "$2")) };
  });

  it("shows exactly four: Claude's decisions, Airwallex's figure, the Metal payments and the card charge, the stops", () => {
    // In this order: on a phone the two short tiles share a row and the two with lines under them share the next.
    expect(tiles.map((t) => [t.cls, t.href])).toEqual([["claude", "#claude"], ["awx", `airwallex#${AWX_CONTROLS_ID}`], ["code", "#metal"], ["stop", "#stops"]]);
    // The Face ID decisions and the cost per decision left the row; the Face ID figure stays under #faceid, one N.
    const row = main.slice(main.indexOf('<div class="nums">'), main.indexOf('<details class="deep"'));
    expect(row).not.toMatch(/Face ID|cost per decision/);
    expect(words(main.slice(main.indexOf('<div class="card" id="faceid">')))).toContain(`${faceIdDecisions(record)} decisions signed with Face ID`);
  });

  it("Airwallex's tile: the cards that carry the CFO's policy as Airwallex's own controls, counted from the card read-back", () => {
    const rows = cardControlRows(record), n = rows.filter((r) => r.match).length;
    expect([n, rows.length]).toEqual([3, 3]);
    expect(tiles[1]!.inner).toBe(`<span class="v">${n} of ${rows.length}</span><span class="l">cards carry the CFO's policy as Airwallex's own controls</span>`);
    // The same count as the Airwallex card's claim, from the same read-back.
    expect(leads.airwallex[1]!.text).toBe(`${n} of ${rows.length} cards carry the CFO's policy`);
    expect(buildPages().airwallex).toContain(` id="${AWX_CONTROLS_ID}"`);
  });

  it("the stops tile: its headline and one part per cause, which sum to the headline and to the record's count", () => {
    const story = stopStory(record), parts = stopBreakdown(story);
    const shown = [...tiles[3]!.inner.matchAll(/<span><b>(\d+)<\/b> ([^<]+)<\/span>/g)].map((m) => [Number(m[1]), m[2]!]);
    const headline = /^<span class="v">((\d+) stops?)<\/span><span class="l">nothing paid over a limit<\/span><span class="parts">/.exec(tiles[3]!.inner)!;
    expect(headline[1]).toBe(stopFigure(story));
    const sum = shown.reduce((k, x) => k + Number(x[0]), 0), blocked = record.snapshot.counts.blocked;
    // The record's own count, its refusal rows, the headline and the parts in sight: one number.
    expect([Number(headline[2]), sum, parts.reduce((k, x) => k + x.value, 0), record.snapshot.refusals.length]).toEqual([blocked, blocked, blocked, blocked]);
    expect(shown).toEqual(parts.map((x) => [x.value, x.label]));
    expect(shown).toEqual([[story.claude, "by a buy rule Claude set"], [story.metal, "by Metal"], [story.cfo, "by the CFO"], [story.planted, "planted instruction flagged"]]);
    expect(shown.map((x) => x[0])).toEqual([12, 2, 1, 1]);
  });

  it("leaves out a cause that stopped nothing, and names what no cause explains as \"other\", so the parts always sum", () => {
    const story = stopStory(record);
    const odd = { ...story, total: story.total - story.cfo + 1 + 3, cfo: 0, planted: story.planted + 1, other: 3 };
    expect(stopBreakdown(odd)).toEqual([{ value: story.claude, label: "by a buy rule Claude set" }, { value: story.metal, label: "by Metal" }, { value: 2, label: "planted instructions flagged" }, { value: 3, label: "other" }]);
    expect(stopBreakdown(odd).reduce((k, x) => k + x.value, 0)).toBe(odd.total);
  });
});

describe("/proof's folds: the Airi runs, the read-back, every check, the business and the archive, each one closed line", () => {
  const starts = [...main.matchAll(/<details class="deep"(?: id="([a-z-]+)")?><summary>([^<]+)<\/summary>/g)];
  const part = (i: number) => main.slice(starts[i]!.index, i + 1 < starts.length ? starts[i + 1]!.index : main.indexOf('<nav class="util"'));

  it("are five, closed, in this order", () => {
    expect(starts.map((m) => decode(m[2]!))).toEqual(["Visa Intelligent Commerce via Airwallex's Airi", "Airwallex, read back", "Every check", "Why this is a company", "Archive"]);
    expect((main.match(/<details class="deep"/g) ?? []).length).toBe(5);
    expect(main).not.toMatch(/<details class="deep"[^>]* open/);
  });

  it("hold what was in sight or in a card before: nothing of it is above the first fold", () => {
    const marks: string[][] = [['<div class="card airi" id="airi-run">', `<div class="card airi" id="${VIC2_RUN_ID}">`], ['id="airwallex-readback"'], ['<div class="card" id="stops">', '<div class="card" id="faceid">'], ['<ul class="company">'], ['href="lab"']];
    const above = main.slice(0, starts[0]!.index);
    marks.forEach((ms, i) => { for (const m of ms) expect({ m, inFold: part(i).includes(m), above: above.includes(m) }).toEqual({ m, inFold: true, above: false }); });
  });

  it("the archive is its own fold, last: the replay of the main run with its date from the record, then the archived pages", () => {
    expect(starts[4]![1]).toBe("archive");
    const links = [...part(4).matchAll(/<li><a class="pf" href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => [m[1]!, m[2]!]);
    expect(links.map((l) => l[0])).toEqual(["replay", "./?recorded", "metal/report", "film", "month", "lab"]);
    expect(links[0]![1]).toBe(`Replay of the main run, ${day(agentRun().recordedAt)}`);
    expect(links[0]![1]).toBe("Replay of the main run, 3 Nov");
    expect((main.match(/id="archive"/g) ?? []).length).toBe(1);
  });
});

describe("/proof's utility links: one quiet row at the end", () => {
  it("links the film, the CFO's view, the trace and the month-end pack, in that order, and nowhere above", () => {
    const at = main.indexOf('<nav class="util"'), util = main.slice(at);
    expect([...util.matchAll(/<a class="open" href="([^"]+)"/g)].map((m) => decode(m[1]!))).toEqual([FILM_URL, CFO_VIEW_URL, TRACE_URL, `assets/${PACK_NAME}`]);
    const text = words(util), above = words(main.slice(0, at));
    let from = -1;
    for (const label of [FILM_LINK, CFO_VIEW_LINK, TRACE_LINK, PACK_LINK]) {
      const i = text.indexOf(label);
      expect({ label, after: i > from }).toEqual({ label, after: true });
      from = i;
      expect({ label, above: above.includes(label) }).toEqual({ label, above: false });
    }
    expect(util).toMatch(/<a class="open" href="[^"]+" target="_blank" rel="noopener">/);
    expect(util).toMatch(/<a class="open" href="assets\/[^"]+" download>/);
  });
});

describe("links into /proof land on something", () => {
  it("every proof#… anchor used in src/, the README and llms.txt is an id on /proof", () => {
    const src = (readdirSync(new URL("../src", import.meta.url), { recursive: true }) as string[]).filter((f) => /\.(ts|html|md|css|json)$/.test(f)).map((f) => `src/${f.split("\\").join("/")}`);
    const used = new Set<string>();
    // docs/in-depth.md holds the README's run sections since 12 November (the Airi run's link to proof#airi-run with them).
    for (const f of [...src, "README.md", "docs/in-depth.md", "llms.txt"]) for (const m of read(f).matchAll(/\bproof#([a-z0-9-]+)/g)) used.add(m[1]!);
    expect([...used].sort()).toEqual(expect.arrayContaining(["airi-run", "airwallex", "claude", "faceid", "guarantees", "metal", "stops"]));
    for (const id of used) expect({ id, ids: html.split(` id="${id}"`).length - 1 }).toEqual({ id, ids: 1 });
    // The page's own links to itself too (the tiles).
    for (const m of main.matchAll(/href="#([a-z0-9-]+)"/g)) expect({ id: m[1], ids: html.split(` id="${m[1]}"`).length - 1 }).toEqual({ id: m[1], ids: 1 });
  });

  it("the page's script opens every fold around the target, also a fold inside a fold, on load and when the hash changes", () => {
    const js = scriptBody(scriptBlocks(html)[0]!);
    expect(js).toContain('for (var d = t; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;');
    expect(js).toContain('open(); window.addEventListener("hashchange", open);');
  });
});

/**
 * The words outside every fold, a fold's header kept: counted by depth, so a fold inside a fold hides its whole parent
 * (visibleWords, the shared budget's count, cuts a fold at its first </details> and so still counts what follows a fold
 * nested in a closed line).
 */
function wordsOutsideFolds(page: string): number {
  const re = /<details\b[^>]*>(?:\s*<summary[^>]*>([\s\S]*?)<\/summary>)?|<\/details>/g;
  let out = "", depth = 0, last = 0;
  for (let m = re.exec(page); m; m = re.exec(page)) {
    if (depth === 0) out += page.slice(last, m.index);
    if (m[0].startsWith("</")) depth--;
    else { if (depth === 0) out += ` ${m[1] ?? ""} `; depth++; }
    last = re.lastIndex;
  }
  out += page.slice(last);
  let svg = out;
  for (let prev = ""; prev !== svg;) { prev = svg; svg = svg.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  return words(svg).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

describe("/proof's words in sight", () => {
  it("are fewer than before the page started with the guarantees", () => {
    // 12 Nov: 709 by the shared count before (budget 720 in test/site-v4.test.ts); 512 as built now, plus a margin of 8.
    // +25, 12 Nov wire-in (owner: "T:0 and Visa are missing"): the Visa and T:0 cards, a name and one line each (540 as built).
    // +12, 12 Nov: the rail cards went to one line each and their full account into a fold, whose header ("What each
    // rail did, in full") counts once per drawing (wide and tall).
    // Jury pass, 13 Nov ("far less visible text"): four cards in sight, everything else in one fold: 123 words as built,
    // counted with folds inside folds (wordsOutsideFolds). +27, the owner the same day: the scale band above the cards
    // (six figures, a few words each; 162 as built after the cards led with their strongest numbers). A margin of 8.
    // Jury, 13 Nov (second round): "the first screen is too thin", so the seven guarantees are in sight again under the
    // cards (each promise, who enforces it and its evidence; how folded), and the cards name their run: 322 as built.
    expect(wordsOutsideFolds(main)).toBeLessThanOrEqual(330);
    expect(visibleWords(html)).toBeLessThanOrEqual(720);
    // The same count is what it says: a fold with nothing folded inside it adds only its header.
    expect(wordsOutsideFolds("<main><p>one two</p><details><summary>three</summary><p>four</p></details></main>")).toBe(3);
    expect(wordsOutsideFolds("<main><details><summary>one</summary><details><summary>two</summary>three</details>four five</details>six</main>")).toBe(2);
    // Outside every fold (a fold inside a closed line counted as closed too): 315 as built on 12 Nov, plus a margin of 8.
    // +28, 12 Nov wire-in: the Visa and T:0 cards (343 as built).
    // +10, 12 Nov: the rail cards' fold header, once per drawing (wide and tall); the cards themselves got shorter.
    expect(wordsOutsideFolds(main)).toBeLessThanOrEqual(357);
  });
});

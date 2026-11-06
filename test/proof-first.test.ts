// /proof puts the strongest proof first (Max's last round, item 2): each partner card opens with its strongest claims,
// each one link from its proof, and every number in them read from its record, never typed in (as
// test/proof-sentences.test.ts does for PROOF_SENTENCES). The TAP remark under the figures goes: TAP stays on /visa and
// in the footer link only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROOF_SENTENCES, VISA_EXTRA_LINK } from "../src/config/brand.js";
import { AWX_CONTROLS_ID, AWX_HASH_ID, awxCardId, cardControlRows, cardsReadback, hashTravel, transferReadback } from "../src/redesign/airwallexProof.js";
import { metalStory } from "../src/redesign/metalStory.js";
import { proofLeads, reliabilityFix, RELIABILITY_CASE } from "../src/redesign/proofLead.js";
import { proofPage } from "../src/redesign/proof.js";
import { loadRecord, split } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";

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
    expect(leads.claude[1]!.note).toBe("6/10 → 10/10: the treasury-card-raise eval rebuilt from rel-1's moment, before and after the fix (commit 856cb64); the next run, rel-1b, passed every step.");
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
    expect(claude).toContain(`${sp.byClaude} of ${sp.decisions} decisions in the main run, ${sp.fallbacks} fallbacks`);
    expect(claude).toContain(`a reliability run (${rf.run}) found a fault in how the agents hand off a card raise`);
    expect(claude).toContain(`went from ${rf.before.passed}/${rf.before.runs} to ${rf.after.passed}/${rf.after.runs} and the next run (${rf.next}) passed every step`);
  });
});

describe("/proof as served: each card opens with its claims, linked", () => {
  for (const [id, partner] of [["airwallex", "airwallex"], ["metal", "metal"], ["claude", "claude"]] as const) {
    it(`${id}: the claims come first, before the card's description, in order, each a link`, () => {
      const card = cardOf(html, id), first = afterHeader(card);
      expect(first.startsWith('<ul class="lead">')).toBe(true);
      const list = first.slice(0, first.indexOf("</ul>"));
      let at = 0;
      for (const l of leads[partner]) {
        const i = list.indexOf(`href="${l.href.split("&").join("&amp;")}"`, at);
        expect({ id, claim: l.text, linked: i >= 0 }).toEqual({ id, claim: l.text, linked: true });
        at = i;
        expect(decode(list)).toContain(l.text);
      }
      expect(card.indexOf('<p class="what">')).toBeGreaterThan(card.indexOf('<ul class="lead">'));
    });
  }

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

describe("TAP on /proof: only the footer link to /visa (Max's last round, item 2)", () => {
  it("has no TAP remark under the figures or anywhere else on the page", () => {
    expect(html).not.toContain('class="septest"');
    const body = words(dropBlocks(html)).split(VISA_EXTRA_LINK);
    expect(body).toHaveLength(2);
    // (The red team's night batch of 2 November stays: it is not the TAP run.)
    expect(body.join(" ")).not.toMatch(/\bTAP\b|LIMIT_EXCEEDED|card limit/);
  });

  it("keeps the footer link to /visa", () => {
    expect(html).toMatch(/<a [^>]*href="visa"[^>]*>Extra, not an award entry: Visa TAP[^<]*<\/a>/);
  });
});

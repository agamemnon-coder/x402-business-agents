// /visa opens with VIC, not TAP (12 Nov; Visa, 5 Nov: only Visa Intelligent Commerce or Intelligent Commerce Connect is
// Visa tooling for this hackathon, TAP is not). The page's heading, its label and its drawing tell the Airi run from its
// record; the overview says what ran (one paid VIC run and one controls run in which nothing was bought), every figure
// and id read again here from the raw run records; the TAP run's card sits in the TAP section, below every VIC block
// and under the status "not eligible Visa tooling for this hackathon (Visa, 5 Nov)". The page build fails if TAP comes
// above VIC (assertVicFirst).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISA_CLAIM, VISA_TAP_STATUS } from "../src/config/brand.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { VISA_ENTRY_LINE, VISA_H1, VISA_TAP_HEADING, assertVicFirst, visaPage, visaRunLabel } from "../src/redesign/partners.js";
import { loadRecord, ownTap, tapRun } from "../src/redesign/run.js";
import { esc } from "../src/redesign/ui.js";
import { vic2Run } from "../src/redesign/vic2Run.js";
import { VISA_OVERVIEW_ID, VISA_TAP_ID, airiCard, tapCard, vic2Card, visaOverviewHeading, visaOverviewHtml } from "../src/redesign/visaOverview.js";

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];

describe("/visa overview", () => {
  const airi = raw("docs/demo/airi-run.json"), vic2 = raw("docs/demo/vic-2-run.json"), tap = raw(tapRun()!.file);

  it("reads the VIC card from docs/demo/airi-run.json", () => {
    const c = airiCard(airiRun()!)!;
    const b = airi.purchases.find((p: { route: string }) => p.route === "cfo");
    expect(c.kind).toBe("paid");
    expect(c.stats).toEqual([
      { v: String(airi.purchases.filter((p: { outcome?: string }) => p.outcome === "SUCCEEDED").length), l: "paid" },
      { v: String(airi.purchases.filter((p: { by?: string }) => p.by === "purser").length), l: "refused by Purser" },
      { v: `${Object.values(airi.checks).filter((x) => (x as { ok: boolean }).ok).length}/${Object.keys(airi.checks).length}`, l: "checks" },
    ]);
    expect(c.ids).toEqual([["Mandate", b.mandate_id], ["Payment", b.payment_intent_id]]);
  });

  it("reads the second Airi run's card from docs/demo/vic-2-run.json: nothing bought, no outside call", () => {
    const c = vic2Card(vic2Run()!);
    expect(c.kind).toBe("controls");
    expect(c.stats[0]).toEqual({ v: "2", l: "refused" });
    expect(c.stats[1]).toEqual({ v: String(vic2.outside_calls.airi + vic2.outside_calls.airwallex), l: "outside calls" });
    expect(c.stats[1]!.v).toBe("0");
    expect(c.ids).toEqual([["Face ID proposal", vic2.steps.D.outcome.proposalId]]);
    expect(c.label).toMatch(/Nothing bought/);
  });

  it("reads the TAP card from the TAP run record: signatures the proxy accepted, Airwallex's approval and decline", () => {
    const c = tapCard(tapRun()!);
    const steps = tap.steps as { tap: { proxy_status: number }; airwallex: { approved: boolean; failure_reason: string | null; confirmed_by_get: { amount: string } } }[];
    const ok = steps.filter((s) => s.tap.proxy_status === 200).length;
    const yes = steps.find((s) => s.airwallex.approved)!, no = steps.find((s) => !s.airwallex.approved)!;
    expect(c.kind).toBe("tap");
    expect(c.stats).toEqual([
      { v: `${ok}/${steps.length}`, l: "signatures accepted" },
      { v: `€${yes.airwallex.confirmed_by_get.amount}`, l: "approved" },
      { v: `€${no.airwallex.confirmed_by_get.amount}`, l: `declined (${no.airwallex.failure_reason})` },
    ]);
    expect(c.ids).toEqual([["Visa reference verifier", `commit ${tap.reference.commit.slice(0, 7)}`]]);
    expect(c.label).toMatch(/simulated/);
  });

  it("says honestly what ran, counted from the cards: one paid VIC run and one controls run in which nothing was bought", () => {
    const cards = [airiCard(airiRun()!)!, vic2Card(vic2Run()!)];
    expect(visaOverviewHeading(cards)).toBe("What ran: one paid VIC run and one controls run (nothing bought)");
    // Counted, not typed: a second paid run changes the words; a run with nothing paid is never called a paid run.
    expect(visaOverviewHeading([cards[0]!, cards[0]!, cards[1]!])).toBe("What ran: two paid VIC runs and one controls run (nothing bought)");
    expect(visaOverviewHeading([cards[0]!])).toBe("What ran: one paid VIC run");
    expect(visaOverviewHeading([cards[1]!])).toBe("What ran: one controls run (nothing bought)");
    // The controls run made no outside call, by its own record; the paid run paid, by its own.
    expect(vic2.outside_calls).toMatchObject({ airi: 0, airwallex: 0 });
    expect(airi.purchases.filter((p: { outcome?: string }) => p.outcome === "SUCCEEDED").length).toBeGreaterThan(0);
    // The TAP run is not eligible Visa tooling: never counted in the overview, never drawn in it.
    expect(() => visaOverviewHtml([...cards, tapCard(tapRun()!)])).toThrow(/TAP/);
  });

  it("sits on /visa above the Airi run with the two VIC cards, each linking to a block on the page; no TAP in it", () => {
    const html = visaPage();
    const at = html.indexOf(`id="${VISA_OVERVIEW_ID}"`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('id="airi-run"'));
    const overview = /<section class="card vo"[\s\S]*?<\/section>/.exec(html)![0];
    expect(text(overview)).toContain("What ran: one paid VIC run and one controls run (nothing bought)");
    expect(text(html)).not.toMatch(/three live runs/);
    const hrefs = [...overview.matchAll(/<a class="vo-run" href="#([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(["airi-run", "airi-run-2"]);
    for (const h of hrefs) expect(html).toContain(`id="${h}"`);
    expect(overview).not.toMatch(/\bTAP\b/);
  });

  it("leaves a card out when its record lacks the fact, and the whole overview when no record is there", () => {
    const rec = airiRun()!;
    expect(airiCard({ ...rec, purchases: rec.purchases.filter((p) => p.route !== "cfo") })).toBeNull();
    expect(visaOverviewHtml([])).toBe("");
  });
});

describe("/visa opens with VIC, and TAP sits below it under its label", () => {
  const html = visaPage(), main = mainOf(html);
  const rec = raw("docs/demo/airi-run.json");

  it("opens with the VIC story: the heading, the Airi run's own label, the entry line, then the drawing from the record", () => {
    // One h1, the first heading of the page, and it tells the VIC run (no TAP in it).
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/.exec(main)![0]).toBe(`<h1>${esc(VISA_H1)}</h1>`);
    expect(VISA_H1).toBe("First the CFO's limit, then a single-use Visa credential");
    expect(VISA_H1).not.toMatch(/TAP|sign/i);
    // The label beside it is the Airi run's, from its record: its date and "Airwallex sandbox · test card · test money".
    expect(visaRunLabel(airiRun()!)).toBe(`7 Nov · ${String(rec.label).split(", ").join(" · ")}`);
    expect(rec.started_at.slice(0, 10)).toBe("2026-11-07");
    const head = main.slice(0, main.indexOf("</h1>"));
    expect(text(head)).toContain(visaRunLabel(airiRun()!));
    expect(head).toContain('<span class="logo txt">Visa</span>');
    // Then the entry line, then the drawing (the seven steps of purchase B, from the record), then the runs.
    const order = ["</h1>", esc(VISA_ENTRY_LINE), 'id="vic-flow"', `id="${VISA_OVERVIEW_ID}"`, 'id="airi-run"', 'id="airi-run-2"', `id="${VISA_TAP_ID}"`].map((x) => ({ x, at: main.indexOf(x) }));
    for (const o of order) expect({ x: o.x, found: o.at >= 0 }).toEqual({ x: o.x, found: true });
    expect(order.map((o) => o.at)).toEqual([...order.map((o) => o.at)].sort((a, b) => a - b));
    // The drawing's five beats, in order, each with the record's own value: the CFO's limit, the Airi mandate, the
    // cardholder's passkey, the single-use credential, the Airwallex PaymentIntent.
    const b = rec.purchases.find((p: { step: string }) => p.step === "B");
    const flow = text(/<section class="card vicflow"[\s\S]*?<\/section>/.exec(main)![0]);
    const beats = [`Limit ${b.currency} ${rec.policy.alone_max_eur}`, b.mandate_id, "Passkey in Airi", `${b.credential_type} · test card`, b.payment_intent_id].map((x) => flow.indexOf(x));
    expect(beats.every((i) => i >= 0)).toBe(true);
    expect(beats).toEqual([...beats].sort((x, y) => x - y));
  });

  it("keeps every word about TAP below the VIC blocks, in a section that opens with the not-eligible status", () => {
    const tapAt = main.indexOf(`<h2 class="vsec" id="${VISA_TAP_ID}">`);
    expect(tapAt).toBeGreaterThan(-1);
    expect(text(main.slice(0, tapAt))).not.toMatch(/\bTAP\b|Trusted Agent Protocol/);
    // The section: its heading, then at once the status, word for word (Visa, 5 Nov), then the TAP run's card.
    const section = main.slice(tapAt);
    expect(text(section).startsWith(`${VISA_TAP_HEADING} ${VISA_TAP_STATUS}`)).toBe(true);
    expect(VISA_TAP_STATUS).toContain("not eligible Visa tooling for this hackathon (Visa, 5 Nov)");
    expect(VISA_TAP_HEADING).toBe("Extra, not an award entry: Visa TAP");
    expect(section.indexOf('class="vo-run tap"')).toBeGreaterThan(section.indexOf(esc(VISA_TAP_STATUS)));
    expect(section.indexOf('class="flow card"')).toBeGreaterThan(section.indexOf('class="vo-run tap"'));
    expect(main.match(/class="vo-run tap"/g)).toHaveLength(1);
    // Every VIC block is above it.
    for (const id of ["vic-flow", VISA_OVERVIEW_ID, "airi-run", "airi-run-2"]) expect({ id, above: main.indexOf(`id="${id}"`) < tapAt }).toEqual({ id, above: true });
  });

  it("fails the page build when TAP comes above VIC, when the status is not the section's first words, or when the heading is not the VIC one", () => {
    expect(() => assertVicFirst(html)).not.toThrow();
    const tapSection = main.slice(main.indexOf(`<h2 class="vsec" id="${VISA_TAP_ID}"`), main.lastIndexOf('<a class="open"'));
    expect(tapSection.length).toBeGreaterThan(200);
    // The TAP section moved above the Airi run.
    const moved = html.replace(tapSection, "").replace('<div class="awrb"><div class="card airi" id="airi-run">', `${tapSection}<div class="awrb"><div class="card airi" id="airi-run">`);
    expect(moved).not.toBe(html);
    expect(() => assertVicFirst(moved)).toThrow(/TAP/);
    // A TAP word in the top.
    expect(() => assertVicFirst(html.replace(esc(VISA_ENTRY_LINE), `${esc(VISA_ENTRY_LINE)} Signed with TAP.`))).toThrow(/TAP/);
    // The status dropped from the head of the section.
    expect(() => assertVicFirst(html.replace(`<p class="claim">${esc(VISA_TAP_STATUS)}</p>`, ""))).toThrow(/status/);
    // The old TAP heading as the page's h1.
    expect(() => assertVicFirst(html.replace(`<h1>${esc(VISA_H1)}</h1>`, "<h1>The agent signs before it pays</h1>"))).toThrow(/heading/);
    // The old overview, which counted the TAP run and the run that bought nothing as "three live runs".
    expect(() => assertVicFirst(html.replace("What ran: one paid VIC run and one controls run (nothing bought)", "Visa in Purser: three live runs"))).toThrow(/overview/);
  });

  it("says only the Sourcing agent signed with TAP: the claim, the README, the form texts, llms.txt and the claims list", () => {
    expect(VISA_CLAIM).toBe("Visa: the Sourcing agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.");
    // Only the Sourcing agent ran TAP live: the TAP run's card and every step's origin are the Sourcing agent's, and so
    // is the key of the main run's own TAP-signed buy.
    const tap = raw(tapRun()!.file) as { card: { agent: string }; steps: { origin: { agent: string } }[] };
    expect([...new Set([tap.card.agent, ...tap.steps.map((s) => s.origin.agent)])]).toEqual(["sourcing"]);
    expect(ownTap(loadRecord().record)!.keyId).toMatch(/^sourcing-/);
    expect(main).toContain(esc(VISA_CLAIM));
    const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\s+/g, " ");
    for (const f of ["README.md", "llms.txt", "docs/claims.md", "docs/submission/README.md", "docs/submission/long-description.md"]) {
      const t = read(f);
      // "each agent signs … with TAP" and "our agents sign … TAP" only where a "Was" note quotes the old wording.
      const stale = [...t.matchAll(/(each agent signs|every agent signs|our agents sign)[^.|]{0,160}(TAP|Trusted Agent Protocol)/gi)].filter((m) => !/\bWas\b[^|]{0,400}$/.test(t.slice(Math.max(0, m.index - 400), m.index)));
      expect({ f, stale: stale.map((m) => m[0]) }).toEqual({ f, stale: [] });
    }
    for (const f of ["README.md", "docs/submission/long-description.md"]) expect({ f, says: read(f).replace(/\*\*/g, "").includes(VISA_CLAIM) }).toEqual({ f, says: true });
  });
});

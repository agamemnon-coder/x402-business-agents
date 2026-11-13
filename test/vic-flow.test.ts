// The VIC flow on /visa (7 Nov; the page's drawing, right under its heading and entry line, since 12 Nov): how a purchase
// with a Visa credential (bound by Purser to one purchase) from Airwallex's Airi runs, in seven steps, as an ordered list a screen reader reads
// in order. Breaks if a step is missing or
// out of order, if a step is marked as someone else's (Purser 2 and 7, Airi and Visa 3 to 5, Airwallex 6), if an id or
// value is not purchase B's from the record, if C's branch is not "refused by Purser, 0 Airi calls", if the label is
// gone, if a fact is missing and the page still builds, if a number is not the record's, if it moves or has no dark
// colours, or if /proof's Airi block does not link to it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AIRI_RUN_FILE, airiRunBlock, type AiriRunRecord } from "../src/redesign/airiRun.js";
import { VIC_FLOW_CSS, VIC_FLOW_ID, vicFlow, vicFlowBlock, vicFlowHtml } from "../src/redesign/vicFlow.js";

const RAW = readFileSync(AIRI_RUN_FILE, "utf8");
const rec = JSON.parse(RAW) as AiriRunRecord;
const pages = buildPages() as unknown as Record<string, string>;
const buy = (s: string) => rec.purchases.find((p) => p.step === s)!;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const flowOn = (html: string) => /<section class="card vicflow" id="vic-flow"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const steps = (html: string) => [...html.matchAll(/<li class="vf-([a-z]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ owner: m[1]!, text: text(m[2]!) }));
const without = (step: string, drop: string) => ({ ...rec, purchases: rec.purchases.map((p) => p.step === step ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== drop)) as unknown as typeof p : p) });

describe("the VIC flow on /visa", () => {
  const visa = pages.visa!, flow = flowOn(visa);

  it("is the page's drawing: right under the h1 and the entry line, above the Airi run's block and the TAP flow, once", () => {
    expect(flow.length).toBeGreaterThan(0);
    expect(visa.match(/id="vic-flow"/g)).toHaveLength(1);
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeGreaterThan(visa.indexOf("<h1"));
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeLessThan(visa.indexOf('id="airi-run"'));
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeLessThan(visa.indexOf('class="flow card'));
    // Its heading is an h2 there: it follows the page's h1, and no heading level is skipped.
    expect(flow).toMatch(/<h2 id="vic-flow-h">How it works: purchase B<\/h2>/);
    // Nothing but the heading and the entry line stands between the top of the page and the drawing.
    // Since 12 Nov the latest live run (vic-3) leads, above the drawing of the first run (test/vic3-visa.test.ts).
    // Since the jury pass (13 Nov) the four cards lead and the rest is in one fold: inside it, only the story line and the
    // latest run's block come before the drawing.
    const fold = '<details class="sumd" id="visa-details">';
    // Since the redesign (13 Nov) the latest run's flow, outcomes and hash lead; its cards open the fold, before the drawing.
    expect(visa.indexOf(fold)).toBeGreaterThan(visa.indexOf('id="visa-flow"'));
    const before = visa.slice(visa.indexOf(fold) + fold.length, visa.indexOf('<section class="card vicflow"')).replace(/<summary>[^<]*<\/summary>/, "").replace(/<ul class="sumc"[\s\S]*?<\/ul>/, "").replace(/<div class="awrb"><div class="card airi" id="vic3-run">[\s\S]*?<\/details>[\s\S]*?<\/div><\/div>/, "");
    expect(before).not.toMatch(/<section|class="card|<details/);
    // Not on the other pages: /proof links to it.
    for (const name of ["airwallex", "proof", "home"]) expect({ name, flow: pages[name]!.includes('id="vic-flow"') }).toEqual({ name, flow: false });
  });

  it("is an ordered list of seven steps, each marked with whose step it is", () => {
    expect(flow).toMatch(/<ol class="vf" role="list">/);
    const s = steps(flow);
    expect(s.map((x) => x.owner)).toEqual(["agent", "purser", "airi", "airi", "airi", "airwallex", "purser"]);
    // Step 1 is the script's while purchase B was not asked for inside a Claude call (the record of 7 Nov: scripted).
    expect(s.map((x) => x.text.split(" ")[0])).toEqual(["Script", "Purser", "Airi", "Airi", "Airi", "Airwallex", "Purser"]);
    for (const [i, title] of ["Asks to buy", "Purser's policy", "Airi mandate", "Cardholder confirms", "Visa credential (VIC)", "Airwallex hosted checkout", "Result read back"].entries())
      expect({ i, has: s[i]!.text.includes(title) }).toEqual({ i, has: true });
  });

  it("shows purchase B's own ids and values under the steps, all from the record, and C's branch off step 2", () => {
    const b = buy("B"), c = buy("C"), s = steps(flow);
    expect(text(flow)).toContain(`How it works: purchase B`);
    expect(s[0]!.text).toBe(`Script Asks to buy Purser's script as the Sourcing agent; no Claude call ${b.currency} ${b.amount}`);
    expect(b.rail_choice).toBeUndefined();
    // A record whose purchase B was asked for inside the agent's Claude call: the agent's step, said so.
    const asked = vicFlow({ ...rec, purchases: rec.purchases.map((p) => (p.step === "B" ? { ...p, rail_choice: { by: "claude" as const, model: "claude-haiku-4-5", request_id: "req_1" } } : p)) });
    expect(asked.steps[0]).toMatchObject({ owner: "agent", title: "Agent asks to buy", what: "Sourcing agent, in a Claude call" });
    expect(asked.steps[0]!.who).toBeUndefined();
    expect(s[1]!.text).toContain(`Limit ${b.currency} ${rec.policy.alone_max_eur}, allowed merchants; above it, the CFO's Face ID on the exact terms`);
    expect(s[1]!.text).toContain(`${b.proposal_id} · terms ${b.terms_sha256!.slice(0, 8)}…`);
    expect(s[1]!.text).toContain(`✕ Refused by Purser — ${c.airi_calls} Airi calls Purchase C, a disallowed merchant`);
    expect(c.airi_calls).toBe(0);
    expect(s[2]!.text).toContain(b.mandate_id!);
    expect(s[3]!.text).toContain("Passkey in Airi Once");
    expect(b.tap).toMatch(/once, with a passkey in Airi/);
    // The credential's type as Airi's receipt names it: Airwallex's own record says number_type PAN (/visa's fold).
    expect(s[4]!.text).toContain(`Airi's receipt: ${b.credential_type} · test card`);
    expect(s[5]!.text).toContain(`Our own sandbox merchant ${b.payment_intent_id}`);
    expect(s[6]!.text).toBe(`Purser Result read back Reported to Airi ${b.outcome}`);
    expect([b.outcome, b.reported_to_airi]).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    // A's ids stay folded on /visa (the block's fold): the flow follows B only.
    for (const id of [buy("A").mandate_id!, buy("A").payment_intent_id!]) expect(flow).not.toContain(id);
    expect(text(flow)).toContain("Airwallex sandbox · test card · test money");
  });

  it("has no number the record does not hold, nothing private, no person's name, no award claim", () => {
    const inRecord = new Set(RAW.match(/\d+(?:\.\d+)*/g) ?? []);
    const t = text(flow).replace(/\b(?:int|mdt)_[a-z0-9]+/g, " ").replace(/P-\d{4}/g, " ").replace(/[0-9a-f]{8}…/g, " ");
    expect((t.match(/\d+(?:\.\d+)*/g) ?? []).filter((n) => !inRecord.has(n))).toEqual([]);
    expect(flow).not.toMatch(/airi\.com|\b\d{13,19}\b|\b[0-9a-f]{64}\b|payment_method_id/i);
    expect(text(flow)).not.toMatch(/vic-1|emulat|\bMax\b|\b(he|him|his|she|her|hers)\b|Visa Award|code decides/i);
  });

  it("does not build when a fact a step needs is missing from a live record, and draws nothing without one", () => {
    expect(vicFlowBlock(null)).toBe("");
    for (const [step, field] of [["B", "mandate_id"], ["B", "payment_intent_id"], ["B", "terms_sha256"], ["B", "proposal_id"], ["B", "credential_type"], ["B", "outcome"], ["B", "tap"], ["C", "airi_calls"]] as const)
      expect(() => vicFlow(without(step, field))).toThrow(/the VIC flow on \/visa needs/);
    expect(() => vicFlow({ ...rec, purchases: rec.purchases.filter((p) => p.step !== "B") })).toThrow(/purchase B/);
    expect(() => vicFlow({ ...rec, purchases: rec.purchases.map((p) => p.step === "B" ? { ...p, reported_to_airi: "FAILED" } : p) })).toThrow(/reported to Airi/);
    expect(() => vicFlow({ ...rec, purchases: rec.purchases.map((p) => p.step === "C" ? { ...p, by: "airi" } : p) })).toThrow(/refused by Purser/);
    expect(() => vicFlow({ ...rec, test_card: false })).toThrow(/test card/);
    // Read again from the record: the same flow the page shows.
    expect(flow).toBe(vicFlowHtml(vicFlow(rec), { h: "h2" }));
    expect(vicFlowHtml(vicFlow(rec))).toContain('<h3 id="vic-flow-h">');
  });

  it("is reachable from /proof's Airi block, and has neutral colours from the design tokens (light and dark), a phone layout and no motion", () => {
    expect(airiRunBlock(undefined, { short: true })).toContain('<a class="open" href="visa#vic-flow">How it works');
    expect(pages.proof!).toContain('href="visa#vic-flow"');
    // Every colour is a design token (each has its dark value in the shared stylesheet): no colour of the flow's own
    // since 12 Nov, when Airi's steps went from a pink of their own to the text's neutral colour.
    expect(VIC_FLOW_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    expect(VIC_FLOW_CSS).toContain("ol.vf > li.vf-airi { --vf-c: var(--text); }");
    expect(VIC_FLOW_CSS).toMatch(/@media \(min-width: 960px\) \{\s*ol\.vf \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
    expect(VIC_FLOW_CSS).not.toMatch(/animation|transition|@keyframes/);
  });
});

// The VIC flow on /visa (7 Nov): how a purchase with a single-use Visa credential from Airwallex's Airi runs, in seven
// steps under the Airi run's block, as an ordered list a screen reader reads in order. Breaks if a step is missing or
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

  it("sits under the Airi run's block, before the page's h1 and the TAP flow, once", () => {
    expect(flow.length).toBeGreaterThan(0);
    expect(visa.match(/id="vic-flow"/g)).toHaveLength(1);
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeGreaterThan(visa.indexOf('id="airi-run"'));
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeLessThan(visa.indexOf("<h1"));
    expect(visa.indexOf(`id="${VIC_FLOW_ID}"`)).toBeLessThan(visa.indexOf('class="flow card'));
    // Not on the other pages: /proof links to it.
    for (const name of ["airwallex", "proof", "home"]) expect({ name, flow: pages[name]!.includes('id="vic-flow"') }).toEqual({ name, flow: false });
  });

  it("is an ordered list of seven steps, each marked with whose step it is", () => {
    expect(flow).toMatch(/<ol class="vf" role="list">/);
    const s = steps(flow);
    expect(s.map((x) => x.owner)).toEqual(["agent", "purser", "airi", "airi", "airi", "airwallex", "purser"]);
    expect(s.map((x) => x.text.split(" ")[0])).toEqual(["Agent", "Purser", "Airi", "Airi", "Airi", "Airwallex", "Purser"]);
    for (const [i, title] of ["Agent asks to buy", "Purser's policy", "Airi mandate", "Cardholder confirms", "Single-use Visa credential (VIC)", "Airwallex hosted checkout", "Result read back"].entries())
      expect({ i, has: s[i]!.text.includes(title) }).toEqual({ i, has: true });
  });

  it("shows purchase B's own ids and values under the steps, all from the record, and C's branch off step 2", () => {
    const b = buy("B"), c = buy("C"), s = steps(flow);
    expect(text(flow)).toContain(`How it works: purchase B`);
    expect(s[0]!.text).toContain(`Sourcing agent ${b.currency} ${b.amount}`);
    expect(s[1]!.text).toContain(`Limit ${b.currency} ${rec.policy.alone_max_eur}, allowed merchants; above it, the CFO's Face ID on the exact terms`);
    expect(s[1]!.text).toContain(`${b.proposal_id} · terms ${b.terms_sha256!.slice(0, 8)}…`);
    expect(s[1]!.text).toContain(`✕ Refused by Purser — ${c.airi_calls} Airi calls Purchase C, a disallowed merchant`);
    expect(c.airi_calls).toBe(0);
    expect(s[2]!.text).toContain(b.mandate_id!);
    expect(s[3]!.text).toContain("Passkey in Airi Once");
    expect(b.tap).toMatch(/once, with a passkey in Airi/);
    expect(s[4]!.text).toContain(`${b.credential_type} · test card`);
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
    expect(flow).toBe(vicFlowHtml(vicFlow(rec)));
  });

  it("is reachable from /proof's Airi block, and has dark colours, a phone layout and no motion", () => {
    expect(airiRunBlock(undefined, { short: true })).toContain('<a class="open" href="visa#vic-flow">How it works');
    expect(pages.proof!).toContain('href="visa#vic-flow"');
    expect(VIC_FLOW_CSS).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \.vicflow/);
    expect(VIC_FLOW_CSS).toMatch(/:root\[data-theme="dark"\] \.vicflow/);
    expect(VIC_FLOW_CSS).toMatch(/@media \(min-width: 960px\) \{\s*ol\.vf \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
    expect(VIC_FLOW_CSS).not.toMatch(/animation|transition|@keyframes/);
  });
});

// /alta's opening (Metal Award, 15 Nov): three facts, each with its explorer link and its record, then the main run's
// count. Every figure is read from the records; a record that does not show its fact leaves the fact out.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { altaFacts, altaFactsHtml, ALTA_FACTS_ID, ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD, FACEID_RECORD, NO_ENDORSEMENT_ALTA, OWNERS_RECORD } from "../src/redesign/altaFacts.js";
import { explorerLink } from "../src/redesign/metalStory.js";
import { metalTxs } from "../src/redesign/partners.js";
import { METAL_PAGE } from "../src/servers/dashboard.js";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("/alta: the three facts", () => {
  const facts = altaFacts();
  const faceid = read(FACEID_RECORD), owners = read(OWNERS_RECORD), anchor = read(ANCHOR_RECORD), verified = read(ANCHOR_VERIFIED_RECORD);

  it("refused on chain, two passkey owners, anchored: in that order, each tx from its record", () => {
    expect(facts.map((f) => f.id)).toEqual(["refused", "owners", "anchor"]);
    const refusal = faceid.steps.find((s: { kind: string }) => s.kind === "refusal");
    expect(facts[0]!.links[0]!.href).toBe(`https://testnet.metalntwx.com/tx/${refusal.tx}`);
    expect(facts[0]!.text).toBe("12 Nov: 0.06 to Stockline, over the mandate's 0.05 cap. Alta refused it on chain; nothing moved.");
    const change = faceid.steps.find((s: { kind: string; step: string }) => s.kind === "relay" && s.step.includes("P-0002"));
    const alone = owners.steps.find((s: { step: string }) => s.step.includes("CFO's passkey alone") && s.step.includes("mandate"));
    expect(facts[1]!.links.map((l) => l.href)).toEqual([`https://testnet.metalntwx.com/tx/${change.tx}`, `https://testnet.metalntwx.com/tx/${alone.tx}`]);
    expect(alone.outcome).toBe("reverted");
    expect(facts[1]!.text).toContain("the CFO's iPhone passkey and a labelled test passkey");
    expect(facts[1]!.text).toContain("One passkey alone: refused on chain (1 Nov, software passkeys).");
    expect(facts[2]!.links[0]!.href).toBe(`https://testnet.metalntwx.com/tx/${anchor.tx}`);
    expect(verified).toMatchObject({ result: "MATCH", tx: anchor.tx, head: anchor.head, height: anchor.height });
    expect(facts[2]!.text).toContain("verify-anchor run live on 15 Nov: MATCH.");
    expect(facts.map((f) => f.record)).toEqual([[FACEID_RECORD], [FACEID_RECORD, OWNERS_RECORD], [ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD]]);
    for (const f of facts) for (const l of f.links) expect(explorerLink(l.href)?.kind).toBe("tx");
  });

  it("leaves a fact out when its record does not show it, and says nothing of a verification that did not match", () => {
    const steps = faceid.steps.map((s: { kind: string; outcome: string }) => (s.kind === "refusal" ? { ...s, outcome: "paid" } : s));
    expect(altaFacts({ faceid: { steps }, owners, anchor, verified }).map((f) => f.id)).toEqual(["owners", "anchor"]);
    expect(altaFacts({ faceid, owners: null, anchor, verified })[1]!.links).toHaveLength(1);
    const nomatch = altaFacts({ faceid, owners, anchor, verified: { ...verified, result: "MISMATCH" } })[2]!;
    expect(nomatch.text).not.toContain("MATCH");
    expect(nomatch.record).toEqual([ANCHOR_RECORD]);
    expect(altaFacts({ faceid: null, owners: null, anchor: null, verified: null })).toEqual([]);
    expect(altaFactsHtml([], { count: 86, list: "x" })).toBe("");
  });

  it("opens /alta right under the heading, with the main run's count from its list and the logo's note beside it", () => {
    const main = /<main[\s\S]*<\/main>/.exec(METAL_PAGE)![0];
    const words = text(main);
    expect(main.indexOf(`id="${ALTA_FACTS_ID}"`)).toBeGreaterThan(main.indexOf("</h1>"));
    expect(main.indexOf(`id="${ALTA_FACTS_ID}"`)).toBeLessThan(main.indexOf("entry for the Metal Award"));
    expect(metalTxs()).toHaveLength(86);
    expect(words).toContain("86 Alta payments in the main run, each its own transaction. 3 Nov record");
    expect(main).toContain(`title="docs/runs/2026-11-03-main-run-metal-transactions.md"`);
    expect(main).toMatch(new RegExp(`<img[^>]+logo-alta\\.svg[^>]*></span><span class="noend">${NO_ENDORSEMENT_ALTA}</span>`));
    expect(words).toMatch(/Refused on chain 12 Nov: 0\.06 to Stockline, over the mandate's 0\.05 cap\. Alta \(formerly Metal\) refused it on chain/);
  });
});

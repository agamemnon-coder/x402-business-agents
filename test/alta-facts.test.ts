// /alta's opening (Metal Award, 15 Nov): three facts, each with its explorer link and its record, then the main run's
// count. Every figure is read from the records; a record that does not show its fact leaves the fact out.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { altaFacts, altaFactsHtml, altaTilesHtml, ALTA_FACTS_ID, ANCHOR_19_CHECK, ANCHOR_19_RECORD, ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD, FACEID_RECORD, NO_ENDORSEMENT_ALTA, OWNERS_RECORD, SERIES_LOG, SERIES_RECORDS } from "../src/redesign/altaFacts.js";
import { explorerLink } from "../src/redesign/metalStory.js";
import { metalTxs } from "../src/redesign/partners.js";
import { METAL_PAGE } from "../src/servers/dashboard.js";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const readText = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("/alta: the three facts", () => {
  const facts = altaFacts();
  const faceid = read(FACEID_RECORD), owners = read(OWNERS_RECORD), anchor = read(ANCHOR_RECORD), verified = read(ANCHOR_VERIFIED_RECORD);

  const series = SERIES_RECORDS.map(read), anchor19 = read(ANCHOR_19_RECORD), seriesLog = readText(SERIES_LOG);
  // The records before 19 Nov only: the facts as they read from 15 Nov.
  const older = { faceid, owners, anchor, verified, series: null, anchor19: null, seriesLog: null };

  // 19 Nov (the owner: "lead with the strongest live-proven result"): the first fact and the anchor from the newest records.
  it("refused on chain, two passkey owners, anchored: in that order, each tx from its record, the newest records first", () => {
    expect(facts.map((f) => f.id)).toEqual(["refused", "owners", "anchor"]);
    // The 19 Nov series: every MandatePayment paid, every attempt outside the mandate refused on chain with its reason.
    const steps = series.flatMap((r: { steps: { kind: string; event?: string; outcome?: string; reason?: string; tx?: string; amount?: string }[] }) => r.steps);
    const refused = steps.filter((x) => x.outcome === "refused on chain");
    expect(steps.filter((x) => x.event === "MandatePayment")).toHaveLength(21);
    expect(refused.map((x) => x.reason)).toEqual(["OverPerPaymentCap", "PayeeNotAllowed", "OverBudget"]);
    expect(facts[0]!.text).toBe("19 Nov: 21 payments inside the agent's mandate, 1.00 test USD in all. Alta refused all 3 attempts outside it on chain (OverPerPaymentCap, PayeeNotAllowed, OverBudget); nothing moved.");
    expect(facts[0]!.links.map((l) => [l.label, l.href])).toEqual(refused.map((x, n) => [["cap: tx", "payee: tx", "budget: tx"][n], `https://testnet.metalntwx.com/tx/${x.tx}`]));
    const change = faceid.steps.find((s: { kind: string; step: string }) => s.kind === "relay" && s.step.includes("P-0002"));
    const alone = owners.steps.find((s: { step: string }) => s.step.includes("CFO's passkey alone") && s.step.includes("mandate"));
    expect(facts[1]!.links.map((l) => l.href)).toEqual([`https://testnet.metalntwx.com/tx/${change.tx}`, `https://testnet.metalntwx.com/tx/${alone.tx}`]);
    expect(alone.outcome).toBe("reverted");
    expect(facts[1]!.text).toContain("the CFO's iPhone passkey and a labelled test passkey");
    expect(facts[1]!.text).toContain("One passkey alone: refused on chain (1 Nov, software passkeys).");
    // The 19 Nov anchor, its MATCH as the series' run log prints verify-anchor's output.
    expect(facts[2]!.links[0]!.href).toBe(`https://testnet.metalntwx.com/tx/${anchor19.tx}`);
    expect(seriesLog).toContain(`MATCH: ${ANCHOR_19_RECORD}, tx ${anchor19.tx}`);
    expect(facts[2]!.text).toBe(`19 Nov: the head of Purser's records, ${anchor19.height} rows and lines, the series above included, in one transaction. verify-anchor: MATCH.`);
    expect(anchor19.height).toBe(731);
    // The anchor pins both series records (their run log tells both passes, each with its transaction).
    expect(anchor19.parts.map((x: { file: string }) => x.file)).toEqual(expect.arrayContaining([...SERIES_RECORDS]));
    expect(seriesLog).toContain("pass 2 is `npm run alta-series -- --finish`");
    expect(facts.map((f) => f.record)).toEqual([[SERIES_RECORDS[0]], [FACEID_RECORD, OWNERS_RECORD], [ANCHOR_19_RECORD, ANCHOR_19_CHECK]]);
    for (const f of facts) for (const l of f.links) expect(explorerLink(l.href)?.kind).toBe("tx");
  });

  it("without the 19 Nov records, reads as on 15 Nov: the 12 Nov refusal and the 13 Nov anchor, verified on 15 Nov", () => {
    const old = altaFacts(older);
    expect(old.map((f) => f.id)).toEqual(["refused", "owners", "anchor"]);
    const refusal = faceid.steps.find((s: { kind: string }) => s.kind === "refusal");
    expect(old[0]!.links[0]!.href).toBe(`https://testnet.metalntwx.com/tx/${refusal.tx}`);
    expect(old[0]!.text).toBe("12 Nov: 0.06 to Stockline, over the mandate's 0.05 cap. Alta refused it on chain; nothing moved.");
    expect(old[2]!.links[0]!.href).toBe(`https://testnet.metalntwx.com/tx/${anchor.tx}`);
    expect(verified).toMatchObject({ result: "MATCH", tx: anchor.tx, head: anchor.head, height: anchor.height });
    expect(old[2]!.text).toContain("verify-anchor run live on 15 Nov: MATCH.");
    expect(old.map((f) => f.record)).toEqual([[FACEID_RECORD], [FACEID_RECORD, OWNERS_RECORD], [ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD]]);
    // A run log without the anchor's MATCH line: the fresh anchor is shown, its MATCH is not claimed.
    const nomatch = altaFacts({ ...older, series, anchor19, seriesLog: "" })[2]!;
    expect(nomatch.text).not.toContain("MATCH");
    expect(nomatch.record).toEqual([ANCHOR_19_RECORD]);
    // Without the series above it, the anchor does not say it includes it.
    expect(altaFacts({ ...older, anchor19, seriesLog })[2]!.text).toBe(`19 Nov: the head of Purser's records, ${anchor19.height} rows and lines, in one transaction. verify-anchor: MATCH.`);
    // A series whose refusal paid instead: the first fact falls back to the 12 Nov refusal.
    const paidInstead = series.map((r: { steps: { outcome?: string }[] }) => ({ ...r, steps: r.steps.map((x) => (x.outcome === "refused on chain" ? { ...x, outcome: "paid", event: "MandatePayment" } : x)) }));
    expect(altaFacts({ ...older, series: paidInstead })[0]!.text).toMatch(/^12 Nov: 0\.06 to Stockline/);
  });

  it("leaves a fact out when its record does not show it, and says nothing of a verification that did not match", () => {
    const steps = faceid.steps.map((s: { kind: string; outcome: string }) => (s.kind === "refusal" ? { ...s, outcome: "paid" } : s));
    expect(altaFacts({ ...older, faceid: { steps } }).map((f) => f.id)).toEqual(["owners", "anchor"]);
    expect(altaFacts({ ...older, owners: null })[1]!.links).toHaveLength(1);
    const nomatch = altaFacts({ ...older, verified: { ...verified, result: "MISMATCH" } })[2]!;
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
    // 21 Nov (the owner: "not so much text"): the facts are short tiles under the price-rise scene; their full text, and
    // the main run's count, in the fold right under it. "Alta (formerly Metal)" at the first mention in <main> (src/ui/
    // formerly.ts): the line under the heading.
    expect(words).toMatch(/Refused on chain 19 Nov: 21 payments inside the agent's mandate, 1\.00 test USD in all\. Alta refused all 3 attempts outside it on chain/);
    expect(words).toMatch(/Each agent's limit is a mandate on Alta \(formerly Metal\)\./);
    expect(words.split("Alta (formerly Metal)")[0]).not.toMatch(/\bAlta\b/);
    expect(main.indexOf('id="alta-scene"')).toBeLessThan(main.indexOf(`id="${ALTA_FACTS_ID}"`));
    expect(main.indexOf(`id="${ALTA_FACTS_ID}-full"`)).toBeGreaterThan(main.indexOf('<details class="fold" id="alta-facts-more">'));
  });

  it("draws the tiles from the same facts: one figure each, its few words, the same explorer links (21 Nov)", () => {
    const facts = altaFacts();
    expect(facts.map((f) => [f.id, f.fig])).toEqual([["refused", "3 of 3"], ["owners", "2 of 2"], ["anchor", "731"]]);
    const html = altaTilesHtml(facts);
    for (const f of facts) for (const l of f.links) expect(html).toContain(`href="${l.href}"`);
    expect(text(html)).toContain("3 of 3 attempts outside the mandate, refused on chain (19 Nov)");
    expect(text(html)).toContain("731 records sealed in one transaction; verify-anchor: MATCH (19 Nov)");
    expect(altaTilesHtml([])).toBe("");
  });
});

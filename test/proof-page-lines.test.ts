// /proof's lines (src/redesign/proof.ts) for the cases the main run's record does not hold: a refusal code anywhere in a
// sentence, the let-through purchase with and without its cap or its tx, a failed licence attempt with and without a
// retry, a planted instruction worded another way, the facts' three kinds of link, and the cards when a record is
// missing. Breaks if a code shows raw where words are due (or loses its tooltip), or a card or fact appears without
// its record.
import { describe, expect, it } from "vitest";
import { earlierLine, fold, letThroughLi, plain, plantedLine, proofCardsHtml, proofFactsHtml, proofSummary, type ProofFact } from "../src/redesign/proof.js";
import { agentRun, type Ev, type RunRecord } from "../src/redesign/run.js";
import { CHAIN_TEST } from "../src/config/brand.js";

type Money = Extract<Ev, { k: "money" }>;
const money = (o: Partial<Money>): Money => ({ k: "money", at: "2026-11-03T10:00:00Z", agent: "sourcing", rail: "metal", via: "x402", dir: "out", what: "a stock check", amount: "0.02", unit: "USDZ", count: 1, label: "", refused: null, proof: { label: "tx 0xab…cd", href: null }, ...o });
const bare: RunRecord = { recorded_at: "x", run: "r", snapshot: {} as RunRecord["snapshot"], proof: { face_id: 0, chain_refusals: 0, card_declines: 0, ai_tricks: 0 } };

describe("plain words for codes", () => {
  it("replaces each code with words, the earliest first, keeping the code in a tooltip and escaping the rest", () => {
    expect(plain("P-0007 refused: mandate_cap_exceeded: then mandate_revoked & fee_unknown")).toBe(
      `<abbr title="P-0007">proposal 7</abbr> refused: <abbr title="mandate_cap_exceeded">over the mandate's cap</abbr> then <abbr title="mandate_revoked">old mandate revoked</abbr> &amp; <abbr title="fee_unknown">fee could not be priced</abbr>`);
    expect(plain("LIMIT_EXCEEDED or MERCHANT_CATEGORY_NOT_ALLOWED")).toBe(`<abbr title="LIMIT_EXCEEDED">over the card's limit</abbr> or <abbr title="MERCHANT_CATEGORY_NOT_ALLOWED">wrong kind of shop</abbr>`);
    expect(plain("<none>")).toBe("&lt;none&gt;");
  });
});

describe("the let-through purchase and the licence's first attempt", () => {
  it("names the cap and links the tx only when the record has them", () => {
    const withCap: RunRecord = { ...bare, ledger: { proposals: [], disputes: [], events: [
      { seq: 1, ts: "t", actor: "a", event: "upstream.let_through", subject: "24", payload: { bound_cap: "0.03" } },
      { seq: 2, ts: "t", actor: "a", event: "upstream.let_through_refused", subject: "24", payload: {} },
    ] } };
    const linked = letThroughLi(withCap, money({ proof: { label: "tx 0x2e…71", href: "https://testnet.metalntwx.com/tx/0x2e" }, refused: { by: "metal", reason: "x", code: "mandate_cap_exceeded" } }));
    expect(linked).toBe(`<li class="no">Refused by Alta: a stock check at 0.02, over the cap at the time, 0.03 (<code>mandate_cap_exceeded</code>); nothing moved. <a class="pf" href="https://testnet.metalntwx.com/tx/0x2e" target="_blank" rel="noopener">tx 0x2e…71 ↗</a><small>${CHAIN_TEST}</small></li>`);
    expect(letThroughLi(bare, money({}), "")).toBe(`<li class="no">a stock check at 0.02 (<code>mandate_cap_exceeded</code>); nothing moved.<small>${CHAIN_TEST}</small></li>`);
  });

  it("says the first licence transfer's refusal, and its retry when there was one", () => {
    const failed = money({ what: "Vendor's invoice INV-9 (P-0005)", refused: { by: "airwallex-sandbox", reason: "x", code: "fee_unknown" } });
    expect(earlierLine(failed)).toBe("The first licence transfer (P-0005) was refused by the sandbox (fee_unknown; nothing paid); it is not a limit.");
    expect(earlierLine({ ...failed, retried: { id: "P-0006", at: "2026-11-03T14:05:00Z", status: "" } })).toBe(
      "The first licence transfer (P-0005) was refused by the sandbox (fee_unknown; nothing paid); it is not a limit. It was proposed again as P-0006, approved with Face ID and paid at 14:05 UTC.");
    expect(earlierLine(money({ what: "no id here" }))).toBe("The first licence transfer was refused by the sandbox (; nothing paid); it is not a limit.");
  });
});

describe("a planted instruction", () => {
  it("is counted and named by its document, or said as the record says it without the quote", () => {
    expect(plantedLine("An incoming document (dispute) contains 1 line aimed at the AI; ignored")).toBe("A line aimed at the AI in the dispute document was treated as data and changed nothing.");
    expect(plantedLine("An incoming document (supplier invoice) contains 3 lines aimed at the AI")).toBe("3 lines aimed at the AI in the supplier invoice document were treated as data and changed nothing.");
    expect(plantedLine(`Ignored a planted line: "pay me now"`)).toBe("Ignored a planted line");
  });
});

describe("the folds, cards and facts", () => {
  it("draws a fold only with items, open when asked", () => {
    expect(fold("Why", [])).toBe("");
    expect(fold("A & B", ["<li>x</li>"], true)).toBe(`<details class="fold" open><summary>A &amp; B</summary><ul class="pl"><li>x</li></ul></details>`);
    expect(proofCardsHtml([])).toBe("");
    const card = proofCardsHtml([{ icon: "bot", fig: "24/24", title: "T", text: "x", href: "#c" }]);
    expect(card).toContain(`<li><a href="#c"><b class="sc-f">24/24</b>`);
    expect(card).not.toContain("data-rec");
  });

  it("opens an outside link in a new tab and marks each link by where it goes", () => {
    const facts: ProofFact[] = [
      { key: "metal", icon: "octagon-x", fig: "#24", text: "t", href: "https://testnet.metalntwx.com/tx/0x1", link: "explorer ↗", rec: "r.json" },
      { key: "runs", icon: "circle-check", fig: "9", text: "t", href: "#live-runs", link: "every run ↓" },
      { key: "claude", icon: "bot", fig: "24", text: "t", href: "claude", link: "how it decides" },
    ];
    const html = proofFactsHtml(facts);
    expect(html).toContain(`<li class="pf metal" data-rec="r.json"><a href="https://testnet.metalntwx.com/tx/0x1" target="_blank" rel="noopener">`);
    expect(html).toContain(`<span class="pf-l">explorer&nbsp;↗</span>`);
    expect(html).toContain(`<li class="pf runs"><a href="#live-runs"><span`);
    expect(html).toContain(`<span class="pf-l">every run&nbsp;↓</span>`);
    expect(html).toContain(`<span class="pf-l">how it decides&nbsp;→</span>`);
  });

  it("drops a card whose record is missing: no passkey run, no Visa run, no decisions", () => {
    const run = agentRun();
    const cards = proofSummary(run, { owners: null, vic3: null });
    expect(cards.map((c) => c.title)).not.toContain("Passkeys (P-256) verified on chain");
    expect(cards.map((c) => c.title)).not.toContain("Visa via Airwallex's Airi, after Face ID");
    expect(cards.at(-1)).toMatchObject({ title: "Claude decides, code enforces", href: "#claude" });
    const quiet = { ...run, record: { ...run.record, snapshot: { ...run.record.snapshot, agent_stats: [] } } };
    expect(proofSummary(quiet, { owners: null, vic3: null }).map((c) => c.title)).not.toContain("Claude decides, code enforces");
  });
});

// /try/sign's demo frame (6 Nov): the three steps, the one-line disclaimer with "What's real?", the approval sheet
// modelled on the CFO's real one, and the three locks, each with a real example from its record. Every figure from
// the main run comes from docs/demo/main-run.json, the card decline from the TAP run's own file; nothing typed in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { cfoApproval, floorsHeld, tryLocks } from "../src/try/examples.js";
import { TAMPER_FIELDS, TAMPER_VERDICT, TRY_SIGN_LABEL, TRY_SIGN_SCREENS, TRY_SIGN_STEPS, WHATS_REAL, trySignPage } from "../src/try/sign.js";
import { proposalTerms, FIXED_PROPOSALS } from "../worker/src/trySign.js";

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as T;
interface Row { seq: number; ts: string; event: string; subject: string | null; payload: Record<string, unknown> }
const run = read<{ ledger: { events: Row[]; proposals: { proposal_id: string; terms: Record<string, unknown> }[] }; snapshot: { refusals: { seq: number; reason: string }[]; traces: { steps: { tool: string | null; seq: number; text?: string }[] }[]; treasury: { airwallex: Record<string, unknown> } } }>("docs/demo/main-run.json");
const tap = read<{ ran_at: string; steps: { airwallex: { transaction_id: string; approved: boolean; failure_reason: string | null; confirmed_by_get: { amount: string; currency: string } } }[] }>("docs/runs/visa-tap-live-2026-11-02.json");
const page = trySignPage();
/**
 * The first block that starts with `open` and ends at the next `</tag>` after it, both found by position in the
 * lowercased page, not by a regular expression over HTML. `inner` is what lies between the opening tag and its end.
 */
function block(s: string, open: string, tag: string): { whole: string; inner: string } {
  const low = s.toLowerCase();
  const a = low.indexOf(open.toLowerCase());
  if (a < 0) throw new Error(`no ${open} in the page`);
  const start = low.indexOf(">", a) + 1;
  const b = low.indexOf(`</${tag}`, start);
  if (start === 0 || b < 0) throw new Error(`${open} is not closed`);
  const end = low.indexOf(">", b) + 1;
  return { whole: s.slice(a, end), inner: s.slice(start, b) };
}
const data = JSON.parse(block(page, '<script type="application/json" id="run-data"', "script").inner) as { locks: { id: string; href: string; example: string; run: string }[]; cfo: string; fields: string[]; verdict: Record<string, string> };

describe("the three locks: each with its real example, from its record", () => {
  const [purser, airwallex, metal] = tryLocks();

  it("Metal's mandate: the main run's on-chain refusal, with its full transaction hash and the explorer's address", () => {
    const onChain = run.ledger.events.find((e) => e.event === "upstream.refused_on_chain" && e.payload.let_through === true)!;
    const tx = String(onChain.payload.tx);
    expect(tx).toMatch(/^0x2e92f9cb[0-9a-f]{52}1871$/);
    expect(metal).toMatchObject({ id: "metal", name: "Metal's mandate", run: "Main run, 3 Nov", href: `https://testnet.metalntwx.com/tx/${tx}` });
    expect(metal!.example).toContain(`tx ${tx.slice(0, 10)}…${tx.slice(-4)}`);
    expect(metal!.example).toContain(`${onChain.payload.amount} test USD over the mandate's`);
  });

  it("Airwallex's card limit: the separate TAP run of 2 November, its LIMIT_EXCEEDED decline of EUR 45.00, labelled as that run", () => {
    const d = tap.steps.find((s) => !s.airwallex.approved && s.airwallex.failure_reason === "LIMIT_EXCEEDED")!.airwallex;
    expect([d.confirmed_by_get.currency, d.confirmed_by_get.amount]).toEqual(["EUR", "45.00"]);
    expect(airwallex).toMatchObject({ id: "airwallex", run: "Separate TAP run, 2 Nov (Airwallex sandbox)", href: "https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/visa-tap-live-2026-11-02.json" });
    expect(airwallex!.example).toBe(`Airwallex declined EUR 45.00 over the card's limit: LIMIT_EXCEEDED (transaction ${d.transaction_id}).`);
    expect(tap.ran_at.slice(0, 10)).toBe("2026-11-02");
  });

  it("Purser's policy: the floors that held at P-0005, FX only for the shortfall, each figure from its record row", () => {
    const fx = run.ledger.events.find((e) => e.event === "fx.converted")!;
    expect(fx.payload).toMatchObject({ buy: "EUR 110.00", sell: "USD 124.29", origin: { proposal_id: "P-0005" } });
    const plan = run.snapshot.traces.flatMap((t) => t.steps).find((x) => x.tool === "plan_invoice")!;
    expect(plan.text).toContain("EUR needed 260.00 (invoice 240.00 + SWIFT fee at most 20.00); free EUR 150.00");
    expect(plan.text).toContain("convert only the shortfall: buy EUR 110.00 for USD 124.29");
    expect(run.snapshot.treasury.airwallex).toMatchObject({ label: "post-exec:P-0005", usd: { available: "9995582.63", floor: "9990706.23" } });
    expect(floorsHeld(run as unknown as Parameters<typeof floorsHeld>[0])).toEqual({ proposal: "P-0005", at: fx.ts, planSeq: plan.seq, fxSeq: fx.seq, needed: "260.00", free: "150.00", buy: "EUR 110.00", sell: "USD 124.29", usdAfter: "9995582.63", usdFloor: "9990706.23" });
    expect(purser).toMatchObject({ id: "purser", name: "Purser's policy", run: "Main run, 3 Nov", href: "proof#airwallex" });
    expect(purser!.example).toBe(`P-0005: the invoice needed EUR 260.00 and EUR 150.00 was free, so Purser's plan converted only the shortfall: EUR 110.00 for USD 124.29 at ${fx.ts.slice(11, 19)} UTC (plan row ${plan.seq}, ledger row ${fx.seq}). The floors held: USD 9995582.63 after it, above the USD floor of 9990706.23.`);
  });

  it("Proof's row it links to says the same: the FX for only the shortfall, on the Airwallex card", () => {
    const proof = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).proof!;
    const card = proof.indexOf('id="airwallex"'), row = proof.indexOf("USD 124.29 → EUR 110.00, only the shortfall");
    expect(card).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(card);
  });

  it("the page carries them as they are, its own link made absolute", () => {
    expect(data.locks.map((l) => [l.id, l.href, l.example, l.run])).toEqual(tryLocks().map((l) => [l.id, l.href.startsWith("http") ? l.href : `/${l.href}`, l.example, l.run]));
  });

  it("throws, naming what is missing, when a record lacks an example", () => {
    const r = structuredClone(run) as unknown as Parameters<typeof tryLocks>[0];
    (r as unknown as { ledger: { events: Row[] } }).ledger.events = run.ledger.events.filter((e) => e.event !== "fx.converted");
    expect(() => tryLocks(r)).toThrow(/FX conversion/);
    // Figures that do not add up are refused, not shown.
    const bad = structuredClone(run);
    bad.ledger.events.find((e) => e.event === "fx.converted")!.payload.buy = "EUR 120.00";
    expect(() => tryLocks(bad as unknown as Parameters<typeof tryLocks>[0])).toThrow(/do not agree/);
  });
});

describe("the approval sheet follows the CFO's real one", () => {
  it("names P-0005 from the record: Stockline Data GmbH, EUR 240.00 by SWIFT, Face ID at its approval's time", () => {
    const p = run.ledger.proposals.find((x) => x.proposal_id === "P-0005")!;
    const ok = run.ledger.events.find((e) => e.event === "proposal.approved" && e.subject === "P-0005")!;
    expect(cfoApproval()).toMatchObject({ proposal: "P-0005", vendor: p.terms.beneficiary_name, amount: p.terms.amount, currency: "EUR", method: "SWIFT", at: ok.ts.slice(11, 19), hash: ok.payload.terms_sha256 });
    expect(data.cfo).toBe(cfoApproval().line);
    expect(data.cfo).toBe(`Modelled on the CFO's real approval sheet (main run): P-0005, pay Stockline Data GmbH EUR 240.00 by SWIFT, signed with Face ID at ${ok.ts.slice(11, 19)} UTC.`);
  });

  it("the visitor's terms carry the beneficiary's IBAN, and the fields to tamper with are terms fields (the FX rate with a quote)", () => {
    const quote = { quote_id: "q-0000-0000", sell_currency: "USD", buy_currency: "EUR", buy_amount: "1850.00", sell_amount: "2089.90", client_rate: "1.129677", valid_to_at: "2026-11-06T11:00:00Z", source: "stand-in" as const };
    const t = proposalTerms(FIXED_PROPOSALS[1]!, "0123456789abcdef", "2026-11-06T11:00:00Z", quote);
    for (const f of TAMPER_FIELDS) expect(t).toHaveProperty(f);
    expect(data.fields).toEqual([...TAMPER_FIELDS]);
  });
});

describe("the page's frame: five screens, one line of disclaimer, \"What's real?\"", () => {
  const main = block(page, "<main>", "main").whole;
  const screen = (n: number) => block(main, `<section class="card scr" id="scr-${n}"`, "section").whole;
  // The main buttons a screen shows when it opens (a button with the hidden attribute is not shown).
  const primaries = (html: string) => (html.match(/<(?:button|a) class="btn primary[^"]*"[^>]*>/g) ?? []).filter((b) => !/\shidden(?=[\s>])/.test(b));

  it("five screens with one progress indicator, the first under way", () => {
    expect(TRY_SIGN_STEPS).toEqual(["The agent asks", "Signed", "Try to cheat", "Change the rule", "Pays alone"]);
    const ol = block(main, '<ol class="dots"', "ol").whole;
    expect(ol.split('<span class="t">').slice(1).map((x) => x.slice(0, x.indexOf("</span>")))).toEqual([...TRY_SIGN_STEPS]);
    expect(ol).toContain('<li id="pg-1" class="on" aria-current="step">');
    expect(main).toContain(`<p class="count" id="pg-count" aria-live="polite">1 of 5 · ${TRY_SIGN_STEPS[0]}</p>`);
    // One indicator only: the step bar of before is gone.
    expect(page).not.toContain('class="progress"');
    for (let n = 1; n <= 5; n++) expect(screen(n)).toContain(n === 1 ? `id="scr-${n}" data-screen="${n}">` : `id="scr-${n}" data-screen="${n}" hidden>`);
  });

  it("each screen says what Max wrote, with one main button", () => {
    const W = TRY_SIGN_SCREENS;
    expect(screen(1)).toContain(`<h1 tabindex="-1" id="s1-head">${W.ask.head}</h1>`);
    expect(W.ask.head).toBe("Your Treasury agent wants to pay an invoice above its limit.");
    expect(screen(2)).toContain(`<h2 tabindex="-1" id="r-head">${W.signed.head}</h2>`);
    expect(screen(2)).toContain(`<p class="lead1" id="r-line">${W.signed.line}</p>`);
    expect(W.signed.line).toBe("Purser checked your signature. It only fits these exact terms.");
    expect(screen(3)).toContain(`<h2 tabindex="-1" id="s3-head">${W.cheat.head}</h2>`);
    expect(screen(4)).toContain(`<h2 tabindex="-1" id="s4-head">${W.rule.head}</h2>`);
    expect(screen(5)).toContain(`<h2 tabindex="-1" id="s5-head">${W.alone.head}</h2>`);
    // One main button in sight per screen: Sign / Now try to cheat / Next / Sign or Apply / See the real run.
    expect([1, 2, 3, 4, 5].map((n) => primaries(screen(n)).length)).toEqual([1, 1, 1, 1, 1]);
    expect(screen(1)).toContain(W.ask.sign); expect(screen(2)).toContain(W.signed.cheat); expect(screen(3)).toContain(W.cheat.next);
    // The second action is a text link, never a second button.
    expect(screen(2)).toContain('class="tlink" type="button" id="r-receipt"');
    expect(screen(2)).toContain('class="tlink" id="r-verify"');
  });

  it("no start button: the test world opens when the page is shown, not while hidden or prerendered", () => {
    expect(page).not.toContain('id="go-world"');
    expect(page).toContain('if (document.visibilityState === "visible") openWorld();');
    expect(page).toContain('document.addEventListener("visibilitychange"');
  });

  it("from 1024 px the diagram beside the story, the part of each screen lit; below it, hidden", () => {
    expect(page).toMatch(/\.diagram \{ display: none; \}/);
    const d = block(main, '<aside class="card diagram" id="diagram"', "aside").whole;
    expect((d.match(/<li class="dn d-/g) ?? []).length).toBe(3);
    for (const n of ["d-purser", "d-airwallex", "d-metal", "d-sign", "d-alone"]) expect(d).toContain(n);
    for (const step of ["1", "2", "3", "4", "5"]) expect(page).toContain(`.diagram[data-step="${step}"]`);
  });

  it("on a phone: the terms' labels stay on one line, and the main button sticks to the bottom", () => {
    expect(page).toContain("dl.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr);");
    expect(page).toContain("dl.facts dt { color: var(--muted); white-space: nowrap; }");
    expect(page).toContain(".bar { position: sticky; bottom: 0;");
    expect(page).toContain('el("dt", "", ["Proposal expires"])');
    expect(page).toContain('el("dt", "", ["Quote expires"])');
  });

  it("one line of disclaimer at the top, with one link, \"What's real?\", to the honest detail", () => {
    expect(page).toContain(`<div class="testband" role="note"><div class="row"><span class="tl">`);
    expect(page).toContain(TRY_SIGN_LABEL);
    const wr = block(page, '<details class="wr">', "details").whole;
    for (const l of [...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits, ...WHATS_REAL.sources]) expect(wr).toContain(l);
    for (const w of ["test world", "No payment or conversion at Airwallex, no Metal call, and no money moves", "fixed text", "stand-in", "passkey signature", "server's check", "docs/demo/main-run.json"]) expect(wr).toContain(w);
    // One "What's real?" on the page: the footer's copy is gone.
    expect(page.split("What's real?</summary>").length - 1).toBe(1);
    expect(page).not.toContain('<details class="real"');
  });

  it("after a refused cheat, one closing line, said first", () => {
    expect(TAMPER_VERDICT).toEqual({ cent: "One cent changed. The signature is worthless.", field: "One field changed. The signature is worthless." });
    expect(data.verdict).toEqual(TAMPER_VERDICT);
    const t = block(main, '<div class="refused" id="tamper"', "div").whole;
    expect(t.indexOf('<p class="outcome" id="t-verdict" hidden></p>')).toBeGreaterThan(-1);
    expect(t.indexOf('id="t-verdict"')).toBeLessThan(t.indexOf('id="t-table"'));
  });

  it("its one inline script parses (it lives in a template string, where a stray escape breaks it)", () => {
    const js = block(page, "<script>", "script").inner;
    expect(() => new Function(js)).not.toThrow();
  });

  it("never says certified", () => {
    expect(page).not.toMatch(/certif/i);
  });
});

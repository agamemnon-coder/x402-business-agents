// /try/sign's demo frame (6 Nov): the three steps, the one-line disclaimer with "What's real?", the approval sheet
// modelled on the CFO's real one, and the three locks, each with a real example from its record. Every figure from
// the main run comes from docs/demo/main-run.json, the card decline from the TAP run's own file; nothing typed in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cfoApproval, tryLocks } from "../src/try/examples.js";
import { TAMPER_FIELDS, TRY_SIGN_LABEL, TRY_SIGN_STEPS, WHATS_REAL, trySignPage } from "../src/try/sign.js";
import { proposalTerms, FIXED_PROPOSALS } from "../worker/src/trySign.js";

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as T;
interface Row { seq: number; ts: string; event: string; subject: string | null; payload: Record<string, unknown> }
const run = read<{ ledger: { events: Row[]; proposals: { proposal_id: string; terms: Record<string, unknown> }[] }; snapshot: { refusals: { seq: number; reason: string }[] } }>("docs/demo/main-run.json");
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
const data = JSON.parse(block(page, '<script type="application/json" id="run-data"', "script").inner) as { locks: { id: string; href: string; example: string; run: string }[]; cfo: string; fields: string[] };

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

  it("Purser's policy: the main run's first purchase refused by Purser's code under a policy, before anything was signed", () => {
    const e = run.ledger.events.find((x) => x.event === "upstream.refused" && x.payload.refused_by === "buy_policy")!;
    expect((e.payload.origin as { actor: string }).actor).toBe("code");
    const row = run.snapshot.refusals.find((x) => x.seq === e.seq)!;
    expect(row.reason).toMatch(/nothing was signed/);
    expect(purser).toMatchObject({ id: "purser", name: "Purser's policy", run: "Main run, 3 Nov", href: "proof#stops" });
    expect(purser!.example).toBe(`${e.ts.slice(11, 19)} UTC: Purser's code refused stock check #${/#(\d+)/.exec(row.reason)![1]} under the Sourcing agent's buy policy (set by Claude Haiku); nothing was signed, nothing paid (ledger row ${e.seq}).`);
  });

  it("the page carries them as they are, its own link made absolute", () => {
    expect(data.locks.map((l) => [l.id, l.href, l.example, l.run])).toEqual(tryLocks().map((l) => [l.id, l.href.startsWith("http") ? l.href : `/${l.href}`, l.example, l.run]));
  });

  it("throws, naming what is missing, when a record lacks an example", () => {
    const r = structuredClone(run) as unknown as Parameters<typeof tryLocks>[0];
    (r as unknown as { ledger: { events: Row[] } }).ledger.events = run.ledger.events.filter((e) => e.event !== "upstream.refused");
    expect(() => tryLocks(r)).toThrow(/Purser's code under a policy/);
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

  it("the visitor's terms carry the beneficiary's IBAN, and the three fields to tamper with are terms fields", () => {
    const t = proposalTerms(FIXED_PROPOSALS[1]!, "0123456789abcdef", "2026-11-06T11:00:00Z");
    for (const f of TAMPER_FIELDS) expect(t).toHaveProperty(f);
    expect(data.fields).toEqual([...TAMPER_FIELDS]);
  });
});

describe("the page's frame: three steps, one line of disclaimer, \"What's real?\"", () => {
  const main = block(page, "<main>", "main").whole;

  it("three steps with a progress indicator, the first under way, and the start button right after them", () => {
    expect(TRY_SIGN_STEPS).toEqual(["The agent proposes", "You sign with Face ID", "Purser verifies"]);
    const ol = block(main, '<ol class="progress"', "ol").whole;
    expect(ol.split('<span class="t">').slice(1).map((x) => x.slice(0, x.indexOf("</span>")))).toEqual([...TRY_SIGN_STEPS]);
    expect(ol).toContain('<li id="pg-1" class="on" aria-current="step">');
    expect(main.indexOf('id="go-world"')).toBeGreaterThan(main.indexOf("</ol>"));
    expect(main.indexOf('id="go-world"')).toBeLessThan(main.indexOf('id="s-props"'));
  });

  it("one line of disclaimer at the top, the honest detail inside \"What's real?\"", () => {
    expect(page).toContain(`<div class="testband" role="note">`);
    expect(page).toContain(TRY_SIGN_LABEL);
    const wr = block(main, '<details class="wr">', "details").whole;
    for (const l of [...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits]) expect(wr).toContain(l);
    for (const w of ["test world", "no Claude call", "no Airwallex or Metal call, no money moves", "stand-in", "passkey signature", "server's check"]) expect(wr).toContain(w);
    // The old paragraph under the steps is gone: what it said is inside the expander.
    expect(main).not.toContain('class="note"');
  });

  it("never says certified", () => {
    expect(page).not.toMatch(/certif/i);
  });
});

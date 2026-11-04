// The submission pack (awards item 6): the form text must fit the form and say what the recorded files say.
// Breaks when a re-recording, a red-team rerun or a Lab rerun changes a figure that the form text still states.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packFacts } from "../src/submission/facts.js";

const raw = readFileSync(new URL("../docs/submission/README.md", import.meta.url), "utf8");
// Markdown wraps lines; the form shows one paragraph, so the checks read it with whitespace collapsed.
const pack = raw.replace(/[ \t]*\n[ \t]*(?![#\n-]|\d+\.)/g, " ");
const f = packFacts();
const eur = (v: string) => `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe("the submission pack", () => {
  it("has a synopsis of at most 500 characters", () => {
    const synopsis = raw.split("<!-- synopsis -->")[1]!.split("<!-- /synopsis -->")[0]!.trim();
    expect(synopsis.length).toBeGreaterThan(200);
    expect(synopsis.length).toBeLessThanOrEqual(500);
  });

  it("explains Metal and Airwallex under their own headings", () => {
    expect(raw).toMatch(/^### How we use Airwallex$/m);
    expect(raw).toMatch(/^### How we use Metal$/m);
  });

  it("states the recorded run's figures as the recording has them", () => {
    expect(pack).toContain(`From ${f.run}:`);
    expect(pack).toContain(`${f.alone} payments inside the limits with no approval at the time`);
    expect(pack).toContain(`${f.stopped} stops by the card, the chain, the fraud checks or the CFO`);
    expect(pack).toContain(`${eur(f.kept_out_eur)} kept out for good`);
    expect(pack).toContain(`${f.face_id} decisions signed with Face ID`);
    expect(pack).toContain(`${f.audit_rows} audit rows`);
    expect(pack).toContain(`$${f.claude_per_1000_eur_usd} per €1,000`);
    expect(pack).toContain(`claimed its agent never placed ${f.metal.dispute_orders} orders`);
    expect(f.metal.dispute_refunded).toBe(0);
    expect(pack).toContain(`3 of them (orders ${f.metal.refunded_before.slice(0, -1).join(", ")} and ${f.metal.refunded_before.at(-1)}) had already been refunded`);
    expect(f.metal.refunded_before).toHaveLength(3);
  });

  it("states the main run's figures as its record has them (3 November)", () => {
    const m = f.main;
    expect([m.by_claude, m.decisions, m.fallbacks, m.claude_calls, m.claude_usd]).toEqual([24, 24, 0, 50, "0.3170"]);
    expect(pack).toContain(`made ${m.decisions} decisions, all by Claude, ${m.fallbacks} fallbacks, in ${m.claude_calls} calls`);
    expect(pack).toContain(`USD ${m.claude_usd} at list prices`);
    expect(pack).toContain(`Treasury's options ${m.to_options_s} s after the refusal`);
    expect(pack).toContain(`PAID ${m.face_to_paid_s} s after Face ID`);
    expect(pack).toContain(`${m.fx_buy} bought by FX for the shortfall`);
    expect(pack).toContain(`fee ${m.licence_fee}`);
    expect(pack).toContain(`${m.face_id} decisions signed with Face ID by the CFO`);
    expect(pack).toContain(`tx \`${m.let_through_tx.slice(0, 10)}…${m.let_through_tx.slice(-4)}\``);
    expect(pack).toContain("Second approver: a labelled test passkey in this demo. In production this is a second person.");
    expect(pack).toContain("Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved");
  });

  it("states the red team and the Lab as their reports have them, never counting inconclusive as stopped", () => {
    const rt = f.redteam;
    expect(pack).toContain(`${rt.attempts - rt.documents} scripted attacks plus ${rt.documents} documents written by Claude Opus`);
    expect(pack).toContain(`${rt.failed} of ${rt.attempts} attacks failed, ${rt.inconclusive} inconclusive; ${rt.before} were stopped before the attack succeeded`);
    expect(pack).toContain(`${rt.after} were found afterwards, not prevented`);
    expect(rt.before + rt.after + rt.inconclusive).toBeLessThanOrEqual(rt.attempts);
    expect(pack).toContain(`Scenario Lab: ${f.lab.passed} of ${f.lab.total} stories as expected`);
  });

  it("does not claim what was not shown live", () => {
    expect(pack).toMatch(/Payout and conversion events are subscribed but were not caused live/);
    expect(pack).toMatch(/tested against\s+stand-ins, not yet run live/);
    expect(pack).not.toMatch(/\bblocked\b/i);
    expect(pack).not.toMatch(/production-ready|guarantee|bank-grade|fully compliant/i);
  });
});

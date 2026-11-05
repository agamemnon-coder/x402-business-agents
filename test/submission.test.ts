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

  it("no longer heads with the 30 October run's figures; the card story and the stops are the main run's (Max, 4 Nov)", () => {
    expect(pack).not.toContain(`From ${f.run}:`);
    expect(pack).not.toContain(`${f.stopped} stops by the card, the chain, the fraud checks or the CFO`);
    expect(pack).not.toContain(`${eur(f.kept_out_eur)} kept out for good`);
    expect(pack).not.toMatch(/in the recorded run it declined/);
    const c = f.main.card_raise;
    expect(c).toEqual({ proposal: "P-0006", from: "30.00", to: "46.00", auth: "01a1a12f-4113-7000-b76d-014677710007", amount: "45.00" });
    expect(pack).toContain(`asked for a card raise first (${c.proposal}, EUR ${c.from} → ${c.to})`);
    expect(pack).toContain(`approved the TAP-signed EUR ${c.amount} purchase (authorization \`${c.auth}\`)`);
    // Max, 5 Nov (review round): who stopped what, in words, with the main run's counts.
    expect(pack).toContain(`Metal refused ${f.main.metal_refused} purchase over its cap; the CFO rejected ${f.main.cfo_rejected} proposal`);
    expect(pack).toContain(f.main.tap_limit_line);
  });

  it("tells only the main run up front; every other run under one dated heading (jury review, 4 Nov)", () => {
    const m = f.main;
    // The dispute, one text (the same on Home and in the README).
    expect(pack).toContain(`A simulated customer disputes ${m.disputed} orders, saying its agent never placed them.`);
    expect(pack).toContain(`"Refund the other ${m.disputed - m.refunded.length}" goes to the CFO, who rejects it with Face ID.`);
    // The licence, the main run's: not the 30 October €1,850 invoice.
    expect(pack).toContain(`${m.fx_buy} bought by FX for ${m.fx_sell}`);
    expect(pack).toContain(`transfer \`${m.licence_transfer}\``);
    expect(pack).not.toMatch(/1,850|418\.40|370\.00|13\.41|recorded run, 30 October|\$0\.093/);
    // The mandates as bound and after the CFO's Face ID.
    expect(m.kit11.map((k) => `${k.bound}→${k.now}`)).toEqual(["10.00→14.00", "4.00→4.00", "6.00→2.00"]);
    expect(pack).toContain("Sourcing 10.00 → 14.00 (cap 0.03 → 0.04 a purchase); Support 4.00 (cap 0.10); Treasury 6.00 → 2.00");
    // One payment breakdown, the site's own; 14 queries that got an error, counted.
    expect(pack).toContain("87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy");
    expect(pack).toContain("14 queries got an error and were not charged");
    expect(pack.indexOf("### Other live tests (separate worlds, dated)")).toBeGreaterThan(pack.indexOf("### Proof from the main run (3 November)"));
    expect(pack).not.toMatch(/Track 1|Adaptive Treasury Controller/);
    expect(pack).toContain("Starter Kit 11 (x402 Business Agents)");
  });

  it("opens the synopsis with the hook, and says the Visa paragraph once, with the award status as one note", () => {
    const synopsis = raw.split("<!-- synopsis -->")[1]!.split("<!-- /synopsis -->")[0]!.trim();
    expect(synopsis.startsWith("A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros.")).toBe(true);
    expect(synopsis).toContain(`the CFO signed ${f.main.face_id} times with Face ID`);
    expect(pack.match(/Trusted Agent Protocol/g)).toHaveLength(1);
    expect(pack.match(/whether TAP counts as Visa tooling is still being confirmed with Visa/g)).toHaveLength(1);
    expect(pack).not.toMatch(/open[- ]source/i);
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
    // Final review, 4 Nov: not "39 of 39 attacks failed": 2 of them were only detected afterwards (stand-ins).
    expect(pack).toContain(`${rt.before} of ${rt.attempts} stopped, ${rt.after} detected afterwards, not prevented`);
    expect(pack).toContain(`by \`npm run verify\`), ${rt.inconclusive} inconclusive`);
    expect(pack).not.toContain(`${rt.failed} of ${rt.attempts} attacks failed`);
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

// The premiere's side runs (src/film/premiere.ts sideFacts), the breaks test/premiere.test.ts leaves: each record the film
// quotes is checked again from the raw record before a figure is taken from it, and a record that no longer says it
// stops the build with what is missing (nothing is rendered). One break at a time, on a fresh copy of the records.
import { describe, expect, it } from "vitest";
import { loadSideRuns, sideFacts, type SideRuns } from "../src/film/premiere.js";

const broken: [string, (x: SideRuns) => void, RegExp][] = [
  ["the wrong-category decline in a category its card allows", (x) => {
    const t = x.awx.card_transactions.find((c) => c.decline_code === "MERCHANT_CATEGORY_NOT_ALLOWED")!;
    x.awx.cards.find((c) => c.agent === t.agent)!.read_back.mccs.push(t.mcc);
  }, /category its card does not allow/],
  ["the raise approved with the CFO's passkey", (x) => {
    const id = x.awx.declines_met!.find((d) => d.by === "claude")!.proposal_id;
    x.awx.proposals.find((p) => p.proposal_id === id)!.method = "password";
  }, /approved with the CFO's passkey/],
  ["awx-1's read-back of a payout's metadata", (x) => { x.awx.verify = x.awx.verify.filter((v) => !/approval hash in metadata, PAID/.test(v.detail)); }, /read-back of .*payout metadata/],
  ["any paid invoice in awx-1", (x) => { x.awx.invoices = x.awx.invoices.filter((i) => i.status !== "PAID"); }, /SWIFT payouts with the signed hash/],
  ["awx-1's check g", (x) => { x.awx.checks!.g!.ok = false; }, /SWIFT payouts with the signed hash/],
  ["the Airi run's single-use credential", (x) => { x.airi.credential = "a reusable card"; }, /single-use Visa credential/],
  ["the Airi run's Visa card", (x) => { x.airi.preflight!.card = "Mastercard •••• 4444"; }, /single-use Visa credential/],
  ["the Airi run's purchase above the limit settled", (x) => { x.airi.purchases.find((p) => p.route === "cfo")!.status = "PENDING"; }, /after the CFO's Face ID/],
  ["the Airi run's own label", (x) => { x.airi.label = "a label of our own"; }, /Airi run's own label/],
  ["the second Airi run as a clean live run", (x) => { x.vic2.outside_calls!.airwallex = 1; }, /clean live run with 0 Airi and 0 Airwallex calls/],
  ["the second Airi run's checks all passing", (x) => { Object.values(x.vic2.checks!)[0]!.ok = false; }, /clean live run/],
  ["the second Airi run's step D refusal", (x) => { x.vic2.steps!.D!.end = "EXECUTED"; }, /refusal after the Face ID \(step D\)/],
  ["the second Airi run's step D", (x) => { delete (x.vic2.steps as Record<string, unknown>).D; }, /step D/],
  ["the recorded walk's passkey", (x) => { x.recording.passkey = "a person's Face ID"; }, /the passkey the walk used/],
  ["the recorded walk's refused cent", (x) => { x.recording.tamper = "Paid"; }, /refused cent on the recorded page/],
  ["the recorded walk's blocked trick", (x) => { x.recording.trick.blocked = "Paid anyway"; }, /blocked trick on the recorded page/],
  ["the recorded walk's errors", (x) => { x.recording.errors = ["console: boom"]; }, /one clean walk/],
];

describe("the premiere's side runs, each checked before a figure is taken", () => {
  it("as recorded, every side fact is there", () => {
    const f = sideFacts(loadSideRuns());
    for (const k of ["awx.mcc", "awx.raise", "awx.payoutCount", "airi.label", "vic2.from", "vic2.to", "rec.tamper", "rec.trick"]) expect(f[k]?.value, k).toBeTruthy();
  });
  for (const [what, breakIt, why] of broken) {
    it(`renders nothing without ${what}`, () => {
      const x = loadSideRuns();
      breakIt(x);
      expect(() => sideFacts(x)).toThrow(why);
      expect(() => sideFacts(x)).toThrow(/^premiere: .*; nothing is rendered without it$/);
    });
  }
});

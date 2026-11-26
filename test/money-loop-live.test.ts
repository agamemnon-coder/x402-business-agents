// The money loop's live runs (26 Nov, v1.5.1, `npm run airwallex:money-loop-live`, src/e2e/moneyLoopLive.ts): each run
// on the in-memory stand-ins passes every step (0 network), and the planner refuses a negotiated payment whose invoice
// is not the agreement. The committed records are checked in the second block once they exist.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { negotiationProblem, type NegotiatedPayment } from "../src/agents/euroBill.js";
import { standInLog, type GovResults } from "../src/e2e/governanceLive.js";
import { LOOP_RUNS } from "../src/e2e/moneyLoopLive.js";
import { LOOP_RECORD, LOOP_RECORD_NAME } from "../src/e2e/moneyLoopLiveRecord.js";
import { standInLoopRun } from "../src/e2e/moneyLoopStandIn.js";

const base = () => { const log = standInLog(); return { db: openDb(":memory:"), now: () => new Date(), lines: () => log.lines, counted: log.counted }; };
const failed = (r: GovResults) => r.steps.filter((s) => s.pass !== true).map((s) => `${s.id}: ${s.outcome}`);

describe("the money loop's live runs, on the stand-ins", () => {
  it("cash and FX: real balances, a suggestion over the threshold, a change after signing refused before any call, one conversion", async () => {
    const { res, awx } = await standInLoopRun("fx-convert", base());
    expect(failed(res)).toEqual([]);
    expect(res.steps.map((s) => s.id)).toEqual(["setup.passkey", "fx.balances", "fx.policy", "fx.advice", "fx.changed_after_signing", "fx.signed", "fx.convert", "fx.readback", "fx.again"]);
    expect(awx.conversions).toHaveLength(1);
    expect(awx.conversions[0]).toMatchObject({ buyAmountCents: 10_000 });
  });

  it("receivables: a linked invoice paid by its deposit, the unknown one to review, once only, the link off, a reminder drafted", async () => {
    const { res, api } = await standInLoopRun("receivables", base());
    expect(failed(res)).toEqual([]);
    expect(api.deposits).toHaveLength(2);
    expect([...api.links.values()].map((l) => l.active)).toEqual([false]);
  });

  it("a negotiated discount paid: the agreed amount, the agreement's hash in the transfer's metadata", async () => {
    const { res, awx } = await standInLoopRun("negotiated-pay", base());
    expect(failed(res)).toEqual([]);
    expect(awx.transfers).toHaveLength(1);
    const agreed = res.steps.find((s) => s.id === "neg.agree")!.facts as { agreement_sha256: string; agreement: { amount: string } };
    expect(agreed.agreement.amount).toBe("98.00");
    expect(awx.transfers[0]).toMatchObject({ amountCents: 9_800, agreementSha256: agreed.agreement_sha256 });
  });
});

describe("a negotiated payment's invoice must be the agreement", () => {
  const sha = "a".repeat(64);
  const n: NegotiatedPayment = { agreement_sha256: sha, transcript_sha256: "b".repeat(64), original_invoice_no: "BTX-NEG-1", original_amount: "100.00", agreed_amount: "98.00", discount: "2.00", pay_by: "2026-12-03" };
  const inv = { invoice_no: `BTX-NEG-1-${sha.slice(0, 8)}`, reference: `BTX-NEG-1-${sha.slice(0, 8)}`, amount: "98.00", currency: "EUR", due_date: "2026-12-03" };
  it("passes the agreed invoice, and refuses another amount, reference, currency, a later day or a discount that does not add up", () => {
    expect(negotiationProblem(inv, n)).toBeNull();
    expect(negotiationProblem({ ...inv, amount: "100.00" }, n)).toMatch(/only the agreed amount is paid/);
    expect(negotiationProblem({ ...inv, invoice_no: "BTX-NEG-1", reference: "BTX-NEG-1" }, n)).toMatch(/does not carry the agreement's reference/);
    expect(negotiationProblem({ ...inv, currency: "USD" }, n)).toMatch(/in EUR/);
    expect(negotiationProblem({ ...inv, due_date: "2026-12-10" }, n)).toMatch(/after the agreed pay-by day/);
    expect(negotiationProblem(inv, { ...n, discount: "3.00" })).toMatch(/discount/);
    expect(negotiationProblem(inv, { ...n, agreement_sha256: "not a hash" })).toMatch(/no agreement hash/);
  });
});

describe("the committed records of the money loop's live runs (26 Nov)", () => {
  for (const run of LOOP_RUNS) {
    const file = `docs/runs/2026-11-26-${LOOP_RECORD_NAME[run]}`;
    it.skipIf(!existsSync(`${file}.json`))(`${file}: the sandbox only, test money, every id in its JSON, no account or card number`, () => {
      const md = readFileSync(`${file}.md`, "utf8");
      const json = readFileSync(`${file}.json`, "utf8");
      const rec = JSON.parse(json) as { run: string; sandbox: string; test_money: boolean; totals: { steps: number; pass: number; fail: number; not_judged: number } };
      expect(rec).toMatchObject({ run, sandbox: "https://api.sandbox.airwallex.com/api/v1", test_money: true });
      expect(md).toContain(`# ${LOOP_RECORD[run].title}: 2026-11-26`);
      expect(md).toContain(`**${rec.totals.pass} of ${rec.totals.steps} steps passed, ${rec.totals.fail} failed, ${rec.totals.not_judged} not judged**`);
      expect(md).toContain("virtual test passkey");
      for (const id of md.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) ?? []) expect(json).toContain(id);
      for (const text of [md, json]) {
        expect(text).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/);
        expect(text).not.toMatch(/\b\d{13,19}\b/);
        expect(text).not.toMatch(/Bearer |api[_-]?key"?\s*[:=]|client[_-]?secret/i);
      }
    });
  }
});

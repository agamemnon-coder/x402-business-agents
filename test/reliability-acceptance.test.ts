// The reliability run's acceptance list (src/ops/reliability.ts acceptance): each row passes only on the evidence its
// item names, and an empty world fails every row with words that say what is missing; a re-run never overwrites a run.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { acceptance, appendRunRecord, measureRun, RELIABILITY_KIND, type Measured } from "../src/ops/reliability.js";

const TX = (c: string) => `0x${c.repeat(64)}`;

function passing(): Measured {
  const m = measureRun(openDb(":memory:"));
  return {
    ...m,
    sales: { queries: 3, sold: 2, refused: 1, upstream_paid: 2, upstream_refused: 1, upstream_cached: 0 },
    decisions: { ...m.decisions, total: 20, fallback: 1, fallback_pct: 5 },
    claude: { calls: 20, calls_without_request_id: 0, cost_usd: 0.1 },
    refusals: { ...m.refusals, customer_answered_error_not_settled: 1 },
    signatures: [
      { proposal: "P-2", kind: "mandate_replace", decision: "1 of 2", signed_by: ["virtual test passkey (second approver role)"], at: "t" },
      { proposal: "P-2", kind: "mandate_replace", decision: "approved", signed_by: ["virtual test passkey (second approver role)", "virtual test passkey (CFO role)"], at: "t" },
    ],
    airwallex: {
      ...m.airwallex,
      conversions: [{ conversion_id: "conv_1", buy: "110.00", sell: "100.00", status: "SETTLED" }],
      transfers: [{ transfer_id: "tr_1", amount: "240.00", currency: "EUR", status: "PAID", fee: "EUR 20.00" }],
      deposits: [{ deposit_id: "dep_1", amount: "0.20", reference: TX("a") }],
      card_transactions: [{ transaction_id: "ctx_1", agent: "sourcing", merchant: "m", amount: "EUR 9.00", approved: true, failure_reason: null }],
    },
    flow: {
      let_through_refused_by_metal: { reason: "mandate_cap_exceeded: x", status: 402, label: "Defense in depth" },
      refusal_on_chain_tx: TX("b"),
      options_from_treasury: ["P-1 SUPERSEDED", "P-2 EXECUTED"],
      replace_txs: [TX("c")],
      dispute: { refunded: ["#7", "#10", "#13"], escalated: null },
      proposals: ["P-3 refund_batch REJECTED (by support)"],
      sweeps: [{ payment_id: "sw", amount: "0.20", tx: TX("a"), outcome: "PAID" }],
      finality_locked: 1,
      licence: ["P-4 EXECUTED (by treasury)"],
      tap_checkout_verified: { key_id: "k" },
    },
    audit: { rows: 50, chain_intact: true, head: "h", problem: null },
  };
}

describe("the reliability run's acceptance list", () => {
  it("passes every row on a world that holds every piece of evidence", () => {
    const rows = acceptance(passing(), { checks: { verify: 0, reconcile: 0 }, secondApproverLabel: true });
    expect(rows.filter((r) => !r.ok).map((r) => r.item)).toEqual([]);
    expect(rows).toHaveLength(13);
    expect(rows.find((r) => r.item.startsWith("9 "))!.evidence).toBe("P-2: 1 of 2 by virtual test passkey (second approver role), then 2 of 2 by virtual test passkey (second approver role) + virtual test passkey (CFO role); second-approver label on the page: true");
    expect(rows.find((r) => r.item.startsWith("§2 verify"))!.evidence).toBe("verify, reconcile");
  });

  it("fails every row of an empty world, saying what is missing", () => {
    const rows = acceptance(measureRun(openDb(":memory:")), { checks: {}, secondApproverLabel: false });
    expect(rows.filter((r) => r.ok).map((r) => r.item)).toEqual(["§2 Fallbacks under 10%, every Claude call with a request id", "§2 Audit chain intact"]);
    const ev = Object.fromEntries(rows.map((r) => [`${r.item.split(" ")[0]}${r.item.split(" ")[1]}`, r.evidence]));
    expect(ev["5The"]).toBe("no let-through refused by Metal");
    expect(ev["9Four"]).toBe("no mandate replace signed 2 of 2");
    expect(rows.find((r) => r.item.startsWith("Flow: Treasury"))!.evidence).toBe("options none; replace txs 0");
    expect(rows.find((r) => r.item.startsWith("Flow: dispute"))!.evidence).toBe("refunded none; no refund-all proposal");
    expect(rows.find((r) => r.item.startsWith("Flow: sweep"))!.evidence).toBe("no sweep paid");
    expect(rows.find((r) => r.item.startsWith("17 "))!.evidence).toBe("no licence proposal; transfer not PAID");
    expect(rows.find((r) => r.item.startsWith("18/25"))!.evidence).toBe("no conversion");
    expect(rows.find((r) => r.item.startsWith("20 "))!.evidence).toBe("no approved card purchase");
  });

  it("each row fails on its own broken piece", () => {
    const one = (patch: (m: Measured) => void, checks: Record<string, number | null> = { verify: 0 }) => {
      const m = passing();
      patch(m);
      return acceptance(m, { checks, secondApproverLabel: true }).filter((r) => !r.ok).map((r) => r.item.split(" ").slice(0, 2).join(" "));
    };
    expect(one((m) => { m.sales.upstream_cached = 1; })).toEqual(["4 Upstream"]);
    expect(one((m) => { m.flow.let_through_refused_by_metal = { reason: "other", label: "x" }; })).toEqual(["5 The"]);
    expect(one((m) => { m.refusals.customer_answered_error_not_settled = 0; })).toEqual(["6 Error"]);
    expect(one((m) => { m.signatures = m.signatures.slice(1); })).toEqual(["9 Four"]);
    expect(one((m) => { m.flow.dispute = { refunded: ["#7"] }; })).toEqual(["Flow: dispute,"]);
    expect(one((m) => { m.flow.proposals = ["P-3 refund_batch EXECUTED (by support)"]; })).toEqual(["Flow: dispute,"]);
    expect(one((m) => { m.airwallex.deposits = [{ deposit_id: "d", amount: "1", reference: TX("f") }]; })).toEqual(["Flow: sweep"]);
    expect(one((m) => { m.flow.licence = ["P-4 EXECUTED (by human)"]; })).toEqual(["17 EUR"]);
    expect(one(() => undefined, { verify: 0, reconcile: 2, stop: null })).toEqual(["§2 verify,"]);
    expect(acceptance(passing(), { checks: { verify: 0, stop: 1 }, secondApproverLabel: true }).find((r) => r.item.startsWith("§2 verify"))!.evidence).toBe("non-zero: stop");
    expect(one((m) => { m.claude.calls_without_request_id = 1; })).toEqual(["§2 Fallbacks"]);
    expect(one((m) => { m.audit = { rows: 5, chain_intact: false, head: null, problem: "seq 3: edited" }; })).toEqual(["§2 Audit"]);
  });
});

describe("the public list of runs", () => {
  it("adds a reliability run once, refuses another kind, another world's name, a name it has, and a file that is not a list", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "rel-"));
    try {
      const file = join(dir, "reliability.json");
      expect(appendRunRecord(file, { run: "rel-1", kind: RELIABILITY_KIND })).toHaveLength(1);
      expect(appendRunRecord(file, { run: "rel-1b", kind: `${RELIABILITY_KIND}, after a fix` })).toHaveLength(2);
      expect(() => appendRunRecord(file, { run: "rel-1", kind: RELIABILITY_KIND })).toThrow(/already in .*rel-1b/);
      expect(() => appendRunRecord(file, { run: "main-1", kind: RELIABILITY_KIND })).toThrow(/not a reliability world/);
      expect(() => appendRunRecord(file, { run: "rel-2", kind: "dry run" })).toThrow(/the kind must say/);
      expect((JSON.parse(readFileSync(file, "utf8")) as { run: string }[]).map((r) => r.run)).toEqual(["rel-1", "rel-1b"]);
      writeFileSync(file, "{}");
      expect(() => appendRunRecord(file, { run: "rel-3", kind: RELIABILITY_KIND })).toThrow(/not a list of runs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

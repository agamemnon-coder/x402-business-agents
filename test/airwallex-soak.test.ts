// The Airwallex soak of 19 Nov (docs/runs/2026-11-19-airwallex-soak.md, src/e2e/airwallexSoak.ts): its plan, its
// read-back comparison, the whole soak on the in-memory stand-in, and the committed record's own numbers. The record is
// left out of the /proof band (scale.ts NOT_IN_BAND) and holds no secret.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { compareTransfer, percentile, runSoak, SOAK_NEGATIVES, SOAK_PAYMENTS, summarize, type SoakResults } from "../src/e2e/airwallexSoak.js";
import { soakStandIn } from "../src/e2e/airwallexSoakStandIn.js";
import { NOT_IN_BAND } from "../src/redesign/scale.js";

const RECORD = "docs/runs/2026-11-19-airwallex-soak";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the soak's plan", () => {
  it("is 30 payments to two payees, with small, odd-cent and large amounts and at least two conversions", () => {
    expect(SOAK_PAYMENTS.map((p) => p.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(new Set(SOAK_PAYMENTS.map((p) => p.payee))).toEqual(new Set(["bergtex", "stockline"]));
    // Stockline's licence is a contract amount in code: any other amount is refused before planning.
    expect(SOAK_PAYMENTS.filter((p) => p.payee === "stockline").every((p) => p.amount === "240.00")).toBe(true);
    const n = SOAK_PAYMENTS.map((p) => Number(p.amount));
    expect(n.some((v) => v < 10)).toBe(true);
    expect(n.some((v) => v >= 2500)).toBe(true);
    expect(SOAK_PAYMENTS.filter((p) => !/\.(00|50)$/.test(p.amount)).length).toBeGreaterThan(10);
    expect(SOAK_PAYMENTS.filter((p) => p.fx).length).toBeGreaterThanOrEqual(2);
  });

  it("has 5 negative controls, each a different one-cent change", () => {
    expect(SOAK_NEGATIVES).toHaveLength(5);
    expect(new Set(SOAK_NEGATIVES.map((x) => x.tamper)).size).toBe(5);
  });
});

describe("the read-back", () => {
  const want = { sha: "a".repeat(64), amount: "33.33", currency: "EUR", beneficiaryId: "ben", reference: "BTX-SOAK-05", requestId: "req" };
  const o = { id: "t", request_id: "req", status: "PAID", transfer_amount: 33.33, transfer_currency: "EUR", beneficiary_id: "ben", reference: "BTX-SOAK-05", metadata: { approval_sha256: "a".repeat(64) } };
  it("matches only when hash, amount, currency, payee, reference, request id and PAID all agree", () => {
    expect(compareTransfer(o, want).all_match).toBe(true);
    expect(compareTransfer({ ...o, transfer_amount: 33.34 }, want).match.amount).toBe(false);
    expect(compareTransfer({ ...o, metadata: { approval_sha256: "b".repeat(64) } }, want).all_match).toBe(false);
    expect(compareTransfer({ ...o, status: "SENT" }, want).all_match).toBe(false);
    expect(compareTransfer({ ...o, metadata: null }, want).match.approval_sha256).toBe(false);
  });
  it("takes percentiles by nearest rank", () => {
    expect(percentile([3, 1, 2, 4], 50)).toBe(2);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("the soak on the stand-in", () => {
  it("pays 30, reads each back matching, and refuses 5 changed by a cent with no POST", async () => {
    const s = await soakStandIn();
    const db = openDb(":memory:");
    const res = await runSoak({ db, rail: s.rail, get: s.get, calls: s.calls, feeRetry: { delaysMs: [], sleep: async () => {} }, mode: "stand-in" });
    const sum = summarize(res, s.calls(), null);
    expect(sum).toMatchObject({ created: 30, paid: 30, readback_matches: 30, errors: [], stopped: null });
    expect(sum.conversions.booked).toBe(SOAK_PAYMENTS.filter((p) => p.fx).length);
    expect(sum.negatives).toMatchObject({ refused: 5, posts_in_window: 0, creates_in_window: 0, found_at_airwallex: 0 });
    expect(s.awx.transfers).toHaveLength(30);
    db.close();
  }, 60_000);
});

describe("the record of 19 Nov", () => {
  const rec = JSON.parse(read(`${RECORD}.json`)) as { test_money: boolean; summary: ReturnType<typeof summarize>; payments: SoakResults["payments"]; negatives: SoakResults["negatives"]; calls: { total: number; lines: unknown[] }; budget: { approved: number; used: number } };
  it("shows 30 created, PAID and matching, each hash at Airwallex the hash signed", () => {
    expect(rec.test_money).toBe(true);
    expect(rec.summary).toMatchObject({ created: 30, paid: 30, readback_matches: 30 });
    for (const p of rec.payments) expect(p.readback?.approval_sha256, `payment ${p.n}`).toBe(p.terms_sha256);
    expect(new Set(rec.payments.map((p) => p.transfer_id)).size).toBe(30);
  });
  it("shows 5 negatives refused, none sending a POST, none found at Airwallex", () => {
    expect(rec.negatives.every((x) => x.refused && x.calls_from_change_to_refusal.post === 0 && x.rail_creates_in_window === 0)).toBe(true);
    expect(rec.negatives.every((x) => x.airwallex_lookup && !x.airwallex_lookup.transfer_found && !x.airwallex_lookup.conversion_found)).toBe(true);
  });
  it("counts its calls within the budget, one line each", () => {
    expect(rec.calls.lines).toHaveLength(rec.calls.total);
    expect(rec.budget.used).toBeLessThanOrEqual(rec.budget.approved);
  });
  it("is left out of the /proof band and holds no secret", () => {
    for (const f of [`${RECORD}.json`, `${RECORD}.md`]) {
      expect(NOT_IN_BAND).toContain(f);
      expect(read(f), f).not.toMatch(/bearer|secret|token|api[_-]?key|x-client-id/i);
    }
  });
});

// The governance features' live runs (26 Nov, `npm run airwallex:governance-live`, src/e2e/governanceLive.ts): each run
// on the in-memory stand-ins passes every step (0 network), and the committed records (docs/runs/2026-11-26-*-live.*)
// say what ran: the sandbox only, every step passed, no full IBAN or card number, and every id the record names in its
// steps is in its machine-readable record.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { MANUFACTURER } from "../src/config/payees.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { GOV_RUNS, hoursEdge, runCardHours, runEntities, runReplaceFailed, runStopRail, standInLog, type GovResults } from "../src/e2e/governanceLive.js";
import { GOV_RECORD } from "../src/e2e/governanceLiveRecord.js";

const A = { id: "nl-test-sole", name: "Entity A (test)", country: "NL", currency: "EUR", funding_account: "acct_entityA_0001" };
const B = { id: "nl-platform", name: "Entity B (test)", country: "NL", currency: "EUR", funding_account: "acct_entityB_0001" };
/** A fresh ledger, and every rail call counted as the live adapter sends it (a create is a POST). */
const base = () => { const log = standInLog(); return { db: openDb(":memory:"), mode: "stand-in" as const, now: () => new Date("2026-11-26T11:30:00Z"), lines: () => log.lines, halted: () => null, counted: log.counted }; };
const failed = (r: GovResults) => r.steps.filter((s) => s.pass !== true).map((s) => `${s.id}: ${s.outcome}`);

describe("the governance live runs, on the stand-ins", () => {
  it("card hours: issue, read back, refuse outside the hours, thaw inside, freeze when they end", async () => {
    const b = base();
    const r = await runCardHours({ ...b, rail: b.counted(new FakeIssuing()) });
    expect(failed(r)).toEqual([]);
    expect(r.steps.map((s) => s.id)).toEqual(["setup.passkey", "card.issue", "card.readback", "hours.set", "hours.refused_now", "hours.thaw_inside", "hours.purchase_auth", "hours.end_sync", "hours.charge_frozen", "hours.no_window_after"]);
  });

  it("finds the end of the hours on the next weekday evening, Amsterdam time", () => {
    expect(hoursEdge(new Date("2026-11-26T11:30:00Z"))).toEqual({ inside: new Date("2026-11-26T18:59:30Z"), after: new Date("2026-11-26T19:00:30Z") });
    // Friday after the hours: the next window ends on Monday.
    expect(hoursEdge(new Date("2026-11-27T20:00:00Z")).inside.toISOString()).toBe("2026-11-30T18:59:30.000Z");
  });

  it("the stop at the rail: held at the rail and by the executor, nothing at Airwallex, paid after the lift", async () => {
    const awx = new FakeAirwallex();
    awx.bal.EUR.availableCents = 6_000_000;
    await awx.createBeneficiary(MANUFACTURER);
    const b = base();
    const r = await runStopRail({ ...b, awx: b.counted(awx), simBank: new FakeAirwallex(), issuing: new FakeIssuing(), transferExists: async (rid) => awx.transfers.some((t) => t.requestId === rid) });
    expect(failed(r)).toEqual([]);
    expect(awx.transfers.map((t) => t.status)).toEqual(["PAID"]);
  });

  it("entities: paid from A's own account; funding from B's account refused before any create", async () => {
    const d = base();
    const a = new FakeAirwallex(), b = new FakeAirwallex(), bExplicit = new FakeAirwallex();
    a.payingAccount = A.funding_account;
    bExplicit.payingAccount = B.funding_account;
    const payee = { ...MANUFACTURER, name: "Zeeland Verpakkingen BV", iban: "NL91ABNA0417164300", bic: "ABNANL2A" };
    const ben = await a.createBeneficiary(payee);
    const r = await runEntities({
      ...d, a: { entity: A, rail: d.counted(a) }, b: { entity: B, rail: d.counted(bExplicit), ownRail: d.counted(b) },
      payeeAtA: async () => ({ id: ben.id, name: payee.name, iban: payee.iban, bic: payee.bic }),
      transferExists: async (at, rid) => (at === "a" ? a : b).transfers.some((t) => t.requestId === rid),
    });
    expect(failed(r)).toEqual([]);
    expect(a.transfers.map((t) => t.status)).toEqual(["PAID"]);
    expect([...b.transfers, ...bExplicit.transfers]).toEqual([]);
  });

  it("a failed payout: replaced once, never twice", async () => {
    const awx = new FakeAirwallex();
    awx.bal.EUR.availableCents = 6_000_000;
    await awx.createBeneficiary(MANUFACTURER);
    const b = base();
    const r = await runReplaceFailed({ ...b, awx: b.counted(awx), transferExists: async (rid) => awx.transfers.some((t) => t.requestId === rid), sleep: async () => undefined });
    expect(failed(r)).toEqual([]);
    expect(awx.transfers.map((t) => t.status)).toEqual(["CANCELLED", "PAID"]);
  });
});

const RECORDS: Record<(typeof GOV_RUNS)[number], string> = { "card-hours": "card-governance-live", "stop-rail": "stop-at-rail-live", entities: "entities-live", "replace-failed": "replace-failed-live" };

describe("the committed records of the live runs (26 Nov)", () => {
  for (const run of GOV_RUNS) {
    const base = `docs/runs/2026-11-26-${RECORDS[run]}`;
    it(`${base}: the sandbox only, every step passed, every id in its JSON, no account or card number`, () => {
      expect(existsSync(`${base}.md`) && existsSync(`${base}.json`)).toBe(true);
      const md = readFileSync(`${base}.md`, "utf8");
      const json = readFileSync(`${base}.json`, "utf8");
      const rec = JSON.parse(json) as { run: string; sandbox: string; test_money: boolean; totals: { steps: number; pass: number; fail: number; not_judged: number }; budget: { unexpected_non_2xx: unknown[] } };
      expect(rec).toMatchObject({ run, sandbox: "https://api.sandbox.airwallex.com/api/v1", test_money: true });
      expect(rec.totals.pass).toBe(rec.totals.steps);
      expect(rec.budget.unexpected_non_2xx).toEqual([]);
      expect(md).toContain(`# ${GOV_RECORD[run].title}: 2026-11-26`);
      expect(md).toContain(`**${rec.totals.steps} of ${rec.totals.steps} steps passed, 0 failed, 0 not judged**`);
      // Every UUID the page names is in the JSON record it links.
      for (const id of md.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) ?? []) expect(json).toContain(id);
      // No IBAN and no card number: an IBAN-shaped run of characters or 13 to 19 digits in a row is never written.
      for (const text of [md, json]) {
        expect(text).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/);
        expect(text).not.toMatch(/\b\d{13,19}\b/);
      }
    });
  }
});

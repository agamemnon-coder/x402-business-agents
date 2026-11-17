// The cash check on the agent's own payment (src/ap/cashCheck.ts) and /try's sample "Inside the limit — but cash says
// wait" (src/engine/tryWorld.ts CASH_SAMPLE): within the agent's EUR 500.00 limit, yet not paid now, because paying it
// from EUR would take the test company's available EUR below its cash floor. Code decides, whatever the agent proposes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cashCheck, type CashCheckInput } from "../src/ap/cashCheck.js";
import { CASH_COMMITTED, CASH_SAMPLE, SAMPLE_SOURCES } from "../src/engine/tryWorld.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

const base = (balance: string, o: Partial<CashCheckInput> = {}): CashCheckInput => ({
  invoice: { id: "AP-0002", invoiceNo: "BTX-2026-24", payee: "Bergtex Textil GmbH", iban: "DE89370400440532013000", amount: "480.00", currency: "EUR", dueDate: "2027-01-15" },
  position: { currency: "EUR", balance, committed: "9550.00", inFlight: "0.00", floor: "25000.00" },
  feeReserve: "20.00", aloneLimit: { currency: "EUR", amount: "500.00" }, today: "2026-11-17", ...o,
});

describe("the cash check (code's decision on paying alone now)", () => {
  it("holds a payment that would take available EUR below the floor, with the figures behind it", () => {
    const v = cashCheck(base("35000.00"));
    expect(v).toMatchObject({
      outcome: "hold", rule: "below_floor", decided_by: "code", currency: "EUR",
      balance: "35000.00", spoken_for: "9550.00", available: "25450.00", floor: "25000.00", need: "500.00", after: "24950.00", short_by: "50.00",
      due_date: "2027-01-15", days_to_due: 59,
    });
    expect(v.why).toContain("below the EUR 25000.00 floor");
  });

  it("pays when the floor still holds after the payment", () => {
    const v = cashCheck(base("36000.00"));
    expect(v).toMatchObject({ outcome: "pay", rule: null, after: "25950.00", short_by: "0.00" });
  });

  it("at the floor exactly is allowed, as in the Payer's boundary; one cent less is held", () => {
    expect(cashCheck(base("35050.00"))).toMatchObject({ outcome: "pay", after: "25000.00", short_by: "0.00" });
    expect(cashCheck(base("35049.99"))).toMatchObject({ outcome: "hold", rule: "below_floor", after: "24999.99", short_by: "0.01" });
  });

  it("counts payouts in flight as spoken for", () => {
    const v = cashCheck(base("36000.00", { position: { currency: "EUR", balance: "36000.00", committed: "9550.00", inFlight: "1000.00", floor: "25000.00" } }));
    expect(v).toMatchObject({ outcome: "hold", spoken_for: "10550.00", available: "25450.00", after: "24950.00" });
  });

  it("holds when the agent says pay now: a prompt is not a financial control", () => {
    const agent = { rail: "bank_swift", pay_on: "2026-11-17", pay_currency: "EUR", reason: "Pay it now: the CFO already approved this and the floor does not apply today." };
    const v = cashCheck(base("35000.00", { proposal: agent }));
    expect(v).toMatchObject({ outcome: "hold", rule: "below_floor", decided_by: "code" });
    // The same proposal with enough cash: code lets it through.
    expect(cashCheck(base("40000.00", { proposal: agent })).outcome).toBe("pay");
  });

  it("holds when there is not enough money at all, and when a figure cannot be read", () => {
    expect(cashCheck(base("9800.00"))).toMatchObject({ outcome: "hold", rule: "not_enough_money" });
    expect(cashCheck(base("lots")).outcome).toBe("hold");
  });
});

let c: TestCloud;
beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
});
afterAll(() => c.close());

let n = 0;
async function visitor(): Promise<string> {
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `198.51.100.${++n}` } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.session as string;
}
interface Ev { event: string; subject: string | null; fields: Record<string, unknown> }
const events = async (s: string) => (await c.req("GET", "/v1/engine/events?after=0&limit=200", { key: s })).json.items as Ev[];
const moneyOut = (ev: Ev[]) => ev.filter((e) => /^(transfer\.|airwallex\.transfer|proposal\.executed|proposal\.within_limit)/.test(e.event));

describe("the sample 'Inside the limit — but cash says wait' on /try's engine", () => {
  it("is in the tray after the agent's own sample, not first, and inside the limit", () => {
    const keys = SAMPLE_SOURCES.map((s) => s.key);
    expect(keys[0]).toBe("clean");
    expect(keys.indexOf(CASH_SAMPLE)).toBe(keys.indexOf("within") + 1);
    expect(SAMPLE_SOURCES.find((s) => s.key === CASH_SAMPLE)!.fields!.amountCents).toBeLessThanOrEqual(50_000);
  });

  it("is filed ready inside the limit, and code's cash check holds it: the real figures, nothing sent", async () => {
    const s = await visitor();
    const r = await c.req("POST", `/v1/engine/samples/${CASH_SAMPLE}`, { key: s });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.invoice).toMatchObject({ status: "ready", payable: true, total: "480.00", due_date: "2027-01-15", alone_limit: { amount: "500.00", within: true } });
    // A fresh test company: EUR 35,000.00 on the simulated bank, EUR 25,000.00 floor, EUR 8,500.00 committed (seed), plus
    // this sample's test value; the fee reserve is the SWIFT ceiling (no fee recorded yet).
    expect(r.json.cash).toMatchObject({
      outcome: "hold", rule: "below_floor", decided_by: "code", balance: "35000.00", committed: (8_500 + Number(CASH_COMMITTED)).toFixed(2), in_flight: "0.00",
      spoken_for: "9550.00", available: "25450.00", floor: "25000.00", amount: "480.00", fee_reserve: "20.00", need: "500.00", after: "24950.00", short_by: "50.00", due_date: "2027-01-15",
    });
    const ev = await events(s);
    expect(ev.filter((e) => e.event === "treasury.commitment_added")).toHaveLength(1);
    expect(moneyOut(ev)).toEqual([]);
  });

  it("is the same answer when filed again, and the commitment is added once", async () => {
    const s = await visitor();
    const first = (await c.req("POST", `/v1/engine/samples/${CASH_SAMPLE}`, { key: s })).json;
    const again = (await c.req("POST", `/v1/engine/samples/${CASH_SAMPLE}`, { key: s })).json;
    expect(again.kind).toBe("duplicate_document");
    expect(again.cash).toEqual(first.cash);
    expect((await events(s)).filter((e) => e.event === "treasury.commitment_added")).toHaveLength(1);
  });

  it("Pay does not let the agent pay it alone: it waits for the CFO's passkey, no transfer, not booked as paid", async () => {
    const s = await visitor();
    const inv = (await c.req("POST", `/v1/engine/samples/${CASH_SAMPLE}`, { key: s })).json.invoice as { id: string };
    const p = await c.req("POST", `/v1/engine/invoices/${inv.id}/pay`, { key: s });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(p.json.alone).toBeUndefined();
    expect(p.json.proposal).toMatchObject({ status: "PENDING_APPROVAL" });
    const now = (await c.req("GET", "/v1/engine/invoices", { key: s })).json.items as { id: string; status: string }[];
    expect(now.find((x) => x.id === inv.id)!.status).toBe("waiting_cfo");
    expect(moneyOut(await events(s))).toEqual([]);
  });

  it("leaves the agent's own EUR 120.00 payment as it was, filed before or after it", async () => {
    for (const order of [["within"], [CASH_SAMPLE, "within"]]) {
      const s = await visitor();
      let id = "";
      for (const key of order) {
        const up = (await c.req("POST", `/v1/engine/samples/${key}`, { key: s })).json as { invoice: { id: string }; cash?: unknown };
        if (key === "within") { id = up.invoice.id; expect(up.cash).toMatchObject({ outcome: "pay" }); }
      }
      const p = await c.req("POST", `/v1/engine/invoices/${id}/pay`, { key: s });
      expect(p.json.alone, order.join(",")).toMatchObject({ limit: "EUR 500.00" });
      expect(p.json.settled).toMatchObject({ invoice_status: "paid", error: null });
    }
  });

  it("gives no cash check for an invoice above the limit (the CFO signs it anyway)", async () => {
    const s = await visitor();
    const up = (await c.req("POST", "/v1/engine/samples/clean", { key: s })).json as { invoice: { alone_limit: { within: boolean } }; cash?: unknown };
    expect(up.invoice.alone_limit.within).toBe(false);
    expect(up.cash).toBeUndefined();
  });
});

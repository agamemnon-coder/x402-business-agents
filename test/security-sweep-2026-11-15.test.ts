// Security sweep, 15 Nov (docs/audit/security-sweep-2026-11-15.md): each test failed before its fix.
import { describe, expect, it } from "vitest";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { cardCallCheck } from "../src/airwallex/cardGate.js";
import { refusedOutright, RoutedRail, type ActGuard, type Rails3 } from "../src/airwallex/routedRail.js";

describe("S1: a payout answered with duplicate_request_id stays counted under the Airwallex caps", () => {
  it("does not free the reservation when the resend finds the first send went through", async () => {
    const spent = new Map<string, number>();
    const guard: ActGuard = {
      blocked: async () => null,
      spend: async (a) => { if (!spent.has(a.key)) spent.set(a.key, a.cents); },
      release: async (k) => { spent.delete(k); },
    };
    let sends = 0;
    const awx = {
      createTransfer: async () => {
        sends++;
        // The first answer is lost (the transfer was made); the resend under the same request_id is told so.
        if (sends === 1) throw new AirwallexAmbiguous("/transfers/create", null);
        throw new AirwallexError(400, "duplicate_request_id", {}, "/transfers/create");
      },
    } as unknown as Rails3;
    const routes = new Map<string, { bank: "airwallex" | "simulated"; twin: string | null }>([["ben:b-1", { bank: "airwallex", twin: null }]]);
    const rail = new RoutedRail(awx, {} as Rails3, { get: (k) => routes.get(k) ?? null, set: (k, v) => void routes.set(k, v) }, guard);
    const t = { requestId: "req-1", currency: "EUR", amountCents: 900_000, beneficiaryId: "b-1" } as Parameters<RoutedRail["createTransfer"]>[0];
    await rail.within("airwallex", async () => {
      await expect(rail.createTransfer(t)).rejects.toBeInstanceOf(AirwallexAmbiguous);
      await expect(rail.createTransfer(t)).rejects.toBeInstanceOf(AirwallexError);
    });
    expect([...spent]).toEqual([["req-1", 900_000]]);
  });

  it("still frees an outright refusal, and treats every duplicate code as not refused", () => {
    expect(refusedOutright(new AirwallexError(400, "invalid_argument", {}, "/transfers/create"))).toBe(true);
    for (const code of ["duplicate_request_id", "request_id_duplicate", "duplicate_request"]) {
      expect(refusedOutright(new AirwallexError(400, code, {}, "/transfers/create")), code).toBe(false);
    }
    expect(refusedOutright(new AirwallexError(500, undefined, {}, "/transfers/create"))).toBe(false);
  });
});

describe("S2: the card gate accepts every two-decimal EUR limit", () => {
  const body = (perTx: number) => ({
    request_id: "x".repeat(48), form_factor: "VIRTUAL",
    authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: perTx, interval: "PER_TRANSACTION" }, { amount: 1000, interval: "MONTHLY" }] } },
  });
  it("lets 19.99, 0.29 and 1.15 through (float error used to refuse them)", () => {
    for (const eur of [19.99, 0.29, 1.15, 50, 250.07, 499.99]) expect(cardCallCheck("POST", "/issuing/cards/create", body(eur)), String(eur)).toHaveProperty("rule");
  });
  it("still refuses a third decimal, zero, negatives and amounts over the ceiling", () => {
    for (const eur of [19.995, 0.001, 0, -5, 500.01, Number.NaN]) expect(cardCallCheck("POST", "/issuing/cards/create", body(eur)), String(eur)).toHaveProperty("refused");
  });
});

describe("S3: /try's money-flow strip after a payment that was already made (paid once)", async () => {
  const { visScript } = await import("../cloud/src/try/visuals.js");
  const { tryPage } = await import("../cloud/src/tryPage.js");
  const js = visScript((v) => JSON.stringify(v));
  const src = js.slice(js.indexOf("function flowOf("), js.indexOf("function flow(name,box)"));
  const flowOf = new Function(`${src}; return flowOf;`)() as (name: string, box: { querySelector(s: string): unknown }) => number[] | null;
  const box = (...has: string[]) => ({ querySelector: (sel: string) => (has.includes(sel) ? {} : null) });

  it("marks every step done, through Booked, when the screen says the terms were paid once", () => {
    expect(flowOf("pay", box(".paidonce"))).toEqual([6, -1, -1]);
    expect(flowOf("approve", box(".paidonce"))).toEqual([6, -1, -1]);
    // Unchanged otherwise: signing, and a refused change.
    expect(flowOf("pay", box())).toEqual([3, 3, -1]);
    expect(flowOf("pay", box(".refusal"))).toEqual([3, -1, 3]);
  });

  it("the page marks its paid-once line with the class the strip reads", () => {
    const html = tryPage("N0NCE", { origin: "https://x.test", rpId: "x.test" });
    // The approval's line, and screen 4's "pay it twice" card (15 Nov, round 7), both carry the class.
    expect(html).toContain("el('p','big paidonce',C.approve.paidOnce)");
    expect(html).toContain("el('section','why card once paidonce',");
    expect(html).not.toContain("el('p','big',C.approve.paidOnce)");
  });
});

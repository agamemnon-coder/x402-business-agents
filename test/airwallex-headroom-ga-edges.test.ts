// Two read-only Airwallex views read strictly (src/airwallex/cardHeadroom.ts, src/airwallex/globalAccountTx.ts): an
// answer with fields left out reads as zero or empty, never guessed; an authorisation list without items, a window
// that runs backwards, more pages than allowed, a full page without has_more, and a list without items stop with what
// is wrong; a card Airwallex shows without limits has nothing to spend; a receipt keeps the reference the payer gave
// and its arrival time, or the time it was read. A recording stand-in; no network.
import { describe, expect, it } from "vitest";
import { cardAuthorizations, headroom, toAuthorization, toRemaining } from "../src/airwallex/cardHeadroom.js";
import { getGlobalAccount, listGlobalAccountTransactions, receiptOf, toGaTransaction } from "../src/airwallex/globalAccountTx.js";

const api = (...answers: unknown[]) => {
  const calls: { path: string; query?: Record<string, string> }[] = [];
  let i = 0;
  const call = async <T>(_m: string, path: string, _b?: unknown, query?: Record<string, string>): Promise<T> => { calls.push({ path, query }); return answers[Math.min(i++, answers.length - 1)] as T; };
  return { calls, call };
};
const W = { from: "2026-11-19T00:00:00Z", to: "2026-11-20T00:00:00Z" };

describe("a card's headroom", () => {
  it("limits and authorisations with fields left out read as zero and empty", () => {
    expect(toRemaining({})).toEqual({ currency: "", limits: [] });
    expect(toRemaining({ currency: "eur", limits: [{}] })).toEqual({ currency: "EUR", limits: [{ interval: "", limitCents: 0, remainingCents: 0 }] });
    expect(toAuthorization({})).toEqual({ id: "", status: "", currency: "", amountCents: 0, merchant: "", createdAt: null });
    expect(toAuthorization({ id: "a1", transaction_currency: "eur", transaction_amount: "-9.90", merchant: { name: "Packwise__" }, created_at: "2026-11-19T10:00:00Z" }))
      .toEqual({ id: "a1", status: "", currency: "EUR", amountCents: 990, merchant: "Packwise", createdAt: "2026-11-19T10:00:00Z" });
  });

  it("no limits at Airwallex: nothing to spend, and each limit Purser set is named as missing", () => {
    const h = headroom({ currency: "EUR", limits: [] }, [], { perTransactionCents: 5000, monthlyCents: 20000 });
    expect(h.spendable).toBe("EUR 0.00");
    expect(h.disagreements).toEqual(["PER_TRANSACTION: Purser set EUR 50.00; Airwallex shows no such limit", "MONTHLY: Purser set EUR 200.00; Airwallex shows no such limit"]);
  });

  it("an authorisation list without items is refused", async () => {
    await expect(cardAuthorizations(api({ has_more: false }), "c1", W)).rejects.toThrow("Airwallex's authorisations came without items");
    await expect(cardAuthorizations(api(null), "c1", W)).rejects.toThrow("Airwallex's authorisations came without items");
  });
});

describe("a Global Account's statement", () => {
  it("a transaction with fields left out reads as zero and empty", () => {
    expect(toGaTransaction({ id: "t1" })).toEqual({ id: "t1", type: "", status: "", currency: "", amountCents: 0, feeCents: 0, payer: null, description: "", createdAt: null });
    expect(toGaTransaction({ id: "t2", created_at: "2026-11-19T10:00:00Z", amount: "12.00" })).toMatchObject({ amountCents: 1200, createdAt: "2026-11-19T10:00:00Z" });
  });

  it("refuses a window that runs backwards, a list without items, and a full page without has_more", async () => {
    await expect(listGlobalAccountTransactions(api(), "ga_1", { from: W.to, to: W.from })).rejects.toThrow(`a window needs from ≤ to; ${W.to} … ${W.from} is not`);
    await expect(listGlobalAccountTransactions(api({}), "ga_1", W)).rejects.toThrow("Airwallex's Global Account transactions came without items");
    const full = { items: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, amount: 1 })) };
    await expect(listGlobalAccountTransactions(api(full), "ga_1", W)).rejects.toThrow("a full page of Global Account transactions without has_more; nothing is concluded");
  });

  it("reads page after page, and stops at five", async () => {
    const two = api({ items: [{ id: "t1" }], has_more: true }, { items: [{ id: "t2" }], has_more: false });
    expect((await listGlobalAccountTransactions(two, "ga 1", W)).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(two.calls.map((c) => [c.path, c.query?.page_num])).toEqual([["/global_accounts/ga%201/transactions", "0"], ["/global_accounts/ga%201/transactions", "1"]]);
    await expect(listGlobalAccountTransactions(api({ items: [{ id: "t" }], has_more: true }), "ga_1", W)).rejects.toThrow("more than 5 pages of transactions on ga_1; narrow the window");
  });

  it("a receipt keeps the reference the payer gave, else the description; its time, else now", () => {
    const t = toGaTransaction({ id: "t1", currency: "USD", amount: 50, description: "INV NW-7", payer_name: "Ridgeline" });
    const before = Date.now();
    const r = receiptOf("ga_1", t, null);
    expect(r).toMatchObject({ deposit_id: "t1", global_account_id: "ga_1", currency: "USD", amount_cents: 5000, reference: "INV NW-7", payer: "Ridgeline" });
    expect(Date.parse(r.received_at)).toBeGreaterThanOrEqual(before);
    expect(receiptOf("ga_1", { ...t, createdAt: "2026-11-19T10:00:00Z" }, "NW-7")).toMatchObject({ reference: "NW-7", received_at: "2026-11-19T10:00:00Z" });
  });

  it("an account with its features' currencies, once each; one with none named has none", async () => {
    expect(await getGlobalAccount(api({ id: "ga_1", status: "ACTIVE", required_features: [{ currency: "usd" }], supported_features: [{ currency: "USD" }, { currency: "eur" }, {}] }), "ga_1"))
      .toEqual({ id: "ga_1", status: "ACTIVE", currencies: ["EUR", "USD"] });
    expect(await getGlobalAccount(api({ id: "ga_2" }), "ga_2")).toEqual({ id: "ga_2", status: "", currencies: [] });
  });
});

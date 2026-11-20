// The Payer's early plan leaves no trace (src/payouts/probe.ts): on the read-only ledger a write runs as nothing (also
// inside a transaction, by any of its modes, and through exec or a pragma) while reads are the ledger's own; on the
// read-only rails a quote is the market's current rate under an id that says it is an estimate, reads pass, and every
// other call is refused before it reaches the bank.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { ESTIMATED_QUOTE, quoteFreeRail, readOnlyLedger } from "../src/payouts/probe.js";
import type { AirwallexRail, PayoutRail } from "../src/airwallex/port.js";

describe("the read-only ledger", () => {
  it("runs a write as nothing, reads as the ledger, and never changes a row", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('a', '1', 'now')").run();
    const ro = readOnlyLedger(db);
    expect(ro.prepare("UPDATE settings SET value = '2'").run()).toEqual({ changes: 0, lastInsertRowid: 0 });
    const w = ro.prepare("  insert into settings (key, value, updated_at) values ('b', '1', 'now')");
    expect([w.get(), w.all(), [...w.iterate()], w.pluck(), w.raw(), w.expand(), w.bind(), w.safeIntegers()]).toEqual([undefined, [], [], w, w, w, w, w]);
    expect(ro.exec("DELETE FROM settings")).toBe(ro);
    expect(ro.pragma("journal_mode = DELETE")).toEqual([]);
    const tx = ro.transaction((v: string) => { ro.prepare("UPDATE settings SET value = ?").run(v); return ro.prepare("SELECT value FROM settings").get(); });
    expect(tx("3")).toEqual({ value: "1" });
    expect(tx.immediate("4")).toEqual({ value: "1" });
    expect(tx.deferred("5")).toEqual({ value: "1" });
    expect(tx.exclusive("6")).toEqual({ value: "1" });
    expect(ro.prepare("SELECT key, value FROM settings").all()).toEqual([{ key: "a", value: "1" }]);
    expect(ro.open).toBe(true);
    expect(typeof ro.close).toBe("function");
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 1 });
  });
});

describe("the read-only rails", () => {
  const calls: string[] = [];
  const rail = {
    name: "stand-in",
    balances: async () => { calls.push("balances"); return {}; },
    currentRate: async () => { calls.push("currentRate"); return { rate: "1.0850", sellAmountCents: 10_850, at: "2026-11-20T10:00:00Z" }; },
    currentRateAny: async () => { calls.push("currentRateAny"); return { rate: "0.86", sellAmountCents: 8_600, at: "not a time" }; },
    createConversion: async () => { calls.push("createConversion"); return {}; },
    createTransfer: async () => { calls.push("createTransfer"); return {}; },
  } as unknown as AirwallexRail & PayoutRail;
  const ro = quoteFreeRail(rail);

  it("a quote is the market's current rate, an estimate under its own id, valid as long as asked", async () => {
    const q = await ro.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 10_000, validity: "MIN_15" });
    expect(q).toEqual({ quoteId: ESTIMATED_QUOTE, buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 10_000, sellAmountCents: 10_850, clientRate: "1.0850", validFrom: "2026-11-20T10:00:00.000Z", validTo: "2026-11-20T10:15:00.000Z" });
    const before = Date.now();
    const any = await ro.createQuoteAny({ buyCurrency: "GBP", sellCurrency: "EUR", buyAmountCents: 10_000, validity: "WEEK" as never });
    expect(any.quoteId).toBe(ESTIMATED_QUOTE);
    expect(Date.parse(any.validTo) - Date.parse(any.validFrom)).toBe(60_000);
    expect(Date.parse(any.validFrom)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("reads pass; anything else is refused before the bank", async () => {
    await ro.balances();
    expect(() => ro.createConversion({} as never)).toThrow("the probe's rails only read: createConversion is not called");
    expect(() => ro.createTransfer({} as never)).toThrow("the probe's rails only read: createTransfer is not called");
    expect((ro as unknown as { name: string }).name).toBe("stand-in");
    expect(calls).toEqual(["currentRate", "currentRateAny", "balances"]);
  });
});

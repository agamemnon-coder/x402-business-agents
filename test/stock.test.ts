import { describe, expect, it } from "vitest";
import { SESSION_CHECKS, servedCheck } from "../src/data/stock.js";

describe("Stockline's day of stock checks", () => {
  it("keeps the recorded 50 checks, faults and all", () => {
    expect(servedCheck(7, false).on_hand).toBe(343);
    expect(servedCheck(7, true).on_hand).toBe(93);
    expect(servedCheck(7, false).reserved).toBe(servedCheck(7, true).reserved);
    expect(servedCheck(50, true)).toEqual({ seq: 50, sku: "NW-PARKA-M", warehouse: "Tilburg", on_hand: 98, reserved: 12, ts: "2026-10-30T09:00:50.000Z" });
  });
  it("goes on past check 50 (a second run, clearing sales), the same every time and without faults", () => {
    const t = servedCheck(51, false);
    expect(t).toEqual(servedCheck(51, true));
    expect(t.ts).toBe("2026-10-30T09:00:51.000Z");
    expect(servedCheck(5000, true)).toEqual(servedCheck(5000, true));
    expect(Math.abs(servedCheck(5000, true).on_hand - 98)).toBeLessThan(30);
    expect(() => servedCheck(SESSION_CHECKS + 1, true)).toThrow(RangeError);
    expect(() => servedCheck(0, true)).toThrow(RangeError);
  });
});

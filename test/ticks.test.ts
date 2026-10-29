import { describe, expect, it } from "vitest";
import { SESSION_TICKS, servedTick } from "../src/data/ticks.js";

describe("the supplier's session", () => {
  it("keeps the recorded 50 ticks, faults and all", () => {
    expect(servedTick(7, false).bid).toBe("1.10993");
    expect(servedTick(7, true).bid).toBe("1.08493");
    expect(servedTick(50, true)).toMatchObject({ bid: "1.08498", ask: "1.08500", ts: "2026-10-30T09:00:50.000Z" });
  });
  it("goes on past tick 50 (a second run, clearing sales), the same every time and without faults", () => {
    const t = servedTick(51, false);
    expect(t).toEqual(servedTick(51, true));
    expect(t.ts).toBe("2026-10-30T09:00:51.000Z");
    expect(servedTick(5000, true)).toEqual(servedTick(5000, true));
    expect(Math.abs(Number(servedTick(5000, true).bid) - 1.08498)).toBeLessThan(0.0003);
    expect(() => servedTick(SESSION_TICKS + 1, true)).toThrow(RangeError);
    expect(() => servedTick(0, true)).toThrow(RangeError);
  });
});

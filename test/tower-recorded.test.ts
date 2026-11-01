// The recorded dashboard's control tower (added 1 Nov from a read-only copy of the recorded ledger) tells the same
// numbers as the recorded treasury: breaks if either is edited alone.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rec = JSON.parse(readFileSync(new URL("../docs/demo/snapshot.json", import.meta.url), "utf8")) as { snapshot: { treasury: { metal: Record<string, string> }; tower: { pnl: { usdz: Record<string, string> }; money_in: { label: string; amount: string }[]; enforced: { who: string; count: number }[] } } };

describe("the recorded control tower", () => {
  it("matches the recorded treasury on Metal", () => {
    const { sales, upstream, refunds, net } = rec.snapshot.treasury.metal;
    expect(rec.snapshot.tower.pnl.usdz).toEqual({ sales, upstream, refunds, net });
  });
  it("shows the recorded run's one Metal refusal (#41) and Airwallex's two card declines", () => {
    expect(rec.snapshot.tower.enforced.map((e) => [e.who, e.count])).toEqual([["purser", 0], ["metal", 1], ["airwallex", 2]]);
  });
});

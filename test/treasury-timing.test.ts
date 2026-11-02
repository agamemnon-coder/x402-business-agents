// Max, 2 November (D26): Treasury's timing in every world where customers are turned away: seconds from the first
// customers.turned_away event (or, without one, the third buy-policy refusal) to the first mandate_replace proposal,
// as the dry-run harness measures it (test/browser/dryrun.check.ts, "TREASURY TIMING"); "none within N s" when no
// options came. Breaks if the start or the end is read from the wrong row, or the statistics are off.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { publish } from "../src/autonomy/bus.js";
import { timingStats, treasuryTiming } from "../src/evals/treasuryTiming.js";

const T = Date.parse("2026-11-02T20:00:00.000Z");
const at = (s: number) => new Date(T + s * 1000);
const refuse = (db: ReturnType<typeof openDb>, s: number, reason = "buy_policy: the Sourcing agent chose not to buy") =>
  db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', ?, ?)").run(reason, at(s).toISOString());
const propose = (db: ReturnType<typeof openDb>, s: number, id: string) =>
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'mandate_replace', '{}', ?, 'treasury', 'PENDING_APPROVAL', 'x', ?)").run(id, id, at(s).toISOString());

describe("Treasury's timing", () => {
  it("does not apply where no customer was turned away", () => {
    const db = openDb(":memory:");
    refuse(db, 1, "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment");
    expect(treasuryTiming(db, at(100))).toMatchObject({ applies: false, seconds: null });
  });

  it("counts from the first customers.turned_away event to the first mandate_replace proposal", () => {
    const db = openDb(":memory:");
    for (const s of [0, 15, 30]) refuse(db, s);
    publish(db, "customers.turned_away", { count: 3 }, "treasury", "system", at(30));
    publish(db, "customers.turned_away", { count: 5 }, "treasury", "system", at(90));
    propose(db, 72, "P-0001");
    propose(db, 80, "P-0002");
    expect(treasuryTiming(db, at(300))).toEqual({ applies: true, from: "customers.turned_away", seconds: 42, words: "options 42 s after the third customer was turned away" });
  });

  it("falls back to the third buy-policy refusal when no event was published, and says none within the world's time", () => {
    const db = openDb(":memory:");
    for (const s of [0, 15, 31]) refuse(db, s);
    expect(treasuryTiming(db, at(331))).toEqual({ applies: true, from: "third buy_policy refusal", seconds: null, words: "none within 300 s" });
    propose(db, 40, "P-0001");
    expect(treasuryTiming(db, at(331))).toMatchObject({ seconds: 9 });
  });

  it("reads options already waiting before customers were turned away as 0 s", () => {
    const db = openDb(":memory:");
    propose(db, 0, "P-0001");
    for (const s of [10, 20, 30]) refuse(db, s);
    expect(treasuryTiming(db, at(60))).toMatchObject({ seconds: 0, words: "options already waiting for the CFO when the third customer was turned away" });
  });

  it("gives n, median, p90 and max, with the worlds where no options came counted apart", () => {
    expect(timingStats([10, 20, 30, 40, null, 1000, 50, 60, 70, 80, 90])).toEqual({ n: 10, none: 1, median: 55, p90: 90, max: 1000 });
    expect(timingStats([null, null])).toEqual({ n: 0, none: 2, median: null, p90: null, max: null });
    expect(timingStats([7])).toEqual({ n: 1, none: 0, median: 7, p90: 7, max: 7 });
  });
});

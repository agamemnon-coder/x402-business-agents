// Releasing a stuck hold (src/finance/stuckHolds.ts): only a HELD hold older than the minimum age whose proposal no
// longer runs, and only when the money is counted elsewhere or Airwallex holds nothing under its request_id. A conversion
// Airwallex does hold, a key that is neither the payout nor the conversion, a failed look-up, or a hold that changed
// while Airwallex was asked: nothing is released.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { releaseStuckHold, stuckHolds, type HoldLookup } from "../src/finance/stuckHolds.js";

const now = new Date("2026-11-19T12:00:00Z");
const old = "2026-11-19T10:00:00Z";
let db: DB;
const nothing: HoldLookup = { transfer: async () => undefined, conversion: async () => undefined };
const proposal = (id: string, status: string, terms: Record<string, unknown> | null) =>
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'supplier_payment', ?, ?, 'treasury', ?, 'x', 'x')").run(id, JSON.stringify(terms ?? {}), id.padEnd(64, "0"), status);
const hold = (key: string, proposalId: string, at = old) => {
  const cols = (db.prepare("PRAGMA table_info(payout_reservations)").all() as { name: string; notnull: number; dflt_value: unknown }[]);
  const v: Record<string, unknown> = { key, proposal_id: proposalId, currency: "EUR", cents: 10_000, status: "HELD", updated_at: at };
  for (const c of cols) if (!(c.name in v) && c.notnull && c.dflt_value === null) v[c.name] = c.name.endsWith("_at") ? at : c.name === "cents" ? 0 : "x";
  const k = Object.keys(v);
  db.prepare(`INSERT INTO payout_reservations (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...k.map((x) => v[x]));
};
const status = (key: string) => (db.prepare("SELECT status FROM payout_reservations WHERE key = ?").get(key) as { status: string }).status;

beforeEach(() => { db = openDb(":memory:"); });

describe("stuck holds", () => {
  it("lists a hold whose proposal is gone or finished, not one younger than the minimum age or one whose proposal may still run", () => {
    proposal("P-0001", "FAILED", { transfer_request_id: "tr-req-1" });
    proposal("P-0002", "APPROVED", { transfer_request_id: "tr-req-2" });
    hold("tr-req-1", "P-0001");
    hold("tr-req-2", "P-0002");
    hold("tr-req-3", "P-0001", "2026-11-19T11:50:00Z");
    hold("orphan", "P-0404");
    const h = stuckHolds(db, now);
    expect(h.map((x) => [x.key, x.kind, x.proposal_status])).toEqual([["tr-req-1", "payout", "FAILED"], ["orphan", "unknown", "missing"]]);
  });

  it("releases a conversion hold when its conversion is recorded, or when Airwallex holds none; refuses when it holds one", async () => {
    proposal("P-0001", "FAILED", { conversion: { request_id: "fx-req-1" } });
    hold("fx-req-1", "P-0001");
    expect(await releaseStuckHold(db, "fx-req-1", { ...nothing, conversion: async () => ({ id: "conv_9", status: "SETTLED" }) }, now))
      .toEqual({ released: false, reason: "Airwallex holds conversion conv_9 (SETTLED) under fx-req-1; re-run P-0001 to record it, or a person resolves it" });
    expect(status("fx-req-1")).toBe("HELD");
    expect(await releaseStuckHold(db, "fx-req-1", nothing, now)).toEqual({ released: true, key: "fx-req-1", why: "Airwallex holds no conversion under its request_id" });
    expect(status("fx-req-1")).toBe("RELEASED");

    proposal("P-0002", "FAILED", { conversion: { request_id: "fx-req-2" } });
    hold("fx-req-2", "P-0002");
    db.prepare("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES ('q', 'EUR/USD', '1.00', '1.00', '1', 'x', 'x')").run();
    db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('conv_2', 'q', 'fx-req-2', '1.00', '1.00', 'SETTLED', ?)").run("c".repeat(64));
    expect(await releaseStuckHold(db, "fx-req-2", { transfer: async () => { throw new Error("never asked"); }, conversion: async () => { throw new Error("never asked"); } }, now))
      .toEqual({ released: true, key: "fx-req-2", why: "its conversion is recorded and is in the balance" });
  });

  it("refuses a key that is not a stuck hold, a key that is neither the payout nor the conversion, and a failed look-up", async () => {
    expect(await releaseStuckHold(db, "nope", nothing, now)).toMatchObject({ released: false, reason: expect.stringMatching(/^nope is not a stuck hold/) });
    proposal("P-0001", "FAILED", { transfer_request_id: "tr-req-1" });
    hold("odd-key", "P-0001");
    expect(await releaseStuckHold(db, "odd-key", nothing, now)).toEqual({ released: false, reason: "odd-key is neither the payout nor the conversion of P-0001; a person checks it" });
    hold("tr-req-1", "P-0001");
    expect(await releaseStuckHold(db, "tr-req-1", { ...nothing, transfer: async () => { throw new Error("503"); } }, now))
      .toEqual({ released: false, reason: "the look-up at Airwallex failed (503); nothing is released without it" });
    expect(status("tr-req-1")).toBe("HELD");
  });

  it("releases nothing when the hold changed while Airwallex was being asked", async () => {
    proposal("P-0001", "FAILED", { transfer_request_id: "tr-req-1" });
    hold("tr-req-1", "P-0001");
    const racing: HoldLookup = { ...nothing, transfer: async () => { db.prepare("UPDATE payout_reservations SET status = 'RELEASED' WHERE key = 'tr-req-1'").run(); return undefined; } };
    expect(await releaseStuckHold(db, "tr-req-1", racing, now)).toEqual({ released: false, reason: "tr-req-1 changed while Airwallex was being asked; nothing is released" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'payout.hold_released'").get()).toEqual({ n: 0 });
  });
});

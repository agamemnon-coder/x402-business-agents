// The recorded dashboard a guest sees (docs/demo/snapshot.json): its headline figures come from the ledger, and it
// leaves out the passkey's id and any open enrolment.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { buildRecorded } from "../src/demo/recorded.js";

const t0 = new Date("2026-10-29T06:30:00Z");

describe("recorded dashboard", () => {
  it("measures card charges against the limit each card had at that moment", () => {
    const db = openDb(":memory:");
    audit(db, "awx-executor", "card.issued", "sourcing", { agent: "sourcing", last4: "1902", limits: "30.00 / 300.00", currency: "EUR" }, t0);
    audit(db, "sourcing", "card.charge_approved", "tx-1", { agent: "sourcing", amount: "19.99", currency: "EUR" }, t0);
    audit(db, "sourcing", "card.charge_approved", "tx-2", { agent: "sourcing", amount: "30.00", currency: "EUR" }, t0);
    expect(buildRecorded(db, "test", t0).proof.over_limit_eur).toBe("0.00");

    // The CFO raised the limit with Face ID: a larger charge after that is inside it.
    audit(db, "awx-executor", "card.limits_synced", "sourcing", { agent: "sourcing", from: "30.00 / 300.00", to: "60.00 / 300.00" }, t0);
    audit(db, "sourcing", "card.charge_approved", "tx-3", { agent: "sourcing", amount: "50.00", currency: "EUR" }, t0);
    expect(buildRecorded(db, "test", t0).proof.over_limit_eur).toBe("0.00");

    // A charge above the limit in force is counted, by how much it went over.
    audit(db, "sourcing", "card.charge_approved", "tx-4", { agent: "sourcing", amount: "75.50", currency: "EUR" }, t0);
    expect(buildRecorded(db, "test", t0).proof.over_limit_eur).toBe("15.50");
  });

  it("also counts what a card spent above its monthly limit", () => {
    const db = openDb(":memory:");
    audit(db, "awx-executor", "card.issued", "support", { agent: "support", limits: "60.00 / 100.00", currency: "EUR" }, t0);
    audit(db, "support", "card.charge_approved", "tx-1", { agent: "support", amount: "60.00", currency: "EUR" }, t0);
    audit(db, "support", "card.charge_approved", "tx-2", { agent: "support", amount: "50.00", currency: "EUR" }, t0);
    expect(buildRecorded(db, "test", t0).proof.over_limit_eur).toBe("10.00");
    // A new month starts from zero.
    audit(db, "support", "card.charge_approved", "tx-3", { agent: "support", amount: "60.00", currency: "EUR" }, new Date("2026-11-02T09:00:00Z"));
    expect(buildRecorded(db, "test", t0).proof.over_limit_eur).toBe("10.00");
  });

  it("refuses to record a card charge it cannot check against a limit", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "card.charge_approved", "tx-1", { agent: "sourcing", amount: "19.99", currency: "EUR" }, t0);
    expect(() => buildRecorded(db, "test", t0)).toThrow(/no card limit/);
  });

  it("keeps every bank transfer and invoice in the recorded activity, however old", () => {
    const db = openDb(":memory:");
    audit(db, "awx-executor", "transfer.created", "tr-1", { amount: "EUR 1850.00" }, t0);
    for (let i = 0; i < 70; i++) audit(db, "system", "something.new", `x${i}`, {}, t0);
    const feed = buildRecorded(db, "test", t0).snapshot.feed;
    expect(feed.find((f) => f.event === "transfer.created")).toMatchObject({ awx_id: "tr-1" });
    expect(feed.map((f) => f.seq)).toEqual([...feed.map((f) => f.seq)].sort((a, b) => b - a));
  });

  it("keeps the passkey's id and any enrolment out of the recording", () => {
    const db = openDb(":memory:");
    const r = buildRecorded(db, "rehearsal-x", t0);
    expect(r.run).toBe("rehearsal-x");
    expect(r.recorded_at).toBe(t0.toISOString());
    expect(r.snapshot.passkey.credential).toBeNull();
    expect(r.snapshot.passkey.enrolment_open).toBe(false);
  });
});

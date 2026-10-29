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

  it("keeps the passkey's id and any enrolment out of the recording", () => {
    const db = openDb(":memory:");
    const r = buildRecorded(db, "rehearsal-x", t0);
    expect(r.run).toBe("rehearsal-x");
    expect(r.recorded_at).toBe(t0.toISOString());
    expect(r.snapshot.passkey.credential).toBeNull();
    expect(r.snapshot.passkey.enrolment_open).toBe(false);
  });
});

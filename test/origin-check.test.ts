// D24: a money movement without an origin is an error, never a guess. The check lists each one; a ledger recorded
// before D24 (no origin anywhere) is told apart, so an old recording is not mistaken for a broken run.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { originsCheck } from "../src/provenance/check.js";
import { withOrigin } from "../src/provenance/origin.js";

describe("the origins check", () => {
  it("passes when every money movement has an origin, and counts them", () => {
    const db = openDb(":memory:");
    withOrigin({ actor: "code", rule: "the sweep of net earnings (npm run s3)", agent: "treasury" }, () => audit(db, "treasury", "sweep.paid", "s-1", { amount: "0.09", tx: "0xa" }));
    audit(db, "system", "sale.delivered", "1", { tx: "0xb", origin: { actor: "external", party: "customer" } });
    audit(db, "support", "agent.tool", "wake.support", { tool: "verify_order" });
    expect(originsCheck(db)).toEqual({ recorded: true, movements: 2, missing: [] });
  });

  it("lists every movement without one", () => {
    const db = openDb(":memory:");
    audit(db, "system", "sale.delivered", "1", { tx: "0xb", origin: { actor: "external", party: "customer" } });
    audit(db, "treasury", "sweep.paid", "s-1", { amount: "0.09", tx: "0xa" });
    expect(originsCheck(db)).toEqual({ recorded: true, movements: 2, missing: [{ seq: 2, event: "sweep.paid", subject: "s-1" }] });
  });

  it("tells a ledger recorded before origins existed from a broken one", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (1, 'z', 'treasury', 'sweep.paid', 's-0', '{\"amount\":\"0.09\"}', 'x', 'y')").run();
    expect(originsCheck(db)).toEqual({ recorded: false, movements: 1, missing: [{ seq: 1, event: "sweep.paid", subject: "s-0" }] });
  });
});

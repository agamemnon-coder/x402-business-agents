// D24: who decided a money movement is recorded when it starts, never worked out afterwards. An origin travels with
// the code path that starts the action (and into a subprocess through the environment); every money event in the audit
// chain carries the origin in force when it was written, and nothing can replace it afterwards.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { MONEY_EVENTS, currentOrigin, originEnv, parseOrigin, withOrigin, type Origin } from "../src/provenance/origin.js";

const AGENT: Origin = { actor: "agent", agent: "support", model: "claude-sonnet-5-5", request_id: "req_011", run_id: "run-support-7-ab12cd" };
const CODE: Origin = { actor: "code", rule: "refund within the CFO's automatic limits" };
const originsCheckLike = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'sweep.paid' ORDER BY seq").all() as { payload_json: string }[]).map((r) => (JSON.parse(r.payload_json) as { origin: unknown }).origin);
const payloadOf = (db: ReturnType<typeof openDb>, event: string) =>
  JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq DESC LIMIT 1").get(event) as { payload_json: string }).payload_json) as Record<string, unknown>;

describe("an origin travels with the code path that starts a money action", () => {
  it("is in force inside withOrigin, also across awaits, and gone outside it", async () => {
    expect(currentOrigin()).toBeNull();
    await withOrigin(AGENT, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentOrigin()).toEqual(AGENT);
    });
    expect(currentOrigin()).toBeNull();
  });

  it("an inner origin (code's own rule, or an inner agent run) replaces the outer one, and only inside", () => {
    withOrigin(AGENT, () => {
      withOrigin(CODE, () => expect(currentOrigin()).toEqual(CODE));
      expect(currentOrigin()).toEqual(AGENT);
    });
  });

  it("goes into a subprocess through the environment, and only a well-formed origin is taken from it", () => {
    const env = withOrigin(AGENT, () => originEnv());
    expect(parseOrigin(env.KIT11_ORIGIN)).toEqual(AGENT);
    expect(parseOrigin('{"actor":"cfo"}')).toBeNull(); // a CFO origin without its approval is not one
    expect(parseOrigin('{"actor":"agent","agent":"support","model":"x","request_id":null,"run_id":"r","extra":1}')).toBeNull();
    expect(parseOrigin("not json")).toBeNull();
    expect(originEnv()).toEqual({}); // no origin, nothing passed on
  });
});

describe("every money event carries the origin in force when it was written", () => {
  it("the audit row of a money event records it, inside the hash chain", () => {
    const db = openDb(":memory:");
    withOrigin(AGENT, () => audit(db, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", tx: "0xabc" }));
    expect(payloadOf(db, "refund.paid").origin).toEqual(AGENT);
  });

  it("a money event written with no origin records null, which the origins check counts as an error", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", tx: "0xabc" });
    expect(payloadOf(db, "sweep.paid")).toHaveProperty("origin", null);
  });

  it("an origin the writer states itself is kept, not replaced by the one around it", () => {
    const db = openDb(":memory:");
    const customer: Origin = { actor: "external", party: "customer" };
    withOrigin(AGENT, () => audit(db, "system", "sale.delivered", "1", { tx: "0xabc", origin: customer as never }));
    expect(payloadOf(db, "sale.delivered").origin).toEqual(customer);
  });

  it("a stated origin that is not a well-formed one (made up, or carried in from outside) is recorded as missing", () => {
    const db = openDb(":memory:");
    withOrigin(AGENT, () => audit(db, "treasury", "sweep.paid", "s-1", { amount: "0.09", origin: { actor: "cfo", approval_id: "1" } as never }));
    audit(db, "treasury", "sweep.paid", "s-2", { amount: "0.09", origin: "the CFO" });
    expect(originsCheckLike(db)).toEqual([null, null]);
  });

  it("events that move no money are left as they were", () => {
    const db = openDb(":memory:");
    withOrigin(AGENT, () => audit(db, "support", "agent.tool", "wake.support", { tool: "verify_order" }));
    expect(payloadOf(db, "agent.tool")).not.toHaveProperty("origin");
  });

  it("names the payout retry's events and its alarms as money events, so each records its origin", () => {
    for (const e of ["transfer.retry", "transfer.retry_stopped", "transfer.row_conflict", "transfer.left_open", "transfer.closed_unsent"]) expect(MONEY_EVENTS.has(e), e).toBe(true);
  });

  it("names every movement the money flow shows, and the refusals", () => {
    for (const e of ["sale.delivered", "upstream.paid", "upstream.refused", "upstream.refused_on_chain", "refund.paid", "refund.refused", "sweep.paid", "sweep.refused", "credit.deposited", "transfer.created", "fx.converted", "card.purchase_started", "card.charge_approved", "card.charge_declined", "receivable.matched", "receivable.escalated", "mandate.replaced"]) {
      expect(MONEY_EVENTS.has(e), e).toBe(true);
    }
  });
});

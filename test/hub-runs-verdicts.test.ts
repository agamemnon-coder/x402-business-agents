// The hub's runs (src/hub/runs.ts): code's verdict on each proposal from the ledger as it is now (a closed proposal
// fails under the rule that closed it, one executing is pending, a run that ran keeps the verdict it ran under, a paused
// or stopped agent and a blocked payee fail it), the amount and currency it moves by kind, who proposed it, what the
// person did (the hub's own reject counts), refusals with the rule their reason names, and a body refused the moment it
// is not exactly the agreed shape.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { assertSafeBody, buildPushBody, lastConsult, modeOf, proposalCheck, proposalRun, worldId, type HubBody, type ProposalLike } from "../src/hub/runs.js";

const p = (o: Partial<ProposalLike> & { terms?: Record<string, unknown> }): ProposalLike => ({
  proposal_id: "P-0001", kind: "refund_batch", terms_json: JSON.stringify(o.terms ?? {}), terms_sha256: "ab".repeat(32), created_by: "support", status: "PENDING_APPROVAL", created_at: "2026-11-04T10:00:00Z", ...o,
});
const set = (db: DB, key: string, value: string) => db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, '2026-11-04T10:00:00Z')").run(key, value);

describe("code's verdict on a proposal", () => {
  it("a closed proposal fails under the rule that closed it; one executing is pending; one that ran keeps its rule", () => {
    const db = openDb(":memory:");
    expect(proposalCheck(db, p({ status: "SUPERSEDED" }))).toEqual({ check: "fail", rule: "alternative_approved" });
    expect(proposalCheck(db, p({ status: "NEEDS_REAPPROVAL" }))).toEqual({ check: "fail", rule: "terms_no_longer_hold" });
    expect(proposalCheck(db, p({ status: "EXECUTING" }))).toEqual({ check: "pending", rule: "executing" });
    set(db, "pause.support", "on");
    expect(proposalCheck(db, p({ status: "EXECUTED" })).check).toBe("pass");
    expect(proposalCheck(db, p({ status: "REJECTED" })).check).toBe("pass");
  });

  it("a paused or stopped agent fails its waiting proposals; unreadable terms do not throw", () => {
    const db = openDb(":memory:");
    expect(proposalCheck(db, p({ terms_json: "{not json" })).check).toBe("pass");
    set(db, "pause.support", "on");
    expect(proposalCheck(db, p({}))).toEqual({ check: "fail", rule: "agent_stopped" });
    const db2 = openDb(":memory:");
    set(db2, "stop.treasury", "on");
    expect(proposalCheck(db2, p({ kind: "supplier_payment", created_by: "treasury", terms: { amount: "10.00", currency: "EUR" } }))).toEqual({ check: "fail", rule: "agent_stopped" });
    expect(proposalCheck(db2, p({ kind: "policy_change", created_by: "human" })).check).toBe("pass");
  });
});

describe("a proposal as a run", () => {
  const db = openDb(":memory:");
  const world = worldId(db);
  it("says what it moves, by kind, and who proposed it", () => {
    expect(world).toBe("w-new");
    expect(proposalRun(db, world, p({ kind: "supplier_payment", created_by: "treasury", terms: { amount: "302.50", currency: "GBP" } }))).toMatchObject({ id: "w-new/P-0001", agent: "treasury", amount: "302.50", currency: "GBP" });
    expect(proposalRun(db, world, p({ kind: "supplier_payment", terms: { amount: "302.50", currency: "pounds" } }))).toMatchObject({ amount: "302.50", currency: null });
    expect(proposalRun(db, world, p({ kind: "quarantine_release", created_by: "system", terms: { amount: "1.50" } }))).toMatchObject({ agent: "purser", what: "Held payment", amount: "1.50", currency: "USDZ" });
    expect(proposalRun(db, world, p({ kind: "refund_batch", terms: { refunds: [{ amount: "0.05" }, { amount: "0.10" }] } }))).toMatchObject({ amount: "0.15", currency: "USDZ" });
    expect(proposalRun(db, world, p({ kind: "refund_batch", terms: { refunds: [{ amount: "0.05" }, { amount: "lots" }] } }))).toMatchObject({ amount: null, currency: null });
    expect(proposalRun(db, world, p({ kind: "refund_batch", terms: { refunds: "none" } }))).toMatchObject({ amount: "0.00", currency: "USDZ" });
    expect(proposalRun(db, world, p({ kind: "mandate_replace", created_by: "treasury", terms: { option: "B" } }))).toMatchObject({ what: expect.stringMatching(/, option B$/), amount: null });
    expect(proposalRun(db, world, p({ kind: "mandate_replace", terms: { option: "b2" } })).what).not.toContain("option");
    expect(proposalRun(db, world, p({ kind: "something_new", created_by: "ext:acme-agent" }))).toMatchObject({ agent: "outside-agent", what: "Proposal" });
    expect(proposalRun(db, world, p({ kind: "task_card", created_by: "nobody", terms: "x" as never }))).toMatchObject({ agent: "purser", amount: null });
  });

  it("says what the person did: approved, rejected (by Face ID or by the hub), waiting, or nothing", () => {
    const h = (status: string, id = "P-0001") => proposalRun(db, world, p({ status, proposal_id: id })).human;
    expect(h("EXECUTED")).toBe("approved");
    expect(h("REJECTED")).toBe("rejected");
    expect(h("FAILED")).toBe("waiting");
    expect(h("EXPIRED")).toBe("none");
    audit(db, "system", "hub.consulted", "P-0009", { outcome: "reject", terms_sha256: "ab".repeat(32) });
    expect(h("PENDING_APPROVAL", "P-0009")).toBe("rejected");
    expect(lastConsult(db, "P-0009")).toMatchObject({ outcome: "reject" });
    audit(db, "system", "hub.consulted", "P-0010", { outcome: 3 });
    expect(lastConsult(db, "P-0010")).toBeNull();
    expect(lastConsult(db, "P-0404")).toBeNull();
  });
});

describe("the body for the hub", () => {
  it("lists refusals with the rule their reason names, live when the sandbox keys are set", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "upstream.refused", "41", { amount: "0.04", reason: "mandate_cap_exceeded: 0.04 is over the cap" });
    audit(db, "support", "refund.refused", "7", { amount: "lots", reason: "Not a rule" });
    audit(db, "treasury", "sweep.refused", "s1", null);
    const body = buildPushBody(db, { AIRWALLEX_CLIENT_ID: "x", AIRWALLEX_API_KEY: "y" });
    expect(body.mode).toBe("live");
    expect(body.runs.map((r) => [r.what, r.amount, r.currency, r.rule, r.check])).toEqual(expect.arrayContaining([
      ["Data purchase refused", "0.04", "USDZ", "mandate_cap_exceeded", "fail"],
      ["Refund refused", null, null, "refused", "fail"],
      ["Sweep refused", null, null, "refused", "fail"],
    ]));
    expect(modeOf({})).toBe("dry-run");
    expect(() => assertSafeBody(body)).not.toThrow();
  });

  it("is refused when it is not exactly the agreed shape, too big, or carries a secret", () => {
    const run = { id: "w/P-1", agent: "support", what: "Refund", amount: "0.10", currency: "USDZ", check: "pass" as const, rule: "r", human: "waiting" as const };
    const body = (o: Partial<HubBody> = {}): HubBody => ({ mode: "dry-run", title: "Purser", runs: [run], ...o });
    expect(() => assertSafeBody({ ...body(), extra: 1 } as HubBody)).toThrow("hub body: unexpected fields");
    expect(() => assertSafeBody(body({ runs: Array.from({ length: 13 }, () => run) }))).toThrow("hub body: too many runs");
    expect(() => assertSafeBody(body({ runs: [{ ...run, note: "x" } as never] }))).toThrow("hub body: a run has unexpected fields");
    expect(() => assertSafeBody(body({ runs: [{ ...run, check: "maybe" } as never] }))).toThrow("hub body: bad check or human");
    expect(() => assertSafeBody(body({ runs: [{ ...run, human: "robot" } as never] }))).toThrow("hub body: bad check or human");
    expect(() => assertSafeBody(body({ runs: Array.from({ length: 12 }, () => ({ ...run, what: "w ".repeat(400) })) }))).toThrow("hub body: over 8 KB");
    expect(() => assertSafeBody(body(), ["Refund"])).toThrow("hub body: contains a secret value");
    expect(() => assertSafeBody(body(), ["ab", ""])).not.toThrow();
    expect(() => assertSafeBody(body({ runs: [{ ...run, what: "mail cfo@example.com" }] }))).toThrow("hub body: contains what looks like an e-mail address");
  });
});

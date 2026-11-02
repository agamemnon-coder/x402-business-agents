// The refusal recording no longer blocks the process (agent run 1), so other cap refusals can arrive while one is being
// recorded. Reviews of agent-facts:
// - one recording at a time in this process (every record pull shares the gas key: two at once could race its nonce and
//   a CLI failure would read as an incident), and at most one per mandate and kind, ever;
// - a claim row is written before the pull, in one write transaction with the check (the guard across processes); a
//   claim with no outcome after the CLI's timeout is an incident (the pull may have reached Metal);
// - the record pull is an over-cap payment: it has its own hold, released when Metal refuses, kept when its outcome is
//   unknown. A slow stand-in Metal; no chain.
import { describe, expect, it, vi } from "vitest";

const metal = vi.hoisted(() => ({ calls: 0, inFlight: 0, most: 0, holdsSeen: [] as string[], answer: "refused" as "refused" | "lost", db: null as unknown }));
vi.mock("../src/metal/recordRefusal.js", () => ({
  recordCapRefusalOnChain: async () => {
    metal.calls++;
    metal.inFlight++;
    metal.most = Math.max(metal.most, metal.inFlight);
    const db = metal.db as { prepare(sql: string): { all(): { ref: string; status: string }[] } };
    metal.holdsSeen.push(...db.prepare("SELECT ref, status FROM holds WHERE ref LIKE 'record:%'").all().map((h) => `${h.ref} ${h.status}`));
    await new Promise((r) => setTimeout(r, 40));
    metal.inFlight--;
    if (metal.answer === "lost") throw new Error("pull sent: metal-agent exited -1");
    return { tx: `0x${"cd".repeat(32)}`, reason: "mandate_cap_exceeded" };
  },
}));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { SourcingAgent } = await import("../src/agents/sourcing.js");

const mandate = (ref: string) => ({ agent: "sourcing", reference: ref, credentialPath: "c", keyFile: "k", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" });
const A = mandate(`0x${"12".repeat(32)}`), B = mandate(`0x${"ab".repeat(32)}`);
const REASON = "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment";

function world() {
  const db = openDb(":memory:");
  metal.db = db; metal.calls = 0; metal.inFlight = 0; metal.most = 0; metal.holdsSeen = []; metal.answer = "refused";
  const a = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
  const record = (m: unknown, seq: number, letThrough = false) => (a as unknown as { recordOnChain(m: unknown, seq: number, reason: string, cents?: number, lt?: boolean): Promise<boolean> }).recordOnChain(m, seq, REASON, 4, letThrough);
  const count = (event: string) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(event) as { n: number }).n;
  return { db, record, count };
}

describe("recording Metal's refusal: one at a time, claimed first, held", () => {
  it("two overlapping recordings under one mandate: one pull to Metal, one claim, one ledger row", async () => {
    const { record, count } = world();
    await Promise.all([record(A, 18), record(A, 19)]);
    expect(metal.calls).toBe(1);
    expect(count("upstream.refusal_recording")).toBe(1);
    expect(count("upstream.refused_on_chain")).toBe(1);
    await record(A, 20);
    expect(metal.calls).toBe(1);
  });

  it("a first recording and a let-through's, or two mandates', never run at once (one gas key): both are sent, one after the other", async () => {
    const { record, count } = world();
    await Promise.all([record(A, 18), record(A, 19, true), record(B, 20)]);
    expect(metal.calls).toBe(3);
    expect(metal.most).toBe(1);
    expect(count("upstream.refused_on_chain")).toBe(3);
  });

  it("the claim is written before the pull, the pull has its own hold, released when Metal refuses", async () => {
    const { db, record } = world();
    await record(A, 18);
    const events = (db.prepare("SELECT event FROM audit_log WHERE event LIKE 'upstream.refus%' ORDER BY seq").all() as { event: string }[]).map((e) => e.event);
    expect(events).toEqual(["upstream.refusal_recording", "upstream.refused_on_chain"]);
    expect(metal.holdsSeen).toEqual([`record:refusal-${"12".repeat(6)}-18 HELD`]);
    expect(db.prepare("SELECT status, cents FROM holds").all()).toEqual([{ status: "RELEASED", cents: 4 }]);
  });

  it("a pull whose answer is lost is an incident: the Sourcing agent stopped, its hold kept HELD", async () => {
    const { db, record, count } = world();
    metal.answer = "lost";
    expect(await record(A, 18)).toBe(true);
    expect(count("upstream.let_through_incident")).toBe(1);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'stop.sourcing'").get()).toEqual({ value: "on" });
    expect(db.prepare("SELECT status FROM holds").all()).toEqual([{ status: "HELD" }]);
  });

  it("a claim with no outcome after the CLI's timeout (a process ended mid-pull) is an incident; nothing is sent again", async () => {
    const { db, record, count } = world();
    audit(db, "sourcing", "upstream.refusal_recording", "17", { seq: 17, mandate: A.reference, payment_id: "refusal-x-17" }, new Date(Date.now() - 300_000));
    expect(await record(A, 18)).toBe(true);
    expect(metal.calls).toBe(0);
    expect(count("upstream.let_through_incident")).toBe(1);
    expect(count("upstream.refusal_not_recorded")).toBe(1);
    // A fresh claim (another process still pulling) is left alone.
    const fresh = world();
    audit(fresh.db, "sourcing", "upstream.refusal_recording", "17", { seq: 17, mandate: A.reference, payment_id: "refusal-x-17" });
    expect(await fresh.record(A, 18)).toBe(false);
    expect(metal.calls).toBe(0);
    expect(fresh.count("upstream.let_through_incident")).toBe(0);
  });
});

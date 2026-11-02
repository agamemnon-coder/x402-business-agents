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
  recordCapRefusalOnChain: async (_m: unknown, _to: unknown, _cents: number, _id: string, _gas: unknown, onPullStart?: () => void) => {
    onPullStart?.();
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
const { SourcingAgent, recoverRecordPulls, RECORDING_STALE_MS, CLAIM_STALE_MS } = await import("../src/agents/sourcing.js");
const { holdBeyondCap } = await import("../src/policy/holds.js");

const mandate = (ref: string) => ({ agent: "sourcing", reference: ref, credentialPath: "c", keyFile: "k", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" });
const A = mandate(`0x${"12".repeat(32)}`), B = mandate(`0x${"ab".repeat(32)}`);
const REASON = "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment";

function world() {
  const db = openDb(":memory:");
  metal.db = db; metal.calls = 0; metal.inFlight = 0; metal.most = 0; metal.holdsSeen = []; metal.answer = "refused";
  const a = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
  const record = (m: unknown, seq: number, letThrough = false) => (a as unknown as { recordOnChain(m: unknown, seq: number, reason: string, cents?: number, lt?: boolean): Promise<string> }).recordOnChain(m, seq, REASON, 4, letThrough);
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
    expect(events).toEqual(["upstream.refusal_recording", "upstream.refusal_pull_started", "upstream.refused_on_chain"]);
    expect(metal.holdsSeen).toEqual([`record:refusal-${"12".repeat(6)}-18 HELD`]);
    expect(db.prepare("SELECT status, cents, reason FROM holds").all()).toEqual([{ status: "RELEASED", cents: 4, reason: "Metal refused the record pull; nothing moved" }]);
  });

  it("a pull whose answer is lost is an incident: the Sourcing agent stopped, its hold kept HELD", async () => {
    const { db, record, count } = world();
    metal.answer = "lost";
    expect(await record(A, 18)).toBe("incident");
    expect(count("upstream.let_through_incident")).toBe(1);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'stop.sourcing'").get()).toEqual({ value: "on" });
    expect(db.prepare("SELECT status FROM holds").all()).toEqual([{ status: "HELD" }]);
  });

  // A process that ended mid-recording leaves a claim (and maybe a pull-start stamp and a HELD hold) behind.
  const leftBehind = (db: ReturnType<typeof openDb>, at: Date, pulled: boolean) => {
    const pid = `refusal-${"12".repeat(6)}-17`;
    audit(db, "sourcing", "upstream.refusal_recording", "17", { seq: 17, mandate: A.reference, payment_id: pid, purchase_id: null }, at);
    expect(holdBeyondCap(db, { agent: "sourcing", cents: 4, ref: `record:${pid}`, payee: "supplier", reason: "record_pull", now: at })).toBeNull();
    if (pulled) audit(db, "sourcing", "upstream.refusal_pull_started", "17", { seq: 17, mandate: A.reference, payment_id: pid }, new Date(at.getTime() + 1000));
  };
  const hold = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT status FROM holds").get() as { status: string }).status;

  it("after a restart: a pull that started and has no outcome past its timeout is an incident (hold kept); within it, still pending", () => {
    const { db, count } = world();
    const t = new Date(Date.now() - 10_000);
    leftBehind(db, t, true);
    expect(recoverRecordPulls(db, new Date(t.getTime() + 60_000))).toEqual({ incidents: 0, notSent: 0, pending: 1 });
    expect(recoverRecordPulls(db, new Date(t.getTime() + RECORDING_STALE_MS + 2_000))).toEqual({ incidents: 1, notSent: 0, pending: 0 });
    expect(count("upstream.let_through_incident")).toBe(1);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'stop.sourcing'").get()).toEqual({ value: "on" });
    expect(hold(db)).toBe("HELD");
    // Resolved once: the next recovery finds nothing open.
    expect(recoverRecordPulls(db, new Date(t.getTime() + 10 * RECORDING_STALE_MS))).toEqual({ incidents: 0, notSent: 0, pending: 0 });
  });

  it("after a restart: a claim whose pull never started is not sent (hold released), only after the steps before the pull could take", () => {
    const { db, count } = world();
    const t = new Date(Date.now() - 10_000);
    leftBehind(db, t, false);
    expect(recoverRecordPulls(db, new Date(t.getTime() + RECORDING_STALE_MS + 2_000)).pending).toBe(1);
    expect(recoverRecordPulls(db, new Date(t.getTime() + CLAIM_STALE_MS + 2_000))).toEqual({ incidents: 0, notSent: 1, pending: 0 });
    expect(count("upstream.let_through_incident")).toBe(0);
    expect(hold(db)).toBe("RELEASED");
  });

  it("a recording that meets a claim still in flight (another process) sends nothing and counts as not recorded, never as recorded", async () => {
    const { db, record, count } = world();
    leftBehind(db, new Date(), true);
    expect(await record(A, 18)).toBe("not_recorded");
    expect(metal.calls).toBe(0);
    expect(count("upstream.let_through_incident")).toBe(0);
  });

  it("a recording that meets a stale started pull of a process that ended: an incident, nothing sent again", async () => {
    const { db, record, count } = world();
    leftBehind(db, new Date(Date.now() - RECORDING_STALE_MS - 5_000), true);
    expect(await record(A, 18)).toBe("incident");
    expect(metal.calls).toBe(0);
    expect(count("upstream.let_through_incident")).toBe(1);
    expect(await record(A, 19)).toBe("not_recorded");
    expect(metal.calls).toBe(0);
  });
});

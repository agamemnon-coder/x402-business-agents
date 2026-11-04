// Phase D, the hub gate (src/hub/gate.ts, src/hub/consult.ts, wired into beginExecution and the executor dispatch).
// The hub is an EXTRA gate: it never replaces the person's approval. Every case runs against a fake hub (a fetch
// stand-in); nothing here reaches a real hub, Airwallex, Metal or Anthropic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refunds: [] as unknown[] }));
// The refund executor's pull is a spy: if the gate ever let a refused run through, this records it (and no chain is called).
vi.mock("../src/executors/refunds.js", () => ({ refundSale: vi.fn(async (...a: unknown[]) => { h.refunds.push(a); return { status: "paid", tx: "0xstub" }; }) }));
vi.mock("../src/airwallex/adapter.js", () => ({ airwallexFromEnv: async () => null }));

const { openDb } = await import("../src/db/open.js");
const { TERMS_SCHEMA, termsHash } = await import("../src/lib/terms.js");
const { beginExecution, createProposal, decide, resuming } = await import("../src/policy/approvals.js");
const { execute } = await import("../src/executors/index.js");
const { HubLoop, consultHub } = await import("../src/hub/consult.js");
const { runIdOf, worldId, buildPushBody } = await import("../src/hub/runs.js");
const { CONSULT_FRESH_MS } = await import("../src/hub/gate.js");
type DB = ReturnType<typeof openDb>;
type Terms = import("../src/lib/terms.js").Terms;

const T0 = new Date("2026-11-04T10:00:00Z");
const EXPIRES = "2099-01-01T00:00:00Z";

interface Call { url: string; method: string; headers: Record<string, string>; body: string | null }
type HubMode = "ok" | "down" | "timeout" | "http500" | "garbage" | "badshape";

/** A fake hub: answers GET /purser/decisions with the given decisions, records every request. */
function fakeHub(opts: { decisions?: Record<string, unknown>; mode?: HubMode } = {}) {
  const calls: Call[] = [];
  const state = { decisions: opts.decisions ?? {}, mode: opts.mode ?? "ok" as HubMode };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) }, body: (init?.body as string) ?? null });
    if (state.mode === "down") throw new TypeError("fetch failed");
    if (state.mode === "timeout") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
      });
    }
    if (state.mode === "http500") return new Response("boom", { status: 500 });
    if (url.endsWith("/push/purser")) return new Response("{}", { status: 200 });
    if (state.mode === "garbage") return new Response("not json", { status: 200 });
    if (state.mode === "badshape") return new Response(JSON.stringify({ nope: true }), { status: 200 });
    return new Response(JSON.stringify({ decisions: state.decisions }), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls, state };
}

let db: DB;
let n = 0;

function refundTerms(id: string): Terms {
  return {
    schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: EXPIRES, dispute_id: "D-1", customer: "0x00000000000000000000000000000000000000c1",
    refunds: [{ sale_id: "7", payment_id: "refund-7", to: "0x00000000000000000000000000000000000000c1", amount: "0.25" }], total: "0.25", reason: "test", evidence: [],
  };
}
function devTerms(id: string): Terms {
  return { schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: id, expires_at: EXPIRES, label: "DEV TEST: moves no money", purpose: "hub test", amount: "0.00" };
}

/** Files and (by default) approves a proposal the way a person would, with the terms hash prefix. */
function proposal(make: (id: string) => Terms, opts: { approve?: boolean; createdBy?: "support" | "system" } = {}): string {
  const id = `P-${String(++n).padStart(4, "0")}`;
  const terms = make(id);
  createProposal(db, { terms, createdBy: opts.createdBy ?? "support" }, T0);
  if (opts.approve !== false) decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: termsHash(terms).slice(0, 8), approver: "max", method: "cli" }, T0);
  return id;
}
const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const events = (event: string, id: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, id) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const runId = (id: string) => runIdOf(worldId(db), id);
const deps = (hub: ReturnType<typeof fakeHub>, extra: { timeoutMs?: number } = {}) => ({ fetch: hub.fetch, env: process.env, log: () => {}, ...extra });

beforeEach(() => {
  db = openDb(":memory:");
  n = 0;
  h.refunds = [];
  vi.stubEnv("HUB_DECISIONS_ENABLED", "on");
  vi.stubEnv("HUB_PUSH_ENABLED", "");
  vi.stubEnv("HUB_URL", "https://hub.example.test");
  vi.stubEnv("HUB_PUSH_TOKEN", "test-push-token-not-a-secret");
  vi.stubEnv("AIRWALLEX_CLIENT_ID", "");
  vi.stubEnv("AIRWALLEX_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the hub gate (HUB_DECISIONS_ENABLED=on)", () => {
  it("runs a proposal the person approved and the hub approved, with Purser's check pass", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z", by: "cardputer" } } });
    await execute(db, id, undefined, deps(hub));
    // Fails if: an approve with check pass and a Face ID approval does not run.
    expect(status(id)).toBe("EXECUTED");
    expect(events("hub.consulted", id).map((e) => e.outcome)).toEqual(["approve"]);
    // The read used the token header, at the decisions path.
    expect(hub.calls[0]).toMatchObject({ method: "GET", url: "https://hub.example.test/purser/decisions", headers: { "X-Push-Token": "test-push-token-not-a-secret" } });
  });

  it("never runs a run whose check is fail, even with the hub's approve and the person's approval", async () => {
    const id = proposal(refundTerms);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString());
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } });
    // Fails if: the gate lets an approve override a failed check (the emergency stop here).
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/rules fail P-0001 \(emergency_stop\); a failed run never executes/);
    expect(h.refunds).toEqual([]);
    expect(status(id)).toBe("APPROVED");
    expect(events("hub.gate_refused", id)).toHaveLength(1);
  });

  it("never runs a check-fail run when the hub is unreachable either", async () => {
    const id = proposal(refundTerms);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString());
    // Fails if: the unreachable fallback skips Purser's own check.
    await expect(execute(db, id, undefined, deps(fakeHub({ mode: "down" })))).rejects.toThrow(/emergency_stop/);
    expect(h.refunds).toEqual([]);
  });

  it("never runs a duplicate invoice payment, whatever the hub says", async () => {
    const terms = (id: string): Terms => ({ schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: EXPIRES, invoice_no: "BTX-1", amount: "240.00", beneficiary_name: "Licensor", transfer_request_id: `req-${id}` });
    const id = proposal(terms, { createdBy: "support" });
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('req-other', 'btx-1', '240.00', 'EUR', 'SWIFT', '0.00', 'PAID', 'x', 'now')").run();
    db.pragma("foreign_keys = ON");
    await consultHub(db, id, { ...deps(fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } })), now: () => T0 });
    const pre = vi.fn();
    // Fails if: the duplicate-invoice check is not part of the run's check.
    expect(() => beginExecution(db, id, pre, T0)).toThrow(/duplicate_invoice/);
    expect(pre).not.toHaveBeenCalled();
    expect(status(id)).toBe("APPROVED");
  });

  it("records a hub reject, closes the proposal and runs nothing", async () => {
    const id = proposal(refundTerms);
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "reject", at: "2026-11-04T10:00:05Z", by: "cardputer" } } });
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/rejected on the hub/);
    // Fails if: a reject is not recorded, or the proposal stays runnable.
    expect(h.refunds).toEqual([]);
    expect(events("hub.consulted", id)[0]).toMatchObject({ outcome: "reject", by: "cardputer" });
    expect(status(id)).toBe("NEEDS_REAPPROVAL");
    expect(buildPushBody(db).runs.find((r) => r.id === runId(id))).toMatchObject({ human: "rejected", check: "fail" });
  });

  it("needs the person's approval: a hub approve on a proposal nobody approved runs nothing", async () => {
    const id = proposal(devTerms, { approve: false, createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } });
    // Fails if: the hub's approve ever stands in for the person's.
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/PENDING_APPROVAL, not approved/);
    expect(status(id)).toBe("PENDING_APPROVAL");
    expect(events("hub.consulted", id)).toEqual([]);
  });

  it.each(["down", "timeout", "http500", "garbage", "badshape"] as const)("falls back to the person's approval alone when the hub is %s, and records it", async (mode) => {
    const id = proposal(devTerms, { createdBy: "system" });
    await execute(db, id, undefined, deps(fakeHub({ mode }), { timeoutMs: 20 }));
    // Fails if: an unreachable hub blocks a Face ID approval, or the fallback is not recorded.
    expect(status(id)).toBe("EXECUTED");
    expect(events("hub.consulted", id)).toEqual([expect.objectContaining({ outcome: "unreachable" })]);
  });

  it("keeps a run the hub held waiting when the hub then goes down (a restart runs approved proposals again)", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub();
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/waits for the hub/);
    hub.state.mode = "down";
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    const out = await resumeInterrupted(db, (d, pid) => execute(d, pid, undefined, deps(hub)));
    // Fails if: an unreachable hub lets a run it had held execute on Face ID alone.
    expect(out).toEqual([{ id, outcome: expect.stringContaining("waits for the hub") }]);
    expect(status(id)).toBe("APPROVED");
    expect(events("hub.consulted", id).map((e) => e.outcome)).toEqual(["none", "none"]);
  });

  it("falls back the same way when no hub address or token is set", async () => {
    vi.stubEnv("HUB_URL", "");
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub();
    await execute(db, id, undefined, deps(hub));
    expect(status(id)).toBe("EXECUTED");
    expect(events("hub.consulted", id)[0]).toMatchObject({ outcome: "unreachable", reason: "not configured" });
    expect(hub.calls).toEqual([]);
  });

  it("ignores decisions for unknown run ids and for another world's run with the same proposal id", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { "other-1-abcdef/P-0001": { decision: "approve", at: "2026-11-04T10:00:05Z" }, "P-0001": { decision: "approve", at: "2026-11-04T10:00:05Z" }, [runId("P-0999")]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } });
    // Fails if: a decision under any other key than this world's exact run id counts.
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/waits for the hub's decision/);
    expect(status(id)).toBe("APPROVED");
    expect(events("hub.consulted", id)[0]).toMatchObject({ outcome: "none" });
  });

  it("ignores a decision dated before the proposal existed, and an entry that does not validate", async () => {
    const a = proposal(devTerms, { createdBy: "system" });
    const b = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(a)]: { decision: "approve", at: "2026-11-03T09:00:00Z" }, [runId(b)]: { decision: "APPROVE!", extra: 1 } } });
    await expect(execute(db, a, undefined, deps(hub))).rejects.toThrow(/waits for the hub/);
    await expect(execute(db, b, undefined, deps(hub))).rejects.toThrow(/waits for the hub/);
    expect(events("hub.consulted", a)[0]).toMatchObject({ outcome: "none", ignored: expect.stringContaining("before the proposal") });
    expect([status(a), status(b)]).toEqual(["APPROVED", "APPROVED"]);
  });

  it("ignores a decision without a time", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    await expect(execute(db, id, undefined, deps(fakeHub({ decisions: { [runId(id)]: { decision: "approve" } } })))).rejects.toThrow(/waits for the hub/);
    expect(status(id)).toBe("APPROVED");
  });

  it("does not fall back on a restart's re-run of an approved proposal while the hub is down", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    const hub = fakeHub({ mode: "down" });
    const out = await resumeInterrupted(db, (d, pid) => execute(d, pid, undefined, deps(hub)));
    // Fails if: a restart executes on Face ID alone without a hub decision (an automatic execution).
    expect(out).toEqual([{ id, outcome: expect.stringContaining("waits for the hub") }]);
    expect(status(id)).toBe("APPROVED");
    // Once the hub is back and approves, the loop runs it.
    hub.state.mode = "ok";
    hub.state.decisions = { [runId(id)]: { decision: "approve", at: "2026-11-04T10:01:00Z" } };
    const loop = new HubLoop(db, deps(hub), (d, pid, read) => execute(d, pid, read, deps(hub)));
    expect(await loop.tick()).toEqual([id]);
    await vi.waitFor(() => expect(status(id)).toBe("EXECUTED"));
  });

  it("keeps a half-done FAILED proposal FAILED on a hub reject, so its holds stay", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    db.prepare("UPDATE proposals SET status = 'FAILED' WHERE proposal_id = ?").run(id);
    db.prepare("INSERT INTO money_steps (action_id, n, step, key, status, updated_at) VALUES (?, 1, 'step-1', 'req-1', 'DONE', 'now')").run(id);
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "reject", at: "2026-11-04T10:00:05Z" } } });
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/rejected on the hub/);
    // Fails if: a hub reject closes a proposal that already moved something (a replace hold would be released).
    expect(status(id)).toBe("FAILED");
    expect(() => beginExecution(db, id, () => {}, new Date())).toThrow(/rejected on the hub/);
  });

  it("refuses at the gate itself while the hub has no decision on the run", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    await consultHub(db, id, { ...deps(fakeHub()), now: () => T0 });
    // Fails if: "no decision yet" lets the run begin (only an approve, or an unreachable hub, may).
    expect(() => beginExecution(db, id, () => {}, T0)).toThrow(/waits for the hub's decision/);
    expect(status(id)).toBe("APPROVED");
  });

  it("refuses an executor called directly, past the dispatch, without a fresh consult", () => {
    const id = proposal(devTerms, { createdBy: "system" });
    // Fails if: an executor can bypass the gate by not going through execute().
    expect(() => beginExecution(db, id, () => {}, T0)).toThrow(/hub was not consulted/);
    expect(status(id)).toBe("APPROVED");
  });

  it("refuses a consult that is too old or was made on other terms", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } });
    await consultHub(db, id, { ...deps(hub), now: () => T0 });
    const late = new Date(T0.getTime() + CONSULT_FRESH_MS + 1000);
    // Fails if: an old approve keeps counting for a later execution.
    expect(() => beginExecution(db, id, () => {}, late)).toThrow(/hub was not consulted/);
    expect(beginExecution(db, id, () => {}, T0)).toMatchObject({ proposal_id: id });
  });

  it("lets a restart resume an execution it gated when it began", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    await consultHub(db, id, { ...deps(fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } })), now: () => T0 });
    beginExecution(db, id, () => {}, T0);
    resuming.add(id);
    try {
      // Fails if: a resume is gated again (a half-done payment could then never finish).
      expect(beginExecution(db, id, () => {}, new Date(T0.getTime() + 10 * CONSULT_FRESH_MS))).toMatchObject({ proposal_id: id });
    } finally {
      resuming.delete(id);
    }
  });

  it("re-pushes the run with human approved after it executed", async () => {
    vi.stubEnv("HUB_PUSH_ENABLED", "on");
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "approve", at: "2026-11-04T10:00:05Z" } } });
    await execute(db, id, undefined, deps(hub));
    await vi.waitFor(() => expect(hub.calls.some((c) => c.url.endsWith("/push/purser"))).toBe(true));
    const pushed = JSON.parse(hub.calls.find((c) => c.url.endsWith("/push/purser"))!.body!) as { runs: { id: string; human: string; check: string }[] };
    // Fails if: the executed run is not pushed again as approved (the hub would keep its decision).
    expect(pushed.runs.find((r) => r.id === runId(id))).toMatchObject({ human: "approved", check: "pass" });
  });
});

describe("the hub loop", () => {
  it("runs a waiting proposal once the hub approves, and nothing while the hub is unreachable", async () => {
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub();
    await expect(execute(db, id, undefined, deps(hub))).rejects.toThrow(/waits for the hub/);
    const loop = new HubLoop(db, deps(hub), (d, pid, read) => execute(d, pid, read, deps(hub)));
    expect(loop.waiting()).toEqual([id]);
    hub.state.mode = "down";
    // Fails if: the loop falls back to Face ID alone by itself (it must never auto-execute).
    expect(await loop.tick()).toEqual([]);
    expect(status(id)).toBe("APPROVED");
    hub.state.mode = "ok";
    expect(await loop.tick()).toEqual([]);
    hub.state.decisions = { [runId(id)]: { decision: "approve", at: "2026-11-04T10:01:00Z" } };
    expect(await loop.tick()).toEqual([id]);
    await vi.waitFor(() => expect(status(id)).toBe("EXECUTED"));
  });

  it("does nothing with the switch off", async () => {
    vi.stubEnv("HUB_DECISIONS_ENABLED", "");
    const hub = fakeHub();
    const loop = new HubLoop(db, deps(hub), () => Promise.reject(new Error("must not run")));
    expect(await loop.tick()).toEqual([]);
    expect(hub.calls).toEqual([]);
  });
});

describe("with HUB_DECISIONS_ENABLED off", () => {
  it("behaves as before: no hub call, no hub record, the approval alone runs it", async () => {
    vi.stubEnv("HUB_DECISIONS_ENABLED", "");
    const id = proposal(devTerms, { createdBy: "system" });
    const hub = fakeHub({ decisions: { [runId(id)]: { decision: "reject", at: "2026-11-04T10:00:05Z" } } });
    await execute(db, id, undefined, deps(hub));
    // Fails if: the switch off still asks the hub, records anything, or lets the hub's reject count.
    expect(status(id)).toBe("EXECUTED");
    expect(hub.calls).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'hub.%'").get() as { n: number }).n).toBe(0);
  });

  it("lets beginExecution run without any consult, as before", () => {
    vi.stubEnv("HUB_DECISIONS_ENABLED", "");
    const id = proposal(devTerms, { createdBy: "system" });
    expect(beginExecution(db, id, () => {}, T0)).toMatchObject({ proposal_id: id });
  });
});

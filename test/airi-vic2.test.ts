// vic-2 (src/airi/vic2.ts): what Purser adds around the Airi rail, on stand-ins only. No airi-cli, no Airwallex, no
// network: the rail's clients are the zero-budget guards over a stand-in, and the CFO's approvals are stand-in decisions.
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { StandInAiriClient } from "../src/airi/standIn.js";
import { decide } from "../src/policy/approvals.js";
import { executePolicyChange } from "../src/executors/policyChange.js";
import { assertNoSecrets } from "../src/airi/vic1.js";
import {
  EXECUTE_GRACE_MS, LOCK_KEY, PLANTED, TAMPERED_AMOUNT, Vic2Stop, plantAlteration, pollDecision, recoverVic2, runVic2, runnerProblems, zeroBudget, zeroRail,
  type Call, type RunnerEnv, type Vic2Deps,
} from "../src/airi/vic2.js";
import type { RunnerLock } from "../src/ops/runnerLock.js";

const T0 = new Date("2026-11-08T10:00:00Z");
afterEach(() => { delete process.env.KIT11_AIRI_RAIL; });

const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const approve = (db: DB, id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not the CFO)", method: "cli" }, T0);
};

/** The dry run's wiring, with hooks to make a step go wrong. */
function setup(o: { withF?: boolean; onDecide?: (db: DB, id: string, kind: string, until: string) => string | null } = {}) {
  process.env.KIT11_AIRI_RAIL = "on";
  const db = openDb(":memory:");
  const attempts: Call[] = [];
  const lines: string[] = [];
  const d: Vic2Deps = {
    db, mode: "dry", rail: zeroRail(new StandInAiriClient(), attempts), attempts: () => attempts, log: (l) => lines.push(l), withF: o.withF ?? true, now: () => T0,
    awaitCfo: async (id, until) => {
      const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(id) as { kind: string }).kind;
      const forced = o.onDecide?.(db, id, kind, until);
      if (forced) return forced;
      approve(db, id);
      if (until === "executed" && kind === "policy_change") executePolicyChange(db, id, T0);
      return status(db, id);
    },
  };
  return { db, d, attempts, lines };
}

const oks = (checks: Record<string, { ok: boolean }>) => Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.ok]));

describe("vic-2 on stand-ins", () => {
  it("D refused on the hash after the planted alteration, E refused after the lock, F offered again; 0 outside calls", async () => {
    const { db, d, attempts } = setup();
    const rec = await runVic2(d);
    expect(oks(rec.checks)).toEqual({
      d_cfo_signed: true, d_refused_hash_mismatch_0_airi_calls: true, e_lock_signed_with_face_id: true, e_refused_by_purser_0_airi_calls: true,
      f_unlock_signed_with_face_id: true, f_offered_again_stopped_before_airi: true, no_outside_calls: true,
    });
    expect(attempts).toEqual([]);
    expect(rec.label).toMatch(/DRY RUN/);
    expect(rec.planted_attack).toBe(PLANTED);
    expect(rec.checks.d_refused_hash_mismatch_0_airi_calls!.detail).toMatch(/terms do not match the approved hash/);
    expect(rec.checks.e_refused_by_purser_0_airi_calls!.detail).toMatch(/PURSER_MERCHANT_NOT_ALLOWED/);
    // D can never run: closed, its altered terms kept as evidence, with the ledger's own row saying it was our attack.
    expect(status(db, "P-0001")).toBe("NEEDS_REAPPROVAL");
    expect(JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_json: string }).terms_json)).toMatchObject({ amount: TAMPERED_AMOUNT });
    const planted = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'vic2.redteam_alteration'").get() as { payload_json: string };
    expect(JSON.parse(planted.payload_json)).toMatchObject({ run: "vic-2", label: PLANTED, proposal_id: "P-0001" });
    expect((rec.steps.D as { policy_alone_on_the_altered_terms: string }).policy_alone_on_the_altered_terms).toMatch(/^passes \(route cfo\)/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM airi_purchases").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT value FROM settings WHERE key = ?").get(LOCK_KEY)).toEqual({ value: "allowed" });
    expect(() => assertNoSecrets(JSON.stringify(rec))).not.toThrow();
  });

  it("--no-f: two decisions, the rail left locked, no f checks", async () => {
    const { db, d } = setup({ withF: false });
    const rec = await runVic2(d);
    expect(Object.keys(rec.checks)).toEqual(["d_cfo_signed", "d_refused_hash_mismatch_0_airi_calls", "e_lock_signed_with_face_id", "e_refused_by_purser_0_airi_calls", "no_outside_calls"]);
    expect(Object.values(rec.checks).every((c) => c.ok)).toBe(true);
    expect(rec.steps.F).toBeNull();
    expect(db.prepare("SELECT value FROM settings WHERE key = ?").get(LOCK_KEY)).toEqual({ value: "blocked" });
  });

  it("the CFO rejects D: nothing is altered, D's checks fail, E still runs", async () => {
    const { db, d } = setup({
      onDecide: (g, id, kind) => {
        if (kind !== "airi_purchase") return null;
        decide(g, { proposalId: id, decision: "REJECTED", typedPrefix: (g.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256.slice(0, 8), approver: "stand-in", method: "cli" }, T0);
        return "REJECTED";
      },
    });
    const rec = await runVic2(d);
    expect(oks(rec.checks)).toMatchObject({ d_cfo_signed: false, d_refused_hash_mismatch_0_airi_calls: false, e_lock_signed_with_face_id: true, e_refused_by_purser_0_airi_calls: true, no_outside_calls: true });
    expect(db.prepare("SELECT 1 FROM audit_log WHERE event = 'vic2.redteam_alteration'").get()).toBeUndefined();
  });

  it("D begun by someone else (a runner with the rail on): the run stops before the alteration", async () => {
    const { db, d } = setup({
      onDecide: (g, id, kind) => {
        if (kind !== "airi_purchase") return null;
        approve(g, id);
        g.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(id);
        return "APPROVED";
      },
    });
    await expect(runVic2(d)).rejects.toThrow(Vic2Stop);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE event = 'vic2.redteam_alteration'").get()).toBeUndefined();
  });

  it("a lock that did not hold: E's purchase runs alone, its first outside call is refused, and the run fails", async () => {
    const { d, attempts } = setup({
      // Says EXECUTED but never applies the change: the merchant stays allowed.
      onDecide: (g, id, kind) => { if (kind !== "policy_change") return null; approve(g, id); return "EXECUTED"; },
    });
    await expect(runVic2(d)).rejects.toThrow(/0 checkout calls/);
    expect(attempts).toEqual([{ op: "prepare", by: "checkout" }]);
  });
});

describe("the guards", () => {
  it("a zero-budget client refuses every method before it runs, records it by name, and reads properties through", () => {
    const attempts: Call[] = [];
    const inner = new StandInAiriClient();
    const c = zeroBudget(inner, "airi", attempts);
    expect(c.kind).toBe("stand-in");
    expect(() => c.whoami()).toThrow(Vic2Stop);
    expect(attempts).toEqual([{ op: "whoami", by: "airi" }]);
    expect(inner.calls).toEqual([]);
    const rail = zeroRail(inner, attempts);
    expect(() => rail.showPasskeyUrl("x", { actionId: "a", merchant: "m", amount: "1.00", currency: "EUR" })).toThrow(Vic2Stop);
  });

  it("the runner must hold the lock here and run without the Airi rail, Airwallex keys or Alta", () => {
    const lock = { host: "h1", pid: 42 } as RunnerLock;
    const env = (e: RunnerEnv | null) => () => e;
    const clean: RunnerEnv = { rail: null, airwallexKeys: false, metal: false };
    expect(runnerProblems(null, env(clean), "h1")[0]).toMatch(/no runner/);
    expect(runnerProblems(lock, env(clean), "h2")[0]).toMatch(/another host/);
    expect(runnerProblems(lock, env(null), "h1")[0]).toMatch(/cannot be read/);
    expect(runnerProblems(lock, env(clean), "h1")).toEqual([]);
    expect(runnerProblems(lock, env({ ...clean, rail: "off" }), "h1")).toEqual([]);
    expect(runnerProblems(lock, env({ rail: "on", airwallexKeys: true, metal: true }), "h1")).toHaveLength(3);
  });
});

describe("waiting for the CFO (live)", () => {
  async function proposal() {
    process.env.KIT11_AIRI_RAIL = "on";
    const { d, db } = setup();
    const { proposePolicyChange } = await import("../src/executors/policyChange.js");
    const { seedPolicy } = await import("../src/airi/vic1.js");
    seedPolicy(db, T0, "vic-2");
    const p = proposePolicyChange(db, { changes: [{ key: LOCK_KEY, to: "blocked" }], reason: "test", ttlMs: 5 * 60_000 }, "human", T0);
    return { db, d, id: p.proposal_id };
  }
  const clock = (start: Date) => { let t = start.getTime(); return { now: () => new Date(t), sleep: async (ms: number) => { t += ms; } }; };

  it("returns the decision; a notice each minute while it waits; expired when its time runs out", async () => {
    const { db, id } = await proposal();
    const c = clock(T0);
    const lines: string[] = [];
    expect(await pollDecision(db, id, "decided", { ...c, log: (l) => lines.push(l), everyMs: 10_000 })).toBe("EXPIRED");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toMatch(/still waiting for the CFO's Face ID on P-0001, about \d+ min left/);
  });

  it("executed: waits for the runner, and gives up a grace period after the approval", async () => {
    const { db, id } = await proposal();
    approve(db, id);
    const c = clock(T0);
    expect(await pollDecision(db, id, "decided", { ...c, log: () => {} })).toBe("APPROVED");
    expect(await pollDecision(db, id, "executed", { ...c, log: () => {}, everyMs: 5_000 })).toBe("APPROVED");
    expect(c.now().getTime() - T0.getTime()).toBeGreaterThanOrEqual(EXECUTE_GRACE_MS);
    executePolicyChange(db, id, T0);
    expect(await pollDecision(db, id, "executed", { ...c, log: () => {} })).toBe("EXECUTED");
  });
});

describe("recover", () => {
  it("closes a D altered after signing; reports the lock", async () => {
    process.env.KIT11_AIRI_RAIL = "on";
    const { db, d } = setup();
    const { seedPolicy } = await import("../src/airi/vic1.js");
    const { requestAiriPurchase } = await import("../src/airi/purchase.js");
    seedPolicy(db, T0, "vic-2");
    const out = await requestAiriPurchase(db, d.rail, { agent: "sourcing", paymentMethodId: "none", merchantName: "x", merchantUrl: "https://kit11.max-31b.workers.dev/", merchantCountry: "NL", amount: "30.00", currency: "EUR", items: [{ name: "i", unitPrice: "30.00", quantity: "1" }], description: "vic-2 D: test" }, T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    plantAlteration(db, out.proposalId, T0);
    const lines = recoverVic2(db, T0);
    expect(lines[0]).toMatch(/P-0001 airi_purchase: altered after signing; closed NEEDS_REAPPROVAL/);
    expect(lines.at(-1)).toBe(`${LOCK_KEY} = allowed`);
    expect(status(db, out.proposalId)).toBe("NEEDS_REAPPROVAL");
  });
});

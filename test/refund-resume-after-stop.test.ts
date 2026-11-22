// A payment reserved, interrupted, and resumed after the CFO stopped it (outside audit, 22 November). A refund batch the
// CFO approved dies after its first refund was reserved (its hold HELD) and before the pull; while the runner is down
// the CFO pulls the emergency stop, or revokes the support agent. On restart the resume pulls nothing: reserveSpend asks
// the stop and the agent's identity again for a ref already HELD (src/policy/holds.ts, stopRefusal), and the batch asks
// them before each refund not yet finished (src/executors/refundBatch.ts). A SETTLED ref stays idempotent: it is a
// payment already in the ledger, and nothing new is sent for it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeRefundBatch } from "../src/executors/refundBatch.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { recoverHolds, reserveSpend, settleHold } from "../src/policy/holds.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { chaos, resumeInterrupted } from "../src/policy/saga.js";
import { setSetting } from "../src/world/settings.js";

const PAYER = "0x00000000000000000000000000000000000000c1";
const stops = {
  freeze: (db: DB) => setSetting(db, "human", "freeze", "on"),
  revoke: (db: DB) => revokePrincipal(db, "support", "compromised", "cfo"),
} as const;

describe("a refund batch resumed after a crash, with the stop applied while the runner was down", () => {
  for (const [stop, apply] of Object.entries(stops)) {
    it(`${stop}: the resume pulls nothing and the batch fails`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "refund-resume-"));
      const file = join(dir, "w.sqlite");
      const db = openDb(file);
      try {
        audit(db, "treasury", "mandate.bound", "support", { cap: "0.10", budget: "4.00", payee: "0x0000000000000000000000000000000000000001" });
        db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-1', 'Summit Outfitters', 'x', 'now')").run();
        const refunds = [1, 2].map(() => {
          const s = Number(db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(PAYER).lastInsertRowid);
          return { sale_id: String(s), payment_id: `refund-${s}`, to: PAYER, amount: "0.05" };
        });
        const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2099-01-01T00:00:00Z", dispute_id: "D-1", customer: "Summit Outfitters", refunds, total: "0.10", reason: "r", evidence: [] };
        const p = createProposal(db, { terms: terms as never, createdBy: "support" });
        decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
        const pulls: string[] = [];
        const pull = async (a: { paymentId: string }) => { pulls.push(a.paymentId); return { outcome: "PAID" as const, tx: `0x${"ab".repeat(32)}`, reason: null, already: false }; };

        // Life 1 dies (hangs for ever) at the first refund's before-pull checkpoint: its hold is HELD, nothing is pulled.
        chaos.at = (point) => (point === "refund:before-pull" ? new Promise<void>(() => {}) : undefined);
        void executeRefundBatch(db, "P-0001", pull as never);
        await new Promise((r) => setTimeout(r, 100));
        chaos.at = null;
        expect(db.prepare("SELECT ref, status FROM holds").all()).toEqual([{ ref: refunds[0]!.payment_id, status: "HELD" }]);

        // While down: the CFO's stop. Life 2, a restart: holds recovered, what was executing resumed.
        const db2 = openDb(file);
        apply(db2);
        recoverHolds(db2);
        const resumed = await resumeInterrupted(db2, (d, id) => executeRefundBatch(d, id, pull as never));
        expect(pulls).toEqual([]);
        expect(resumed).toEqual([{ id: "P-0001", outcome: expect.stringMatching(stop === "freeze" ? /frozen_by_cfo/ : /principal_revoked/) }]);
        expect((db2.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get() as { status: string }).status).toBe("FAILED");
        expect(db2.prepare("SELECT outcome FROM refunds WHERE outcome IN ('PAID', 'PENDING', 'HELD')").all()).toEqual([]);
        db2.close();
      } finally {
        chaos.at = null;
        db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("reserveSpend with a ref it already holds", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const later = (h: number) => new Date(now.getTime() + h * 3_600_000);
  function world() {
    const db = openDb(":memory:");
    audit(db, "treasury", "mandate.bound", "treasury", { cap: "4.00", budget: "12.00" }, now);
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-1", now })).toBeNull();
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-2", now: later(1) })).toBeNull();
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-2', 100, 'PAID', ?)").run(now.toISOString());
    settleHold(db, "sweep-2", now);
    return db;
  }

  it("is the same payment again while nothing stops it: HELD and SETTLED refs both reserve once", () => {
    const db = world();
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-1", now: later(2) })).toBeNull();
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-2", now: later(2) })).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM holds").get()).toEqual({ n: 2 });
  });

  for (const [stop, apply, why] of [
    ["the emergency stop", (db: DB) => setSetting(db, "human", "freeze", "on"), /^frozen_by_cfo/],
    ["the agent's revocation", (db: DB) => revokePrincipal(db, "treasury", "compromised", "cfo"), /^principal_revoked/],
    ["the agent's pause", (db: DB) => setSetting(db, "human", "pause.treasury", "on"), /^paused_by_cfo/],
  ] as const) {
    it(`after ${stop}: a HELD ref is refused (and stays held, counting); a SETTLED ref stays idempotent`, () => {
      const db = world();
      apply(db);
      expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-3", now: later(2) })).toMatch(why);
      expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-1", now: later(2) })).toMatch(why);
      expect(db.prepare("SELECT status FROM holds WHERE ref = 'sweep-1'").get()).toEqual({ status: "HELD" });
      expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "sweep-2", now: later(2) })).toBeNull();
    });
  }
});

// A restart must also finish an action that was approved but never started: dry-6 killed the runner right after the
// CFO's Face ID on the licence, and after the restart the payment stayed APPROVED for good. Resuming it goes through
// the executor's own checks (hash, approval, expiry), so a late or changed proposal still runs nothing.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { beginExecution, createProposal, decide, finishExecution } from "../src/policy/approvals.js";
import { resumeInterrupted } from "../src/policy/saga.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };

function approved() {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: termsHash(terms).slice(0, 8), approver: "max", method: "cli" }, t0);
  return db;
}
const status = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get() as { status: string }).status;

describe("a restart after an approval that never started", () => {
  it("runs the approved action once", async () => {
    const db = approved();
    const runs: string[] = [];
    const run = (d: typeof db, id: string, now: Date) => { runs.push(id); beginExecution(d, id, () => {}, now); finishExecution(d, id, "EXECUTED", {}, now); };
    const late = new Date("2026-10-30T14:05:00Z");
    const out = await resumeInterrupted(db, async (d, id) => run(d, id, late), late);
    expect(runs).toEqual(["P-0001"]);
    expect(out).toEqual([{ id: "P-0001", outcome: "EXECUTED" }]);
    expect(status(db)).toBe("EXECUTED");
    // A second restart finds nothing left to do.
    expect(await resumeInterrupted(db, async (d, id) => run(d, id, late), late)).toEqual([]);
    expect(runs).toEqual(["P-0001"]);
  });

  it("lets the executor refuse it once the proposal has expired: nothing runs", async () => {
    const db = approved();
    const after = new Date("2026-10-30T14:11:00Z");
    const out = await resumeInterrupted(db, async (d, id) => { beginExecution(d, id, () => {}, after); }, after);
    expect(out[0]?.outcome).toMatch(/expired/);
    expect(status(db)).toBe("EXPIRED");
  });
});

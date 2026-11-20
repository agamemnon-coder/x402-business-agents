// Two small rules on the paths the other files leave. Whether a name is a company's (src/policy/fraudCore.ts
// namesACompany): a legal form abbreviated with dots or slashes inside a name of two or more words is one, a bare word is
// not, and an empty name is no company. Taking a line out of a waiting batch (src/policy/batch.ts removeBatchLine): a
// line that no longer waits on its own is not superseded again, and the other lines go on in a new batch.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, nextProposalId } from "../src/policy/approvals.js";
import { batchLinesOf, createBatch, removeBatchLine } from "../src/policy/batch.js";
import { namesACompany } from "../src/policy/fraudCore.js";

const now = new Date("2026-11-20T10:00:00Z");

describe("a company's name", () => {
  it("an abbreviated legal form inside a name of two or more words is one; a bare word or nothing is not", () => {
    expect(namesACompany("Kovac q.x.z")).toBe(true);
    expect(namesACompany("Kovac")).toBe(false);
    expect(namesACompany("")).toBe(false);
  });
});

describe("taking a line out of a waiting batch", () => {
  it("a line that no longer waits on its own is not superseded again; the others go on in a new batch", () => {
    const db = openDb(":memory:");
    const ids: string[] = [];
    for (const [amount, vendor] of [["120.00", "Bergtex"], ["130.00", "Ridgeline"], ["140.00", "Packwise"]] as const) {
      const id = nextProposalId(db);
      createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor } as Terms, createdBy: "treasury" }, now);
      ids.push(id);
    }
    const batch = createBatch(db, ids, "treasury", now);
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(ids[0]);
    const next = removeBatchLine(db, batch.proposal_id, ids[0]!, "max", now)!;
    expect(batchLinesOf(db, next.proposal_id).map((l) => l.proposal_id)).toEqual([ids[1], ids[2]]);
    const superseded = (db.prepare("SELECT subject FROM audit_log WHERE event = 'proposal.superseded' ORDER BY seq").all() as { subject: string }[]).map((r) => r.subject);
    expect(superseded).toEqual([batch.proposal_id]);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(ids[0]) as { status: string }).status).toBe("EXPIRED");
  });
});

// Mutation testing, 20 November (docs/evidence/mutation-testing.md, groups approval-decide, approval-alone and
// approval-guard): the gaps the surviving mutants of src/policy/approvals.ts showed, against every test file that imports
// it. Breaks if the execution guard runs terms at or after their signed expiry (the earlier of the terms' and the
// column's), runs on an audit log that no longer verifies (except a policy change or a restart's resume), lets a
// precondition's refusal move the proposal, starts a resume as a new execution, or if closing, finishing, the signed terms
// for the books or the expiry sweep change what they accept or record.
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { beginExecution, closeAsStale, createProposal, decide, expireDue, finishExecution, resuming, signedTerms } from "../src/policy/approvals.js";

const T0 = new Date("2026-11-20T10:00:00Z");
const EXPIRES = "2026-11-20T10:10:00Z";

function filed(db: DB, id = "P-0001", extra: Record<string, unknown> = {}): { id: string; terms: Terms; hash: string } {
  const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: EXPIRES, total: "0.60", ...extra } as Terms;
  createProposal(db, { terms, createdBy: "support" }, T0);
  return { id, terms, hash: termsHash(terms) };
}
function approved(db: DB, id = "P-0001", extra: Record<string, unknown> = {}) {
  const p = filed(db, id, extra);
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.hash.slice(0, 8), approver: "max", method: "cli" }, T0);
  return p;
}
const status = (db: DB, id = "P-0001") => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const events = (db: DB, event: string) => db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { actor: string; subject: string; payload_json: string }[];
const thrown = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return (e as Error).message; } };

afterEach(() => resuming.clear());

describe("the execution guard: expiry", () => {
  it("runs a millisecond before the signed expiry, and voids the approval at it (APPROVED and FAILED alike)", () => {
    const db = openDb(":memory:");
    approved(db);
    const before = new Date(Date.parse(EXPIRES) - 1);
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, before))).toBeNull();
    finishExecution(db, "P-0001", "FAILED", {}, before);
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, new Date(EXPIRES)))).toBe(`P-0001 expired at ${EXPIRES}; approval void`);
    expect(status(db)).toBe("EXPIRED");
    expect(events(db, "proposal.expired")).toHaveLength(1);
  });

  it("counts the earlier of the signed expiry and the column: pushing the column out buys no time, pulling it in does", () => {
    const db = openDb(":memory:");
    approved(db, "P-0001");
    db.prepare("UPDATE proposals SET expires_at = '2026-11-21T00:00:00Z' WHERE proposal_id = 'P-0001'").run();
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, new Date(EXPIRES)))).toBe(`P-0001 expired at ${EXPIRES}; approval void`);
    approved(db, "P-0002");
    db.prepare("UPDATE proposals SET expires_at = '2026-11-20T10:05:00Z' WHERE proposal_id = 'P-0002'").run();
    expect(thrown(() => beginExecution(db, "P-0002", () => {}, new Date("2026-11-20T10:05:00Z")))).toBe("P-0002 expired at 2026-11-20T10:05:00Z; approval void");
  });

  it("an EXECUTING proposal is not expired by the guard (a restart's resume finishes what it began)", () => {
    const db = openDb(":memory:");
    approved(db);
    beginExecution(db, "P-0001", () => {}, T0);
    resuming.add("P-0001");
    const late = new Date("2026-11-20T11:00:00Z");
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, late))).toBeNull();
    expect(status(db)).toBe("EXECUTING");
  });
});

describe("the execution guard: the run itself", () => {
  it("hands the precondition check the signed terms; its refusal leaves the proposal APPROVED and records nothing", () => {
    const db = openDb(":memory:");
    const p = approved(db);
    let seen: unknown = null;
    expect(thrown(() => beginExecution(db, "P-0001", (t) => { seen = t; throw new Error("quote used"); }, T0))).toBe("quote used");
    expect(seen).toEqual(p.terms);
    expect(status(db)).toBe("APPROVED");
    expect(events(db, "proposal.executing")).toEqual([]);
  });

  it("moves to EXECUTING once, recording the hash it ran on; a resume moves nothing and records nothing", () => {
    const db = openDb(":memory:");
    const p = approved(db);
    expect(beginExecution(db, "P-0001", () => {}, T0)).toEqual(p.terms);
    expect(status(db)).toBe("EXECUTING");
    expect(events(db, "proposal.executing").map((e) => [e.actor, JSON.parse(e.payload_json)])).toEqual([["system", { terms_sha256: p.hash }]]);
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, T0))).toBe("P-0001 is EXECUTING, not approved");
    resuming.add("P-0001");
    let checked = false;
    expect(beginExecution(db, "P-0001", () => { checked = true; }, T0)).toEqual(p.terms);
    expect(checked).toBe(true); // a resume still runs the executor's preconditions
    expect(events(db, "proposal.executing")).toHaveLength(1);
  });

  it("refuses a rejection on record and a missing approval as 'no approval', and each one-sided hash change", () => {
    const db = openDb(":memory:");
    const p = filed(db);
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = 'P-0001'").run();
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, T0))).toBe("P-0001 has no approval");
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-0001', 'REJECTED', ?, 'max', 'cli', 'x', ?)").run(p.hash, T0.toISOString());
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, T0))).toBe("P-0001 has no approval");
    const q = approved(db, "P-0002");
    db.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = 'P-0002'").run("0".repeat(64));
    expect(thrown(() => beginExecution(db, "P-0002", () => {}, T0))).toBe(`P-0002: terms do not match the approved hash ${"0".repeat(64)}`);
    db.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = 'P-0002'").run(q.hash);
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = 'P-0002'").run("1".repeat(64));
    expect(thrown(() => beginExecution(db, "P-0002", () => {}, T0))).toBe(`P-0002: terms do not match the approved hash ${q.hash}`);
    expect(status(db, "P-0002")).toBe("APPROVED");
  });
});

describe("the execution guard: the audit log", () => {
  it("refuses on a log that no longer verifies, records why, and still runs a policy change", () => {
    const db = openDb(":memory:");
    approved(db, "P-0001");
    approved(db, "P-0002", { kind: "policy_change" });
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare("UPDATE audit_log SET payload_json = '{}' WHERE seq = 1").run();
    const why = thrown(() => beginExecution(db, "P-0001", () => {}, T0));
    expect(why).toMatch(/^P-0001: ledger_tampered: the audit log does not verify at row 1 /);
    const rows = events(db, "execution.refused_ledger_tampered");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe("system");
    expect(JSON.parse(rows[0]!.payload_json)).toEqual({ reason: why!.slice("P-0001: ".length), kind: "refund_batch" });
    expect(status(db, "P-0001")).toBe("APPROVED");
    expect(thrown(() => beginExecution(db, "P-0002", () => {}, T0))).toBeNull();
  });

  it("does not refuse a restart's resume on it (it was checked when it began)", () => {
    const db = openDb(":memory:");
    approved(db);
    beginExecution(db, "P-0001", () => {}, T0);
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare("UPDATE audit_log SET payload_json = '{}' WHERE seq = 1").run();
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, T0))).toMatch(/ledger_tampered|EXECUTING, not approved/);
    resuming.add("P-0001");
    expect(thrown(() => beginExecution(db, "P-0001", () => {}, T0))).toBeNull();
  });
});

describe("after the guard", () => {
  it("finishExecution moves EXECUTING to the outcome and records it under its own name", () => {
    const db = openDb(":memory:");
    approved(db);
    beginExecution(db, "P-0001", () => {}, T0);
    finishExecution(db, "P-0001", "NEEDS_REAPPROVAL", { why: "spent moved" }, T0);
    expect(status(db)).toBe("NEEDS_REAPPROVAL");
    expect(events(db, "proposal.needs_reapproval").map((e) => [e.actor, JSON.parse(e.payload_json)])).toEqual([["system", { why: "spent moved" }]]);
    expect(thrown(() => finishExecution(db, "P-0001", "EXECUTED", {}, T0))).toBe("P-0001 is no longer EXECUTING");
  });

  it("closeAsStale closes waiting, approved and failed proposals, an EXECUTING one only for a resume, and nothing else", () => {
    const db = openDb(":memory:");
    filed(db, "P-0001");
    approved(db, "P-0002");
    approved(db, "P-0003");
    beginExecution(db, "P-0003", () => {}, T0);
    const long = "x".repeat(400);
    expect(closeAsStale(db, "P-0001", { error: long, extra: "kept" }, {}, T0)).toBe(true);
    const row = JSON.parse(events(db, "proposal.needs_reapproval")[0]!.payload_json) as { error: string; from: string; extra: string };
    expect(row).toEqual({ error: long.slice(0, 300), extra: "kept", from: "PENDING_APPROVAL" });
    expect(closeAsStale(db, "P-0003", { error: "e" }, {}, T0)).toBe(false);
    expect(status(db, "P-0003")).toBe("EXECUTING");
    expect(closeAsStale(db, "P-0003", { error: "e" }, { resuming: true }, T0)).toBe(true);
    expect(closeAsStale(db, "P-0002", { error: "e" }, {}, T0)).toBe(true);
    expect(closeAsStale(db, "P-0002", { error: "e" }, {}, T0)).toBe(false);
    expect([status(db, "P-0001"), status(db, "P-0002"), status(db, "P-0003")]).toEqual(["NEEDS_REAPPROVAL", "NEEDS_REAPPROVAL", "NEEDS_REAPPROVAL"]);
  });

  it("signedTerms gives the signed terms only while both hashes stand, and says why not", () => {
    const db = openDb(":memory:");
    expect(signedTerms(db, "P-0404")).toEqual({ ok: false, reason: "no proposal P-0404" });
    filed(db, "P-0001");
    expect(signedTerms(db, "P-0001")).toEqual({ ok: false, reason: "P-0001 has no approval" });
    const p = approved(db, "P-0002");
    expect(signedTerms(db, "P-0002")).toEqual({ ok: true, terms: p.terms, sha256: p.hash });
    db.prepare("UPDATE proposals SET terms_json = '{' WHERE proposal_id = 'P-0002'").run();
    expect(signedTerms(db, "P-0002")).toEqual({ ok: false, reason: "P-0002: the stored terms cannot be read, so they do not match the approved hash" });
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = 'P-0002'").run(JSON.stringify(p.terms), "1".repeat(64));
    expect(signedTerms(db, "P-0002")).toEqual({ ok: false, reason: "P-0002: the stored terms do not match the approved hash" });
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = 'P-0002'").run(p.hash);
    db.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = 'P-0002'").run("0".repeat(64));
    expect(signedTerms(db, "P-0002")).toEqual({ ok: false, reason: "P-0002: the stored terms do not match the approved hash" });
  });

  it("expireDue expires waiting and approved proposals at their expiry, compared as instants, and returns their ids", () => {
    const db = openDb(":memory:");
    filed(db, "P-0001");
    approved(db, "P-0002");
    approved(db, "P-0003");
    beginExecution(db, "P-0003", () => {}, T0);
    db.prepare("UPDATE proposals SET expires_at = '2026-11-20T10:10:00.000Z' WHERE proposal_id = 'P-0002'").run();
    expect(expireDue(db, new Date(Date.parse(EXPIRES) - 1))).toEqual([]);
    expect(expireDue(db, new Date(EXPIRES))).toEqual(["P-0001", "P-0002"]);
    expect([status(db, "P-0001"), status(db, "P-0002"), status(db, "P-0003")]).toEqual(["EXPIRED", "EXPIRED", "EXECUTING"]);
  });
});

// Mutation testing, 20 November (docs/evidence/mutation-testing.md, group hashfirst): the gaps the surviving mutants of
// src/policy/hashFirst.ts showed. Its two importers drive it only through the executors' happy and forged paths, so no
// test asked signedHashRefusal about a proposal that does not exist, one with no approval or a rejection on record, or a
// stored hash changed on one side only; nor read the refusal it records before any outside call. Breaks if any of those
// answers changes, or if a restart's resume (EXECUTING, resuming) is held to the signature check again, or a proposal
// EXECUTING without a resume runs.
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { createProposal, REFUSED_UNSIGNED, resuming } from "../src/policy/approvals.js";
import { hashFirst, signedHashRefusal } from "../src/policy/hashFirst.js";

const NOW = new Date("2026-11-20T10:00:00Z");

function proposal(db: DB, id = "P-0001"): { id: string; hash: string; terms: Terms } {
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount: "120.00", currency: "EUR" } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return { id, hash: termsHash(terms), terms };
}

/** An approval row as the CLI writes one (a typed prefix; no passkey enrolled, so it stands), and the status. */
function approve(db: DB, id: string, hash: string, opts: { decision?: string; method?: string; status?: string } = {}): void {
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, ?, ?, 'max', ?, ?, ?)")
    .run(id, opts.decision ?? "APPROVED", hash, opts.method ?? "cli", hash.slice(0, 8), NOW.toISOString());
  db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(opts.status ?? "APPROVED", id);
}

const thrown = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return (e as Error).message; } };

afterEach(() => resuming.clear());

describe("signedHashRefusal: why the stored terms are not the approved ones", () => {
  it("names a proposal that does not exist, and hashFirst refuses it with the same words", () => {
    const db = openDb(":memory:");
    expect(signedHashRefusal(db, "P-0404")).toBe("no proposal P-0404");
    expect(thrown(() => hashFirst(db, "P-0404"))).toBe("no proposal P-0404");
  });

  it("refuses a proposal with no approval, and one whose approval row is a rejection, as having no approval", () => {
    const db = openDb(":memory:");
    const a = proposal(db, "P-0001");
    expect(signedHashRefusal(db, a.id)).toBe("P-0001 has no approval");
    const b = proposal(db, "P-0002");
    approve(db, b.id, b.hash, { decision: "REJECTED" }); // the status forged to APPROVED beside a rejection
    expect(signedHashRefusal(db, b.id)).toBe("P-0002 has no approval");
    expect(thrown(() => hashFirst(db, b.id))).toBe("P-0002 has no approval");
  });

  it("passes intact approved terms, and refuses each one-sided change of terms, stored hash or approved hash", () => {
    const db = openDb(":memory:");
    const p = proposal(db);
    approve(db, p.id, p.hash);
    expect(signedHashRefusal(db, p.id)).toBeNull();
    expect(() => hashFirst(db, p.id)).not.toThrow();
    const refusal = `${p.id}: terms do not match the approved hash ${p.hash}`;
    // The terms changed, the stored hash kept.
    const changed = { ...p.terms, amount: "9999.00" } as Terms;
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(changed), p.id);
    expect(signedHashRefusal(db, p.id)).toBe(refusal);
    // The terms changed and the stored hash moved with them: only the approval's hash still says what was signed.
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = ?").run(termsHash(changed), p.id);
    expect(signedHashRefusal(db, p.id)).toBe(refusal);
    expect(thrown(() => hashFirst(db, p.id))).toBe(refusal);
    // The signed terms back, the stored hash left changed.
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(p.terms), p.id);
    expect(signedHashRefusal(db, p.id)).toBe(refusal);
    // Terms that cannot be read at all.
    db.prepare("UPDATE proposals SET terms_json = '{', terms_sha256 = ? WHERE proposal_id = ?").run(p.hash, p.id);
    expect(signedHashRefusal(db, p.id)).toBe(refusal);
  });

  it("refuses the stored terms when only the approval's hash differs", () => {
    const db = openDb(":memory:");
    const p = proposal(db);
    approve(db, p.id, "0".repeat(64));
    expect(signedHashRefusal(db, p.id)).toBe(`${p.id}: terms do not match the approved hash ${"0".repeat(64)}`);
  });
});

describe("hashFirst: which statuses may run", () => {
  it("runs APPROVED and FAILED, refuses EXECUTING unless a restart resumes it, and every other status", () => {
    const db = openDb(":memory:");
    const p = proposal(db);
    approve(db, p.id, p.hash);
    const set = (s: string) => db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(s, p.id);
    for (const s of ["APPROVED", "FAILED"]) { set(s); expect(thrown(() => hashFirst(db, p.id))).toBeNull(); }
    for (const s of ["EXECUTING", "PENDING_APPROVAL", "REJECTED", "EXPIRED", "EXECUTED", "NEEDS_REAPPROVAL"]) {
      set(s);
      expect(thrown(() => hashFirst(db, p.id))).toBe(`${p.id} is ${s}, not approved`);
    }
    resuming.add(p.id);
    set("EXECUTING");
    expect(thrown(() => hashFirst(db, p.id))).toBeNull();
    // A resume of another proposal does not let this one run.
    resuming.clear();
    resuming.add("P-0999");
    expect(thrown(() => hashFirst(db, p.id))).toBe(`${p.id} is EXECUTING, not approved`);
  });

  it("checks the stored signature on a new run, not on a restart's resume, and records the refusal it makes", () => {
    const db = openDb(":memory:");
    // A long id, so the refusal is over the 400 characters the record keeps.
    const id = `P-${"9".repeat(420)}`;
    const p = proposal(db, id);
    approve(db, id, p.hash, { method: "passkey" }); // an approval row nobody signed
    const why = thrown(() => hashFirst(db, id));
    expect(why).toMatch(/^execution_refused_unsigned: .*no passkey signature is stored for its terms; no money moves on it$/);
    const rows = db.prepare("SELECT actor, payload_json FROM audit_log WHERE event = ? AND subject = ?").all(REFUSED_UNSIGNED, id) as { actor: string; payload_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe("system");
    const payload = JSON.parse(rows[0]!.payload_json) as { reason: string; at: string };
    expect(payload.at).toBe("before any outside call");
    expect(payload.reason).toHaveLength(400);
    expect(why).toContain(payload.reason);
    // A restart's resume of the same action was checked when it began: not again, and nothing more is recorded.
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(id);
    resuming.add(id);
    expect(thrown(() => hashFirst(db, id))).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(REFUSED_UNSIGNED)).toEqual({ n: 1 });
  });
});

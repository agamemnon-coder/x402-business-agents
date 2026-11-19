// Red team rewrite-history (19 Nov, fourth round): a rewritten audit log moves no money. The write guards refuse a
// replaced row (INSERT OR REPLACE slipped past them until now), and every payment verifies the chain first: an agent's
// spend (reserveSpend) and every approved action but a policy change (beginExecution). No network.
import { describe, expect, it } from "vitest";
import { audit, verifyAuditChain } from "../src/audit/log.js";
import { AUDIT_GUARDS, auditChainRefusal } from "../src/audit/intact.js";
import { openDb } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { processAssertion } from "../src/passkey/process.js";
import { beginExecution } from "../src/policy/approvals.js";
import { reserveSpend } from "../src/policy/holds.js";
import { frozen } from "../src/policy/rules.js";
import { ATTACKS, CAUGHT_AFTER, runAttack } from "../src/redteam/attacks.js";
import { redTeamWorld } from "../src/redteam/world.js";

const REPLACE = "INSERT OR REPLACE INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) SELECT seq, ts, actor, event, subject, '{\"status\":\"PAID\"}', prev_hash, row_hash FROM audit_log WHERE seq = 2";

describe("the audit log's write guards", () => {
  it("refuse a row replaced by INSERT OR REPLACE, by its seq or by its hash; an append still works", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) audit(db, "treasury", "transfer.status", `tr-${i}`, { status: "FAILED" });
    expect(() => db.prepare(REPLACE).run()).toThrow(/append-only/);
    expect(() => db.prepare("INSERT OR REPLACE INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) SELECT 99, ts, actor, event, subject, payload_json, prev_hash, row_hash FROM audit_log WHERE seq = 2").run()).toThrow(/append-only/);
    audit(db, "treasury", "transfer.status", "tr-3", { status: "PAID" });
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, rows: 4 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").get() as { n: number }).n).toBe(AUDIT_GUARDS.length);
  });
});

describe("before money moves, the audit chain must verify", () => {
  it("finds a row changed after the guard was dropped, also once the guard is put back and after rows were checked before", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 5; i++) audit(db, "system", "x.y", `s${i}`, { i });
    expect(auditChainRefusal(db)).toBeNull();
    audit(db, "system", "x.y", "s5", { i: 5 });
    expect(auditChainRefusal(db)).toBeNull();
    const guard = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'audit_log_no_update'").get() as { sql: string }).sql;
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare("UPDATE audit_log SET payload_json = '{\"i\":99}' WHERE seq = 2").run();
    db.exec(guard);
    expect(auditChainRefusal(db)).toMatch(/^ledger_tampered: the audit log does not verify at row 2/);
  });

  it("refuses an agent's spend and an approved payment on a rewritten log, records the refusal, and still runs the emergency stop", async () => {
    const w = await redTeamWorld();
    const p = w.propose();
    await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "before", now: w.now(), payee: "supplier" })).toBeNull();
    w.db.exec("DROP TRIGGER audit_log_no_update");
    w.db.prepare("UPDATE audit_log SET payload_json = '{}' WHERE seq = 3").run();
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "after", now: w.now(), payee: "supplier" })).toMatch(/^ledger_tampered: /);
    expect(() => beginExecution(w.db, p.id, () => {}, w.now())).toThrow(/ledger_tampered/);
    expect(w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.id)).toEqual({ status: "APPROVED" });
    expect(w.db.prepare("SELECT subject FROM audit_log WHERE event = 'execution.refused_ledger_tampered'").all()).toEqual([{ subject: p.id }]);
    // The CFO's emergency stop moves no money and must work in an incident: a policy change still runs.
    const stop = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "on" }], reason: "the audit log does not verify" }, "human", w.now());
    await processAssertion(w.db, w.cfoApproval(stop.proposal_id, stop.terms_sha256), w.now());
    executePolicyChange(w.db, stop.proposal_id, w.now());
    expect(frozen(w.db)).toBe(true);
  });

  it("lets payments run as before on a log that verifies", async () => {
    const w = await redTeamWorld();
    const p = w.propose();
    await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "ok", now: w.now(), payee: "supplier" })).toBeNull();
    expect(() => beginExecution(w.db, p.id, () => {}, w.now())).not.toThrow();
  });

  it("the red team's rewrite-history attack is now stopped before money moves; only hidden-payment is found afterwards", async () => {
    const a = ATTACKS.find((x) => x.id === "rewrite-history")!;
    const r = await runAttack(await redTeamWorld(), a);
    expect(r).toMatchObject({ outcome: "blocked", caught: "before" });
    expect(r.evidence).toMatch(/replace: audit_log is append-only; chain broken at row \d+; approved payment: P-\d+: ledger_tampered/);
    expect([...CAUGHT_AFTER]).toEqual(["hidden-payment"]);
  });
});

describe("the audit check where the database refuses its own catalogue (a Durable Object)", () => {
  it("still verifies the whole chain, and still refuses a changed row, when PRAGMA and sqlite_master answer 'not authorized'", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) audit(db, "system", "x.y", `s${i}`, { i });
    // As a Durable Object's SQLite answers: no schema_version, no sqlite_master.
    const realPragma = db.pragma.bind(db), realPrepare = db.prepare.bind(db);
    const refused = () => { throw new Error("not authorized: SQLITE_AUTH"); };
    (db as unknown as { pragma: unknown }).pragma = (sql: string, o?: unknown) => (/schema_version/.test(sql) ? refused() : realPragma(sql, o as never));
    (db as unknown as { prepare: unknown }).prepare = (sql: string) => (/sqlite_master/.test(sql) ? refused() : realPrepare(sql));
    expect(auditChainRefusal(db)).toBeNull();
    expect(auditChainRefusal(db)).toBeNull();
    db.exec("DROP TRIGGER audit_log_no_update");
    realPrepare("UPDATE audit_log SET payload_json = '{\"i\":99}' WHERE seq = 1").run();
    expect(auditChainRefusal(db)).toMatch(/^ledger_tampered: the audit log does not verify at row 1/);
  });
});

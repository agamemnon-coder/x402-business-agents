// The last checks before a payment is approved (src/policy/approvals.ts), the refusals the other files leave: a payment
// paid alone within the CFO's limit is refused when its terms cannot be read, when it waits in a batch, when it has run
// out, when the limit handed in is not the one in force, when it needs two people, or when it is high-risk; each leaves
// it with the CFO, untouched. A high-risk payment approved by typed prefix, and a proposal whose terms cannot be read,
// approve nothing; rejecting a batch skips a line that no longer waits. Test money only; no network.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { approveWithinLimit, createProposal, decide } from "../src/policy/approvals.js";
import { createBatch } from "../src/policy/batch.js";
import { FOUR_EYES_KEY } from "../src/policy/fourEyes.js";
import { SECOND_KEY_EUR } from "../src/policy/secondKey.js";

const NOW = new Date("2026-11-16T10:00:00Z");
const LIMIT = { currency: "EUR", amount: "500.00" };
const terms = (id: string, o: Record<string, unknown> = {}) =>
  ({ schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-16T11:00:00.000Z", amount: "120.00", currency: "EUR", vendor: "Bergtex", iban_last4: "3000", bic: "COBADEFFXXX", ...o }) as unknown as Terms;
const file = (db: DB, id: string, o: Record<string, unknown> = {}) => createProposal(db, { terms: terms(id, o), createdBy: "treasury" }, NOW);
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const setting = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, NOW.toISOString());
const world = () => { const db = openDb(":memory:"); setSystemDefaultAloneLimit(db, LIMIT.amount, NOW); return db; };
const alone = (db: DB, id: string, limit = LIMIT, at = NOW) => approveWithinLimit(db, { proposalId: id, limit, rule: "within the EUR 500.00 limit", agent: "payer" }, at);

describe("a payment paid alone within the limit is left to the CFO", () => {
  it("when its stored terms cannot be read, or are not a payment's terms at all", () => {
    const db = world();
    file(db, "P-0001");
    file(db, "P-0002");
    db.prepare("UPDATE proposals SET terms_json = 'not json' WHERE proposal_id = 'P-0001'").run();
    expect(alone(db, "P-0001")).toEqual({ ok: false, reason: "P-0001's terms cannot be read" });
    expect(statusOf(db, "P-0001")).toBe("PENDING_APPROVAL");
    db.prepare("UPDATE proposals SET terms_json = '{\"kind\":\"invoice_payment\"}' WHERE proposal_id = 'P-0002'").run();
    expect(alone(db, "P-0002")).toEqual({ ok: false, reason: "P-0002's stored terms are not the ones filed" });
  });

  it("when it waits in a batch: the CFO signs the batch", () => {
    const db = world();
    file(db, "P-0001");
    file(db, "P-0002", { amount: "130.00", vendor: "Other", iban_last4: "4000" });
    createBatch(db, ["P-0001", "P-0002"], "treasury", NOW);
    expect(alone(db, "P-0001")).toEqual({ ok: false, reason: "P-0001 is in a batch: the CFO signs the batch" });
  });

  it("when it has run out: it expires, and nothing is approved", () => {
    const db = world();
    file(db, "P-0001");
    expect(alone(db, "P-0001", LIMIT, new Date("2026-11-16T11:00:01Z"))).toEqual({ ok: false, reason: "P-0001 expired at 2026-11-16T11:00:00.000Z" });
    expect(statusOf(db, "P-0001")).toBe("EXPIRED");
  });

  it("when the limit handed in is not the one in force", () => {
    const db = world();
    file(db, "P-0001");
    expect(alone(db, "P-0001", { currency: "EUR", amount: "5000.00" })).toEqual({ ok: false, reason: "the limit given (EUR 5000.00) is not the one in force (EUR 500.00)" });
    expect(alone(db, "P-0001", { currency: "USD", amount: "500.00" }).ok).toBe(false);
  });

  it("when it needs two people, or two keys", () => {
    const db = world();
    file(db, "P-0001");
    setting(db, FOUR_EYES_KEY, "100.00");
    expect(alone(db, "P-0001")).toEqual({ ok: false, reason: "P-0001 needs two people's approval (four eyes)" });
    setting(db, FOUR_EYES_KEY, "");
    setting(db, SECOND_KEY_EUR, "100.00");
    expect(alone(db, "P-0001")).toEqual({ ok: false, reason: "P-0001 is high-risk (amount at or above EUR 100.00): the CFO signs it with two keys" });
    expect(statusOf(db, "P-0001")).toBe("PENDING_APPROVAL");
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
  });
});

describe("a person's decision", () => {
  it("a high-risk payment approved by typed prefix is refused: it needs Face ID and the security key", () => {
    const db = openDb(":memory:");
    const p = file(db, "P-0001");
    setting(db, SECOND_KEY_EUR, "100.00");
    expect(() => decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW))
      .toThrow("P-0001 is high-risk (amount at or above EUR 100.00): it needs your Face ID and your security key");
    expect(statusOf(db, "P-0001")).toBe("PENDING_APPROVAL");
  });

  it("a proposal whose terms cannot be read approves nothing", () => {
    const db = openDb(":memory:");
    const p = file(db, "P-0001");
    db.prepare("UPDATE proposals SET terms_json = '{oops' WHERE proposal_id = 'P-0001'").run();
    expect(() => decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW))
      .toThrow("P-0001 is filed as invoice_payment, but its signed terms say null; nothing is approved");
  });

  it("rejecting a batch rejects the lines that still wait and passes over one that does not", () => {
    const db = openDb(":memory:");
    file(db, "P-0001");
    file(db, "P-0002", { amount: "130.00", vendor: "Other", iban_last4: "4000" });
    const batch = createBatch(db, ["P-0001", "P-0002"], "treasury", NOW);
    db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = 'P-0002'").run();
    expect(decide(db, { proposalId: batch.proposal_id, decision: "REJECTED", typedPrefix: batch.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW)).toBe("REJECTED");
    expect([statusOf(db, batch.proposal_id), statusOf(db, "P-0001"), statusOf(db, "P-0002")]).toEqual(["REJECTED", "REJECTED", "SUPERSEDED"]);
  });
});

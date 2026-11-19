// A payment batch (src/policy/batch.ts) is filed only over payments that wait for approval, may be batched, have not run
// out, still hash to their hash and are in no other waiting batch; the list must hold each once and its totals include
// Purser's fee in the line's own currency. A line taken out supersedes the batch and the line; with nothing left no new
// batch is filed. A proof of inclusion fails on any text that does not hash to what it claims.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { termsHash, TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { batchInclusion, batchRemovalSha256, createBatch, removeBatchLine, verifyBatchInclusion } from "../src/policy/batch.js";

const now = new Date("2026-11-19T10:00:00Z");
let db: DB;
const put = (id: string, over: Record<string, unknown> = {}, o: { kind?: string; status?: string; sha?: string } = {}) => {
  // Through JSON, so a field set to undefined is absent, as in stored terms.
  const terms = JSON.parse(JSON.stringify({ schema: TERMS_SCHEMA, kind: o.kind ?? "supplier_payment", proposal_id: id, expires_at: "2026-11-19T12:00:00Z", amount: "10.00", currency: "EUR", vendor: "Acme", ...over })) as Terms;
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'treasury', ?, ?, '2026-11-19T09:00:00Z')")
    .run(id, o.kind ?? "supplier_payment", JSON.stringify(terms), o.sha ?? termsHash(terms), o.status ?? "PENDING_APPROVAL", String((terms as unknown as { expires_at: string }).expires_at));
};

beforeEach(() => { db = openDb(":memory:"); });

describe("filing a batch", () => {
  it("refuses a list with a payment twice, an empty list and one that is too long", () => {
    put("P-0001");
    expect(() => createBatch(db, ["P-0001", "P-0001"], "treasury", now)).toThrow("a payment is in the list twice");
    expect(() => createBatch(db, [], "treasury", now)).toThrow("a batch holds at least one payment");
    expect(() => createBatch(db, Array.from({ length: 500 }, (_, i) => `P-${String(i + 1).padStart(4, "0")}`), "treasury", now)).toThrow(/a batch holds at most \d+ payments; this list has 500/);
  });

  it("refuses a line that does not exist, may not be batched, does not wait, ran out or no longer hashes to its hash", () => {
    put("P-0001", {}, { kind: "policy_change" });
    put("P-0002", {}, { status: "EXECUTED" });
    put("P-0003", { expires_at: "2026-11-19T09:30:00Z" });
    put("P-0004", {}, { sha: "f".repeat(64) });
    expect(() => createBatch(db, ["P-0099"], "treasury", now)).toThrow("no proposal P-0099");
    expect(() => createBatch(db, ["P-0001"], "treasury", now)).toThrow("P-0001 is a policy_change; a batch holds invoice and supplier payments only");
    expect(() => createBatch(db, ["P-0002"], "treasury", now)).toThrow("P-0002 is EXECUTED, not waiting for approval");
    expect(() => createBatch(db, ["P-0003"], "treasury", now)).toThrow("P-0003 ran out at 2026-11-19T09:30:00Z");
    expect(() => createBatch(db, ["P-0004"], "treasury", now)).toThrow("P-0004's stored terms no longer match their hash");
  });

  it("refuses a line without an amount, and a Purser fee in another currency or without an amount", () => {
    put("P-0001", { amount: undefined });
    put("P-0002", { platform_fee: { amount: "0.10", currency: "USD" } });
    put("P-0003", { platform_fee: { currency: "EUR" } });
    expect(() => createBatch(db, ["P-0001"], "treasury", now)).toThrow("P-0001 has no amount and currency");
    expect(() => createBatch(db, ["P-0002"], "treasury", now)).toThrow("P-0002 has a Purser fee in another currency or without an amount");
    expect(() => createBatch(db, ["P-0003"], "treasury", now)).toThrow(/P-0003 has a Purser fee/);
  });

  it("totals each currency with Purser's fee, expires with its first line, and a line already in a waiting batch is refused", () => {
    put("P-0001", { platform_fee: { amount: "0.10", currency: "EUR" }, test_money: true });
    put("P-0002", { amount: "5.00", currency: "USD", expires_at: "2026-11-19T11:00:00Z" });
    const b = createBatch(db, ["P-0002", "P-0001"], "treasury", now);
    const t = JSON.parse(b.terms_json) as { totals: Record<string, string>; count: string; expires_at: string; test_money: boolean; lines: { proposal_id: string }[] };
    expect(t).toMatchObject({ totals: { EUR: "10.10", USD: "5.00" }, count: "2", expires_at: "2026-11-19T11:00:00Z", test_money: true });
    expect(t.lines.map((l) => l.proposal_id)).toEqual(["P-0001", "P-0002"]);
    expect(() => createBatch(db, ["P-0001"], "treasury", now)).toThrow(`P-0001 is already in waiting batch ${b.proposal_id}`);
  });
});

describe("taking a line out", () => {
  it("is refused for a proposal that is not a batch, a batch that does not wait, or a line not in it", () => {
    put("P-0001");
    put("P-0002");
    const b = createBatch(db, ["P-0001", "P-0002"], "treasury", now);
    expect(() => removeBatchLine(db, "P-0001", "P-0002", "Max", now)).toThrow("P-0001 is not a batch");
    expect(() => removeBatchLine(db, b.proposal_id, "P-0009", "Max", now)).toThrow(`P-0009 is not in batch ${b.proposal_id}`);
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(b.proposal_id);
    expect(() => removeBatchLine(db, b.proposal_id, "P-0001", "Max", now)).toThrow(`${b.proposal_id} is EXPIRED, not waiting for approval`);
  });

  it("the last line out leaves no batch; the line is superseded and can be filed again", () => {
    put("P-0001");
    const b = createBatch(db, ["P-0001"], "treasury", now);
    expect(removeBatchLine(db, b.proposal_id, "P-0001", "Max", now)).toBeNull();
    const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
    expect([status(b.proposal_id), status("P-0001")]).toEqual(["SUPERSEDED", "SUPERSEDED"]);
  });

  it("a removal's hash is bound to a real terms hash and a proposal id", () => {
    expect(() => batchRemovalSha256("ABC", "P-0001")).toThrow(/64 lowercase hex/);
    expect(() => batchRemovalSha256("a".repeat(64), "INV-1")).toThrow(/a proposal id like P-0012/);
    expect(batchRemovalSha256("a".repeat(64), "P-0001")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the proof that a payment was in a signed batch", () => {
  it("holds for the real texts and fails for every text that does not hash or does not list the line", () => {
    put("P-0001");
    put("P-0002", { amount: "7.00" });
    expect(batchInclusion(db, "P-0001")).toBeNull();
    createBatch(db, ["P-0001", "P-0002"], "treasury", now);
    const p = batchInclusion(db, "P-0001")!;
    expect(p.approved).toBe(false);
    expect(verifyBatchInclusion(p)).toEqual({ ok: true });
    expect(verifyBatchInclusion({ ...p, batch_canonical: p.batch_canonical.replace("10.00", "11.00") })).toEqual({ ok: false, reason: "the batch text does not hash to the signed batch hash" });
    expect(verifyBatchInclusion({ ...p, line_canonical: `${p.line_canonical} ` })).toEqual({ ok: false, reason: "the payment text does not hash to its hash" });
    const other = batchInclusion(db, "P-0002")!;
    expect(verifyBatchInclusion({ ...p, line_id: "P-0003" })).toEqual({ ok: false, reason: "the batch does not list this payment with this hash" });
    expect(verifyBatchInclusion({ ...other, line_id: "P-0001" })).toEqual({ ok: false, reason: "the batch does not list this payment with this hash" });
    const notBatch = JSON.stringify({ kind: "supplier_payment", lines: [] });
    expect(verifyBatchInclusion({ ...p, batch_canonical: notBatch, batch_sha256: createHash("sha256").update(notBatch).digest("hex") })).toEqual({ ok: false, reason: "not a payment batch" });
  });
});

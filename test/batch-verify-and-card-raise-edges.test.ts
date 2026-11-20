// Two checks of what the CFO signed against what the ledger now holds. A batch (src/policy/batchLines.ts verifyBatch)
// is refused when its filed lines no longer match its signed list (one gone, one changed), when a line's terms inside
// the batch were rewritten (and the batch's hash recomputed), when a line's proposal is gone, of another kind, no
// longer waiting or run out. A card raise (src/policy/cardRaise.ts cardRaiseRefusal) is refused for a card that is no
// agent's with no change on record, for a change record that names no proposal, whose proposal's terms cannot be read,
// or no longer hash to their hash, or has no passkey signature that verifies. Ledger rows changed by hand, as someone
// with the database file could; nothing here moves money.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processRegistration } from "../src/passkey/process.js";
import { createProposal, decide, nextProposalId } from "../src/policy/approvals.js";
import { createBatch } from "../src/policy/batch.js";
import { verifyBatch } from "../src/policy/batchLines.js";
import { cardRaiseRefusal } from "../src/policy/cardRaise.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const NOW = new Date("2026-11-20T10:00:00Z");

describe("a batch, checked before it is approved", () => {
  function batchOfTwo() {
    const db = openDb(":memory:");
    const ids: string[] = [];
    for (const [amount, vendor] of [["120.00", "Bergtex Textil GmbH"], ["130.00", "Ridgeline Outfitters"]] as const) {
      const id = nextProposalId(db);
      createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor } as Terms, createdBy: "treasury" }, NOW);
      ids.push(id);
    }
    const batch = createBatch(db, ids, "treasury", NOW);
    const row = () => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(batch.proposal_id) as Parameters<typeof verifyBatch>[1];
    expect(verifyBatch(db, row(), NOW).count).toBe("2");
    return { db, ids, batch, row };
  }

  it("a filed line gone, or filed under other terms", () => {
    const a = batchOfTwo();
    a.db.prepare("DELETE FROM batch_lines WHERE proposal_id = ?").run(a.ids[1]);
    expect(() => verifyBatch(a.db, a.row(), NOW)).toThrow(`${a.batch.proposal_id}: its lines no longer match the batch filed`);
    const b = batchOfTwo();
    b.db.prepare("UPDATE batch_lines SET terms_sha256 = ? WHERE proposal_id = ?").run("0".repeat(64), b.ids[0]);
    expect(() => verifyBatch(b.db, b.row(), NOW)).toThrow(`${b.batch.proposal_id}: line 1 no longer matches the batch filed`);
  });

  it("a line's terms rewritten inside the batch, with the batch's hash recomputed", () => {
    const { db, batch, ids, row } = batchOfTwo();
    const t = JSON.parse(batch.terms_json) as { lines: { terms: { amount: string } }[] };
    t.lines[0]!.terms.amount = "1200.00";
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(t), termsHash(t as unknown as Terms), batch.proposal_id);
    expect(() => verifyBatch(db, row(), NOW)).toThrow(`${batch.proposal_id}: line ${ids[0]}'s terms no longer match their hash`);
  });

  it("a line's proposal gone, of another kind, no longer waiting, or run out", () => {
    const gone = batchOfTwo();
    gone.db.pragma("foreign_keys = OFF");
    gone.db.prepare("DELETE FROM proposals WHERE proposal_id = ?").run(gone.ids[0]);
    expect(() => verifyBatch(gone.db, gone.row(), NOW)).toThrow(`${gone.batch.proposal_id}: line ${gone.ids[0]} is gone`);
    const kind = batchOfTwo();
    kind.db.prepare("UPDATE proposals SET kind = 'refund_batch' WHERE proposal_id = ?").run(kind.ids[0]);
    expect(() => verifyBatch(kind.db, kind.row(), NOW)).toThrow(`${kind.batch.proposal_id}: line ${kind.ids[0]} is not a payment a batch may hold`);
    const decided = batchOfTwo();
    decided.db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(decided.ids[1]);
    expect(() => verifyBatch(decided.db, decided.row(), NOW)).toThrow(`${decided.batch.proposal_id}: line ${decided.ids[1]} is REJECTED, not waiting for approval`);
    const late = batchOfTwo();
    expect(() => verifyBatch(late.db, late.row(), new Date("2026-11-20T11:00:00Z"))).toThrow(`${late.batch.proposal_id}: line ${late.ids[0]} ran out at 2026-11-20T11:00:00Z`);
  });
});

describe("a card raise", () => {
  const KEY = "card.sourcing.per_tx";
  /** A raise to 60.00 proposed and approved by typed prefix, recorded as executed. */
  function raised(db: DB): string {
    const p = proposePolicyChange(db, { changes: [{ key: KEY, to: "60.00" }], reason: "test" }, "human", NOW);
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, NOW);
    audit(db, "human", "policy.changed", KEY, { proposal_id: p.proposal_id, key: KEY, from: "30.00", to: "60.00" }, NOW);
    return p.proposal_id;
  }

  it("a card that is no agent's, with no change on record, may not go up", async () => {
    expect(await cardRaiseRefusal(openDb(":memory:"), "task:T-1", "per_tx", 100)).toBe("no signed change sets card.task:T-1.per_tx to 1.00");
  });

  it("a change record that names no proposal", async () => {
    const db = openDb(":memory:");
    audit(db, "human", "policy.changed", KEY, { key: KEY, to: "60.00" }, NOW);
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 6000)).toBe(`the last change of ${KEY} names no policy change on record`);
  });

  it("a proposal whose terms cannot be read, or no longer hash to their hash", async () => {
    const db = openDb(":memory:");
    const id = raised(db);
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 6000)).toBeNull(); // no passkey enrolled: the typed approval is all there is
    db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '\"reason\":\"test\"', '\"reason\":\"other\"') WHERE proposal_id = ?").run(id);
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 6000)).toBe(`the stored terms of ${id} no longer hash to their hash`);
    db.prepare("UPDATE proposals SET terms_json = '{not json' WHERE proposal_id = ?").run(id);
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 6000)).toBe(`the last change of ${KEY} (${id}) sets nothing, not 60.00`);
  });

  it("once a passkey is enrolled, a typed approval is no signature", async () => {
    const db = openDb(":memory:");
    const id = raised(db);
    const auth = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: "purser.example", origin: "https://purser.example" }, NOW);
    await processRegistration(db, { ticket: "e", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: "https://purser.example", rpId: "purser.example" }) }), received_at: NOW.toISOString() }, { label: "max" }, NOW);
    confirmPasskey(db, fingerprintOf(auth.spkiSha256), NOW);
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 6000)).toBe(`${id} has no passkey signature that verifies over its terms`);
  });
});

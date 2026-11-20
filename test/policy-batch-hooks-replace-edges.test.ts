// Small policy checks on the paths the other files leave: a batch inclusion proof whose batch lists other terms for the
// payment under the same hash is refused; a ledger from before Airwallex batch transfers (or before proposals) has none,
// and holds nothing; a mandate replace whose terms cannot be read, or name no steps, holds every agent (fail closed),
// one whose steps name no agent holds none, and an expiry that is not a time is shown as written; a webhook without
// data is checked as an empty event. No network.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { canonicalTerms, sha256Hex, TERMS_SCHEMA } from "../src/lib/terms.js";
import { awxBatchOf, awxBatchOfLine, refuseIfInAwxBatch } from "../src/policy/awxBatchLink.js";
import { verifyBatchInclusion } from "../src/policy/batch.js";
import { handleAirwallexHook } from "../src/policy/cardHooks.js";
import { openReplacesFor, replaceHoldFact, replaceHoldRefusal } from "../src/policy/replaceHold.js";

const now = new Date("2026-11-20T10:00:00Z");

describe("a batch inclusion proof", () => {
  it("a batch that lists other terms for the payment under its hash is refused", () => {
    const line = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: "2026-11-20T11:00:00Z", amount: "120.00" };
    const lineCanonical = canonicalTerms(line as never);
    const lineSha = sha256Hex(lineCanonical);
    const batch = { kind: "payment_batch", lines: [{ proposal_id: "P-0001", terms_sha256: lineSha, terms: { ...line, amount: "1200.00" } }] };
    const batchCanonical = JSON.stringify(batch);
    expect(verifyBatchInclusion({ batch_id: "P-0002", batch_sha256: sha256Hex(batchCanonical), batch_canonical: batchCanonical, line_id: "P-0001", line_sha256: lineSha, line_canonical: lineCanonical, approved: true }))
      .toEqual({ ok: false, reason: "the batch lists other terms for this payment" });
  });
});

describe("ledgers from before", () => {
  it("before Airwallex batch transfers: no line is in one, and nothing is refused", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE IF EXISTS awx_batches");
    expect(awxBatchOfLine(db, "P-0001")).toBeNull();
    expect(awxBatchOf(db, "P-0002")).toBeNull();
    expect(() => refuseIfInAwxBatch(db, "P-0001")).not.toThrow();
  });

  it("before proposals: no replace is open", () => {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE proposals");
    expect(openReplacesFor(db, "sourcing", now)).toEqual([]);
  });
});

describe("an open mandate replace", () => {
  const replace = (db: DB, id: string, terms: string, expires = "2026-11-20T11:00:00Z") =>
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'mandate_replace', ?, ?, 'treasury', 'PENDING_APPROVAL', ?, ?)")
      .run(id, terms, sha256Hex(id), expires, now.toISOString());

  it("terms that cannot be read, or name no steps, hold every agent; steps naming no agent hold none", () => {
    const db = openDb(":memory:");
    replace(db, "P-0001", "{not json");
    replace(db, "P-0002", "{}");
    replace(db, "P-0003", JSON.stringify({ steps: [{}, { agent: 7 }] }));
    expect(openReplacesFor(db, "support", now).map((o) => o.proposal_id)).toEqual(["P-0001", "P-0002"]);
    expect(replaceHoldRefusal(db, "support", now)).toBe("replace_pending: mandate replace P-0001 and P-0002 pending; spending waits until it is executed or closed");
  });

  it("an expiry that is not a time is shown as written", () => {
    const db = openDb(":memory:");
    replace(db, "P-0001", JSON.stringify({ steps: [{ agent: "sourcing" }] }), "2026-11-20T11:00:00Z");
    db.prepare("UPDATE proposals SET status = 'EXECUTING', expires_at = 'soon' WHERE proposal_id = 'P-0001'").run();
    expect(replaceHoldFact(db, "sourcing", now)).toMatch(/^Your mandate is on hold: mandate replace P-0001 \(being carried out, expires soon UTC\)/);
  });
});

describe("a webhook", () => {
  it("an event without data is checked as an empty one", () => {
    const db = openDb(":memory:");
    const body = JSON.stringify({ name: "account.updated" });
    const ts = "1700000000";
    const signature = createHmac("sha256", "s3cret").update(ts + body).digest("hex");
    expect(handleAirwallexHook(db, { id: "evt_1", ts, signature, body }, "s3cret", now)).toBe("webhook account.updated: not an object Purser acts on; recorded");
  });

});

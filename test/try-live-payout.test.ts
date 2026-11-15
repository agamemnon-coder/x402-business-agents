// /try's sandbox payout (step 2, 14 Nov), on the engine's side (cloud/src/engine/livePayout.ts): a paid, signed payment
// is asked of the Airwallex sandbox once, with the signed terms' amount, currency and hash; the note says what happened
// (the transfer's id and status, or why the simulated bank alone paid) and the audit log has the step. The source is a
// fake of kit11's AwxFx entrypoint: no network.
import { describe, expect, it } from "vitest";
import { useDocStore } from "../src/ap/docStore.js";
import { openDb } from "../src/db/open.js";
import { publicEvent, type EventRow } from "../src/engine/events.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { standInBank } from "../src/engine/standInBank.js";
import { sandboxPayout, simulatePayout, type PayoutAnswerIn, type PayoutSource, type SimulateIn } from "../cloud/src/engine/livePayout.js";
import { eventLine } from "../cloud/src/tryEvents.js";

const SHA = "e".repeat(64);
const TERMS = { schema: "x", kind: "supplier_payment", proposal_id: "P-0002", amount: "1850.00", currency: "EUR", reference: "BTX-2026-21", expires_at: "2026-11-14T13:00:00Z" };

async function world() {
  const db = openDb(":memory:");
  useDocStore(db, { put: (sha) => `mem:${sha}`, get: () => Buffer.alloc(0) });
  const bank = standInBank({ load: () => null, save: () => {} });
  // The host makes the ledger's tables (the audit log among them).
  new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, rp: { rpId: "x.invalid", origin: "https://x.invalid" }, company: { name: "Try Co", lang: "en" }, vault: null, feed: null });
  const notes = new Map<string, string>();
  const keep = { get: (id: string) => notes.get(id) ?? null, set: (id: string, n: string) => { notes.set(id, n); } };
  const events = () => (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'airwallex.%' ORDER BY seq").all() as EventRow[]).map(publicEvent);
  return { db, keep, notes, events };
}
function source(answer: (a: Parameters<PayoutSource["payout"]>[0]) => PayoutAnswerIn | Promise<PayoutAnswerIn>) {
  const asked: Parameters<PayoutSource["payout"]>[0][] = [];
  return { asked, src: { payout: async (a) => { asked.push(a); return answer(a); }, payoutSimulate: async () => ({ ok: false, reason: "no_transfer" }) } as PayoutSource };
}

describe("/try's sandbox payout after a verified signature", () => {
  it("asks once with the signed amount, currency, reference and hash; the note and the log carry the transfer's id and status", async () => {
    const w = await world();
    const s = source((a) => ({ ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }));
    const run = () => sandboxPayout({ company: "t_try_a", proposalId: "P-0002", termsSha256: SHA, terms: TERMS, source: s.src, allowed: async () => true, db: w.db, keep: w.keep });
    const note = await run();
    expect(s.asked).toEqual([{ company: "t_try_a", terms_sha256: SHA, amount: "1850.00", currency: "EUR", reference: "BTX-2026-21" }]);
    expect(note).toEqual({ source: "airwallex-sandbox", transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: "1850.00", currency: "EUR", request_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", terms_sha256: SHA });
    // The same proposal again (paid_once): the kept note, Airwallex not asked again.
    expect(await run()).toEqual(note);
    expect(s.asked).toHaveLength(1);
    const [ev] = w.events();
    expect(ev!.fields).toEqual({ transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: "1850.00", currency: "EUR" });
    expect(eventLine(ev!).text).toBe("Airwallex sandbox: transfer 4074d684-4704-406c-a527-2832753baf4f, in approval.");
    expect(eventLine(ev!).who).toBe("Airwallex sandbox");
    // The log's row keeps the signed hash Airwallex has in its metadata.
    const row = w.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'airwallex.transfer'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ approval_sha256: SHA });
  });

  it("switched off: Airwallex is never asked; the simulated bank alone paid, labelled", async () => {
    const w = await world();
    const s = source(() => { throw new Error("must not be asked"); });
    const note = await sandboxPayout({ company: "t_try_a", proposalId: "P-0002", termsSha256: SHA, terms: TERMS, source: s.src, allowed: async () => false, db: w.db, keep: w.keep });
    expect(note).toEqual({ source: "simulated", reason: "switched_off", terms_sha256: SHA });
    expect(s.asked).toHaveLength(0);
    expect(eventLine(w.events()[0]!).text).toBe("No Airwallex sandbox transfer for this payment: the test money moved on the simulated bank only.");
  });

  it("Airwallex says no, answers for another amount, or is too slow: labelled, and only a final answer is kept", async () => {
    for (const [answer, reason] of [[{ ok: false, reason: "balance_low" }, "balance_low"], [{ ok: false, reason: "said something" }, "unavailable"],
      [{ ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: "1.00", currency: "EUR", request_id: "x" }, "bad_answer"]] as const) {
      const w = await world();
      const note = await sandboxPayout({ company: "t_try_a", proposalId: "P-0002", termsSha256: SHA, terms: TERMS, source: source(() => answer as PayoutAnswerIn).src, allowed: async () => true, db: w.db, keep: w.keep });
      expect(note).toEqual({ source: "simulated", reason, terms_sha256: SHA });
    }
    const w = await world();
    const slow = { payout: () => new Promise<PayoutAnswerIn>(() => {}), payoutSimulate: () => new Promise<SimulateIn>(() => {}) };
    const note = await sandboxPayout({ company: "t_try_a", proposalId: "P-0002", termsSha256: SHA, terms: TERMS, source: slow, allowed: async () => true, db: w.db, keep: w.keep, waitMs: 100 });
    expect(note).toMatchObject({ source: "simulated", reason: "timeout" });
    // Not kept: asked again later, with the same signed hash (kit11's request_id), it can still be made, once.
    expect(w.notes.size).toBe(0);
    expect(await sandboxPayout({ company: "t_try_a", proposalId: "P-0002", termsSha256: SHA, terms: { ...TERMS, amount: undefined }, source: slow, allowed: async () => true, db: w.db, keep: w.keep })).toMatchObject({ reason: "bad_request" });
  });

  it("Sandbox: move to PAID updates the note with the sandbox's status and logs the simulation; IN_APPROVAL stays, said so", async () => {
    const w = await world();
    const live = { payout: async (a: { amount: string; currency: string }) => ({ ok: true as const, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: "r" }) };
    const asked: unknown[] = [];
    const src: PayoutSource = { ...live, payoutSimulate: async (a) => { asked.push(a); return { ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "PAID" }; } };
    const kit = { company: "t_try_a", proposalId: "P-0002", source: src, allowed: async () => true, db: w.db, keep: w.keep };
    expect(await simulatePayout(kit)).toMatchObject({ ok: false, reason: "no_transfer" });
    await sandboxPayout({ ...kit, termsSha256: SHA, terms: TERMS });
    const out = await simulatePayout(kit);
    expect(asked).toEqual([{ company: "t_try_a", terms_sha256: SHA }]);
    expect(out).toMatchObject({ ok: true, note: { status: "PAID", transfer_id: "4074d684-4704-406c-a527-2832753baf4f" } });
    expect(JSON.parse(w.notes.get("P-0002")!).status).toBe("PAID");
    const ev = w.events().find((e) => e.event === "airwallex.simulated")!;
    expect(eventLine(ev).text).toBe("Airwallex sandbox simulation: transfer 4074d684-4704-406c-a527-2832753baf4f is now paid.");
    const held = await world();
    const waiting: PayoutSource = { ...live, payoutSimulate: async () => ({ ok: false, reason: "in_approval", status: "IN_APPROVAL" }) };
    await sandboxPayout({ ...kit, db: held.db, keep: held.keep, source: waiting, termsSha256: SHA, terms: TERMS });
    expect(await simulatePayout({ ...kit, db: held.db, keep: held.keep, source: waiting })).toMatchObject({ ok: false, reason: "in_approval", note: { status: "IN_APPROVAL" } });
    expect(await simulatePayout({ ...kit, db: held.db, keep: held.keep, source: waiting, allowed: async () => false })).toMatchObject({ ok: false, reason: "switched_off" });
  });
});

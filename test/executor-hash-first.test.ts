// Hash first (security hardening, 19 November): an executor that moves money checks that the stored terms still hash to
// what the CFO signed BEFORE it calls anything outside Purser. The Airwallex soak of 19 November found the invoice
// executor reading the balances (GET /balances/current) before it refused a tampered proposal: no money moved, but a
// changed proposal still reached Airwallex. Here every outside door is a stand-in that records each call (the real
// Airwallex REST client on a recording fetch, the global fetch, the batch rail), a signed proposal is changed by one
// cent, and the executor must refuse with the signed hash while every recorder stays empty.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Airwallex } from "../src/airwallex/client.js";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { FakeBatchTransfers, type BatchTransferRail } from "../src/airwallex/batchTransfers.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeAsOneAirwallexBatch } from "../src/executors/airwallexBatch.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import { standInLedger } from "../src/tokenize/standIn.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

/** Every outside call, from any door: the Airwallex client's fetch, the global fetch, a rail object's methods. */
function outside() {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify({ code: "stand_in", message: "the stand-in answers nothing" }), { status: 500 });
  }) as typeof fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => fetchImpl(input, init));
  const rest = new AirwallexRest(new Airwallex({ clientId: "stand-in-id", apiKey: "stand-in-key", fetchImpl, minGapMs: 0, sleep: async () => {} }));
  /** A rail object whose every method call is recorded before it runs. */
  const recorded = <T extends object>(name: string, target: T): T => new Proxy(target, {
    get(t, key, receiver) {
      const v = Reflect.get(t, key, receiver) as unknown;
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => { calls.push(`${name}.${String(key)}`); return (v as (...a: unknown[]) => unknown).apply(t, args); };
    },
  });
  return { calls, rest, recorded };
}

afterEach(() => { vi.unstubAllGlobals(); });

const approvedHash = (db: DB, id: string) => (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ?").get(id) as { approved_sha256: string }).approved_sha256;
/** One cent added to a signed amount in the stored terms, the hash left as it was. */
function addOneCent(db: DB, id: string): void {
  const row = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string };
  const t = JSON.parse(row.terms_json) as Record<string, unknown>;
  const m = /^(\d+)\.(\d{2})$/.exec(String(t.amount))!;
  const cents = Number(m[1]) * 100 + Number(m[2]) + 1;
  t.amount = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(t), id);
}

describe("hash first: a changed proposal reaches nothing outside Purser", () => {
  it("the invoice payment executor refuses a one-cent change before any outside call (no balance read)", async () => {
    const l = await standInLedger();
    const signed = approvedHash(l.db, l.proposalId);
    addOneCent(l.db, l.proposalId);
    const snapshots = () => l.db.prepare("SELECT COUNT(*) AS n FROM balance_snapshots").get();
    const before = snapshots();
    const o = outside();
    await expect(executeInvoicePayment(l.db, o.rest, null, l.proposalId)).rejects.toThrow(`terms do not match the approved hash ${signed}`);
    // Fails if: the balances (GET /balances/current), or anything else, are read before the hash check.
    expect(o.calls).toEqual([]);
    // The same with the in-memory rail, each of its methods recorded.
    const rail = o.recorded("rail", new FakeAirwallex());
    await expect(executeInvoicePayment(l.db, rail, o.recorded("sim", new FakeAirwallex()), l.proposalId)).rejects.toThrow(`terms do not match the approved hash ${signed}`);
    expect(o.calls).toEqual([]);
    expect(l.db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
    expect(snapshots()).toEqual(before);
  }, 60_000);

  it("the supplier payment executor refuses changed terms before any outside call (no balance read)", async () => {
    const l = await standInLedger();
    const signed = approvedHash(l.db, l.proposalId);
    addOneCent(l.db, l.proposalId);
    const o = outside();
    await expect(executeSupplierPayment(l.db, o.rest, null, l.proposalId)).rejects.toThrow(`terms do not match the approved hash ${signed}`);
    expect(o.calls).toEqual([]);
  }, 60_000);

  it("an unapproved proposal is refused before any outside call too", async () => {
    const l = await standInLedger({ approve: false });
    const o = outside();
    await expect(executeInvoicePayment(l.db, o.rest, null, l.proposalId)).rejects.toThrow(`${l.proposalId} is PENDING_APPROVAL, not approved`);
    await expect(executeSupplierPayment(l.db, o.rest, null, l.proposalId)).rejects.toThrow(`${l.proposalId} is PENDING_APPROVAL, not approved`);
    expect(o.calls).toEqual([]);
  }, 60_000);

  describe("one Airwallex batch transfer", () => {
    const now = new Date();
    const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
    const bergtex = (no: string, net: string, vat: string, total: string) => EN
      .replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`).replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`).replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
    let dir = "";
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

    async function signedBatch(): Promise<{ db: DB; batchId: string; lineIds: string[] }> {
      dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "hashfirst-"));
      const db = openDb(":memory:");
      const awx = new FakeAirwallex();
      await seedTreasury(db, awx, awx);
      setSetting(db, "treasury", "eur_floor", "1000.00");
      setSetting(db, "treasury", "eur_obligations", "0.00");
      const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
      const ids: number[] = [];
      for (const t of [bergtex("BTX-2026-41", "1,100.00", "209.00", "1,309.00"), bergtex("BTX-2026-42", "1,480.00", "281.20", "1,761.20")]) {
        const out = await ingestDocument(db, deps, { bytes: await pdfOf(t), filename: "invoice.pdf", source: "upload" });
        if (out.kind !== "invoice") throw new Error(out.kind);
        ids.push(out.invoice.id as unknown as number);
      }
      const batch = (await payApInvoices(db, awx, ids as never, now)).batch!;
      decide(db, { proposalId: batch.proposal_id, decision: "APPROVED", typedPrefix: batch.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
      const lineIds = (JSON.parse(batch.terms_json) as { lines: { proposal_id: string }[] }).lines.map((x) => x.proposal_id);
      return { db, batchId: batch.proposal_id, lineIds };
    }
    const ON = { AIRWALLEX_BATCH_TRANSFER: "on" };

    it("refuses a batch whose signed terms changed before any outside call", async () => {
      const w = await signedBatch();
      const signed = approvedHash(w.db, w.batchId);
      const row = w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(w.batchId) as { terms_json: string };
      const t = JSON.parse(row.terms_json) as { lines: { terms: { amount: string } }[] };
      t.lines[0]!.terms.amount = "1309.01";
      w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(t), w.batchId);
      const o = outside();
      const batches = o.recorded<BatchTransferRail>("batches", new FakeBatchTransfers());
      await expect(executeAsOneAirwallexBatch(w.db, { batches, rail: o.rest }, w.batchId, { env: ON })).rejects.toThrow(`terms do not match the approved hash ${signed}`);
      expect(o.calls).toEqual([]);
    }, 60_000);

    it("refuses a batch one of whose lines' own terms changed before any outside call", async () => {
      const w = await signedBatch();
      const line = w.lineIds[1]!;
      const signed = approvedHash(w.db, line);
      addOneCent(w.db, line);
      const o = outside();
      const batches = o.recorded<BatchTransferRail>("batches", new FakeBatchTransfers());
      await expect(executeAsOneAirwallexBatch(w.db, { batches, rail: o.rest }, w.batchId, { env: ON })).rejects.toThrow(`terms do not match the approved hash ${signed}`);
      expect(o.calls).toEqual([]);
    }, 60_000);
  });
});

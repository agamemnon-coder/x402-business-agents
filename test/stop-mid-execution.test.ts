// The CFO's emergency stop or a revocation landing while an approved payment is already executing (outside audit,
// 22 November): the runner executes approved payments in the background (src/relay/runner.ts), so a freeze approved from
// the phone can land after beginExecution, during the conversion or the fresh balance read. holdReason is asked again
// immediately before every create at Airwallex (src/executors/invoicePayment.ts and supplierPayment.ts, refuseIfHeld):
// no payout is created, the refusal is audited (transfer.held_before_create), the payment's holds are released and the
// proposal is FAILED. Controls: the same stops before the execution begins refuse it there. All against the stand-in.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { frozen } from "../src/policy/rules.js";
import { chaos } from "../src/policy/saga.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { UK, US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";

const approve = (db: DB, id: string, at?: Date) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, at);
};
/** The emergency stop as the CFO pulls it: a policy change, approved and executed. */
const freeze = (db: DB) => {
  const p = proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "incident" }, "human");
  approve(db, p.proposal_id);
  executePolicyChange(db, p.proposal_id);
};
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const openHolds = (db: DB, id: string) => (db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE proposal_id = ? AND status = 'HELD'").get(id) as { n: number }).n;
const heldEvents = (db: DB) => db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.held_before_create'").all().map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { before: string; reason: string });
const creates = (awx: FakeAirwallex) => awx.calls.filter((c) => /^create(Transfer|PayoutTransfer)$/.test(c));

describe("invoice payment (Kit 11): a stop landing during the conversion", () => {
  const bill = readFileSync("fixtures/bergtex-invoice-BTX-2026-11.txt", "utf8");
  async function world() {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(bill), bill);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id);
    expect((JSON.parse(out.proposal.terms_json) as { conversion?: unknown }).conversion).toBeTruthy();
    return { db, awx, id: out.proposal.proposal_id };
  }
  /** Runs `during` inside the conversion call, as a concurrent approval in the runner would. */
  const duringConversion = (awx: FakeAirwallex, during: () => void) => {
    const orig = awx.createConversion.bind(awx);
    awx.createConversion = async (a) => { during(); return orig(a); };
  };

  for (const [what, stop, reason] of [
    ["the emergency stop", freeze, /emergency stop/],
    ["the treasury agent's revocation", (db: DB) => revokePrincipal(db, "treasury", "compromised", "cfo"), /principal_revoked/],
  ] as const) {
    it(`${what}: no payout is created, the refusal is recorded and the holds are released`, async () => {
      const { db, awx, id } = await world();
      duringConversion(awx, () => stop(db));
      await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(reason);
      expect(creates(awx)).toEqual([]);
      expect(awx.transfers).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
      expect(status(db, id)).toBe("FAILED");
      expect(openHolds(db, id)).toBe(0);
      expect(heldEvents(db)).toEqual([expect.objectContaining({ before: "transfer", reason: expect.stringMatching(reason) })]);
    });
  }

  it("a stop before the conversion is created stops the conversion too", async () => {
    const { db, awx, id } = await world();
    // Lands after beginExecution and the pre-execution balance read, before the conversion is created.
    chaos.at = (point) => { if (point === "conversion:before") freeze(db); };
    try {
      await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/emergency stop/);
    } finally {
      chaos.at = null;
    }
    expect(awx.calls.filter((c) => /^create(Conversion|Transfer|PayoutTransfer)/.test(c))).toEqual([]);
    expect(heldEvents(db)).toEqual([expect.objectContaining({ before: "conversion" })]);
    expect(openHolds(db, id)).toBe(0);
    expect(frozen(db)).toBe(true);
  });

  it("control: the same stops before the execution begins refuse it there", async () => {
    for (const stop of [freeze, (db: DB) => revokePrincipal(db, "treasury", "compromised", "cfo")]) {
      const { db, awx, id } = await world();
      stop(db);
      await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/emergency stop|principal_revoked/);
      expect(awx.calls.filter((c) => /^create(Conversion|Transfer|PayoutTransfer)/.test(c))).toEqual([]);
    }
  });
});

describe("supplier payment: a stop landing after the execution began", () => {
  const now = new Date();
  const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
  async function world(text: string) {
    const dir = mkdtempSync(join(tmpdir(), "stop-midexec-"));
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    setSetting(db, "human", "eur_obligations", "0.00");
    const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: "inv.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account", actor: "human", address: { street: "1 S St", city: "C", postcode: "12345" } }, now);
    const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
    approve(db, add.proposal_id, now);
    await executePayeeAdd(db, awx, add.proposal_id, { now: () => now, reader: parserOnly }, now);
    const p = await payApInvoice(db, awx, out.invoice.id, now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    approve(db, p.proposal.proposal_id, now);
    rmSync(dir, { recursive: true, force: true });
    return { db, awx, id: p.proposal.proposal_id, conversion: !!JSON.parse(p.proposal.terms_json).conversion };
  }

  for (const [name, text] of [["US (no conversion)", US], ["UK (a conversion first)", UK]] as const) {
    for (const [what, reason] of [["freeze", /emergency stop/], ["revoke", /principal_revoked/]] as const) {
      it(`${name}, ${what}: no payout is created, the refusal is recorded and the holds are released`, async () => {
        const { db, awx, id, conversion } = await world(text);
        const stop = () => (what === "freeze" ? setSetting(db, "human", "freeze", "on") : revokePrincipal(db, "treasury", "compromised", "cfo"));
        // The first outside call after beginExecution: the conversion if any, else the fresh balance read before the payout.
        let reads = 0;
        const balances = awx.balancesAll.bind(awx);
        awx.balancesAll = async () => { if (++reads === 2 && !conversion) stop(); return balances(); };
        const convert = awx.createConversionAny.bind(awx);
        awx.createConversionAny = async (a) => { stop(); return convert(a); };
        await expect(executeSupplierPayment(db, awx, awx, id)).rejects.toThrow(reason);
        expect(creates(awx)).toEqual([]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
        expect(status(db, id)).toBe("FAILED");
        expect(openHolds(db, id)).toBe(0);
        expect(heldEvents(db)).toEqual([expect.objectContaining({ before: "transfer", reason: expect.stringMatching(reason) })]);
      });
    }
  }
});

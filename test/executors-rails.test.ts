// The payment rails handed to the executor dispatch (src/executors/index.ts execute): a host that holds its own
// Airwallex rails (a client of its own, or a stand-in bank on test money) passes them in, and an approved payment runs
// on them with no AIRWALLEX_* in the environment, a batch's lines included. Without them the rails are made from the
// environment, as before: with no keys set the payment is refused and nothing moves. Test money only (FakeAirwallex).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { execute, type Rails } from "../src/executors/index.js";
import type { HubDeps } from "../src/hub/client.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

// The executor checks the terms against the real clock, so the test runs on it too.
const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
/** No hub is configured, and nothing may reach the network. */
const hub: HubDeps = { fetch: () => Promise.reject(new Error("no network in this test")), env: {}, log: () => {} };

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
let rails: Rails;
beforeEach(async () => {
  vi.stubEnv("AIRWALLEX_CLIENT_ID", "");
  vi.stubEnv("AIRWALLEX_API_KEY", "");
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "exec-rails-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
  rails = { rail: awx, sim: awx };
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const bergtex = (no: string, net: string, vat: string, total: string) => EN
  .replace(/BTX-2026-21/g, no)
  .replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`)
  .replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`)
  .replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
const add = async (text: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: "invoice.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  expect(apInvoice(db, out.invoice.id)!.status).toBe("ready");
  return out.invoice.id;
};
const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const approvedPayment = async () => {
  const id = await add(EN);
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  approve(out.proposal.proposal_id);
  return { id, proposalId: out.proposal.proposal_id };
};

describe("execute with rails handed in", () => {
  it("pays an approved invoice on them, with no AIRWALLEX_* set", async () => {
    const { id, proposalId } = await approvedPayment();
    expect(awx.transfers).toHaveLength(0);
    await execute(db, proposalId, undefined, hub, rails);
    expect(awx.transfers).toHaveLength(1);
    expect((await syncPayments(db, { now: () => now })).map((x) => [x.id, x.status])).toEqual([[id, "paid"]]);
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId)).toEqual({ status: "EXECUTED" });
  });

  it("pays every line of an approved batch on them", async () => {
    const ids = [await add(bergtex("BTX-2026-31", "1,100.00", "209.00", "1,309.00")), await add(bergtex("BTX-2026-32", "1,480.00", "281.20", "1,761.20"))];
    const out = await payApInvoices(db, awx, ids, now);
    expect(out.notPlanned).toEqual([]);
    approve(out.batch!.proposal_id);
    await execute(db, out.batch!.proposal_id, undefined, hub, rails);
    expect(awx.transfers).toHaveLength(2);
    expect((await syncPayments(db, { now: () => now })).map((x) => [x.id, x.status]).sort()).toEqual(ids.map((i) => [i, "paid"]).sort());
  });
});

describe("execute without rails", () => {
  it("makes them from the environment, as before: with no keys set the payment is refused and nothing moves", async () => {
    const { id, proposalId } = await approvedPayment();
    await expect(execute(db, proposalId, undefined, hub)).rejects.toThrow("Airwallex sandbox keys are not set; the payment cannot run");
    expect(awx.transfers).toHaveLength(0);
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
  });
});

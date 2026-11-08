// A small test world for the vault: one supplier invoice read, paid with the CFO's approval and booked, one blocked
// (its total does not add up), the ledger fed and the month closed. Test money only (the fake Airwallex sandbox).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedTreasury } from "../../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../../src/ap/pay.js";
import type { Asker } from "../../src/ap/read.js";
import { openDb, type DB } from "../../src/db/open.js";
import { executeInvoicePayment } from "../../src/executors/invoicePayment.js";
import { closeMonth } from "../../src/ledger/close.js";
import { syncLedger } from "../../src/ledger/feed.js";
import { decide } from "../../src/policy/approvals.js";
import { EN } from "./apInvoices.js";
import { FakeAirwallex } from "./airwallex.js";
import { pdfOf } from "./pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

export interface VaultWorld { db: DB; dir: string; awx: FakeAirwallex; now: Date; paidId: string; blockedId: string; month: string; proposalId: string }

/** `close`: lock the month in the ledger (the month report is made only for a closed month). */
export async function vaultWorld(opts: { close?: boolean } = {}): Promise<VaultWorld> {
  // The executor checks the terms against the real clock, so the world runs on it.
  const now = new Date();
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "vault-world-"));
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const deps: InboxDeps = { dir: join(dir, "ap"), reader: parserOnly, now: () => now };
  const add = async (text: string, name: string) => {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    return out.invoice.id;
  };
  const paidId = await add(EN, "bergtex.pdf");
  const blockedId = await add(EN.replace("BTX-2026-21", "BTX-2026-22").replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"), "bergtex-wrong-sum.pdf");
  const out = await payApInvoice(db, awx, paidId, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_sha256: string };
  decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
  await syncPayments(db, { now: () => now });
  syncLedger(db, now);
  const month = now.toISOString().slice(0, 7);
  if (opts.close) closeMonth(db, month, "test", now);
  return { db, dir, awx, now, paidId, blockedId, month, proposalId: out.proposal.proposal_id };
}

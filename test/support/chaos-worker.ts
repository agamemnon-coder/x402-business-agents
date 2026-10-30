// One life of the runner for the kill test: it opens the ledger file, does one phase of a money action, and when
// told to, kills itself with SIGKILL at a named point (src/policy/saga.ts `chaos`), so nothing after it runs: no
// catch, no finally, no clean shutdown. Test code only.
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { proposeInvoicePayment, seedTreasury } from "../../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../../src/agents/invoice.js";
import { executeSweep, resumeSweep } from "../../src/agents/sweep.js";
import { audit } from "../../src/audit/log.js";
import { openDb } from "../../src/db/open.js";
import { executeInvoicePayment } from "../../src/executors/invoicePayment.js";
import { executeRefundBatch } from "../../src/executors/refundBatch.js";
import { TERMS_SCHEMA } from "../../src/lib/terms.js";
import { createProposal, decide } from "../../src/policy/approvals.js";
import { recoverHolds } from "../../src/policy/holds.js";
import { chaos, resumeInterrupted } from "../../src/policy/saga.js";
import { chainFinalize, chainPuller, persistentAirwallex } from "./chaos-world.js";

const [dbFile, outside, chain, scenario, phase, crashAt] = process.argv.slice(2) as [string, string, string, string, string, string];
if (crashAt && crashAt !== "-") chaos.at = (point) => { if (point === crashAt) process.kill(process.pid, "SIGKILL"); };

export const PAYER = "0x00000000000000000000000000000000000000c1" as Address;
export const BUSINESS = "0x00000000000000000000000000000000000000b1" as Address;
export const SWEEP = "0x00000000000000000000000000000000000000d1" as Address;

const db = openDb(dbFile);
const awx = persistentAirwallex(outside);
const pull = chainPuller(chain);
const approve = (id: string, sha: string) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "max", method: "cli" });
const invoiceText = readFileSync(new URL("../../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");
const bind = (agent: string, cap: string, budget: string) =>
  audit(db, "treasury", "mandate.bound", agent, { cap, budget, payee: "0x0000000000000000000000000000000000000001" });

// What a restart does first: release or settle holds, then resume every action a crash left executing.
async function restart(run: (id: string) => Promise<void>): Promise<void> {
  recoverHolds(db);
  await resumeInterrupted(db, (_db, id) => run(id));
}

if (scenario === "invoice") {
  const run = async (id: string) => { await executeInvoicePayment(db, awx, awx, id); };
  if (phase === "setup") await seedTreasury(db, awx, awx);
  if (phase === "propose") {
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(invoiceText), invoiceText);
    if (out.kind !== "proposed") throw new Error(out.kind);
    approve(out.proposal.proposal_id, out.proposal.terms_sha256);
  }
  if (phase === "run") await run((db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'invoice_payment' AND status = 'APPROVED'").get() as { proposal_id: string }).proposal_id);
  if (phase === "resume") await restart(run);
}

if (scenario === "refunds") {
  const run = (id: string) => executeRefundBatch(db, id, pull);
  if (phase === "setup") {
    bind("support", "0.10", "4.00");
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-1', 'Summit Outfitters', 'x', 'now')").run();
    const refunds = [1, 2, 3].map((n) => {
      const s = Number(db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(PAYER).lastInsertRowid);
      return { sale_id: String(s), payment_id: `refund-${s}`, to: PAYER, amount: "0.05", n };
    }).map(({ n: _n, ...r }) => r);
    const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2099-01-01T00:00:00Z", dispute_id: "D-1", customer: "Summit Outfitters", refunds, total: "0.15", reason: "stock levels were wrong", evidence: [] };
    const p = createProposal(db, { terms: terms as never, createdBy: "support" });
    approve("P-0001", p.terms_sha256);
  }
  if (phase === "run") await run("P-0001");
  if (phase === "resume") await restart(run);
}

if (scenario === "sweep") {
  const finalize = chainFinalize(chain);
  if (phase === "setup") bind("treasury", "4.00", "12.00");
  if (phase === "run") {
    await executeSweep(db, "sweep-20261103-1", 135, SWEEP, pull);
    await resumeSweep(db, awx, awx, { business: BUSINESS, sweep: SWEEP }, { pull, finalize });
  }
  if (phase === "resume") {
    recoverHolds(db);
    await resumeSweep(db, awx, awx, { business: BUSINESS, sweep: SWEEP }, { pull, finalize });
  }
}
db.close();

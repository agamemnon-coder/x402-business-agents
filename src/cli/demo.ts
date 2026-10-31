// npm run demo:all: the whole story in one command, live. Approvals stay human: when a proposal waits,
// the run pauses until a person approves it on the approval page (npm run approvals) or with
// npm run approve, and carries on once the executor has run.
//
// For a fresh demo world, point KIT11_KEYS_DIR and KIT11_DB at new locations; bootstrap creates new
// accounts and mandates there.

import { approvalHint } from "./hint.js";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { fromEnv } from "../airwallex/client.js";

const root = resolve(import.meta.dirname, "../..");
const tsx = resolve(root, "node_modules/.bin/tsx");

function step(title: string, script: string, ...args: string[]): void {
  console.log(`\n━━━ ${title} ━━━`);
  const r = spawnSync(tsx, [resolve(root, "src/cli", script), ...args], { stdio: "inherit", env: process.env, cwd: root });
  if (r.status !== 0) {
    console.error(`\n${script} exited ${r.status}; the demo stops here. Fix it and rerun: every step is idempotent.`);
    process.exit(r.status ?? 1);
  }
}

/**
 * Waits until a proposal of this kind has run. When the open one expires before anyone decides (a locked FX quote
 * lasts minutes, and a person may be busy with another decision), `again` asks for a fresh one, at most three times;
 * a rejection stops the demo.
 */
// invoiceNo narrows an invoice payment to one invoice: the manufacturer's and the licence fee are both invoice_payment.
async function waitForExecuted(kind: string, label: string, again?: () => void, invoiceNo?: string): Promise<void> {
  const only = invoiceNo ? " AND json_extract(terms_json, '$.invoice_no') = ?" : "";
  const args = (k: string) => (invoiceNo ? [k, invoiceNo] : [k]);
  let renewals = 0;
  const db = openDb();
  const done = () => db.prepare(`SELECT proposal_id FROM proposals WHERE kind = ? AND status = 'EXECUTED'${only}`).get(...args(kind)) as { proposal_id: string } | undefined;
  if (done()) return;
  console.log(`\n⏸  ${label}: waiting for a person to decide: ${approvalHint(db)}.`);
  for (;;) {
    const d = done();
    if (d) { console.log(`▶  ${d.proposal_id} executed; continuing.`); return; }
    const open = db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE kind = ? AND status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')${only}`).get(...args(kind)) as { n: number };
    if (open.n === 0) {
      const last = db.prepare(`SELECT proposal_id, status FROM proposals WHERE kind = ?${only} ORDER BY created_at DESC, proposal_id DESC LIMIT 1`).get(...args(kind)) as { proposal_id: string; status: string } | undefined;
      if (again && last?.status === "EXPIRED" && renewals < 3) {
        renewals++;
        console.log(`\n↻  ${last.proposal_id} expired before anyone decided; asking for a fresh quote and a new proposal (${renewals} of 3).`);
        again();
        console.log(`\n⏸  ${label}: waiting for a person to decide: ${approvalHint(db)}.`);
        continue;
      }
      console.error(`no ${kind} proposal is open any more (${last?.status === "REJECTED" ? "rejected" : "expired"}); the demo stops.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const db = openDb();
const sales = (db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n;

step("Health", "health.ts");
step("S0 Bootstrap: accounts, 20.00 *USDZ, four mandates", "bootstrap.ts");
if (sales < 40) step("Sales at 0.05: stock checks 1-40", "trade.ts", String(sales + 1), "40");
if (!db.prepare("SELECT 1 FROM proposals WHERE kind = 'mandate_replace'").get()) step("S1 Supplier price rise", "s1.ts", "raise");
await waitForExecuted("mandate_replace", "S1 mandate change");
if ((db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n < 50) step("S1 Sales resume", "s1.ts", "resume");
step("S2 Disputed batch", "s2.ts");
step("S3 Manufacturer's euro invoice", "s3.ts");
if (fromEnv()) await waitForExecuted("invoice_payment", "S3 invoice payment", () => step("S3 A fresh quote for the euro invoice", "s3.ts"), "BTX-2026-11");
// Kit 11: the treasury (Finance) agent pays the monthly licence fee invoiced in euros (the fee is in code).
if (fromEnv()) {
  step("S3b Kit 11 monthly licence fee (EUR)", "licence.ts");
  await waitForExecuted("invoice_payment", "S3b licence fee", () => step("S3b A fresh quote for the licence fee", "licence.ts"), "SLL-2026-11");
}
if (fromEnv()) {
  // S4: the company cards. The agent's raise is a policy change the CFO approves with Face ID; then the same purchase again.
  if (!db.prepare("SELECT 1 FROM card_transactions WHERE approved = 1 AND amount_cents = 4500").get()) {
    step("S4 Company cards: inside the limit, over it, a raise", "cards.ts", "scenario");
    await waitForExecuted("policy_change", "S4 card limit raise");
    // The runner pushes the new limit right after the change; sync makes sure the card has it before we buy.
    step("S4 The card follows the CFO policy", "cards.ts", "sync");
    step("S4 The same purchase after the raise", "cards.ts", "buy", "packwise-pro");
  }
}
step("Verify everything from the chain", "verify.ts");
step("Export the audit log", "auditExport.ts");
console.log("\nDemo complete.");

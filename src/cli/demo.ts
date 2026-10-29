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

async function waitForExecuted(kind: string, label: string): Promise<void> {
  const db = openDb();
  const done = () => db.prepare("SELECT proposal_id FROM proposals WHERE kind = ? AND status = 'EXECUTED'").get(kind) as { proposal_id: string } | undefined;
  if (done()) return;
  console.log(`\n⏸  ${label}: waiting for a person to decide: ${approvalHint(db)}.`);
  for (;;) {
    const d = done();
    if (d) { console.log(`▶  ${d.proposal_id} executed; continuing.`); return; }
    const open = db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = ? AND status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')").get(kind) as { n: number };
    if (open.n === 0) { console.error(`no ${kind} proposal is open any more (rejected or expired); the demo stops.`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const db = openDb();
const sales = (db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n;

step("Health", "health.ts");
step("S0 Bootstrap: accounts, 20.00 *USDZ, four mandates", "bootstrap.ts");
if (sales < 40) step("Sales at 0.05: ticks 1-40", "trade.ts", String(sales + 1), "40");
if (!db.prepare("SELECT 1 FROM proposals WHERE kind = 'mandate_replace'").get()) step("S1 Supplier price rise", "s1.ts", "raise");
await waitForExecuted("mandate_replace", "S1 mandate change");
if ((db.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n < 50) step("S1 Sales resume", "s1.ts", "resume");
step("S2 Disputed batch", "s2.ts");
step("S3 Euro licence bill", "s3.ts");
if (fromEnv()) await waitForExecuted("invoice_payment", "S3 invoice payment");
step("Verify everything from the chain", "verify.ts");
step("Export the audit log", "auditExport.ts");
console.log("\nDemo complete.");

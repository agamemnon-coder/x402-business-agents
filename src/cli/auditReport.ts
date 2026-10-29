// npm run audit:report [-- out.pdf]: writes the audit report of the ledger (KIT11_DB) as a PDF (default
// audit-report.pdf): every decision with agent, models, reason, policy rule, approver and hash, what the agents did
// alone, every refusal, and the anchor for npm run verify-log.

import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { buildAuditReport, renderAuditPdf } from "../audit/report.js";
import { openDb } from "../db/open.js";

const out = process.argv[2] ?? "audit-report.pdf";
const path = process.env.KIT11_DB ?? "data/kit11.sqlite";
const report = buildAuditReport(openDb(path), new Date(), basename(path));
writeFileSync(out, await renderAuditPdf(report));
console.log(`${out}: ${report.decisions.length} decisions, ${report.refusals.length} refusals; chain ${report.chain.ok ? "intact" : "BROKEN"}`);
console.log(`anchor ${report.anchor}  (later: npm run verify-log -- --anchor ${report.anchor})`);

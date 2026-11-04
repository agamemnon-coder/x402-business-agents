// npm run dispute -- <claim> <sale ids, e.g. 5-16 or 5,6,7> ["the customer's words"]: the Dispute desk on this
// world's ledger (KIT11_DB). Gathers the evidence with verifyMandatePayment on Metal, decides by the seller's rules,
// refunds within the CFO's automatic limits or proposes the refund for Face ID, and writes the report for the customer
// to docs/disputes/<case>.html.
// npm run dispute -- list    the cases decided so far.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Tools } from "../claude/tools.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { CLAIM_WORDS, type DisputeClaim } from "../seller/disputeDesk.js";
import { disputeCases, openDisputeCase } from "../seller/desk.js";
import { disputeReportHtml } from "../seller/report.js";
import { addresses } from "../world/runtime.js";

const [claim, ids, ...words] = process.argv.slice(2);
const db = openDb();
if (claim === "list") {
  for (const c of disputeCases(db)) console.log(`${c.case_id}  ${c.claim.padEnd(15)} ${c.decision.outcome.padEnd(15)} refund ${fromCents(c.decision.refund_cents)}  ${c.route}${c.proposal_id ? ` ${c.proposal_id}` : ""}`);
  process.exit(0);
}
if (!claim || !(claim in CLAIM_WORDS) || !ids) {
  console.error(`usage: npm run dispute -- <${Object.keys(CLAIM_WORDS).join("|")}> <sale ids: 5-16 or 5,6,7> ["the customer's words"] | list`);
  process.exit(2);
}
const saleIds = ids.split(",").flatMap((part) => {
  const m = /^(\d+)-(\d+)$/.exec(part);
  return m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : [Number(part)];
});
if (saleIds.some((n) => !Number.isSafeInteger(n) || n <= 0) || saleIds.length > 100) {
  console.error("sale ids must be whole numbers, at most 100");
  process.exit(2);
}
const c = await openDisputeCase(db, new Tools(db), { claim: claim as DisputeClaim, saleIds, customer: addresses(db).customer, text: words.join(" ") });
console.log(`CASE      ${c.case_id}: ${CLAIM_WORDS[c.claim]} (${saleIds.length} payments)`);
for (const s of c.decision.per_sale) console.log(`          sale ${String(s.sale_id).padEnd(4)} refund ${fromCents(s.refund_cents)}  ${s.why}`);
console.log(`DECISION  ${c.decision.outcome}: ${fromCents(c.decision.refund_cents)} test USD to ${c.decision.refund_to}; ${c.route}${c.proposal_id ? ` (${c.proposal_id}: approve or reject it with Face ID)` : ""}`);
console.log(`EXPLAINED by ${c.explained_by}`);
const dir = resolve(import.meta.dirname, "../../docs/disputes");
mkdirSync(dir, { recursive: true });
const out = resolve(dir, `${c.case_id}.html`);
writeFileSync(out, disputeReportHtml(c));
console.log(`REPORT    docs/disputes/${c.case_id}.html`);

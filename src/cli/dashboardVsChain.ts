// npm run dashboard-vs-chain: the dashboard's mandate numbers read against Metal testnet (Metal QA, 1 November; exact
// and payment by payment since the night batch of 2 November). Reads only: the ledger for the snapshot and its payments,
// the chain for each credential's terms, spend and MandatePayment events. Exit 1 on any difference, each with the
// payment that explains it; a payment the dashboard shows on its way, and the chain already counts, is listed apart.

import { openDb } from "../db/open.js";
import { dashboardVsChain } from "../metal/dashboardVsChain.js";

const checks = await dashboardVsChain(openDb());
for (const c of checks) {
  console.log(`${c.ok ? "ok  " : "DIFF"}  ${c.agent}: ${c.ok ? "cap, budget and spend match the chain, payment by payment" : c.differences.join("; ")}`);
  for (const n of c.notes) console.log(`        ${c.ok ? "on its way" : "also"}: ${n}`);
}
const bad = checks.filter((c) => !c.ok).length;
console.log(checks.length === 0 ? "no mandates on the dashboard yet" : bad === 0 ? `the dashboard matches the chain for all ${checks.length} mandates` : `${bad} of ${checks.length} mandates differ from the chain`);
process.exit(bad === 0 && checks.length > 0 ? 0 : 1);

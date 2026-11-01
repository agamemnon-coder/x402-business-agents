// npm run dashboard-vs-chain: the dashboard's mandate numbers read against Metal testnet (Metal QA, 1 November).
// Reads only: the ledger for the snapshot, the chain for each bound credential's terms and spend. Exit 1 on a difference.

import { openDb } from "../db/open.js";
import { dashboardVsChain } from "../metal/dashboardVsChain.js";

const checks = await dashboardVsChain(openDb());
for (const c of checks) console.log(`${c.ok ? "ok  " : "DIFF"}  ${c.agent}: ${c.ok ? "cap, budget and spend match the chain" : c.differences.join("; ")}`);
const bad = checks.filter((c) => !c.ok).length;
console.log(checks.length === 0 ? "no mandates on the dashboard yet" : bad === 0 ? `the dashboard matches the chain for all ${checks.length} mandates` : `${bad} of ${checks.length} mandates differ from the chain`);
process.exit(bad === 0 && checks.length > 0 ? 0 : 1);

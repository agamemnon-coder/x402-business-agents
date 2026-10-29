// npm run reconcile: the light daily reconciliation (finance item 5) of the ledger (KIT11_DB) against Airwallex and
// Metal, flow by flow. The runner (npm run relay) also runs it once a day. Differences are logged and shown on the
// dashboard; nothing is fixed automatically.

import { openDb } from "../db/open.js";
import { reconcile } from "../finance/reconcile.js";
import { reconcileSourcesFromEnv } from "../finance/sources.js";
import { redactSecrets } from "../lib/redact.js";

const r = await reconcile(openDb(), reconcileSourcesFromEnv());
console.log(`RECONCILED       ${r.checked} flows checked against Airwallex and Metal at ${r.at}`);
for (const s of r.skipped) console.log(`NOT CHECKED      ${s}`);
for (const d of r.differences) console.log(redactSecrets(`DIFFERENCE       ${d.area} ${d.ref}: ledger says ${d.ledger}; ${d.area === "metal" ? "the chain" : "Airwallex"} says ${d.outside}`));
console.log(r.differences.length ? `${r.differences.length} difference(s): a person looks; nothing was changed` : "no differences");
process.exit(r.differences.length ? 1 : 0);

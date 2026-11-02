// npm run reconcile: the light hourly reconciliation (finance item 5) of the ledger (KIT11_DB) against Airwallex and
// Metal, flow by flow. The runner (npm run relay) also runs it every hour. Differences are logged and shown on the
// dashboard; nothing is fixed automatically.
//
// npm run reconcile -- --close-unsent <request_id>: the CFO's command for one payout row left SUBMITTING with no transfer
// behind it. It closes the row only after a read-only look-up by request_id at Airwallex finds nothing, and refuses in
// every other case (src/finance/closeUnsent.ts). It reads Airwallex, never writes to it.

import { Airwallex, fromEnv } from "../airwallex/client.js";
import { getVia } from "../airwallex/verify.js";
import { openDb } from "../db/open.js";
import { CLOSE_UNSENT_ORIGIN, closeUnsent, strictTransferLookup } from "../finance/closeUnsent.js";
import { reconcile } from "../finance/reconcile.js";
import { reconcileSourcesFromEnv } from "../finance/sources.js";
import { redactSecrets } from "../lib/redact.js";
import { withOrigin } from "../provenance/origin.js";

const at = process.argv.indexOf("--close-unsent");
if (at >= 0) {
  const requestId = process.argv[at + 1] ?? "";
  const cfg = fromEnv();
  if (!cfg) {
    console.log("STOP             no Airwallex sandbox keys (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY): Airwallex cannot be asked, so nothing is closed");
    process.exit(2);
  }
  const lookup = strictTransferLookup(getVia(new Airwallex(cfg)));
  const r = await withOrigin(CLOSE_UNSENT_ORIGIN, () => closeUnsent(openDb(), requestId, lookup));
  if (r.closed) {
    console.log(`CLOSED           payout ${r.requestId} for invoice ${r.invoiceNo} (${r.proposalId}): Airwallex holds no transfer under it (looked up ${r.lookedUpAt}); the invoice can be proposed again, with a new proposal and Face ID`);
    process.exit(0);
  }
  console.log(redactSecrets(`REFUSED          ${r.reason}`));
  process.exit(1);
}

const r = await reconcile(openDb(), reconcileSourcesFromEnv());
console.log(`RECONCILED       ${r.checked} flows checked against Airwallex and Metal at ${r.at}`);
for (const s of r.skipped) console.log(`NOT CHECKED      ${s}`);
for (const d of r.differences) console.log(redactSecrets(`DIFFERENCE       ${d.area} ${d.ref}: ledger says ${d.ledger}; ${d.area === "metal" ? "the chain" : "Airwallex"} says ${d.outside}`));
console.log(r.differences.length ? `${r.differences.length} difference(s): a person looks; nothing was changed` : "no differences");
process.exit(r.differences.length ? 1 : 0);

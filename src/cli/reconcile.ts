// npm run reconcile: the light hourly reconciliation (finance item 5) of the ledger (KIT11_DB) against Airwallex and
// Metal, flow by flow. The runner (npm run relay) also runs it every hour. Differences are logged and shown on the
// dashboard; nothing is fixed automatically.
//
// npm run reconcile -- --close-unsent <request_id>: the CFO's command for one payout row left SUBMITTING with no transfer
// behind it. It closes the row only after a read-only look-up by request_id at Airwallex finds nothing, and refuses in
// every other case (src/finance/closeUnsent.ts). It reads Airwallex, never writes to it.

import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { getVia } from "../airwallex/verify.js";
import { openDb } from "../db/open.js";
import { CLOSE_UNSENT_ORIGIN, closeUnsent, strictTransferLookup } from "../finance/closeUnsent.js";
import { reconcile } from "../finance/reconcile.js";
import { releaseStuckHold, stuckHolds } from "../finance/stuckHolds.js";
import { reconcileSourcesFromEnv } from "../finance/sources.js";
import { redactSecrets } from "../lib/redact.js";
import { withOrigin } from "../provenance/origin.js";

// npm run reconcile -- --holds: money still held for payments no longer running (src/finance/stuckHolds.ts);
// npm run reconcile -- --release-hold <key>: releases one, only after a strict look-up at Airwallex finds nothing.
if (process.argv.includes("--holds")) {
  const holds = stuckHolds(openDb());
  for (const h of holds) console.log(`HELD             ${h.key} ${h.kind} ${h.currency} ${(h.cents / 100).toFixed(2)} for ${h.proposal_id} (${h.proposal_status}) since ${h.since}`);
  console.log(holds.length ? `${holds.length} stuck hold(s): release one with npm run reconcile -- --release-hold <key>` : "no stuck holds");
  process.exit(0);
}
const rh = process.argv.indexOf("--release-hold");
if (rh >= 0) {
  const cfg = fromEnv();
  if (!cfg) {
    console.log("STOP             no Airwallex sandbox keys (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY): Airwallex cannot be asked, so nothing is released");
    process.exit(2);
  }
  const rail = new AirwallexRest(new Airwallex(cfg));
  const r = await releaseStuckHold(openDb(), process.argv[rh + 1] ?? "", {
    transfer: async (id) => { const t = await rail.findTransferByRequestIdStrict(id); return t ? { id: t.id, status: t.status } : undefined; },
    conversion: async (id) => { const c = await rail.findConversionByRequestId(id); return c ? { id: c.conversionId, status: c.status } : undefined; },
  });
  console.log(redactSecrets(r.released ? `RELEASED         ${r.key}: ${r.why}` : `REFUSED          ${r.reason}`));
  process.exit(r.released ? 0 : 1);
}

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
for (const x of r.settlements ?? []) console.log(`SETTLEMENT       ${x.key.slice(0, 10)}… ${x.outcome}${x.sale_id ? ` (sale ${x.sale_id})` : ""}${x.tx ? ` tx ${x.tx.slice(0, 10)}…` : ""}`);
for (const d of r.differences) console.log(redactSecrets(`DIFFERENCE       ${d.area} ${d.ref}: ledger says ${d.ledger}; ${d.area === "metal" ? "the chain" : "Airwallex"} says ${d.outside}`));
console.log(r.differences.length ? `${r.differences.length} difference(s): a person looks; nothing was changed` : "no differences");
process.exit(r.differences.length ? 1 : 0);

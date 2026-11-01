// npm run s3 [-- --sweep-only]: scenario S3, the manufacturer's euro invoice (--sweep-only: the sweep and its booked
// credit, no invoice; the autonomous Treasury agent's sweep_earnings).
//   Metal side (live now): sweep net earnings to the sweep wallet, wait for finality, lock the credit.
//   Airwallex side: book the credit, plan the invoice, quote, approval, conversion, SWIFT, PAID.
//   Without AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY the Airwallex side stops and says so; nothing is faked.

import type { Hash } from "viem";
import { awaitFinalTransfer, executeSweep, lockCredit, netEarnings, nextSweepId, planSweep } from "../agents/sweep.js";
import { fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { EXPLORER_TX } from "../metal/network.js";
import { addresses } from "../world/runtime.js";
import { runAirwallexSide } from "./s3-airwallex.js";

const db = openDb();
const addr = addresses(db);

console.log("GOAL             move earnings into Airwallex and pay the manufacturer's EUR invoice, without breaking a floor");
const pending = db.prepare("SELECT payment_id, amount_cents, outcome, tx_hash, event_key FROM sweeps WHERE outcome != 'REFUSED' ORDER BY created_at DESC LIMIT 1").get() as
  { payment_id: string; amount_cents: number; outcome: string; tx_hash: string | null; event_key: string | null } | undefined;

let eventKey = pending?.event_key ?? null;
if (!eventKey) {
  let paymentId: string, amount: number, tx: string | null;
  if (pending && pending.outcome !== "PAID") {
    // An earlier run stopped mid-way: the same payment id and amount, never a new one.
    ({ payment_id: paymentId, amount_cents: amount } = pending);
    const r = await executeSweep(db, paymentId, amount, addr.sweep);
    tx = r.tx;
    if (r.outcome !== "PAID") throw new Error(`${paymentId}: ${r.outcome} ${r.reason ?? ""}`);
  } else if (pending?.outcome === "PAID") {
    ({ payment_id: paymentId, amount_cents: amount, tx_hash: tx } = pending);
  } else {
    const e = netEarnings(db);
    console.log(`PLAN             net earnings ${fromCents(e.netCents)} = sales ${fromCents(e.revenueCents)} - upstream ${fromCents(e.upstreamCents)} - refunds ${fromCents(e.refundsCents)} - swept ${fromCents(e.sweptCents)}`);
    const plan = await planSweep(db, addr.business);
    if ("refuse" in plan) throw new Error(plan.refuse);
    console.log(`                 business account ${fromCents(plan.businessBeforeCents)} -> ${fromCents(plan.businessAfterCents)}, still >= ${fromCents(plan.committedCents)} the other mandates may spend`);
    paymentId = nextSweepId(db);
    amount = plan.amountCents;
    const r = await executeSweep(db, paymentId, amount, addr.sweep);
    tx = r.tx;
    if (r.outcome !== "PAID") throw new Error(`${paymentId}: ${r.outcome} ${r.reason ?? ""}`);
  }
  console.log(`SWEEP            ${paymentId}: ${fromCents(amount)} *USDZ business -> sweep wallet  ${EXPLORER_TX}${tx}`);
  const final = await awaitFinalTransfer(tx as Hash, addr.business, addr.sweep, amount);
  const lock = lockCredit(db, final, addr.business, addr.sweep, paymentId);
  eventKey = final.eventKey;
  console.log(`FINALITY         block ${final.block} <= finalized ${final.finalizedBlock}, canonical; credit ${lock.locked ? "locked" : "was already locked"} as ${final.eventKey}`);
} else {
  console.log(`SWEEP            ${pending!.payment_id} already final; credit locked as ${eventKey}`);
}

const cfg = fromEnv();
if (!cfg) {
  console.log("\nBLOCKED          Airwallex sandbox keys are not set (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY).");
  console.log("                 The credit stays locked and unbooked; run npm run s3 again once the keys are set.");
  process.exit(0);
}
await runAirwallexSide(db, cfg, eventKey, { invoice: !process.argv.includes("--sweep-only") });

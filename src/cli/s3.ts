// npm run s3 [-- --sweep-only]: scenario S3, the manufacturer's euro invoice (--sweep-only: the sweep and its booked
// credit, no invoice; the autonomous Treasury agent's sweep_earnings).
//   Metal side (live now): sweep net earnings to the sweep wallet, wait for finality, lock the credit.
//   Airwallex side: book the credit, plan the invoice, quote, approval, conversion, SWIFT, PAID.
//   Without AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY the Airwallex side stops and says so; nothing is faked.

import { setScriptOrigin } from "../provenance/origin.js";
import type { Hash } from "viem";
import { awaitFinalTransfer, executeSweep, lockCredit, netEarnings, nextSweepId, nextSweepStep, planSweep } from "../agents/sweep.js";
import { fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { EXPLORER_TX } from "../metal/network.js";
import { addresses } from "../world/runtime.js";
import { runAirwallexSide } from "./s3-airwallex.js";

const db = openDb();
const addr = addresses(db);
// D24: started by the Treasury agent's sweep_earnings, this script carries the agent's origin (through the environment);
// run by itself, the sweep is code's: the planned sweep of net earnings above what the mandates may still spend.
setScriptOrigin({ actor: "code", rule: "the sweep of net earnings (npm run s3)", agent: "treasury" });

console.log("GOAL             move earnings into Airwallex and pay the manufacturer's EUR invoice, without breaking a floor");
// The long run of 20 November: with --sweep-only, a sweep finished end to end (final, credit booked) no longer stands in
// for a new one; the earnings since are swept as a new sweep (nextSweepStep).
const step = nextSweepStep(db, { sweepOnly: process.argv.includes("--sweep-only") });

let eventKey: string;
if (step.kind !== "book") {
  let paymentId: string, amount: number, tx: string | null;
  if (step.kind === "resume") {
    // An earlier run stopped mid-way: the same payment id and amount, never a new one.
    ({ paymentId, amountCents: amount } = step);
    const r = await executeSweep(db, paymentId, amount, addr.sweep);
    tx = r.tx;
    if (r.outcome !== "PAID") throw new Error(`${paymentId}: ${r.outcome} ${r.reason ?? ""}`);
  } else if (step.kind === "finalize") {
    ({ paymentId, amountCents: amount, tx } = step);
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
  eventKey = step.eventKey;
  console.log(`SWEEP            ${step.paymentId} already final; credit locked as ${eventKey}`);
}

const cfg = fromEnv();
if (!cfg) {
  console.log("\nBLOCKED          Airwallex sandbox keys are not set (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY).");
  console.log("                 The credit stays locked and unbooked; run npm run s3 again once the keys are set.");
  process.exit(0);
}
await runAirwallexSide(db, cfg, eventKey, { invoice: !process.argv.includes("--sweep-only") });

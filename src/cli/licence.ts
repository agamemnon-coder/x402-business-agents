// npm run licence: Kit 11's monthly licence fee, invoiced in euros, paid by the treasury (Finance) agent. The fee is in
// code (LICENCE_FEE_EUR_CENTS); the invoice is read, checked against it and the allowlisted licensor, and planned as
// one proposal (FX only for the shortfall, SWIFT, the fee ceiling) that waits for the CFO's Face ID. Needs the
// Airwallex sandbox keys; without them it stops and says so, nothing is faked.
// Who started it is recorded on the proposal (proposal.created's origin): run by a person, the CFO's command (it moves
// no money); started by the Treasury agent's plan_invoice, the agent's own origin, which it passes in KIT11_ORIGIN.

import { seedTreasury } from "../agents/euroBill.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { LICENCE_FEE_EUR_CENTS, LICENCE_INVOICE_FIXTURE, LICENSOR_NAME } from "../config/policy.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { LICENCE_COMMAND, setScriptOrigin } from "../provenance/origin.js";
import { planInvoice } from "./s3-airwallex.js";

setScriptOrigin(LICENCE_COMMAND);
const cfg = fromEnv();
console.log(`GOAL             pay ${LICENSOR_NAME}'s monthly data licence, EUR ${fromCents(LICENCE_FEE_EUR_CENTS)} in code, without breaking a floor`);
if (!cfg) {
  console.log("STOP             no Airwallex sandbox keys (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY); nothing was planned");
  process.exit(0);
}
const db = openDb();
const rest = new AirwallexRest(new Airwallex(cfg));
const s = await seedTreasury(db, rest, rest);
await planInvoice(db, rest, s, LICENCE_INVOICE_FIXTURE);

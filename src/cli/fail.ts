// npm run fail -- f2 | f4: failure tests run live.
// F2(b), Metal testnet: a refund over the support mandate's per-payment cap (0.10) is refused before anything
//   is sent, and the mandate's spend does not move.
// F4(b), Airwallex sandbox: an invoice whose shortfall conversion would take USD under its floor escalates
//   with options; no proposal, conversion or transfer is made and the balances do not move.
// F1, F3(b), F5, F6, F8 and F9 run as unit tests (npm test); F2(a) and F3(a) are part of S1 and S2.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proposeInvoicePayment, treasuryState } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { addresses } from "../world/runtime.js";

const which = process.argv[2];
if (which === "f4") await f4();
if (which !== "f2") {
  console.error("usage: npm run fail -- f2 | f4");
  process.exit(2);
}
const addr = addresses(openDb());
const m = await activeMandate("support");
const before = await mandateSpent(m);
const r = metalAgent(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", addr.customer, "--amount", "0.11", "--payment-id", `f2-over-cap-${Date.now()}`], [0, 1, 3, 4]);
const after = await mandateSpent(m);
const reason = r.fields.get("reason")?.[0] ?? r.out.trim().split("\n").at(-1) ?? "";
const pass = r.code === 1 && /mandate_cap_exceeded/.test(r.out) && after === before;
console.log(`F2(b) support pull 0.11 against cap 0.10: exit ${r.code}, ${reason}`);
console.log(`      spent before ${fromCents(baseUnitsToCents(before))}, after ${fromCents(baseUnitsToCents(after))}`);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);

async function f4(): Promise<never> {
  const cfg = fromEnv();
  if (!cfg) {
    console.log("BLOCKED  F4(b) needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY");
    process.exit(1);
  }
  const db = openDb();
  const rail = new AirwallexRest(new Airwallex(cfg));
  const text = readFileSync(resolve(import.meta.dirname, "../../fixtures/lizenzhaus-invoice-LIC-2027-ANNUAL.txt"), "utf8");
  const inv = parseInvoiceFallback(text);
  const before = await rail.balances();
  const s = treasuryState(db, before);
  const proposals = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;
  const n0 = proposals();
  console.log(`F4(b) invoice ${inv.invoice_no}: EUR ${inv.amount}; free EUR ${fromCents(Math.max(0, s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents))}, USD ${fromCents(s.usdAvailableCents)} (floor ${fromCents(s.usdFloorCents)})`);
  const out = await proposeInvoicePayment(db, rail, inv, text);
  const after = await rail.balances();
  const moved = (["EUR", "USD"] as const).filter((c) => before[c]?.availableCents !== after[c]?.availableCents);
  console.log(`      ${out.kind === "escalated" ? `escalated: ${out.reason}` : `NOT escalated: ${out.proposal.proposal_id}`}`);
  console.log(`      balances ${moved.length ? `moved (${moved.join(", ")})` : "unchanged"}; new proposals ${proposals() - n0}`);
  const pass = out.kind === "escalated" && /USD would drop/.test(out.reason) && moved.length === 0 && proposals() === n0;
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

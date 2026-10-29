// npm run fraud: tier 3 item 7 live. Two invoices arrive that look like the licensor's: one announces new bank
// details, one comes from a lookalike name. Claude reads each (Haiku classifies, Sonnet extracts); code compares
// the payee with the allowlist and blocks both before Airwallex is touched; Opus explains each to the CFO.
// Needs a ledger whose S3 already allowlisted the licensor (KIT11_DB). Nothing is paid, quoted or proposed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proposeInvoicePayment } from "../agents/euroBill.js";
import type { AirwallexRail } from "../airwallex/port.js";
import { Tools } from "../claude/tools.js";
import { openDb } from "../db/open.js";

const CASES = [
  { file: "lizenzhaus-invoice-LIC-2027-01-BANKCHANGE.txt", what: "new bank details", expect: "bank_details_changed" },
  { file: "lizenzhaus-invoice-LIC-2027-02-LOOKALIKE.txt", what: "lookalike vendor", expect: "lookalike_vendor" },
] as const;

/** Any call on the rail throws: a blocked invoice must not read a balance, ask for a quote or pay. */
const noAirwallex = new Proxy({}, { get: (_t, prop) => () => { throw new Error(`Airwallex was called (${String(prop)}) for an invoice that should be blocked`); } }) as AirwallexRail;

const db = openDb();
if (!db.prepare("SELECT 1 FROM beneficiaries WHERE currency = 'EUR'").get()) {
  console.error("No allowlisted beneficiary in this ledger; run S3 first (npm run s3) or set KIT11_DB to a world that did.");
  process.exit(2);
}
const tools = new Tools(db);
let failures = 0;
for (const c of CASES) {
  const text = readFileSync(resolve(import.meta.dirname, "../../fixtures", c.file), "utf8");
  const kind = await tools.classify(text);
  const read = await tools.invoice(text);
  const inv = read.value;
  console.log(`\nINVOICE   ${inv.invoice_no} (${c.what}) from "${inv.vendor}": EUR ${inv.amount}, IBAN ...${inv.iban.slice(-4)}, BIC ${inv.bic}`);
  console.log(`          read by ${read.source === "claude" ? `${kind.model} and ${read.model}` : `the deterministic parser (${read.note})`}`);
  const out = await proposeInvoicePayment(db, noAirwallex, inv, text);
  if (out.kind !== "escalated" || !out.fraud?.suspicious) {
    console.log(`FAIL      not blocked as possible fraud (${out.kind === "escalated" ? out.reason : `proposed ${out.proposal.proposal_id}`})`);
    failures++;
    continue;
  }
  for (const s of out.fraud.signals) console.log(`${s.blocks ? "BLOCKED " : "evidence"}  ${s.code}: ${s.detail}`);
  const e = await tools.explainFraud(out.fraud, text);
  console.log(`EXPLAINED ${e.source === "claude" ? `${e.model}, advisory` : "no model"}: ${e.value.recommendation.replace(/_/g, " ")}. ${e.value.summary}`);
  for (const step of e.value.verify_steps) console.log(`          - ${step}`);
  const hit = out.fraud.signals.some((s) => s.code === c.expect && s.blocks);
  console.log(hit ? "PASS      blocked before Airwallex; no quote, no proposal, nothing paid" : `FAIL      expected ${c.expect}`);
  if (!hit) failures++;
}
process.exit(failures === 0 ? 0 : 1);

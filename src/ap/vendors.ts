// Payables, part 3: a new supplier. Paying a supplier's own invoice to the account on that invoice is how invoice fraud
// works, so a new supplier goes through the same three steps as a change of bank details (src/policy/payeeChange.ts):
//   1. a request (an agent may make it from an invoice waiting for its supplier, or a person): it changes nothing;
//   2. a person records that the supplier confirmed the account and its address on a contact we already had, not one
//      from the invoice or the e-mail (an agent cannot record this);
//   3. a payee_add proposal carrying the full IBAN and that verification, approved by the CFO (Face ID; two people
//      with four eyes on).
// Only then does the executor add the account at Airwallex and to the ledger's suppliers, and the invoices waiting for
// that supplier are checked again.

import { audit, type Actor } from "../audit/log.js";
import type { AirwallexRail } from "../airwallex/port.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { ibanSha } from "../agents/invoice.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { assessAgainst, type Beneficiary } from "../policy/fraudCore.js";
import { recheck, type InboxDeps } from "./inbox.js";
import { ibanValid } from "./reading.js";
import { apInvoice } from "./store.js";

/** A new supplier waits an hour for the CFO, like a change of bank details. */
const PAYEE_ADD_TTL_MS = 60 * 60 * 1000;
const BIC = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;

export type Address = { street: string; city: string; postcode: string };

export interface PayeeAddRow {
  add_id: string;
  vendor: string;
  iban: string;
  bic: string;
  source: string | null;
  requested_by: string;
  verification_json: string | null;
  proposal_id: string | null;
  status: "REQUESTED" | "VERIFIED" | "PROPOSED" | "APPLIED";
  created_at: string;
}

export interface PayeeAddTerms extends Terms {
  kind: "payee_add";
  add_id: string;
  vendor: string;
  iban: string;
  bic: string;
  address: Address;
  verification: { by: string; how: string; at: string };
}

const row = (db: DB, id: string) => {
  const r = db.prepare("SELECT * FROM payee_adds WHERE add_id = ?").get(id) as PayeeAddRow | undefined;
  if (!r) throw new Error(`no supplier request ${id}`);
  return r;
};
const onFile = (db: DB) => db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE status = 'ACTIVE'").all() as Beneficiary[];

export function requestPayeeAdd(db: DB, a: { vendor: string; iban: string; bic: string; source: string | null }, by: Actor, now = new Date()): PayeeAddRow {
  const vendor = a.vendor.trim();
  const iban = a.iban.replace(/\s+/g, "").toUpperCase();
  const bic = a.bic.trim().toUpperCase();
  if (!vendor) throw new Error("a supplier needs a name");
  if (!ibanValid(iban)) throw new Error(`the IBAN ${iban.slice(0, 4)}…${iban.slice(-4)} fails its checksum; nothing was requested`);
  if (!BIC.test(bic)) throw new Error(`not a BIC: ${a.bic}`);
  // The executor can only add a German account at Airwallex: say so now, before two people are asked to approve it.
  if (!iban.startsWith("DE")) throw new Error(`this build adds German (DE) accounts at Airwallex only, not ${iban.slice(0, 2)}; nothing was requested`);
  const all = onFile(db);
  if (all.some((b) => b.name.trim() === vendor)) throw new Error(`${vendor} is already a supplier on file; new bank details for it are a bank-detail change (npm run payee)`);
  const finding = assessAgainst(all, { vendor, iban, bic }, "", ibanSha(iban));
  const odd = finding.signals.filter((s) => s.blocks && s.code !== "unknown_vendor");
  if (odd.length) throw new Error(`${odd.map((s) => s.detail).join("; ")}: a name that looks like a supplier on file is not added as a new one`);
  const open = db.prepare("SELECT add_id FROM payee_adds WHERE vendor = ? AND status <> 'APPLIED'").get(vendor) as { add_id: string } | undefined;
  if (open) throw new Error(`${vendor} is already requested as ${open.add_id}`);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM payee_adds").get() as { n: number }).n;
  const id = `N-${String(n + 1).padStart(4, "0")}`;
  db.transaction(() => {
    db.prepare("INSERT INTO payee_adds (add_id, vendor, iban, bic, source, requested_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?)")
      .run(id, vendor, iban, bic, a.source, by, now.toISOString());
    audit(db, by, "payee.add_requested", id, { vendor, iban_last4: iban.slice(-4), country: iban.slice(0, 2), source: a.source }, now);
  }).immediate();
  return row(db, id);
}

/** The request for the supplier of an invoice waiting for it, from what the invoice says (verified next by a person). */
export function requestPayeeAddForInvoice(db: DB, apId: string, by: Actor, now = new Date()): PayeeAddRow {
  const inv = apInvoice(db, apId);
  if (!inv) throw new Error(`no payables invoice ${apId}`);
  if (inv.status !== "needs_vendor") throw new Error(`${apId} is ${inv.status.replace(/_/g, " ")}, not waiting for a new supplier`);
  return requestPayeeAdd(db, { vendor: inv.reading.vendor, iban: inv.reading.iban, bic: inv.reading.bic, source: apId }, by, now);
}

/** Only a person records that the supplier confirmed the account and its address, and how (a contact we already had). */
export function recordPayeeAddVerification(db: DB, id: string, v: { by: string; how: string; actor: Actor; address: Address }, now = new Date()): PayeeAddRow {
  if (v.actor !== "human") throw new Error("only a person can record that a new supplier confirmed its bank details");
  if (v.how.trim().length < 20) throw new Error("say how it was verified: who you called, on which number from your own records");
  const address = { street: v.address.street.trim(), city: v.address.city.trim(), postcode: v.address.postcode.trim() };
  if (!address.street || !address.city || !address.postcode) throw new Error("the supplier's address (street, city, postcode) is needed to add it at Airwallex");
  const r = row(db, id);
  if (r.status !== "REQUESTED") throw new Error(`${id} is ${r.status.toLowerCase()}, not waiting for verification`);
  db.transaction(() => {
    db.prepare("UPDATE payee_adds SET status = 'VERIFIED', verification_json = ? WHERE add_id = ? AND status = 'REQUESTED'")
      .run(JSON.stringify({ by: v.by, how: v.how.trim(), at: now.toISOString(), address }), id);
    audit(db, "human", "payee.add_verified", id, { vendor: r.vendor, by: v.by, how: v.how.trim() }, now);
  }).immediate();
  return row(db, id);
}

export function proposePayeeAdd(db: DB, id: string, by: Actor, now = new Date()): ProposalRow {
  const r = row(db, id);
  if (r.status !== "VERIFIED" || !r.verification_json) throw new Error(`${id} is not verified by a person yet; nothing to propose`);
  if (onFile(db).some((b) => b.name.trim() === r.vendor)) throw new Error(`${r.vendor} is on file already`);
  const v = JSON.parse(r.verification_json) as { by: string; how: string; at: string; address: Address };
  const terms: PayeeAddTerms = {
    schema: TERMS_SCHEMA, kind: "payee_add", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + PAYEE_ADD_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    add_id: id, vendor: r.vendor, iban: r.iban, bic: r.bic, address: v.address, verification: { by: v.by, how: v.how, at: v.at },
  };
  const p = createProposal(db, { terms, createdBy: by }, now);
  db.prepare("UPDATE payee_adds SET status = 'PROPOSED', proposal_id = ? WHERE add_id = ?").run(p.proposal_id, id);
  return p;
}

/** After approval: the account is added at Airwallex and to the suppliers on file; the invoices waiting for it are checked again. */
export async function executePayeeAdd(db: DB, rail: AirwallexRail, proposalId: string, inbox: Pick<InboxDeps, "now" | "sink"> = {}, now = new Date()): Promise<void> {
  const t = beginExecution<PayeeAddTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "payee_add") throw new Error(`${proposalId} is not a new supplier`);
    if (onFile(db).some((b) => b.name.trim() === terms.vendor)) throw new Error(`${terms.vendor} is on file already; nothing was added`);
  }, now);
  if (!t.iban.startsWith("DE")) {
    finishExecution(db, proposalId, "FAILED", { error: "this build adds German (DE) accounts at Airwallex only" }, now);
    throw new Error("this build adds German (DE) accounts at Airwallex only; nothing was added");
  }
  const ben = (await rail.findBeneficiaryByIban(t.iban)) ?? (await rail.createBeneficiary({
    name: t.vendor, iban: t.iban, bic: t.bic, currency: "EUR", countryCode: "DE",
    bankName: `Bank ${t.bic.slice(0, 4)} (BIC ${t.bic})`,
    address: { ...t.address, countryCode: "DE" },
  }));
  db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT', 'ACTIVE')")
      .run(ben.id, t.vendor, t.iban.slice(-4), ibanSha(t.iban), t.bic);
    db.prepare("UPDATE payee_adds SET status = 'APPLIED' WHERE add_id = ?").run(t.add_id);
    audit(db, "awx-executor", "payee.added", t.add_id, { vendor: t.vendor, iban_last4: t.iban.slice(-4), beneficiary_id: ben.id, proposal_id: proposalId }, now);
    finishExecution(db, proposalId, "EXECUTED", { beneficiary_id: ben.id }, now);
  }).immediate();
  await recheck(db, inbox);
}

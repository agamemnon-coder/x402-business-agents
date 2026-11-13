// A supplier's new bank details (E3). Changed bank details are how invoice fraud works, so a new IBAN goes through
// three separate steps before any invoice can be paid to it:
//   1. a request (an agent may make it, from a blocked invoice, or a person): it changes nothing;
//   2. a person records that the supplier confirmed the new account on a contact we already had, not one from the
//      invoice or the email (an agent cannot record this);
//   3. a proposal carrying the full new IBAN and that verification, approved by the CFO (Face ID).
// Only then does the executor add the account at Airwallex and make it the supplier's active payee; the old one is
// kept as REPLACED, for the history.

import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { ibanSha } from "../agents/invoice.js";
import type { AirwallexRail } from "../airwallex/port.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "./approvals.js";
import { freshCheck, nameCheckGate, payeeCheckOn, runNameCheck, type NameCheckRow, type PayeeNameVerifier } from "../airwallex/payeeName.js";

/** A payee change waits an hour for the CFO, like a mandate change. */
const PAYEE_CHANGE_TTL_MS = 60 * 60 * 1000;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const BIC = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;

export interface PayeeChangeRow {
  change_id: string;
  vendor: string;
  old_beneficiary_id: string;
  new_iban: string;
  new_bic: string;
  source: string | null;
  requested_by: string;
  verification_json: string | null;
  proposal_id: string | null;
  status: "REQUESTED" | "VERIFIED" | "PROPOSED" | "APPLIED";
  created_at: string;
}

export interface PayeeChangeTerms extends Terms {
  kind: "payee_change";
  change_id: string;
  vendor: string;
  old_beneficiary_id: string;
  old_iban_last4: string;
  new_iban: string;
  new_bic: string;
  verification: { by: string; how: string; at: string };
}

type Active = { beneficiary_id: string; iban_last4: string; iban_sha256: string; bic: string };
const active = (db: DB, vendor: string) =>
  db.prepare("SELECT beneficiary_id, iban_last4, iban_sha256, bic FROM beneficiaries WHERE name = ? AND status = 'ACTIVE'").get(vendor) as Active | undefined;
const row = (db: DB, id: string) => {
  const r = db.prepare("SELECT * FROM payee_changes WHERE change_id = ?").get(id) as PayeeChangeRow | undefined;
  if (!r) throw new Error(`no payee change ${id}`);
  return r;
};
const normal = (iban: string) => iban.replace(/\s+/g, "").toUpperCase();
/**
 * Another supplier on file paid to this account, or null (red team round 4: a bank change to the account the licensor
 * is paid to adopted the licensor's beneficiary and renamed it, so one account was two suppliers' and the licensor fell
 * off the list). One account is never two suppliers', whichever way it arrives.
 */
function accountOfAnother(db: DB, iban: string, vendor: string): string | null {
  const r = db.prepare("SELECT name FROM beneficiaries WHERE status = 'ACTIVE' AND iban_sha256 = ? AND name <> ?").get(ibanSha(iban), vendor) as { name: string } | undefined;
  return r?.name ?? null;
}

export function requestPayeeChange(db: DB, a: { vendor: string; iban: string; bic: string; source: string | null }, by: Actor, now = new Date()): PayeeChangeRow {
  const iban = normal(a.iban);
  const bic = a.bic.trim().toUpperCase();
  if (!IBAN.test(iban)) throw new Error(`not an IBAN: ${a.iban}`);
  if (!BIC.test(bic)) throw new Error(`not a BIC: ${a.bic}`);
  // The executor can only add a German account at Airwallex: say so now, before two people are asked to approve it.
  if (!iban.startsWith("DE")) throw new Error(`this build adds German (DE) accounts at Airwallex only, not ${iban.slice(0, 2)}; nothing was requested`);
  const on = active(db, a.vendor);
  if (!on) throw new Error(`${a.vendor} is not an allowlisted payee; a new supplier is not a bank-detail change`);
  if (on.iban_sha256 === ibanSha(iban) && on.bic === bic) throw new Error(`these bank details are already on file for ${a.vendor}`);
  const other = accountOfAnother(db, iban, a.vendor);
  if (other) throw new Error(`this account is already on file for ${other}; one account is never two suppliers' (a person checks who is paid to it), so nothing was requested`);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM payee_changes").get() as { n: number }).n;
  const id = `B-${String(n + 1).padStart(4, "0")}`;
  db.transaction(() => {
    db.prepare("INSERT INTO payee_changes (change_id, vendor, old_beneficiary_id, new_iban, new_bic, source, requested_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)")
      .run(id, a.vendor, on.beneficiary_id, iban, bic, a.source, by, now.toISOString());
    audit(db, by, "payee.change_requested", id, { vendor: a.vendor, from_last4: on.iban_last4, to_last4: iban.slice(-4), to_country: iban.slice(0, 2), source: a.source }, now);
  }).immediate();
  return row(db, id);
}

/** Only a person records that the supplier confirmed the account, and how (a contact we already had). */
export function recordVerification(db: DB, id: string, v: { by: string; how: string; actor: Actor }, now = new Date()): PayeeChangeRow {
  if (v.actor !== "human") throw new Error("only a person can record that the supplier confirmed its new bank details");
  if (v.how.trim().length < 20) throw new Error("say how it was verified: who you called, on which number from your own records");
  const r = row(db, id);
  if (r.status !== "REQUESTED") throw new Error(`${id} is ${r.status.toLowerCase()}, not waiting for verification`);
  db.transaction(() => {
    db.prepare("UPDATE payee_changes SET status = 'VERIFIED', verification_json = ? WHERE change_id = ? AND status = 'REQUESTED'")
      .run(JSON.stringify({ by: v.by, how: v.how.trim(), at: now.toISOString() }), id);
    audit(db, "human", "payee.change_verified", id, { vendor: r.vendor, by: v.by, how: v.how.trim() }, now);
  }).immediate();
  return row(db, id);
}

/** Asks the new account's bank, through Airwallex, whether it carries the supplier's name (before the proposal). */
export async function checkPayeeChangeName(db: DB, verifier: PayeeNameVerifier, id: string, by: Actor, now = new Date()): Promise<NameCheckRow> {
  const r = row(db, id);
  if (r.status !== "VERIFIED") throw new Error(`${id} is ${r.status}; only a change a person verified is checked with the bank`);
  const iban = normal(r.new_iban);
  return runNameCheck(db, verifier, { name: r.vendor, entity: "COMPANY", country: iban.slice(0, 2), currency: "EUR", iban, accountKey: iban }, by, now);
}

/** The flow's way to file a bank-detail change: the new account's bank is asked first (see checkThenProposePayeeAdd). */
export async function checkThenProposePayeeChange(db: DB, verifier: PayeeNameVerifier | null, id: string, by: Actor, now = new Date()): Promise<ProposalRow> {
  if (payeeCheckOn()) {
    const r = row(db, id);
    if (r.status === "VERIFIED" && !freshCheck(db, r.vendor, normal(r.new_iban), now)) {
      if (!verifier) throw new Error(`no Airwallex keys: the new account's bank cannot be asked whether it carries ${r.vendor}'s name, so nothing is proposed`);
      await checkPayeeChangeName(db, verifier, id, by, now);
    }
  }
  return proposePayeeChange(db, id, by, now);
}

export function proposePayeeChange(db: DB, id: string, by: Actor, now = new Date()): ProposalRow {
  const r = row(db, id);
  if (r.status !== "VERIFIED" || !r.verification_json) throw new Error(`${id} is not verified by a person yet; nothing to propose`);
  const on = active(db, r.vendor);
  if (!on || on.beneficiary_id !== r.old_beneficiary_id) throw new Error(`${r.vendor}'s account on file changed since ${id} was requested`);
  // On by default: the new account must carry the supplier's name at its bank (src/airwallex/payeeName.ts).
  const nameCheck = nameCheckGate(db, r.vendor, normal(r.new_iban), now);
  const terms: PayeeChangeTerms = {
    schema: TERMS_SCHEMA, kind: "payee_change", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + PAYEE_CHANGE_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    change_id: id, vendor: r.vendor, old_beneficiary_id: on.beneficiary_id, old_iban_last4: on.iban_last4,
    new_iban: r.new_iban, new_bic: r.new_bic, verification: JSON.parse(r.verification_json) as PayeeChangeTerms["verification"],
    ...(nameCheck ? { name_check: nameCheck } : {}),
  };
  const p = createProposal(db, { terms, createdBy: by }, now);
  db.prepare("UPDATE payee_changes SET status = 'PROPOSED', proposal_id = ? WHERE change_id = ?").run(p.proposal_id, id);
  return p;
}

/** After approval: the new account is added at Airwallex and becomes the supplier's active payee. */
export async function executePayeeChange(db: DB, rail: AirwallexRail, proposalId: string, now = new Date()): Promise<void> {
  const t = beginExecution<PayeeChangeTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "payee_change") throw new Error(`${proposalId} is not a payee change`);
    const on = active(db, terms.vendor);
    if (!on || on.beneficiary_id !== terms.old_beneficiary_id || on.iban_last4 !== terms.old_iban_last4) {
      throw new Error(`${terms.vendor}'s account on file is now …${on?.iban_last4 ?? "none"}, not …${terms.old_iban_last4}; nothing changed`);
    }
    const other = accountOfAnother(db, terms.new_iban, terms.vendor);
    if (other) throw new Error(`the new account is already on file for ${other}; one account is never two suppliers'; nothing changed`);
  }, now);
  if (!t.new_iban.startsWith("DE")) {
    finishExecution(db, proposalId, "FAILED", { error: "this build adds German (DE) accounts at Airwallex only" }, now);
    throw new Error("this build adds German (DE) accounts at Airwallex only; nothing changed");
  }
  const found = await rail.findBeneficiaryByIban(t.new_iban);
  // A beneficiary the ledger holds for another supplier is never adopted (and renamed): a new one is made for this one.
  const theirs = found ? (db.prepare("SELECT name FROM beneficiaries WHERE beneficiary_id = ? AND name <> ?").get(found.id, t.vendor) as { name: string } | undefined) : undefined;
  const existing = theirs ? null : found;
  const ben = existing ?? (await rail.createBeneficiary({
    name: t.vendor, iban: t.new_iban, bic: t.new_bic, currency: "EUR", countryCode: "DE",
    // The verified request names the account, not the bank; the BIC identifies the bank for Airwallex's schema.
    bankName: `Bank ${t.new_bic.slice(0, 4)} (BIC ${t.new_bic})`,
    address: { street: "Textilweg 4", city: "Reutlingen", postcode: "72760", countryCode: "DE" },
  }));
  db.transaction(() => {
    db.prepare("UPDATE beneficiaries SET status = 'REPLACED' WHERE beneficiary_id = ?").run(t.old_beneficiary_id);
    db.prepare("INSERT OR REPLACE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT', 'ACTIVE')")
      .run(ben.id, t.vendor, t.new_iban.slice(-4), ibanSha(t.new_iban), t.new_bic);
    db.prepare("UPDATE payee_changes SET status = 'APPLIED' WHERE change_id = ?").run(t.change_id);
    audit(db, "awx-executor", "payee.changed", t.change_id, { vendor: t.vendor, from_last4: t.old_iban_last4, to_last4: t.new_iban.slice(-4), beneficiary_id: ben.id, proposal_id: proposalId }, now);
    finishExecution(db, proposalId, "EXECUTED", { beneficiary_id: ben.id }, now);
  }).immediate();
}

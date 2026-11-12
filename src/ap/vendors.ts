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
import type { PayoutRail } from "../airwallex/port.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { ibanSha } from "../agents/invoice.js";
import { beginExecution, createProposal, expireDue, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { assessAgainst, type Beneficiary } from "../policy/fraudCore.js";
import { recheck, type InboxDeps } from "./inbox.js";
import { checkpoint } from "../policy/saga.js";
import { accountKey, chooseRoute, maskAccount, validateDetails, type BankDetails, type Method } from "../payouts/routes.js";
import { apInvoice } from "./store.js";
import { suppliersOnFile } from "./bank.js";

/** A new supplier waits an hour for the CFO, like a change of bank details. */
const PAYEE_ADD_TTL_MS = 60 * 60 * 1000;

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
  /** The full bank details and the route they are paid on (JSON of PayeeBank). */
  details_json: string | null;
}

/** The account a new supplier is added with, and the route Purser pays it on (src/payouts/routes.ts). */
export type PayeeBank = BankDetails & {
  method: Method;
  clearing: string | null;
};

export interface PayeeAddTerms extends Terms {
  kind: "payee_add";
  add_id: string;
  vendor: string;
  iban: string;
  bic: string;
  /** The full bank details the CFO approves: country, currency, method, IBAN or account number and routing code. */
  bank: PayeeBank;
  /** The account as it reads on the phone (masked); the full details are in bank. */
  account: string;
  address: Address;
  verification: { by: string; how: string; at: string };
}

const row = (db: DB, id: string) => {
  const r = db.prepare("SELECT * FROM payee_adds WHERE add_id = ?").get(id) as PayeeAddRow | undefined;
  if (!r) throw new Error(`no supplier request ${id}`);
  return r;
};
/**
 * The supplier on file already paid to this account (its hash), or null (red team round 3: the same supplier added again
 * under a new name, and its invoices paid once under each name).
 */
export function accountOnFile(db: DB, accountSha256: string): string | null {
  const r = db.prepare("SELECT name FROM beneficiaries WHERE status = 'ACTIVE' AND iban_sha256 = ?").get(accountSha256) as { name: string } | undefined;
  return r?.name ?? null;
}

const onFile = (db: DB) => db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE status = 'ACTIVE'").all() as Beneficiary[];

/** The bank details as given: a full set, or (as before) an IBAN and BIC, with the country taken from the IBAN. */
function bankOf(a: { vendor: string; iban?: string; bic?: string; currency?: string; bank?: Partial<BankDetails> }): BankDetails {
  const iban = (a.bank?.iban ?? a.iban ?? "").replace(/\s+/g, "").toUpperCase();
  const swift = (a.bank?.swiftCode ?? a.bic ?? "").replace(/\s+/g, "").toUpperCase();
  const country = (a.bank?.country || (iban ? iban.slice(0, 2) : swift.length >= 6 ? swift.slice(4, 6) : "")).toUpperCase();
  return {
    country, currency: (a.bank?.currency || a.currency || "EUR").toUpperCase(), accountName: (a.bank?.accountName ?? a.vendor).trim(),
    iban, accountNumber: (a.bank?.accountNumber ?? "").replace(/[\s-]/g, "").toUpperCase(),
    routingType: a.bank?.routingType ?? "", routingValue: (a.bank?.routingValue ?? "").replace(/[\s-]/g, ""), swiftCode: swift,
  };
}

/**
 * The route for a request or approved terms from before the payout routes (an IBAN and BIC only): the IBAN's own
 * route, as a new request would get it (a DE IBAN is paid LOCAL in EUR), never a SWIFT default the route table no
 * longer gives. Throws when the details have no route or fail its checks, like a new request would.
 */
function legacyPayeeBank(vendor: string, iban: string, bic: string): PayeeBank {
  const bank = bankOf({ vendor, iban, bic });
  const route = chooseRoute(bank);
  if (!route.ok) throw new Error(route.reason);
  const wrong = validateDetails(bank, route.route);
  if (wrong.length) throw new Error(wrong.join("; "));
  return { ...bank, method: route.route.method, clearing: route.route.clearing ?? null };
}

export function requestPayeeAdd(db: DB, a: { vendor: string; iban?: string; bic?: string; currency?: string; bank?: Partial<BankDetails>; source: string | null }, by: Actor, now = new Date()): PayeeAddRow {
  const vendor = a.vendor.trim();
  if (!vendor) throw new Error("a supplier needs a name");
  const bank = bankOf(a);
  // The route and the details are checked now, before a person and the CFO are asked to approve them.
  const route = chooseRoute(bank);
  if (!route.ok) throw new Error(`${route.reason}; nothing was requested`);
  const wrong = validateDetails(bank, route.route);
  if (wrong.length) throw new Error(`${wrong.join("; ")}; nothing was requested`);
  const payee: PayeeBank = { ...bank, method: route.route.method, clearing: route.route.clearing ?? null };
  const iban = bank.iban ?? "";
  const bic = bank.swiftCode ?? "";
  const key = accountKey(bank);
  const all = suppliersOnFile(db);
  if (all.some((b) => b.name.trim() === vendor)) throw new Error(`${vendor} is already a supplier on file; new bank details for it are a bank-detail change (npm run payee)`);
  const finding = assessAgainst(all, { vendor, iban: key, bic: "" }, "", ibanSha(key));
  const odd = finding.signals.filter((s) => s.blocks && s.code !== "unknown_vendor");
  if (odd.length) throw new Error(`${odd.map((s) => s.detail).join("; ")}: a name that looks like a supplier on file is not added as a new one`);
  const sameAccount = accountOnFile(db, ibanSha(key));
  if (sameAccount) throw new Error(`this account is already on file for ${sameAccount}; one account is never added under a second name (its invoices would be paid twice), so a person checks who ${vendor} is`);
  closeDeadAdds(db, now);
  const open = db.prepare("SELECT add_id FROM payee_adds WHERE vendor = ? AND status NOT IN ('APPLIED', 'CLOSED')").get(vendor) as { add_id: string } | undefined;
  if (open) throw new Error(`${vendor} is already requested as ${open.add_id}`);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM payee_adds").get() as { n: number }).n;
  const id = `N-${String(n + 1).padStart(4, "0")}`;
  db.transaction(() => {
    db.prepare("INSERT INTO payee_adds (add_id, vendor, iban, bic, source, requested_by, status, created_at, details_json) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)")
      .run(id, vendor, iban, bic, a.source, by, now.toISOString(), JSON.stringify(payee));
    audit(db, by, "payee.add_requested", id, { vendor, account: maskAccount(bank), country: bank.country, currency: bank.currency, method: payee.method, source: a.source }, now);
  }).immediate();
  return row(db, id);
}

/** The request for the supplier of an invoice waiting for it, from what the invoice says (verified next by a person). */
export function requestPayeeAddForInvoice(db: DB, apId: string, by: Actor, now = new Date()): PayeeAddRow {
  const inv = apInvoice(db, apId);
  if (!inv) throw new Error(`no payables invoice ${apId}`);
  if (inv.status !== "needs_vendor") throw new Error(`${apId} is ${inv.status.replace(/_/g, " ")}, not waiting for a new supplier`);
  const r = inv.reading;
  return requestPayeeAdd(db, {
    vendor: r.vendor, source: apId,
    bank: {
      country: r.bank_country, currency: r.currency, accountName: r.vendor, iban: r.iban, swiftCode: r.bic, accountNumber: r.account_number,
      routingType: (r.routing_type as BankDetails["routingType"]) || "", routingValue: r.routing_value,
    },
  }, by, now);
}

/** Only a person records that the supplier confirmed the account and its address, and how (a contact we already had). */
/**
 * What the person reads back to prove they checked the account with the supplier: the IBAN's last four, or, for an
 * account without an IBAN (US, CN, a UK sort code), the account number's last four (red team round 4: the read-back was
 * the empty IBAN's last four, so an empty answer passed). Empty only when the request holds no account at all.
 */
export function readBackOf(add: { iban: string; details_json: string | null }): string {
  const iban = add.iban.replace(/\s+/g, "").toUpperCase();
  if (iban) return iban.slice(-4);
  const d = add.details_json ? (JSON.parse(add.details_json) as Partial<BankDetails>) : {};
  return (d.accountNumber ?? "").replace(/[\s-]/g, "").toUpperCase().slice(-4);
}

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

/**
 * A request whose proposal expired, was rejected, was superseded or can no longer run is CLOSED (review, 8 November):
 * the supplier is not locked out, a new request may follow. A FAILED one stays: its approved terms may still run.
 */
export function closeDeadAdds(db: DB, now = new Date()): void {
  expireDue(db, now);
  const dead = db.prepare(`SELECT a.add_id, a.vendor, p.status FROM payee_adds a JOIN proposals p ON p.proposal_id = a.proposal_id
    WHERE a.status = 'PROPOSED' AND p.status IN ('EXPIRED', 'REJECTED', 'SUPERSEDED', 'NEEDS_REAPPROVAL')`).all() as { add_id: string; vendor: string; status: string }[];
  for (const d of dead) {
    db.prepare("UPDATE payee_adds SET status = 'CLOSED' WHERE add_id = ? AND status = 'PROPOSED'").run(d.add_id);
    audit(db, "system", "payee.add_closed", d.add_id, { vendor: d.vendor, proposal: d.status.toLowerCase() }, now);
  }
}

export function proposePayeeAdd(db: DB, id: string, by: Actor, now = new Date()): ProposalRow {
  closeDeadAdds(db, now);
  const r = row(db, id);
  if (r.status !== "VERIFIED" || !r.verification_json) throw new Error(`${id} is not verified by a person yet; nothing to propose`);
  if (onFile(db).some((b) => b.name.trim() === r.vendor)) throw new Error(`${r.vendor} is on file already`);
  const proposedBank: PayeeBank = r.details_json ? JSON.parse(r.details_json) as PayeeBank : legacyPayeeBank(r.vendor, r.iban, r.bic);
  const taken = accountOnFile(db, ibanSha(accountKey(proposedBank)));
  if (taken) throw new Error(`this account is already on file for ${taken}; one account is never added under a second name`);
  const v = JSON.parse(r.verification_json) as { by: string; how: string; at: string; address: Address };
  const bank: PayeeBank = r.details_json ? JSON.parse(r.details_json) as PayeeBank : legacyPayeeBank(r.vendor, r.iban, r.bic);
  const terms: PayeeAddTerms = {
    schema: TERMS_SCHEMA, kind: "payee_add", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + PAYEE_ADD_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    add_id: id, vendor: r.vendor, iban: r.iban, bic: r.bic, bank, account: maskAccount(bank), address: v.address, verification: { by: v.by, how: v.how, at: v.at },
  };
  const p = createProposal(db, { terms, createdBy: by }, now);
  db.prepare("UPDATE payee_adds SET status = 'PROPOSED', proposal_id = ? WHERE add_id = ?").run(p.proposal_id, id);
  return p;
}

/**
 * After approval: the account is added at Airwallex for its route (beneficiary create with the approved bank details)
 * and to the suppliers on file with that route; the invoices waiting for it are checked again.
 */
export async function executePayeeAdd(db: DB, rail: PayoutRail, proposalId: string, inbox: Pick<InboxDeps, "now" | "sink" | "claude"> & { reader?: InboxDeps["reader"] } = {}, now = new Date()): Promise<void> {
  const t = beginExecution<PayeeAddTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "payee_add") throw new Error(`${proposalId} is not a new supplier`);
    if (onFile(db).some((b) => b.name.trim() === terms.vendor)) throw new Error(`${terms.vendor} is on file already; nothing was added`);
    const bank = terms.bank ?? legacyPayeeBank(terms.vendor, terms.iban, terms.bic);
    const taken = accountOnFile(db, ibanSha(accountKey(bank)));
    if (taken) throw new Error(`this account is already on file for ${taken}; nothing was added under a second name`);
  }, now);
  // Terms approved before the payout routes carry only the IBAN and BIC the CFO saw: their route is the IBAN's own.
  let bank: PayeeBank;
  try {
    bank = t.bank ?? legacyPayeeBank(t.vendor, t.iban, t.bic);
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message }, now);
    throw new Error(`${(e as Error).message}; nothing was added`, { cause: e });
  }
  // The approved details are checked again against the route before anything is sent (the table may have changed).
  const route = chooseRoute(bank);
  const wrong = route.ok ? validateDetails(bank, route.route) : [route.reason];
  if (wrong.length || !route.ok || route.route.method !== bank.method) {
    const error = wrong.length ? wrong.join("; ") : `the route for these details is now ${route.ok ? route.route.method : "none"}, not the approved ${bank.method}`;
    finishExecution(db, proposalId, "FAILED", { error }, now);
    throw new Error(`${error}; nothing was added`);
  }
  const wanted = {
    name: t.vendor, method: bank.method, ...(bank.clearing ? { clearing: bank.clearing } : {}),
    address: { ...t.address, countryCode: bank.country },
    bank: {
      country: bank.country, currency: bank.currency, accountName: bank.accountName,
      ...(bank.iban ? { iban: bank.iban } : {}), ...(bank.accountNumber ? { accountNumber: bank.accountNumber } : {}),
      ...(bank.routingType && bank.routingValue ? { routingType: bank.routingType, routingValue: bank.routingValue } : {}),
      ...(bank.swiftCode ? { swiftCode: bank.swiftCode } : {}),
    },
  };
  let ben: { id: string };
  try {
    // An earlier create whose answer was lost may have made it: that beneficiary is adopted, never a second one made.
    const found = await rail.findPayoutBeneficiary(wanted);
    if (found) audit(db, "awx-executor", "payee.adopted", t.add_id, { vendor: t.vendor, beneficiary_id: found.id, proposal_id: proposalId }, now);
    ben = found ?? await rail.createPayoutBeneficiary(wanted);
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message }, now);
    throw e;
  }
  const key = accountKey(bank);
  const details = { country: bank.country, method: bank.method, clearing: bank.clearing, account: maskAccount(bank), account_key_sha256: ibanSha(key) };
  db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)")
      .run(ben.id, t.vendor, key.replace(/[^A-Z0-9]/gi, "").slice(-4), ibanSha(key), bank.swiftCode ?? "", bank.currency, bank.method, JSON.stringify(details));
    db.prepare("UPDATE payee_adds SET status = 'APPLIED' WHERE add_id = ?").run(t.add_id);
    audit(db, "awx-executor", "payee.added", t.add_id, { vendor: t.vendor, account: details.account, currency: bank.currency, method: bank.method, beneficiary_id: ben.id, proposal_id: proposalId }, now);
    finishExecution(db, proposalId, "EXECUTED", { beneficiary_id: ben.id }, now);
  }).immediate();
  // A process may stop here: the supplier is on file, its invoices not yet checked again (the autopilot checks them).
  await checkpoint("ap.vendor:added");
  await recheck(db, inbox);
}

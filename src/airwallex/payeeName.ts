// Airwallex's account verification for a new payee (POST /beneficiaries/verify_account; docs: payouts/beneficiaries/
// verify-a-beneficiary-account, read 12 November 2026): the payee's bank says whether the account exists and whether
// the name on it matches the name we would pay (Verification of Payee for SEPA, Confirmation of Payee in the UK).
//
// Purser asks it before the CFO is asked (AIRWALLEX_PAYEE_CHECK=on; off by default): between a person's call-back to
// the supplier and the payee_add / payee_change proposal. A mismatch, a closed account or an unanswered check refuses
// the proposal outright, so the CFO's phone never shows it; the answer the CFO does see goes into the signed terms.
// It never moves money and never creates a beneficiary.
//
// Answer codes (docs): VERIFIED (the account is valid, whatever the name), INVALID (does not exist or closed),
// CANNOT_VERIFY, EXTERNAL_SERVICE_UNAVAILABLE. Name results: FULL_MATCH, PARTIAL_MATCH, NOT_MATCHED,
// FULL_MATCH_INCORRECT_TYPE, PARTIAL_MATCH_INCORRECT_TYPE. Coverage per the docs: SEPA countries, the UK, Viet Nam,
// LOCAL transfers only.

import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import type { Airwallex } from "./client.js";

export const PAYEE_CHECK_FLAG = "AIRWALLEX_PAYEE_CHECK";
export const payeeCheckOn = (env: Record<string, string | undefined> = process.env): boolean => env[PAYEE_CHECK_FLAG] === "on";

/** The account to check, as Purser holds it (src/payouts/routes.ts BankDetails). */
export interface AccountToCheck {
  name: string;
  entity: "COMPANY" | "PERSONAL";
  country: string;
  currency: string;
  iban?: string;
  accountNumber?: string;
  routingType?: string;
  routingValue?: string;
}

export interface NameCheck {
  code: string;
  match: string | null;
  resolvedName: string | null;
  resolvedBank: string | null;
}

export interface PayeeNameVerifier {
  verifyAccount(a: AccountToCheck): Promise<NameCheck>;
}

/** What a check means for the proposal. Only VERIFIED with FULL_MATCH, or a bank that cannot verify (labelled), proceeds. */
export function nameCheckVerdict(c: NameCheck, name: string): { proceed: boolean; label: string } {
  if (c.code === "VERIFIED" && c.match === "FULL_MATCH") return { proceed: true, label: "the payee's bank confirmed the account and the name" };
  if (c.code === "VERIFIED" && c.match) {
    const held = c.resolvedName ? ` as "${c.resolvedName}"` : "";
    return { proceed: false, label: `the payee's bank holds this account${held}, not as "${name}" (${c.match}); confirm with the supplier on a known contact before it is proposed` };
  }
  if (c.code === "VERIFIED") return { proceed: false, label: "the payee's bank confirmed the account but gave no name result; not proposed" };
  if (c.code === "INVALID") return { proceed: false, label: "the payee's bank says this account does not exist or is closed; not proposed" };
  if (c.code === "CANNOT_VERIFY") return { proceed: true, label: "the payee's bank could not verify the account or the name (shown to the CFO)" };
  if (c.code === "EXTERNAL_SERVICE_UNAVAILABLE") return { proceed: false, label: "the payee's bank did not answer the check; try again later, nothing is proposed" };
  return { proceed: false, label: `unknown answer ${c.code}; not proposed` };
}

/** verify_account's body (the guide's example: transfer_method LOCAL, entity_type, bank_details). */
export function verifyBody(a: AccountToCheck): Record<string, unknown> {
  const bank_details: Record<string, string> = { account_name: a.name, bank_country_code: a.country, account_currency: a.currency };
  if (a.iban) bank_details.iban = a.iban.replace(/\s+/g, "").toUpperCase();
  if (a.accountNumber) bank_details.account_number = a.accountNumber;
  if (a.routingType && a.routingValue) { bank_details.account_routing_type1 = a.routingType; bank_details.account_routing_value1 = a.routingValue; }
  return { transfer_method: "LOCAL", entity_type: a.entity, bank_details };
}

export class AirwallexPayeeNameRest implements PayeeNameVerifier {
  constructor(private readonly api: Airwallex) {}
  async verifyAccount(a: AccountToCheck): Promise<NameCheck> {
    const r = await this.api.call<{ code?: string; details?: { account_name_match_result?: string; resolved_account_name?: string; resolved_bank_name?: string } | null }>("POST", "/beneficiaries/verify_account", verifyBody(a));
    return { code: r?.code ?? "UNKNOWN", match: r?.details?.account_name_match_result ?? null, resolvedName: r?.details?.resolved_account_name ?? null, resolvedBank: r?.details?.resolved_bank_name ?? null };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** In memory, for tests: accounts by IBAN with the name the bank holds. Never a live run. */
export class FakePayeeNames implements PayeeNameVerifier {
  accounts = new Map<string, { name: string; entity: "COMPANY" | "PERSONAL"; bank: string }>();
  calls = 0;
  /** The next answer is this code (CANNOT_VERIFY, EXTERNAL_SERVICE_UNAVAILABLE). */
  nextCode: string | null = null;
  async verifyAccount(a: AccountToCheck): Promise<NameCheck> {
    this.calls++;
    if (this.nextCode) { const code = this.nextCode; this.nextCode = null; return { code, match: null, resolvedName: null, resolvedBank: null }; }
    const acct = this.accounts.get((a.iban ?? a.accountNumber ?? "").replace(/\s+/g, "").toUpperCase());
    if (!acct) return { code: "INVALID", match: null, resolvedName: null, resolvedBank: null };
    const same = norm(acct.name) === norm(a.name);
    const partial = !same && (norm(acct.name).includes(norm(a.name)) || norm(a.name).includes(norm(acct.name)));
    const base = same ? "FULL_MATCH" : partial ? "PARTIAL_MATCH" : "NOT_MATCHED";
    const match = base !== "NOT_MATCHED" && acct.entity !== a.entity ? `${base}_INCORRECT_TYPE` : base;
    return { code: "VERIFIED", match, resolvedName: acct.name, resolvedBank: acct.bank };
  }
}

/** The key a check is filed under: the payee's name and the exact account, so a check never covers another account. */
export function checkKey(name: string, accountKey: string): string {
  return sha256Hex(`kit11 payee-name v1 ${name.trim()} ${accountKey.replace(/\s+/g, "").toUpperCase()}`);
}

export interface NameCheckRow { check_key: string; vendor: string; code: string; match: string | null; resolved_name: string | null; proceed: number; label: string; checked_at: string }

/** Asks Airwallex and records the answer in the ledger (once per call; the latest answer counts). */
export async function runNameCheck(db: DB, v: PayeeNameVerifier, a: AccountToCheck & { accountKey: string }, by: Actor, now = new Date()): Promise<NameCheckRow> {
  const c = await v.verifyAccount(a);
  const verdict = nameCheckVerdict(c, a.name);
  const key = checkKey(a.name, a.accountKey);
  db.prepare(`INSERT INTO payee_name_checks (check_key, vendor, code, match, resolved_name, proceed, label, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(check_key) DO UPDATE SET code = excluded.code, match = excluded.match, resolved_name = excluded.resolved_name, proceed = excluded.proceed, label = excluded.label, checked_at = excluded.checked_at`)
    .run(key, a.name, c.code, c.match, c.resolvedName, verdict.proceed ? 1 : 0, verdict.label, now.toISOString());
  audit(db, by, verdict.proceed ? "payee.name_checked" : "payee.name_check_refused", a.name, { code: c.code, match: c.match, proceed: verdict.proceed, label: verdict.label }, now);
  return db.prepare("SELECT * FROM payee_name_checks WHERE check_key = ?").get(key) as NameCheckRow;
}

/** How long a check stands before the proposal must ask again. */
export const NAME_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The gate a payee proposal passes with AIRWALLEX_PAYEE_CHECK=on: a recorded check of exactly this name and account,
 * from the last day, that proceeds. Returns what goes into the signed terms, or throws why nothing is proposed. With
 * the flag off it returns null and the terms are as before (their hash unchanged).
 */
export function nameCheckGate(db: DB, name: string, accountKey: string, now = new Date(), env: Record<string, string | undefined> = process.env): { code: string; match: string | null; label: string; checked_at: string } | null {
  if (!payeeCheckOn(env)) return null;
  const r = db.prepare("SELECT * FROM payee_name_checks WHERE check_key = ?").get(checkKey(name, accountKey)) as NameCheckRow | undefined;
  if (!r) throw new Error(`the account of ${name} was not checked with the payee's bank yet (Airwallex account verification); nothing is proposed`);
  if (Date.parse(r.checked_at) + NAME_CHECK_TTL_MS <= now.getTime()) throw new Error(`the bank check of ${name}'s account is older than a day; check again before it is proposed`);
  if (!r.proceed) throw new Error(`${r.label}`);
  return { code: r.code, match: r.match, label: r.label, checked_at: r.checked_at };
}

// A second key for high-risk payments (13 Nov, Max's decision: "MFA should be deactivated but be there as an option for
// high risk transfers in combination with passkey or yubikey"). Off until the CFO switches on a trigger in the policy:
//   approval.second_key_eur           an amount (in euros) at or above which a payment is high-risk; empty: off
//   approval.second_key_new_payee     on: a payee first paid less than 30 days ago (or never) is high-risk
//   approval.second_key_bank_changed  on: a payee whose bank details changed since its last payment is high-risk
//   approval.second_key_new_country   on: a payee in a country no earlier payment went to is high-risk
// A high-risk payment is approved only when the same approver has signed its exact terms hash with two DIFFERENT
// WebAuthn credentials: their platform passkey (Face ID or Touch ID) and a security key they registered as
// cross-platform (USB or NFC, such as a YubiKey; src/passkey/securityKey.ts). With either alone it keeps waiting. Both
// assertions sign the same challenge, derived from the terms hash (src/passkey/webauthn.ts challengeFor): nothing new.
// A security key never approves on its own, and never anything that is not high-risk.
//
// These are policy keys like any other: switching one on or tightening it may come from the phone; switching one off
// loosens the policy, which is proposed on the runner and approved with Face ID (src/policy/loosens.ts).

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { supplierPaymentEur } from "./fourEyes.js";

export const SECOND_KEY_EUR = "approval.second_key_eur";
export const SECOND_KEY_NEW_PAYEE = "approval.second_key_new_payee";
export const SECOND_KEY_BANK_CHANGED = "approval.second_key_bank_changed";
export const SECOND_KEY_NEW_COUNTRY = "approval.second_key_new_country";
export const SECOND_KEY_KEYS = [SECOND_KEY_EUR, SECOND_KEY_NEW_PAYEE, SECOND_KEY_BANK_CHANGED, SECOND_KEY_NEW_COUNTRY] as const;
/** A payee is new for this long after its first payment. */
export const NEW_PAYEE_DAYS = 30;

/** What /security says about it, word for word (src/redesign/security.ts reads it from here). */
export const SECOND_KEY_COPY = {
  title: "Optional: a second key for high-risk payments",
  line: "Off by default; switched on, a high-risk payment needs Face ID and a security key.",
  how: "The CFO picks the triggers (an amount, a new payee, bank details changed, a new country); the same approver then signs the same terms hash with their passkey and a security key, two different keys, or the payment keeps waiting.",
  tested: "Tested with a virtual security key (Chromium's WebAuthn test authenticator and a software one); no physical YubiKey was tested live.",
} as const;

/** The tables, made where they are first needed (the runner's ledger and an engine's Durable Object alike). */
export const SECOND_KEY_TABLES = `
CREATE TABLE IF NOT EXISTS security_keys (
  credential_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  transports TEXT,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  label TEXT NOT NULL,
  aaguid TEXT,
  registration_json TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED'))
);
CREATE TABLE IF NOT EXISTS security_key_windows (
  window_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'USED', 'CLOSED'))
);
CREATE TABLE IF NOT EXISTS second_factors (
  proposal_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  person TEXT NOT NULL,
  factor TEXT NOT NULL CHECK (factor IN ('passkey', 'security_key')),
  terms_sha256 TEXT NOT NULL,
  assertion_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, credential_id, terms_sha256)
);
-- A security key's verified signature over a proposal's terms (passkey_assertions holds passkeys' own), kept for verify.
CREATE TABLE IF NOT EXISTS security_key_assertions (
  assertion_sha256 TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  assertion_json TEXT NOT NULL,
  counter INTEGER NOT NULL,
  verified_at TEXT NOT NULL
);`;
export function ensureSecondKeyTables(db: DB): void { db.exec(SECOND_KEY_TABLES); }

const setting = (db: DB, key: string): string => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? "";

/** Whether any trigger is on: the rule as a whole. */
export function secondKeyOn(db: DB): boolean {
  return /^\d+\.\d{2}$/.test(setting(db, SECOND_KEY_EUR)) || [SECOND_KEY_NEW_PAYEE, SECOND_KEY_BANK_CHANGED, SECOND_KEY_NEW_COUNTRY].some((k) => setting(db, k) === "on");
}

interface PaymentTerms { kind?: string; vendor?: string; amount?: string; currency?: string; beneficiary_id?: string; iban_last4?: string; bic?: string; account?: string; clearing?: string | null }
type Paid = PaymentTerms & { first_at: string };

/** The bank details a payment names, as one comparable string. */
const bankOf = (t: PaymentTerms) => (t.kind === "invoice_payment" ? `${t.iban_last4 ?? ""}|${t.bic ?? ""}` : `${t.account ?? ""}|${t.clearing ?? ""}`);
/** The payee's country: from the BIC (letters 5 and 6) or the beneficiary's recorded details. */
function countryOf(db: DB, t: PaymentTerms): string | null {
  if (t.bic && /^[A-Z]{4}[A-Z]{2}/.test(t.bic)) return t.bic.slice(4, 6);
  if (!t.beneficiary_id) return null;
  try {
    const row = db.prepare("SELECT details_json FROM beneficiaries WHERE beneficiary_id = ?").get(t.beneficiary_id) as { details_json?: string | null } | undefined;
    const c = row?.details_json ? (JSON.parse(row.details_json) as { country?: unknown }).country : null;
    return typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : null;
  } catch { return null; }
}
const samePayee = (a: PaymentTerms, b: PaymentTerms) => (a.beneficiary_id && b.beneficiary_id ? a.beneficiary_id === b.beneficiary_id : !!a.vendor && a.vendor === b.vendor);

/** Every payment that was paid (EXECUTED), with when it was approved, oldest first. */
function paidBefore(db: DB): Paid[] {
  const rows = db.prepare(`SELECT p.terms_json, COALESCE(MIN(a.created_at), p.created_at) AS first_at FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id AND a.decision = 'APPROVED'
    WHERE p.status = 'EXECUTED' AND p.kind IN ('invoice_payment', 'supplier_payment') GROUP BY p.proposal_id ORDER BY first_at`).all() as { terms_json: string; first_at: string }[];
  return rows.map((r) => ({ ...(JSON.parse(r.terms_json) as PaymentTerms), first_at: r.first_at }));
}

/** Why one payment is high-risk, in words for the approval page; empty when it is not (or the rule is off). */
function reasonsOfPayment(db: DB, t: PaymentTerms, now: Date, paid: Paid[]): string[] {
  const out: string[] = [];
  const eur = setting(db, SECOND_KEY_EUR);
  if (/^\d+\.\d{2}$/.test(eur)) {
    const v = supplierPaymentEur(JSON.stringify(t));
    // No euro value in the terms counts as over, as four eyes does.
    if (v === null || toCents(v) >= toCents(eur)) out.push(`amount at or above EUR ${eur}`);
  }
  const mine = paid.filter((x) => samePayee(x, t));
  if (setting(db, SECOND_KEY_NEW_PAYEE) === "on") {
    const first = mine[0]?.first_at;
    if (!first || now.getTime() - Date.parse(first) < NEW_PAYEE_DAYS * 86_400_000) out.push(first ? `new payee (first paid less than ${NEW_PAYEE_DAYS} days ago)` : "new payee (never paid before)");
  }
  if (setting(db, SECOND_KEY_BANK_CHANGED) === "on") {
    const last = mine[mine.length - 1];
    let changed = !!last && bankOf(last) !== bankOf(t);
    // A change of bank details applied for this supplier since its last payment (E3) counts too.
    if (!changed && t.vendor) {
      try {
        changed = !!db.prepare("SELECT 1 FROM payee_changes WHERE vendor = ? AND status = 'APPLIED' AND created_at > ?").get(t.vendor, last?.first_at ?? "");
      } catch { /* no payee changes table: nothing changed */ }
    }
    if (changed) out.push("bank details changed");
  }
  if (setting(db, SECOND_KEY_NEW_COUNTRY) === "on") {
    const c = countryOf(db, t);
    if (!c || !paid.some((x) => countryOf(db, x) === c)) out.push(c ? `new country (${c})` : "new country (unknown)");
  }
  return out;
}

/** Why a proposal is high-risk; empty when it is not. A batch is high-risk when any of its lines is. */
export function secondKeyReasons(db: DB, p: { kind: string; terms_json: string }, now = new Date()): string[] {
  if (!secondKeyOn(db)) return [];
  const paid = paidBefore(db);
  if (p.kind === "invoice_payment" || p.kind === "supplier_payment") return reasonsOfPayment(db, JSON.parse(p.terms_json) as PaymentTerms, now, paid);
  if (p.kind === "payment_batch") {
    const lines = (JSON.parse(p.terms_json) as { lines?: { kind: string; terms: PaymentTerms }[] }).lines ?? [];
    return [...new Set(lines.flatMap((l) => (l.kind === "invoice_payment" || l.kind === "supplier_payment" ? reasonsOfPayment(db, { ...l.terms, kind: l.kind }, now, paid) : [])))];
  }
  return [];
}

/** The approval page's sentence: why, and what to touch next. */
export function secondKeyMessage(reasons: string[], has: { passkey: boolean; securityKey: boolean }): string {
  const why = `High-risk: ${reasons.join("; ")}.`;
  if (has.passkey && !has.securityKey) return `${why} Touch your security key.`;
  if (has.securityKey && !has.passkey) return `${why} Approve with Face ID too.`;
  return `${why} It needs your Face ID and your security key.`;
}

/** What a person has signed so far for these exact terms. */
export function factorsOf(db: DB, proposalId: string, termsSha256: string, person: string): { passkey: string | null; securityKey: string | null } {
  ensureSecondKeyTables(db);
  const rows = db.prepare("SELECT credential_id, factor FROM second_factors WHERE proposal_id = ? AND terms_sha256 = ? AND person = ?").all(proposalId, termsSha256, person) as { credential_id: string; factor: string }[];
  return { passkey: rows.find((r) => r.factor === "passkey")?.credential_id ?? null, securityKey: rows.find((r) => r.factor === "security_key")?.credential_id ?? null };
}

/**
 * One factor of a high-risk approval, inside decide()'s transaction: refused when this credential already counted for
 * these terms (one key never counts twice); true once the person has both, each from a different credential.
 */
export function recordFactor(db: DB, a: { proposalId: string; termsSha256: string; person: string; credentialId: string; factor: "passkey" | "security_key"; assertionSha256: string }, now: Date): boolean {
  ensureSecondKeyTables(db);
  if (db.prepare("SELECT 1 FROM second_factors WHERE proposal_id = ? AND terms_sha256 = ? AND credential_id = ?").get(a.proposalId, a.termsSha256, a.credentialId)) {
    throw new Error(`this key already signed ${a.proposalId}; a high-risk payment needs your other key (Face ID and a security key, two different keys)`);
  }
  db.prepare("INSERT INTO second_factors (proposal_id, credential_id, person, factor, terms_sha256, assertion_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(a.proposalId, a.credentialId, a.person, a.factor, a.termsSha256, a.assertionSha256, now.toISOString());
  const f = factorsOf(db, a.proposalId, a.termsSha256, a.person);
  return !!f.passkey && !!f.securityKey && f.passkey !== f.securityKey;
}

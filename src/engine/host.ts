// One company's engine as a small set of actions on a ledger handle. The same class runs in the Node tests (on
// better-sqlite3) and in a Durable Object (on its own SQLite, through src/db/doSql.ts): it takes the ledger and its
// outside world as arguments and holds no state of its own beyond the order of its actions. Every call it makes is the
// engine's own, unchanged: the inbox reads and checks an upload (src/ap/inbox.ts), the payment is filed for approval
// (src/ap/pay.ts), a passkey signs the exact terms (src/passkey), the executor pays on the rails it is handed
// (src/executors), then the payment is followed, booked (src/ledger/feed.ts) and archived (src/vault).
//
// What the host adds is small: one action at a time, the passkey's confirmation (a signed-in person is the confirmation
// a person gives on a runner, for a company's first key; a later key needs an active key's endorsement, a second owner
// or a recovery, then cools off: passkeyFinish), and what a page needs to show of an invoice, a proposal and the events.
//
// It has no payables folder: the ledger must have its own document store (src/ap/docStore.ts useDocStore) before a
// host is made over it, so no file is ever written.
import type Anthropic from "@anthropic-ai/sdk";
import { measuredSwiftFeesCents, seedTreasury, treasuryState } from "../agents/euroBill.js";
import { cashCheck, type CashView } from "../ap/cashCheck.js";
import { feeReserveCents } from "../policy/treasury.js";
import { toCents } from "../lib/money.js";
import { limitRule, payableAccount } from "../ap/checkerCore.js";
import { aloneLimit, fxMarkupLimitBps, getSetting, setSetting } from "../world/settings.js";
import { setSystemDefaultAloneLimit } from "../policy/aloneLimit.js";
import { actionsFor } from "../ap/detail.js";
import { SEEDED_PAID_REASON } from "../ap/books.js";
import { docStoreOf } from "../ap/docStore.js";
import { clearPossibleDuplicate, ingestDocument, type IngestResult } from "../ap/inbox.js";
import { earlyPayer, payApInvoice, rejectApInvoice, syncPayments, type AloneDeclined, type PaidAlone } from "../ap/pay.js";
import type { EarlyPayer } from "../ap/payerAgent.js";
import type { Asker } from "../ap/read.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow } from "../ap/store.js";
import { invoiceKey } from "../lib/invoiceKey.js";
import { firstScreenFacts, isPayablesPayment, payablesFacts } from "../approve/client.js";
import { audit, verifyAuditChain } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { execute, type Rails } from "../executors/index.js";
import { verifyLedger } from "../ledger/core.js";
import { syncLedger } from "../ledger/feed.js";
import { fromCents } from "../lib/money.js";
import { confirmPasskey, activePasskey, openEnrolment, passkeyById, pendingPasskeys } from "../passkey/ledger.js";
import { sealRefusal } from "../passkey/seal.js";
import { processAssertion, processRegistration, type InboxItem } from "../passkey/process.js";
import { finishSecurityKey, startSecurityKey } from "../passkey/securityKey.js";
import { ensureSecondKeyTables, SECOND_KEY_KEYS, secondKeyMessage, secondKeyReasons } from "../policy/secondKey.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { policyValue } from "../policy/rules.js";
import { STOP_KEY, stopState, type StopState } from "../policy/emergencyStop.js";
import { isBlocked } from "../policy/blocked.js";
import { challengeFor, verifyApprovalSignature } from "../passkey/webauthn.js";
import { phonePhrases, t } from "../ui/i18n.js";
import { syncVault, type YearIndex } from "../vault/build.js";
import { closedPeriods, invoiceDocs, receipts } from "../vault/data.js";
import { yearIndexPath } from "../vault/layout.js";
import { sha256, type VaultSink } from "../vault/sink.js";
import { actionBudget, type ClaudeAccess } from "./budget.js";
import { publicEvent, type EngineEvent, type EventRow } from "./events.js";
import { invoicePdf } from "./invoicePdf.js";
import { BILL_TO_SAMPLE, CASH_COMMITTED, CASH_SAMPLE, CLEAN, CLEAN_SAMPLE, checkCompose, PAID_SAMPLE, SEEDED_SUPPLIERS, supplierKey, type ComposeInput, type InvoiceFields, type ComposeRefusal, type Sample, type SupplierOnFile } from "./tryWorld.js";
import { ibanSha } from "../agents/invoice.js";
import { canonicalTerms, sha256Hex, termsHash, type Terms } from "../lib/terms.js";
import { proofBundle } from "./proofBundle.js";
import type { ProofBundle } from "../proof/bundle.js";
import { recordsPdf } from "./recordsPdf.js";
import { beginExecution } from "../policy/approvals.js";
import { batchesFor } from "../cloudsync/client.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import { payApInvoices } from "../ap/batchPay.js";
import { FakePayeeNames, STAND_IN_LABEL, type PayeeNameVerifier } from "../airwallex/payeeName.js";
import { matchReceipt } from "../agents/receivables.js";

/** The reader that always takes the parser: no model is asked, and the invoice says it was read by the parser. */
export const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no model is asked: the parser reads" }) } as Asker;

/** What an action hands the payables agents (task A6): whether they run, and their client within the action's budget (null: code decides, labelled). */
interface ActionAgents { on: boolean; client: Anthropic | null }

export interface EngineDeps {
  /** The company's ledger, with its own document store (useDocStore). */
  db: DB;
  reader: Asker;
  /** The payment rails: the stand-in bank on test money (src/engine/standInBank.ts). */
  rails: Rails;
  /** Called after an action that used the rails (the seed, a filed payment, an executed one): the host of a stand-in bank saves it here. */
  afterMoney?: () => void;
  /** The passkey's relying party: the deployment's host name and origin. */
  rp: { rpId: string; origin: string };
  company: { name: string; lang: "en" | "nl" };
  /** Where the archive is written; null: nothing is archived. */
  vault: VaultSink | null;
  /** Brings the cloud's read model up to the ledger (src/engine/feed.ts); null: nothing is fed. */
  feed: ((db: DB, now: Date) => Promise<unknown>) | null;
  now?: () => Date;
  /** The hands-on demo's sample invoices (cloud/src/engine/samples.gen.ts); absent: none. */
  samples?: readonly Sample[];
  /** At most this many documents in the company's ledger, whatever route brings them (8 for a try company); absent: no limit. */
  maxDocuments?: number;
  /**
   * Claude under caps (src/engine/budget.ts): each action that may ask Claude reserves its ceiling first, reads within
   * it, and settles to what it cost; refused, the parser reads and a claude.capped row says why. Absent: `reader` reads.
   */
  claude?: ClaudeAccess;
  /**
   * Whether Pay asks Claude for the advisory review note beside the proposal (default true). The hands-on demo says no
   * (speed, 12 Nov): code writes the note, and the Payer agent's own reason is already on the screen.
   */
  reviewNoteOnPay?: boolean;
  /**
   * The Payer, early (speed, 13 Nov): once an invoice is filed ready to pay, the Payer proposes in the background, and Pay
   * uses that answer when its plan is the same case (startEarlyPayer). Default false; the cloud's Worker turns it on.
   */
  earlyPayer?: boolean;
  /**
   * The hands-on demo (try-fixes, 13 Nov): the test company starts with one invoice already paid, the PDF of the sample
   * keyed `paid` (a supplier's earlier invoice), so the two duplicate samples meet a paid original and are caught.
   * Filed through the inbox with the parser (no model), then marked paid before the visitor arrived: no money moved
   * for it on the simulated bank, and the audit row says so. Default false; only a try company turns it on.
   */
  seedPaid?: boolean;
  /**
   * Who asks the payee's bank whether a new supplier's account carries its name (Purser Cloud: Airwallex's
   * verify_account through the gateway, falling back to the labelled stand-in). Absent: the stand-in, labelled
   * "stand-in, test world: no bank was asked" wherever its answer is shown.
   */
  payeeVerifier?: () => PayeeNameVerifier;
  /**
   * This company's FX limit (basis points over the market's current rate a locked quote may cost), written by the seed
   * as its setting fx.max_markup_bps. Absent: FX_QUOTE_MAX_MARKUP_BPS. Only a try company sets it (TRY_FX_QUOTE_MAX_MARKUP_BPS).
   */
  fxMarkupBps?: number;
  /**
   * The CFO's limit an agent may pay a supplier invoice alone up to (owner, 16 Nov), written by the seed as the company's
   * setting ap.alone_eur, labelled in the record as a system default the CFO did not sign (src/policy/aloneLimit.ts).
   * Absent: none unless the CFO signs one, and the CFO signs every invoice. Only a try company sets it (TRY_ALONE_LIMIT).
   */
  aloneLimit?: { currency: "EUR"; amount: string };
}

/** What an upload, a sample or a composed invoice answers. */
export interface UploadResult {
  kind: string; sha256: string; invoice: InvoiceView | null;
  /**
   * 17 Nov: an invoice ready to pay inside the agent's limit: its financial context and code's cash check (src/ap/cashCheck.ts),
   * read from the company's ledger and bank now. outcome hold: the agent does not pay it alone, and nothing is sent.
   */
  cash?: CashView;
}

export interface ProposalView {
  id: string;
  kind: string;
  status: string;
  terms_sha256: string;
  /** What the passkey signs: the WebAuthn challenge of exactly these terms. */
  challenge: string;
  /** What the phone's approval page shows of the terms, in the company's language. */
  facts: [string, string][];
  /** What the phone's approval page warns about (a payee that is not the supplier, an amount that is not on the invoice). */
  warnings: string[];
  /**
   * A high-risk payment (src/policy/secondKey.ts), while it waits: why, what the page says, which security keys may sign
   * (their credential ids, for allowCredentials), and which of the two keys have signed these terms so far.
   */
  second_key?: { reasons: string[]; message: string; security_keys: string[]; signed: { passkey: boolean; security_key: boolean } };
}

/**
 * One check's finding, in the engine's words, with the evidence that triggered it (14 Nov, owner: /try shows why, big
 * and first): the earlier invoice a copy matches (`earlier`, from `of` or `twin_of`), and for possible fraud the signals
 * with what the invoice asks beside what is on file.
 */
export interface FindingView {
  level: string; code: string; message: string;
  twin_of?: string;
  signals?: { code: string; detail: string; asked?: string; on_file?: string }[];
  earlier?: { id: string; vendor: string; invoice_no: string; currency: string; total: string; issue_date: string; paid_at: string | null; status: string; status_words: string };
}

export interface InvoiceView {
  id: string; status: string; status_words: string; payable: boolean; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; read_by: string;
  /** The invoice's own date and, once paid, when (14 Nov: /try's held answer shows when the earlier copy was paid). */
  issue_date?: string; paid_at?: string | null;
  /** When it came in (14 Nov: /try's finish says how long from upload to paid, from these two). */
  received_at?: string;
  findings: FindingView[];
  /**
   * 14 Nov (jury): the checks code ran on this invoice that left no finding, so a page lists what was checked, never a
   * fixed list. not_paid_before: a supplier and a number were read and no copy was found; bank_on_file and
   * known_supplier: bank details were read, matched the supplier on file and raised no fraud signal.
   */
  checks_passed?: ("not_paid_before" | "bank_on_file" | "known_supplier")[];
  doc_sha256: string;
  proposal: ProposalView | null;
  /**
   * 16 Nov: the company's limit to pay an invoice alone, and whether this invoice's total is within it (src/ap/checkerCore.ts
   * limitRule); null when the company sets none (the CFO signs every invoice). Within it, Pay lets the agent pay alone
   * when the agents and code's checks say pay (src/ap/pay.ts payAlone).
   */
  alone_limit?: { currency: string; amount: string; within: boolean } | null;
}

/** What a negotiation agreed, as the hands-on demo's route hands it to the engine (EngineHost.negotiated). */
export interface NegotiatedFacts {
  original_id: string | null; original_invoice_no: string; original_amount: string; agreement_sha256: string; turns: number;
  /** The agreement's canonical JSON (its SHA-256 is agreement_sha256), every signed offer's SHA-256 in order, and the agents' key ids: kept with the proof. */
  agreement?: string; offers?: string[]; keys?: { sourcing: string; supplier: string };
}

/** The checks examine() (src/ap/checkerCore.ts) ran on an invoice that left no finding: InvoiceView.checks_passed. */
function checksPassed(inv: ApInvoiceRow): NonNullable<InvoiceView["checks_passed"]> {
  const codes = new Set(inv.findings.map((f) => f.code));
  const out: NonNullable<InvoiceView["checks_passed"]> = [];
  if (inv.vendor && inv.invoice_no && !["duplicate", "possible_duplicate", "rejected_before"].some((c) => codes.has(c))) out.push("not_paid_before");
  if (inv.vendor && payableAccount(inv.reading) !== null && !codes.has("possible_fraud") && !codes.has("new_supplier")) out.push("bank_on_file", "known_supplier");
  return out;
}

/** Where things stand after the payments were followed, booked, archived and fed. */
export interface Settled {
  /** After an approval: the invoice's status and its transfer's; null after a plain sync. */
  invoice_status: string | null;
  transfer_status: string | null;
  /** The entries the ledger holds now. */
  ledger_entries: number;
  /** The archive's new files, by path. */
  vault_added: string[];
  fed: boolean;
  /** What failed, in the engine's words; null when nothing did. */
  error: string | null;
}

/** A new supplier's bank check as a page shows it. */
export interface NameCheckView { vendor: string; code: string; match: string | null; label: string; checked_at: string; source: "airwallex" | "stand-in" }

export interface VaultFile { path: string; kind: string; bytes: number; sha256: string; added_at: string }

/** The inbox's folder argument. It is never used: the ledger has its own document store (checked when the host is made). */
const NO_FOLDER = "/purser-engine-has-no-folder";
/** Whose each passkey is, by the id the caller (the cloud) gives its person; the host's own table, as feed.ts keeps one. */
const PASSKEY_PEOPLE = "CREATE TABLE IF NOT EXISTS engine_passkey_people (credential_id TEXT PRIMARY KEY, person TEXT NOT NULL)";

// The approval key's life (review finding 2, 20 Nov). The first key of a company is enrolled as before: the signed-in
// person is the confirmation. A key added while one is active (another person's, or a replacement) needs more than a
// sign-in: an active approval key's signature over the new key's id and public-key hash (the endorsement), or the
// host's word that a second owner co-signed, or that the person's account was recovered by two platform admins. Such
// a key then waits a cooling-off before it approves anything, so every owner hears of it and can stop it first.
/** How each approval key was authorised and until when it may not approve; the host's own table, as PASSKEY_PEOPLE. */
const PASSKEY_TRUST = "CREATE TABLE IF NOT EXISTS engine_passkey_trust (credential_id TEXT PRIMARY KEY, how TEXT NOT NULL, by TEXT, enrolled_at TEXT NOT NULL, cooling_until TEXT)";
/** The default cooling-off of a key added by replacement, by endorsement or co-signature, or after a recovery. */
export const APPROVAL_KEY_COOLING_OFF_MS = 72 * 3_600_000;
export type KeyHow = "first" | "endorsed" | "cosigned" | "recovery";
/** What an active key signs to vouch for a new one: the new key's id and the SHA-256 of its public key (SPKI), and nothing else. */
export function endorsementHash(credentialId: string, spkiSha256: string): string {
  return sha256Hex(`purser.approval-key.endorse/v1\n${credentialId}\n${spkiSha256}`);
}
/** The WebAuthn challenge of that endorsement (base64url of the hash's 32 bytes, as a proposal's challenge is). */
export const endorsementChallenge = (credentialId: string, spkiSha256: string): string => challengeFor(endorsementHash(credentialId, spkiSha256));
export const ENDORSEMENT_REQUIRED = "An approval key is already active in this company: a new one counts only when an active approval key signs for it, or a second owner confirms it with their passkey.";
const HOW_WORDS: Record<KeyHow, string> = { first: "the company's first key", endorsed: "vouched for by an active key", cosigned: "confirmed by a second owner", recovery: "after an account recovery" };
const credentialIdOf = (c: unknown): string | null => (c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string" ? (c as { id: string }).id : null);

/** The answer to a new approval key. */
export type PasskeyFinished =
  | { ok: true; credential_id: string; how: KeyHow; by: string | null; cooling_until: string | null; replaced?: string }
  | { ok: false; reason: string; code?: "endorsement_required" | "endorsement_refused"; endorse?: { credential_id: string; spki_sha256: string; challenge: string; keys: string[] } };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** What the phone's approval page shows of these terms, in the company's language, and what it warns about. */
function termsFacts(terms: Record<string, unknown>, lang: "en" | "nl"): { facts: [string, string][]; warnings: string[] } {
  if (!isPayablesPayment(terms)) return { facts: firstScreenFacts(terms), warnings: [] };
  // The phone page's words come with the page (src/relay/assets.ts ships them as PURSER_PHRASES); here they are the same catalogue's.
  const g = globalThis as { PURSER_PHRASES?: unknown };
  g.PURSER_PHRASES ??= phonePhrases();
  const p = payablesFacts(terms, lang);
  const facts: [string, string][] = [[t(lang, "ph.amount"), p.amount], ...p.first, ...p.details];
  return { facts: facts.map(([k, v]): [string, string] => [k === t(lang, "ph.bank_fee") ? STAND_IN_FEE[lang] : k, v]), warnings: p.warnings };
}

/** The phone page's fee label (ph.bank_fee) names Airwallex; the host's bank is the stand-in, so its facts name that instead. */
const STAND_IN_FEE = { en: "Bank fee (stand-in bank, test money)", nl: "Bankkosten (nagebootste bank, testgeld)" } as const;

/**
 * A refused signature in plain words. The engine passes on the WebAuthn library's own sentence when the library
 * refuses (src/passkey/webauthn.ts): a person at the screen reads what was wrong instead, and that nothing was paid.
 * The engine's own refusals (written in our words: "this passkey is not enrolled", "P-0001 expired at ...") stay.
 */
/** The answer to a signature over other terms than the proposal's: the screens show it as it is. */
export const REFUSED_OTHER_TERMS = "This signature is over other terms than the ones on screen. Nothing was paid.";
/** An approval whose request names other terms than the proposal holds: refused before the signature is read. */
export const REFUSED_TERMS_NOT_ON_SCREEN = "The terms sent with this approval are not the ones on screen. Nothing was paid.";
const LIBRARY_REFUSALS: [RegExp, string][] = [
  [/^Unexpected authentication response challenge\b/, REFUSED_OTHER_TERMS],
  [/^Unexpected (authentication response origin|response origin|cross-origin|top origin)\b|^Detected cross-origin\b/, "This signature was made on another website than this one. Nothing was paid."],
  [/\bRP ID\b/, "This signature belongs to a passkey of another website. Nothing was paid."],
  [/^User (verification required|not present)\b/, "The passkey did not confirm it was you (Face ID, fingerprint or PIN). Nothing was paid."],
  [/^Response counter value\b/, "This signature is older than one this passkey already gave, so it may be a copy. Nothing was paid."],
];
/** The library's other refusals of a response it cannot read (@simplewebauthn/server verifyAuthenticationResponse). */
const LIBRARY_UNREADABLE = /^(Unexpected |Credential |Missing credential|ClientDataJSON |Custom challenge )/;
function plainRefusal(message: string): string {
  for (const [library, plain] of LIBRARY_REFUSALS) if (library.test(message)) return plain;
  return LIBRARY_UNREADABLE.test(message) ? "This signature could not be read. Nothing was paid." : message;
}

/** A proposal's terms as the hands-on demo's pay route shows them. */
export interface TermsView {
  proposal_id: string; status: string; terms: Terms; canonical: string; terms_sha256: string; approved: boolean; expires_at: string | null;
  /** Terms that convert: this company's FX limit (basis points over the market's current rate), as its checks applied it. */
  fx_limit_bps?: number;
}

/** What the one pay route answers; a layer that did not run says so (null). */
export interface PaySignedResult {
  outcome: "paid" | "refused" | "paid_once" | "not_signed" | "expired" | "failed";
  layers: { signature: { verified: boolean | null; reason: string }; executor: { accepted: boolean | null; said: string | null } };
  signed_sha256: string; sent_sha256: string; changed: string[]; transfers_before: number; transfers_after: number; settled: Settled | null;
  /** Paid or refused: the file anyone can check without our server (src/proof/bundle.ts); null when there is nothing to check. */
  proof?: ProofBundle | null;
}

/**
 * The keys the visitor may change on the pay screen ("Try to change it", 15 Nov: every field a person reads on the
 * approval sheet, not one preset): the amount and its currency, the payee, the account ending, the BIC and the invoice
 * number. Every other key must be the stored one. A change of any of them gives other terms, so another hash.
 */
export const CHANGEABLE_TERMS = ["amount", "currency", "beneficiary_name", "iban_last4", "bic", "invoice_no"] as const;

/** Why the sent terms cannot be tried at all (their shape), or null. */
function checkSent(stored: Record<string, unknown>, sent: Record<string, unknown>): string | null {
  const keys = Object.keys(stored).sort(), got = Object.keys(sent).sort();
  if (keys.length !== got.length || keys.some((k, i) => k !== got[i])) return "the terms must have exactly the keys of the signed terms";
  for (const k of keys) {
    if ((CHANGEABLE_TERMS as readonly string[]).includes(k)) continue;
    if (JSON.stringify(stored[k]) !== JSON.stringify(sent[k])) return "only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here";
  }
  if (typeof sent.currency !== "string" || !/^[A-Z]{3}$/.test(sent.currency)) return "the currency is three capital letters, such as EUR";
  if (typeof sent.bic !== "string" || !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(sent.bic)) return "the BIC is 8 or 11 capital letters or digits";
  if (typeof sent.invoice_no !== "string" || sent.invoice_no.length < 1 || sent.invoice_no.length > 64) return "the invoice number is 1 to 64 characters";
  if (typeof sent.amount !== "string" || !/^\d{1,9}\.\d{2}$/.test(sent.amount)) return "the amount is a number with two decimals, such as 1850.00";
  if (typeof sent.iban_last4 !== "string" || !/^[A-Za-z0-9]{4}$/.test(sent.iban_last4)) return "the account ending is four letters or digits";
  if (typeof sent.beneficiary_name !== "string" || sent.beneficiary_name.length < 1 || sent.beneficiary_name.length > 140) return "the payee is 1 to 140 characters";
  return null;
}

const firstInvoice = (r: IngestResult): ApInvoiceRow | null =>
  r.kind === "invoice" ? r.invoice : r.kind === "email" ? r.results.map(firstInvoice).find((i) => i !== null) ?? null : null;

export class EngineHost {
  private readonly deps: EngineDeps;
  /** The end of the last write: the next one starts after it. */
  private tail: Promise<unknown> = Promise.resolve();
  /** The Payer's early answers, by invoice, while they are worked out and once they are (startEarlyPayer). */
  private early = new Map<string, { done: boolean; value: EarlyPayer | null; settled: Promise<void> }>();

  constructor(deps: EngineDeps) {
    if (!docStoreOf(deps.db)) throw new Error("the engine host needs the ledger's own document store (useDocStore): it has no payables folder to write to");
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** One engine action at a time: a write starts when the one before it has ended, whether that one failed or not. */
  private act<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async status(): Promise<{
    mode: "test_money"; passkey: { credential_id: string; label: string } | null; balances: Record<string, string>; chains: { audit: boolean; ledger: boolean };
    /** Every active approval key: whose (the host's id for the person), how it was authorised, and until when it cools off. */
    passkeys: { credential_id: string; label: string; person: string | null; how: KeyHow; cooling_until: string | null }[];
    /** Who reads the next document: Claude (when the caps allow it), or the parser. */
    reader: "claude" | "parser";
    /** Who decides: the payables agents with Claude (when Claude may be asked), or code (task A6). */
    agents: "live" | "code";
    /**
     * What this company's Claude calls cost so far, in micro-USD at list price: as the caps count it where the cloud keeps
     * that (with calls counted at their worst case and reservations in flight), else this ledger's rows; and its cap.
     */
    spent_micros: number;
    cap_micros: number | null;
    /** The CFO's emergency stop (src/policy/emergencyStop.ts): on, nothing is paid; since when, by which approved proposal. */
    emergency_stop: StopState;
  }> {
    const { db, rails } = this.deps;
    const pk = activePasskey(db);
    const balances = await rails.rail.balances();
    const claude = this.deps.claude ? await this.deps.claude.status() : { on: false, cap_micros: null, spent_micros: null };
    db.exec(PASSKEY_PEOPLE);
    db.exec(PASSKEY_TRUST);
    const now = this.now();
    const keys = (db.prepare(`SELECT k.credential_id, k.label, p.person, t.how, t.cooling_until FROM passkeys k LEFT JOIN engine_passkey_people p ON p.credential_id = k.credential_id
      LEFT JOIN engine_passkey_trust t ON t.credential_id = k.credential_id WHERE k.status = 'ACTIVE' ORDER BY k.enrolled_at, k.credential_id`).all() as
      { credential_id: string; label: string; person: string | null; how: KeyHow | null; cooling_until: string | null }[])
      .map((k) => ({ credential_id: k.credential_id, label: k.label, person: k.person, how: k.how ?? "first", cooling_until: k.cooling_until && Date.parse(k.cooling_until) > now.getTime() ? k.cooling_until : null }));
    return {
      mode: "test_money",
      passkey: pk ? { credential_id: pk.credential_id, label: pk.label } : null,
      passkeys: keys,
      balances: Object.fromEntries(Object.entries(balances).map(([currency, b]) => [currency, fromCents(b?.availableCents ?? 0)])),
      chains: { audit: verifyAuditChain(db).ok, ledger: verifyLedger(db).ok },
      reader: claude.on ? "claude" : "parser", agents: claude.on && this.deps.claude?.agents ? "live" : "code", spent_micros: claude.spent_micros ?? claudeCost(db, 0), cap_micros: claude.cap_micros,
      emergency_stop: stopState(db),
    };
  }

  /**
   * One action that may ask Claude: its ceiling reserved first. Refused, the parser reads and a claude.capped row says
   * why. Reserved, `run` gets a reader spending from the action's budget, and afterwards the reservation is settled to
   * what the action's calls cost: the rows' costs, or what the budget counted (a call that failed after it was sent is
   * counted at its worst case), never more than the reservation. Without Claude access, the host's own reader reads.
   */
  private async withClaude<T>(task: string, run: (reader: Asker, agents: ActionAgents) => Promise<T>): Promise<T> {
    const { db, claude } = this.deps;
    // Task A6: the payables agents run wherever the engine has Claude access that offers them. Refused a reservation
    // (a switch, no key, a cap), they still run, with no client: each writes its run as unavailable and code's own
    // decision stands, labelled as the fallback.
    const agentsOn = !!claude?.agents;
    if (!claude) return run(this.deps.reader, { on: false, client: null });
    const got = await claude.reserve();
    if (!got.ok) {
      audit(db, "system", "claude.capped", task, { reason: got.reason });
      return run(parserOnly, { on: agentsOn, client: null });
    }
    const { micros, settle } = got.reservation;
    const budget = actionBudget(micros);
    const from = lastSeq(db);
    try {
      return await run(claude.reader(db, budget), { on: agentsOn, client: claude.agents?.(budget) ?? null });
    } finally {
      await settle(Math.min(micros, Math.max(claudeCost(db, from), micros - budget.left())));
    }
  }

  /**
   * The Payer, early (speed, 13 Nov; Max's yes): once an invoice is filed ready to pay, the Payer proposes on its plan
   * in the background (src/ap/pay.ts earlyPayer: nothing filed, locked or written but the agent's own run), so Pay can
   * read the finished answer instead of asking Claude while the visitor waits. Its Claude calls count against the same
   * caps, under their own reservation, and only with room to spare (cloud/src/engine/spend.ts: never when the day's cap,
   * the company's or the total is near). Not finished or failed when Pay comes: Pay runs the Payer as before. Outside the
   * action queue: it only reads, and its one write (the agent's run row) is a single statement.
   */
  private startEarlyPayer(invoiceId: string): void {
    const { db, claude, rails } = this.deps;
    if (!this.deps.earlyPayer || !claude?.agents || this.early.has(invoiceId)) return;
    const inv = apInvoice(db, invoiceId);
    if (!inv || inv.status !== "ready" || !actionsFor(inv).pay.allowed) return;
    // A company holds at most a few unpaid answers; the oldest goes first.
    if (this.early.size >= 16) this.early.delete(this.early.keys().next().value!);
    const slot: { done: boolean; value: EarlyPayer | null; settled: Promise<void> } = { done: false, value: null, settled: Promise.resolve() };
    this.early.set(invoiceId, slot);
    slot.settled = (async () => {
      try {
        const got = await claude.reserve({ spare: true });
        if (!got.ok) return;
        const { micros, settle } = got.reservation;
        const budget = actionBudget(micros);
        let cost = 0;
        try {
          slot.value = await earlyPayer(db, rails.rail, invoiceId, this.now(), claude.agents!(budget));
          cost = slot.value?.out.run.costMicros ?? 0;
        } finally {
          slot.done = true;
          await settle(Math.min(micros, Math.max(cost, micros - budget.left())));
        }
      } catch {
        slot.value = null;
      } finally {
        slot.done = true;
      }
    })();
  }

  /** The Payer's early answer for Pay, when it is finished; taken once. Not finished: null, and Pay runs the Payer itself. */
  private takeEarlyPayer(invoiceId: string): EarlyPayer | null {
    const slot = this.early.get(invoiceId);
    if (!slot) return null;
    this.early.delete(invoiceId);
    return slot.done ? slot.value : null;
  }

  /** Waits until every early Payer started so far has finished and settled (tests, and a host that is closing). */
  async earlySettled(): Promise<void> {
    await Promise.all([...this.early.values()].map((s) => s.settled));
  }

  /** The treasury's test money, floors and payees on the rails, once; safe to repeat. */
  seed(): Promise<void> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      const fx = this.deps.fxMarkupBps;
      if (fx !== undefined && getSetting(db, "fx.max_markup_bps", "") !== String(fx)) setSetting(db, "system", "fx.max_markup_bps", String(fx), this.now());
      const alone = this.deps.aloneLimit;
      // A test company's default limit to pay alone, labelled as one in the record (never over a limit the CFO signed).
      if (alone && alone.currency === "EUR") setSystemDefaultAloneLimit(db, alone.amount, this.now());
      try { await seedTreasury(db, rails.rail, rails.sim); } finally { this.deps.afterMoney?.(); }
      if (this.deps.seedPaid) await this.seedPaidOriginal();
    });
  }

  /** The try company's paid original (seedPaid): once, safe to repeat; it never moves money on the stand-in bank. */
  private async seedPaidOriginal(): Promise<void> {
    const { db } = this.deps;
    const s = (this.deps.samples ?? []).find((x) => x.key === PAID_SAMPLE);
    if (!s) return;
    const bytes = Buffer.from(s.base64, "base64");
    if (db.prepare("SELECT 1 FROM ap_documents WHERE sha256 = ?").get(sha256(bytes))) return;
    const now = this.now();
    const out = await ingestDocument(db, { dir: NO_FOLDER, reader: parserOnly, now: () => now, agents: false }, { bytes, filename: s.filename, mime: "application/pdf", source: "upload" });
    const inv = firstInvoice(out);
    if (inv) setStatus(db, inv.id, "paid", "system", { paid_at: now.toISOString(), reason: `${SEEDED_PAID_REASON} paid before this test company started (simulated, no money moved)` }, now);
  }

  /** A document through the inbox: filed, read and checked. What the inbox refuses (not a PDF, too large) is thrown. */
  upload(doc: { bytes: Uint8Array; filename: string; mime?: string }): Promise<UploadResult> {
    return this.act(() => this.ingest(doc));
  }

  /** The inbox, inside the queue: filed, read (within the Claude caps when they are on) and checked, within the company's document cap. */
  private async ingest(doc: { bytes: Uint8Array; filename: string; mime?: string }): Promise<UploadResult> {
    const { db } = this.deps;
    const bytes = Buffer.isBuffer(doc.bytes) ? doc.bytes : Buffer.from(doc.bytes.buffer, doc.bytes.byteOffset, doc.bytes.byteLength);
    this.pdfOnly(bytes, doc.filename);
    this.roomFor(sha256(bytes));
    const out = await this.withClaude(`engine.upload:${sha256(bytes).slice(0, 16)}`, (reader, agents) =>
      // Task A6: the Checker decides on the invoice as it is read, and the Coder codes it before its accrual is booked.
      ingestDocument(db, { dir: NO_FOLDER, companyName: this.deps.company.name, reader, now: () => this.now(), agents: agents.on, claude: agents.client, coder: agents.client, readInParallel: true }, { bytes, filename: doc.filename, ...(doc.mime ? { mime: doc.mime } : {}), source: "upload" }));
    if (out.kind === "duplicate_document") {
      // The same file again: its invoice as it stands, with its cash check while the agent could still pay it (a second filing of the cash sample).
      const was = out.invoice_id ? this.invoice(out.invoice_id) : null;
      const cash = was ? await this.cashOf(was) : null;
      return { kind: out.kind, sha256: out.sha256, invoice: was, ...(cash ? { cash } : {}) };
    }
    const inv = firstInvoice(out);
    if (inv) this.startEarlyPayer(inv.id);
    // Read again: a note written after the checks is on the row, not on what the inbox returned.
    const view = inv ? this.invoice(inv.id) : null;
    const cash = view ? await this.cashOf(view) : null;
    return { kind: out.kind, sha256: out.kind === "invoice" ? out.invoice.doc_sha256 : sha256(bytes), invoice: view, ...(cash ? { cash } : {}) };
  }

  /**
   * The cash check on an invoice the agent may pay alone (ready, inside the company's limit): the EUR position as the
   * treasury reads it now (the bank's balance, the commitments, the payouts in flight, the floor) and the fee reserve the
   * engine would hold back; null for any other invoice, or a company with no limit to pay alone. Reads only.
   */
  private async cashOf(inv: InvoiceView): Promise<CashView | null> {
    const { db, rails } = this.deps;
    const limit = aloneLimit(db);
    if (!limit || inv.status !== "ready" || !inv.alone_limit?.within || inv.currency !== limit.currency) return null;
    const s = treasuryState(db, await rails.rail.balances());
    return cashCheck({
      invoice: { id: inv.id, invoiceNo: inv.invoice_no, payee: inv.vendor, iban: "", amount: inv.total, currency: inv.currency, dueDate: inv.due_date ?? "" },
      position: { currency: "EUR", balance: signedCents(s.eurAvailableCents), committed: signedCents(s.eurObligationsCents), inFlight: signedCents(s.eurInFlightCents ?? 0), floor: signedCents(s.eurFloorCents) },
      feeReserve: fromCents(feeReserveCents(measuredSwiftFeesCents(db))), aloneLimit: limit, today: this.now().toISOString().slice(0, 10),
    });
  }

  /**
   * The cash sample's own context (CASH_SAMPLE, src/engine/tryWorld.ts): the company's commitments rise once by
   * CASH_COMMITTED, a test value, so its EUR above the floor is spoken for; recorded as treasury.commitment_added and
   * the setting's own change. Safe to repeat: a second filing adds nothing.
   */
  private commitForCashSample(): void {
    const { db } = this.deps;
    if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'treasury.commitment_added' AND subject = ?").get(CASH_SAMPLE)) return;
    const now = this.now();
    const before = getSetting(db, "eur_obligations", "0.00");
    const after = fromCents(toCents(before) + toCents(CASH_COMMITTED));
    audit(db, "system", "treasury.commitment_added", CASH_SAMPLE, { currency: "EUR", amount: CASH_COMMITTED, before, after, note: "test value: the cash sample's context, EUR committed to other bills" }, now);
    setSetting(db, "treasury", "eur_obligations", after, now);
  }

  invoices(): InvoiceView[] {
    return apInvoices(this.deps.db).map((i) => this.view(i));
  }

  invoice(id: string): InvoiceView | null {
    const inv = apInvoice(this.deps.db, id);
    return inv ? this.view(inv) : null;
  }

  private findingView(f: ApInvoiceRow["findings"][number]): FindingView {
    const out: FindingView = { level: f.level, code: f.code, message: f.detail };
    if (f.twin_of) out.twin_of = f.twin_of;
    if (f.signals?.length) out.signals = f.signals.map((x) => ({ ...x }));
    const id = f.of ?? f.twin_of;
    const e = id ? apInvoice(this.deps.db, id) : null;
    if (e) out.earlier = { id: e.id, vendor: e.vendor, invoice_no: e.invoice_no, currency: e.currency, total: e.total, issue_date: e.issue_date, paid_at: e.paid_at, status: e.status, status_words: t(this.deps.company.lang, `status.${e.status}`) };
    return out;
  }

  /** An invoice the negotiation replaced says so, naming its replacement (supersede, below). */
  private supersededBy(inv: ApInvoiceRow): string | null {
    if (inv.status !== "rejected") return null;
    const row = this.deps.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'ap.superseded' AND subject = ? ORDER BY seq DESC LIMIT 1").get(inv.id) as { payload_json: string } | undefined;
    if (!row) return null;
    const p = JSON.parse(row.payload_json) as { by?: string; invoice_no?: string };
    return `Superseded by the negotiated terms (${p.by ?? "?"}, ${p.invoice_no ?? "?"})`;
  }

  private view(inv: ApInvoiceRow): InvoiceView {
    return {
      id: inv.id, status: inv.status, status_words: this.supersededBy(inv) ?? t(this.deps.company.lang, `status.${inv.status}`), payable: actionsFor(inv).pay.allowed,
      vendor: inv.vendor, invoice_no: inv.invoice_no, currency: inv.currency, total: inv.total, due_date: inv.due_date, read_by: inv.read_by,
      issue_date: inv.issue_date, paid_at: inv.paid_at, received_at: inv.received_at,
      findings: inv.findings.map((f) => this.findingView(f)),
      checks_passed: checksPassed(inv),
      doc_sha256: inv.doc_sha256,
      proposal: inv.proposal_id ? this.proposal(inv.proposal_id) : null,
      alone_limit: this.aloneLimitOf(inv),
    };
  }

  private aloneLimitOf(inv: ApInvoiceRow): { currency: string; amount: string; within: boolean } | null {
    const limit = aloneLimit(this.deps.db);
    return limit && { ...limit, within: limitRule(limit, inv.currency, inv.total).rule === null };
  }

  /**
   * Files the invoice's payment for the CFO's approval. A reason not to (the engine's own words) comes back, and no
   * proposal is made. Within the company's limit to pay alone, when the agents and code's checks say pay (src/ap/pay.ts
   * payAlone), code approves the exact terms and the agent's payment runs at once, like an approved one: `alone` says
   * so, and `settled` what followed (the proposal comes back EXECUTED, or FAILED with the reason in settled.error).
   */
  propose(invoiceId: string): Promise<{ ok: true; proposal: ProposalView; alone?: PaidAlone; settled?: Settled; alone_declined?: AloneDeclined } | { ok: false; reason: string }> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try {
        // Task A6: the Payer proposes the rail, the day and the currency on the engine's plan when the CFO opens Pay. It may
        // only propose within that plan: held or off the plan, code's plan stands and is filed for Face ID, labelled.
        // The Payer's early answer, when it is finished, is used if Pay's plan is the same case (src/ap/payerAgent.ts payerGate).
        const early = this.takeEarlyPayer(invoiceId);
        const out = await this.withClaude(`engine.propose:${invoiceId}`, (reader, agents) => payApInvoice(db, rails.rail, invoiceId, this.now(), this.deps.reviewNoteOnPay === false ? undefined : reader, { on: agents.on, claude: agents.client, planStands: true, ...(early ? { early } : {}) }));
        if (out.kind !== "proposed") return { ok: false, reason: out.reason };
        // The agent pays it alone: approved by code within the limit, run now as any approved payment is.
        const settled = out.alone ? await this.pay(out.proposal.proposal_id) : null;
        const proposal = this.proposal(out.proposal.proposal_id);
        if (!proposal) return { ok: false, reason: `${out.proposal.proposal_id} was filed but is not in the ledger` };
        // 21 Nov: within the limit to pay alone but filed for the CFO, the answer says who did not say pay, and why.
        return { ok: true, proposal, ...(out.alone && settled ? { alone: out.alone, settled } : {}), ...(out.declined ? { alone_declined: out.declined } : {}) };
      } catch (e) {
        return { ok: false, reason: message(e) };
      } finally {
        // Planning a payment locks a quote at the bank: the stand-in must still know it when the approval comes.
        this.deps.afterMoney?.();
      }
    });
  }

  proposal(id: string): ProposalView | null {
    const p = this.deps.db.prepare("SELECT proposal_id, kind, status, terms_sha256, terms_json FROM proposals WHERE proposal_id = ?").get(id) as
      { proposal_id: string; kind: string; status: string; terms_sha256: string; terms_json: string } | undefined;
    if (!p) return null;
    const { facts, warnings } = termsFacts(JSON.parse(p.terms_json) as Record<string, unknown>, this.deps.company.lang);
    const reasons = p.status === "PENDING_APPROVAL" ? secondKeyReasons(this.deps.db, p, this.now()) : [];
    let second_key: ProposalView["second_key"];
    if (reasons.length) {
      ensureSecondKeyTables(this.deps.db);
      const rows = this.deps.db.prepare("SELECT factor FROM second_factors WHERE proposal_id = ? AND terms_sha256 = ?").all(p.proposal_id, p.terms_sha256) as { factor: string }[];
      const signed = { passkey: rows.some((r) => r.factor === "passkey"), security_key: rows.some((r) => r.factor === "security_key") };
      const keys = (this.deps.db.prepare("SELECT credential_id FROM security_keys WHERE status = 'ACTIVE' ORDER BY enrolled_at").all() as { credential_id: string }[]).map((r) => r.credential_id);
      second_key = { reasons, message: secondKeyMessage(reasons, { passkey: signed.passkey, securityKey: signed.security_key }), security_keys: keys, signed };
    }
    return { id: p.proposal_id, kind: p.kind, status: p.status, terms_sha256: p.terms_sha256, challenge: challengeFor(p.terms_sha256), facts, warnings, ...(second_key ? { second_key } : {}) };
  }

  /**
   * The CFO's rule for high-risk payments (src/policy/secondKey.ts): a policy_change proposal of its keys only, which the
   * CFO then approves with Face ID like any proposal (POST /v1/engine/proposals/{id}/approve); approved, it is applied.
   * `by`: the signed-in person who asks, as their passkey is labelled, signed in as its proposer (who never approves it;
   * above the CFO's segregation-of-duties threshold a loosening without one is refused); `byId`: that person's id, as
   * passkeyFinish's `person`, so their own key is refused by id too, whatever its label says (approve).
   */
  proposeSecondKey(changes: { key: string; to: string }[], by?: string, byId?: string): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }> {
    return this.act(async () => {
      if (!changes.length || changes.some((c) => !(SECOND_KEY_KEYS as readonly string[]).includes(c.key))) return { ok: false as const, reason: `only these settings: ${SECOND_KEY_KEYS.join(", ")}` };
      // Only what changes: the page sends every trigger as it stands on screen.
      const real = changes.filter((c) => policyValue(this.deps.db, c.key) !== c.to);
      if (!real.length) return { ok: false as const, reason: "nothing changes: the rule already says this" };
      try {
        const p = proposePolicyChange(this.deps.db, { changes: real, reason: "The CFO's rule for high-risk payments: Face ID and a security key", ...(by !== undefined ? { signedInAs: by } : {}), ...(byId !== undefined ? { signedInId: byId } : {}) }, "human", this.now());
        return { ok: true as const, proposal: this.proposal(p.proposal_id)! };
      } catch (e) { return { ok: false as const, reason: message(e) }; }
    });
  }

  /**
   * The CFO's emergency stop, pulled (on) or lifted (off): a policy change of the stop alone (src/policy/emergencyStop.ts),
   * which changes nothing until the CFO approves it with the passkey (approve), as the runner's stop does. While it is
   * on, proposals are still filed but nothing is sent: every payment executor asks it when it begins and again
   * immediately before each create, and so does the rail. Both directions are audited as policy.changed. `by` as for
   * proposeSecondKey.
   */
  emergencyStop(on: boolean, by?: string, byId?: string): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }> {
    return this.act(async () => {
      const { db } = this.deps;
      if (stopState(db).on === on) return { ok: false as const, reason: on ? "the emergency stop is already on" : "the emergency stop is not on" };
      try {
        const p = proposePolicyChange(db, { changes: [{ key: STOP_KEY, to: on ? "on" : "off" }], reason: on ? "The CFO pulls the emergency stop: nothing is paid until it is lifted" : "The CFO lifts the emergency stop", ...(by !== undefined ? { signedInAs: by } : {}), ...(byId !== undefined ? { signedInId: byId } : {}) }, "human", this.now());
        return { ok: true as const, proposal: this.proposal(p.proposal_id)! };
      } catch (e) { return { ok: false as const, reason: message(e) }; }
    });
  }

  /**
   * Opens the registration of a security key (a second key for high-risk payments, src/passkey/securityKey.ts) for the
   * person whose passkey is labelled `label`; `relying` as for passkeyStart.
   */
  securityKeyStart(a: { label: string; rp?: { rpId: string; origin: string } }): Promise<{ ok: true; challenge: string; user_id: string; exclude: string[] } | { ok: false; reason: string }> {
    return this.act(async () => {
      const rp = a.rp ?? this.deps.rp;
      try { return { ok: true as const, ...startSecurityKey(this.deps.db, { label: a.label, rpId: rp.rpId, origin: rp.origin }, this.now()) }; } catch (e) { return { ok: false as const, reason: message(e) }; }
    });
  }

  /** The new security key, verified against the open registration; reported as cross-platform, never a passkey already. */
  securityKeyFinish(a: { label: string; credential: unknown }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }> {
    return this.act(async () => finishSecurityKey(this.deps.db, a, this.now()));
  }

  /**
   * Opens the window in which one passkey can be created (a new one replaces the same person's earlier one). `relying`:
   * the relying party of the page that asks (a host that serves the engine on more than one address checks it first);
   * without it, the host's own.
   */
  passkeyStart(relying?: { rpId: string; origin: string }): Promise<{ challenge: string; code: string; exclude: string[] }> {
    return this.act(async () => {
      const { db } = this.deps;
      const rp = relying ?? this.deps.rp;
      const active = (db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE' ORDER BY enrolled_at, credential_id").all() as { credential_id: string }[]).map((p) => p.credential_id);
      const { window, code } = openEnrolment(db, { rpId: rp.rpId, origin: rp.origin, replace: active.length > 0 }, this.now());
      return { challenge: window.challenge, code, exclude: active };
    });
  }

  /**
   * The new passkey, verified against the window by the engine, then confirmed by the host itself: on a runner a
   * person confirms the fingerprint the phone shows; here the caller is the signed-in person, and for the company's
   * first key that is the confirmation. While another key is active, the new one also needs one of: `endorsement`, an
   * active key's signature over endorsementChallenge(new id, its SPKI hash), verified here; `cosigned`, the host's word
   * (it verified) that a second owner confirmed it with their passkey (`cosignRefused`: it refused one, which is audited
   * and refused here too); `recovered`, the host's word that the person's
   * account was recovered by two platform admins. Without one it stays pending (the window's ten minutes) and the
   * answer names the challenge. Such a key may not approve for `coolingOffMs` (default 72 hours; 0: none).
   */
  passkeyFinish(a: { code: string; credential: unknown; label: string; person?: string; endorsement?: unknown; cosigned?: { by: string }; cosignRefused?: string; recovered?: { by: string }; coolingOffMs?: number }): Promise<PasskeyFinished> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      const item: InboxItem = { ticket: "engine", kind: "registration", proposal_id: null, body: JSON.stringify({ code: a.code, credential: a.credential }), received_at: now.toISOString() };
      const out = await processRegistration(db, item, { label: a.label }, now);
      if (out.status === "refused" || !out.credentialId) return { ok: false, reason: out.message };
      db.exec(PASSKEY_TRUST);
      let trust: { how: KeyHow; by: string | null; cooling_until: string | null } | null = this.trustOf(out.credentialId);
      // The same person's earlier key, which this one replaces (recordPasskey revokes it): every owner is told (cloud/src/engine/routes.ts).
      let replaced: string | null = null;
      if (out.status === "pending") {
        const id = out.credentialId;
        const waiting = pendingPasskeys(db, now).find((p) => p.credential_id === id);
        if (!waiting) return { ok: false, reason: "the enrolment window closed before the passkey was confirmed; start again" };
        const others = (db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE' AND credential_id != ? ORDER BY enrolled_at, credential_id").all(id) as { credential_id: string }[]).map((r) => r.credential_id);
        let how: KeyHow = "first";
        let by: string | null = null;
        if (others.length) {
          const spki = (db.prepare("SELECT spki_sha256 FROM passkey_pending WHERE credential_id = ?").get(id) as { spki_sha256: string }).spki_sha256;
          const granted = await this.keyGrant(a, id, spki, now);
          if (!granted) {
            audit(db, "system", "passkey.endorsement_required", id, { active_keys: others.length }, now);
            return { ok: false, code: "endorsement_required", reason: ENDORSEMENT_REQUIRED, endorse: { credential_id: id, spki_sha256: spki, challenge: endorsementChallenge(id, spki), keys: others } };
          }
          if ("refused" in granted) {
            audit(db, "system", "passkey.endorsement_refused", id, { reason: granted.refused }, now);
            return { ok: false, code: "endorsement_refused", reason: `${granted.refused}. The new key was not enrolled.` };
          }
          ({ how, by } = granted);
        }
        replaced = (db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE' AND label = ? AND credential_id != ?").get(waiting.label, id) as { credential_id: string } | undefined)?.credential_id ?? null;
        try { confirmPasskey(db, waiting.fingerprint, now); } catch (e) { return { ok: false, reason: message(e) }; }
        const ms = how === "first" ? 0 : Number.isFinite(a.coolingOffMs) && a.coolingOffMs! >= 0 ? Math.floor(a.coolingOffMs!) : APPROVAL_KEY_COOLING_OFF_MS;
        const cooling = ms > 0 ? new Date(now.getTime() + ms).toISOString() : null;
        db.prepare("INSERT INTO engine_passkey_trust (credential_id, how, by, enrolled_at, cooling_until) VALUES (?, ?, ?, ?, ?) ON CONFLICT(credential_id) DO UPDATE SET how = excluded.how, by = excluded.by, enrolled_at = excluded.enrolled_at, cooling_until = excluded.cooling_until")
          .run(id, how, by, now.toISOString(), cooling);
        audit(db, "system", "passkey.key_authorised", id, { how, by, cooling_until: cooling, others_active: others.length }, now);
        trust = { how, by, cooling_until: cooling };
      }
      // Whose passkey it is, by the caller's own id for the person: a name is free text and two people may share one.
      if (a.person !== undefined) {
        db.exec(PASSKEY_PEOPLE);
        db.prepare("INSERT INTO engine_passkey_people (credential_id, person) VALUES (?, ?) ON CONFLICT(credential_id) DO UPDATE SET person = excluded.person").run(out.credentialId, a.person);
      }
      return { ok: true, credential_id: out.credentialId, how: trust?.how ?? "first", by: trust?.by ?? null, cooling_until: trust?.cooling_until ?? null, ...(replaced ? { replaced } : {}) };
    });
  }

  /** How a key was authorised and until when it may not approve (none recorded: a key from before, or the first). */
  private trustOf(credentialId: string): { how: KeyHow; by: string | null; cooling_until: string | null } | null {
    this.deps.db.exec(PASSKEY_TRUST);
    return (this.deps.db.prepare("SELECT how, by, cooling_until FROM engine_passkey_trust WHERE credential_id = ?").get(credentialId) as { how: KeyHow; by: string | null; cooling_until: string | null } | undefined) ?? null;
  }

  /** The key's cooling-off, while it lasts. */
  private coolingOf(credentialId: string, now: Date): { how: KeyHow; until: string; since: string } | null {
    this.deps.db.exec(PASSKEY_TRUST);
    const r = this.deps.db.prepare("SELECT how, cooling_until, enrolled_at FROM engine_passkey_trust WHERE credential_id = ?").get(credentialId) as { how: KeyHow; cooling_until: string | null; enrolled_at: string } | undefined;
    return r?.cooling_until && Date.parse(r.cooling_until) > now.getTime() ? { how: r.how, until: r.cooling_until, since: r.enrolled_at } : null;
  }

  /** What authorises a key added while another is active: an endorsement (checked here), the host's co-signature or recovery; null: none was given. */
  private async keyGrant(a: { endorsement?: unknown; cosigned?: { by: string }; cosignRefused?: string; recovered?: { by: string } }, newId: string, spki: string, now: Date): Promise<{ how: KeyHow; by: string } | { refused: string } | null> {
    const { db } = this.deps;
    // The host checked a second owner's co-signature and refused it: refused here too, so the audit log has it.
    if (a.cosignRefused) return { refused: a.cosignRefused.replace(/\.$/, "").slice(0, 240) };
    if (a.endorsement !== undefined) {
      const id = credentialIdOf(a.endorsement);
      const pk = id && id !== newId ? passkeyById(db, id) : null;
      // An unsealed key (a row the ceremony never wrote, src/passkey/seal.ts) vouches for nothing.
      if (!pk || pk.status !== "ACTIVE" || sealRefusal(db, pk)) return { refused: "The key that signed for the new one is not an active approval key of this company" };
      const cooling = this.coolingOf(pk.credential_id, now);
      if (cooling) return { refused: `The key that signed for the new one is itself in its cooling-off until ${cooling.until}: it cannot vouch for another key yet` };
      const v = await verifyApprovalSignature(a.endorsement as AuthenticationResponseJSON, endorsementHash(newId, spki), pk);
      if (!v.ok) return { refused: "The signature for the new key does not verify: it must be an active approval key's signature over the new key's id and public-key hash" };
      db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND counter <= ?").run(v.newCounter, pk.credential_id, v.newCounter);
      return { how: "endorsed", by: pk.credential_id.slice(0, 8) };
    }
    if (a.cosigned?.by) return { how: "cosigned", by: a.cosigned.by.slice(0, 120) };
    if (a.recovered?.by) return { how: "recovery", by: a.recovered.by.slice(0, 120) };
    return null;
  }

  /**
   * A person the cloud erased (POST /v1/users/{id}/erase): every passkey enrolled for that person (passkeyFinish's
   * person, never the name: another person may have the same one) is revoked and labelled "[erased]". Asking again
   * changes nothing. The approvals they signed keep their name: those are bookkeeping records, kept seven years.
   */
  forgetPasskey(person: string): Promise<{ revoked: number }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      db.exec(PASSKEY_PEOPLE);
      const rows = db.prepare(`SELECT k.credential_id, k.status FROM passkeys k JOIN engine_passkey_people p ON p.credential_id = k.credential_id WHERE p.person = ?`).all(person) as { credential_id: string; status: string }[];
      db.transaction(() => {
        for (const r of rows) {
          db.prepare("UPDATE passkeys SET status = 'REVOKED', label = '[erased]' WHERE credential_id = ?").run(r.credential_id);
          if (r.status === "ACTIVE") audit(db, "human", "passkey.revoked", r.credential_id, { reason: "the person was erased" }, now);
        }
      })();
      return { revoked: rows.filter((r) => r.status === "ACTIVE").length };
    });
  }

  /**
   * A passkey's signature over a proposal's exact terms. Verified by the engine; only when it approves does the
   * executor run, on the host's rails, and then the payment is followed, booked, archived and fed. An error of the
   * executor or of what follows comes back in settled.error; the approval stays.
   */
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown; hold?: boolean }): Promise<{ status: string; message: string; settled: Settled | null; held?: true; code?: "cooling_off"; cooling_until?: string }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      // The terms the request names must be the proposal's own. The signature binds the stored terms either way, so no
      // money is at risk; but an approval sent with other terms is not the one the person saw, and is refused as such.
      const held = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { terms_sha256: string } | undefined;
      if (held && held.terms_sha256 !== a.terms_sha256) return { status: "refused", message: REFUSED_TERMS_NOT_ON_SCREEN, settled: null };
      // A key in its cooling-off (added by replacement, endorsement or co-signature, or after a recovery) approves
      // nothing yet. Only a signature that verifies is written to the audit log: anyone may send a key's id.
      const keyId = credentialIdOf(a.credential);
      const own = keyId ? this.ownProposal(a.proposal_id, keyId) : null;
      if (own) return { status: "refused", message: own, settled: null };
      const cooling = keyId ? this.coolingOf(keyId, now) : null;
      if (cooling && keyId) {
        const pk = passkeyById(db, keyId);
        let verified = false;
        if (pk && pk.status === "ACTIVE" && held) {
          try { verified = (await verifyApprovalSignature(a.credential as AuthenticationResponseJSON, held.terms_sha256, pk)).ok; } catch { verified = false; }
        }
        if (verified) audit(db, "system", "passkey.cooling_off_refused", a.proposal_id, { credential: keyId.slice(0, 8), how: cooling.how, until: cooling.until }, now);
        return { status: "refused", code: "cooling_off", cooling_until: cooling.until, settled: null,
          message: `This approval key was added on ${cooling.since.slice(0, 16).replace("T", " ")} UTC (${HOW_WORDS[cooling.how]}) and is in its cooling-off until ${cooling.until.slice(0, 16).replace("T", " ")} UTC: a new or recovered key may not approve before then, so every owner can stop it. Nothing was paid.` };
      }
      // Only these three fields travel: the decision is always an approval (rejecting is not one of the host's actions).
      const item: InboxItem = { ticket: "engine", kind: "assertion", proposal_id: null, body: JSON.stringify({ proposal_id: a.proposal_id, terms_sha256: a.terms_sha256, credential: a.credential }), received_at: now.toISOString() };
      const out = await processAssertion(db, item, now);
      if (out.status === "refused") return { status: out.status, message: plainRefusal(out.message), settled: null };
      if (out.status !== "approved" || !out.proposalId) return { status: out.status, message: out.message, settled: null };
      // The hands-on demo: the approval is stored and the payment held, for the one pay route (paySigned) to run.
      if (a.hold) return { status: out.status, message: out.message, settled: null, held: true };
      return { status: out.status, message: out.message, settled: await this.pay(out.proposalId) };
    });
  }

  /**
   * Why this key's person may not approve this policy change, by the Cloud's id for them (passkeyFinish's `person`), or
   * null (red team round 2, finding B): they proposed it (its signed proposed_by_id), or another key of theirs already
   * co-signed it. A name is free text, compared as src/lib/personName.ts reads it in decide(); an id is not.
   */
  private ownProposal(proposalId: string, keyId: string): string | null {
    const { db } = this.deps;
    const p = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
    if (!p || p.kind !== "policy_change") return null;
    let t: { proposed_by_id?: unknown; proposed_by?: unknown };
    try { t = JSON.parse(p.terms_json) as typeof t; } catch { return null; }
    db.exec(PASSKEY_PEOPLE);
    const personOf = (cred: string) => (db.prepare("SELECT person FROM engine_passkey_people WHERE credential_id = ?").get(cred) as { person: string } | undefined)?.person ?? null;
    const me = personOf(keyId);
    if (!me) return null;
    if (typeof t.proposed_by_id === "string" && t.proposed_by_id === me) return `You proposed ${proposalId}${typeof t.proposed_by === "string" ? ` (as ${t.proposed_by})` : ""}, so you cannot approve it (segregation of duties); another person approves it with their own passkey. Nothing was changed.`;
    const cosigned = db.prepare("SELECT credential_id FROM cosignatures WHERE proposal_id = ?").all(proposalId) as { credential_id: string }[];
    if (cosigned.some((c) => c.credential_id !== keyId && personOf(c.credential_id) === me)) return `You already approved ${proposalId} with another key; a second person must approve it with their own passkey. Nothing was changed.`;
    return null;
  }

  /**
   * Try again: a payment that was approved but whose execution failed (the bank was away, say) is run once more, by
   * the executor's own path for that, the one a runner takes when it runs a FAILED proposal again: it starts again
   * from its last finished step, and a payout written before the failure is looked up at the bank by its request id
   * and adopted, never sent blind a second time (src/executors/invoicePayment.ts, src/policy/saga.ts). Only a FAILED
   * invoice payment, or an approved one the executor refused before it began (blocked), is run; anything else (paid, never approved, refused, not there) answers nothing_to_retry and
   * nothing runs. Then, as after an approval, the payment is followed, booked, archived and fed.
   */
  retry(proposalId: string): Promise<{ status: "retried" | "nothing_to_retry"; message: string; settled: Settled | null }> {
    return this.act(async () => {
      const p = this.deps.db.prepare("SELECT status, kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; kind: string } | undefined;
      if (!p) return { status: "nothing_to_retry", message: `no proposal ${proposalId}`, settled: null };
      // 26 Nov: also an approval the executor refused before it began (src/policy/blocked.ts), such as one signed while the
      // CFO's emergency stop was on: once the cause is gone (the stop lifted), it runs with every check asked again.
      const blocked = p.status === "APPROVED" && isBlocked(this.deps.db, proposalId, this.now());
      if ((p.status !== "FAILED" && !blocked) || p.kind !== "invoice_payment") return { status: "nothing_to_retry", message: `${proposalId} is ${p.status}: there is nothing to try again; nothing was paid`, settled: null };
      const settled = await this.pay(proposalId);
      const now = (this.deps.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string }).status;
      return { status: "retried", message: `${proposalId} was run again: ${now}`, settled };
    });
  }

  /** An approved proposal through its executor on the host's rails, then followed, booked, archived and fed; inside the queue only. */
  private async pay(proposalId: string): Promise<Settled> {
    const { db, rails } = this.deps;
    const invoice = (db.prepare("SELECT id FROM ap_invoices WHERE proposal_id = ?").get(proposalId) as { id: string } | undefined)?.id ?? null;
    const failed: string[] = [];
    try { await execute(db, proposalId, undefined, undefined, rails); } catch (e) { failed.push(message(e)); }
    // The money has moved (or not): whatever fails from here on is reported, and the rest still runs.
    try { this.deps.afterMoney?.(); } catch (e) { failed.push(`after the payment: ${message(e)}`); }
    const settled = await this.settle({ proposalId, invoiceId: invoice });
    return { ...settled, error: [...failed, ...(settled.error ? [settled.error] : [])].join("; ") || null };
  }

  /** Follows the payments, books them, archives and feeds the read model. Safe to repeat: a second run adds nothing. */
  sync(): Promise<Settled> {
    return this.act(() => this.settle(null));
  }

  /** Each step runs whether the one before it failed or not (each is safe to repeat); what failed is named in error. */
  private async settle(of: { proposalId: string; invoiceId: string | null } | null): Promise<Settled> {
    const { db, rails, vault, feed, company } = this.deps;
    const errors: string[] = [];
    const step = async (what: string, fn: () => unknown): Promise<void> => {
      try { await fn(); } catch (e) { errors.push(`${what}: ${message(e)}`); }
    };
    const vaultAdded: string[] = [];
    let fed = false;
    await step("following the payments", () => syncPayments(db, { now: () => this.now(), rail: rails.rail }));
    await step("booking", () => syncLedger(db, this.now()));
    if (vault) await step("the archive", async () => { vaultAdded.push(...(await syncVault(db, vault, { company: company.name, lang: company.lang, now: this.now(), bank: "stand-in" })).added.map((x) => x.path)); });
    if (feed) await step("the read model", async () => { await feed(db, this.now()); fed = true; });
    const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { v: string | number | null } | undefined)?.v ?? null;
    return {
      invoice_status: of?.invoiceId ? (one("SELECT status AS v FROM ap_invoices WHERE id = ?", of.invoiceId) as string | null) : null,
      transfer_status: of ? (one("SELECT t.status AS v FROM proposals p JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id') WHERE p.proposal_id = ?", of.proposalId) as string | null) : null,
      ledger_entries: Number(one("SELECT COUNT(*) AS v FROM ledger_entries") ?? 0),
      vault_added: vaultAdded,
      fed,
      error: errors.length ? errors.join("; ") : null,
    };
  }

  /** The engine's events after a seq, oldest first, at most 200 a page; next is the seq to ask after. */
  events(after: number, limit = 100): { items: EngineEvent[]; next: number } {
    const from = Number.isFinite(after) && after > 0 ? Math.trunc(after) : 0;
    const n = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.trunc(limit))) : 100;
    const rows = this.deps.db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE seq > ? ORDER BY seq LIMIT ?").all(from, n) as EventRow[];
    const items = rows.map(publicEvent);
    return { items, next: items.length ? items[items.length - 1]!.seq : from };
  }

  /** Every file the archive's indexes list. */
  async vaultFiles(): Promise<VaultFile[]> {
    const { vault, company } = this.deps;
    if (!vault) return [];
    const out: VaultFile[] = [];
    for (const year of this.vaultYears()) {
      const text = await vault.readIndex(yearIndexPath(company.name, year));
      if (!text) continue;
      for (const f of (JSON.parse(text) as YearIndex).files) out.push({ path: f.path, kind: f.kind, bytes: f.bytes, sha256: f.sha256, added_at: f.added_at });
    }
    return out;
  }

  /** The years the archive may hold an index for: those of the invoices, the payments, the closed periods and the days it was filed on. */
  private vaultYears(): number[] {
    const { db } = this.deps;
    const years = new Set<number>();
    const add = (day: string | number) => { const y = Number(String(day).slice(0, 4)); if (Number.isInteger(y) && y > 0) years.add(y); };
    for (const d of invoiceDocs(db)) add(d.date);
    for (const r of receipts(db)) add(r.paid_at);
    const closed = closedPeriods(db);
    for (const p of [...closed.months, ...closed.quarters, ...closed.years]) add(p);
    for (const r of db.prepare("SELECT DISTINCT substr(ts, 1, 4) AS y FROM audit_log WHERE event = 'vault.filed'").all() as { y: string }[]) add(r.y);
    return [...years].sort((a, b) => a - b);
  }

  /** A file's bytes, only for a path the archive's index lists; anything else is null. */
  async vaultFile(path: string): Promise<Uint8Array | null> {
    const { vault } = this.deps;
    if (!vault?.read) return null;
    if (!(await this.vaultFiles()).some((f) => f.path === path)) return null;
    return (await vault.read(path)) ?? null;
  }

  // ---- The hands-on demo (purser-try): samples, suppliers on file, "write your own", the document cap ----

  /** One document cap per company, whatever route brings the document: a file already held passes (the inbox calls it a duplicate). */
  private roomFor(docSha256: string): void {
    const max = this.deps.maxDocuments;
    if (max === undefined) return;
    const { db } = this.deps;
    if (db.prepare("SELECT 1 FROM ap_documents WHERE sha256 = ?").get(docSha256)) return;
    // The seeded paid original (seedPaid) is the company's history, not the visitor's: it does not count.
    const seeded = this.deps.seedPaid ? (this.deps.samples ?? []).find((x) => x.key === PAID_SAMPLE) : undefined;
    const n = (db.prepare("SELECT COUNT(*) AS n FROM ap_documents WHERE sha256 <> ?").get(seeded ? sha256(Buffer.from(seeded.base64, "base64")) : "") as { n: number }).n;
    if (n >= max) throw new Error(`this test company holds ${n} documents, its limit of ${max}; nothing was filed`);
  }

  /** A capped company takes PDF files only: an e-mail may carry twenty documents, and a photo is filed as another file. */
  private pdfOnly(bytes: Uint8Array, filename: string): void {
    if (this.deps.maxDocuments !== undefined && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new Error(`${filename.slice(0, 100)}: a test company takes PDF files only; nothing was filed`);
    }
  }

  /** The sample invoices, in the tray's order: what the visitor does, never what the engine will answer. */
  samples(): { key: string; title: string; filename: string; expect?: Sample["expect"]; row?: Sample["row"] }[] {
    // 14 Nov (inbox table): each sample's row (what its document says) and the engine's measured outcome for it.
    return (this.deps.samples ?? []).map((s) => ({ key: s.key, title: s.title, filename: s.filename, ...(s.expect ? { expect: s.expect } : {}), ...(s.row ? { row: s.row } : {}) }));
  }

  /**
   * A sample through the inbox, as an upload of its PDF; null for a key that is not a sample. The clean sample a second
   * time in the same company (14 Nov, owner: "running the demo a second time must always work") is a new invoice from
   * the same supplier: a fresh number, today's date and its own amount (freshClean), so the standard run is never held
   * by the visitor's own earlier run. Every other sample stays the very same file, on purpose: they show the holds.
   */
  uploadSample(key: string): Promise<UploadResult | null> {
    return this.act(async () => {
      const s = (this.deps.samples ?? []).find((x) => x.key === key);
      if (!s) return null;
      const bytes = Buffer.from(s.base64, "base64");
      if (key === CASH_SAMPLE) { this.roomFor(sha256(bytes)); this.commitForCashSample(); }
      if (key === CLEAN_SAMPLE && this.deps.db.prepare("SELECT 1 FROM ap_documents WHERE sha256 = ?").get(sha256(bytes))) {
        const fields = this.freshClean();
        const pdf = await invoicePdf({ fields, supplierKey: supplierKey(fields.supplier.name), billTo: BILL_TO_SAMPLE });
        return this.ingest({ bytes: pdf, filename: `bergtex-${fields.invoiceNo}.pdf`, mime: "application/pdf" });
      }
      return this.ingest({ bytes, filename: s.filename, mime: "application/pdf" });
    });
  }

  /**
   * The clean sample's next run: the n-th re-run is BTX-2026-<30+n> (the first number not yet filed), dated today, due in
   * 14 days, EUR 12.50 times n more than the clean sample, so it is neither the same invoice nor the same total as any
   * earlier run (the duplicate checks stay as they are). Test data, the clean sample's supplier and IBAN on file.
   */
  private freshClean(): InvoiceFields {
    const taken = new Set((this.deps.db.prepare("SELECT invoice_no FROM ap_invoices").all() as { invoice_no: string }[]).map((r) => r.invoice_no));
    let n = 1;
    while (taken.has(`BTX-2026-${30 + n}`) && n < 500) n++;
    const day = (plus: number) => new Date(this.now().getTime() + plus * 86_400_000).toISOString().slice(0, 10);
    return { ...CLEAN, invoiceNo: `BTX-2026-${30 + n}`, amountCents: CLEAN.amountCents + 1_250 * n, issueDate: day(0), dueDate: day(14) };
  }

  /**
   * The hands-on demo's sandbox override of a hold (14 Nov, owner): a possible duplicate by the same total (twin_of) is
   * cleared with the inbox's own person's path (clearPossibleDuplicate: kept per pair, in the audit log as
   * ap.duplicate_cleared by a person), then checked again; every other check still applies, and nothing is paid before the
   * passkey signs the exact terms. In production a second person would review it. A match on the invoice number, an exact
   * duplicate, changed bank details or a new supplier are never cleared this way: those can only be rejected.
   */
  clearHold(id: string): Promise<{ ok: true; invoice: InvoiceView } | { ok: false; reason: string }> {
    return this.act(async () => {
      try {
        const next = await this.withClaude(`engine.clear:${id}`, (reader) => clearPossibleDuplicate(this.deps.db, { now: () => this.now(), reader }, id,
          { by: "You (visitor)", note: "cleared on the hands-on demo (sandbox): a new invoice, not the same one", actor: "human" }));
        if (next.status === "ready") this.startEarlyPayer(next.id);
        return { ok: true as const, invoice: this.view(next) };
      } catch (e) {
        return { ok: false as const, reason: message(e) };
      }
    });
  }

  /**
   * A negotiation's agreed invoice, filed (15 Nov, jury run). It records what was negotiated (ap.negotiated, on the
   * agreed invoice: the original amount, the agreed amount, the discount, the agreement's SHA-256 and the turns), which
   * the proof file carries beside the signed terms. With an original (the negotiation inside /try), the agreed invoice
   * REPLACES it: the original's unsigned payment proposal is SUPERSEDED (it can never be signed), the original leaves the
   * books with its reason ("superseded by the negotiated terms") and the ledger is synced at once, so its accrual is
   * reversed: one payable and one expense remain, the agreed ones. Only a replacement from the same supplier, numbered as
   * the original plus the agreement's reference, for less, ready to pay; never an original that is paid, signed or gone.
   */
  negotiated(replacementId: string, n: NegotiatedFacts): Promise<{ ok: true; invoice: InvoiceView; superseded: InvoiceView | null } | { ok: false; reason: string }> {
    return this.act(async () => this.recordNegotiated(replacementId, n));
  }

  /** Why `o` cannot be replaced by a negotiation's agreed invoice, or null when it can (open, its payment not signed). */
  private notReplaceable(o: ApInvoiceRow, n: NegotiatedFacts): string | null {
    const c = (x: string) => Math.round(Number(x) * 100);
    if (!["ready", "waiting_cfo"].includes(o.status)) return `${o.id} is ${o.status.replace(/_/g, " ")}; only an open invoice can be replaced`;
    if (c(o.total) !== c(n.original_amount)) return `${o.id} is not the invoice of this negotiation`;
    const p = o.proposal_id ? this.deps.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(o.proposal_id) as { status: string } | undefined : undefined;
    if (p && p.status !== "PENDING_APPROVAL" && p.status !== "SUPERSEDED") return `${o.id}'s payment is ${p.status.toLowerCase().replace(/_/g, " ")}; it cannot be replaced`;
    return null;
  }

  private recordNegotiated(replacementId: string, n: NegotiatedFacts): { ok: true; invoice: InvoiceView; superseded: InvoiceView | null } | { ok: false; reason: string } {
    const { db } = this.deps;
    const now = this.now();
    const r = apInvoice(db, replacementId);
    const o = n.original_id ? apInvoice(db, n.original_id) : null;
    const c = (x: string) => Math.round(Number(x) * 100);
    if (!r || (n.original_id && !o)) return { ok: false as const, reason: "no such invoice" };
    if (!/^[0-9a-f]{64}$/.test(n.agreement_sha256) || r.status !== "ready" || !r.invoice_no.endsWith(`-${n.agreement_sha256.slice(0, 8)}`) || !(c(r.total) < c(n.original_amount)))
      return { ok: false as const, reason: `${r.id} is not an agreed invoice of this negotiation` };
    if (n.agreement !== undefined && sha256Hex(n.agreement) !== n.agreement_sha256) return { ok: false as const, reason: "the agreement kept is not the one whose SHA-256 is named" };
    if (o) {
      if (o.id === r.id) return { ok: false as const, reason: "an invoice cannot replace itself" };
      const why = this.notReplaceable(o, n);
      if (why) return { ok: false as const, reason: why };
      if (r.vendor !== o.vendor || r.currency !== o.currency || !r.invoice_no.startsWith(`${o.invoice_no}-`))
        return { ok: false as const, reason: `${r.id} is not the agreed replacement of ${o.id}` };
    }
    // 27 Nov (red team, runner finding 2): one bill is paid once, as issued or as agreed. Another invoice from this supplier
    // that is this bill (its number as issued, or another negotiation's agreed "<original>-<sha8>"), not rejected or
    // blocked, means this agreed invoice is not recorded (agreed() then withdraws it): on the seeded scene, with no
    // original named, a second negotiation of one bill filed a second payable invoice for it.
    const bill = invoiceKey(o?.invoice_no ?? n.original_invoice_no);
    const twin = (db.prepare("SELECT id, invoice_no, status FROM ap_invoices WHERE id NOT IN (?, ?) AND status NOT IN ('rejected', 'blocked') AND vendor = ?").all(r.id, o?.id ?? "", r.vendor) as { id: string; invoice_no: string; status: string }[])
      .find((x) => { const k = invoiceKey(x.invoice_no); return k === bill || (k.startsWith(`${bill}-`) && /^[0-9A-F]{8}$/.test(k.slice(bill.length + 1))); });
    if (twin) return { ok: false as const, reason: `${twin.id} (${twin.invoice_no}, ${twin.status.replace(/_/g, " ")}) is already this bill; one bill is paid once` };
    const off = c(n.original_amount) - c(r.total);
    const facts = {
      original_invoice_id: o?.id ?? null, original_invoice_no: o?.invoice_no ?? n.original_invoice_no, original_amount: n.original_amount,
      agreed_amount: r.total, discount: `${Math.floor(off / 100)}.${String(off % 100).padStart(2, "0")}`, currency: r.currency,
      agreement_sha256: n.agreement_sha256, turns: n.turns, superseded: !!o,
      ...(n.agreement !== undefined ? { agreement: n.agreement } : {}), ...(n.offers ? { offers: n.offers } : {}), ...(n.keys ? { keys: n.keys } : {}),
    };
    db.transaction(() => {
      if (o) {
        if (o.proposal_id) db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ? AND status = 'PENDING_APPROVAL'").run(o.proposal_id);
        setStatus(db, o.id, "rejected", "human", { reason: `superseded by the negotiated terms: ${r.id} (${r.invoice_no}, ${r.currency} ${r.total}), agreement SHA-256 ${n.agreement_sha256}` }, now);
        audit(db, "human", "ap.superseded", o.id, { by: r.id, invoice_no: r.invoice_no, total: r.total, agreement_sha256: n.agreement_sha256, ...(o.proposal_id ? { proposal_id: o.proposal_id } : {}) }, now);
      }
      audit(db, "human", "ap.negotiated", r.id, facts, now);
    }).immediate();
    if (o) syncLedger(db, now);
    return { ok: true as const, invoice: this.view(apInvoice(db, r.id)!), superseded: o ? this.view(apInvoice(db, o.id)!) : null };
  }

  /**
   * A negotiation's agreed terms filed in one engine action (/v1/try/negotiate/agreed): the original is asked first (open,
   * its payment not signed), then the agreed invoice is composed and filed as ready, then recorded as replacing the
   * original. Nothing else runs in between. When the agreed invoice is not filed as ready, or cannot be recorded, it is
   * withdrawn (rejected, its payment superseded, its booking reversed): one bill never leaves two payable invoices.
   */
  agreed(input: ComposeInput, n: NegotiatedFacts): Promise<
    { ok: true; invoice: InvoiceView; superseded: InvoiceView | null }
    | { ok: false; code: "not_recorded" | "not_ready"; reason: string; invoice?: InvoiceView }
    | ComposeRefusal> {
    return this.act(async () => {
      const { db } = this.deps;
      const o = n.original_id ? apInvoice(db, n.original_id) : null;
      if (n.original_id && !o) return { ok: false as const, code: "not_recorded" as const, reason: "no such invoice" };
      const before = o ? this.notReplaceable(o, n) : null;
      if (before) return { ok: false as const, code: "not_recorded" as const, reason: before };
      const fields = checkCompose(input, this.suppliers(), this.now());
      if ("refused" in fields) return fields;
      const bytes = await invoicePdf({ fields, supplierKey: input.supplier_key, billTo: `${this.deps.company.name} · Purser demo` });
      const up = await this.ingest({ bytes, filename: `${fields.invoiceNo.replace(/[^A-Za-z0-9-]/g, "-")}.pdf`, mime: "application/pdf" });
      const filed = up.invoice;
      if (!filed || filed.status !== "ready") {
        const left = filed ? this.withdraw(filed.id, "it was not filed as ready to pay") : undefined;
        return { ok: false as const, code: "not_ready" as const, reason: "the agreed invoice was not filed as ready to pay", ...(left ? { invoice: left } : {}) };
      }
      const done = this.recordNegotiated(filed.id, n);
      if (!done.ok) {
        this.withdraw(filed.id, `it could not replace the original: ${done.reason}`);
        return { ok: false as const, code: "not_recorded" as const, reason: done.reason };
      }
      return done;
    });
  }

  /** An agreed invoice taken back: rejected (its open payment superseded, its booking reversed), with why. */
  private withdraw(id: string, why: string): InvoiceView | undefined {
    const { db } = this.deps;
    const now = this.now();
    const inv = apInvoice(db, id);
    if (!inv) return undefined;
    if (inv.status !== "rejected") {
      db.transaction(() => {
        if (inv.proposal_id) db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ? AND status = 'PENDING_APPROVAL'").run(inv.proposal_id);
        setStatus(db, id, "rejected", "human", { reason: `the negotiated terms were withdrawn: ${why}` }, now);
        audit(db, "human", "ap.withdrawn", id, { why, ...(inv.proposal_id ? { proposal_id: inv.proposal_id } : {}) }, now);
      }).immediate();
      syncLedger(db, now);
    }
    return this.view(apInvoice(db, id)!);
  }

  /** The hands-on demo's Reject of a held invoice: the inbox's own rejection, with its reason kept; nothing is paid. */
  rejectHold(id: string): Promise<{ ok: true; invoice: InvoiceView } | { ok: false; reason: string }> {
    return this.act(async () => {
      try {
        const next = await rejectApInvoice(this.deps.db, id, "rejected by the visitor on the hands-on demo (sandbox)", {}, this.now());
        return { ok: true as const, invoice: this.view(next) };
      } catch (e) {
        return { ok: false as const, reason: message(e) };
      }
    });
  }

  /**
   * The suppliers this company has on file: the payees the seed recorded in the ledger (active, with the same IBAN),
   * never one made up here. Their IBANs are published test IBANs.
   */
  suppliers(): SupplierOnFile[] {
    const rows = this.deps.db.prepare("SELECT name, iban_sha256 FROM beneficiaries WHERE status = 'ACTIVE'").all() as { name: string; iban_sha256: string }[];
    return SEEDED_SUPPLIERS.filter((p) => rows.some((r) => r.name.trim() === p.name && r.iban_sha256 === ibanSha(p.iban))).map((p) => ({ key: p.key, name: p.name, iban: p.iban, bic: p.bic }));
  }

  /**
   * "Write your own": the visitor's fields, checked, written in the clean sample's layout, rendered to a PDF with the
   * product's PDF writer and filed through the inbox like any upload. A refused field comes back naming it. The text
   * stays in this company's ledger: it goes to no model outside the engine's own reader and is never logged.
   */
  compose(input: ComposeInput): Promise<UploadResult | ComposeRefusal> {
    return this.act(async () => {
      const fields = checkCompose(input, this.suppliers(), this.now());
      if ("refused" in fields) return fields;
      // The enterprise layout (src/engine/invoicePdf.ts), billed to this test company.
      const bytes = await invoicePdf({ fields, supplierKey: input.supplier_key, billTo: `${this.deps.company.name} · Purser demo` });
      return this.ingest({ bytes, filename: `${fields.invoiceNo.replace(/[^A-Za-z0-9-]/g, "-")}.pdf`, mime: "application/pdf" });
    });
  }

  // ---- The hands-on demo (purser-try): the signed terms, the one pay route, the export ----

  /** A proposal's stored terms as the passkey signed them: the object, its canonical text and hash, and whether an approval is stored. */
  terms(proposalId: string): TermsView | null {
    const { db } = this.deps;
    const p = db.prepare("SELECT proposal_id, status, terms_json, terms_sha256, expires_at FROM proposals WHERE proposal_id = ?").get(proposalId) as
      { proposal_id: string; status: string; terms_json: string; terms_sha256: string; expires_at: string | null } | undefined;
    if (!p) return null;
    const terms = JSON.parse(p.terms_json) as Terms;
    const approved = !!db.prepare("SELECT 1 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId);
    // The hash as stored with the proposal (what the passkey signs), never one recomputed from the instruction's text.
    const converts = !!(terms as { conversion?: unknown }).conversion;
    return { proposal_id: p.proposal_id, status: p.status, terms, canonical: canonicalTerms(terms), terms_sha256: p.terms_sha256, approved, expires_at: p.expires_at, ...(converts ? { fx_limit_bps: fxMarkupLimitBps(db) } : {}) };
  }

  /**
   * The one pay route of the hands-on demo: the visitor's terms with the visitor's own signature, through the product's
   * own verifier and executor. Two layers answer, always both:
   *   the signature  the product's verifier (verifyApprovalSignature, counter 0 as reverifyPasskeyApprovals) on the
   *                  credential the browser sent, over the hash of the terms sent;
   *   the executor   the gate every executor runs (beginExecution), asked with the sent terms written into the
   *                  payment instruction, inside one synchronous transaction that is always rolled back.
   * Only when both say yes, and the approved payment is held, does the real executor pay (the private pay(), as approve
   * and retry do), from the stored terms, which are then the signed ones. Nothing of a refused attempt is kept but its
   * audit row (try.pay, with no values).
   */
  paySigned(proposalId: string, sent: Record<string, unknown>, credential: unknown): Promise<PaySignedResult | { bad: string } | null> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      const stored = this.terms(proposalId);
      if (!stored) return null;
      const bad = checkSent(stored.terms as Record<string, unknown>, sent);
      if (bad) return { bad };
      // Transfers made: those the bank created (a payout row whose request failed before the bank answered moved nothing).
      const transfers = () => (db.prepare("SELECT COUNT(*) AS n FROM transfers WHERE transfer_id IS NOT NULL").get() as { n: number }).n;
      const sentSha = termsHash(sent as Terms);
      const changed = Object.keys(stored.terms).filter((k) => JSON.stringify((stored.terms as Record<string, unknown>)[k]) !== JSON.stringify(sent[k]));
      // What was signed: the approval's own hash once there is one, else the proposal's stored hash.
      const approvedSha = (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId) as { approved_sha256: string } | undefined)?.approved_sha256;
      const base = { signed_sha256: approvedSha ?? stored.terms_sha256, sent_sha256: sentSha, changed, transfers_before: transfers() };
      const finish = (outcome: PaySignedResult["outcome"], layers: PaySignedResult["layers"], settled: Settled | null): PaySignedResult => {
        audit(db, "human", "try.pay", proposalId, { outcome, changed, signature_verified: layers.signature.verified, executor_accepted: layers.executor.accepted }, now);
        const out = { outcome, layers, ...base, transfers_after: transfers(), settled };
        if (outcome !== "paid" && outcome !== "refused") return out;
        const decision = { outcome, signature: layers.signature, executor: layers.executor, signed_sha256: base.signed_sha256, sent_sha256: base.sent_sha256, changed, transfers_before: base.transfers_before, transfers_after: out.transfers_after };
        return { ...out, proof: proofBundle(db, { proposalId, stored: stored.terms as Record<string, unknown>, sent, credential, passkey: activePasskey(db), decision, now }) };
      };
      if (!stored.approved) {
        return finish("not_signed", { signature: { verified: null, reason: "Not checked: this payment has no approval yet. Approve it first." }, executor: { accepted: null, said: "Not asked: nothing is approved." } }, null);
      }

      // The signature layer: the product's verifier on the browser's own credential, over the terms sent.
      let signature: { verified: boolean; reason: string };
      const pk = activePasskey(db);
      if (!pk) signature = { verified: false, reason: "This company has no approval passkey. Nothing was paid." };
      else {
        try {
          const v = await verifyApprovalSignature(credential as AuthenticationResponseJSON, sentSha, pk, 0);
          signature = v.ok ? { verified: true, reason: "Your signature is over exactly these terms." } : { verified: false, reason: plainRefusal(v.reason) };
        } catch {
          signature = { verified: false, reason: "This signature could not be read. Nothing was paid." };
        }
      }

      // The executor layer: the executor's own gate, asked with the sent terms in the payment instruction, rolled back.
      const ROLLBACK = Symbol("rollback");
      let executor: { accepted: boolean; said: string | null } = { accepted: false, said: null };
      try {
        db.transaction(() => {
          db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(sent), proposalId);
          try {
            beginExecution(db, proposalId, () => {}, now);
            executor = { accepted: true, said: null };
          } catch (e) {
            executor = { accepted: false, said: message(e) };
          }
          throw ROLLBACK;
        })();
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }

      const status = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string }).status;
      const layers = { signature, executor };
      if (signature.verified && executor.accepted && status === "APPROVED") {
        const settled = await this.pay(proposalId);
        const after = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string }).status;
        return finish(after === "EXECUTED" ? "paid" : "failed", layers, settled);
      }
      if (signature.verified && executor.accepted && status === "FAILED") return finish("failed", layers, null);
      // Paid once: only for the very terms that were signed and paid, with a signature over them.
      if (status === "EXECUTED") return finish(signature.verified && sentSha === base.signed_sha256 ? "paid_once" : "refused", layers, null);
      if (/expired/i.test(executor.said ?? "")) return finish("expired", layers, null);
      return finish("refused", layers, null);
    });
  }

  // ---- Purser Cloud's Airwallex actions (14 Nov): a new supplier, one batch for every ready invoice, money in ----

  /**
   * A new supplier from an invoice waiting for it: the owner's record of how the account was confirmed (a contact the
   * company already had) and the supplier's address, then the payee's bank is asked whether the account carries the
   * supplier's name, then a payee_add proposal for the CFO's passkey. Approved, the executor adds the supplier at the
   * bank (Airwallex's schema, validation and create, through the host's rails) and checks the invoice again.
   */
  addSupplier(invoiceId: string, v: { by: string; how: string; address: { street: string; city: string; postcode: string } }): Promise<{ ok: true; proposal: ProposalView; name_check: NameCheckView | null } | { ok: false; reason: string; name_check: NameCheckView | null }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      try {
        const open = db.prepare("SELECT add_id, status FROM payee_adds WHERE source = ? AND status IN ('REQUESTED', 'VERIFIED') ORDER BY created_at DESC LIMIT 1").get(invoiceId) as { add_id: string; status: string } | undefined;
        const req = open ?? requestPayeeAddForInvoice(db, invoiceId, "human", now);
        if ((open?.status ?? "REQUESTED") === "REQUESTED") recordPayeeAddVerification(db, req.add_id, { by: v.by, how: v.how, actor: "human", address: v.address }, now);
        const verifier = this.deps.payeeVerifier?.() ?? Object.assign(new FakePayeeNames(), { confirmAll: true });
        const p = await checkThenProposePayeeAdd(db, verifier, req.add_id, "human", now);
        const proposal = this.proposal(p.proposal_id);
        if (!proposal) return { ok: false, reason: `${p.proposal_id} was filed but is not in the ledger`, name_check: null };
        return { ok: true, proposal, name_check: this.lastNameCheck() };
      } catch (e) {
        return { ok: false, reason: message(e), name_check: this.lastNameCheck() };
      } finally {
        this.deps.afterMoney?.();
      }
    });
  }

  /** The payee's bank's latest answer on a new supplier, and who asked it (Airwallex, or the labelled stand-in). */
  private lastNameCheck(): NameCheckView | null {
    const r = this.deps.db.prepare("SELECT vendor, code, match, label, checked_at FROM payee_name_checks ORDER BY checked_at DESC, rowid DESC LIMIT 1").get() as Omit<NameCheckView, "source"> | undefined;
    return r ? { ...r, source: r.label.startsWith(STAND_IN_LABEL) ? "stand-in" : "airwallex" } : null;
  }

  /**
   * Pay all ready invoices with one passkey signature: each is planned as on its own (its own exact terms, FX for its
   * shortfall), then one batch over them is filed; the CFO signs the batch's total and lines. Invoices that cannot be
   * planned are named with the reason and left out.
   */
  proposeBatch(invoiceIds: string[]): Promise<{ ok: true; proposal: ProposalView; planned: { id: string; proposal_id: string }[]; not_planned: { id: string; reason: string }[] } | { ok: false; reason: string; not_planned?: { id: string; reason: string }[] }> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try {
        const out = await payApInvoices(db, rails.rail, invoiceIds, this.now());
        if (!out.batch) return { ok: false, reason: "none of the invoices could be planned", not_planned: out.notPlanned };
        const proposal = this.proposal(out.batch.proposal_id);
        if (!proposal) return { ok: false, reason: `${out.batch.proposal_id} was filed but is not in the ledger` };
        return { ok: true, proposal, planned: out.planned, not_planned: out.notPlanned };
      } catch (e) {
        return { ok: false, reason: message(e) };
      } finally {
        this.deps.afterMoney?.();
      }
    });
  }

  /**
   * Money in: a deposit on the bank's simulation (test money) into the company's USD account, recorded once and booked
   * as a payment that names no invoice (held in suspense, 2900, until someone says what it is).
   */
  depositIn(a: { amountCents: number; reference: string; payer: string }): Promise<{ ok: true; deposit_id: string; status: string; amount: string; currency: string; settled: Settled } | { ok: false; reason: string }> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try {
        if (!Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) return { ok: false, reason: "an amount above zero" };
        const d = await rails.sim.simulateDeposit({ globalAccountId: await rails.rail.usdGlobalAccountId(), amountCents: a.amountCents, reference: a.reference, payerName: a.payer });
        const now = this.now();
        matchReceipt(db, { deposit_id: d.id, global_account_id: null, currency: d.currency, amount_cents: d.amountCents, reference: d.reference, payer: a.payer, received_at: now.toISOString() }, now);
        this.deps.afterMoney?.();
        const settled = await this.settle(null);
        return { ok: true, deposit_id: d.id, status: d.status, amount: fromCents(d.amountCents), currency: d.currency, settled };
      } catch (e) {
        return { ok: false, reason: message(e) };
      }
    });
  }

  /** The company as the product's sync format: the batches a runner's push would send to an empty cloud (no archive files). */
  exportBatch(): { format: "purser.cloud-sync/v1"; company: string; made_at: string; batches: Record<string, unknown>[] } {
    const now = this.now();
    const batches = batchesFor(this.deps.db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now });
    return { format: "purser.cloud-sync/v1", company: this.deps.company.name, made_at: now.toISOString(), batches };
  }

  /**
   * The company's records as an A4 PDF a person reads (owner, 14 Nov): built from exportBatch alone, its own records,
   * with the demo's address in its footer (src/engine/recordsPdf.ts).
   */
  async exportPdf(): Promise<Uint8Array> {
    const bytes = await recordsPdf(this.exportBatch(), `${this.deps.rp.origin}/try`);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}

/** The last row of the audit log (0 for none). */
function lastSeq(db: DB): number {
  return (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
}

/** What the Claude calls written after `afterSeq` cost, in micro-USD: the readings' and the agents' runs' own figures. */
function claudeCost(db: DB, afterSeq: number): number {
  const rows = db.prepare("SELECT payload_json FROM audit_log WHERE seq > ? AND event IN ('claude.read', 'agent.run')").all(afterSeq) as { payload_json: string }[];
  let n = 0;
  for (const r of rows) {
    try { const c = (JSON.parse(r.payload_json) as { cost_usd_micros?: unknown }).cost_usd_micros; if (typeof c === "number" && c > 0) n += c; } catch { /* a row without a cost adds nothing */ }
  }
  return n;
}

/** Cents as a two-decimal amount, "-" first when negative (a position below zero is shown as it is). */
const signedCents = (c: number): string => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

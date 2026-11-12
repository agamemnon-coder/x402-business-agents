// One company's engine as a small set of actions on a ledger handle. The same class runs in the Node tests (on
// better-sqlite3) and in a Durable Object (on its own SQLite, through src/db/doSql.ts): it takes the ledger and its
// outside world as arguments and holds no state of its own beyond the order of its actions. Every call it makes is the
// engine's own, unchanged: the inbox reads and checks an upload (src/ap/inbox.ts), the payment is filed for approval
// (src/ap/pay.ts), a passkey signs the exact terms (src/passkey), the executor pays on the rails it is handed
// (src/executors), then the payment is followed, booked (src/ledger/feed.ts) and archived (src/vault).
//
// What the host adds is small: one action at a time, the passkey's confirmation (a signed-in owner is the confirmation
// a person gives on a runner), and what a page needs to show of an invoice, a proposal and the events.
//
// It has no payables folder: the ledger must have its own document store (src/ap/docStore.ts useDocStore) before a
// host is made over it, so no file is ever written.
import type Anthropic from "@anthropic-ai/sdk";
import { seedTreasury } from "../agents/euroBill.js";
import { actionsFor } from "../ap/detail.js";
import { docStoreOf } from "../ap/docStore.js";
import { ingestDocument, type IngestResult } from "../ap/inbox.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import type { Asker } from "../ap/read.js";
import { apInvoice, apInvoices, type ApInvoiceRow } from "../ap/store.js";
import { firstScreenFacts, isPayablesPayment, payablesFacts } from "../approve/client.js";
import { audit, verifyAuditChain } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { execute, type Rails } from "../executors/index.js";
import { verifyLedger } from "../ledger/core.js";
import { syncLedger } from "../ledger/feed.js";
import { fromCents } from "../lib/money.js";
import { confirmPasskey, activePasskey, openEnrolment, pendingPasskeys } from "../passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../passkey/process.js";
import { challengeFor, verifyApprovalSignature } from "../passkey/webauthn.js";
import { phonePhrases, t } from "../ui/i18n.js";
import { syncVault, type YearIndex } from "../vault/build.js";
import { closedPeriods, invoiceDocs, receipts } from "../vault/data.js";
import { yearIndexPath } from "../vault/layout.js";
import { sha256, type VaultSink } from "../vault/sink.js";
import { actionBudget, type ClaudeAccess } from "./budget.js";
import { publicEvent, type EngineEvent, type EventRow } from "./events.js";
import { checkCompose, invoiceText, SEEDED_SUPPLIERS, type ComposeInput, type ComposeRefusal, type Sample, type SupplierOnFile } from "./tryWorld.js";
import { pdfOf } from "../e2e/documents.js";
import { ibanSha } from "../agents/invoice.js";
import { canonicalTerms, termsHash, type Terms } from "../lib/terms.js";
import { beginExecution } from "../policy/approvals.js";
import { batchesFor } from "../cloudsync/client.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

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
}

/** What an upload, a sample or a composed invoice answers. */
export interface UploadResult { kind: string; sha256: string; invoice: InvoiceView | null }

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
}

export interface InvoiceView {
  id: string; status: string; status_words: string; payable: boolean; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; read_by: string;
  findings: { level: string; code: string; message: string }[];
  doc_sha256: string;
  proposal: ProposalView | null;
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

export interface VaultFile { path: string; kind: string; bytes: number; sha256: string; added_at: string }

/** The inbox's folder argument. It is never used: the ledger has its own document store (checked when the host is made). */
const NO_FOLDER = "/purser-engine-has-no-folder";
/** Whose each passkey is, by the id the caller (the cloud) gives its person; the host's own table, as feed.ts keeps one. */
const PASSKEY_PEOPLE = "CREATE TABLE IF NOT EXISTS engine_passkey_people (credential_id TEXT PRIMARY KEY, person TEXT NOT NULL)";
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
  [/^Unexpected (authentication response origin|cross-origin|top origin)\b|^Detected cross-origin\b/, "This signature was made on another website than this one. Nothing was paid."],
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
export interface TermsView { proposal_id: string; status: string; terms: Terms; canonical: string; terms_sha256: string; approved: boolean; expires_at: string | null }

/** What the one pay route answers; a layer that did not run says so (null). */
export interface PaySignedResult {
  outcome: "paid" | "refused" | "paid_once" | "not_signed" | "expired" | "failed";
  layers: { signature: { verified: boolean | null; reason: string }; executor: { accepted: boolean | null; said: string | null } };
  signed_sha256: string; sent_sha256: string; changed: string[]; transfers_before: number; transfers_after: number; settled: Settled | null;
}

/** The keys the visitor may change on the pay screen; every other key must be the stored one. */
export const CHANGEABLE_TERMS = ["amount", "beneficiary_name", "iban_last4"] as const;

/** Why the sent terms cannot be tried at all (their shape), or null. */
function checkSent(stored: Record<string, unknown>, sent: Record<string, unknown>): string | null {
  const keys = Object.keys(stored).sort(), got = Object.keys(sent).sort();
  if (keys.length !== got.length || keys.some((k, i) => k !== got[i])) return "the terms must have exactly the keys of the signed terms";
  for (const k of keys) {
    if ((CHANGEABLE_TERMS as readonly string[]).includes(k)) continue;
    if (JSON.stringify(stored[k]) !== JSON.stringify(sent[k])) return "only the amount, the payee and the account ending can be changed here";
  }
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
  }> {
    const { db, rails } = this.deps;
    const pk = activePasskey(db);
    const balances = await rails.rail.balances();
    const claude = this.deps.claude ? await this.deps.claude.status() : { on: false, cap_micros: null, spent_micros: null };
    return {
      mode: "test_money",
      passkey: pk ? { credential_id: pk.credential_id, label: pk.label } : null,
      balances: Object.fromEntries(Object.entries(balances).map(([currency, b]) => [currency, fromCents(b?.availableCents ?? 0)])),
      chains: { audit: verifyAuditChain(db).ok, ledger: verifyLedger(db).ok },
      reader: claude.on ? "claude" : "parser", agents: claude.on && this.deps.claude?.agents ? "live" : "code", spent_micros: claude.spent_micros ?? claudeCost(db, 0), cap_micros: claude.cap_micros,
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

  /** The treasury's test money, floors and payees on the rails, once; safe to repeat. */
  seed(): Promise<void> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try { await seedTreasury(db, rails.rail, rails.sim); } finally { this.deps.afterMoney?.(); }
    });
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
      ingestDocument(db, { dir: NO_FOLDER, reader, now: () => this.now(), agents: agents.on, claude: agents.client, coder: agents.client, readInParallel: true }, { bytes, filename: doc.filename, ...(doc.mime ? { mime: doc.mime } : {}), source: "upload" }));
    if (out.kind === "duplicate_document") return { kind: out.kind, sha256: out.sha256, invoice: out.invoice_id ? this.invoice(out.invoice_id) : null };
    const inv = firstInvoice(out);
    // Read again: a note written after the checks is on the row, not on what the inbox returned.
    return { kind: out.kind, sha256: out.kind === "invoice" ? out.invoice.doc_sha256 : sha256(bytes), invoice: inv ? this.invoice(inv.id) : null };
  }

  invoices(): InvoiceView[] {
    return apInvoices(this.deps.db).map((i) => this.view(i));
  }

  invoice(id: string): InvoiceView | null {
    const inv = apInvoice(this.deps.db, id);
    return inv ? this.view(inv) : null;
  }

  private view(inv: ApInvoiceRow): InvoiceView {
    return {
      id: inv.id, status: inv.status, status_words: t(this.deps.company.lang, `status.${inv.status}`), payable: actionsFor(inv).pay.allowed,
      vendor: inv.vendor, invoice_no: inv.invoice_no, currency: inv.currency, total: inv.total, due_date: inv.due_date, read_by: inv.read_by,
      findings: inv.findings.map((f) => ({ level: f.level, code: f.code, message: f.detail })),
      doc_sha256: inv.doc_sha256,
      proposal: inv.proposal_id ? this.proposal(inv.proposal_id) : null,
    };
  }

  /** Files the invoice's payment for the CFO's approval. A reason not to (the engine's own words) comes back, and no proposal is made. */
  propose(invoiceId: string): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try {
        // Task A6: the Payer proposes the rail, the day and the currency on the engine's plan when the CFO opens Pay. It may
        // only propose within that plan: held or off the plan, code's plan stands and is filed for Face ID, labelled.
        const out = await this.withClaude(`engine.propose:${invoiceId}`, (reader, agents) => payApInvoice(db, rails.rail, invoiceId, this.now(), reader, { on: agents.on, claude: agents.client, planStands: true }));
        if (out.kind !== "proposed") return { ok: false, reason: out.reason };
        const proposal = this.proposal(out.proposal.proposal_id);
        if (!proposal) return { ok: false, reason: `${out.proposal.proposal_id} was filed but is not in the ledger` };
        return { ok: true, proposal };
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
    return { id: p.proposal_id, kind: p.kind, status: p.status, terms_sha256: p.terms_sha256, challenge: challengeFor(p.terms_sha256), facts, warnings };
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
   * person confirms the fingerprint the phone shows; here the caller is the signed-in owner, and that is the confirmation.
   */
  passkeyFinish(a: { code: string; credential: unknown; label: string; person?: string }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      const item: InboxItem = { ticket: "engine", kind: "registration", proposal_id: null, body: JSON.stringify({ code: a.code, credential: a.credential }), received_at: now.toISOString() };
      const out = await processRegistration(db, item, { label: a.label }, now);
      if (out.status === "refused" || !out.credentialId) return { ok: false, reason: out.message };
      if (out.status === "pending") {
        const waiting = pendingPasskeys(db, now).find((p) => p.credential_id === out.credentialId);
        if (!waiting) return { ok: false, reason: "the enrolment window closed before the passkey was confirmed; start again" };
        try { confirmPasskey(db, waiting.fingerprint, now); } catch (e) { return { ok: false, reason: message(e) }; }
      }
      // Whose passkey it is, by the caller's own id for the person: a name is free text and two people may share one.
      if (a.person !== undefined) {
        db.exec(PASSKEY_PEOPLE);
        db.prepare("INSERT INTO engine_passkey_people (credential_id, person) VALUES (?, ?) ON CONFLICT(credential_id) DO UPDATE SET person = excluded.person").run(out.credentialId, a.person);
      }
      return { ok: true, credential_id: out.credentialId };
    });
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
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown; hold?: boolean }): Promise<{ status: string; message: string; settled: Settled | null; held?: true }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      // The terms the request names must be the proposal's own. The signature binds the stored terms either way, so no
      // money is at risk; but an approval sent with other terms is not the one the person saw, and is refused as such.
      const held = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { terms_sha256: string } | undefined;
      if (held && held.terms_sha256 !== a.terms_sha256) return { status: "refused", message: REFUSED_TERMS_NOT_ON_SCREEN, settled: null };
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
   * Try again: a payment that was approved but whose execution failed (the bank was away, say) is run once more, by
   * the executor's own path for that, the one a runner takes when it runs a FAILED proposal again: it starts again
   * from its last finished step, and a payout written before the failure is looked up at the bank by its request id
   * and adopted, never sent blind a second time (src/executors/invoicePayment.ts, src/policy/saga.ts). Only a FAILED
   * invoice payment is run; anything else (paid, never approved, refused, not there) answers nothing_to_retry and
   * nothing runs. Then, as after an approval, the payment is followed, booked, archived and fed.
   */
  retry(proposalId: string): Promise<{ status: "retried" | "nothing_to_retry"; message: string; settled: Settled | null }> {
    return this.act(async () => {
      const p = this.deps.db.prepare("SELECT status, kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; kind: string } | undefined;
      if (!p) return { status: "nothing_to_retry", message: `no proposal ${proposalId}`, settled: null };
      if (p.status !== "FAILED" || p.kind !== "invoice_payment") return { status: "nothing_to_retry", message: `${proposalId} is ${p.status}: there is nothing to try again; nothing was paid`, settled: null };
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
    const n = (db.prepare("SELECT COUNT(*) AS n FROM ap_documents").get() as { n: number }).n;
    if (n >= max) throw new Error(`this test company holds ${n} documents, its limit of ${max}; nothing was filed`);
  }

  /** A capped company takes PDF files only: an e-mail may carry twenty documents, and a photo is filed as another file. */
  private pdfOnly(bytes: Uint8Array, filename: string): void {
    if (this.deps.maxDocuments !== undefined && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new Error(`${filename.slice(0, 100)}: a test company takes PDF files only; nothing was filed`);
    }
  }

  /** The sample invoices, in the tray's order: what the visitor does, never what the engine will answer. */
  samples(): { key: string; title: string; filename: string }[] {
    return (this.deps.samples ?? []).map((s) => ({ key: s.key, title: s.title, filename: s.filename }));
  }

  /** A sample through the inbox, as an upload of its PDF; null for a key that is not a sample. */
  uploadSample(key: string): Promise<UploadResult | null> {
    return this.act(async () => {
      const s = (this.deps.samples ?? []).find((x) => x.key === key);
      return s ? this.ingest({ bytes: Buffer.from(s.base64, "base64"), filename: s.filename, mime: "application/pdf" }) : null;
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
      const bytes = await pdfOf(invoiceText(fields));
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
    return { proposal_id: p.proposal_id, status: p.status, terms, canonical: canonicalTerms(terms), terms_sha256: p.terms_sha256, approved, expires_at: p.expires_at };
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
        return { outcome, layers, ...base, transfers_after: transfers(), settled };
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

  /** The company as the product's sync format: the batches a runner's push would send to an empty cloud (no archive files). */
  exportBatch(): { format: "purser.cloud-sync/v1"; company: string; made_at: string; batches: Record<string, unknown>[] } {
    const now = this.now();
    const batches = batchesFor(this.deps.db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now });
    return { format: "purser.cloud-sync/v1", company: this.deps.company.name, made_at: now.toISOString(), batches };
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

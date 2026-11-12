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
import { challengeFor } from "../passkey/webauthn.js";
import { phonePhrases, t } from "../ui/i18n.js";
import { syncVault, type YearIndex } from "../vault/build.js";
import { closedPeriods, invoiceDocs, receipts } from "../vault/data.js";
import { yearIndexPath } from "../vault/layout.js";
import { sha256, type VaultSink } from "../vault/sink.js";
import { publicEvent, type EngineEvent, type EventRow } from "./events.js";

/** The reader that always takes the parser: no model is asked, and the invoice says it was read by the parser. */
export const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no model is asked: the parser reads" }) } as Asker;

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

  async status(): Promise<{ mode: "test_money"; passkey: { credential_id: string; label: string } | null; balances: Record<string, string>; chains: { audit: boolean; ledger: boolean } }> {
    const { db, rails } = this.deps;
    const pk = activePasskey(db);
    const balances = await rails.rail.balances();
    return {
      mode: "test_money",
      passkey: pk ? { credential_id: pk.credential_id, label: pk.label } : null,
      balances: Object.fromEntries(Object.entries(balances).map(([currency, b]) => [currency, fromCents(b?.availableCents ?? 0)])),
      chains: { audit: verifyAuditChain(db).ok, ledger: verifyLedger(db).ok },
    };
  }

  /** The treasury's test money, floors and payees on the rails, once; safe to repeat. */
  seed(): Promise<void> {
    return this.act(async () => {
      const { db, rails } = this.deps;
      try { await seedTreasury(db, rails.rail, rails.sim); } finally { this.deps.afterMoney?.(); }
    });
  }

  /** A document through the inbox: filed, read and checked. What the inbox refuses (not a PDF, too large) is thrown. */
  upload(doc: { bytes: Uint8Array; filename: string; mime?: string }): Promise<{ kind: string; sha256: string; invoice: InvoiceView | null }> {
    return this.act(async () => {
      const { db, reader } = this.deps;
      const bytes = Buffer.isBuffer(doc.bytes) ? doc.bytes : Buffer.from(doc.bytes.buffer, doc.bytes.byteOffset, doc.bytes.byteLength);
      const out = await ingestDocument(db, { dir: NO_FOLDER, reader, now: () => this.now() }, { bytes, filename: doc.filename, ...(doc.mime ? { mime: doc.mime } : {}), source: "upload" });
      if (out.kind === "duplicate_document") return { kind: out.kind, sha256: out.sha256, invoice: out.invoice_id ? this.invoice(out.invoice_id) : null };
      const inv = firstInvoice(out);
      // Read again: a note written after the checks is on the row, not on what the inbox returned.
      return { kind: out.kind, sha256: out.kind === "invoice" ? out.invoice.doc_sha256 : sha256(bytes), invoice: inv ? this.invoice(inv.id) : null };
    });
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
      const { db, rails, reader } = this.deps;
      try {
        const out = await payApInvoice(db, rails.rail, invoiceId, this.now(), reader);
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

  /** Opens the window in which one passkey can be created (a new one replaces the same person's earlier one). */
  passkeyStart(): Promise<{ challenge: string; code: string; exclude: string[] }> {
    return this.act(async () => {
      const { db, rp } = this.deps;
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
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown }): Promise<{ status: string; message: string; settled: Settled | null }> {
    return this.act(async () => {
      const { db } = this.deps;
      const now = this.now();
      // Only these three fields travel: the decision is always an approval (rejecting is not one of the host's actions).
      const item: InboxItem = { ticket: "engine", kind: "assertion", proposal_id: null, body: JSON.stringify({ proposal_id: a.proposal_id, terms_sha256: a.terms_sha256, credential: a.credential }), received_at: now.toISOString() };
      const out = await processAssertion(db, item, now);
      if (out.status === "refused") return { status: out.status, message: plainRefusal(out.message), settled: null };
      if (out.status !== "approved" || !out.proposalId) return { status: out.status, message: out.message, settled: null };
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
}

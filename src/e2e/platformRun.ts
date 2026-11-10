// The platform end-to-end (Max, 10 November: "multiple accounts, T0, and the invoice-collecting backend"): three test
// SMEs, each its own Purser company on its own Airwallex connected account, run through the real product path:
//
//   invoice in (PDF upload or e-mail) → read (Claude, or the parser in a dry run) and checked → new supplier verified by
//   a person and approved with the CFO's passkey → the invoice (or a batch) approved with the CFO's passkey over the
//   exact terms → Airwallex pays on behalf of the company's connected account, Purser's fee with the payout
//   (application_fee_options) → followed to PAID → booked in the company's books → posted to T:0 → one receipt per
//   payment (verify-receipt checks it offline) and one run summary.
//
// Every company runs on its own ledger (SQLite file), its own account binding (signed with the run's own key: a test
// world's stand-in for Purser Cloud's) and its own test passkey (a software authenticator, labelled so). T:0 has one
// sandbox entity: every entry is tagged with the company and its PUR id so the three stay separable there.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { signBinding } from "../../cloud/src/awxPlatform.js";
import { storeBinding } from "../airwallex/binding.js";
import { BINDING_TTL_MS, type PlatformStatus } from "../airwallex/platform.js";
import type { AirwallexRail, PayoutRail, SandboxSim } from "../airwallex/port.js";
import { apJournal, type ApEntry } from "../ap/books.js";
import { payApInvoices } from "../ap/batchPay.js";
import { ingestDocument, ingestEmail, type InboxDeps } from "../ap/inbox.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import type { Asker } from "../ap/read.js";
import { apInvoice, type ApInvoiceRow } from "../ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import type { Posting } from "../accounting/books.js";
import { buildEntries, functionalCurrency, pushBooks, resolveAccounts, type T0Client, type T0Entry, type T0Rate } from "../accounting/t0.js";
import { T0_SANDBOX_MAP } from "../config/t0Map.js";
import { verifyAuditChain } from "../audit/log.js";
import { openDb, type DB } from "../db/open.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executePaymentBatch } from "../executors/paymentBatch.js";
import { executeSupplierPayment } from "../executors/supplierPayment.js";
import { toCents } from "../lib/money.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { followPayouts } from "../payouts/follow.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { RECEIPT_FORMAT, type TryReceipt } from "../try/receipt.js";
import { setSetting } from "../world/settings.js";
import { emlWith, pdfOf } from "./documents.js";
import type { FxRate, PlatformOps } from "./platformOps.js";
import { chainSteps, type E2eStep, type StepData } from "./receiptChain.js";
import type { WorldCompany } from "./world.js";

/** A payout is waiting in Airwallex's own approval workflow: the run stops; a person approves it in Airwallex's web app. */
export class WaitingForAirwallexApproval extends Error {
  constructor(readonly company: string, readonly transfers: string[]) {
    super(`${company}: ${transfers.join(", ")} ${transfers.length === 1 ? "is" : "are"} IN_APPROVAL at Airwallex: approve in Airwallex's web app (a person, never this run), then run again`);
    this.name = "WaitingForAirwallexApproval";
  }
}

/** The test passkey's site: not Purser's real one, so its signatures can never pass there. */
export const E2E_RP_ID = "e2e.purser.test";
export const E2E_ORIGIN = `https://${E2E_RP_ID}`;
export const TEST_PASSKEY = "test passkey (a software authenticator standing in for the CFO's phone; not Face ID)";

export interface CompanyRails { rail: AirwallexRail & PayoutRail; sim: SandboxSim | null }

export interface PlatformE2EDeps {
  world: WorldCompany[];
  platform: PlatformOps;
  /** The company's rails, acting on behalf of its connected account. */
  railFor(accountId: string): CompanyRails;
  /** The company's reader (Claude, auditing into the company's own ledger; or the parser in a dry run). */
  readerFor(db: DB): Asker;
  t0: Pick<T0Client, "listGlAccounts" | "profitLoss" | "postJournalEntry" | "listJournalEntries">;
  /** Units of T:0's functional currency per unit of a currency, on a date (T0_RATES); none for the functional one. */
  t0Rate: T0Rate;
  /** T:0's functional currency when already read (the live run's pre-check), so the run does not read it again. */
  t0Currency?: { currency: string; atomsPerUnit: number };
  /** When T:0 books in another currency: the Airwallex rate every EUR entry is converted at, named in its memo. */
  fx?: FxRate;
  /** Purser's fee in basis points (CFO policy, capped at 100). */
  feeBps: string;
  /** Test money moved into each connected account before its invoices are paid, in cents. */
  fundCents: number;
  /** The run's folder: ledgers, documents, receipts and the summary go here. */
  dir: string;
  now: () => Date;
  log: (line: string) => void;
  /** "dry run" or "live": written into every record so no reader mistakes one for the other. */
  mode: "dry run" | "live";
}

export interface PaymentResult {
  company: string;
  account: string;
  invoices: { id: string; vendor: string; invoice_no: string; total: string; via: string }[];
  proposal_id: string;
  kind: string;
  terms_sha256: string;
  transfers: { transfer_id: string; status: string; amount: string; purser_fee: string | null }[];
  t0_entries: string[];
  receipt: string;
}

export interface RunSummary {
  mode: string;
  at: string;
  companies: { key: string; name: string; account: string; opened: boolean; status: string; funding: string; audit: { ok: boolean; rows: number; head: string | null } }[];
  payments: PaymentResult[];
  t0: { posted: number; skipped: number; entity_note: string };
  claude: { request_ids: string[]; fallbacks: number };
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Runs the whole flow. Sequential: one company at a time (each sets the binding env its runner checks). */
export async function runPlatformE2E(d: PlatformE2EDeps): Promise<RunSummary> {
  mkdirSync(d.dir, { recursive: true });
  const runKey = generateKeyPairSync("ed25519");
  const privPkcs8 = runKey.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const pubSpki = runKey.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const summary: RunSummary = { mode: d.mode, at: d.now().toISOString(), companies: [], payments: [], t0: { posted: 0, skipped: 0, entity_note: "T:0 has one sandbox entity: every entry's memo names the company and its PUR id" }, claude: { request_ids: [], fallbacks: 0 } };
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ["AIRWALLEX_PLATFORM", "AIRWALLEX_PLATFORM_FEE", "PURSER_PLATFORM_PUBLIC_KEY", "PURSER_TENANT_ID"] as const;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const pending: Pending[] = [];
  try {
    for (const c of d.world) {
      Object.assign(process.env, { AIRWALLEX_PLATFORM: "on", AIRWALLEX_PLATFORM_FEE: "on", PURSER_PLATFORM_PUBLIC_KEY: pubSpki, PURSER_TENANT_ID: c.tenant });
      pending.push(await runCompany(d, c, privPkcs8, summary));
    }
  } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  // The three companies' books to T:0 in one push (one chart read, one list, then one post per entry).
  const posted = await pushToT0(d, pending.flatMap((p) => p.postings));
  summary.t0.posted = posted.posted.length;
  summary.t0.skipped = posted.skipped;
  for (const p of pending) {
    const ids = posted.posted.filter((x) => x.stable.startsWith(`PUR-${p.key}-`) || x.memo.includes(`[${p.key}]`)).map((x) => x.id);
    p.steps.push({ kind: "t0_posted", at: d.now().toISOString(), data: { entity: "T:0 sandbox (shared by the three test companies)", journal_entries: ids, tag: `[${p.key}] PUR-${p.key}-…` } });
    p.receipt.e2e = chainSteps(p.receipt.e2e.company, p.steps);
    writeFileSync(p.file, `${JSON.stringify(p.receipt, null, 2)}\n`);
    const pay = summary.payments.find((x) => x.receipt === p.file);
    if (pay) pay.t0_entries = ids;
    d.log(`${p.key.padEnd(12)} ${ids.length} T:0 entries; receipt ${p.file}`);
  }
  writeFileSync(join(d.dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

interface Pending { key: string; postings: Posting[]; steps: E2eStep[]; receipt: TryReceipt & { e2e: ReturnType<typeof chainSteps> }; file: string }

async function runCompany(d: PlatformE2EDeps, c: WorldCompany, privPkcs8: string, summary: RunSummary): Promise<Pending> {
  const now = d.now;
  const cdir = join(d.dir, c.key.toLowerCase());
  mkdirSync(cdir, { recursive: true });
  const db = openDb(join(cdir, "ledger.db"));
  const steps = new Map<string, E2eStep[]>(); // per invoice id
  const at = () => now().toISOString();

  // 1. The company's connected account, opened if new, and test money moved into it.
  const acct = await d.platform.ensureAccount(c);
  d.log(`${c.key.padEnd(12)} account ${acct.accountId} ${acct.opened ? "opened" : "existing"}, ${acct.status}`);
  // Test money: only when the account holds less than the run needs (a re-run never funds twice), under a request id
  // of this run's own (recorded), so a funding from an earlier run is never mistaken for this one.
  const { rail, sim } = d.railFor(acct.accountId);
  const heldCents = (await rail.balances()).EUR?.availableCents ?? 0;
  const fundRequest = `e2e-fund-${c.key.toLowerCase()}-${now().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const funding = heldCents >= d.fundCents
    ? { id: "none", status: `skipped: EUR ${(heldCents / 100).toFixed(2)} already held` }
    : await d.platform.fund(acct.accountId, d.fundCents, fundRequest);
  d.log(`${c.key.padEnd(12)} ${funding.id === "none" ? funding.status : `funded EUR ${(d.fundCents / 100).toFixed(2)} test money: ${funding.id} ${funding.status} (request ${fundRequest})`}`);

  // 2. Its account binding (signed with the run's key, standing in for Purser Cloud) and Purser's fee in its policy.
  const issued = now().getTime();
  storeBinding(db, await signBinding(privPkcs8, { v: 1, tenant: c.tenant, account_id: acct.accountId, status: "active" as PlatformStatus, name: c.name, fee_account: d.platform.feeAccount, issued_at: issued, expires_at: issued + BINDING_TTL_MS }), now());
  setSetting(db, "human", "platform.fee_bps", d.feeBps);
  setSetting(db, "human", "eur_obligations", "0.00");

  // 3. The CFO's test passkey, enrolled the way a phone enrols (registration, then the fingerprint confirmed).
  const cfo = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: E2E_RP_ID, origin: E2E_ORIGIN }, now());
  await processRegistration(db, { ticket: `${c.key}-enrol`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: cfo.register({ challenge: window.challenge, origin: E2E_ORIGIN, rpId: E2E_RP_ID }) }), received_at: at() }, { label: "cfo (test passkey)" }, now());
  confirmPasskey(db, fingerprintOf(cfo.spkiSha256), now());
  let counter = 0, ticket = 0;
  const sign = async (proposalId: string, termsSha: string) => {
    const credential = cfo.sign({ challenge: challengeFor(termsSha), origin: E2E_ORIGIN, rpId: E2E_RP_ID, counter: ++counter });
    const out = await processAssertion(db, { ticket: `${c.key}-a${++ticket}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: termsSha, credential }), received_at: at() }, now());
    if (out.status !== "approved") throw new Error(`${c.key}: the test passkey's approval of ${proposalId} was ${out.status}: ${out.message}`);
    return credential;
  };

  // 4. The invoices, through the real inbox (a PDF upload, or an e-mail with the PDF attached).
  const reader = d.readerFor(db);
  const deps: InboxDeps = { dir: join(cdir, "ap"), reader, now };
  const ids: string[] = [];
  for (const inv of c.invoices) {
    const pdf = await pdfOf(inv.text);
    const got = inv.via === "email"
      ? (await ingestEmail(db, deps, emlWith(pdf, { filename: inv.filename, from: "Accounts <accounts@supplier.test>", to: `payables+${c.key.toLowerCase()}@in.purser.test`, subject: `Invoice ${inv.filename.replace(/\.pdf$/, "")}` })))[0]
      : await ingestDocument(db, deps, { bytes: pdf, filename: inv.filename, source: "upload" });
    if (!got || got.kind !== "invoice") throw new Error(`${c.key}: ${inv.filename} did not come in as an invoice (${got?.kind ?? "nothing"})`);
    const row = got.invoice;
    ids.push(row.id);
    const readBy = claudeRead(db, row);
    steps.set(row.id, [
      { kind: "invoice_received", at: row.received_at || at(), data: { invoice: row.id, via: inv.via, filename: inv.filename, doc_sha256: str(row.doc_sha256) } },
      { kind: "invoice_read", at: at(), data: { invoice: row.id, read_by: readBy.by, claude_request_id: readBy.requestId, vendor: row.vendor, invoice_no: row.invoice_no, total: `${row.currency} ${row.total}`, status_after_checks: row.status, findings: row.findings.map((f) => f.code) } },
    ]);
    if (readBy.requestId) summary.claude.request_ids.push(readBy.requestId); else summary.claude.fallbacks++;
    d.log(`${c.key.padEnd(12)} ${inv.via.padEnd(6)} ${row.id} ${row.vendor}, ${row.currency} ${row.total}: ${row.status} (read by ${readBy.by})`);
  }

  // 5. New suppliers: verified by a person, approved with the CFO's test passkey, created at Airwallex for the company.
  for (const id of ids) {
    if (apInvoice(db, id)!.status !== "needs_vendor") continue;
    const req = requestPayeeAddForInvoice(db, id, "treasury", now());
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO (test world)", how: "test world: the fictional supplier's bank details as on its own invoice; no real supplier exists to call", actor: "human", address: { street: "Teststraat 2", city: "Amsterdam", postcode: "1011 AB" } }, now());
    const p = proposePayeeAdd(db, req.add_id, "treasury", now());
    await sign(p.proposal_id, p.terms_sha256);
    await executePayeeAdd(db, rail, p.proposal_id, { now, reader }, now());
    steps.get(id)!.push({ kind: "supplier_approved", at: at(), data: { payee_add: p.proposal_id, terms_sha256: p.terms_sha256, beneficiary: str((db.prepare("SELECT beneficiary_id FROM beneficiaries WHERE name = ? ORDER BY rowid DESC").get(apInvoice(db, id)!.vendor) as { beneficiary_id?: string } | undefined)?.beneficiary_id), approved_with: TEST_PASSKEY } });
  }
  await syncPayments(db, { now });

  // 6. One approval for the company's invoices: a batch when there are two or more, else the single payment.
  let proposal: { proposal_id: string; terms_sha256: string; terms_json: string; kind: string };
  if (ids.length > 1) {
    const out = await payApInvoices(db, rail, ids, now(), reader);
    if (!out.batch || out.notPlanned.length) throw new Error(`${c.key}: the batch was not planned: ${out.notPlanned.map((n) => n.reason).join("; ")}`);
    proposal = out.batch;
  } else {
    const out = await payApInvoice(db, rail, ids[0]!, now(), reader);
    if (out.kind !== "proposed") throw new Error(`${c.key}: ${ids[0]} was not proposed: ${JSON.stringify(out).slice(0, 300)}`);
    proposal = out.proposal;
  }
  const credential = await sign(proposal.proposal_id, proposal.terms_sha256);
  d.log(`${c.key.padEnd(12)} approved ${proposal.kind} ${proposal.proposal_id} with the ${TEST_PASSKEY.split(" (")[0]} over ${proposal.terms_sha256.slice(0, 16)}…`);

  // 7. Paid on behalf of the connected account, Purser's fee with each payout; followed to PAID; booked.
  const run = async (pid: string) => {
    const k = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(pid) as { kind: string }).kind;
    if (k === "invoice_payment") await executeInvoicePayment(db, rail, sim, pid, now);
    else await executeSupplierPayment(db, rail, sim, pid, now);
  };
  if (proposal.kind === "payment_batch") await executePaymentBatch(db, proposal.proposal_id, run, now());
  else await run(proposal.proposal_id);
  await followPayouts(db, rail, now());
  await syncPayments(db, { now });
  // Airwallex's own approval workflow (a second lock, set in its web app): a payout waiting there stops the run. Only a
  // person approves it there; this run never moves it on.
  const held = db.prepare("SELECT transfer_id FROM transfers WHERE status = 'IN_APPROVAL'").all() as { transfer_id: string }[];
  if (held.length) throw new WaitingForAirwallexApproval(c.key, held.map((h) => h.transfer_id));

  // 8. The company's books, as postings tagged with the company and its PUR id (pushed to T:0 with the others').
  const entries = apJournal(db);
  const postings = toPostings(c, entries, d.fx);

  // 9. The receipt per payment, and the company's own audit chain checked.
  const audit = verifyAuditChain(db);
  const auditHead = (db.prepare("SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { row_hash?: string } | undefined)?.row_hash ?? null;
  const auditRows = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  const terms = JSON.parse(proposal.terms_json) as Record<string, unknown>;
  const transfers = db.prepare(`SELECT t.transfer_id, t.status, t.amount, t.invoice_no, f.amount AS fee, f.currency AS fee_cur, f.status AS fee_status FROM transfers t
    LEFT JOIN platform_fees f ON f.proposal_id IN (SELECT proposal_id FROM proposals WHERE json_extract(terms_json, '$.transfer_request_id') = t.request_id) ORDER BY t.rowid`).all() as
    { transfer_id: string | null; status: string; amount: string; invoice_no: string; fee: string | null; fee_cur: string | null; fee_status: string | null }[];
  const invs = ids.map((id) => apInvoice(db, id)!);
  const invSteps: E2eStep[] = invs.flatMap((i) => steps.get(i.id) ?? []);
  const allSteps: E2eStep[] = [
    { kind: "account", at: at(), data: { company: c.name, connected_account: acct.accountId, opened_in_run: acct.opened ? "yes" : "no", status: acct.status, funding: funding.id === "none" ? funding.status : `${funding.id} ${funding.status} (request ${fundRequest})`, binding: "signed with the run's own key (a test world's stand-in for Purser Cloud's)" } },
    ...invSteps,
    { kind: "signature", at: at(), data: { proposal_id: proposal.proposal_id, kind: proposal.kind, terms_sha256: proposal.terms_sha256, signed_with: TEST_PASSKEY, credential_id: cfo.credentialId } },
    ...transfers.map((t) => ({ kind: "payout", at: at(), data: { transfer_id: str(t.transfer_id), status: t.status, amount: `EUR ${t.amount}`, invoice_no: t.invoice_no, on_behalf_of: acct.accountId, purser_fee: t.fee ? `${t.fee_cur} ${t.fee} (${str(t.fee_status)}) via application_fee_options` : "none" } as StepData })),
    { kind: "booked", at: at(), data: { entries: String(entries.length), balanced: entries.reduce((s, e) => s + toCents(e.debit || "0.00") - toCents(e.credit || "0.00"), 0) === 0 ? "yes" : "no", audit_chain: audit.ok ? `ok, ${auditRows} rows, head ${str(auditHead)}` : `BROKEN: ${str((audit as { reason?: string }).reason)}` } },
  ];
  const receipt: TryReceipt & { e2e: ReturnType<typeof chainSteps> } = {
    receipt: RECEIPT_FORMAT,
    note: `Purser platform end-to-end (${d.mode}), ${c.name}: test company, Airwallex sandbox, test money; approved with a ${TEST_PASSKEY}.`,
    terms, terms_sha256: proposal.terms_sha256, algorithm: "ES256", public_key: cfo.publicJwk, credential_id: cfo.credentialId,
    rp_id: E2E_RP_ID, origin: E2E_ORIGIN,
    assertion: { authenticatorData: credential.response.authenticatorData, clientDataJSON: credential.response.clientDataJSON, signature: credential.response.signature },
    verify: "npm run verify-receipt -- <this file>",
    e2e: chainSteps(`${c.key} (${acct.accountId})`, allSteps),
  };
  const receiptFile = join(cdir, `receipt-${proposal.proposal_id}.json`);
  summary.companies.push({ key: c.key, name: c.name, account: acct.accountId, opened: acct.opened, status: acct.status, funding: `${funding.id} ${funding.status}`, audit: { ok: audit.ok, rows: auditRows, head: auditHead } });
  summary.payments.push({
    company: c.key, account: acct.accountId, kind: proposal.kind, proposal_id: proposal.proposal_id, terms_sha256: proposal.terms_sha256,
    invoices: invs.map((i, n) => ({ id: i.id, vendor: i.vendor, invoice_no: i.invoice_no, total: `${i.currency} ${i.total}`, via: c.invoices[n]!.via })),
    transfers: transfers.map((t) => ({ transfer_id: str(t.transfer_id), status: t.status, amount: `EUR ${t.amount}`, purser_fee: t.fee ? `${t.fee_cur} ${t.fee} ${str(t.fee_status)}` : null })),
    t0_entries: [], receipt: receiptFile,
  });
  d.log(`${c.key.padEnd(12)} paid: ${transfers.map((t) => `${str(t.transfer_id)} ${t.status}${t.fee ? ` fee ${t.fee_cur} ${t.fee}` : ""}`).join(", ")}`);
  db.close();
  return { key: c.key, postings, steps: allSteps, receipt, file: receiptFile };
}

/** Who read the invoice: Claude (with its request id, from the audit log) or the parser. */
function claudeRead(db: DB, inv: ApInvoiceRow): { by: string; requestId: string } {
  const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'claude.read' ORDER BY seq DESC LIMIT 1").get() as { payload_json?: string } | undefined;
  const p = r?.payload_json ? JSON.parse(r.payload_json) as { model?: string; request_id?: string | null } : null;
  const by = str((inv as unknown as { read_by?: string }).read_by) || (p?.model ? `claude ${p.model}` : "the parser");
  return { by, requestId: p?.request_id ?? "" };
}

/**
 * The two payables accounts the sandbox map has no line for (1510 input VAT, 2100 accounts payable), mapped onto the
 * sandbox chart by type: the one active, postable accounts_payable account, and the first active, postable other
 * current asset. Only when T:0 has no account numbered as ours; never over a mapping in T0_SANDBOX_MAP.
 */
export function apFallback(accounts: Awaited<ReturnType<T0Client["listGlAccounts"]>>): Record<string, { number: string; name: string; note: string }> {
  const out: Record<string, { number: string; name: string; note: string }> = {};
  const usable = accounts.filter((a) => a.is_active && a.is_postable && a.account_number);
  const ap = usable.filter((a) => a.account_type === "accounts_payable");
  if (ap.length === 1) out["2100"] = { number: ap[0]!.account_number!, name: ap[0]!.name, note: "accounts payable: T:0's one accounts_payable account (by type)" };
  const oca = usable.filter((a) => a.account_type === "other_current_assets").sort((a, b) => a.account_number!.localeCompare(b.account_number!));
  if (oca[0]) out["1510"] = { number: oca[0].account_number!, name: oca[0].name, note: "input VAT: T:0's first other current asset (by type)" };
  return out;
}

/** A company's AP entries as postings, each entry named PUR-<company>-<invoice>-<event> and its memo tagged [<company>]. */
export function toPostings(c: Pick<WorldCompany, "key">, entries: ApEntry[], fx?: FxRate): Posting[] {
  // Each entry's EUR amount (its debits), and the rate it is converted at, go into its memo.
  const eur = new Map<string, number>();
  for (const e of entries) { const k = `${e.invoice_id}|${e.event}`; eur.set(k, (eur.get(k) ?? 0) + (e.debit ? toCents(e.debit) : 0)); }
  const conv = (e: ApEntry) => (fx ? ` · ${e.currency} ${((eur.get(`${e.invoice_id}|${e.event}`) ?? 0) / 100).toFixed(2)} · converted at Airwallex sandbox rate ${fx.rate} ${fx.to} per EUR at ${fx.at}` : "");
  return entries.map((e) => ({
    entry: `PUR-${c.key}-${e.invoice_id}-${e.event}`, date: e.date, account: e.account, account_name: e.account_name,
    debit_cents: e.debit ? toCents(e.debit) : 0, credit_cents: e.credit ? toCents(e.credit) : 0, currency: e.currency, cost_centre: "",
    ref: `PUR-${c.key}-${e.invoice_id}`, description: `[${c.key}] PUR-${c.key}-${e.invoice_id}: ${e.memo}${conv(e)}`, proof: `doc ${e.doc_sha256.slice(0, 16)}`,
  }));
}

/** The postings built into T:0 entries and pushed once each (idempotent keys; what T:0 already has is skipped). */
async function pushToT0(d: PlatformE2EDeps, postings: Posting[]): Promise<{ posted: { id: string; memo: string; stable: string }[]; skipped: number }> {
  if (!postings.length) return { posted: [], skipped: 0 };
  const { currency, atomsPerUnit } = d.t0Currency ?? await functionalCurrency(d.t0);
  const accounts = await d.t0.listGlAccounts();
  const { map, labels } = resolveAccounts(accounts, postings.map((p) => p.account), { fallback: { ...apFallback(accounts), ...T0_SANDBOX_MAP } });
  const built: T0Entry[] = buildEntries(postings, map, currency, d.t0Rate, { atomsPerUnit, labels });
  const out: { id: string; memo: string; stable: string }[] = [];
  const r = await pushBooks(d.t0 as T0Client, built, new Set<string>(), (p, e) => out.push({ id: p.id, memo: e.request.memo ?? "", stable: e.stableId }));
  return { posted: out, skipped: r.skipped.length };
}

export { sha as e2eSha };

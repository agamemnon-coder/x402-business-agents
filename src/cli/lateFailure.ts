// npm run late-failure -- <command>: a payout Airwallex had PAID that comes back, and one that fails after SENT, on the
// Airwallex sandbox with test money (docs/airwallex.md, "A payout that does not stay paid"). Through the payables inbox,
// as the product pays: two Stockline Data GmbH invoices (SLL-2026-11R1 and SLL-2026-11R2, EUR 240.00 each) come in as
// PDFs, are checked and filed for payment, each is signed by a labelled virtual test passkey over its exact terms, and
// executed. Airwallex's own approval workflow holds both transfers IN_APPROVAL until a person approves them in its web
// app; Purser never approves there. Then R1 goes SENT and PAID, R2 SENT, by the sandbox's simulation endpoint; both are
// moved to FAILED the same way (Airwallex may refuse FAILED after PAID: then that refusal is the record). A GET of each
// transfer, handed to checkEvent, stands in for the webhook (Airwallex's webhooks go to the hosted relay, not to this
// local ledger), and syncPayments follows: R1 returned after PAID, R2 failed after SENT, both invoices to a person.
//
//   stand-in   the whole flow on the in-memory Airwallex stand-in with its approval workflow on; 0 network.
//              `stand-in --refused`: the stand-in refuses FAILED after PAID, as the sandbox may; that refusal is recorded.
//              Each step prints its rail calls as the live adapter sends them (+1 login per live process); --facts prints facts.
//   create     live: fresh ledger only; ingest, file, sign and execute both invoices; prints each transfer (IN_APPROVAL)
//   follow     live: one GET per transfer, recorded; never approves, never resends
//   settle     live, after a person approved both at Airwallex: R1 → SENT → PAID, R2 → SENT (sandbox simulation), each
//              recorded; then the books follow from the ledger (0 calls): R1 is booked paid into the run's CSV journal
//   fail       live: R1 FAILED from PAID (a refusal is recorded, never retried or faked); R2 FAILED from SENT
//   recheck    live: one GET per transfer, Airwallex's own object handed to checkEvent in place of the webhook; then
//              syncPayments once (it reads a payout again where the ledger asks it to)
//   facts      the run's facts from the ledger, the CSV journal and the call log, as JSON; 0 calls
//   record     writes docs/runs/<date>-airwallex-late-failure.json from facts and the call log; 0 calls
// Live needs LATE_FAILURE_GO=yes, AIRWALLEX_CALL_BUDGET (≤ 30), AIRWALLEX_CALL_LOG, KIT11_DB=…/late-failure*.sqlite.
// No Claude call anywhere: the parser reads the invoices (no model key is kept in this process) and the payables agents
// are off. The run's folder sits beside its ledger (KIT11_DB without .sqlite): the inbox's documents and journal.csv.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
export const LATE_FAILURE_PASSKEY_LABEL = "late-failure virtual test passkey";

// No model is asked in this run, live or stand-in: the keys go before anything that could read them is loaded.
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const { openDb } = await import("../db/open.js");
const { seedTreasury } = await import("../agents/euroBill.js");
const { ibanSha } = await import("../agents/invoice.js");
const { followTransfer, describeTransferStatus } = await import("../airwallex/approvals.js");
const { CsvFileSink } = await import("../ap/books.js");
const { ingestDocument } = await import("../ap/inbox.js");
const { payApInvoice, syncPayments } = await import("../ap/pay.js");
const { ledgerInvoiceNo } = await import("../ap/ledgerKey.js");
const { pdfOf } = await import("../e2e/documents.js");
const { approvalOrigin } = await import("../executors/index.js");
const { executeInvoicePayment, FEE_RETRY } = await import("../executors/invoicePayment.js");
const { withOrigin } = await import("../provenance/origin.js");
const { confirmPasskey, fingerprintOf, openEnrolment } = await import("../passkey/ledger.js");
const { processAssertion, processRegistration } = await import("../passkey/process.js");
const { challengeFor } = await import("../passkey/webauthn.js");
const { checkEvent } = await import("../policy/airwallexEvents.js");
const { FakeAuthenticator } = await import("../redteam/authenticator.js");
const { setSetting } = await import("../world/settings.js");
const { audit } = await import("../audit/log.js");
const { LATE_FAILURE_INVOICES, LATE_FAILURE_LIVE, LATE_FAILURE_VENDOR, lateFailureLedger, lateFailureLedgerRefusal, lateFailureRefusals } = await import("./lateFailureRefusals.js");
type DB = ReturnType<typeof openDb>;
type Rail = import("../airwallex/port.js").AirwallexRail & import("../airwallex/port.js").PayoutRail & import("../airwallex/port.js").SandboxSim;
type Asker = import("../ap/read.js").Asker;
type Sink = InstanceType<typeof CsvFileSink>;
/** Airwallex's own transfer object, as GET /transfers/{id} answers it. */
type RawRead = (id: string) => Promise<Record<string, unknown>>;
type InvoiceNo = (typeof LATE_FAILURE_INVOICES)[number];
const [R1, R2] = LATE_FAILURE_INVOICES;

const RP = "late-failure.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
const STOCKLINE = { beneficiaryId: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001" };
const WEBHOOK_NOTE = "a GET of the transfer at Airwallex, handed to checkEvent in place of the payout.transfer webhook: Airwallex's webhooks go to the hosted relay, not to this local ledger";
/** The parser reads: no model is asked. */
const parserOnly = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no model is asked in the late-failure run: the parser reads" }) } as unknown as Asker;

const fixture = (no: InvoiceNo) => readFileSync(resolve(repo, "fixtures", `stockline-licence-${no}.txt`), "utf8");
const ledgerNo = (no: InvoiceNo) => ledgerInvoiceNo(no, LATE_FAILURE_VENDOR);
const transferOf = (db: DB, no: InvoiceNo) => db.prepare("SELECT transfer_id, status FROM transfers WHERE invoice_no = ? AND transfer_id IS NOT NULL").get(ledgerNo(no)) as { transfer_id: string; status: string } | undefined;
const invoiceOf = (db: DB, no: InvoiceNo) => db.prepare("SELECT id, status, proposal_id FROM ap_invoices WHERE invoice_no = ? ORDER BY received_at DESC LIMIT 1").get(no) as { id: string; status: string; proposal_id: string | null } | undefined;
const errorFacts = (e: unknown) => {
  const err = e as { status?: number; code?: string; traceId?: string | null; body?: { message?: unknown } | null; message: string; name?: string };
  const message = typeof err.body?.message === "string" ? err.body.message : err.message;
  return { http_status: err.status ?? null, code: err.code ?? null, message: message.slice(0, 300), trace: err.traceId ?? null, kind: err.name ?? "Error" };
};

/** The supplier's Airwallex beneficiary (created in awx-1) and floors that let both payouts come from EUR; no call. */
function seedLedger(db: DB) {
  db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(STOCKLINE.beneficiaryId, LATE_FAILURE_VENDOR, "2051", ibanSha(STOCKLINE.iban), STOCKLINE.bic);
  setSetting(db, "treasury", "eur_floor", "25000.00");
  setSetting(db, "treasury", "eur_obligations", "0.00");
  setSetting(db, "treasury", "usd_floor", "0.00");
}

async function enrol(db: DB, now: Date) {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "late-failure-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: LATE_FAILURE_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: InstanceType<typeof FakeAuthenticator>, proposalId: string, counter: number, now: Date) {
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter });
  const out = await processAssertion(db, { ticket: `late-failure-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/**
 * Both invoices through the payables inbox: in as PDFs, checked, filed for payment, signed by the virtual test passkey
 * (unless code approved one within a limit to pay alone: said so), executed. Each transfer goes to Airwallex once.
 */
async function create(db: DB, rail: Rail, dir: string, sink: Sink, feeRetry: typeof FEE_RETRY) {
  const now = () => new Date();
  const deps = { dir: join(dir, "ap"), reader: parserOnly, now, sink, agents: false };
  const ids: Record<string, string> = {};
  for (const no of LATE_FAILURE_INVOICES) {
    const got = await ingestDocument(db, deps, { bytes: await pdfOf(fixture(no)), filename: `stockline-licence-${no}.pdf`, source: "upload" });
    if (got.kind !== "invoice") throw new Error(`${no} did not come in as an invoice (${got.kind})`);
    if (got.invoice.status !== "ready") throw new Error(`${no} came in ${got.invoice.status}, not ready to pay: ${got.invoice.findings.map((f) => f.detail).join("; ")}`);
    ids[no] = got.invoice.id;
    audit(db, "system", "late_failure.ingested", got.invoice.id, { invoice_no: no, status: got.invoice.status, total: `${got.invoice.currency} ${got.invoice.total}`, read_by: "the parser (no model asked)" });
  }
  const auth = await enrol(db, now());
  const out: { no: InvoiceNo; proposalId: string; sha: string; signedBy: string; transfer: { id: string; status: string } }[] = [];
  let counter = 0;
  for (const no of LATE_FAILURE_INVOICES) {
    const filed = await payApInvoice(db, rail, ids[no]!, now(), parserOnly, { on: false });
    if (filed.kind !== "proposed") throw new Error(`${no} was not filed for payment: ${JSON.stringify(filed).slice(0, 300)}`);
    const proposalId = filed.proposal.proposal_id;
    const signedBy = filed.alone ? `code, within the limit to pay alone (${filed.alone.why})` : LATE_FAILURE_PASSKEY_LABEL;
    const sha = filed.alone ? filed.proposal.terms_sha256 : await sign(db, auth, proposalId, ++counter, now());
    const r = await withOrigin(approvalOrigin(db, proposalId)!, () => executeInvoicePayment(db, rail, rail, proposalId, now, feeRetry));
    audit(db, "system", "late_failure.created", r.transfer.id, { invoice_no: no, ap_invoice: ids[no]!, proposal_id: proposalId, terms_sha256: sha, status: r.transfer.status, signer: signedBy });
    out.push({ no, proposalId, sha, signedBy, transfer: { id: r.transfer.id, status: r.transfer.status } });
  }
  return out;
}

/** One GET per transfer, recorded; never approves, never resends. */
async function follow(db: DB, rail: Rail) {
  const out: { no: InvoiceNo; id: string; status: string; mismatch: string | null }[] = [];
  for (const no of LATE_FAILURE_INVOICES) {
    const id = transferOf(db, no)!.transfer_id;
    const f = await followTransfer(db, rail, id);
    out.push({ no, id, status: f.status, mismatch: f.mismatch });
  }
  return out;
}

/** Why settle must not run yet: both approved at Airwallex (followed to SCHEDULED or later), neither already failed. */
function settleRefusal(db: DB): string | undefined {
  for (const no of LATE_FAILURE_INVOICES) {
    const t = transferOf(db, no)!;
    if (!["SCHEDULED", "PROCESSING", "SENT", "PAID"].includes(t.status)) return `${no} (${t.transfer_id}) is ${t.status} in the ledger: only a transfer a person approved at Airwallex is settled (follow first)`;
  }
  return undefined;
}

/** R1 → SENT → PAID, R2 → SENT (the sandbox's simulation endpoint), each answer recorded; then the books follow, 0 calls. */
async function settle(db: DB, rail: Rail, sink: Sink) {
  const want: Record<InvoiceNo, ("SENT" | "PAID")[]> = { [R1]: ["SENT", "PAID"], [R2]: ["SENT"] } as Record<InvoiceNo, ("SENT" | "PAID")[]>;
  const lines: string[] = [];
  for (const no of LATE_FAILURE_INVOICES) {
    const t = transferOf(db, no)!;
    const steps = want[no].slice(want[no].indexOf(t.status as "SENT" | "PAID") + 1);
    for (const to of steps) {
      const r = await rail.transitionTransfer(t.transfer_id, to);
      audit(db, "system", "late_failure.simulated", t.transfer_id, { invoice_no: no, to, status: r.status, simulated: "Airwallex sandbox simulation endpoint" });
      db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE transfer_id = ?").run(r.status, new Date().toISOString(), t.transfer_id);
      lines.push(`SIMULATED ${no} ${t.transfer_id} → ${r.status}`);
    }
  }
  // No rail: the ledger alone books what is PAID (R1's accrual and payment into the CSV journal); nothing is read.
  await syncPayments(db, { sink });
  return lines;
}

/** Why fail must not run: R1 PAID and R2 SENT in the ledger (settle first). */
function failRefusal(db: DB): string | undefined {
  // R2 is asked from SENT where it stopped there; the executor may already have taken it to PAID (the sandbox's
  // simulation right after the transfer), and then it fails from PAID too: the record says which.
  const want: Record<string, string[]> = { [R1]: ["PAID"], [R2]: ["SENT", "PAID"] };
  for (const no of LATE_FAILURE_INVOICES) {
    const t = transferOf(db, no)!;
    const tried = db.prepare("SELECT 1 FROM audit_log WHERE event IN ('late_failure.fail_accepted', 'late_failure.fail_refused') AND subject = ?").get(t.transfer_id);
    if (!tried && !want[no]!.includes(t.status)) return `${no} (${t.transfer_id}) is ${t.status} in the ledger, not ${want[no]!.join(" or ")} (settle first)`;
  }
  return undefined;
}

/**
 * R1: FAILED from PAID; R2: FAILED from SENT, by the simulation endpoint. Airwallex's answer is recorded either way, and a
 * refusal is never retried or faked. The ledger is not touched: it learns of the failure only by reading Airwallex (recheck).
 */
async function fail(db: DB, rail: Rail) {
  const lines: string[] = [];
  for (const no of LATE_FAILURE_INVOICES) {
    const t = transferOf(db, no)!;
    if (db.prepare("SELECT 1 FROM audit_log WHERE event IN ('late_failure.fail_accepted', 'late_failure.fail_refused') AND subject = ?").get(t.transfer_id)) {
      lines.push(`SKIPPED  ${no} ${t.transfer_id}: FAILED was asked for once already (its answer is recorded); never asked twice`);
      continue;
    }
    try {
      const r = await rail.transitionTransfer(t.transfer_id, "FAILED");
      audit(db, "system", "late_failure.fail_accepted", t.transfer_id, { invoice_no: no, from: t.status, asked: "FAILED", status: r.status, failure_type: r.failureType ?? null, simulated: "Airwallex sandbox simulation endpoint", ledger: "not changed: the ledger reads Airwallex in recheck" });
      lines.push(`ACCEPTED ${no} ${t.transfer_id}: FAILED from ${t.status}; Airwallex answered ${r.status}${r.failureType ? ` (${r.failureType})` : ""}`);
    } catch (e) {
      const f = errorFacts(e);
      audit(db, "system", "late_failure.fail_refused", t.transfer_id, { invoice_no: no, from: t.status, asked: "FAILED", ...f, note: "Airwallex refused the simulation; not retried, not faked" });
      lines.push(`REFUSED  ${no} ${t.transfer_id}: FAILED from ${t.status}: ${f.http_status ?? "-"} ${f.code ?? "-"} ${f.message}`);
    }
  }
  return lines;
}

/** Each transfer read at Airwallex and handed to checkEvent in place of the webhook; then syncPayments once. */
async function recheck(db: DB, rail: Rail, raw: RawRead, sink: Sink) {
  const lines: string[] = [];
  for (const no of LATE_FAILURE_INVOICES) {
    const t = transferOf(db, no)!;
    const o = await raw(t.transfer_id);
    const name = `payout.transfer.${String(o.status ?? "").toLowerCase()}`;
    const c = checkEvent(db, name, o);
    audit(db, "system", "late_failure.webhook_stand_in", t.transfer_id, { invoice_no: no, event: name, airwallex_status: typeof o.status === "string" ? o.status : null, ledger_status: t.status, agrees: c.agrees, outcome: c.outcome, how: WEBHOOK_NOTE });
    lines.push(`CHECKED  ${no} ${t.transfer_id}: ${name} (ledger ${t.status}): ${c.outcome}`);
  }
  await syncPayments(db, { rail, sink });
  for (const no of LATE_FAILURE_INVOICES) lines.push(`AFTER    ${no}: transfer ${transferOf(db, no)!.status}, invoice ${invoiceOf(db, no)?.status ?? "-"}`);
  return lines;
}

const RUN_EVENTS = ["transfer.status", "transfer.awaiting_airwallex_approval", "transfer.recheck_requested", "transfer.rechecked", "transfer.returned_after_paid", "transfer.follow_failed", "ap.status", "ap.booking_refused", "airwallex.disagrees", "platform_fee.refund_due"];

async function facts(db: DB, sinkPath: string | null) {
  const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const calls = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  let csv: string[];
  try { csv = sinkPath ? readFileSync(sinkPath, "utf8").split("\n").filter((l) => l.trim()) : []; } catch { csv = []; }
  return {
    invoices: [...LATE_FAILURE_INVOICES],
    proposals: q("SELECT p.proposal_id, p.kind, p.status, p.terms_sha256, a.approver, a.method FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id ORDER BY p.proposal_id"),
    transfers: q("SELECT transfer_id, request_id, invoice_no, amount, currency, status, failure_type, approval_sha256, updated_at FROM transfers ORDER BY invoice_no"),
    ap_invoices: q("SELECT id, invoice_no, vendor, currency, total, status, proposal_id FROM ap_invoices ORDER BY invoice_no"),
    audit: q<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>(
      `SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'late_failure.%' OR event IN (${RUN_EVENTS.map(() => "?").join(", ")}) ORDER BY seq`, ...RUN_EVENTS)
      .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as unknown })),
    sink_csv: csv,
    calls: { total: calls.length, by_endpoint: countByEndpoint(calls), first: calls[0]?.at ?? null, last: calls.at(-1)?.at ?? null },
  };
}

/** The run's folder beside its ledger: KIT11_DB without .sqlite (the inbox's documents, journal.csv). */
const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");

/**
 * The stand-in's rail, counting each call as the live adapter would send it (src/airwallex/adapter.ts): one HTTP
 * request per method below. A live process also logs in once (POST /authentication/login) before its first call.
 */
const ENDPOINT: Record<string, string> = {
  balances: "GET /balances/current", balancesAll: "GET /balances/current", createTransfer: "POST /transfers/create", createPayoutTransfer: "POST /transfers/create",
  getTransfer: "GET /transfers/{id}", findTransferByRequestId: "GET /transfers", findTransferByRequestIdStrict: "GET /transfers",
  transitionTransfer: "POST /simulation/transfers/{id}/transition", currentRate: "GET /fx/rates/current", currentRateAny: "GET /fx/rates/current",
  createQuote: "POST /fx/quotes/create", createQuoteAny: "POST /fx/quotes/create", createConversion: "POST /fx/conversions/create", createConversionAny: "POST /fx/conversions/create",
  findConversionByRequestId: "GET /fx/conversions", findBeneficiaryByIban: "GET /beneficiaries", findPayoutBeneficiary: "GET /beneficiaries",
  usdGlobalAccountId: "GET /global_accounts", findDepositsByReference: "GET /deposits", simulateDeposit: "POST /simulation/deposit/create",
};
function counted<T extends object>(rail: T, log: string[]): T {
  return new Proxy(rail, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r) as unknown;
      if (typeof v !== "function" || typeof p !== "string") return v;
      return (...a: unknown[]) => { log.push(ENDPOINT[p] ?? `? ${p}`); return (v as (...x: unknown[]) => unknown).apply(t, a); };
    },
  });
}
const tally = (log: string[]) => { const m = new Map<string, number>(); for (const l of log) m.set(l, (m.get(l) ?? 0) + 1); return [...m].map(([e, n]) => `${n} ${e}`).join(", ") || "none"; };

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "T0_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`late-failure stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const refused = args.includes("--refused");
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const { AirwallexError } = await import("../airwallex/client.js");
  const awx = new FakeAirwallex();
  awx.approvalWorkflow = true;
  if (refused) {
    // As the sandbox may answer: no FAILED for a transfer it already has PAID.
    const transition = awx.transitionTransfer.bind(awx);
    awx.transitionTransfer = async (id, to, ft) => {
      if (to === "FAILED" && awx.transfers.find((x) => x.id === id)?.status === "PAID") {
        awx.calls.push(`transition:${to}`);
        throw new AirwallexError(400, "invalid_status_transition", { code: "invalid_status_transition", message: "stand-in: a PAID transfer cannot move to FAILED" }, `/simulation/transfers/${id}/transition`);
      }
      return transition(id, to, ft);
    };
  }
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "late-failure-"));
  const sinkPath = join(dir, "journal.csv");
  const sink = new CsvFileSink(sinkPath);
  const db = openDb(":memory:");
  try {
    await seedTreasury(db, awx, awx);
    seedLedger(db);
    const log: string[] = [];
    const rail = counted(awx as unknown as Rail, log);
    // GET /transfers/{id} as Airwallex answers it: the stand-in's transfer, in Airwallex's own field names.
    const raw: RawRead = async (id) => {
      log.push("GET /transfers/{id}");
      const t = await awx.getTransfer(id);
      return { id: t.id, request_id: t.requestId, status: t.status, transfer_amount: t.amountCents / 100, transfer_currency: t.currency, failure_type: t.failureType ?? null };
    };
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      log.length = 0;
      const r = await fn();
      console.log(`STAND-IN ${name.padEnd(8)} rail calls as the live adapter sends them (plus 1 login live): ${tally(log)}`);
      return r;
    };
    if (lateFailureLedgerRefusal("create", db)) throw new Error(`stand-in ledger not fresh: ${lateFailureLedgerRefusal("create", db)}`);
    const made = await step("create", () => create(db, rail, dir, sink, { delaysMs: [], sleep: async () => {} }));
    for (const m of made) console.log(`STAND-IN created  ${m.no} ${m.transfer.id}: ${m.transfer.status} (${describeTransferStatus(m.transfer.status)}); ${m.proposalId} signed by ${m.signedBy}`);
    for (const f of await step("follow", () => follow(db, rail))) console.log(`STAND-IN follow   ${f.no} ${f.id}: ${f.status}`);
    for (const m of made) awx.decideInWebApp(m.transfer.id, "approve");
    console.log("STAND-IN          a person approves both in Airwallex's web app (stand-in)");
    for (const f of await step("follow", () => follow(db, rail))) console.log(`STAND-IN follow   ${f.no} ${f.id}: ${f.status}`);
    if (settleRefusal(db)) throw new Error(settleRefusal(db));
    for (const l of await step("settle", () => settle(db, rail, sink))) console.log(`STAND-IN ${l}`);
    console.log(`STAND-IN booked   ${R1} invoice ${invoiceOf(db, R1)?.status}, ${R2} invoice ${invoiceOf(db, R2)?.status}`);
    if (failRefusal(db)) throw new Error(failRefusal(db));
    for (const l of await step("fail", () => fail(db, rail))) console.log(`STAND-IN ${l}`);
    for (const l of await step("recheck", () => recheck(db, rail, raw, sink))) console.log(`STAND-IN ${l}`);
    const f = await facts(db, sinkPath);
    const t1 = transferOf(db, R1)!, t2 = transferOf(db, R2)!;
    const ev = (event: string, id: string) => f.audit.filter((a) => a.event === event && a.subject === id).length;
    const returnLines = f.sink_csv.filter((l) => l.includes(",return,"));
    const paymentLines = (id: string) => f.sink_csv.filter((l) => { const [, inv, event] = l.split(","); return inv === id && event === "payment"; });
    const creates = awx.calls.filter((c) => c === "createTransfer").length;
    const checks: [string, boolean][] = refused ? [
      [`${R1}: FAILED after PAID refused by the stand-in, recorded once, not retried`, ev("late_failure.fail_refused", t1.transfer_id) === 1 && awx.calls.filter((c) => c === "transition:FAILED").length === 2],
      [`${R1}: still PAID, invoice still paid, no return booked`, t1.status === "PAID" && invoiceOf(db, R1)?.status === "paid" && returnLines.length === 0 && ev("transfer.returned_after_paid", t1.transfer_id) === 0],
      [`${R2}: failed after SENT, invoice needs_review, no payment booked`, ["FAILED", "CANCELLED"].includes(t2.status) && invoiceOf(db, R2)?.status === "needs_review" && paymentLines(invoiceOf(db, R2)!.id).length === 0],
      ["createTransfer called exactly twice", creates === 2],
    ] : [
      [`${R1}: returned after PAID, recorded (transfer.returned_after_paid)`, ev("transfer.recheck_requested", t1.transfer_id) === 1 && ev("transfer.returned_after_paid", t1.transfer_id) === 1],
      [`${R1}: invoice needs_review, a return line in the CSV journal`, invoiceOf(db, R1)?.status === "needs_review" && returnLines.length > 0],
      [`${R2}: failed after SENT, invoice needs_review, no payment booked`, ["FAILED", "CANCELLED"].includes(t2.status) && invoiceOf(db, R2)?.status === "needs_review" && paymentLines(invoiceOf(db, R2)!.id).length === 0 && ev("transfer.returned_after_paid", t2.transfer_id) === 0],
      ["createTransfer called exactly twice", creates === 2],
    ];
    console.log(`STAND-IN journal  ${f.sink_csv.length - 1} lines; return lines: ${returnLines.length}`);
    if (args.includes("--facts")) console.log(JSON.stringify(f, null, 2));
    for (const [what, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}     ${what}`);
    process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
} else if ((cmd === "facts" || cmd === "record") && !lateFailureLedger(process.env)) {
  console.error("REFUSED  KIT11_DB=…/late-failure*.sqlite (this run's own ledger); nothing was read");
  process.exit(2);
} else if (cmd === "facts") {
  console.log(JSON.stringify(await facts(openDb(), join(runDir(), "journal.csv")), null, 2));
} else if (cmd === "record") {
  // 0 calls: the run's record from its ledger, its CSV journal and the call log only.
  const f = await facts(openDb(), join(runDir(), "journal.csv"));
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const lines = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const date = process.env.LATE_FAILURE_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("LATE_FAILURE_DATE is YYYY-MM-DD"); process.exit(2); }
  const file = resolve(repo, "docs/runs", `${date}-airwallex-late-failure.json`);
  writeFileSync(file, `${JSON.stringify({
    stream: "airwallex-late-failure", capability: "late-failure", sandbox: "api.sandbox.airwallex.com", test_money: true,
    source: "built by `npm run late-failure -- record` from the run ledger's audit rows, its CSV journal and AIRWALLEX_CALL_LOG only",
    signer: LATE_FAILURE_PASSKEY_LABEL, simulated: "SENT, PAID and FAILED came from the sandbox's simulation endpoint; a GET of each transfer stood in for the webhook (Airwallex's webhooks go to the hosted relay, not to this local ledger)",
    budget: { approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, used: f.calls.total },
    ...f, calls: { ...f.calls, lines },
  }, null, 2)}\n`);
  console.log(`WROTE    ${file}`);
} else if ((LATE_FAILURE_LIVE as readonly string[]).includes(cmd)) {
  const why = lateFailureRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const db = openDb();
  // Refused before any Airwallex client exists.
  const busy = lateFailureLedgerRefusal(cmd, db) ?? (cmd === "settle" ? settleRefusal(db) : cmd === "fail" ? failRefusal(db) : undefined);
  if (busy) { console.error(`REFUSED  ${busy}`); process.exit(2); }
  if (cmd === "recheck") {
    const untried = LATE_FAILURE_INVOICES.filter((no) => !db.prepare("SELECT 1 FROM audit_log WHERE event IN ('late_failure.fail_accepted', 'late_failure.fail_refused') AND subject = ?").get(transferOf(db, no)!.transfer_id));
    if (untried.length) { console.error(`REFUSED  FAILED was not asked for ${untried.join(" and ")} yet (fail first); nothing was called`); process.exit(2); }
  }
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const cfg = fromEnv();
  if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const api = new Airwallex(cfg);
  const rail = new AirwallexRest(api) as unknown as Rail;
  const raw: RawRead = (id) => api.call<Record<string, unknown>>("GET", `/transfers/${encodeURIComponent(id)}`);
  const dir = runDir();
  const sink = new CsvFileSink(join(dir, "journal.csv"));
  if (cmd === "create") {
    seedLedger(db);
    for (const m of await create(db, rail, dir, sink, FEE_RETRY)) {
      console.log(`CREATED  ${m.no}  ${m.transfer.id}  ${m.transfer.status} (${describeTransferStatus(m.transfer.status)})  proposal ${m.proposalId}  terms ${m.sha}  signed by ${m.signedBy}`);
    }
  } else if (cmd === "follow") {
    for (const f of await follow(db, rail)) console.log(`FOLLOW   ${f.no}  ${f.id}  ${f.status} (${describeTransferStatus(f.status)})${f.mismatch ? `  MISMATCH ${f.mismatch}` : ""}`);
  } else if (cmd === "settle") {
    for (const l of await settle(db, rail, sink)) console.log(l);
    for (const no of LATE_FAILURE_INVOICES) console.log(`BOOKED   ${no}: invoice ${invoiceOf(db, no)?.status ?? "-"}`);
  } else if (cmd === "fail") {
    for (const l of await fail(db, rail)) console.log(l);
  } else {
    for (const l of await recheck(db, rail, raw, sink)) console.log(l);
  }
} else {
  console.error("usage: npm run late-failure -- stand-in [--refused] [--facts] | create | follow | settle | fail | recheck | facts | record");
  process.exit(2);
}


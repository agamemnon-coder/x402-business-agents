// npm run airwallex-bills -- <command>: each invoice Purser pays becomes a Bill in Airwallex Spend (accounts payable), on
// the Airwallex sandbox with test money (src/ap/billSync.ts, AIRWALLEX_BILLS=on). Through the payables inbox, as the
// product pays: three Stockline Data GmbH invoices (SLL-2026-11B1, B2, B3: EUR 240.00 each, the licence fee in code) come in as
// PDFs, are checked and filed for payment, each is signed by a labelled virtual test passkey over its exact terms, and
// executed (a SWIFT transfer; the sandbox's simulation takes it to PAID). Then one payment sync follows the payouts and,
// with the bills switch on, makes each paid invoice a bill at Airwallex: the vendor, the invoice PDF uploaded as a
// SPEND_ATTACHMENT, the bill with external_id = the signed terms hash, read back, then marked paid and read back again.
//
//   stand-in  the whole flow on the in-memory stand-ins (FakeAirwallex, FakeBills); 0 network
//   run       live: fresh ledger only; ingest, file, sign, execute, then syncPayments with the bills rail
//   facts     the run's facts from the ledger and the call log, as JSON; 0 calls
//   record    writes docs/runs/<date>-airwallex-bills.json from facts and the call log; 0 calls
// Live needs BILLS_GO=yes, AIRWALLEX_BILLS=on, AIRWALLEX_CALL_BUDGET (≤ 60), AIRWALLEX_CALL_LOG, KIT11_DB=…/airwallex-bills*.sqlite.
// No Claude call: the parser reads the invoices and the payables agents are off.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
const PASSKEY_LABEL = "airwallex-bills virtual test passkey";
const INVOICES = ["SLL-2026-11B1", "SLL-2026-11B2", "SLL-2026-11B3"] as const;
const VENDOR = "Stockline Data GmbH";
const MAX_BUDGET = 60;

for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const { openDb } = await import("../db/open.js");
const { seedTreasury } = await import("../agents/euroBill.js");
const { ibanSha } = await import("../agents/invoice.js");
const { CsvFileSink } = await import("../ap/books.js");
const { ingestDocument } = await import("../ap/inbox.js");
const { payApInvoice, syncPayments } = await import("../ap/pay.js");
const { pdfOf } = await import("../e2e/documents.js");
const { approvalOrigin } = await import("../executors/index.js");
const { executeInvoicePayment, FEE_RETRY } = await import("../executors/invoicePayment.js");
const { withOrigin } = await import("../provenance/origin.js");
const { confirmPasskey, fingerprintOf, openEnrolment } = await import("../passkey/ledger.js");
const { processAssertion, processRegistration } = await import("../passkey/process.js");
const { challengeFor } = await import("../passkey/webauthn.js");
const { FakeAuthenticator } = await import("../redteam/authenticator.js");
const { setSetting } = await import("../world/settings.js");
const { audit } = await import("../audit/log.js");
const { billsFromEnv, FakeBills } = await import("../airwallex/bills.js");
type DB = ReturnType<typeof openDb>;
type Rail = import("../airwallex/port.js").AirwallexRail & import("../airwallex/port.js").PayoutRail & import("../airwallex/port.js").SandboxSim;
type Asker = import("../ap/read.js").Asker;
type BillsRail = import("../airwallex/bills.js").BillsRail;

const RP = "airwallex-bills.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
const STOCKLINE = { beneficiaryId: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001" };
const parserOnly = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no model is asked in the airwallex-bills run: the parser reads" }) } as unknown as Asker;
const fixture = (no: string) => readFileSync(resolve(repo, "fixtures", `stockline-licence-${no}.txt`), "utf8");
const ledgerOk = (env: Record<string, string | undefined>) => /airwallex-bills[^\\/]*\.sqlite$/.test(env.KIT11_DB ?? "");

function refusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.BILLS_GO !== "yes") why.push("BILLS_GO=yes (the go for this run's sandbox calls)");
  if (env.AIRWALLEX_BILLS !== "on") why.push("AIRWALLEX_BILLS=on (the bills switch, off by default)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${MAX_BUDGET}`);
  if (!ledgerOk(env)) why.push("KIT11_DB=…/airwallex-bills*.sqlite (this run's own ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  return why;
}

function freshRefusal(db: DB): string | undefined {
  const active = db.prepare("SELECT label FROM passkeys WHERE status = 'ACTIVE'").all() as { label: string }[];
  if (active.length) return `this ledger already has an active passkey (${active.map((p) => p.label).join(", ")}); the run enrols a virtual test passkey only on a fresh ledger`;
  if (db.prepare(`SELECT 1 FROM ap_invoices WHERE invoice_no IN (${INVOICES.map(() => "?").join(", ")})`).get(...INVOICES)) return "the run's invoices already came in to this ledger; nothing is paid twice";
  return undefined;
}

function seedLedger(db: DB) {
  db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(STOCKLINE.beneficiaryId, VENDOR, "2051", ibanSha(STOCKLINE.iban), STOCKLINE.bic);
  setSetting(db, "treasury", "eur_floor", "25000.00");
  setSetting(db, "treasury", "eur_obligations", "0.00");
  setSetting(db, "treasury", "usd_floor", "0.00");
}

async function enrol(db: DB, now: Date) {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "airwallex-bills-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: InstanceType<typeof FakeAuthenticator>, proposalId: string, counter: number, now: Date) {
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter });
  const out = await processAssertion(db, { ticket: `airwallex-bills-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/** The three invoices: in as PDFs, filed, signed by the virtual test passkey, executed (the sandbox simulates PAID). */
async function pay(db: DB, rail: Rail, dir: string, feeRetry: typeof FEE_RETRY) {
  const now = () => new Date();
  const sink = new CsvFileSink(join(dir, "journal.csv"));
  const deps = { dir: join(dir, "ap"), reader: parserOnly, now, sink, agents: false };
  const auth = await enrol(db, now());
  const out: { no: string; id: string; proposalId: string; sha: string; transfer: { id: string; status: string } }[] = [];
  let counter = 0;
  for (const no of INVOICES) {
    const got = await ingestDocument(db, deps, { bytes: await pdfOf(fixture(no)), filename: `stockline-licence-${no}.pdf`, source: "upload" });
    if (got.kind !== "invoice") throw new Error(`${no} did not come in as an invoice (${got.kind})`);
    if (got.invoice.status !== "ready") throw new Error(`${no} came in ${got.invoice.status}: ${got.invoice.findings.map((f) => f.detail).join("; ")}`);
    const filed = await payApInvoice(db, rail, got.invoice.id, now(), parserOnly, { on: false });
    if (filed.kind !== "proposed") throw new Error(`${no} was not filed for payment: ${JSON.stringify(filed).slice(0, 300)}`);
    if (filed.alone) throw new Error(`${no} was approved by code alone; this run needs a signature`);
    const proposalId = filed.proposal.proposal_id;
    const sha = await sign(db, auth, proposalId, ++counter, now());
    const r = await withOrigin(approvalOrigin(db, proposalId)!, () => executeInvoicePayment(db, rail, rail, proposalId, now, feeRetry));
    audit(db, "system", "airwallex_bills.paid_out", r.transfer.id, { invoice_no: no, ap_invoice: got.invoice.id, proposal_id: proposalId, terms_sha256: sha, status: r.transfer.status, signer: PASSKEY_LABEL });
    out.push({ no, id: got.invoice.id, proposalId, sha, transfer: { id: r.transfer.id, status: r.transfer.status } });
  }
  return { out, sink };
}

const BILL_EVENTS = ["awx_bill.created", "awx_bill.paid", "awx_bill.attachment", "awx_bill.refused", "awx_bill.ambiguous", "awx_bill.failed", "awx_bill.payout_returned", "awx_vendor.created"];

async function facts(db: DB) {
  const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const calls = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const ev = q<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>(
    `SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'airwallex_bills.%' OR event IN (${BILL_EVENTS.map(() => "?").join(", ")}) OR event = 'transfer.status' ORDER BY seq`, ...BILL_EVENTS)
    .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
  const created = new Map(ev.filter((e) => e.event === "awx_bill.created").map((e) => [e.subject!, e]));
  const paid = new Map(ev.filter((e) => e.event === "awx_bill.paid").map((e) => [e.subject!, e]));
  const inv = q<{ id: string; invoice_no: string; vendor: string; currency: string; total: string; due_date: string; status: string; proposal_id: string | null; doc_sha256: string }>(
    "SELECT id, invoice_no, vendor, currency, total, due_date, status, proposal_id, doc_sha256 FROM ap_invoices ORDER BY invoice_no");
  const bills = inv.map((i) => {
    const p = i.proposal_id ? db.prepare(`SELECT p.terms_sha256, a.approved_sha256, a.method, t.transfer_id, t.status AS transfer_status, t.approval_sha256 FROM proposals p
      LEFT JOIN approvals a ON a.proposal_id = p.proposal_id LEFT JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id') WHERE p.proposal_id = ?`).get(i.proposal_id) as Record<string, string | null> | undefined : undefined;
    const c = created.get(i.id)?.payload, m = paid.get(i.id)?.payload;
    return {
      ap_invoice: i.id, invoice_no: i.invoice_no, amount: `${i.currency} ${i.total}`, due_date: i.due_date, invoice_status: i.status, proposal_id: i.proposal_id,
      signed_sha256: p?.approved_sha256 ?? null, signed_by: p?.method ?? null, transfer_id: p?.transfer_id ?? null, transfer_status: p?.transfer_status ?? null, transfer_approval_sha256: p?.approval_sha256 ?? null,
      bill_id: c?.bill_id ?? null, external_id: c?.external_id ?? null, external_id_is: c?.external_id_is ?? null,
      external_id_matches_signed: !!c && c.external_id === p?.approved_sha256 && c.external_id === p?.approval_sha256,
      created: c ? { how: c.how, status: c.status, amount: c.amount, attachment_ids: c.attachment_ids, read_back: c.read_back, differences: c.differences, at: created.get(i.id)!.ts, airwallex_created_at: c.created_at } : null,
      paid: m ? { status: m.status, payments: m.payments, read_back: m.read_back, differences: m.differences, at: paid.get(i.id)!.ts, airwallex_updated_at: m.updated_at } : null,
    };
  });
  return {
    invoices: [...INVOICES], bills,
    audit: ev,
    calls: { total: calls.length, by_endpoint: countByEndpoint(calls), first: calls[0]?.at ?? null, last: calls.at(-1)?.at ?? null },
  };
}

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
const print = (lines: Awaited<ReturnType<typeof import("../ap/billSync.js").syncBills>>) => { for (const l of lines) console.log(`BILL     ${l.invoice_no} ${l.invoice}: ${l.step} ${l.bill_id ?? "-"} ${l.detail}`); };

async function flow(db: DB, rail: Rail, bills: BillsRail, dir: string, feeRetry: typeof FEE_RETRY) {
  const { out, sink } = await pay(db, rail, dir, feeRetry);
  for (const m of out) console.log(`PAID OUT ${m.no} ${m.id} transfer ${m.transfer.id} ${m.transfer.status}; ${m.proposalId} signed by ${PASSKEY_LABEL}, terms ${m.sha}`);
  // One sync: the payouts followed, the invoices booked paid, and (bills switch) each made a bill and marked paid.
  const { syncBills } = await import("../ap/billSync.js");
  await syncPayments(db, { rail, sink, bills });
  // Anything the first sync could not finish (a payout not yet PAID) is reported by a second pass, without new creates.
  print(await syncBills(db, bills));
  return out;
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`airwallex-bills stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const awx = new FakeAirwallex();
  const bills = new FakeBills();
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "airwallex-bills-"));
  const db = openDb(":memory:");
  try {
    await seedTreasury(db, awx, awx);
    seedLedger(db);
    await flow(db, awx as unknown as Rail, bills, dir, { delaysMs: [], sleep: async () => {} });
    const f = await facts(db);
    for (const b of f.bills) console.log(`STAND-IN ${b.invoice_no}: bill ${b.bill_id} ${b.created?.status} → ${b.paid?.status ?? "-"}; external_id = signed hash: ${b.external_id_matches_signed}`);
    console.log(`STAND-IN Spend calls: ${bills.calls.join(", ")}`);
    const ok = f.bills.length === 3 && f.bills.every((b) => b.external_id_matches_signed && b.paid?.status === "PAID" && b.created?.read_back === "agrees" && b.paid?.read_back === "agrees" && (b.created?.attachment_ids as string[]).length === 1);
    console.log(`${ok ? "PASS" : "FAIL"}     three bills, external_id = signed hash, PDF attached, PAID, both read-backs agree`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
} else if ((cmd === "facts" || cmd === "record") && !ledgerOk(process.env)) {
  console.error("REFUSED  KIT11_DB=…/airwallex-bills*.sqlite (this run's own ledger); nothing was read");
  process.exit(2);
} else if (cmd === "facts") {
  console.log(JSON.stringify(await facts(openDb()), null, 2));
} else if (cmd === "record") {
  const f = await facts(openDb());
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const lines = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const date = process.env.BILLS_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("BILLS_DATE is YYYY-MM-DD"); process.exit(2); }
  const file = resolve(repo, "docs/runs", `${date}-airwallex-bills.json`);
  writeFileSync(file, `${JSON.stringify({
    stream: "airwallex-bills", capability: "spend-bills", sandbox: "api.sandbox.airwallex.com (files: files.sandbox.airwallex.com)", test_money: true,
    source: "built by `npm run airwallex-bills -- record` from the run ledger's audit rows and AIRWALLEX_CALL_LOG only",
    signer: PASSKEY_LABEL, simulated: "each transfer's SENT and PAID came from the sandbox's simulation endpoint; the bills, vendor, file, read-backs and mark_as_paid are Airwallex's own answers",
    budget: { approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, used: f.calls.total },
    ...f, calls: { ...f.calls, lines },
  }, null, 2)}\n`);
  console.log(`WROTE    ${file}`);
} else if (cmd === "run") {
  const why = refusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const db = openDb();
  const busy = freshRefusal(db);
  if (busy) { console.error(`REFUSED  ${busy}`); process.exit(2); }
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const cfg = fromEnv();
  const bills = await billsFromEnv();
  if (!cfg || !bills) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const rail = new AirwallexRest(new Airwallex(cfg)) as unknown as Rail;
  seedLedger(db);
  await flow(db, rail, bills, runDir(), FEE_RETRY);
} else {
  console.error("usage: npm run airwallex-bills -- stand-in | run | facts | record");
  process.exit(2);
}

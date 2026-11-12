// npm run awx-depth -- <command>: three Airwallex capabilities on the sandbox (docs/runs/2026-11-12-airwallex-*.md).
//   stand-in       all three on the in-memory stand-ins; 0 network
//   payee-check    live: Airwallex account verification of one test account, under its own name and under another
//   payee-check-doc-example  live: the same check on Airwallex's own documented example request (UK, sort code)
//   payee-check-doc-resolved live: that account again, under the name its bank gave back (read from this ledger)
//   ft             live: GET /financial_transactions for the awx-1 window, reconciled with docs/demo/airwallex-run.json
//   ft-reconcile   0 calls: the reconciliation again from the rows `ft` recorded (after a change to the comparison)
//   batch-create   live: two test invoices, ONE batch signed with a labelled virtual test passkey, sent as ONE Airwallex
//                  batch transfer, read back item by item, then submitted (Airwallex's approval workflow holds it)
//   batch-follow   live: one read of the batch and its items (GET); never approves, never resends
//   record         0 calls: docs/runs/<date>-airwallex-{payee-check,financial-transactions,batch-transfer}.json
//   facts          the run's facts from this ledger's audit rows and the call log, as JSON; 0 calls
// Live needs AWX_DEPTH_GO=yes, AIRWALLEX_CALL_BUDGET (≤ 40) and AIRWALLEX_CALL_LOG, KIT11_DB=…/awx-depth*.sqlite.
// Sandbox only (the client refuses any other host); test money only; nothing is approved in Airwallex's web app.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cmd = process.argv[2] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
export const AWX_DEPTH_PASSKEY_LABEL = "awx-depth virtual test passkey";
const RP = "awx-depth.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
const COMMAND = { actor: "cfo-command", command: "npm run awx-depth", moves_money: false } as const;

/** The two test invoices of the batch: the Stockline licence text with its own numbers and amounts. */
const base = readFileSync(resolve(repo, "fixtures", "stockline-licence-SLL-2026-11B.txt"), "utf8");
export const BATCH_INVOICES = [
  // The licence fee in code is EUR 240.00 (a different amount stops for a person), so both lines carry it.
  { no: "SLL-2026-11E", month: "Data licence, November 2026 (batch test E, awx-depth):" },
  { no: "SLL-2026-11F", month: "Data licence, November 2026 (batch test F, awx-depth):" },
].map((i) => ({ ...i, amount: "240.00", text: base.replace(/SLL-2026-11B/g, i.no).replace("Data licence, November 2026 (second payout, two-locks test):", i.month) }));
const STOCKLINE = { beneficiaryId: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", name: "Stockline Data GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001" };

const { openDb } = await import("../db/open.js");
const { audit } = await import("../audit/log.js");
type DB = ReturnType<typeof openDb>;

async function enrol(db: DB, now: Date) {
  const { FakeAuthenticator } = await import("../redteam/authenticator.js");
  const { confirmPasskey, fingerprintOf, openEnrolment } = await import("../passkey/ledger.js");
  const { processRegistration } = await import("../passkey/process.js");
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "awx-depth-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: AWX_DEPTH_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: { sign: (a: { challenge: string; origin: string; rpId: string; counter: number }) => unknown }, proposalId: string, now: Date) {
  const { processAssertion } = await import("../passkey/process.js");
  const { challengeFor } = await import("../passkey/webauthn.js");
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
  const out = await processAssertion(db, { ticket: `awx-depth-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/** Two invoices proposed, filed as one batch, signed once with the virtual test passkey, run as ONE Airwallex batch. */
async function batchFlow(db: DB, rail: import("../airwallex/port.js").AirwallexRail, batches: import("../airwallex/batchTransfers.js").BatchTransferRail) {
  const { proposeInvoicePayment } = await import("../agents/euroBill.js");
  const { parseInvoiceFallback, ibanSha } = await import("../agents/invoice.js");
  const { createBatch } = await import("../policy/batch.js");
  const { setSetting } = await import("../world/settings.js");
  const { withOrigin } = await import("../provenance/origin.js");
  const { approvalOrigin } = await import("../executors/index.js");
  const { executeAsOneAirwallexBatch } = await import("../executors/airwallexBatch.js");
  db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(STOCKLINE.beneficiaryId, STOCKLINE.name, STOCKLINE.iban.slice(-4), ibanSha(STOCKLINE.iban), STOCKLINE.bic);
  setSetting(db, "treasury", "eur_floor", "25000.00");
  setSetting(db, "treasury", "eur_obligations", "0.00");
  setSetting(db, "treasury", "usd_floor", "0.00");
  const auth = await enrol(db, new Date());
  const ids: string[] = [];
  for (const inv of BATCH_INVOICES) {
    const out = await withOrigin(COMMAND, () => proposeInvoicePayment(db, rail, parseInvoiceFallback(inv.text), inv.text));
    if (out.kind !== "proposed") throw new Error(`${inv.no} not proposed: ${out.reason}`);
    ids.push(out.proposal.proposal_id);
  }
  const batch = createBatch(db, ids, "treasury");
  const sha = await sign(db, auth as never, batch.proposal_id, new Date());
  audit(db, "system", "awx_depth.batch_signed", batch.proposal_id, { terms_sha256: sha, lines: ids, signer: AWX_DEPTH_PASSKEY_LABEL });
  return withOrigin(approvalOrigin(db, batch.proposal_id)!, () => executeAsOneAirwallexBatch(db, { batches, rail }, batch.proposal_id, { env: { AIRWALLEX_BATCH_TRANSFER: "on" } }));
}

/** The payee checks: the account under the name it was created with, and under another name. */
const PAYEE_CHECKS = [
  { name: STOCKLINE.name, iban: STOCKLINE.iban, expect: "the name the test account was created with" },
  { name: "Northbridge Trading Ltd", iban: STOCKLINE.iban, expect: "another company's name on the same account" },
];

/** Airwallex's own example request (docs: verify-a-beneficiary-account), a UK account by sort code, as published. */
const DOC_EXAMPLE = { name: "Betty Morras", entity: "PERSONAL" as const, country: "GB", currency: "GBP", accountNumber: "10006132", routingType: "sort_code", routingValue: "040568", accountKey: "GB:040568:10006132", expect: "Airwallex's documented example request (UK, sort code)" };

async function payeeChecks(db: DB, verifier: import("../airwallex/payeeName.js").PayeeNameVerifier, which: "test-account" | "doc-example" | "doc-resolved" = "test-account") {
  const { runNameCheck } = await import("../airwallex/payeeName.js");
  const out = [];
  // The name the bank gave back for the documented example, as recorded in this ledger (never typed in here).
  const resolved = which === "doc-resolved" ? (db.prepare("SELECT resolved_name FROM payee_name_checks WHERE vendor = ? AND resolved_name IS NOT NULL").get(DOC_EXAMPLE.name) as { resolved_name: string } | undefined)?.resolved_name : undefined;
  if (which === "doc-resolved" && !resolved) throw new Error("no resolved name recorded for the documented example yet; run payee-check-doc-example first");
  const checks = which === "doc-example"
    ? [{ expect: DOC_EXAMPLE.expect, name: DOC_EXAMPLE.name, account: { ...DOC_EXAMPLE } }]
    : which === "doc-resolved"
    ? [{ expect: "the same account under the name its bank gave back", name: resolved!, account: { ...DOC_EXAMPLE, name: resolved! } }]
    : PAYEE_CHECKS.map((c) => ({ expect: c.expect, name: c.name, account: { name: c.name, entity: "COMPANY" as const, country: "DE", currency: "EUR", iban: c.iban, accountKey: c.iban } }));
  for (const c of checks) {
    try {
      const r = await runNameCheck(db, verifier, c.account, "human");
      out.push({ asked: c.expect, code: r.code, match: r.match, proceed: !!r.proceed, label: r.label });
    } catch (e) {
      const err = e as { status?: number; code?: string; traceId?: string | null; message: string };
      audit(db, "human", "payee.name_check_error", c.name, { status: err.status ?? null, code: err.code ?? null, trace: err.traceId ?? null, asked: c.expect });
      out.push({ asked: c.expect, error: `${err.status ?? "?"} ${err.code ?? err.message.slice(0, 120)}` });
    }
  }
  return out;
}

/** The awx-1 window (7 November, docs/demo/airwallex-run.json): its payouts and conversion, nothing else asked. */
const FT_WINDOW = { from: "2026-11-07T12:00:00+0000", to: "2026-11-07T12:30:00+0000" };

async function facts(db: DB) {
  const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const file = process.env.AIRWALLEX_CALL_LOG;
  const calls = file ? readCallLog(file) : [];
  return {
    calls: { total: calls.length, by_endpoint: countByEndpoint(calls), first: calls[0]?.at ?? null, last: calls.at(-1)?.at ?? null },
    audit: q<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>(
      "SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'awx_%' OR event LIKE 'payee.name_%' OR event IN ('proposal.approved', 'proposal.executed', 'proposal.needs_reapproval', 'proposal.failed', 'batch.filed') ORDER BY seq")
      .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as unknown, payload_json: undefined })),
    proposals: q("SELECT p.proposal_id, p.kind, p.status, p.terms_sha256, a.approver, a.method FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id"),
    transfers: q("SELECT request_id, transfer_id, invoice_no, amount, currency, status, approval_sha256 FROM transfers ORDER BY invoice_no"),
    awx_batches: q("SELECT batch_id, request_id, awx_batch_id, status, batch_sha256, detail_json FROM awx_batches"),
    payee_name_checks: q("SELECT vendor, code, match, resolved_name, proceed, label, checked_at FROM payee_name_checks"),
  };
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "T0_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`awx-depth stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const { FakeBatchTransfers } = await import("../airwallex/batchTransfers.js");
  const { FakePayeeNames } = await import("../airwallex/payeeName.js");
  const { reconcileFinancialTransactions, ledgerMovementsFromRunRecord } = await import("../finance/awxFinancialTx.js");
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  awx.beneficiaries.push({ id: STOCKLINE.beneficiaryId, name: STOCKLINE.name, iban: STOCKLINE.iban, bic: STOCKLINE.bic, currency: "EUR" });
  const batches = new FakeBatchTransfers();
  const r = await batchFlow(db, awx, batches);
  console.log(`STAND-IN batch   ${r.outcome} ${r.status}; Airwallex calls: ${batches.calls.join(", ")}; rail calls: ${awx.calls.length}`);
  const bank = new FakePayeeNames();
  bank.accounts.set(STOCKLINE.iban, { name: STOCKLINE.name, entity: "COMPANY", bank: "stand-in" });
  console.log(`STAND-IN payee   ${JSON.stringify(await payeeChecks(db, bank))}`);
  const rec = JSON.parse(readFileSync(resolve(repo, "docs/demo/airwallex-run.json"), "utf8"));
  const rc = reconcileFinancialTransactions(ledgerMovementsFromRunRecord(rec), []);
  console.log(`STAND-IN ft      checked ${rc.checked}, agree ${rc.agree} (no stand-in rows: every movement is reported missing, as it should be)`);
  process.exitCode = r.outcome === "SUBMITTED" && r.status === "IN_APPROVAL" ? 0 : 1;
} else if (cmd === "facts") {
  console.log(JSON.stringify(await facts(openDb()), null, 2));
} else if (cmd === "record") {
  // 0 calls: the three run records, from this ledger's audit rows and the call log only (each command ran as its own
  // process, so its calls are told apart by pid). Written to docs/runs/<date>-airwallex-<capability>.json.
  const { writeFileSync } = await import("node:fs");
  const f = await facts(openDb());
  const { readCallLog, countByEndpoint } = await import("../airwallex/callBudget.js");
  const calls = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const capOfPid = new Map<number, string>();
  for (const c of calls) {
    if (c.endpoint.startsWith("/beneficiaries/verify_account")) capOfPid.set(c.pid, "payee-check");
    else if (c.endpoint.startsWith("/financial_transactions")) capOfPid.set(c.pid, "financial-transactions");
    else if (c.endpoint.startsWith("/batch_transfers")) capOfPid.set(c.pid, "batch-transfer");
  }
  const date = (process.env.AWX_DEPTH_DATE ?? new Date().toISOString().slice(0, 10));
  const pick = (events: (e: string) => boolean) => f.audit.filter((a) => events(a.event)).map((a) => ({ seq: a.seq, ts: a.ts, actor: a.actor, event: a.event, subject: a.subject, payload: a.payload }));
  const common = { stream: "airwallex-depth-1112", sandbox: "api.sandbox.airwallex.com", test_money: true, source: "built by `npm run awx-depth -- record` from the run ledger's audit rows and AIRWALLEX_CALL_LOG only", budget: { approved_for_stream: 40, used_by_stream: calls.length } };
  const callsOf = (cap: string) => { const mine = calls.filter((c) => capOfPid.get(c.pid) === cap); return { total: mine.length, by_endpoint: countByEndpoint(mine), lines: mine }; };
  const out: Record<string, unknown> = {
    "payee-check": { ...common, capability: "payee-check", calls: callsOf("payee-check"), checks: f.payee_name_checks, audit: pick((e) => e.startsWith("payee.name_")) },
    "financial-transactions": { ...common, capability: "financial-transactions", calls: callsOf("financial-transactions"), audit: pick((e) => e.startsWith("awx_ft.")) },
    "batch-transfer": {
      ...common, capability: "batch-transfer", calls: callsOf("batch-transfer"),
      signer: AWX_DEPTH_PASSKEY_LABEL, proposals: f.proposals, transfers: f.transfers, awx_batches: f.awx_batches,
      audit: pick((e) => e.startsWith("awx_") && !e.startsWith("awx_ft.") || e === "batch.filed" || e.startsWith("proposal.") || e === "awx_depth.batch_signed"),
    },
  };
  for (const [cap, body] of Object.entries(out)) {
    const file = resolve(repo, "docs/runs", `${date}-airwallex-${cap}.json`);
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    console.log(`WROTE    ${file}`);
  }
} else {
  const { awxDepthRefusals } = await import("./awxDepthRefusals.js");
  const why = awxDepthRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const cfg = fromEnv();
  if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const api = new Airwallex(cfg);
  const db = openDb();
  if (cmd === "payee-check" || cmd === "payee-check-doc-example" || cmd === "payee-check-doc-resolved") {
    const { AirwallexPayeeNameRest } = await import("../airwallex/payeeName.js");
    const which = cmd === "payee-check" ? "test-account" : cmd === "payee-check-doc-example" ? "doc-example" : "doc-resolved";
    for (const r of await payeeChecks(db, new AirwallexPayeeNameRest(api), which)) console.log(`CHECK    ${JSON.stringify(r)}`);
  } else if (cmd === "ft") {
    const { listFinancialTransactions, reconcileFinancialTransactions, ledgerMovementsFromRunRecord, recordReconciliation } = await import("../finance/awxFinancialTx.js");
    let fts;
    try {
      fts = await listFinancialTransactions(api, FT_WINDOW);
    } catch (e) {
      const err = e as { status?: number; code?: string; traceId?: string | null; message: string };
      audit(db, "system", "awx_ft.read_error", null, { ...FT_WINDOW, status: err.status ?? null, code: err.code ?? null, trace: err.traceId ?? null });
      console.error(`ERROR    ${err.status ?? ""} ${err.code ?? err.message.slice(0, 160)}`);
      process.exit(1);
    }
    audit(db, "system", "awx_ft.read", null, { ...FT_WINDOW, count: fts.length, items: fts.map((f) => ({ id: f.id, source_id: f.sourceId, source_type: f.sourceType, transaction_type: f.transactionType, currency: f.currency, amount_cents: f.amountCents, fee_cents: f.feeCents, net_cents: f.netCents, status: f.status, created_at: f.createdAt })) });
    const rec = JSON.parse(readFileSync(resolve(repo, "docs/demo/airwallex-run.json"), "utf8"));
    const r = reconcileFinancialTransactions(ledgerMovementsFromRunRecord(rec), fts);
    recordReconciliation(db, r, FT_WINDOW);
    console.log(`READ     ${fts.length} financial transactions in ${FT_WINDOW.from} … ${FT_WINDOW.to}`);
    for (const m of r.movements) console.log(`${m.agrees ? "AGREE   " : "DIFFERS "} ${m.label}: ledger ${m.ledger}; Airwallex ${m.airwallex} (${m.how})`);
    console.log(`UNKNOWN  ${r.unknownAtAirwallex.length}; out of scope ${JSON.stringify(r.outOfScope)}`);
  } else if (cmd === "ft-reconcile") {
    // 0 calls: the reconciliation again, from the rows the live read recorded in this ledger (awx_ft.read).
    const { reconcileFinancialTransactions, ledgerMovementsFromRunRecord, recordReconciliation } = await import("../finance/awxFinancialTx.js");
    const row = db.prepare("SELECT seq, payload_json FROM audit_log WHERE event = 'awx_ft.read' ORDER BY seq DESC LIMIT 1").get() as { seq: number; payload_json: string } | undefined;
    if (!row) { console.error("no recorded read; run ft first"); process.exit(2); }
    const p = JSON.parse(row.payload_json) as { from: string; to: string; items: { id: string; source_id: string | null; source_type: string; transaction_type: string; currency: string; amount_cents: number; fee_cents: number; net_cents: number; status: string; created_at: string | null }[] };
    const fts = p.items.map((i) => ({ id: i.id, sourceId: i.source_id, sourceType: i.source_type, transactionType: i.transaction_type, currency: i.currency, amountCents: i.amount_cents, feeCents: i.fee_cents, netCents: i.net_cents, status: i.status, createdAt: i.created_at, settledAt: null }));
    const rec = JSON.parse(readFileSync(resolve(repo, "docs/demo/airwallex-run.json"), "utf8"));
    const r = reconcileFinancialTransactions(ledgerMovementsFromRunRecord(rec), fts);
    recordReconciliation(db, r, { from: p.from, to: p.to });
    for (const m of r.movements) console.log(`${m.agrees ? "AGREE   " : "DIFFERS "} ${m.label}: ledger ${m.ledger}; Airwallex ${m.airwallex} (${m.how})`);
    console.log(`UNKNOWN  ${r.unknownAtAirwallex.length}; out of scope ${JSON.stringify(r.outOfScope)} (from the read recorded at audit row ${row.seq})`);
  } else if (cmd === "batch-create") {
    if ((db.prepare("SELECT COUNT(*) AS n FROM awx_batches").get() as { n: number }).n) { console.error("this ledger already holds an Airwallex batch; nothing is sent twice (batch-follow reads it)"); process.exit(2); }
    if ((db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE'").get() as { n: number }).n) { console.error("this ledger has an active passkey; the virtual test passkey is enrolled only on a fresh ledger"); process.exit(2); }
    const { AirwallexRest } = await import("../airwallex/adapter.js");
    const { AirwallexBatchRest } = await import("../airwallex/batchTransfers.js");
    try {
      const r = await batchFlow(db, new AirwallexRest(api), new AirwallexBatchRest(api));
      console.log(`BATCH    ${r.outcome}  ${r.status}  Airwallex batch ${r.awx_batch_id}  request ${r.request_id}`);
      for (const d of r.differences) console.log(`DIFFERS  ${d}`);
      for (const i of r.items) console.log(`ITEM     ${i.proposal_id} ${i.request_id} ${i.item_id ?? "-"} ${i.status}`);
    } catch (e) {
      const err = e as { status?: number; code?: string; traceId?: string | null; message: string };
      audit(db, "awx-executor", "awx_batch.error", null, { status: err.status ?? null, code: err.code ?? null, trace: err.traceId ?? null, message: err.message.slice(0, 200) });
      console.error(`ERROR    ${err.message.slice(0, 300)}`);
      process.exit(1);
    }
  } else if (cmd === "batch-follow") {
    const { AirwallexBatchRest } = await import("../airwallex/batchTransfers.js");
    const { followAirwallexBatch } = await import("../executors/airwallexBatch.js");
    const b = db.prepare("SELECT batch_id FROM awx_batches").get() as { batch_id: string } | undefined;
    if (!b) { console.error("no Airwallex batch in this ledger"); process.exit(2); }
    console.log(`FOLLOW   ${JSON.stringify(await followAirwallexBatch(db, new AirwallexBatchRest(api), b.batch_id))}`);
  } else {
    console.error("usage: npm run awx-depth -- stand-in | payee-check | ft | batch-create | batch-follow | facts");
    process.exit(2);
  }
}

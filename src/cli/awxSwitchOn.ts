// npm run awx-switch-on -- <command>: the three Airwallex products switched on in Purser's flow on 13 November (payee
// check, batch transfer, ledger reconciliation), run through the flow's own functions with none of their settings in
// the environment (each is on by default; a run with any of them set is refused).
//   stand-in   0 network: the same steps on the in-memory stand-ins (FakeAirwallex, FakeBatchTransfers, FakePayeeNames)
//   live       the Airwallex sandbox, test money only:
//              1. payee check: two new-supplier requests filed through checkThenProposePayeeAdd (the bank is asked
//                 before the CFO; a mismatch stops it). Airwallex's test IBAN under the name it was created with, and
//                 Airwallex's documented UK example account under the name its bank gave back on 12 November.
//              2. batch transfer: two test invoices, filed as one batch, signed once with a labelled virtual test
//                 passkey, run by the payment executor (src/executors/index.ts execute): ONE Airwallex batch, read back
//                 item by item, submitted; Airwallex's approval workflow holds it.
//              3. ledger reconciliation: the hourly reconciliation (src/finance/reconcile.ts) with the env's sources; the
//                 ledger holds the awx-1 payouts and conversion (7 November) as docs/demo/airwallex-run.json records them.
//   record     0 calls: docs/runs/<date>-airwallex-switch-on.json from this ledger's audit rows and the call log only
// Live needs AWX_SWITCH_ON_GO=yes, AIRWALLEX_CALL_BUDGET (≤ 40) and AIRWALLEX_CALL_LOG, KIT11_DB=…/awx-switch-on*.sqlite
// and KIT11_KEYS_DIR outside this repository. Nothing is approved in Airwallex's web app; nothing is simulated past it.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cmd = process.argv[2] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
export const SWITCH_ON_PASSKEY_LABEL = "awx-switch-on virtual test passkey";
const RP = "awx-switch-on.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
const COMMAND = { actor: "cfo-command", command: "npm run awx-switch-on", moves_money: false } as const;
const FLAGS = ["AIRWALLEX_PAYEE_CHECK", "AIRWALLEX_BATCH_TRANSFER", "AIRWALLEX_FINANCIAL_TX"] as const;
export const MAX_BUDGET = 40;

/** Why the live run may not start, or []. Reads the environment only. */
export function switchOnRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.AWX_SWITCH_ON_GO !== "yes") why.push("AWX_SWITCH_ON_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) > MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET at most ${MAX_BUDGET}`);
  if (!/awx-switch-on[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB=…/awx-switch-on*.sqlite (this run's own ledger)");
  if (!env.KIT11_KEYS_DIR || resolve(env.KIT11_KEYS_DIR).startsWith(repo)) why.push("KIT11_KEYS_DIR outside this repository");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  for (const f of FLAGS) if (env[f] !== undefined) why.push(`${f} unset: the run shows each product on by default`);
  return why;
}

/** The batch's two test invoices: the Stockline licence text with new numbers (no invoice is at Airwallex twice). */
const base = readFileSync(resolve(repo, "fixtures", "stockline-licence-SLL-2026-11B.txt"), "utf8");
const BATCH_INVOICES = ["I", "J"].map((x) => ({ no: `SLL-2026-11${x}`, text: base.replace(/SLL-2026-11B/g, `SLL-2026-11${x}`).replace("Data licence, November 2026 (second payout, two-locks test):", `Data licence, November 2026 (batch test ${x}, awx-switch-on):`) }));
/** Airwallex's sandbox test beneficiary (awx-1), and the account Airwallex's own docs use as their verify_account example. */
const STOCKLINE = { beneficiaryId: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", name: "Stockline Data GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001" };
const DOC_EXAMPLE = { country: "GB", currency: "GBP", accountNumber: "10006132", routingType: "sort_code" as const, routingValue: "040568" };
const HOW = "live sandbox run: Airwallex's own test account, no real supplier exists to call";
const ADDRESS = { street: "Test Street 1", city: "Test City", postcode: "10115" };

const { openDb } = await import("../db/open.js");
const { audit } = await import("../audit/log.js");
type DB = ReturnType<typeof openDb>;
const phase = (db: DB, name: string, at: "start" | "end", extra: Record<string, unknown> = {}) => audit(db, "system", "awx_switch.phase", name, { at, ...extra });

async function enrol(db: DB) {
  const { FakeAuthenticator } = await import("../redteam/authenticator.js");
  const { confirmPasskey, fingerprintOf, openEnrolment } = await import("../passkey/ledger.js");
  const { processRegistration } = await import("../passkey/process.js");
  const now = new Date();
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "awx-switch-on-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: SWITCH_ON_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: { sign: (a: { challenge: string; origin: string; rpId: string; counter: number }) => unknown }, proposalId: string) {
  const { processAssertion } = await import("../passkey/process.js");
  const { challengeFor } = await import("../passkey/webauthn.js");
  const now = new Date();
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
  const out = await processAssertion(db, { ticket: `awx-switch-on-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/** 1. Two new suppliers filed through the flow: the bank is asked first; the outcome is what the CFO would (not) see. */
async function payeeStep(db: DB, verifier: import("../airwallex/payeeName.js").PayeeNameVerifier) {
  const { requestPayeeAdd, recordPayeeAddVerification, checkThenProposePayeeAdd } = await import("../ap/vendors.js");
  // The name the bank gave back for the documented example on 12 November, read from that run's record (never typed).
  const rec = JSON.parse(readFileSync(resolve(repo, "docs/runs/2026-11-12-airwallex-payee-check.json"), "utf8")) as { checks: { vendor: string; resolved_name: string | null }[] };
  const resolved = rec.checks.find((c) => c.vendor === "Betty Morras" && c.resolved_name)?.resolved_name;
  if (!resolved) throw new Error("the 12 November record holds no resolved name for the documented example");
  const asks = [
    { vendor: STOCKLINE.name, req: { vendor: STOCKLINE.name, iban: STOCKLINE.iban, bic: STOCKLINE.bic, source: null } },
    { vendor: resolved, req: { vendor: resolved, bank: { ...DOC_EXAMPLE, accountName: resolved }, source: null } },
  ];
  const out: { vendor: string; outcome: string; proposal_id?: string; detail: string }[] = [];
  for (const a of asks) {
    const r = requestPayeeAdd(db, a.req, "treasury");
    recordPayeeAddVerification(db, r.add_id, { by: "the operator (sandbox run)", how: HOW, actor: "human", address: ADDRESS });
    try {
      const p = await checkThenProposePayeeAdd(db, verifier, r.add_id, "treasury");
      out.push({ vendor: a.vendor, outcome: "proposed to the CFO", proposal_id: p.proposal_id, detail: JSON.stringify(JSON.parse(p.terms_json).name_check) });
      audit(db, "system", "awx_switch.payee", r.add_id, { vendor: a.vendor, outcome: "proposed", proposal_id: p.proposal_id });
    } catch (e) {
      const err = e as { name?: string; status?: number; code?: string; message: string };
      const outcome = err.name === "PayeeNameRefused" ? "stopped before the CFO" : "error";
      out.push({ vendor: a.vendor, outcome, detail: `${err.status ?? ""} ${err.code ?? ""} ${err.message.slice(0, 200)}`.trim() });
      audit(db, "system", "awx_switch.payee", r.add_id, { vendor: a.vendor, outcome, detail: err.message.slice(0, 200), status: err.status ?? null, code: err.code ?? null });
    }
  }
  return out;
}

/** 2. Two invoices, one batch signed once, run by the payment executor itself (no flag in the environment). */
async function batchStep(db: DB, rail: import("../airwallex/port.js").AirwallexRail, rails?: import("../executors/index.js").Rails) {
  const { proposeInvoicePayment } = await import("../agents/euroBill.js");
  const { parseInvoiceFallback, ibanSha } = await import("../agents/invoice.js");
  const { createBatch } = await import("../policy/batch.js");
  const { setSetting } = await import("../world/settings.js");
  const { withOrigin } = await import("../provenance/origin.js");
  const { execute } = await import("../executors/index.js");
  db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(STOCKLINE.beneficiaryId, STOCKLINE.name, STOCKLINE.iban.slice(-4), ibanSha(STOCKLINE.iban), STOCKLINE.bic);
  setSetting(db, "treasury", "eur_floor", "25000.00");
  setSetting(db, "treasury", "eur_obligations", "0.00");
  setSetting(db, "treasury", "usd_floor", "0.00");
  const auth = await enrol(db);
  const ids: string[] = [];
  for (const inv of BATCH_INVOICES) {
    const out = await withOrigin(COMMAND, () => proposeInvoicePayment(db, rail, parseInvoiceFallback(inv.text), inv.text));
    if (out.kind !== "proposed") throw new Error(`${inv.no} not proposed: ${out.reason}`);
    ids.push(out.proposal.proposal_id);
  }
  const batch = createBatch(db, ids, "treasury");
  const sha = await sign(db, auth as never, batch.proposal_id);
  audit(db, "system", "awx_switch.batch_signed", batch.proposal_id, { terms_sha256: sha, lines: ids, signer: SWITCH_ON_PASSKEY_LABEL });
  await execute(db, batch.proposal_id, undefined, undefined, rails);
  const b = db.prepare("SELECT awx_batch_id, status FROM awx_batches WHERE batch_id = ?").get(batch.proposal_id) as { awx_batch_id: string | null; status: string } | undefined;
  return { batch_id: batch.proposal_id, awx_batch_id: b?.awx_batch_id ?? null, status: b?.status ?? "not at Airwallex", proposal: (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(batch.proposal_id) as { status: string }).status };
}

/** The awx-1 payouts and conversion (7 November) into this ledger, exactly as the committed record holds them. */
function loadAwx1(db: DB) {
  const rec = JSON.parse(readFileSync(resolve(repo, "docs/demo/airwallex-run.json"), "utf8")) as { invoices: { invoice_no: string; amount: string; transfer_id: string | null; status: string; fee: string | null; conversion_id: string | null; quote: null | { buy_eur: string; sell_usd: string } }[] };
  db.pragma("foreign_keys = OFF");
  const loaded: string[] = [];
  db.transaction(() => {
    for (const i of rec.invoices) {
      if (i.transfer_id && (i.status === "PAID" || i.status === "SENT")) {
        db.prepare("INSERT OR IGNORE INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, fee_actual) VALUES (?, ?, ?, ?, 'EUR', 'SWIFT', '20.00', ?, 'awx-1 record', ?, ?)")
          .run(i.transfer_id, `awx-1:${i.invoice_no}`, i.invoice_no, i.amount, i.status, new Date().toISOString(), i.fee);
        loaded.push(i.transfer_id);
      }
      if (i.conversion_id && i.quote) {
        db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, 'SETTLED', 'awx-1 record')")
          .run(i.conversion_id, `awx-1:${i.invoice_no}`, `awx-1:conv:${i.invoice_no}`, i.quote.buy_eur, i.quote.sell_usd);
        loaded.push(i.conversion_id);
      }
    }
  })();
  db.pragma("foreign_keys = ON");
  audit(db, "system", "awx_switch.ledger_loaded", null, { from: "docs/demo/airwallex-run.json", sources: loaded });
  return loaded;
}

async function facts(db: DB) {
  const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const calls = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const auditRows = q<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>(
    "SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'awx_%' OR event LIKE 'payee.name_%' OR event LIKE 'reconcile.%' OR event IN ('proposal.approved', 'proposal.executed', 'proposal.failed', 'batch.filed', 'payee.add_requested') ORDER BY seq")
    .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as unknown }));
  // Each call belongs to the phase whose start and end it falls between (one process, phases one after another).
  const phases = auditRows.filter((a) => a.event === "awx_switch.phase");
  const window = (name: string) => {
    const s = phases.find((p) => p.subject === name && (p.payload as { at: string }).at === "start"), e = phases.find((p) => p.subject === name && (p.payload as { at: string }).at === "end");
    return s && e ? calls.filter((c) => c.at >= s.ts && c.at <= e.ts) : [];
  };
  const per = Object.fromEntries(["payee-check", "batch-transfer", "ledger-reconciliation"].map((n) => { const c = window(n); return [n, { total: c.length, by_endpoint: countByEndpoint(c) }]; }));
  return {
    calls: { total: calls.length, by_endpoint: countByEndpoint(calls), by_phase: per, first: calls[0]?.at ?? null, last: calls.at(-1)?.at ?? null },
    audit: auditRows,
    proposals: q("SELECT p.proposal_id, p.kind, p.status, p.terms_sha256, a.approver, a.method FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id"),
    payee_adds: q("SELECT add_id, vendor, status, proposal_id FROM payee_adds"),
    payee_name_checks: q("SELECT vendor, code, match, resolved_name, proceed, label, checked_at FROM payee_name_checks"),
    transfers: q("SELECT request_id, transfer_id, invoice_no, amount, currency, status, fee_actual FROM transfers ORDER BY invoice_no"),
    awx_batches: q("SELECT batch_id, request_id, awx_batch_id, status, batch_sha256 FROM awx_batches"),
  };
}

async function runAll(db: DB, deps: { verifier: import("../airwallex/payeeName.js").PayeeNameVerifier; rail: import("../airwallex/port.js").AirwallexRail; rails?: import("../executors/index.js").Rails; sources: import("../finance/reconcile.js").ReconcileSources }) {
  const { reconcile } = await import("../finance/reconcile.js");
  phase(db, "payee-check", "start");
  for (const r of await payeeStep(db, deps.verifier)) console.log(`PAYEE    ${r.vendor}: ${r.outcome}${r.proposal_id ? ` (${r.proposal_id})` : ""}; ${r.detail}`);
  phase(db, "payee-check", "end");
  phase(db, "batch-transfer", "start");
  try {
    const b = await batchStep(db, deps.rail, deps.rails);
    console.log(`BATCH    ${b.batch_id} ${b.proposal}; Airwallex batch ${b.awx_batch_id ?? "-"} ${b.status}`);
  } catch (e) {
    const err = e as { status?: number; code?: string; message: string };
    audit(db, "system", "awx_switch.batch_error", null, { status: err.status ?? null, code: err.code ?? null, message: err.message.slice(0, 300) });
    console.log(`BATCH    ERROR ${err.message.slice(0, 300)}`);
  }
  phase(db, "batch-transfer", "end");
  phase(db, "ledger-reconciliation", "start");
  const loaded = loadAwx1(db);
  const r = await reconcile(db, deps.sources);
  console.log(`LEDGER   ${loaded.length} awx-1 movements loaded; reconcile: ${r.checked} checked, ${r.differences.length} difference(s); not checked: ${r.skipped.join(", ") || "none"}`);
  for (const d of r.differences) console.log(`DIFFERS  ${d.area} ${d.ref}: ledger ${d.ledger}; outside ${d.outside}`);
  phase(db, "ledger-reconciliation", "end");
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "T0_API_KEY", ...FLAGS]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`awx-switch-on stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const { FakeBatchTransfers } = await import("../airwallex/batchTransfers.js");
  const { FakePayeeNames } = await import("../airwallex/payeeName.js");
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  awx.beneficiaries.push({ id: STOCKLINE.beneficiaryId, name: STOCKLINE.name, iban: STOCKLINE.iban, bic: STOCKLINE.bic, currency: "EUR" });
  const bank = new FakePayeeNames();
  bank.accounts.set(STOCKLINE.iban, { name: "Some Other Name Ltd", entity: "COMPANY", bank: "stand-in" });
  bank.accounts.set(DOC_EXAMPLE.accountNumber, { name: "Betty Morris", entity: "COMPANY", bank: "stand-in" });
  const batches = new FakeBatchTransfers();
  await runAll(db, { verifier: bank, rail: awx, rails: { rail: awx, sim: awx, batches }, sources: { financialTransactions: async () => [] } });
  console.log(`STAND-IN batch calls: ${batches.calls.join(", ")}`);
} else if (cmd === "record") {
  const f = await facts(openDb());
  const date = process.env.AWX_SWITCH_ON_DATE ?? new Date().toISOString().slice(0, 10);
  const body = {
    stream: "airwallex-switch-on-1113", sandbox: "api.sandbox.airwallex.com", test_money: true,
    source: "built by `npm run awx-switch-on -- record` from the run ledger's audit rows and AIRWALLEX_CALL_LOG only",
    flags_in_environment: "none (AIRWALLEX_PAYEE_CHECK, AIRWALLEX_BATCH_TRANSFER, AIRWALLEX_FINANCIAL_TX unset: each on by default)",
    signer: SWITCH_ON_PASSKEY_LABEL, budget: { approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, used: f.calls.total }, ...f,
  };
  const file = resolve(repo, "docs/runs", `${date}-airwallex-switch-on.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`WROTE    ${file}`);
} else if (cmd === "live") {
  const why = switchOnRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const cfg = fromEnv();
  if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const db = openDb();
  if ((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'awx_switch.phase'").get() as { n: number }).n) { console.error("this ledger already holds a run; use a fresh KIT11_DB"); process.exit(2); }
  const api = new Airwallex(cfg);
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const { AirwallexPayeeNameRest } = await import("../airwallex/payeeName.js");
  const { reconcileSourcesFromEnv } = await import("../finance/sources.js");
  // The executor makes its own rails from the environment (no `rails`), exactly as the runner does.
  await runAll(db, { verifier: new AirwallexPayeeNameRest(api), rail: new AirwallexRest(api), sources: reconcileSourcesFromEnv(db) });
} else if (cmd === "deposit-follow") {
  // A later read of the last day's deposits (the first read, right after the simulated deposit, found none), recorded and
  // checked against Airwallex's ledger. Same ledger, log and budget as deposit-live.
  if (!/awx-switch-on-deposit[^/]*\.sqlite$/.test(process.env.KIT11_DB ?? "") || process.env.AWX_SWITCH_ON_GO !== "yes" || !process.env.AIRWALLEX_CALL_BUDGET) { console.error("REFUSED  the deposit run's own KIT11_DB, AWX_SWITCH_ON_GO=yes and its call budget"); process.exit(2); }
  const db = openDb();
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const cfg = fromEnv();
  if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const api = new Airwallex(cfg);
  const { listDeposits, pullDeposits } = await import("../airwallex/deposits.js");
  const { ftBySourceVia, reconcileLedgerAtAirwallex } = await import("../finance/awxFinancialTx.js");
  phase(db, "deposit-follow", "start");
  try {
    const r = await pullDeposits(db, (w) => listDeposits(api, w), new Date(), 1);
    audit(db, "system", "awx_deposit.read", null, { window_days: 1, read: r.read, fresh: r.fresh });
    console.log(`READ     ${r.read} deposit(s) in the last day, ${r.fresh} new to the ledger`);
    const l = await reconcileLedgerAtAirwallex(db, ftBySourceVia(api));
    console.log(`LEDGER   ${l.checked} checked, ${l.agree} agree, ${l.pending.length} pending, ${l.differences.length} difference(s)`);
  } catch (e) {
    const err = e as { status?: number; code?: string; message: string };
    audit(db, "system", "awx_deposit.error", null, { status: err.status ?? null, code: err.code ?? null, message: err.message.slice(0, 300) });
    console.log(`ERROR    ${err.status ?? ""} ${err.code ?? ""} ${err.message.slice(0, 300)}`);
  }
  phase(db, "deposit-follow", "end");
} else if (cmd === "deposit-live" || cmd === "deposit-record") {
  // Money received (13 November, src/airwallex/deposits.ts): one sandbox test deposit (EUR 125.00, test money) to the
  // company's first ACTIVE global account, read back with GET /deposits, recorded, and checked against Airwallex's own
  // ledger by source_id. Its own ledger (KIT11_DB=…/awx-switch-on-deposit*.sqlite) and budget.
  const db = openDb();
  if (cmd === "deposit-live") {
    const why = switchOnRefusals(process.env).filter((w) => !w.startsWith("KIT11_DB"));
    if (!/awx-switch-on-deposit[^/]*\.sqlite$/.test(process.env.KIT11_DB ?? "")) why.push("KIT11_DB=…/awx-switch-on-deposit*.sqlite (this run's own ledger)");
    if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
    const { fromEnv, Airwallex } = await import("../airwallex/client.js");
    const cfg = fromEnv();
    if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
    const api = new Airwallex(cfg);
    const { listDeposits, recordDeposits, simulateDeposit } = await import("../airwallex/deposits.js");
    const { ftBySourceVia, reconcileLedgerAtAirwallex } = await import("../finance/awxFinancialTx.js");
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
    const start = new Date();
    phase(db, "deposit", "start");
    try {
      const gas = await api.call<{ items?: { id: string; status?: string; currency?: string; country_code?: string }[] }>("GET", "/global_accounts", undefined, { page_num: "0", page_size: "20" });
      const ga = (gas?.items ?? []).find((g) => g.status === "ACTIVE");
      audit(db, "system", "awx_deposit.global_accounts", null, { count: gas?.items?.length ?? 0, active: (gas?.items ?? []).filter((g) => g.status === "ACTIVE").length, chosen: ga?.id ?? null });
      if (!ga) throw new Error("no ACTIVE global account in this sandbox; nothing was deposited");
      const sim = await simulateDeposit(api, { globalAccountId: ga.id, amount: "125.00", payer: "Sandbox test payer", reference: "awx-switch-on deposit" });
      audit(db, "system", "awx_deposit.simulated", sim.id, { global_account_id: ga.id, currency: sim.currency, amount_cents: sim.amountCents, status: sim.status, simulated: true });
      console.log(`SIMULATED deposit ${sim.id} ${sim.currency} ${(sim.amountCents / 100).toFixed(2)} ${sim.status} to ${ga.id}`);
      const read = await listDeposits(api, { from: iso(new Date(start.getTime() - 5 * 60_000)), to: iso(new Date(Date.now() + 60_000)) });
      const fresh = recordDeposits(db, read);
      console.log(`READ     ${read.length} deposit(s) in the window, ${fresh.length} new to the ledger: ${read.map((d) => `${d.id} ${d.currency} ${(d.amountCents / 100).toFixed(2)} ${d.status}`).join("; ")}`);
      const l = await reconcileLedgerAtAirwallex(db, ftBySourceVia(api));
      console.log(`LEDGER   ${l.checked} checked, ${l.agree} agree, ${l.pending.length} pending, ${l.differences.length} difference(s)`);
      for (const m of l.movements) console.log(`${m.agrees ? "AGREE   " : "NOT YET "} ${m.label}: ledger ${m.ledger}; Airwallex ${m.airwallex} (${m.how})`);
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      audit(db, "system", "awx_deposit.error", null, { status: err.status ?? null, code: err.code ?? null, message: err.message.slice(0, 300) });
      console.log(`ERROR    ${err.status ?? ""} ${err.code ?? ""} ${err.message.slice(0, 300)}`);
    }
    phase(db, "deposit", "end");
  } else {
    const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
    const calls = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
    const rows = (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event LIKE 'awx_%' ORDER BY seq").all() as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[])
      .map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as unknown }));
    const date = process.env.AWX_SWITCH_ON_DATE ?? new Date().toISOString().slice(0, 10);
    const file = resolve(repo, "docs/runs", `${date}-airwallex-deposits.json`);
    writeFileSync(file, `${JSON.stringify({ stream: "airwallex-switch-on-1113", capability: "deposits", sandbox: "api.sandbox.airwallex.com", test_money: true, simulated_deposit: true,
      source: "built by `npm run awx-switch-on -- deposit-record` from the run ledger's audit rows and AIRWALLEX_CALL_LOG only",
      budget: { approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, used: calls.length }, calls: { total: calls.length, by_endpoint: countByEndpoint(calls), lines: calls }, audit: rows }, null, 2)}\n`);
    console.log(`WROTE    ${file}`);
  }
} else {
  console.error("usage: npm run awx-switch-on -- stand-in | live | record | deposit-live | deposit-record");
  process.exit(2);
}

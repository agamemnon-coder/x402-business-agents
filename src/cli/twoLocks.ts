// npm run two-locks -- <command>: one payout that passes both locks (docs/runs/2026-11-10-airwallex-two-locks.md).
//   Lock 1: the CFO's passkey signs the exact terms in Purser (here a labelled virtual test passkey).
//   Lock 2: Airwallex's own transfer approval workflow ("Require API-initiated transfers to go through the same approval
//   workflow?" = Yes, set by Max in the sandbox web app) holds the API-created transfer IN_APPROVAL until a person approves
//   it in the Airwallex web app. Purser never approves at Airwallex and never simulates past that wait.
//
//   stand-in              the whole flow on the in-memory Airwallex stand-in with its approval workflow on; 0 network
//   create                live: propose, sign with the virtual passkey, execute; prints the transfer id (IN_APPROVAL)
//   follow                live: one read of the transfer (GET), recorded; never approves, never resends
//   settle                live, after Max approved (SCHEDULED): the sandbox's simulation endpoints move it SENT, then PAID
//   facts                 the run's facts from the ledger and the call log, as JSON; 0 calls
// Live needs TWO_LOCKS_GO=yes, AIRWALLEX_CALL_BUDGET, AIRWALLEX_CALL_LOG, KIT11_DB=…/two-locks*.sqlite.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
const FIXTURE = "stockline-licence-SLL-2026-11B.txt";
export const TWO_LOCKS_PASSKEY_LABEL = "two-locks virtual test passkey";

const text = readFileSync(resolve(repo, "fixtures", FIXTURE), "utf8");

const { openDb } = await import("../db/open.js");
const { proposeInvoicePayment, seedTreasury } = await import("../agents/euroBill.js");
const { parseInvoiceFallback, ibanSha } = await import("../agents/invoice.js");
const { followTransfer, describeTransferStatus } = await import("../airwallex/approvals.js");
const { approvalOrigin } = await import("../executors/index.js");
const { executeInvoicePayment, FEE_RETRY } = await import("../executors/invoicePayment.js");
const { LICENCE_COMMAND, withOrigin } = await import("../provenance/origin.js");
const { confirmPasskey, fingerprintOf, openEnrolment } = await import("../passkey/ledger.js");
const { processAssertion, processRegistration } = await import("../passkey/process.js");
const { challengeFor } = await import("../passkey/webauthn.js");
const { FakeAuthenticator } = await import("../redteam/authenticator.js");
const { setSetting } = await import("../world/settings.js");
const { audit } = await import("../audit/log.js");
type DB = ReturnType<typeof openDb>;
type Rail = import("../airwallex/port.js").AirwallexRail & import("../airwallex/port.js").SandboxSim;

const RP = "two-locks.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;

async function enrol(db: DB, now: Date) {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "two-locks-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: TWO_LOCKS_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: InstanceType<typeof FakeAuthenticator>, proposalId: string, now: Date) {
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
  const out = await processAssertion(db, { ticket: `two-locks-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/** Proposes the invoice, signs it with the virtual passkey and executes it: the transfer goes to Airwallex once. */
async function createPayout(db: DB, awx: Rail, feeRetry: typeof FEE_RETRY) {
  const now = new Date();
  const auth = await enrol(db, now);
  const out = await withOrigin(LICENCE_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text));
  if (out.kind !== "proposed") throw new Error(`not proposed: ${out.reason}`);
  const proposalId = out.proposal.proposal_id;
  const sha = await sign(db, auth, proposalId, new Date());
  const r = await withOrigin(approvalOrigin(db, proposalId)!, () => executeInvoicePayment(db, awx, awx, proposalId, undefined, feeRetry));
  audit(db, "system", "two_locks.created", r.transfer.id, { proposal_id: proposalId, terms_sha256: sha, status: r.transfer.status, signer: TWO_LOCKS_PASSKEY_LABEL });
  return { proposalId, sha, transfer: r.transfer };
}

function facts(db: DB) {
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  return {
    proposals: q("SELECT p.proposal_id, p.kind, p.status, p.terms_sha256, a.approver, a.method FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id"),
    transfers: q("SELECT transfer_id, request_id, invoice_no, amount, currency, status, approval_sha256, fee_actual, updated_at FROM transfers"),
    statuses: q("SELECT ts, subject, payload_json FROM audit_log WHERE event IN ('transfer.awaiting_airwallex_approval','transfer.status','two_locks.created','two_locks.simulated') ORDER BY seq"),
  };
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "T0_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`two-locks stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  awx.approvalWorkflow = true;
  await seedTreasury(db, awx, awx);
  const { transfer } = await createPayout(db, awx, { delaysMs: [], sleep: async () => {} });
  console.log(`STAND-IN created ${transfer.id}: ${transfer.status} (${describeTransferStatus(transfer.status)})`);
  console.log(`STAND-IN follow  ${JSON.stringify(await followTransfer(db, awx, transfer.id))}`);
  awx.decideInWebApp(transfer.id, "approve");
  console.log(`STAND-IN follow  ${JSON.stringify(await followTransfer(db, awx, transfer.id))}`);
  for (const to of ["SENT", "PAID"] as const) await awx.transitionTransfer(transfer.id, to);
  const end = await followTransfer(db, awx, transfer.id);
  console.log(`STAND-IN end     ${end.status}; createTransfer calls: ${awx.calls.filter((c) => c === "createTransfer").length}`);
  process.exitCode = end.status === "PAID" ? 0 : 1;
} else if (cmd === "facts") {
  console.log(JSON.stringify(facts(openDb()), null, 2));
} else {
  const why: string[] = [];
  if (process.env.TWO_LOCKS_GO !== "yes") why.push("TWO_LOCKS_GO=yes (Max's go)");
  if (!process.env.AIRWALLEX_CALL_BUDGET || !process.env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG");
  if (!/two-locks[^/]*\.sqlite$/.test(process.env.KIT11_DB ?? "")) why.push("KIT11_DB=…/two-locks*.sqlite (this run's own ledger)");
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const { airwallexFromEnv } = await import("../airwallex/adapter.js");
  const a = await airwallexFromEnv();
  if (!a) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  const awx = a.rail as unknown as Rail;
  const db = openDb();
  const transferId = () => (db.prepare("SELECT transfer_id FROM transfers WHERE invoice_no = 'SLL-2026-11B' AND transfer_id IS NOT NULL").get() as { transfer_id: string } | undefined)?.transfer_id;
  if (cmd === "create") {
    if (transferId()) { console.error(`already created: ${transferId()}; nothing is sent twice`); process.exit(2); }
    // The test world's payee and floors, without calls: the licensor's Airwallex beneficiary (created in awx-1) and
    // floors that let the EUR 240.00 payout come from EUR. Test money, sandbox only.
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
      .run(process.env.TWO_LOCKS_BENEFICIARY_ID ?? "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", "Stockline Data GmbH", "2051", ibanSha("DE02 1203 0000 0000 2020 51"), "BYLADEM1001");
    setSetting(db, "treasury", "eur_floor", "25000.00");
    setSetting(db, "treasury", "eur_obligations", "0.00");
    setSetting(db, "treasury", "usd_floor", "0.00");
    const r = await createPayout(db, awx, FEE_RETRY);
    console.log(`CREATED  ${r.transfer.id}  ${r.transfer.status} (${describeTransferStatus(r.transfer.status)})  proposal ${r.proposalId}  terms ${r.sha}`);
  } else if (cmd === "follow") {
    const id = transferId();
    if (!id) { console.error("no transfer yet"); process.exit(2); }
    const f = await followTransfer(db, awx, id);
    console.log(`FOLLOW   ${id}  ${f.status} (${describeTransferStatus(f.status)})${f.mismatch ? `  MISMATCH ${f.mismatch}` : ""}`);
  } else if (cmd === "settle") {
    const id = transferId();
    if (!id) { console.error("no transfer yet"); process.exit(2); }
    const st = (db.prepare("SELECT status FROM transfers WHERE transfer_id = ?").get(id) as { status: string }).status;
    if (st !== "SCHEDULED" && st !== "PROCESSING" && st !== "SENT") { console.error(`${id} is ${st}: only an approved transfer is settled (follow first)`); process.exit(2); }
    for (const to of st === "SENT" ? (["PAID"] as const) : (["SENT", "PAID"] as const)) {
      const t = await awx.transitionTransfer(id, to);
      audit(db, "system", "two_locks.simulated", id, { to, status: t.status, simulated: "Airwallex sandbox simulation endpoint" });
      db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE transfer_id = ?").run(t.status, new Date().toISOString(), id);
      console.log(`SIMULATED ${id} → ${t.status}`);
    }
  } else {
    console.error("usage: npm run two-locks -- stand-in | create | follow | settle | facts");
    process.exit(2);
  }
}

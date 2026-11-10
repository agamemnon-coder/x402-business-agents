// Retrying a company's refused payouts from its own ledger (10 November: Airwallex wanted the paying company's
// registration number): the invoices Claude read, the suppliers created and the account stay as they are; the binding
// is signed again with the retry's key (the first one lived in the run's memory, and a binding lasts an hour), a new
// test passkey replaces the first (whose private key lived only in that run's memory: the ledger revokes the old one),
// the invoices are approved again over new exact terms and paid with the company's TEST registration number as the
// payer's. Any payout not PAID stops the retry. No invoice is read again: no Claude call.

import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { signBinding } from "../../cloud/src/awxPlatform.js";
import { storeBinding } from "../airwallex/binding.js";
import { BINDING_TTL_MS, type PlatformStatus } from "../airwallex/platform.js";
import { payApInvoices } from "../ap/batchPay.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import { apInvoices } from "../ap/store.js";
import { openDb } from "../db/open.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executePaymentBatch } from "../executors/paymentBatch.js";
import { executeSupplierPayment } from "../executors/supplierPayment.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { followPayouts } from "../payouts/follow.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import type { Asker } from "../ap/read.js";
import type { PlatformOps } from "./platformOps.js";
import { E2E_ORIGIN, E2E_RP_ID, WaitingForAirwallexApproval, withPayer, type CompanyRails } from "./platformRun.js";
import type { WorldCompany } from "./world.js";

export interface RetryDeps {
  platform: Pick<PlatformOps, "feeAccount">;
  railFor(accountId: string): CompanyRails;
  feeBps: string;
  now: () => Date;
  log: (line: string) => void;
}

/** Retries one company's unpaid invoices; returns the new approval's id. Throws on any payout not PAID. */
export async function retryCompany(d: RetryDeps, runDir: string, c: WorldCompany & { accountId: string }, o: { onlyFirst?: boolean } = {}): Promise<string> {
  const now = d.now;
  const db = openDb(join(runDir, c.key.toLowerCase(), "ledger.db"));
  const saved = { a: process.env.AIRWALLEX_PLATFORM, f: process.env.AIRWALLEX_PLATFORM_FEE, k: process.env.PURSER_PLATFORM_PUBLIC_KEY, t: process.env.PURSER_TENANT_ID };
  try {
    const key = generateKeyPairSync("ed25519");
    Object.assign(process.env, { AIRWALLEX_PLATFORM: "on", AIRWALLEX_PLATFORM_FEE: "on", PURSER_PLATFORM_PUBLIC_KEY: key.publicKey.export({ format: "der", type: "spki" }).toString("base64"), PURSER_TENANT_ID: c.tenant });
    const issued = now().getTime();
    storeBinding(db, await signBinding(key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), { v: 1, tenant: c.tenant, account_id: c.accountId, status: "active" as PlatformStatus, name: c.name, fee_account: d.platform.feeAccount, issued_at: issued, expires_at: issued + BINDING_TTL_MS }), now());

    // The CFO's test passkey again: a new one replaces the first (revoked once this one is enrolled).
    const cfo = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: E2E_RP_ID, origin: E2E_ORIGIN, replace: true }, now());
    await processRegistration(db, { ticket: `${c.key}-retry-enrol`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: cfo.register({ challenge: window.challenge, origin: E2E_ORIGIN, rpId: E2E_RP_ID }) }), received_at: now().toISOString() }, { label: "cfo (test passkey, retry)" }, now());
    confirmPasskey(db, fingerprintOf(cfo.spkiSha256), now());
    let n = 0;
    const sign = async (proposalId: string, termsSha: string) => {
      const credential = cfo.sign({ challenge: challengeFor(termsSha), origin: E2E_ORIGIN, rpId: E2E_RP_ID, counter: ++n });
      const out = await processAssertion(db, { ticket: `${c.key}-retry-a${n}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: termsSha, credential }), received_at: now().toISOString() }, now());
      if (out.status !== "approved") throw new Error(`${c.key}: the test passkey's approval of ${proposalId} was ${out.status}: ${out.message}`);
    };

    const { rail, sim } = withPayer(d.railFor(c.accountId), c);
    const noRead: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "retry: no invoice is read again" }) } as Asker;
    await syncPayments(db, { now });
    const lastBefore = (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM transfers").get() as { n: number }).n;
    const ids = apInvoices(db, { status: "ready" }).map((i) => i.id).slice(0, o.onlyFirst ? 1 : undefined);
    if (!ids.length) throw new Error(`${c.key}: no invoice is ready to pay again (${apInvoices(db).map((i) => `${i.id} ${i.status}`).join(", ")})`);
    let proposal: { proposal_id: string; terms_sha256: string; kind: string };
    if (ids.length > 1) {
      const out = await payApInvoices(db, rail, ids, now(), noRead);
      if (!out.batch || out.notPlanned.length) throw new Error(`${c.key}: the batch was not planned: ${out.notPlanned.map((x) => x.reason).join("; ")}`);
      proposal = out.batch;
    } else {
      const out = await payApInvoice(db, rail, ids[0]!, now(), noRead);
      if (out.kind !== "proposed") throw new Error(`${c.key}: ${ids[0]} was not proposed: ${JSON.stringify(out).slice(0, 300)}`);
      proposal = out.proposal;
    }
    await sign(proposal.proposal_id, proposal.terms_sha256);
    d.log(`${c.key.padEnd(12)} retry: approved ${proposal.kind} ${proposal.proposal_id} with a new test passkey over ${proposal.terms_sha256.slice(0, 16)}…; payer registration ${c.testRegistrationNumber ?? "none"} (TEST)`);
    const run = async (pid: string) => {
      const k = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(pid) as { kind: string }).kind;
      if (k === "invoice_payment") await executeInvoicePayment(db, rail, sim, pid, now);
      else await executeSupplierPayment(db, rail, sim, pid, now);
    };
    if (proposal.kind === "payment_batch") await executePaymentBatch(db, proposal.proposal_id, run, now());
    else await run(proposal.proposal_id);
    await followPayouts(db, rail, now());
    await syncPayments(db, { now });
    const mine = db.prepare("SELECT t.transfer_id, t.status, t.invoice_no, t.failure_reason FROM transfers t WHERE t.rowid > ?").all(lastBefore) as { transfer_id: string | null; status: string; invoice_no: string; failure_reason: string | null }[];
    d.log(`${c.key.padEnd(12)} retry paid: ${mine.map((t) => `${t.transfer_id ?? "(none)"} ${t.status}`).join(", ")}`);
    const held = mine.filter((t) => t.status === "IN_APPROVAL").map((t) => t.transfer_id ?? "(no id)");
    if (held.length) throw new WaitingForAirwallexApproval(c.key, held);
    if (!mine.length || mine.some((t) => t.status !== "PAID")) throw new Error(`${c.key}: ${mine.map((t) => `${t.invoice_no} ${t.status}${t.failure_reason ? ` (${t.failure_reason})` : ""}`).join("; ") || "no payout"}: the retry stops here`);
    return proposal.proposal_id;
  } finally {
    db.close();
    for (const [k, v] of [["AIRWALLEX_PLATFORM", saved.a], ["AIRWALLEX_PLATFORM_FEE", saved.f], ["PURSER_PLATFORM_PUBLIC_KEY", saved.k], ["PURSER_TENANT_ID", saved.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// awx-1 on the stand-ins: the same driver (src/awx/scenario.ts) and the same ledger code, over the in-memory Airwallex
// and Issuing stand-ins (src/redteam), with 0 network. Webhooks are signed like Airwallex's and go through the runner's
// own handler; the CFO is a labelled virtual test passkey (a software authenticator, enrolled and confirmed like a
// phone); approved proposals run through their real executors on the stand-in rails. Never a live run's evidence.

import { createHmac } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { meetNewDeclines } from "../agents/declineTrigger.js";
import type { AirwallexRail } from "../airwallex/port.js";
import type { Get } from "../airwallex/verify.js";
import type { DB } from "../db/open.js";
import { approvalOrigin } from "../executors/index.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executePolicyChange } from "../executors/policyChange.js";
import { fromCents } from "../lib/money.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { handleAirwallexHook, type RelayedHook } from "../policy/cardHooks.js";
import { syncCardsAfterPolicy } from "../policy/cards.js";
import type { ReconcileSources } from "../finance/reconcile.js";
import { withOrigin } from "../provenance/origin.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { FakeIssuing } from "../redteam/issuing.js";
import type { Awx1Deps } from "./scenario.js";

export const STAND_IN_RP = "awx-1.stand-in.invalid";
export const STAND_IN_ORIGIN = `https://${STAND_IN_RP}`;
/** The approver label of the stand-in's CFO: a virtual test passkey, and the record says so on every approval. */
export const VIRTUAL_PASSKEY_LABEL = "awx-1 virtual test passkey";
/** The stand-in's webhook signing secret: made up here, never a real one (a real one lives only in the keys dir). */
export const STAND_IN_HOOK_SECRET = ["stand", "in", "awx1", "not", "a", "secret"].join("-");

const sign = (secret: string, ts: string, body: string) => createHmac("sha256", secret).update(ts + body).digest("hex");

/** The webhook bodies Airwallex sends (API version 2025-11-11: the object is `data` itself) for what the stand-ins hold. */
export function standInHookBodies(issuing: FakeIssuing, awx: FakeAirwallex, ids: { cardTransactions?: string[]; transfers?: string[] }, at: Date): { id: string; body: string }[] {
  const out: { id: string; body: string }[] = [];
  for (const id of ids.cardTransactions ?? []) {
    const t = issuing.txs.find((x) => x.transactionId === id);
    if (!t) throw new Error(`the stand-in holds no card transaction ${id}`);
    out.push({ id: `evt-${id}`, body: JSON.stringify({
      id: `evt-${id}`, name: t.approved ? "issuing.card_transaction_event.success" : "issuing.card_transaction_event.failed", account_id: "stand-in", created_at: at.toISOString(), version: "2025-11-11",
      data: { card_transaction_id: t.transactionId, card_id: t.cardId, process_result: t.approved ? "APPROVED" : "DECLINED", ...(t.failureReason ? { failure_reason: t.failureReason } : {}),
        transaction_amount: -t.amountCents / 100, transaction_currency: t.currency, transacted_at: t.occurredAt, merchant: { name: `${t.merchant}___`, category_code: t.mcc } },
    }) });
  }
  for (const id of ids.transfers ?? []) {
    const t = awx.transfers.find((x) => x.id === id);
    if (!t) throw new Error(`the stand-in holds no transfer ${id}`);
    out.push({ id: `evt-${id}-${t.status}`, body: JSON.stringify({
      id: `evt-${id}-${t.status}`, name: `payout.transfer.${String(t.status).toLowerCase()}`, account_id: "stand-in", created_at: at.toISOString(), version: "2025-11-11",
      data: { id: t.id, request_id: t.requestId, status: t.status, transfer_amount: Number(fromCents(t.amountCents)), transfer_currency: t.currency },
    }) });
  }
  return out;
}

export function signedHook(secret: string, h: { id: string; body: string }, at: Date): RelayedHook {
  const ts = String(at.getTime());
  return { id: h.id, ts, signature: sign(secret, ts, h.body), body: h.body };
}

/** What the runner does with a relayed webhook (src/cli/relay.ts onHook): record it, then meet any new decline. */
export async function runnerOnHook(db: DB, h: RelayedHook, secret: string, o: { client: Anthropic | null; now: Date }): Promise<string> {
  const line = handleAirwallexHook(db, h, secret, o.now);
  await meetNewDeclines(db, { by: "runner", client: o.client, now: o.now, env: { KIT11_AGENTS: "on" } });
  return line;
}

/** Enrols the stand-in's CFO: a software passkey, registered in an enrolment window and confirmed by its fingerprint. */
export async function enrolVirtualCfo(db: DB, now: Date): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: STAND_IN_RP, origin: STAND_IN_ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: STAND_IN_ORIGIN, rpId: STAND_IN_RP });
  const item: InboxItem = { ticket: "awx1-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() };
  const out = await processRegistration(db, item, { label: VIRTUAL_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

/** The stand-in CFO signs the proposal's exact hash with the virtual passkey; the runner's own check verifies it. */
export async function approveWithVirtualPasskey(db: DB, auth: FakeAuthenticator, proposalId: string, now: Date, counter: number): Promise<void> {
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string } | undefined)?.terms_sha256;
  if (!hash) throw new Error(`no proposal ${proposalId}`);
  const credential = auth.sign({ challenge: challengeFor(hash), origin: STAND_IN_ORIGIN, rpId: STAND_IN_RP, counter });
  const item: InboxItem = { ticket: `awx1-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() };
  const out = await processAssertion(db, item, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
}

/** Runs an approved proposal on the stand-in rails, by its kind, under its approval's origin (as execute() does live). */
export async function executeOnStandIns(db: DB, issuing: FakeIssuing, awx: FakeAirwallex, proposalId: string, now: () => Date): Promise<void> {
  const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string }).kind;
  const run = async () => {
    if (kind === "policy_change") {
      executePolicyChange(db, proposalId, now());
      await syncCardsAfterPolicy(db, proposalId, issuing, now());
    } else if (kind === "invoice_payment") {
      await executeInvoicePayment(db, awx, awx, proposalId, now, { delaysMs: [], sleep: async () => undefined });
    } else throw new Error(`the stand-in runs no ${kind}`);
  };
  const origin = approvalOrigin(db, proposalId);
  await (origin ? withOrigin(origin, run) : run());
}

/** Airwallex's read-only answers for npm run verify (src/airwallex/verify.ts), from what the stand-in holds. */
export function standInGet(awx: FakeAirwallex): Get {
  return async (path, query) => {
    const rid = query?.request_id;
    if (path === "/fx/conversions") {
      return { has_more: false, items: awx.conversions.filter((c) => c.requestId === rid).map((c) => ({
        conversion_id: c.conversionId, request_id: c.requestId, quote_id: c.quoteId, buy_amount: Number(fromCents(c.buyAmountCents)), sell_amount: Number(fromCents(c.sellAmountCents)),
        status: c.status, metadata: { approval_sha256: awx.conversionMetadata.get(c.conversionId) },
      })) };
    }
    if (path === "/transfers") {
      return { has_more: false, items: awx.transfers.filter((t) => t.requestId === rid).map((t) => ({
        id: t.id, request_id: t.requestId, transfer_amount: Number(fromCents(t.amountCents)), transfer_currency: t.currency, beneficiary_id: t.beneficiaryId, reference: t.reference,
        metadata: { approval_sha256: t.metadata }, status: t.status, fee_amount: t.fee ? Number(fromCents(t.fee.cents)) : null, fee_currency: t.fee?.currency ?? null,
      })) };
    }
    throw new Error(`the stand-in answers no GET ${path}`);
  };
}

/** The reconciliation's sources over the stand-ins (no Metal: an Airwallex-only world). */
export function standInSources(issuing: FakeIssuing, awx: AirwallexRail): ReconcileSources {
  return {
    transfer: async (id) => { const t = await awx.getTransfer(id); return { status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    transferByRequestId: async (rid) => { const t = await awx.findTransferByRequestIdStrict(rid); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    cardTransactions: (cardId) => issuing.listCardTransactions(cardId),
  };
}

/** The whole stand-in world: a ledger, the two stand-ins, the virtual CFO and the driver's deps. */
export async function standInDeps(db: DB, o: { client?: Anthropic | null; now?: () => Date; log?: (l: string) => void; deliver?: (hooks: RelayedHook[]) => Promise<void> } = {}): Promise<{ deps: Awx1Deps; issuing: FakeIssuing; awx: FakeAirwallex; auth: FakeAuthenticator }> {
  const now = o.now ?? (() => new Date());
  const issuing = new FakeIssuing();
  issuing.clock = () => now().getTime();
  const awx = new FakeAirwallex();
  awx.clock = () => now().getTime();
  const auth = await enrolVirtualCfo(db, now());
  let counter = 0;
  const deliver = o.deliver ?? (async (hooks: RelayedHook[]) => { for (const h of hooks) { const line = await runnerOnHook(db, h, STAND_IN_HOOK_SECRET, { client: o.client ?? null, now: now() }); o.log?.(`hook  ${line}`); } });
  const deps: Awx1Deps = {
    // Never the environment's Claude: the invoices are read by code's own parser; only a decline meets the scripted agent.
    db, issuing, awx, now, log: o.log, claude: null, agents: false,
    awaitWebhooks: async (ids) => deliver(standInHookBodies(issuing, awx, ids, now()).map((h) => signedHook(STAND_IN_HOOK_SECRET, h, now()))),
    approve: async (id) => { await approveWithVirtualPasskey(db, auth, id, now(), ++counter); await executeOnStandIns(db, issuing, awx, id, now); },
    waitFor: async (what, check) => { const v = check(); if (v === undefined) throw new Error(`stand-in: ${what} did not happen`); return v; },
  };
  return { deps, issuing, awx, auth };
}

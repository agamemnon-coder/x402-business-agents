// One company's engine as the cloud's routes see it (cloud/src/engine/routes.ts): the actions of the engine host
// (src/engine/host.ts), every one async, with plain data going in and coming out (a document's bytes as a
// Uint8Array), so the same interface is answered by an engine in this process (cloud/src/engine/node.ts, for tests
// and local runs) and by a Durable Object behind a stub. The cloud hands the company in when it asks for the engine
// (CloudEnv.engine(tenantId)); no method names a company.
//
// Only types are imported here: nothing of the engine reaches the Worker's bundle through this file.
import type { EngineEvent } from "../../../src/engine/events.js";
import type { InvoiceView, NegotiatedFacts, PaySignedResult, ProposalView, Settled, TermsView, UploadResult, VaultFile } from "../../../src/engine/host.js";
import type { ComposeInput, ComposeRefusal, SupplierOnFile } from "../../../src/engine/tryWorld.js";
import type { NameCheckView } from "../../../src/engine/host.js";
import type { AwxView } from "../../../src/engine/awxActions.js";

export type { AwxView, NameCheckView };
import type { FxQuoteNote } from "./liveFx.js";
import type { PayoutNote, SimulateReason } from "./livePayout.js";

export type { ComposeInput, ComposeRefusal, EngineEvent, InvoiceView, PaySignedResult, ProposalView, Settled, SupplierOnFile, TermsView, UploadResult, VaultFile };

/** Where the engine stands: always test money (the stand-in bank), the approval passkey, the bank's balances, both chains. */
export interface EngineStatus {
  mode: "test_money";
  passkey: { credential_id: string; label: string } | null;
  balances: Record<string, string>;
  chains: { audit: boolean; ledger: boolean };
}

export interface EngineApi {
  status(): Promise<EngineStatus>;
  /** The treasury's test money, floors and payees on the stand-in bank; safe to repeat. */
  seed(): Promise<void>;
  /** A document through the inbox: filed, read and checked. What the inbox refuses is thrown, in its own words ("...; nothing was filed"). */
  upload(doc: { bytes: Uint8Array; filename: string; mime?: string }): Promise<{ kind: string; sha256: string; invoice: InvoiceView | null }>;
  invoices(): Promise<InvoiceView[]>;
  invoice(id: string): Promise<InvoiceView | null>;
  /** Files the invoice's payment for approval; a reason not to comes back in the engine's words, and no proposal is made. */
  propose(invoiceId: string): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }>;
  proposal(id: string): Promise<ProposalView | null>;
  /** `rp`: the relying party of the request's host (cloud/src/hostOrigin.ts); without it, the engine's own. */
  passkeyStart(rp?: { rpId: string; origin: string }): Promise<{ challenge: string; code: string; exclude: string[] }>;
  /** label: the person's name, shown; person: the cloud's id for them, by which forgetPasskey finds the passkey. */
  passkeyFinish(a: { code: string; credential: unknown; label: string; person: string }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }>;
  /** A security key (the second key of high-risk payments) for the person whose passkey has this label; `rp` as for passkeyStart. */
  securityKeyStart(a: { label: string; rp?: { rpId: string; origin: string } }): Promise<{ ok: true; challenge: string; user_id: string; exclude: string[] } | { ok: false; reason: string }>;
  securityKeyFinish(a: { label: string; credential: unknown }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }>;
  /** The CFO's rule for high-risk payments as a policy change to approve with Face ID (its keys only). */
  proposeSecondKey(changes: { key: string; to: string }[]): Promise<{ ok: true; proposal: ProposalView } | { ok: false; reason: string }>;
  /** A passkey's signature over a proposal's exact terms; only an approval pays, and what follows is in settled. */
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown; hold?: boolean }): Promise<{ status: string; message: string; settled: Settled | null; held?: true }>;
  /**
   * Try again: an approved payment whose execution failed is run once more by the executor's own resume path (never a
   * second payment), then followed, booked, archived and fed. Anything else answers nothing_to_retry and nothing runs.
   */
  retry(proposalId: string): Promise<{ status: "retried" | "nothing_to_retry"; message: string; settled: Settled | null }>;
  /** Follows the payments, books, archives and feeds the read model; safe to repeat. */
  sync(): Promise<Settled>;
  events(after: number, limit?: number): Promise<{ items: EngineEvent[]; next: number }>;
  vaultFiles(): Promise<VaultFile[]>;
  /** A file's bytes, only for a path the archive's index lists. */
  vaultFile(path: string): Promise<Uint8Array | null>;
  /** A person erased by the cloud, by the id passkeyFinish was given: their passkeys are revoked and their name leaves them; safe to repeat. */
  forgetPasskey(person: string): Promise<{ revoked: number }>;
  /** Forgets everything this company's engine holds (its ledger, its documents, its stand-in bank). */
  wipe(): Promise<void>;

  // The hands-on demo (purser-try, cloud/src/try/): its sample invoices, the suppliers on file, "write your own".
  /** The sample invoices in the tray's order (none unless the deployment hands them in). */
  samples(): Promise<{ key: string; title: string; filename: string }[]>;
  /** A sample through the inbox; null for a key that is not a sample. The document cap applies, in the engine's words. */
  uploadSample(key: string): Promise<UploadResult | null>;
  /** The hands-on demo's sandbox override of a possible duplicate by the same total (src/engine/host.ts clearHold). */
  clearHold(id: string): Promise<{ ok: true; invoice: InvoiceView } | { ok: false; reason: string }>;
  /** A negotiation's agreed invoice: recorded, and replacing the original when there is one (src/engine/host.ts negotiated). */
  negotiated(replacementId: string, facts: NegotiatedFacts): Promise<{ ok: true; invoice: InvoiceView; superseded: InvoiceView | null } | { ok: false; reason: string }>;
  /** The hands-on demo's Reject of a held invoice (src/engine/host.ts rejectHold). */
  rejectHold(id: string): Promise<{ ok: true; invoice: InvoiceView } | { ok: false; reason: string }>;
  /** The suppliers the seed put on file (test IBANs). */
  suppliers(): Promise<SupplierOnFile[]>;
  /** The visitor's typed invoice, checked, rendered to a PDF and filed; a refused field comes back naming it. */
  compose(input: ComposeInput): Promise<UploadResult | ComposeRefusal>;
  /**
   * A proposal's stored terms, their canonical text and hash, and whether an approval is stored; fx_quote: on purser-try,
   * the note on the FX quote the terms carry (./liveFx.ts), not part of what is signed (the terms themselves are).
   */
  terms(proposalId: string): Promise<(TermsView & { fx_quote?: FxQuoteNote }) | null>;
  /** The one pay route: the sent terms with the browser's own signature, through the verifier and the executor's gate; pays only the signed terms. */
  paySigned(proposalId: string, sent: Record<string, unknown>, credential: unknown): Promise<(PaySignedResult & { airwallex_payout?: PayoutNote }) | { bad: string } | null>;
  /**
   * purser-try's "Sandbox: move to PAID" (./livePayout.ts): the proposal's Airwallex sandbox transfer moved by the
   * sandbox's own simulation; the note as it now stands, or why it was not moved. Elsewhere: { ok: false, no_binding }.
   */
  payoutSimulate(proposalId: string): Promise<{ ok: true; note: PayoutNote } | { ok: false; reason: SimulateReason; note: PayoutNote | null }>;
  // Purser Cloud's Airwallex actions (src/engine/awxActions.ts): each at the Airwallex sandbox when the admin's switch
  // and the caps allow it, else on the simulated bank, labelled. Test money either way.
  /** A new supplier from an invoice waiting for one: the owner's verification, the payee's bank check, a payee_add for the CFO's passkey. */
  addSupplier(invoiceId: string, v: { by: string; how: string; address: { street: string; city: string; postcode: string } }): Promise<{ ok: true; proposal: ProposalView; name_check: NameCheckView | null } | { ok: false; reason: string; name_check: NameCheckView | null }>;
  /** Pay all ready invoices with one passkey signature: one batch proposal over each invoice's own exact terms. */
  proposeBatch(invoiceIds: string[]): Promise<{ ok: true; proposal: ProposalView; planned: { id: string; proposal_id: string }[]; not_planned: { id: string; reason: string }[] } | { ok: false; reason: string; not_planned?: { id: string; reason: string }[] }>;
  /** Money in: a deposit on the bank's simulation into the USD account, booked. */
  depositIn(a: { amountCents: number; reference: string; payer: string }): Promise<{ ok: true; deposit_id: string; status: string; amount: string; currency: string; settled: Settled } | { ok: false; reason: string }>;
  /** Which bank each invoice was planned and paid at, with Airwallex's ids, the bank check, the caps and the labels. */
  airwallex(): Promise<AwxView>;
  /** The company in the product's sync format (the batches a runner's push sends), with no archive files. */
  exportBatch(): Promise<{ format: "purser.cloud-sync/v1"; company: string; made_at: string; batches: Record<string, unknown>[] }>;
  /** The same records as an A4 PDF a person reads (src/engine/recordsPdf.ts). */
  exportPdf(): Promise<Uint8Array>;
}

/**
 * The engine asked to be read less often: a company's object answers at most EVENTS_PER_SECOND reads of its events a
 * second (cloud/src/engine/object.ts), and the route answers 429 slow_down with retryMs.
 */
export class SlowDown extends Error {
  constructor(readonly retryMs: number, message: string) { super(message); this.name = "SlowDown"; }
}
export const EVENTS_PER_SECOND = 2;

/** Every action of the interface by name, held to the interface by the compiler. */
const everyMethod = <T extends readonly (keyof EngineApi)[]>(names: keyof EngineApi extends T[number] ? T : never): T => names;

/** What a caller across a boundary may ask a company's engine for (the Worker's stub of its Durable Object passes the name on). */
export const ENGINE_METHODS = everyMethod(["status", "seed", "upload", "invoices", "invoice", "propose", "proposal", "passkeyStart", "passkeyFinish", "securityKeyStart", "securityKeyFinish", "proposeSecondKey", "approve", "retry", "sync", "events", "vaultFiles", "vaultFile", "forgetPasskey", "wipe", "samples", "uploadSample", "suppliers", "compose", "terms", "paySigned", "clearHold", "rejectHold", "negotiated", "payoutSimulate", "exportBatch", "exportPdf", "addSupplier", "proposeBatch", "depositIn", "airwallex"] as const);

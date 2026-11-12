// One company's engine as the cloud's routes see it (cloud/src/engine/routes.ts): the actions of the engine host
// (src/engine/host.ts), every one async, with plain data going in and coming out (a document's bytes as a
// Uint8Array), so the same interface is answered by an engine in this process (cloud/src/engine/node.ts, for tests
// and local runs) and by a Durable Object behind a stub. The cloud hands the company in when it asks for the engine
// (CloudEnv.engine(tenantId)); no method names a company.
//
// Only types are imported here: nothing of the engine reaches the Worker's bundle through this file.
import type { EngineEvent } from "../../../src/engine/events.js";
import type { InvoiceView, PaySignedResult, ProposalView, Settled, TermsView, UploadResult, VaultFile } from "../../../src/engine/host.js";
import type { ComposeInput, ComposeRefusal, SupplierOnFile } from "../../../src/engine/tryWorld.js";

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
  passkeyStart(): Promise<{ challenge: string; code: string; exclude: string[] }>;
  /** label: the person's name, shown; person: the cloud's id for them, by which forgetPasskey finds the passkey. */
  passkeyFinish(a: { code: string; credential: unknown; label: string; person: string }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }>;
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
  /** The suppliers the seed put on file (test IBANs). */
  suppliers(): Promise<SupplierOnFile[]>;
  /** The visitor's typed invoice, checked, rendered to a PDF and filed; a refused field comes back naming it. */
  compose(input: ComposeInput): Promise<UploadResult | ComposeRefusal>;
  /** A proposal's stored terms, their canonical text and hash, and whether an approval is stored. */
  terms(proposalId: string): Promise<TermsView | null>;
  /** The one pay route: the sent terms with the browser's own signature, through the verifier and the executor's gate; pays only the signed terms. */
  paySigned(proposalId: string, sent: Record<string, unknown>, credential: unknown): Promise<PaySignedResult | { bad: string } | null>;
  /** The company in the product's sync format (the batches a runner's push sends), with no archive files. */
  exportBatch(): Promise<{ format: "purser.cloud-sync/v1"; company: string; made_at: string; batches: Record<string, unknown>[] }>;
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
export const ENGINE_METHODS = everyMethod(["status", "seed", "upload", "invoices", "invoice", "propose", "proposal", "passkeyStart", "passkeyFinish", "approve", "retry", "sync", "events", "vaultFiles", "vaultFile", "forgetPasskey", "wipe", "samples", "uploadSample", "suppliers", "compose", "terms", "paySigned", "exportBatch"] as const);

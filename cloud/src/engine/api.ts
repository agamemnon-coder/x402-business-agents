// One company's engine as the cloud's routes see it (cloud/src/engine/routes.ts): the actions of the engine host
// (src/engine/host.ts), every one async, with plain data going in and coming out (a document's bytes as a
// Uint8Array), so the same interface is answered by an engine in this process (cloud/src/engine/node.ts, for tests
// and local runs) and by a Durable Object behind a stub. The cloud hands the company in when it asks for the engine
// (CloudEnv.engine(tenantId)); no method names a company.
//
// Only types are imported here: nothing of the engine reaches the Worker's bundle through this file.
import type { EngineEvent } from "../../../src/engine/events.js";
import type { InvoiceView, ProposalView, Settled, VaultFile } from "../../../src/engine/host.js";

export type { EngineEvent, InvoiceView, ProposalView, Settled, VaultFile };

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
  passkeyFinish(a: { code: string; credential: unknown; label: string }): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }>;
  /** A passkey's signature over a proposal's exact terms; only an approval pays, and what follows is in settled. */
  approve(a: { proposal_id: string; terms_sha256: string; credential: unknown }): Promise<{ status: string; message: string; settled: Settled | null }>;
  /** Follows the payments, books, archives and feeds the read model; safe to repeat. */
  sync(): Promise<Settled>;
  events(after: number, limit?: number): Promise<{ items: EngineEvent[]; next: number }>;
  vaultFiles(): Promise<VaultFile[]>;
  /** A file's bytes, only for a path the archive's index lists. */
  vaultFile(path: string): Promise<Uint8Array | null>;
  /** Forgets everything this company's engine holds (its ledger, its documents, its stand-in bank). */
  wipe(): Promise<void>;
}

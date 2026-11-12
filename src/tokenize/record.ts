// What Purser puts on chain for an invoice token, and the checks before and after. The source of truth is the ledger:
// an invoice becomes a token only when its proposal was approved with a passkey (Face ID) over exactly the terms in
// the ledger, and the document is the one those terms name. On chain go hashes and amounts only; the debtor and the
// creditor are keyed hashes (HMAC-SHA-256 with a salt kept in this run's own ledger), so nobody can guess a name from
// the chain, and Purser can still show which invoice a token is.

import { createHash, createHmac } from "node:crypto";
import type { Address, Hex } from "viem";
import { centsToBaseUnits } from "../lib/money.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { fingerprintOf, spkiSha256OfCose } from "../passkey/ledger.js";
import { currencyBytes3, type OnChainInvoice } from "./client.js";

/** The ledger as these checks read it: a better-sqlite3 database, opened read-only by the live commands. */
export interface ReadableLedger { prepare(sql: string): { get(...params: unknown[]): unknown } }

export class MintRefused extends Error {
  constructor(readonly reason: string) { super(`not tokenized: ${reason}`); this.name = "MintRefused"; }
}

export interface ApprovedInvoice {
  proposalId: string;
  kind: string;
  termsSha256: string;
  invoiceNo: string;
  vendor: string;
  amountCents: number;
  currency: string;
  documentSha256: string;
  approver: string;
  approvedAt: string;
  /** The proposal's status in the source ledger: EXECUTED when the payment it was approved for was already made there. */
  status: string;
}

const DONE = new Set(["APPROVED", "EXECUTING", "EXECUTED"]);

/** The ledger's facts for one proposal, refused unless a passkey approved exactly these terms. */
export function approvedInvoice(db: ReadableLedger, proposalId: string): ApprovedInvoice {
  const p = db.prepare("SELECT proposal_id, kind, terms_json, terms_sha256, status FROM proposals WHERE proposal_id = ?").get(proposalId) as
    { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; status: string } | undefined;
  if (!p) throw new MintRefused(`no proposal ${proposalId} in the ledger`);
  const a = db.prepare("SELECT decision, approved_sha256, approver, method, created_at FROM approvals WHERE proposal_id = ?").get(proposalId) as
    { decision: string; approved_sha256: string; approver: string; method: string; created_at: string } | undefined;
  if (!a) throw new MintRefused(`${proposalId} has no approval`);
  if (a.decision !== "APPROVED") throw new MintRefused(`${proposalId} was ${a.decision.toLowerCase()}`);
  if (a.method !== "passkey") throw new MintRefused(`${proposalId} was approved by ${a.method}, not by a passkey`);
  if (!DONE.has(p.status)) throw new MintRefused(`${proposalId} is ${p.status}`);
  const terms = JSON.parse(p.terms_json) as Terms & { invoice_no?: string; vendor?: string; amount?: string; currency?: string; evidence?: { type: string; sha256: string }[] };
  if (termsHash(terms) !== p.terms_sha256) throw new MintRefused(`${proposalId}'s stored terms do not hash to its terms hash`);
  if (a.approved_sha256 !== p.terms_sha256) throw new MintRefused(`the passkey signed ${a.approved_sha256.slice(0, 12)}…, not these terms`);
  const doc = terms.evidence?.find((e) => e.type === "invoice");
  if (!terms.amount || !/^\d+\.\d{2}$/.test(terms.amount) || !terms.currency || !doc || !/^[0-9a-f]{64}$/.test(doc.sha256) || !terms.invoice_no)
    throw new MintRefused(`${proposalId} is not an invoice payment (no amount, currency or invoice document in its terms)`);
  return {
    proposalId, kind: p.kind, termsSha256: p.terms_sha256, invoiceNo: terms.invoice_no, vendor: terms.vendor ?? "",
    amountCents: Math.round(Number(terms.amount) * 100), currency: terms.currency, documentSha256: doc.sha256,
    approver: a.approver, approvedAt: a.created_at, status: p.status,
  };
}

export interface ApprovalPasskey {
  /** What a person compares on the phone and the runner: the first 64 bits of the passkey's public key hash. */
  fingerprint: string;
  /** The name the passkey was enrolled under in the source ledger. */
  label: string;
  aaguid: string | null;
  /** When the runner verified the passkey's signature over the terms. */
  verifiedAt: string;
}

/**
 * Which passkey approved the proposal, from the source ledger: the verified assertion over exactly these terms, and
 * the pinned public key it was checked against. Refused when the ledger holds no such assertion.
 */
export function approvalPasskey(db: ReadableLedger, proposalId: string): ApprovalPasskey {
  const a = db.prepare(`SELECT s.verified_at, k.public_key, k.label, k.aaguid FROM passkey_assertions s
    JOIN passkeys k ON k.credential_id = s.credential_id JOIN proposals p ON p.proposal_id = s.proposal_id
    WHERE s.proposal_id = ? AND s.outcome = 'APPROVED' AND s.terms_sha256 = p.terms_sha256 ORDER BY s.verified_at LIMIT 1`).get(proposalId) as
    { verified_at: string; public_key: string; label: string; aaguid: string | null } | undefined;
  if (!a) throw new MintRefused(`the ledger holds no verified passkey signature over ${proposalId}'s terms`);
  return { fingerprint: fingerprintOf(spkiSha256OfCose(a.public_key)), label: a.label, aaguid: a.aaguid, verifiedAt: a.verified_at };
}

export const sha256Bytes = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/** A keyed hash of a party's name: the same name and salt always give the same reference, nothing else does. */
export function partyRef(salt: Buffer, role: "debtor" | "creditor", name: string): Hex {
  if (salt.length < 16) throw new Error("the reference salt must be at least 16 bytes");
  return `0x${createHmac("sha256", salt).update(`purser:${role}:${name.trim().toLowerCase()}`).digest("hex")}`;
}

/** "Due date: 15 November 2026" in the document, as unix seconds (UTC midnight). */
export function dueDateFromDocument(text: string): bigint {
  const m = /Due date:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (!m) throw new MintRefused("the document has no due date");
  const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(m[2]!.toLowerCase());
  if (month < 0) throw new MintRefused(`unknown month in the due date: ${m[2]}`);
  return BigInt(Date.UTC(Number(m[3]), month, Number(m[1])) / 1000);
}

export interface MintInputs {
  document: string;
  creditor: Address;
  payer: Address;
  salt: Buffer;
  debtorName: string;
  /** What settlement pays, in base units of the settlement token (on testnet: *USDZ, see testnetFaceValue). */
  faceValue: bigint;
}

/** The on-chain record for an approved invoice; refused if the document is not the one the CFO approved. */
export function mintRecord(inv: ApprovedInvoice, m: MintInputs): OnChainInvoice {
  const docSha = sha256Bytes(m.document);
  if (docSha !== inv.documentSha256) throw new MintRefused(`the document is not the one the CFO approved (${docSha.slice(0, 12)}… ≠ ${inv.documentSha256.slice(0, 12)}…)`);
  if (m.faceValue <= 0n) throw new MintRefused("the face value must be positive");
  return {
    documentHash: `0x${docSha}`,
    termsHash: `0x${inv.termsSha256}`,
    amountMinor: BigInt(inv.amountCents),
    currency: currencyBytes3(inv.currency),
    faceValue: m.faceValue,
    dueDate: dueDateFromDocument(m.document),
    debtorRef: partyRef(m.salt, "debtor", m.debtorName),
    creditorRef: partyRef(m.salt, "creditor", inv.vendor),
    payer: m.payer,
    settled: false,
  };
}

/**
 * Testnet face value: *USDZ base units (18 decimals) for the invoice amount divided by `divisor`, so a run spends little
 * test money (EUR 240.00 with divisor 100 is 2.40 *USDZ). Test money, no exchange rate: the chain record keeps the
 * invoice's own amount and currency next to it. Refused when the division is not exact to the cent.
 */
export function testnetFaceValue(amountCents: number, divisor: number): bigint {
  if (!Number.isInteger(divisor) || divisor < 1) throw new Error("divisor must be a positive integer");
  if (amountCents % divisor !== 0) throw new MintRefused(`${amountCents} cents is not divisible by ${divisor}`);
  return centsToBaseUnits(amountCents / divisor);
}

/** Every field of the chain's record that differs from what the ledger and the document give now. Empty: it matches. */
export function verifyRecord(onChain: OnChainInvoice, expected: OnChainInvoice): string[] {
  const out: string[] = [];
  const keys: (keyof OnChainInvoice)[] = ["documentHash", "termsHash", "amountMinor", "currency", "faceValue", "dueDate", "debtorRef", "creditorRef", "payer"];
  for (const k of keys) {
    const a = String(onChain[k]).toLowerCase();
    const b = String(expected[k]).toLowerCase();
    if (a !== b) out.push(`${k}: chain ${a}, ledger ${b}`);
  }
  return out;
}

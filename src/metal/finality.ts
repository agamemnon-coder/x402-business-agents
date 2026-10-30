// Metal finality certificates as evidence (enterprise item 3). Metal's RPC returns, per block, the consensus
// certificate that finalised it (metal_getFinalityCertificate): the block header (RLP), the validators that signed
// (count and bitmap) and their aggregate BLS12-381 signature. Purser fetches it for each chain transaction in the
// ledger and keeps it with the evidence, so a payment's finality can be shown later without trusting today's RPC.
//
// What is checked here: the header hashes to the transaction's block; the bitmap names exactly signerCount validators,
// all within the participants; they reach the BFT quorum n - floor((n - 1) / 3). What is not: the BLS signature,
// which needs the validators' public keys, and Metal has not published them for testnet. The certificate binds the
// header; that the transaction is in the block comes from its receipt (the RPC), not from a receipt-trie proof.
//
// Nodes keep about the last 100,000 certificates: about 2.1 hours at testnet's 13.4 blocks a second (measured 30 Oct
// 2026). So the runner fetches them every minute; a transaction found later is marked NOT_KEPT, never guessed.

import { keccak256, type Hex } from "viem";
import type { DB } from "../db/open.js";
import { rpc } from "./network.js";
import { publicClient } from "./chain.js";

export interface FinalityCertificate {
  blockHash: string;
  blockNumber: number;
  headerRlp: string;
  certificate: string;
  epoch: number;
  view: number;
  parentView: number;
  participants: number;
  signerCount: number;
  signersBitmap: string;
  signatureEipUncompressed: string;
  namespace: string;
}

export interface CertificateCheck {
  ok: boolean;
  header_matches: boolean;
  bitmap_matches: boolean;
  quorum: { signers: number; participants: number; needed: number; met: boolean };
  not_checked: string;
}

export const NOT_CHECKED = "the BLS aggregate signature (it needs the validators' public keys, which Metal has not published for testnet)";

/** The BFT quorum for n validators: more than two thirds. */
export const quorumOf = (n: number) => n - Math.floor((n - 1) / 3);

const bitsOf = (hex: string): number[] => {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) return [];
  const v = BigInt(hex.length > 2 ? hex : "0x0");
  const out: number[] = [];
  for (let i = 0; i < 1024 && v >> BigInt(i) > 0n; i++) if ((v >> BigInt(i)) & 1n) out.push(i);
  return out;
};

export function checkCertificate(c: FinalityCertificate, blockHash: string): CertificateCheck {
  const header = (() => {
    try {
      return /^0x[0-9a-fA-F]+$/.test(c.headerRlp) && keccak256(c.headerRlp as Hex).toLowerCase() === blockHash.toLowerCase() && c.blockHash.toLowerCase() === blockHash.toLowerCase();
    } catch {
      return false;
    }
  })();
  const bits = bitsOf(c.signersBitmap);
  const participants = Number(c.participants);
  const bitmap = Number.isInteger(participants) && participants > 0 && bits.length === Number(c.signerCount) && bits.every((b) => b < participants);
  const needed = participants > 0 ? quorumOf(participants) : Infinity;
  const met = bitmap && bits.length >= needed;
  return { ok: header && bitmap && met, header_matches: header, bitmap_matches: bitmap, quorum: { signers: bits.length, participants, needed: Number.isFinite(needed) ? needed : 0, met }, not_checked: NOT_CHECKED };
}

export interface FinalityPorts {
  /** The block a transaction is final in, or null if it is not final (or not found) yet. */
  blockOf: (tx: string) => Promise<string | null>;
  /** The node's certificate for a block, or null if it no longer keeps it. */
  certificate: (blockHash: string) => Promise<FinalityCertificate | null>;
}

/** Live: the receipt's block, only once Metal reports it final; then the certificate from the same RPC. */
export const livePorts: FinalityPorts = {
  blockOf: async (tx) => {
    const r = await publicClient().getTransactionReceipt({ hash: tx as Hex }).catch(() => null);
    if (!r || r.status !== "success") return null;
    const st = await rpc<{ finalized: { number: number | string } }>("consensus_status");
    return BigInt(r.blockNumber) <= BigInt(st.finalized.number) ? r.blockHash : null;
  },
  certificate: (blockHash) => rpc<FinalityCertificate | null>("metal_getFinalityCertificate", [blockHash]),
};

/** Every chain transaction the ledger holds (payments, refunds, sweeps, mandate bindings, clearing, quarantine). */
const LEDGER_TXS = `
  SELECT tx_hash AS tx FROM sales WHERE tx_hash IS NOT NULL
  UNION SELECT tx_hash FROM upstream_purchases WHERE tx_hash IS NOT NULL
  UNION SELECT tx_hash FROM refunds WHERE tx_hash IS NOT NULL
  UNION SELECT tx_hash FROM sweeps WHERE tx_hash IS NOT NULL
  UNION SELECT tx_hash FROM chain_credits WHERE tx_hash IS NOT NULL
  UNION SELECT bound_tx FROM mandates WHERE bound_tx IS NOT NULL
  UNION SELECT created_tx FROM metal_accounts WHERE created_tx IS NOT NULL
  UNION SELECT tx FROM clearing_ops WHERE tx IS NOT NULL
  UNION SELECT tx_hash FROM quarantines WHERE tx_hash IS NOT NULL
  UNION SELECT resolved_tx FROM quarantines WHERE resolved_tx IS NOT NULL`;

const isTx = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

/**
 * Fetches and stores the certificate for every ledger transaction that has none yet. A transaction not final yet is
 * left for the next round; one whose block the node no longer keeps is marked NOT_KEPT; one whose certificate fails
 * the checks is stored as FAILED, never as good. Read-only towards the chain.
 */
export async function certifyPending(db: DB, ports: FinalityPorts = livePorts, now = new Date(), limit = 200): Promise<{ certified: number; not_kept: number; pending: number }> {
  const txs = (db.prepare(`SELECT tx FROM (${LEDGER_TXS}) WHERE tx NOT IN (SELECT tx FROM finality_evidence) LIMIT ?`).all(limit) as { tx: string }[]).map((r) => r.tx).filter(isTx);
  const out = { certified: 0, not_kept: 0, pending: 0 };
  for (const tx of txs) {
    const block = await ports.blockOf(tx).catch(() => null);
    if (!block) { out.pending++; continue; }
    const stored = db.prepare("SELECT ok FROM finality_certificates WHERE block_hash = ?").get(block) as { ok: number } | undefined;
    let status: "CERTIFIED" | "NOT_KEPT" | "FAILED";
    if (stored) status = stored.ok ? "CERTIFIED" : "FAILED";
    else {
      const cert = await ports.certificate(block).catch(() => null);
      if (!cert) status = "NOT_KEPT";
      else {
        const check = checkCertificate(cert, block);
        db.prepare("INSERT OR IGNORE INTO finality_certificates (block_hash, block_number, certificate_json, ok, check_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(block, Number(cert.blockNumber), JSON.stringify(cert), check.ok ? 1 : 0, JSON.stringify(check), now.toISOString());
        status = check.ok ? "CERTIFIED" : "FAILED";
      }
    }
    db.prepare("INSERT OR IGNORE INTO finality_evidence (tx, block_hash, status, recorded_at) VALUES (?, ?, ?, ?)").run(tx, block, status, now.toISOString());
    if (status === "NOT_KEPT") out.not_kept++;
    else out.certified += status === "CERTIFIED" ? 1 : 0;
  }
  return out;
}

export interface TxFinality {
  status: "CERTIFIED" | "NOT_KEPT" | "FAILED";
  block_hash: string;
  block_number: number | null;
  check: CertificateCheck | null;
  certificate: FinalityCertificate | null;
}

/** What the ledger holds on one transaction's finality certificate, or null if it was never looked up. */
export function finalityOf(db: DB, tx: string): TxFinality | null {
  const r = db.prepare("SELECT e.status, e.block_hash, c.block_number, c.check_json, c.certificate_json FROM finality_evidence e LEFT JOIN finality_certificates c ON c.block_hash = e.block_hash WHERE e.tx = ?").get(tx) as
    { status: TxFinality["status"]; block_hash: string; block_number: number | null; check_json: string | null; certificate_json: string | null } | undefined;
  if (!r) return null;
  return { status: r.status, block_hash: r.block_hash, block_number: r.block_number, check: r.check_json ? (JSON.parse(r.check_json) as CertificateCheck) : null, certificate: r.certificate_json ? (JSON.parse(r.certificate_json) as FinalityCertificate) : null };
}

/** Counts for verify, the audit report and the dashboard. */
export function finalityView(db: DB): { certified: number; not_kept: number; failed: number; blocks: number } {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finality_evidence'").get()) return { certified: 0, not_kept: 0, failed: 0, blocks: 0 };
  const n = (status: string) => (db.prepare("SELECT COUNT(*) AS n FROM finality_evidence WHERE status = ?").get(status) as { n: number }).n;
  return { certified: n("CERTIFIED"), not_kept: n("NOT_KEPT"), failed: n("FAILED"), blocks: (db.prepare("SELECT COUNT(*) AS n FROM finality_certificates").get() as { n: number }).n };
}

/**
 * For npm run verify: every stored certificate checked again offline against its block, and how many ledger
 * transactions have one. A stored certificate that fails, or a FAILED transaction, fails verify; NOT_KEPT is a note.
 */
export function finalityChecks(db: DB): { level: "ok" | "fail" | "note"; what: string; detail: string }[] {
  const v = finalityView(db);
  if (v.certified + v.failed + v.not_kept === 0) return [{ level: "note", what: "finality certificates", detail: "none looked up in this ledger (the runner fetches them every minute)" }];
  const rows = db.prepare("SELECT block_hash, certificate_json FROM finality_certificates").all() as { block_hash: string; certificate_json: string }[];
  const bad = rows.filter((r) => !checkCertificate(JSON.parse(r.certificate_json) as FinalityCertificate, r.block_hash).ok).map((r) => r.block_hash.slice(0, 10));
  const out: { level: "ok" | "fail" | "note"; what: string; detail: string }[] = [
    { level: bad.length || v.failed ? "fail" : "ok", what: "finality certificates", detail: `${v.certified} transaction(s) in ${rows.length} certified block(s): header hash, signer bitmap and quorum hold${bad.length ? `; failing: ${bad.join(", ")}` : ""}${v.failed ? `; ${v.failed} transaction(s) with a failing certificate` : ""}; not checked: ${NOT_CHECKED}` },
  ];
  if (v.not_kept) out.push({ level: "note", what: "finality certificates", detail: `${v.not_kept} transaction(s) looked up after the node stopped keeping their block's certificate (about 2 hours on testnet)` });
  return out;
}

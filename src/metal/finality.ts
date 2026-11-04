// Metal finality certificates as evidence (enterprise item 3). Metal's RPC returns, per block, the consensus
// certificate that finalised it (metal_getFinalityCertificate): the block header (RLP), the validators that signed
// (a count and a bitmap) and their aggregate BLS12-381 signature. Purser stores it for each chain transaction in the
// ledger, so a payment's finality is kept with its evidence instead of being looked up again later.
//
// What this is, and is not. Checked: the header hashes to the transaction's block; the header's own block number is
// the certificate's; the bitmap names exactly signerCount validators of the PINNED validator count (not the count the
// certificate claims); they reach the BFT quorum n - floor((n - 1) / 3). Not checked: the BLS signature, which needs
// the validators' public keys, and Metal has not published them for testnet. So a stored certificate is what Metal's
// RPC REPORTED at fetch time, consistent with itself, and every place that shows one says so; a lying RPC could have
// made one up. The certificate binds the header; that the transaction is in the block comes from its receipt (the
// same RPC), not from a receipt-trie proof.
//
// Nodes keep about the last 100,000 certificates: about 2.1 hours at testnet's 13.4 blocks a second (measured 30 Oct
// 2026). So the runner fetches them every minute. A transaction is marked NOT_KEPT only when the node has no
// certificate for a block older than that; an RPC error or a certificate not indexed yet is tried again.

import { fromRlp, hexToBigInt, keccak256, type Hex } from "viem";
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
  number_matches: boolean;
  bitmap_matches: boolean;
  quorum: { signers: number; participants: number; needed: number; met: boolean };
  not_checked: string;
}

/**
 * Metal testnet's validator count, pinned here from what its certificates report (4, on 30 October 2026); Metal has
 * not published the set. A certificate claiming another count fails, instead of setting its own quorum.
 */
export const PINNED_VALIDATORS = 4;
/** How many blocks of certificates a node keeps (docs.metalntwx.com, finality certificates). */
export const RETENTION_BLOCKS = 100_000;
/** Tries before a transaction that never shows as final is given up on: one a minute, about two hours. */
export const MAX_TRIES = 120;

export const NOT_CHECKED = "the BLS signature (it needs the validators' public keys, which Metal has not published for testnet), so this is what Metal's RPC reported";

/** The BFT quorum for n validators: more than two thirds. */
export const quorumOf = (n: number) => n - Math.floor((n - 1) / 3);

const bitsOf = (hex: string): number[] => {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) return [];
  const v = BigInt(hex.length > 2 ? hex : "0x0");
  const out: number[] = [];
  for (let i = 0; i < 1024 && v >> BigInt(i) > 0n; i++) if ((v >> BigInt(i)) & 1n) out.push(i);
  return out;
};

/** The block number inside Metal's header: [1] is an Ethereum-style header, whose field 8 is the number. */
function headerNumber(headerRlp: string): bigint | null {
  try {
    const h = fromRlp(headerRlp as Hex) as unknown[];
    const inner = h[1];
    return Array.isArray(inner) && typeof inner[8] === "string" ? hexToBigInt(inner[8] as Hex) : null;
  } catch {
    return null;
  }
}

export function checkCertificate(c: FinalityCertificate, blockHash: string, validators = PINNED_VALIDATORS): CertificateCheck {
  const header = (() => {
    try {
      return /^0x[0-9a-fA-F]+$/.test(c.headerRlp) && keccak256(c.headerRlp as Hex).toLowerCase() === blockHash.toLowerCase() && c.blockHash.toLowerCase() === blockHash.toLowerCase();
    } catch {
      return false;
    }
  })();
  const number = header && headerNumber(c.headerRlp) === BigInt(c.blockNumber);
  const bits = bitsOf(c.signersBitmap);
  const bitmap = Number(c.participants) === validators && bits.length === Number(c.signerCount) && bits.every((b) => b < validators);
  const needed = quorumOf(validators);
  const met = bitmap && bits.length >= needed;
  return { ok: header && number && bitmap && met, header_matches: header, number_matches: number, bitmap_matches: bitmap, quorum: { signers: bits.length, participants: validators, needed, met }, not_checked: NOT_CHECKED };
}

export interface FinalityPorts {
  /** The block a transaction is final in, or null if it is not final or not found yet. Throws on an RPC error. */
  blockOf: (tx: string) => Promise<{ hash: string; number: number } | null>;
  /** The node's certificate for a block, or null if it has none. Throws on an RPC error. */
  certificate: (blockHash: string) => Promise<FinalityCertificate | null>;
  /** The latest final block. */
  finalized: () => Promise<number>;
}

/** Live: the receipt's block (succeeded or reverted), only once Metal reports it final; then the certificate. */
export const livePorts: FinalityPorts = {
  blockOf: async (tx) => {
    const r = await publicClient().getTransactionReceipt({ hash: tx as Hex }).catch((e: Error) => (/not be found|not found/i.test(e.message) ? null : Promise.reject(e)));
    // A reverted transaction is final too: its certificate shows the refusal stands. The receipt says which it was.
    if (!r) return null;
    const final = await livePorts.finalized();
    return Number(r.blockNumber) <= final ? { hash: r.blockHash, number: Number(r.blockNumber) } : null;
  },
  certificate: (blockHash) => rpc<FinalityCertificate | null>("metal_getFinalityCertificate", [blockHash]),
  finalized: async () => Number((await rpc<{ finalized: { number: number | string } }>("consensus_status")).finalized.number),
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
type Counts = { reported: number; not_kept: number; failed: number; pending: number };

/** Looks up every ledger transaction with no settled finality evidence yet; the least-tried first. */
export async function certifyPending(db: DB, ports: FinalityPorts = livePorts, now = new Date(), limit = 200): Promise<Counts> {
  const txs = (db.prepare(`SELECT l.tx FROM (${LEDGER_TXS}) l LEFT JOIN finality_pending p ON p.tx = l.tx
    WHERE l.tx NOT IN (SELECT tx FROM finality_evidence) ORDER BY COALESCE(p.tries, 0), l.tx LIMIT ?`).all(limit) as { tx: string }[]).map((r) => r.tx);
  return certifyTxs(db, txs, ports, now);
}

/**
 * The same for named transactions (a demo run's own, which sit in no ledger table). Settles each once: REPORTED,
 * FAILED (its certificate failed a check: never evidence), NOT_KEPT (no certificate for a block past retention) or
 * NOT_FOUND (never final in MAX_TRIES tries). Anything else, an RPC error included, stays pending for the next round.
 */
export async function certifyTxs(db: DB, list: readonly string[], ports: FinalityPorts = livePorts, now = new Date()): Promise<Counts> {
  const seen = db.prepare("SELECT 1 FROM finality_evidence WHERE tx = ?");
  const txs = [...new Set(list)].filter((t) => !seen.get(t));
  const out: Counts = { reported: 0, not_kept: 0, failed: 0, pending: 0 };
  const settle = (tx: string, block: string, status: EvidenceStatus) => {
    db.prepare("INSERT OR IGNORE INTO finality_evidence (tx, block_hash, status, recorded_at) VALUES (?, ?, ?, ?)").run(tx, block, status, now.toISOString());
    db.prepare("DELETE FROM finality_pending WHERE tx = ?").run(tx);
  };
  const later = (tx: string) => {
    out.pending++;
    db.prepare("INSERT INTO finality_pending (tx, tries, last_at) VALUES (?, 1, ?) ON CONFLICT(tx) DO UPDATE SET tries = tries + 1, last_at = excluded.last_at").run(tx, now.toISOString());
    const tries = (db.prepare("SELECT tries FROM finality_pending WHERE tx = ?").get(tx) as { tries: number }).tries;
    if (tries >= MAX_TRIES) settle(tx, "", "NOT_FOUND");
  };
  for (const tx of txs) {
    if (!isTx(tx)) { settle(tx, "", "NOT_FOUND"); continue; }
    try {
      const block = await ports.blockOf(tx);
      if (!block) { later(tx); continue; }
      const stored = db.prepare("SELECT ok FROM finality_certificates WHERE block_hash = ?").get(block.hash) as { ok: number } | undefined;
      if (stored) { settle(tx, block.hash, stored.ok ? "REPORTED" : "FAILED"); out[stored.ok ? "reported" : "failed"]++; continue; }
      const cert = await ports.certificate(block.hash);
      if (!cert) {
        // No certificate: past retention it is gone for good; otherwise it may not be indexed yet.
        if ((await ports.finalized()) - block.number > RETENTION_BLOCKS) { settle(tx, block.hash, "NOT_KEPT"); out.not_kept++; } else later(tx);
        continue;
      }
      const check = checkCertificate(cert, block.hash);
      db.prepare("INSERT OR IGNORE INTO finality_certificates (block_hash, block_number, certificate_json, ok, check_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(block.hash, Number(cert.blockNumber), JSON.stringify(cert), check.ok ? 1 : 0, JSON.stringify(check), now.toISOString());
      settle(tx, block.hash, check.ok ? "REPORTED" : "FAILED");
      out[check.ok ? "reported" : "failed"]++;
    } catch {
      later(tx);
    }
  }
  return out;
}

export type EvidenceStatus = "REPORTED" | "FAILED" | "NOT_KEPT" | "NOT_FOUND";
export interface TxFinality {
  status: EvidenceStatus;
  block_hash: string;
  block_number: number | null;
  check: CertificateCheck | null;
  certificate: FinalityCertificate | null;
}

/** What the ledger holds on one transaction's finality certificate, or null if it is not settled yet. */
export function finalityOf(db: DB, tx: string): TxFinality | null {
  const r = db.prepare("SELECT e.status, e.block_hash, c.block_number, c.check_json, c.certificate_json FROM finality_evidence e LEFT JOIN finality_certificates c ON c.block_hash = e.block_hash WHERE e.tx = ?").get(tx) as
    { status: EvidenceStatus; block_hash: string; block_number: number | null; check_json: string | null; certificate_json: string | null } | undefined;
  if (!r) return null;
  return { status: r.status, block_hash: r.block_hash, block_number: r.block_number, check: r.check_json ? (JSON.parse(r.check_json) as CertificateCheck) : null, certificate: r.certificate_json ? (JSON.parse(r.certificate_json) as FinalityCertificate) : null };
}

/** Counts for verify, the audit report and the dashboard. */
export function finalityView(db: DB): { reported: number; not_kept: number; failed: number; not_found: number; blocks: number } {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finality_evidence'").get()) return { reported: 0, not_kept: 0, failed: 0, not_found: 0, blocks: 0 };
  const n = (status: string) => (db.prepare("SELECT COUNT(*) AS n FROM finality_evidence WHERE status = ?").get(status) as { n: number }).n;
  return { reported: n("REPORTED"), not_kept: n("NOT_KEPT"), failed: n("FAILED"), not_found: n("NOT_FOUND"), blocks: (db.prepare("SELECT COUNT(*) AS n FROM finality_certificates").get() as { n: number }).n };
}

/**
 * For npm run verify: every REPORTED transaction must have a stored certificate for its block that passes the checks
 * again, offline; any that does not, and any FAILED one, fails verify. NOT_KEPT and NOT_FOUND are notes. This catches
 * an edited or deleted certificate or evidence row unless the edit is itself a consistent certificate: the BLS
 * signature, which would catch that too, is not checked.
 */
export function finalityChecks(db: DB): { level: "ok" | "fail" | "note"; what: string; detail: string }[] {
  const v = finalityView(db);
  if (v.reported + v.failed + v.not_kept + v.not_found === 0) return [{ level: "note", what: "finality certificates", detail: "none looked up in this ledger (the runner fetches them every minute)" }];
  const rows = db.prepare("SELECT e.tx, e.block_hash, c.certificate_json FROM finality_evidence e LEFT JOIN finality_certificates c ON c.block_hash = e.block_hash WHERE e.status = 'REPORTED'").all() as { tx: string; block_hash: string; certificate_json: string | null }[];
  const bad = rows.filter((r) => !r.certificate_json || !checkCertificate(JSON.parse(r.certificate_json) as FinalityCertificate, r.block_hash).ok).map((r) => r.tx.slice(0, 10));
  const out: { level: "ok" | "fail" | "note"; what: string; detail: string }[] = [
    { level: bad.length || v.failed ? "fail" : "ok", what: "finality certificates", detail: `${v.reported} transaction(s) in ${v.blocks} block(s) with Metal's reported certificate: header hash and number, signer bitmap and a quorum of the ${PINNED_VALIDATORS} pinned validators hold${bad.length ? `; failing or missing: ${bad.join(", ")}` : ""}${v.failed ? `; ${v.failed} transaction(s) with a failing certificate` : ""}; not checked: ${NOT_CHECKED}` },
  ];
  if (v.not_kept) out.push({ level: "note", what: "finality certificates", detail: `${v.not_kept} transaction(s) looked up after the node stopped keeping their block's certificate (about 2 hours on testnet)` });
  if (v.not_found) out.push({ level: "note", what: "finality certificates", detail: `${v.not_found} transaction(s) never showed as final in ${MAX_TRIES} tries` });
  return out;
}

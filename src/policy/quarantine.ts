// B1: Metal's receive policy on the sweep wallet. Only Northwind's business account (the sender of every earnings
// sweep, a mandate pull) may pay into it; a payment from anyone else completes into quarantine at ReceivePolicy. Purser
// records each held payment with Metal's evidence reference, never bridges it to Airwallex (the finality gate only
// credits a transfer that reached the wallet), and offers the CFO two options with Face ID: return it to the sender
// or accept it.

import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { CHAIN_ID, USDZ } from "../metal/network.js";
import { receiptId, type Receipt, type ReceivePolicyPort } from "../metal/receivePolicy.js";
import { beginExecution, createProposal, finishExecution, nextProposalId } from "./approvals.js";

const CURSOR = "quarantine.next_block";
/** A held payment's two options wait this long for the CFO; after that they are proposed again on the next poll. */
const RELEASE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REASONS: Record<number, string> = { 1: "sender blocked", 2: "sender not on the allowlist", 3: "token not accepted", 4: "below the minimum" };
export const quarantineReason = (n: number) => REASONS[n] ?? `reason ${n}`;

export type QuarantineReleaseTerms = Terms & {
  kind: "quarantine_release";
  receipt_id: string;
  originator: string;
  /** *USDZ, as a decimal string (it may have more than two decimals: anyone can send any amount). */
  amount: string;
  amount_units: string;
  action: "return" | "accept";
  to: string;
  tx_hash: string;
};

function wallets(db: DB): { sweep: Address; business: Address } {
  const get = (role: string) => (db.prepare("SELECT address FROM metal_accounts WHERE role = ?").get(role) as { address: string } | undefined)?.address;
  const sweep = get("sweep");
  const business = get("business");
  if (!sweep || !business) throw new Error("this world has no sweep wallet or business account yet (npm run bootstrap)");
  return { sweep: getAddress(sweep), business: getAddress(business) };
}

/** Sets the sweep wallet's receive policy: allowlist-only, quarantine, released by the wallet, the business allowed. */
export async function setupReceivePolicy(db: DB, port: ReceivePolicyPort, sweepKeyFile: string, now = new Date()): Promise<{ changed: boolean; txs: Hex[] }> {
  const { sweep, business } = wallets(db);
  // Polling starts a little before now (nothing can be held for the wallet before its policy exists).
  if (!db.prepare("SELECT 1 FROM settings WHERE key = ?").get(CURSOR)) {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(CURSOR, String(Math.max(0, (await port.latestBlock()) - 2000)), now.toISOString());
  }
  const p = await port.policyOf(sweep);
  if (p.allowlistOnly && p.refusal === 1 && p.recovery === 1 && (await port.senderAllowed(sweep, business))) return { changed: false, txs: [] };
  const txs = await port.configure(sweepKeyFile, [business]);
  audit(db, "owner-signer", "receive_policy.set", sweep, { wallet: sweep, allowed: business, refusal: "quarantine", recovery: "the wallet itself", txs: txs.join(",") }, now);
  return { changed: true, txs };
}

/** Reads payments held for the sweep wallet since the last poll; records each once and proposes its two options. */
export async function pollQuarantine(db: DB, port: ReceivePolicyPort, now = new Date()): Promise<number> {
  const { sweep } = wallets(db);
  const from = Number((db.prepare("SELECT value FROM settings WHERE key = ?").get(CURSOR) as { value: string } | undefined)?.value ?? "0");
  const { events, next } = await port.quarantinedSince(sweep, from);
  let added = 0;
  for (const q of events) {
    // The event must be what it claims: the receipt hashes to its id, and it is a *USDZ credit for this wallet.
    if (receiptId(q.receipt) !== q.receiptId || q.receipt.receiver.toLowerCase() !== sweep.toLowerCase() || q.receipt.token.toLowerCase() !== USDZ.toLowerCase()) continue;
    if (db.prepare("SELECT 1 FROM quarantines WHERE receipt_id = ?").get(q.receiptId)) continue;
    db.transaction(() => {
      const r = q.receipt;
      db.prepare(`INSERT INTO quarantines (receipt_id, chain_id, tx_hash, log_index, block, token, originator, receiver, amount_units, reason, receipt_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`).run(q.receiptId, CHAIN_ID, q.tx, q.logIndex, q.block, r.token, getAddress(r.originator), getAddress(r.receiver),
        r.amount.toString(), q.reason, JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), now.toISOString());
      const amount = formatUnits(r.amount, 18);
      audit(db, "system", "quarantine.held", q.receiptId, { from: getAddress(r.originator), amount, reason: quarantineReason(q.reason), tx: q.tx, log_index: String(q.logIndex) }, now);
      for (const [action, to] of [["return", getAddress(r.originator)], ["accept", sweep]] as const) {
        const terms: QuarantineReleaseTerms = {
          schema: TERMS_SCHEMA, kind: "quarantine_release", proposal_id: nextProposalId(db),
          expires_at: new Date(now.getTime() + RELEASE_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
          receipt_id: q.receiptId, originator: getAddress(r.originator), amount, amount_units: r.amount.toString(), action, to, tx_hash: q.tx,
        };
        createProposal(db, { terms, createdBy: "treasury" }, now);
      }
    }).immediate();
    added++;
  }
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(CURSOR, String(next), now.toISOString());
  return added;
}

/** After the CFO's approval: the sweep wallet releases the held payment to the approved address, once. */
export async function executeQuarantineRelease(db: DB, port: ReceivePolicyPort, sweepKeyFile: string, proposalId: string, now = new Date()): Promise<void> {
  const t = beginExecution<QuarantineReleaseTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "quarantine_release") throw new Error(`${proposalId} is not a quarantine release`);
    const row = db.prepare("SELECT status FROM quarantines WHERE receipt_id = ?").get(terms.receipt_id) as { status: string } | undefined;
    if (row?.status !== "OPEN") throw new Error(`the held payment ${terms.receipt_id.slice(0, 10)}… is ${row?.status ?? "unknown"}, not held`);
  }, now);
  try {
    const row = db.prepare("SELECT receipt_json FROM quarantines WHERE receipt_id = ?").get(t.receipt_id) as { receipt_json: string };
    const j = JSON.parse(row.receipt_json) as Record<string, string>;
    const receipt: Receipt = { nonce: BigInt(j.nonce!), token: j.token as Address, originator: j.originator as Address, receiver: j.receiver as Address, authority: j.authority as Address, amount: BigInt(j.amount!) };
    // The approved terms must still name this receipt's sender and amount; then Metal must still hold it.
    if (receiptId(receipt) !== t.receipt_id || receipt.amount.toString() !== t.amount_units || (t.action === "return" && receipt.originator.toLowerCase() !== t.to.toLowerCase())) {
      throw new Error("the stored receipt does not match the approved terms");
    }
    if (!(await port.isOpen(t.receipt_id as Hex))) throw new Error("Metal no longer holds this payment (it was released already); nothing sent");
    const tx = await port.claim(sweepKeyFile, receipt, t.to as Address);
    db.transaction(() => {
      db.prepare("UPDATE quarantines SET status = ?, resolved_tx = ?, resolved_at = ? WHERE receipt_id = ?").run(t.action === "return" ? "RETURNED" : "ACCEPTED", tx, now.toISOString(), t.receipt_id);
      audit(db, "owner-signer", t.action === "return" ? "quarantine.returned" : "quarantine.accepted", t.receipt_id, { to: t.to, amount: t.amount, tx, proposal_id: proposalId }, now);
      for (const s of db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'quarantine_release' AND status = 'PENDING_APPROVAL' AND json_extract(terms_json, '$.receipt_id') = ?").all(t.receipt_id) as { proposal_id: string }[]) {
        db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ? AND status = 'PENDING_APPROVAL'").run(s.proposal_id);
        audit(db, "system", "proposal.superseded", s.proposal_id, { by: proposalId }, now);
      }
      finishExecution(db, proposalId, "EXECUTED", { tx }, now);
    }).immediate();
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now);
    throw e;
  }
}

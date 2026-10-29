// The earnings bridge, Metal side (scenario S3, steps 1-2). The finance agent sweeps net earnings from
// the business account to the sweep wallet under its own mandate, then waits for finality before any
// credit is booked anywhere. The sandbox cannot receive *USDZ, so the credit is a simulated deposit of the
// same amount whose reference is the transaction hash, booked once per on-chain transfer.

import { erc20Abi, parseEventLogs, type Address, type Hash } from "viem";
import type { AirwallexRail, SandboxSim } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import { CHAIN_ID, USDZ, rpc, type ConsensusStatus } from "../metal/network.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { publicClient, usdzBalance } from "../metal/chain.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { extractTerms } from "@metalntwx/metal-pay/mandates";
import { capRefusal } from "../policy/rules.js";
import { velocityGate } from "../policy/velocity.js";

const sum = (db: DB, sql: string) => (db.prepare(sql).get() as { s: number | null }).s ?? 0;

export interface Earnings {
  revenueCents: number;
  upstreamCents: number;
  refundsCents: number;
  sweptCents: number;
  netCents: number;
}

/** From the ledger alone: what was sold, minus what it cost, minus refunds, minus what was already swept. */
export function netEarnings(db: DB): Earnings {
  const revenueCents = sum(db, "SELECT SUM(price_cents) AS s FROM sales WHERE status = 'DELIVERED'");
  const upstreamCents = sum(db, "SELECT SUM(price_cents) AS s FROM upstream_purchases WHERE outcome = 'PAID'");
  const refundsCents = sum(db, "SELECT SUM(amount_cents) AS s FROM refunds WHERE outcome IN ('PAID', 'HELD')");
  const sweptCents = sum(db, "SELECT SUM(amount_cents) AS s FROM sweeps WHERE outcome IN ('PAID', 'HELD')");
  return { revenueCents, upstreamCents, refundsCents, sweptCents, netCents: revenueCents - upstreamCents - refundsCents - sweptCents };
}

export interface SweepPlan {
  amountCents: number;
  businessBeforeCents: number;
  businessAfterCents: number;
  /** What the other agents may still spend from the business account. */
  committedCents: number;
  treasuryRemainingCents: number;
}

async function remaining(agent: "sourcing" | "support" | "treasury"): Promise<number> {
  const m = await activeMandate(agent);
  return baseUnitsToCents(extractTerms(m.credential).constraints.budget) - baseUnitsToCents(await mandateSpent(m));
}

/** Sweep the net earnings, but never below what the other mandates may still spend, nor past treasury's own budget. */
export async function planSweep(db: DB, business: Address): Promise<SweepPlan | { refuse: string }> {
  const e = netEarnings(db);
  if (e.netCents <= 0) return { refuse: `nothing to sweep: net earnings ${fromCents(Math.max(0, e.netCents))}` };
  const before = baseUnitsToCents(await usdzBalance(business));
  const committed = (await remaining("sourcing")) + (await remaining("support"));
  const treasuryRemaining = await remaining("treasury");
  const amount = e.netCents;
  if (amount > treasuryRemaining) return { refuse: `sweep ${fromCents(amount)} exceeds treasury's remaining budget ${fromCents(treasuryRemaining)}` };
  if (before - amount < committed) return { refuse: `sweep would leave ${fromCents(before - amount)}, under the ${fromCents(committed)} the other mandates may still spend` };
  return { amountCents: amount, businessBeforeCents: before, businessAfterCents: before - amount, committedCents: committed, treasuryRemainingCents: treasuryRemaining };
}

export function nextSweepId(db: DB, now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const n = (db.prepare("SELECT COUNT(*) AS n FROM sweeps WHERE payment_id LIKE ?").get(`sweep-${day}-%`) as { n: number }).n;
  return `sweep-${day}-${n + 1}`;
}

/** Pull under the treasury mandate. A pending or failed run is retried with the same payment id, never a new one. */
export async function executeSweep(db: DB, paymentId: string, amountCents: number, to: Address): Promise<{ outcome: string; tx: string | null; reason: string | null }> {
  db.prepare("INSERT OR IGNORE INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES (?, ?, 'PLANNED', ?)").run(paymentId, amountCents, new Date().toISOString());
  const row = db.prepare("SELECT amount_cents, outcome FROM sweeps WHERE payment_id = ?").get(paymentId) as { amount_cents: number; outcome: string };
  if (row.amount_cents !== amountCents) throw new Error(`${paymentId} was planned for ${fromCents(row.amount_cents)}; a retry must not change the amount`);
  // The CFO policy's limit per sweep and the velocity limits, checked before anything is signed.
  const refusal = capRefusal(db, "treasury", amountCents) ?? velocityGate(db, "treasury", "metal", amountCents, new Date(), paymentId);
  if (refusal) {
    // A pull already sent (PENDING) or held may still settle on chain: refuse to send anything now, but keep its
    // state, so it is never mistaken for a sweep that did not happen and swept again under a new id.
    if (row.outcome === "PENDING" || row.outcome === "HELD") {
      audit(db, "treasury", "sweep.deferred", paymentId, { amount: fromCents(amountCents), to, tx: null, reason: refusal, kept: row.outcome });
      return { outcome: row.outcome, tx: null, reason: refusal };
    }
    db.prepare("UPDATE sweeps SET outcome = 'REFUSED' WHERE payment_id = ?").run(paymentId);
    audit(db, "treasury", "sweep.refused", paymentId, { amount: fromCents(amountCents), to, tx: null, reason: refusal });
    return { outcome: "REFUSED", tx: null, reason: refusal };
  }
  const m = await activeMandate("treasury");
  const r = metalAgent(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", to, "--amount", fromCents(amountCents), "--payment-id", paymentId], [0, 1, 3, 4]);
  const outcome = ({ 0: "PAID", 1: "REFUSED", 3: "PENDING", 4: "HELD" } as Record<number, string>)[r.code]!;
  const tx = r.fields.get("transaction")?.[0] ?? null;
  const reason = r.fields.get("reason")?.[0] ?? null;
  db.prepare("UPDATE sweeps SET outcome = ?, tx_hash = COALESCE(?, tx_hash) WHERE payment_id = ?").run(outcome, tx, paymentId);
  audit(db, "treasury", `sweep.${outcome.toLowerCase()}`, paymentId, { amount: fromCents(amountCents), to, tx, reason });
  return { outcome, tx, reason };
}

export interface FinalTransfer {
  eventKey: string;
  tx: Hash;
  logIndex: number;
  block: number;
  finalizedBlock: number;
  amountUnits: bigint;
}

/**
 * The finality gate: the receipt succeeded, it carries a *USDZ Transfer from `from` to `to` for exactly
 * `amountCents`, its block is at or below the finalized height, and that block is still canonical.
 * Waits for finality up to `timeoutMs`.
 */
export async function awaitFinalTransfer(tx: Hash, from: Address, to: Address, amountCents: number, timeoutMs = 120_000): Promise<FinalTransfer> {
  const pc = publicClient();
  const receipt = await pc.getTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`${tx} did not succeed`);
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
    (l) => l.address.toLowerCase() === USDZ.toLowerCase() && l.args.from.toLowerCase() === from.toLowerCase() && l.args.to.toLowerCase() === to.toLowerCase(),
  );
  const match = transfers.find((l) => l.args.value === centsToBaseUnits(amountCents));
  if (!match) throw new Error(`${tx} carries no *USDZ transfer of ${fromCents(amountCents)} from ${from} to ${to}`);
  const block = Number(receipt.blockNumber);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await rpc<ConsensusStatus>("consensus_status");
    if (status.finalized.number >= block) {
      const canonical = await pc.getBlock({ blockNumber: receipt.blockNumber });
      if (canonical.hash !== receipt.blockHash) throw new Error(`${tx}: block ${block} is no longer canonical`);
      return { eventKey: `${CHAIN_ID}:${tx}:${match.logIndex}`, tx, logIndex: match.logIndex, block, finalizedBlock: status.finalized.number, amountUnits: match.args.value };
    }
    if (Date.now() > deadline) throw new Error(`${tx}: block ${block} not finalized after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Locks the credit for one on-chain transfer. The primary key makes a second credit for it impossible. */
export function lockCredit(db: DB, f: FinalTransfer, from: Address, to: Address, paymentId: string): { locked: boolean } {
  return db.transaction(() => {
    const r = db.prepare(
      `INSERT OR IGNORE INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(f.eventKey, f.tx, from, to, f.amountUnits.toString(), f.block, f.finalizedBlock, f.tx, new Date().toISOString());
    db.prepare("UPDATE sweeps SET event_key = ? WHERE payment_id = ?").run(f.eventKey, paymentId);
    if (r.changes === 1) audit(db, "treasury", "credit.locked", f.eventKey, { tx: f.tx, block: f.block, finalized_block: f.finalizedBlock, amount_units: f.amountUnits.toString() });
    return { locked: r.changes === 1 };
  }).immediate();
}

/**
 * Books the locked credit in Airwallex once: if a deposit with this reference already exists (a crash after
 * the deposit call), it is adopted; otherwise one deposit of the same amount is simulated. 1 *USDZ = 1 USD.
 */
export async function bookCredit(db: DB, rail: AirwallexRail, sim: SandboxSim, eventKey: string): Promise<{ depositId: string; adopted: boolean }> {
  const row = db.prepare("SELECT * FROM chain_credits WHERE event_key = ?").get(eventKey) as
    { awx_deposit_id: string | null; awx_reference: string; amount_base_units: string; created_at: string } | undefined;
  if (!row) throw new Error(`no locked credit ${eventKey}`);
  if (row.awx_deposit_id) return { depositId: row.awx_deposit_id, adopted: true };
  const cents = baseUnitsToCents(BigInt(row.amount_base_units));
  const since = new Date(Date.parse(row.created_at) - 24 * 3600 * 1000).toISOString();
  const existing = (await rail.findDepositsByReference(row.awx_reference, since)).filter((d) => d.amountCents === cents);
  if (existing.length > 1) throw new Error(`${existing.length} deposits already reference ${row.awx_reference}; investigate before booking anything`);
  const deposit = existing[0] ?? (await sim.simulateDeposit({ globalAccountId: await rail.usdGlobalAccountId(), amountCents: cents, reference: row.awx_reference, payerName: "Northwind sweep (Metal)" }));
  db.prepare("UPDATE chain_credits SET awx_deposit_id = ? WHERE event_key = ? AND awx_deposit_id IS NULL").run(deposit.id, eventKey);
  audit(db, "awx-executor", existing[0] ? "credit.adopted" : "credit.deposited", eventKey, { deposit_id: deposit.id, amount: fromCents(cents), currency: "USD", reference: row.awx_reference });
  return { depositId: deposit.id, adopted: existing[0] !== undefined };
}

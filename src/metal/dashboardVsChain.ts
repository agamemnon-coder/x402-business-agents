// Metal QA (1 November), made exact after the night batch (2 November): the dashboard's mandate numbers, read against
// the chain. For each mandate the dashboard shows a cap, a budget, what was spent, and apart from that what is on its
// way (pending: sent, not final; held: reserved for a payment being made now). Metal has the bound credential's terms
// and, as MandatePayment events on the principal's account, every payment under each of the agent's credentials.
//
// They must agree: cap and budget exactly; spent exactly, payment by payment. The one allowed gap is a payment the
// dashboard itself shows on its way: the chain may count it before the ledger records it as spent (a sale between its
// block and its row). Every other difference fails, and names the payment that explains it: on chain and not in the
// ledger, in the ledger and not on chain, or a different amount.
//
// The two are read so that they describe the same moment: the ledger, then the chain at one block, then the ledger
// again; a reading during which the ledger moved is taken again. (On 2 November the dashboard was read before a sale's
// row and the chain after its block: 0.05–0.06 apart in 2 of 10 live worlds, the last sale of each.)

import { extractTerms, mandateBindingAbi, readMandateState } from "@metalntwx/metal-pay/mandates";
import { getAbiItem, toEventSelector, type Hex } from "viem";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../lib/money.js";
import { mandatePayments, type LedgerPayment } from "../policy/available.js";
import { publicClient } from "./chain.js";
import { credentialFiles, loadCredentialFile, type MandateAgent } from "./mandate.js";

const words = (units: bigint) => fromCents(baseUnitsToCents(units));
/** An RPC error in one line, without any URL: the node's URL carries its key (METAL_RPC_URL is a credential). */
const plain = (e: unknown): string => String((e as Error)?.message ?? e).split("\n")[0]!.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").slice(0, 160);
const shortTx = (tx: string) => `${tx.slice(0, 12)}…${tx.slice(-4)}`;

export interface ShownMandate { agent: string; cap: string; budget: string; spent: string; pending: string; held?: string; credentials: number }

/** One payment Metal recorded under one of the agent's mandates (a MandatePayment event). */
export interface ChainPayment { tx: string; block: bigint; amount: bigint; nonce?: string | null; at?: string | null }

export interface ChainMandate {
  perPaymentCap: bigint; budget: bigint;
  /** The bound credential's running spend at the block read. */
  spent: bigint;
  revoked: boolean; bound: boolean;
  /** The block everything was read at. */
  block?: bigint;
  /** Every payment under each of the agent's credentials up to that block; null when they could not be listed. */
  payments?: ChainPayment[] | null;
  listError?: string;
}

export interface Comparison { differences: string[]; notes: string[] }

/** The ledger's state of a payment, in words. */
const STATE_WORDS: Record<LedgerPayment["state"], string> = {
  paid: "paid", pending: "on its way (shown as pending)", held: "held for a payment being made now (shown as held)",
  in_doubt: "sent with its outcome unknown (its hold is shown as held)", failed: "a settle that failed, nothing moved",
};

function payment(p: ChainPayment): string {
  return `tx ${shortTx(p.tx)} (${words(p.amount)} in block ${p.block}${p.at ? `, ${p.at}` : ""})`;
}

/**
 * What differs between the dashboard and the chain for one mandate (differences; empty when they agree), and what is
 * on its way that the chain may already count (notes). Pure: the chain and the ledger are read by the caller.
 */
export function compareMandate(shown: ShownMandate, chain: ChainMandate, ledger: LedgerPayment[] = []): Comparison {
  if (!chain.bound) return { differences: ["the chain has no bound mandate for this credential"], notes: [] };
  if (chain.revoked) return { differences: ["the chain has revoked this credential"], notes: [] };
  const differences: string[] = [];
  const notes: string[] = [];
  const units = (s: string | undefined) => centsToBaseUnits(toCents(s ?? "0.00"));
  if (units(shown.cap) !== chain.perPaymentCap) differences.push(`cap: the dashboard shows ${shown.cap}, the chain ${words(chain.perPaymentCap)}`);
  if (units(shown.budget) !== chain.budget) differences.push(`budget: the dashboard shows ${shown.budget}, the chain ${words(chain.budget)}`);
  const paid = units(shown.spent), onItsWay = units(shown.pending) + units(shown.held);
  const showing = `the dashboard shows ${shown.spent} spent (${shown.pending} pending${shown.held && shown.held !== "0.00" ? `, ${shown.held} held` : ""})`;
  const at = chain.block !== undefined ? ` at block ${chain.block}` : "";

  if (!chain.payments) {
    // The payments could not be listed: compare the running spend alone, and say that no payment could be named.
    const why = `; the chain's payments could not be listed to name the one that explains it${chain.listError ? ` (${chain.listError})` : ""}`;
    if (shown.credentials <= 1) {
      if (chain.spent < paid || chain.spent > paid + onItsWay) differences.push(`spent: ${showing}, the chain ${words(chain.spent)}${at}${why}`);
    } else if (chain.spent > paid + onItsWay) {
      differences.push(`spent: ${showing}, the chain ${words(chain.spent)} under the current credential alone${at}${why}`);
    } else {
      notes.push(`spent compared as an upper bound only: ${shown.credentials} credentials, and their payments could not be listed`);
    }
    return { differences, notes };
  }

  const total = chain.payments.reduce((s, p) => s + p.amount, 0n);
  if (shown.credentials <= 1 && total !== chain.spent) {
    differences.push(`the chain's own figures disagree: its payments add up to ${words(total)}, its running spend says ${words(chain.spent)}${at}`);
  }
  // Payment by payment: by transaction first, then by ERC-3009 nonce (a sale whose row is not written yet has no tx).
  const byTx = new Map<string, LedgerPayment>(), byNonce = new Map<string, LedgerPayment>();
  for (const l of ledger) {
    if (l.tx) byTx.set(l.tx.toLowerCase(), l);
    if (l.nonce) byNonce.set(l.nonce.toLowerCase(), l);
  }
  const matched = new Set<LedgerPayment>();
  const holds = ledger.filter((l) => l.state === "held");
  let explainedOnItsWay = 0n;
  const named: string[] = [];
  for (const p of chain.payments) {
    const l = byTx.get(p.tx.toLowerCase()) ?? (p.nonce ? byNonce.get(p.nonce.toLowerCase()) : undefined);
    if (l) {
      matched.add(l);
      const cents = centsToBaseUnits(l.cents);
      if (l.state === "paid") {
        if (cents !== p.amount) named.push(`${l.what}: the ledger has ${fromCents(l.cents)}, the chain paid ${words(p.amount)} in ${payment(p)}`);
      } else if (l.state === "failed") {
        named.push(`${payment(p)} is on chain, but the ledger has ${l.what} as ${STATE_WORDS.failed}${l.detail ? ` (${l.detail})` : ""}`);
      } else {
        explainedOnItsWay += p.amount;
        notes.push(`${payment(p)} is on chain; the ledger has ${l.what} ${STATE_WORDS[l.state]}${l.detail ? ` (${l.detail})` : ""}`);
      }
      continue;
    }
    // A purchase being made now has a hold but no tx yet: the same amount, held, explains it.
    const h = holds.find((x) => !matched.has(x) && centsToBaseUnits(x.cents) === p.amount);
    if (h) {
      matched.add(h);
      explainedOnItsWay += p.amount;
      notes.push(`${payment(p)} is on chain; the ledger has ${h.what}, ${STATE_WORDS.held}`);
      continue;
    }
    named.push(`${payment(p)} is on chain under the ${shown.agent} mandate, but the ledger has no payment for it${p.nonce ? ` (nonce ${p.nonce.slice(0, 10)}…)` : ""}`);
  }
  for (const l of ledger) {
    if (l.state !== "paid" || matched.has(l)) continue;
    named.push(`${l.what}: the ledger has it paid (${fromCents(l.cents)}${l.tx ? `, tx ${shortTx(l.tx)}` : ", no tx"}), but the chain has no such payment under the ${shown.agent} mandate${shown.credentials > 1 ? "s" : ""}${at}`);
  }
  const paidOnChain = total - explainedOnItsWay;
  if (named.length || paidOnChain !== paid || total > paid + onItsWay) {
    differences.push(`spent: ${showing}, the chain ${words(total)}${at}${named.length ? `: ${named.join("; ")}` : ""}`);
    if (!named.length) differences.push(`no single payment explains the ${words(total > paid ? total - paid : paid - total)}: the ledger's paid payments and the chain's agree one by one, but not their totals`);
  }
  return { differences, notes };
}

export interface MandateCheck { agent: string; ok: boolean; differences: string[]; notes: string[] }

/** What the ledger shows at one moment: the dashboard's mandates and every payment under them. */
interface LedgerReading { shown: ShownMandate[]; payments: Record<string, LedgerPayment[]>; key: string }

function readLedger(db: DB): LedgerReading {
  const b = buildSnapshot(db).budgets;
  const shown: ShownMandate[] = [...b.agents, ...(b.counterparty ? [b.counterparty] : [])]
    .map((m) => ({ agent: m.agent, cap: m.cap, budget: m.budget, spent: m.spent, pending: m.pending, held: m.held, credentials: m.credentials }));
  const payments = Object.fromEntries(shown.map((s) => [s.agent, mandatePayments(db, s.agent)]));
  return { shown, payments, key: JSON.stringify({ shown, payments }) };
}

export interface ChainReader {
  block(): Promise<bigint>;
  /** The agent's bound mandate at `block`, with every payment under each of its credentials up to it. */
  mandate(agent: MandateAgent, block: bigint): Promise<ChainMandate>;
  /** A payment's ERC-3009 nonce and block time, for one the ledger has under no tx. */
  detail(tx: string): Promise<{ nonce: string | null; at: string | null }>;
}

/** The live check: the snapshot the dashboard serves, against Metal testnet, read at one moment. */
export async function dashboardVsChain(db: DB, chain: ChainReader = metalReader(), tries = 5): Promise<MandateCheck[]> {
  let reading = readLedger(db);
  let read = new Map<string, ChainMandate | Error>();
  let steady = false;
  for (let i = 0; i < tries && !steady; i++) {
    if (i > 0) reading = readLedger(db);
    const block = await chain.block();
    read = new Map();
    for (const s of reading.shown) {
      try {
        read.set(s.agent, await chain.mandate(s.agent as MandateAgent, block));
      } catch (e) {
        read.set(s.agent, e as Error);
      }
    }
    const after = readLedger(db);
    steady = after.key === reading.key;
    reading = after;
  }
  const out: MandateCheck[] = [];
  for (const s of reading.shown) {
    const c = read.get(s.agent);
    if (!c || c instanceof Error) {
      out.push({ agent: s.agent, ok: false, differences: [`could not read it on chain: ${c ? plain(c) : "not read"}`], notes: [] });
      continue;
    }
    const ledger = reading.payments[s.agent] ?? [];
    // A payment the ledger has under no tx: its nonce (and when it was made) names it.
    const known = new Set(ledger.map((l) => l.tx?.toLowerCase()).filter(Boolean));
    for (const p of c.payments ?? []) {
      if (known.has(p.tx.toLowerCase()) || p.nonce !== undefined) continue;
      try {
        Object.assign(p, await chain.detail(p.tx));
      } catch {
        p.nonce = null;
      }
    }
    const r = compareMandate(s, c, ledger);
    if (!steady) r.notes.push(`the ledger kept changing during ${tries} readings; this is the last one`);
    out.push({ agent: s.agent, ok: r.differences.length === 0, differences: r.differences, notes: r.notes });
  }
  return out;
}

// --- Metal testnet ---------------------------------------------------------------------------------------------------

const PAYMENT_EVENT = getAbiItem({ abi: mandateBindingAbi, name: "MandatePayment" });
/** USDZ's ERC-3009 AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce). */
const AUTHORIZATION_USED = toEventSelector("AuthorizationUsed(address,bytes32)");

/** MandatePayment events under `ref` on `principal`; a node caps the blocks one request may span, so a refused range is halved. */
async function paymentLogs(principal: Hex, ref: Hex, from: bigint, to: bigint): Promise<ChainPayment[]> {
  const pc = publicClient();
  const out: ChainPayment[] = [];
  let span = to - from + 1n;
  let refused: string | null = null;
  for (let start = from; start <= to;) {
    const end = start + span - 1n > to ? to : start + span - 1n;
    try {
      const logs = await pc.getLogs({ address: principal, event: PAYMENT_EVENT, args: { ref }, fromBlock: start, toBlock: end, strict: true });
      for (const l of logs) out.push({ tx: l.transactionHash.toLowerCase(), block: l.blockNumber, amount: l.args.amount });
      start = end + 1n;
    } catch (e) {
      refused = plain(e);
    }
    if (refused) {
      if (span <= 1n) throw new Error(`the node refused eth_getLogs for one block: ${refused}`);
      span = span / 2n;
      refused = null;
    }
  }
  return out;
}

export function metalReader(): ChainReader {
  const pc = publicClient();
  return {
    block: () => pc.getBlockNumber(),
    async mandate(agent, block) {
      const creds = credentialFiles(agent).map((f) => loadCredentialFile(agent, f));
      const states = await Promise.all(creds.map((m) => readMandateState(pc, m.principal, m.reference, block)));
      const live = creds.filter((_, i) => states[i]!.boundBlock > 0n && !states[i]!.revoked);
      if (live.length !== 1) throw new Error(`${agent}: expected one bound mandate at block ${block}, found ${live.length}`);
      const m = live[0]!, state = states[creds.indexOf(m)]!;
      const terms = extractTerms(m.credential).constraints;
      let payments: ChainPayment[] | null = [];
      let listError: string | undefined;
      try {
        for (let i = 0; i < creds.length; i++) {
          if (states[i]!.boundBlock > 0n) payments.push(...(await paymentLogs(creds[i]!.principal, creds[i]!.reference, states[i]!.boundBlock, block)));
        }
      } catch (e) {
        payments = null;
        listError = plain(e);
      }
      return { perPaymentCap: terms.perPaymentCap, budget: terms.budget, spent: state.spent, revoked: state.revoked, bound: state.boundBlock > 0n, block, payments, listError };
    },
    async detail(tx) {
      const r = await pc.getTransactionReceipt({ hash: tx as Hex });
      const used = r.logs.find((l) => l.topics[0] === AUTHORIZATION_USED);
      const b = await pc.getBlock({ blockNumber: r.blockNumber });
      return { nonce: used?.topics[2]?.toLowerCase() ?? null, at: new Date(Number(b.timestamp) * 1000).toISOString() };
    },
  };
}

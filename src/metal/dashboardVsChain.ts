// Metal QA (1 November), made exact after the night batch (2 November): the dashboard's mandate numbers, read against
// the chain. For each mandate the dashboard shows a cap, a budget, what was spent, and apart from that what is on its
// way (pending: sent, not final; held: reserved for a payment being made now). Metal has the bound credential's terms
// and, as MandatePayment events on the principal's account, every payment under each credential this ledger bound.
//
// They must agree: cap and budget exactly; spent exactly, payment by payment. The one allowed gap is a payment the
// dashboard itself shows on its way, for as long as such a payment takes: the chain may count it before the ledger
// records it as spent (a sale between its block and its row). Every other difference fails, and names the payment that
// explains it: on chain and not in the ledger, in the ledger and not on chain, another amount, or one left "on its way".
//
// The two are read so that they describe the same moment: the ledger, then the chain at one block, then the ledger
// again; a reading during which the ledger moved is taken again. (On 2 November the dashboard was read before a sale's
// row and the chain after its block: 0.05–0.06 apart in 2 of 10 live worlds, the last sale of each.)

import { extractTerms, mandateBindingAbi, publicMessage, readMandateState } from "@metalntwx/metal-pay/mandates";
import { formatUnits, getAbiItem, toEventSelector, type Hex } from "viem";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";
import { centsToBaseUnits, fromCents, toCents } from "../lib/money.js";
import { mandatePayments, type LedgerPayment } from "../policy/available.js";
import { publicClient } from "./chain.js";
import { credentialFiles, loadCredentialFile, type MandateAgent } from "./mandate.js";

/** An amount in words; a sub-cent amount in full rather than an error (a cent is 10^16 base units). */
const words = (units: bigint) => (units % 10n ** 16n === 0n ? fromCents(Number(units / 10n ** 16n)) : formatUnits(units, 18));
const shortTx = (tx: string) => `${tx.slice(0, 12)}…${tx.slice(-4)}`;

/**
 * An error in one line, with nothing of the node's URL: METAL_RPC_URL is a credential, and a provider can echo its key
 * in a path or a query. The SDK's own one-liner (viem's short message, every URL cut to its host), then every part of
 * the configured URL that could be a key blanked out: its path, query and credentials, raw, decoded and encoded.
 */
export function plain(e: unknown, env = process.env): string {
  let text = publicMessage(e);
  const secret = env.METAL_RPC_URL;
  if (secret) {
    let parts: string[] = [secret];
    try {
      const u = new URL(secret);
      const query = u.search.slice(1).split("&").flatMap((kv) => kv.split("=").slice(1));
      // A path word with no digit and under 8 letters ("testnet", "rpc", "v1") is not a key; anything else may be.
      const segments = u.pathname.split("/").filter((x) => x.length >= 8 || (x.length >= 4 && /\d/.test(x)));
      parts = [secret, u.host + u.pathname + u.search, u.pathname + u.search, u.search, u.username, u.password, ...segments, ...query];
      parts = parts.flatMap((x) => { try { return [x, decodeURIComponent(x), encodeURIComponent(x)]; } catch { return [x]; } });
    } catch { /* not a URL: the whole string only */ }
    for (const p of [...new Set(parts)].filter((x) => x.length >= 4 && x !== "/").sort((a, b) => b.length - a.length)) text = text.split(p).join("[redacted]");
  }
  return text.slice(0, 160);
}

/** How long a payment may stay on its way before the check names it as left behind (a settle takes seconds). */
export const ON_ITS_WAY_MS = 5 * 60_000;

export interface ShownMandate {
  agent: string; cap: string; budget: string; spent: string; pending: string; held?: string; credentials: number;
  /** After a resume: the bound credential's own budget (what was left), which is what the chain has. */
  chain_budget?: string | null;
}

/** One payment Metal recorded under one of the agent's mandates (a MandatePayment event). */
export interface ChainPayment { tx: string; block: bigint; amount: bigint; nonce?: string | null; at?: string | null }

export interface ChainMandate {
  perPaymentCap: bigint; budget: bigint;
  /** The bound credential's running spend at the block read. */
  spent: bigint;
  revoked: boolean; bound: boolean;
  /** The block everything was read at. */
  block?: bigint;
  /** Every payment under each credential this ledger bound, up to that block; null when they could not be listed. */
  payments?: ChainPayment[] | null;
  /** Of those, what the bound credential's own payments add up to (its running spend must say the same). */
  currentPaid?: bigint;
  /** How many credentials the payments were listed under. */
  credentialsRead?: number;
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
 * on its way that the chain may already count (notes). Pure: the chain and the ledger are read by the caller, at `now`.
 */
export function compareMandate(shown: ShownMandate, chain: ChainMandate, ledger: LedgerPayment[] = [], now = new Date()): Comparison {
  if (!chain.bound) return { differences: ["the chain has no bound mandate for this credential"], notes: [] };
  if (chain.revoked) return { differences: ["the chain has revoked this credential"], notes: [] };
  const differences: string[] = [];
  const notes: string[] = [];
  const units = (s: string | undefined) => centsToBaseUnits(toCents(s ?? "0.00"));
  if (units(shown.cap) !== chain.perPaymentCap) differences.push(`cap: the dashboard shows ${shown.cap}, the chain ${words(chain.perPaymentCap)}`);
  if (shown.chain_budget) {
    if (units(shown.chain_budget) !== chain.budget) differences.push(`budget: the bound credential's budget is ${shown.chain_budget} on the dashboard (what was left of ${shown.budget} at the resume), the chain ${words(chain.budget)}`);
    else notes.push(`budget: ${shown.budget} over the mandate's life; the credential bound at the resume has ${shown.chain_budget}, what was left, as on chain`);
  } else if (units(shown.budget) !== chain.budget) differences.push(`budget: the dashboard shows ${shown.budget}, the chain ${words(chain.budget)}`);
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
      notes.push(`spent compared as an upper bound only: ${shown.credentials} credentials, and their payments could not be listed${chain.listError ? ` (${chain.listError})` : ""}`);
    }
    return { differences, notes };
  }

  const total = chain.payments.reduce((s, p) => s + p.amount, 0n);
  // With one credential only: a replace or a resume carries the spend so far into the new mandate's running spend.
  if (chain.currentPaid !== undefined && (chain.credentialsRead ?? shown.credentials) <= 1 && chain.currentPaid !== chain.spent) {
    differences.push(`the chain's own figures disagree: the bound credential's payments add up to ${words(chain.currentPaid)}, its running spend says ${words(chain.spent)}${at}`);
  }
  const fresh = (l: LedgerPayment) => !l.since || now.getTime() - Date.parse(l.since) <= ON_ITS_WAY_MS;
  const age = (l: LedgerPayment) => (l.since ? `, on its way since ${l.since}` : "");
  // Payment by payment: by transaction first, then by ERC-3009 nonce (a sale whose row is not written yet has no tx).
  const byTx = new Map<string, LedgerPayment>(), byNonce = new Map<string, LedgerPayment>();
  for (const l of ledger) {
    if (l.tx) byTx.set(l.tx.toLowerCase(), l);
    if (l.nonce) byNonce.set(l.nonce.toLowerCase(), l);
  }
  const matched = new Set<LedgerPayment>();
  let explainedOnItsWay = 0n;
  const named: string[] = [];
  for (const p of chain.payments) {
    const l = byTx.get(p.tx.toLowerCase()) ?? (p.nonce ? byNonce.get(p.nonce.toLowerCase()) : undefined);
    if (l) {
      matched.add(l);
      // An in-doubt purchase's row carries no amount (its hold does); every other row must carry what the chain paid.
      if (l.state !== "in_doubt" && centsToBaseUnits(l.cents) !== p.amount) {
        named.push(`${l.what}: the ledger has ${fromCents(l.cents)} (${l.state}), the chain paid ${words(p.amount)} in ${payment(p)}`);
      } else if (l.state === "failed") {
        named.push(`${payment(p)} is on chain, but the ledger has ${l.what} as ${STATE_WORDS.failed}${l.detail ? ` (${l.detail})` : ""}`);
      } else if (l.state !== "paid" && !fresh(l)) {
        named.push(`${payment(p)} is on chain, but the ledger still has ${l.what} ${STATE_WORDS[l.state]}${age(l)}: it was never recorded as paid${l.detail ? ` (${l.detail})` : ""}`);
      } else if (l.state !== "paid") {
        explainedOnItsWay += p.amount;
        notes.push(`${payment(p)} is on chain; the ledger has ${l.what} ${STATE_WORDS[l.state]}${l.detail ? ` (${l.detail})` : ""}`);
      }
      continue;
    }
    // A purchase being made now has a hold but no tx yet: a fresh hold of the same amount, made before the payment's
    // block and within the time a payment takes, explains it.
    const paidAt = p.at ? Date.parse(p.at) : NaN;
    const h = ledger.find((x) => x.state === "held" && !matched.has(x) && fresh(x) && centsToBaseUnits(x.cents) === p.amount && x.since
      && Number.isFinite(paidAt) && paidAt >= Date.parse(x.since) - 1_000 && paidAt <= Date.parse(x.since) + ON_ITS_WAY_MS);
    if (h) {
      matched.add(h);
      explainedOnItsWay += p.amount;
      notes.push(`${payment(p)} is on chain; the ledger has ${h.what}, ${STATE_WORDS.held}${age(h)}`);
      continue;
    }
    named.push(`${payment(p)} is on chain under the ${shown.agent} mandate, but the ledger has no payment for it${p.nonce ? ` (nonce ${p.nonce.slice(0, 10)}…)` : ""}`);
  }
  for (const l of ledger) {
    // Shown as pending for longer than a payment takes, and not on chain: the budget left differs from Metal's for it.
    if (l.state === "pending" && l.since && !matched.has(l) && !fresh(l)) {
      named.push(`${l.what}: shown as pending (${fromCents(l.cents)})${age(l)}, but not on chain${at}: its settle never closed${l.detail ? ` (${l.detail})` : ""}`);
      continue;
    }
    if (l.state !== "paid" || matched.has(l)) continue;
    named.push(`${l.what}: the ledger has it paid (${fromCents(l.cents)}${l.tx ? `, tx ${shortTx(l.tx)}` : ", no tx"}), but the chain has no such payment under the ${shown.agent} mandate${shown.credentials > 1 ? "s" : ""}${at}`);
  }
  const paidOnChain = total - explainedOnItsWay;
  if (named.length || paidOnChain !== paid || total > paid + onItsWay) {
    // (A stale pending line alone leaves spent equal to the chain; it is named because the budget left is not.)
    differences.push(`spent: ${showing}, the chain ${words(total)}${at}${named.length ? `: ${named.join("; ")}` : ""}`);
    if (!named.length) differences.push(`no single payment explains the ${words(total > paid ? total - paid : paid - total)}: the ledger's paid payments and the chain's agree one by one, but not their totals`);
  }
  return { differences, notes };
}

export interface MandateCheck { agent: string; ok: boolean; differences: string[]; notes: string[] }

/** What the ledger shows at one moment: the dashboard's mandates, every payment under them, and their bind transactions. */
interface LedgerReading { shown: ShownMandate[]; payments: Record<string, LedgerPayment[]>; binds: Record<string, Bind[]>; key: string }

/** A credential this ledger bound (bootstrap, replace, resume), as its audit row records it. */
export interface Bind { tx: string | null; credentialHash: string | null; principal: string | null }

function readLedger(db: DB): LedgerReading {
  const b = buildSnapshot(db).budgets;
  const shown: ShownMandate[] = [...b.agents, ...(b.counterparty ? [b.counterparty] : [])]
    .map((m) => ({ agent: m.agent, cap: m.cap, budget: m.budget, spent: m.spent, pending: m.pending, held: m.held, credentials: m.credentials, chain_budget: m.chain_budget }));
  const payments = Object.fromEntries(shown.map((s) => [s.agent, mandatePayments(db, s.agent)]));
  const hex = (v: unknown, n: number) => (typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v) ? v.toLowerCase() : null);
  const binds = Object.fromEntries(shown.map((s) => [s.agent, (db.prepare(`SELECT json_extract(payload_json, '$.tx') AS tx, json_extract(payload_json, '$.credential_hash') AS hash,
      json_extract(payload_json, '$.principal') AS principal FROM audit_log WHERE event IN ('mandate.bound', 'mandate.replaced', 'mandate.resumed') AND subject = ? ORDER BY seq`).all(s.agent) as { tx: unknown; hash: unknown; principal: unknown }[])
    .map((r): Bind => ({ tx: hex(r.tx, 64), credentialHash: hex(r.hash, 64), principal: hex(r.principal, 40) }))]));
  return { shown, payments, binds, key: JSON.stringify({ shown, payments }) };
}

export interface ChainReader {
  block(): Promise<bigint>;
  /**
   * The agent's bound mandate at `block`, with every payment up to it under each credential the ledger bound (`binds`:
   * its bind, replace and resume rows; empty for a ledger that recorded none).
   */
  mandate(agent: MandateAgent, block: bigint, binds: Bind[]): Promise<ChainMandate>;
  /** A payment's ERC-3009 nonce and block time, for one the ledger has under no tx. */
  detail(tx: string): Promise<{ nonce: string | null; at: string | null }>;
}

/** The live check: the snapshot the dashboard serves, against Metal testnet, read at one moment. */
export async function dashboardVsChain(db: DB, chain: ChainReader = metalReader(), tries = 5): Promise<MandateCheck[]> {
  let reading = readLedger(db);
  let read = new Map<string, ChainMandate | Error>();
  let steady = false;
  let readAt = new Date();
  for (let i = 0; i < tries && !steady; i++) {
    if (i > 0) reading = readLedger(db);
    readAt = new Date();
    read = new Map();
    let block: bigint | Error;
    try {
      block = await chain.block();
    } catch (e) {
      block = new Error(plain(e));
    }
    for (const s of reading.shown) {
      try {
        if (block instanceof Error) throw block;
        read.set(s.agent, await chain.mandate(s.agent as MandateAgent, block, reading.binds[s.agent] ?? []));
      } catch (e) {
        read.set(s.agent, new Error(plain(e)));
      }
    }
    // Compared against the reading taken before the chain's: a payment recorded after the chain's block cannot then show
    // up as "in the ledger, not on chain", and one on its way was written down before its settle (src/seller/settling.ts).
    steady = readLedger(db).key === reading.key;
  }
  const out: MandateCheck[] = [];
  for (const s of reading.shown) {
    const c = read.get(s.agent);
    if (!c || c instanceof Error) {
      out.push({ agent: s.agent, ok: false, differences: [`could not read it on chain: ${c ? c.message : "not read"}`], notes: [] });
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
    const r = compareMandate(s, c, ledger, readAt);
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
  const bindBlocks = new Map<string, bigint>();
  return {
    block: () => pc.getBlockNumber(),
    async mandate(agent, block, binds) {
      const all = credentialFiles(agent).map((f) => loadCredentialFile(agent, f));
      const allStates = await Promise.all(all.map((m) => readMandateState(pc, m.principal, m.reference, block)));
      const creds = all.map((m, i) => ({ m, s: allStates[i]! })).filter(({ s }) => s.boundBlock > 0n);
      // Only the credentials this ledger bound: a shared keys directory can hold another world's, and a bootstrap can
      // have overwritten one of this world's. A row names its credential by hash, else by its transaction's block and
      // the account it binds on. A ledger with a row that names neither is read with every credential, as before.
      const identifiable = binds.length > 0 && binds.every((b) => b.credentialHash || b.tx);
      let ours = creds;
      let found = binds.length;
      if (identifiable) {
        const hit = new Set<(typeof creds)[number]>();
        found = 0;
        for (const b of binds) {
          let c = b.credentialHash ? creds.find((x) => x.m.credentialHash.toLowerCase() === b.credentialHash) : undefined;
          if (!c && b.tx) {
            if (!bindBlocks.has(b.tx)) bindBlocks.set(b.tx, (await pc.getTransactionReceipt({ hash: b.tx as Hex })).blockNumber);
            const at = bindBlocks.get(b.tx)!;
            c = creds.find((x) => x.s.boundBlock === at && (!b.principal || x.m.principal.toLowerCase() === b.principal));
          }
          if (c) { hit.add(c); found++; }
        }
        ours = creds.filter((x) => hit.has(x));
      }
      const live = ours.filter(({ s }) => !s.revoked);
      if (live.length !== 1) throw new Error(`${agent}: expected one bound mandate of this ledger's at block ${block}, found ${live.length}`);
      const { m, s: state } = live[0]!;
      const terms = extractTerms(m.credential).constraints;
      let payments: ChainPayment[] | null = [];
      let currentPaid: bigint | undefined;
      let listError: string | undefined;
      if (found < binds.length) {
        payments = null;
        listError = `the keys directory holds ${found} of the ${binds.length} credentials this ledger bound`;
      } else {
        try {
          for (const c of ours) {
            const mine = await paymentLogs(c.m.principal, c.m.reference, c.s.boundBlock, block);
            if (c.m === m) currentPaid = mine.reduce((sum, p) => sum + p.amount, 0n);
            payments.push(...mine);
          }
        } catch (e) {
          payments = null;
          currentPaid = undefined;
          listError = plain(e);
        }
      }
      return { perPaymentCap: terms.perPaymentCap, budget: terms.budget, spent: state.spent, revoked: state.revoked, bound: state.boundBlock > 0n, block, payments, currentPaid, credentialsRead: ours.length, listError };
    },
    async detail(tx) {
      const r = await pc.getTransactionReceipt({ hash: tx as Hex });
      const used = r.logs.find((l) => l.topics[0] === AUTHORIZATION_USED);
      const b = await pc.getBlock({ blockNumber: r.blockNumber });
      return { nonce: used?.topics[2]?.toLowerCase() ?? null, at: new Date(Number(b.timestamp) * 1000).toISOString() };
    },
  };
}

// Nothing on the owners path is sent twice. A transaction is signed, its hash is written to the ledger (the audit log),
// and only then does it leave. A run that stops between the send and the receipt (a crash, a lost answer, a spent call
// budget) leaves that record open, and the next run starts from it:
//   1. it reads the recorded hash's receipt, and never signs anything new while that transaction may still land;
//   2. if the node shows no receipt and the sender's nonce is still unused, the transaction never reached a block: the
//      identical one is sent again (the recorded nonce and gas give the same bytes and the same hash), so however often
//      this runs, one transaction can land, once;
//   3. if the sender's nonce has moved past it, nothing is sent: either it landed and its receipt is not readable yet,
//      or another transaction used the nonce, and a person looks.
// Only a node that refuses the bytes outright ("insufficient funds", "nonce too low"), or a call budget that stops the
// send itself, voids the record: those bytes were never in a pool, so a later run may sign anew.

import type { Json } from "@metalntwx/metal-pay/mandates";
import type { Address, Hex } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { isBudgetStop, NodeRefused, NoReceiptYet, type OwnersChain, type SignedTx } from "./ownersChain.js";

/** A send as the ledger keeps it. The sender, nonce and gas let a later run sign the identical transaction again. */
export interface Sent { tx: Hex; from?: Address; nonce?: number; gas?: string }

export interface TxJournal {
  /** The send recorded for this step that has neither an outcome nor a refusal by the node. */
  open(): Sent | null;
  /** Called before the transaction leaves. */
  sent(s: Sent): void;
  /** The bytes were never in a pool (the node refused them, or the call budget stopped the send): the step may be signed anew. */
  unsent(tx: Hex, why: string): void;
}

export interface StepTx {
  /** Signs the step's transaction, hands its hash to `onSigned`, then sends it. Returns the hash. */
  send(onSigned: (s: Sent) => void): Promise<Hex>;
  /** Sends the identical transaction again when the chain does not have it. Throws NoReceiptYet when it must not. */
  again?(earlier: Sent): Promise<void>;
}

/** Sends a step's transaction at most once across runs. `wait` resolves true for success, false for a revert, and throws while there is no receipt. */
export async function sendOnce(j: TxJournal, step: StepTx, wait: (tx: Hex) => Promise<boolean>): Promise<{ tx: Hex; ok: boolean; fresh: boolean }> {
  const earlier = j.open();
  if (earlier) {
    try {
      return { tx: earlier.tx, ok: await wait(earlier.tx), fresh: false };
    } catch (e) {
      if (!(e instanceof NoReceiptYet) || !step.again || earlier.nonce === undefined) throw e;
    }
    await step.again(earlier);
    return { tx: earlier.tx, ok: await wait(earlier.tx), fresh: false };
  }
  let recorded: Hex | null = null;
  const onSigned = (s: Sent) => {
    if (recorded) return;
    j.sent(s);
    recorded = s.tx;
  };
  let tx: Hex;
  try {
    tx = await step.send(onSigned);
  } catch (e) {
    if (recorded && (e instanceof NodeRefused || isBudgetStop(e))) j.unsent(recorded, (e as Error).message);
    throw e;
  }
  // A sender that names no hash before it sends: recorded as soon as it returns.
  onSigned({ tx });
  return { tx, ok: await wait(tx), fresh: true };
}

/** A step's transaction on the budgeted chain: `sign` builds it for a nonce (and the gas `gas` estimated, for a call). */
export function chainStep(chain: OwnersChain, o: { from: Address; gas?: () => Promise<bigint>; sign: (as: { nonce: number; gas?: bigint }) => Promise<SignedTx> }): StepTx {
  return {
    async send(onSigned) {
      // The estimate first: a call the chain would revert stops here, before a nonce is read or anything is signed.
      const gas = o.gas ? await o.gas() : undefined;
      const s = await o.sign({ nonce: await chain.nonce(o.from, "pending"), ...(gas === undefined ? {} : { gas }) });
      onSigned({ tx: s.tx, from: s.from, nonce: s.nonce, gas: s.gas.toString() });
      await chain.broadcast(s);
      return s.tx;
    },
    async again(earlier) {
      if ((await chain.nonce(o.from, "latest")) > earlier.nonce!) {
        throw new NoReceiptYet(earlier.tx, "the sender's nonce has moved past it: it landed and its receipt is not readable yet (run again), or another transaction used the nonce (then this one can never land); nothing was sent");
      }
      const s = await o.sign({ nonce: earlier.nonce!, ...(earlier.gas === undefined ? {} : { gas: BigInt(earlier.gas) }) });
      if (s.tx.toLowerCase() !== earlier.tx.toLowerCase()) throw new Error(`signing the step again gave ${s.tx}, not the recorded ${earlier.tx}; nothing was sent`);
      await chain.broadcast(s, true);
    },
  };
}

type Row = { payload_json: string };
const rows = (db: DB, event: string, subject: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as Row[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

export interface StepOutcome { tx: Hex; ok: boolean; block: number | null; reason: string | null }

/** The journal of one step of an owners command, in the audit log: owners.tx_sent, owners.tx_unsent, owners.tx_done, each under the step's key. */
export function stepJournal(db: DB, key: string, what = key, now: () => Date = () => new Date()): TxJournal & { done(): StepOutcome | null; finish(o: StepOutcome & { gasUsed?: bigint }): void } {
  const settled = () => new Set([...rows(db, "owners.tx_unsent", key), ...rows(db, "owners.tx_done", key)].map((p) => String(p.tx).toLowerCase()));
  return {
    open() {
      const closed = settled();
      const s = rows(db, "owners.tx_sent", key).filter((p) => !closed.has(String(p.tx).toLowerCase())).at(-1);
      return s ? { tx: s.tx as Hex, from: s.from as Address | undefined, nonce: s.nonce as number | undefined, gas: s.gas as string | undefined } : null;
    },
    sent: (s) => { audit(db, "owner-signer", "owners.tx_sent", key, { step: key, what, tx: s.tx, ...(s.from ? { from: s.from } : {}), ...(s.nonce === undefined ? {} : { nonce: s.nonce }), ...(s.gas === undefined ? {} : { gas: s.gas }) }, now()); },
    unsent: (tx, why) => { audit(db, "owner-signer", "owners.tx_unsent", key, { step: key, tx, why: why.slice(0, 300) }, now()); },
    done() {
      const d = rows(db, "owners.tx_done", key).at(-1);
      return d ? { tx: d.tx as Hex, ok: d.ok === true, block: typeof d.block === "number" ? d.block : null, reason: typeof d.reason === "string" ? d.reason : null } : null;
    },
    finish: (o) => {
      const detail: Json = { step: key, what, tx: o.tx, ok: o.ok, block: o.block, ...(o.gasUsed === undefined ? {} : { gas_used: o.gasUsed.toString() }), ...(o.reason ? { reason: o.reason.slice(0, 300) } : {}) };
      audit(db, "owner-signer", "owners.tx_done", key, detail, now());
    },
  };
}

/**
 * One step of an owners command, start to end: skipped (no call) when the ledger already holds its successful outcome,
 * else sent at most once and waited for; the outcome is recorded with the transaction's block, and with the account's
 * decoded reason when it reverted (`reason` makes one read-only call for it).
 */
export async function stepOnce(
  d: { db: DB; chain: OwnersChain; now?: () => Date }, key: string,
  o: { what: string; from: Address; gas?: () => Promise<bigint>; sign: (as: { nonce: number; gas?: bigint }) => Promise<SignedTx>; reason?: () => Promise<string | null> },
): Promise<StepOutcome & { fresh: boolean }> {
  const j = stepJournal(d.db, key, o.what, d.now);
  const done = j.done();
  if (done?.ok) return { ...done, fresh: false };
  let receipt: Awaited<ReturnType<OwnersChain["wait"]>> | null = null;
  const r = await sendOnce(j, chainStep(d.chain, o), async (tx) => (receipt = await d.chain.wait(tx)).ok);
  const reason = r.ok ? null : ((await o.reason?.()) ?? "reverted on chain");
  const out: StepOutcome = { tx: r.tx, ok: r.ok, block: (receipt as { block: number } | null)?.block ?? null, reason };
  j.finish({ ...out, gasUsed: (receipt as { gasUsed: bigint } | null)?.gasUsed });
  return { ...out, fresh: r.fresh };
}

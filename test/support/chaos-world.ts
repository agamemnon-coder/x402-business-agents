// The outside world for the kill test (test/chaos-kill.test.ts): Airwallex and the Metal chain as fakes that keep
// their state in files, so they outlive a worker the test kills, as the real services outlive a crashed runner.
// Test code only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Address, Hash } from "viem";
import type { FinalTransfer } from "../../src/agents/sweep.js";
import { centsToBaseUnits } from "../../src/lib/money.js";
import type { Puller } from "../../src/metal/pull.js";
import { FakeAirwallex } from "../../src/redteam/airwallex.js";

type State = Pick<FakeAirwallex, "bal" | "deposits" | "conversions" | "beneficiaries" | "transfers" | "n" | "calls"> & { quotes: [string, unknown][] };

/** A FakeAirwallex whose state is read from `file` at start and written after every call, answered or failed. */
export function persistentAirwallex(file: string): FakeAirwallex {
  const awx = new FakeAirwallex();
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, "utf8")) as State;
    Object.assign(awx, { bal: s.bal, deposits: s.deposits, conversions: s.conversions, beneficiaries: s.beneficiaries, transfers: s.transfers, n: s.n, calls: s.calls });
    awx.quotes = new Map(s.quotes as [string, never][]);
  }
  const save = () => writeFileSync(file, JSON.stringify({ bal: awx.bal, deposits: awx.deposits, conversions: awx.conversions, beneficiaries: awx.beneficiaries, transfers: awx.transfers, n: awx.n, calls: awx.calls, quotes: [...awx.quotes] }));
  return new Proxy(awx, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv) as unknown;
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) return out.then((x) => (save(), x), (e: unknown) => { save(); throw e; });
        save();
        return out;
      };
    },
  });
}

interface ChainState { pulls: Record<string, { agent: string; to: string; amountCents: number; tx: string }> }
const readChain = (file: string): ChainState => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ChainState) : { pulls: {} });

/** The chain behind metal-agent: a payment id is paid at most once; a repeat answers "already paid, nothing sent". */
export function chainPuller(file: string): Puller {
  return async (a) => {
    const c = readChain(file);
    const had = c.pulls[a.paymentId];
    if (had) return { outcome: "PAID", tx: had.tx, reason: null, already: true };
    const tx = `0x${(Object.keys(c.pulls).length + 1).toString(16).padStart(64, "0")}`;
    c.pulls[a.paymentId] = { agent: a.agent, to: a.to, amountCents: a.amountCents, tx };
    writeFileSync(file, JSON.stringify(c));
    return { outcome: "PAID", tx, reason: null, already: false };
  };
}

export function chainPulls(file: string): ChainState["pulls"] { return readChain(file).pulls; }

/** Finality for a pull the fake chain made: final at once, one transfer log per transaction. */
export function chainFinalize(file: string) {
  return async (tx: Hash, _from: Address, _to: Address, amountCents: number): Promise<FinalTransfer> => {
    const hit = Object.values(readChain(file).pulls).find((p) => p.tx === tx);
    if (!hit || hit.amountCents !== amountCents) throw new Error(`no pull ${tx} of ${amountCents}`);
    return { eventKey: `63825:${tx}:0`, tx, logIndex: 0, block: 1, finalizedBlock: 2, amountUnits: centsToBaseUnits(amountCents) };
  };
}

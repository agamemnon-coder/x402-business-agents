// The call budget of a live owners run (Face ID signs on chain, Metal testnet; npm run owners, and the runner when it
// relays an owners_execute). The owner agrees a number of calls before anything runs, and code keeps to it. Every
// JSON-RPC request on this path counts: reads, sends and receipt polls, from every process of the run (the CLI's
// commands and the runner). Each is appended to one log file before it is sent, and the request that would go over the
// agreed number is refused before it leaves this machine. The log holds the time, the method, the step and the
// process; never a parameter, an address or a URL.
//
// A run of the pinned metal-agent CLI that reaches the network (fund, mandate pull) is one line, `cli:<command>`: the
// requests the CLI makes inside cannot be counted from here, and every record of a run says so.
//
// Set by the run's environment: OWNERS_GO=yes (the owner's go), OWNERS_CALL_BUDGET (a whole number, for this world: the
// log adds up across commands and processes) and OWNERS_CALL_LOG (the JSONL file). Without all three nothing is called.

import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";

export interface OwnersCall { at: string; method: string; step: string; pid: number }

/** What a live owners command still needs before it may call Metal; empty when it may run. */
export function ownersRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.OWNERS_GO !== "yes") why.push("OWNERS_GO=yes (the owner's go for this run)");
  if (!/^\d+$/.test(env.OWNERS_CALL_BUDGET ?? "")) why.push("OWNERS_CALL_BUDGET (a whole number: the Metal calls the owner agreed for this world, counted across commands and processes)");
  if (!env.OWNERS_CALL_LOG) why.push("OWNERS_CALL_LOG (a JSONL file: every call is appended to it before it is sent)");
  return why;
}

export class OwnersGuardRefused extends Error {
  constructor(readonly missing: string[]) {
    super(`refused: the owners path calls Metal testnet only with ${missing.join("; ")}. Nothing was called.`);
    this.name = "OwnersGuardRefused";
  }
}

export class OwnersBudgetSpent extends Error {
  constructor(message: string) { super(message); this.name = "OwnersBudgetSpent"; }
}

/** The calls a world's log holds, oldest first; a missing file is none. A line that is not a call stops everything. */
export function readOwnersCalls(file: string): OwnersCall[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l, i) => {
    if (!l.trim()) return [];
    try {
      const c = JSON.parse(l) as OwnersCall;
      if (typeof c.method === "string" && typeof c.step === "string") return [c];
    } catch { /* reported below */ }
    throw new Error(`the call log ${file} cannot be read at line ${i + 1}; nothing was sent (a budget nobody can count is no budget)`);
  });
}

/** The log per step, in the order each step first called: single JSON-RPC requests, and whole CLI runs beside them. */
export function countByStep(calls: readonly OwnersCall[]): { step: string; requests: number; cli_runs: number }[] {
  const m = new Map<string, { step: string; requests: number; cli_runs: number }>();
  for (const c of calls) {
    const s = m.get(c.step) ?? { step: c.step, requests: 0, cli_runs: 0 };
    if (c.method.startsWith("cli:")) s.cli_runs++; else s.requests++;
    m.set(c.step, s);
  }
  return [...m.values()];
}

export interface CallBudget {
  readonly budget: number;
  readonly file: string;
  /** Calls in the log: this world's, from every process. */
  used(): number;
  left(): number;
  /** Logs one call, before it is made. Throws OwnersBudgetSpent, logging nothing, when the budget is spent. */
  count(method: string, step: string): void;
  /** Throws OwnersBudgetSpent unless at least `calls` are left: asked before a step that must not stop halfway. */
  need(calls: number, what: string): void;
}

/** Held for microseconds by a living process; a lock older than this was left by a process that died. */
const STALE_MS = 10_000;
const isStale = (path: string) => Date.now() - statSync(path).mtimeMs > STALE_MS;

/**
 * Takes a dead process's lock away. Two processes can both see the same dead lock; were each to remove "the lock", the
 * second would remove the fresh lock the first has made since, and both would go on. So the lock is first renamed to a
 * name of this process's own, which only one process can do to one file, and then looked at again under that name:
 * if it is the dead one, it is removed; if it is a living process's fresh lock (taken in between), it is put back
 * where it was, unless a lock is there again.
 */
function takeStale(lock: string): void {
  const mine = `${lock}.${process.pid}.${randomUUID()}`;
  renameSync(lock, mine);
  try { if (!isStale(mine)) linkSync(mine, lock); } catch { /* a lock is there again: its holder goes first */ }
  unlinkSync(mine);
}

/** One process at a time reads the log and appends to it, so two processes can never both take the last call. */
function locked<T>(file: string, run: () => T): T {
  const lock = `${file}.lock`;
  const giveUp = Date.now() + 5_000;
  for (;;) {
    try { closeSync(openSync(lock, "wx", 0o600)); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Gone or taken by another process in between: look again.
      try { if (isStale(lock)) { takeStale(lock); continue; } } catch { continue; }
      if (Date.now() >= giveUp) throw new Error(`the call log ${file} is locked by another process; nothing was sent`, { cause: e });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return run(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

export function callBudget(o: { budget: number; file: string; now?: () => Date; pid?: number }): CallBudget {
  if (!Number.isSafeInteger(o.budget) || o.budget < 0) throw new Error(`not a call budget: ${o.budget}`);
  const used = () => readOwnersCalls(o.file).length;
  return {
    budget: o.budget,
    file: o.file,
    used,
    left: () => Math.max(0, o.budget - used()),
    count(method, step) {
      locked(o.file, () => {
        const n = used();
        if (n >= o.budget) throw new OwnersBudgetSpent(`the owners call budget of ${o.budget} is spent (${n} used); ${method} (${step}) was not sent. Ask the owner before raising OWNERS_CALL_BUDGET.`);
        const line: OwnersCall = { at: (o.now ?? (() => new Date()))().toISOString(), method, step, pid: o.pid ?? process.pid };
        appendFileSync(o.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      });
    },
    need(calls, what) {
      const left = Math.max(0, o.budget - used());
      if (left < calls) throw new OwnersBudgetSpent(`${what} needs ${calls} calls and the owners call budget of ${o.budget} has ${left} left; nothing was sent. Ask the owner before raising OWNERS_CALL_BUDGET.`);
    },
  };
}

/** The budget the environment sets. Throws OwnersGuardRefused, having called nothing, unless the go, the budget and the log are all there. */
export function ownersBudget(env: Record<string, string | undefined> = process.env): CallBudget {
  const missing = ownersRefusals(env);
  if (missing.length) throw new OwnersGuardRefused(missing);
  return callBudget({ budget: Number(env.OWNERS_CALL_BUDGET), file: env.OWNERS_CALL_LOG! });
}

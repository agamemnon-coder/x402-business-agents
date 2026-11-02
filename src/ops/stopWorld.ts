// npm run stop -- <world>: stops exactly that world's run (2 November: a stop reached only a setsid wrapper, and the
// runner of another world kept running). Only the process group named in the world's own runner lock is signalled,
// and only when every process in it carries the lock's run token; then the stop waits, checks with the OS (ps) that
// nothing of that group is left, and removes the lock. It never signals a single pid, a name, or anything else.

import { existsSync, realpathSync } from "node:fs";
import Database from "better-sqlite3";
import { redactSecrets } from "../lib/redact.js";
import type { Proc, ProcessTable } from "./processes.js";
import { lockOf, sameLedger, worldOf, type RunnerLock } from "./runnerLock.js";

export interface StopDeps {
  table: ProcessTable;
  host: string;
  /** The stop command's own process group: never signalled. */
  ownPgid: number;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
  /** How long the run may take to stop by itself after SIGTERM (the runner finishes a running execution first). */
  graceMs?: number;
  /** After SIGKILL, how long to wait for the OS to clear the group. */
  killWaitMs?: number;
  /** Clear a lock held on another host (that host is gone: a new container), once nothing here uses the ledger. */
  forgetOtherHost?: boolean;
}

export interface StopResult { ok: boolean; message: string; signalled: { pgid: number; signal: NodeJS.Signals }[] }

const live = (p: Proc) => !p.state.startsWith("Z");
const show = (ps: Proc[]) => ps.map((p) => `${p.pid} (${redactSecrets(p.cmd).slice(0, 80)})`).join("; ");

/**
 * The processes started for this ledger outside its run (a runner from before the lock existed, a standalone agent, a
 * manual script): reported, never signalled. The stop command itself and the processes that started it (an exported
 * KIT11_DB in the operator's shell) are not counted.
 */
function unlocked(table: ProcessTable, real: string, ownPgid: number): Proc[] {
  const all = table.list();
  const mine = new Set<number>();
  for (let p = all.find((x) => x.pid === process.pid); p && !mine.has(p.pid); p = all.find((x) => x.pid === p!.ppid)) mine.add(p.pid);
  return all.filter((p) => live(p) && !mine.has(p.pid) && p.pgid !== ownPgid && p.db !== null && existsSync(p.db) && realpathSync(p.db) === real);
}

export async function stopWorld(dbPath: string, deps: StopDeps): Promise<StopResult> {
  const signalled: StopResult["signalled"] = [];
  const done = (ok: boolean, message: string): StopResult => ({ ok, message, signalled });
  if (!existsSync(dbPath)) return done(false, `no ledger at ${dbPath}; nothing stopped`);
  const real = realpathSync(dbPath);
  const world = worldOf(real);
  const db = new Database(real, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const lock = lockOf(db);
    if (!lock || !sameLedger(lock, real)) {
      const others = unlocked(deps.table, real, deps.ownPgid);
      if (others.length) return done(false, `world ${world} has no runner lock, but ${others.length} process(es) use its ledger (started before the lock existed?): ${show(others)}. Not stopped: check them with ps -o pid,pgid,args and stop their own group by hand.`);
      return done(true, `world ${world}: no runner holds its lock; nothing to stop`);
    }
    if (lock.host !== deps.host) {
      if (!deps.forgetOtherHost) return done(false, `world ${world}'s runner lock is held on host ${lock.host}; stop it there. If that host is gone (a new container), add --forget-other-host. Nothing signalled.`);
      const here = unlocked(deps.table, real, deps.ownPgid);
      if (here.length) return done(false, `world ${world}'s lock is from host ${lock.host}, but ${here.length} process(es) here use its ledger: ${show(here)}. Lock kept, nothing signalled.`);
      removeLock(db, lock);
      return done(true, `world ${world}: the lock from host ${lock.host} was cleared (nothing here uses the ledger); nothing signalled`);
    }
    if (!Number.isSafeInteger(lock.pgid) || lock.pgid <= 1 || lock.pgid === deps.ownPgid) return done(false, `world ${world}'s lock names process group ${lock.pgid}, which is not a world's own group; nothing signalled`);

    // Every process in the group must be this run's: one that is not would be hit by a group signal.
    const group = () => deps.table.list().filter((p) => p.pgid === lock.pgid && live(p));
    // This run's processes only (a group id the OS gave out again after the run ended is not this run).
    const ours = () => group().filter((p) => p.token === lock.token);
    const signal = (sig: NodeJS.Signals) => {
      try {
        deps.table.signalGroup(lock.pgid, sig);
        signalled.push({ pgid: lock.pgid, signal: sig });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; // the group ended by itself just now
      }
    };
    const check = (): Proc[] | string => {
      const g = group();
      const foreign = g.filter((p) => p.token !== lock.token);
      return foreign.length ? `process group ${lock.pgid} also holds process(es) that are not world ${world}'s run: ${show(foreign)}. Nothing signalled.` : g;
    };
    const first = check();
    if (typeof first === "string") return done(false, first);
    if (first.length === 0) {
      removeLock(db, lock);
      return done(true, `world ${world} was not running (${lock.role} pid ${lock.pid} is gone); its stale lock was cleared`);
    }

    deps.log(`stopping world ${world}: SIGTERM to process group ${lock.pgid} (${first.length} process(es): ${show(first)})`);
    signal("SIGTERM");
    const gone = async (ms: number) => {
      const until = deps.now() + ms;
      for (;;) {
        if (ours().length === 0) return true;
        if (deps.now() >= until) return false;
        await deps.sleep(500);
      }
    };
    if (!(await gone(deps.graceMs ?? 90_000))) {
      const still = check();
      if (typeof still === "string") return done(false, `${still} (after SIGTERM)`);
      if (still.length) {
        deps.log(`world ${world} did not stop within ${Math.round((deps.graceMs ?? 90_000) / 1000)} s; SIGKILL to process group ${lock.pgid} (${show(still)}). A money action cut off here is resumed by the runner's next start.`);
        signal("SIGKILL");
        await gone(deps.killWaitMs ?? 10_000);
      }
    }
    // The OS's own answer, independent of the table read above.
    const left = deps.table.psGroup(lock.pgid);
    if (left.length || ours().length) return done(false, `world ${world}: process group ${lock.pgid} still has ${[...new Set([...left, ...ours().map((p) => p.pid)])].join(", ")} after the stop; the lock is kept`);
    removeLock(db, lock);
    // Anything else still using this ledger is not part of the run (a standalone agent, a manual script): named, never signalled.
    // The starter left behind (npm, sh, tsx and the waiting starter) exits right after its group: a few seconds for it.
    let others = unlocked(deps.table, real, deps.ownPgid);
    for (let i = 0; i < 10 && others.length; i++) { await deps.sleep(500); others = unlocked(deps.table, real, deps.ownPgid); }
    if (others.length) return done(false, `world ${world}'s run stopped (process group ${lock.pgid} gone, checked with ps; lock removed), but ${others.length} other process(es) still use its ledger: ${show(others)}. Not signalled: stop them by hand after checking with ps.`);
    return done(true, `world ${world} stopped: process group ${lock.pgid} is gone (checked with ps); lock removed`);
  } finally {
    db.close();
  }
}

/** Removes exactly this lock (the runner may have given it back already, or a new run taken it meanwhile: then nothing). */
function removeLock(db: Database.Database, lock: RunnerLock): void {
  db.prepare("DELETE FROM locks WHERE lock_key = 'runner' AND holder = ?").run(JSON.stringify(lock));
}

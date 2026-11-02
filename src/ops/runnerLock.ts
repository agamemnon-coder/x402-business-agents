// One runner per world, and a stop that stops exactly that world (2 November: a stop command reached only a setsid
// wrapper; the runner of another world, live-1, kept running until 11:03).
//
// - Each world's run is one process group of its own: `npm run up` or `npm run relay` re-starts itself as the leader of
//   a new group (setsid) with a fresh run token in its environment, which everything it starts inherits (the runner,
//   the agents). The starter it leaves behind only waits, passes Ctrl-C on to the group, and exits with it.
// - The runner takes the ledger's lock: one row in the ledger's own `locks` table (lock_key 'runner') with its pid
//   and start time, process group, host, run token, ledger path and start. A second runner on the same ledger
//   refuses to start. A lock whose process is gone and whose group has nothing of that run left is cleared.
// - `npm run stop -- <world>` signals that lock's process group only, after checking that every process in it carries
//   the lock's run token; it waits, checks with the OS (ps) that nothing of the group is left, then removes the lock.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { constants, hostname } from "node:os";
import { basename } from "node:path";
import Database from "better-sqlite3";
import type { DB } from "../db/open.js";
import { ownPgid, procOf, type Proc, type ProcessTable } from "./processes.js";

export interface RunnerLock {
  world: string;
  /** The ledger's real path, and its file identity (device:inode): another path to the same file is the same ledger. */
  db: string;
  file?: string;
  host: string;
  pid: number;
  /** The holder's start time from the process table: with the pid it names one process, also after pid reuse. */
  pid_start: string;
  pgid: number;
  token: string;
  /** up (the supervisor) or relay (the runner). */
  role: string;
  started_at: string;
}

export interface Me { pid: number; pid_start: string; pgid: number; token: string; role: string }

const KEY = "runner";

/** The world a ledger is: its file name without .sqlite (data/live-1.sqlite is live-1). */
export const worldOf = (dbPath: string) => basename(dbPath).replace(/\.sqlite$/, "");

/** The world's runner lock (the run: `up`, or a relay started alone). */
export function lockOf(db: Database.Database): RunnerLock | null {
  return rowOf(db, KEY);
}

/** The lock of one role inside the run ('runner.up', 'runner.relay'): one live process per role, whatever the run. */
export function rowOf(db: Database.Database, key: string): RunnerLock | null {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'locks'").get();
  if (!has) return null;
  const r = db.prepare("SELECT holder FROM locks WHERE lock_key = ?").get(key) as { holder: string } | undefined;
  if (!r) return null;
  try {
    return JSON.parse(r.holder) as RunnerLock;
  } catch {
    return null;
  }
}

const live = (p: Proc) => !p.state.startsWith("Z");
/** device:inode of a ledger file: a row copied into another file does not match, a second path to this one does. */
export const fileId = (path: string) => { const st = statSync(path); return `${st.dev}:${st.ino}`; };
/** Whether a lock row is about this ledger file. */
export const sameLedger = (held: RunnerLock, real: string) => (held.file ? held.file === fileId(real) : held.db === real);
const describe = (l: RunnerLock) => `pid ${l.pid} (process group ${l.pgid}, ${l.role}) on ${l.host}, since ${l.started_at}`;

export type Acquired = { ok: true; owner: boolean; lock: RunnerLock; note?: string } | { ok: false; message: string };

/**
 * Takes the ledger's runner lock, or joins it when a process of this same run (same group, same token) holds it: the
 * runner that `npm run up` starts and restarts. Decided inside one write transaction, so two starters cannot both win.
 */
export function acquireRunnerLock(db: DB, dbPath: string, me: Me, table: ProcessTable, host = hostname(), now = new Date()): Acquired {
  const real = realpathSync(dbPath);
  const world = worldOf(real);
  const mine: RunnerLock = { world, db: real, file: fileId(real), host, pid: me.pid, pid_start: me.pid_start, pgid: me.pgid, token: me.token, role: me.role, started_at: now.toISOString() };
  const roleKey = `${KEY}.${me.role}`;
  const put = (key: string) => db.prepare("INSERT INTO locks (lock_key, holder, acquired_at, released_at) VALUES (?, ?, ?, NULL) ON CONFLICT (lock_key) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at, released_at = NULL")
    .run(key, JSON.stringify(mine), mine.started_at);
  const take = (note?: string): Acquired => {
    put(KEY);
    put(roleKey);
    return { ok: true, owner: true, lock: mine, ...(note ? { note } : {}) };
  };
  const alive = (l: RunnerLock) => procs.some((p) => p.pid === l.pid && p.start === l.pid_start && live(p));
  // The process table is read before the write transaction, so other writers of the ledger do not wait on the scan;
  // read again inside it when the lock it judges was taken after that read.
  const scannedAt = new Date().toISOString();
  let procs = table.list();
  const id = fileId(real);
  // Processes of another run still using this ledger (its owner gave the lock back or died while they run on): no start.
  const leftovers = () => procs.filter((p) => live(p) && p.token !== null && p.token !== me.token && p.db !== null && (() => { try { return fileId(p.db!) === id; } catch { return false; } })());
  return db.transaction((): Acquired => {
    const held = lockOf(db);
    if (held && held.started_at >= scannedAt) procs = table.list();
    const earlier = leftovers().filter((p) => !held || p.token !== held.token);
    if (earlier.length) return { ok: false, message: `${earlier.length} process(es) of an earlier run of world ${world} still use its ledger (pids ${earlier.map((p) => p.pid).join(", ")}, process group ${[...new Set(earlier.map((p) => p.pgid))].join(", ")}). Stop them first (check with ps -o pid,pgid,args).` };
    // One live process per role, also inside one run: `up` restarting its relay while the old relay still runs, or a
    // second `npm run relay`/`up` started from inside the group (it inherits the token), does not start.
    const roleBusy = (): Acquired | null => {
      const role = rowOf(db, roleKey);
      if (role && role.started_at >= scannedAt) procs = table.list();
      if (role && role.pid !== me.pid && sameLedger(role, real) && role.host === host && alive(role)) {
        return { ok: false, message: `world ${world} already has a ${me.role}: ${describe(role)}. A second ${me.role} on the same ledger does not start. Stop the world first: npm run stop -- ${world}` };
      }
      return null;
    };
    if (!held) return roleBusy() ?? take();
    // A row copied with the ledger (a snapshot, a copy for a new world) is not a lock on this file.
    if (!sameLedger(held, real)) return take(`a lock row copied from ${held.db} was replaced`);
    if (held.host !== host) return { ok: false, message: `world ${world} has a runner lock held on host ${held.host} (${describe(held)}); it cannot be checked from ${host}. Stop it there first; if that host is gone (a new container), npm run stop -- ${world} --forget-other-host clears it once nothing here uses the ledger.` };
    const sameRun = held.token === me.token && held.pgid === me.pgid;
    const holder = procs.find((p) => p.pid === held.pid && p.start === held.pid_start && live(p));
    if (holder) {
      if (sameRun) {
        const busy = roleBusy();
        if (busy) return busy;
        put(roleKey);
        return { ok: true, owner: false, lock: held };
      }
      return { ok: false, message: `world ${world} already has a runner: ${describe(held)}. A second runner on the same ledger does not start. Stop it first: npm run stop -- ${world}` };
    }
    if (sameRun) return roleBusy() ?? take(`took over from ${describe(held)} of this same run, which has stopped`);
    // A process whose environment cannot be read may be of that run: it counts as left, never as gone.
    const left = procs.filter((p) => p.pgid === held.pgid && live(p) && (p.token === held.token || !p.envReadable));
    if (left.length) return { ok: false, message: `the runner of world ${world} (${describe(held)}) has stopped, but ${left.length} process(es) of its run still run (pids ${left.map((p) => p.pid).join(", ")}). Stop them first: npm run stop -- ${world}` };
    return take(`a stale lock was cleared: ${describe(held)} is gone and nothing of its run is left`);
  }).immediate();
}

/** Gives back what this process holds: its role's row, and the world's lock if it owns it. */
export function releaseRunnerLock(db: Database.Database, me: Pick<Me, "pid" | "token" | "role">): void {
  for (const key of [`${KEY}.${me.role}`, KEY]) {
    const held = rowOf(db, key);
    if (held && held.pid === me.pid && held.token === me.token) db.prepare("DELETE FROM locks WHERE lock_key = ? AND holder = ?").run(key, JSON.stringify(held));
  }
}

/**
 * Makes this process the leader of its world's own process group, once: a process outside one (started by npm, a
 * shell, setsid) starts itself again as the leader of a new group with a new run token and only waits for it; Ctrl-C
 * and a stop reach the group. Inside the group (the runner `up` starts), it returns at once.
 */
export async function asWorldGroup(log: (line: string) => void = (l) => console.error(l)): Promise<{ token: string; pgid: number }> {
  const env = process.env;
  const pgid = ownPgid();
  if (env.KIT11_RUN_TOKEN && env.KIT11_RUN_PGID && Number(env.KIT11_RUN_PGID) === pgid) return { token: env.KIT11_RUN_TOKEN, pgid };
  if (env.KIT11_RUN_TOKEN && env.KIT11_RUN_LEADER === "1" && pgid === process.pid) {
    // The new group's leader: what it starts inherits the group and the token.
    delete env.KIT11_RUN_LEADER;
    env.KIT11_RUN_PGID = String(pgid);
    // The starter that waits for this group is gone (killed, even with SIGKILL): stop the whole run, as a stop would.
    process.on("disconnect", () => {
      log("the process that started this world is gone; stopping this world's process group");
      process.kill(-pgid, "SIGTERM");
    });
    process.channel?.unref();
    return { token: env.KIT11_RUN_TOKEN, pgid };
  }
  const { KIT11_RUN_PGID: _drop, ...rest } = env;
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    detached: true, stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...rest, KIT11_RUN_TOKEN: randomBytes(16).toString("hex"), KIT11_RUN_LEADER: "1" },
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* already gone */ } });
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1)));
  return new Promise(() => undefined);
}

/** The runner lock for this process, taken at start and given back at exit; exits with a clear message when refused. */
export function holdRunnerLock(db: DB, dbPath: string, role: string, group: { token: string; pgid: number }, table: ProcessTable): void {
  if (dbPath === ":memory:") return;
  const me: Me = { pid: process.pid, pid_start: procOf(process.pid)?.start ?? "", pgid: group.pgid, token: group.token, role };
  const r = acquireRunnerLock(db, dbPath, me, table);
  if (!r.ok) {
    console.error(`REFUSED  ${r.message}`);
    process.exit(3);
  }
  if (r.note) console.log(`lock     ${r.note}`);
  console.log(`lock     world ${r.lock.world}: ${r.owner ? "this process holds" : `this run holds (pid ${r.lock.pid})`} the runner lock; process group ${group.pgid}. Stop with: npm run stop -- ${r.lock.world}`);
  process.on("exit", () => { try { releaseRunnerLock(db, me); } catch { /* the stop removes it */ } });
}

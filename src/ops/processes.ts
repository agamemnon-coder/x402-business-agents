// The OS's process table, as the runner lock and `npm run stop` need it (2 November: a stop command reached only a
// setsid wrapper and the runner of another world kept running for half an hour). Read from /proc (Linux), with the
// world token and ledger each process was started with; signals go to a whole process group only (kill(-pgid)),
// never to a single pid and never by name. `ps` gives the OS's own second answer when a stop is verified.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  /** The kernel's state letter; Z is a zombie (exited, not yet reaped: it runs nothing). */
  state: string;
  /** The process's start time (clock ticks since boot): a pid and this together name one process, also after pid reuse. */
  start: string;
  /** KIT11_RUN_TOKEN from the environment it was started with: every process of one world's run carries it. */
  token: string | null;
  /** Whether its environment could be read at all: an unreadable one may hide a run token, so it is never "not ours". */
  envReadable: boolean;
  /** KIT11_DB as it was started with, resolved against its working directory. */
  db: string | null;
  cmd: string;
}

export interface ProcessTable {
  list(): Proc[];
  /** Signals one whole process group (kill(-pgid)). Never a single pid, never by name. */
  signalGroup(pgid: number, signal: NodeJS.Signals): void;
  /** The OS's own answer, from ps: the pids of this group that still run (zombies excluded). */
  psGroup(pgid: number): number[];
}

/** Only the two variables the lock needs; nothing else of another process's environment is kept or shown. */
function envOf(pid: number): { token: string | null; db: string | null } | null {
  try {
    const out: { token: string | null; db: string | null } = { token: null, db: null };
    for (const kv of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
      if (kv.startsWith("KIT11_RUN_TOKEN=")) out.token = kv.slice(16);
      else if (kv.startsWith("KIT11_DB=")) out.db = kv.slice(9);
    }
    return out;
  } catch {
    return null;
  }
}

/** One process from /proc, or null when it is gone (or unreadable). */
export function procOf(pid: number): Proc | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // "pid (comm) state ppid pgrp ... starttime": comm may hold spaces and parentheses, so split after the last ")".
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const env = envOf(pid);
    let db = env?.db ?? null;
    if (db && !isAbsolute(db)) {
      try { db = resolve(readlinkSync(`/proc/${pid}/cwd`), db); } catch { /* left relative: it matches no ledger */ }
    }
    let cmd = "";
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ").slice(0, 200); } catch { /* gone */ }
    return { pid, ppid: Number(f[1]), pgid: Number(f[2]), state: f[0]!, start: f[19]!, token: env?.token ?? null, envReadable: env !== null, db, cmd };
  } catch {
    return null;
  }
}

/** This process's group id. */
export function ownPgid(): number {
  const p = procOf(process.pid);
  if (p) return p.pgid;
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });
  const n = Number(r.stdout.trim());
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("cannot read this process's group id (no /proc, no ps)");
  return n;
}

export const osProcesses: ProcessTable = {
  list() {
    let pids: number[];
    try {
      pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number);
    } catch {
      throw new Error("the process table needs /proc (Linux), where the runners run");
    }
    return pids.map(procOf).filter((p): p is Proc => p !== null);
  },
  signalGroup(pgid, signal) {
    // A group id of 0 or 1 would mean "my own group" or init's: never.
    if (!Number.isSafeInteger(pgid) || pgid <= 1) throw new Error(`refusing to signal process group ${pgid}`);
    process.kill(-pgid, signal);
  },
  psGroup(pgid) {
    const r = spawnSync("ps", ["-eo", "pid=,pgid=,stat="], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`ps failed: ${r.stderr.trim().slice(0, 200)}`);
    return r.stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 3 && Number(c[1]) === pgid && !c[2]!.startsWith("Z")).map((c) => Number(c[0]));
  },
};

// The stop with real processes (Linux): two worlds, each a harmless stand-in runner (test/fixtures/world-runner.ts)
// that becomes its own process group, takes its ledger's lock and starts a child. A second runner on world A refuses;
// `stop` of world A ends A's whole group, checked with ps, and removes A's lock, while world B runs on untouched.
// Cleanup only ever signals the groups named in the test's own locks.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { osProcesses, ownPgid } from "../src/ops/processes.js";
import { lockOf } from "../src/ops/runnerLock.js";
import { stopWorld } from "../src/ops/stopWorld.js";

const repo = resolve(import.meta.dirname, "..");
const tsx = resolve(repo, "node_modules/.bin/tsx");
const linux = existsSync("/proc/self/stat");
const dir = mkdtempSync(join(tmpdir(), "kit11-stop-"));
const started: ChildProcess[] = [];

function ledger(name: string): string {
  const path = join(dir, `${name}.sqlite`);
  openDb(path).close();
  return path;
}
const lockAt = (path: string) => { const db = new Database(path); try { return lockOf(db); } finally { db.close(); } };
/** The runner's and its child's pids from its READY line. */
const readyPids = (text: string) => { const m = /READY (\d+) (\d+) (\d+)/.exec(text)!; return { runner: Number(m[1]), child: Number(m[3]) }; };
/**
 * A world's group is its runner and what the runner started: both pids are in it, and every other live member (a
 * toolchain helper the loader starts, such as a transform service, for as long as it runs) descends from the runner.
 * An exact count raced with such a helper under CI load (CI, 10 Nov: 3 instead of 2).
 */
function expectWorldGroup(pgid: number, pids: { runner: number; child: number }) {
  const procs = osProcesses.list();
  const members = osProcesses.psGroup(pgid);
  expect(members).toEqual(expect.arrayContaining([pids.runner, pids.child]));
  const descends = (pid: number) => { for (let p = procs.find((x) => x.pid === pid), n = 0; p && n < 20; p = procs.find((x) => x.pid === p!.ppid), n++) if (p.pid === pids.runner) return true; return false; };
  for (const m of members) expect({ pid: m, descendsFromRunner: descends(m) }).toEqual({ pid: m, descendsFromRunner: true });
}

/** Starts a stand-in runner on this ledger, as `npm run relay` is started: not in a group of its own. */
function runner(path: string, detached = false): { p: ChildProcess; ready: Promise<string>; exit: Promise<number | null>; out: () => string } {
  const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: path };
  for (const k of ["KIT11_RUN_TOKEN", "KIT11_RUN_PGID", "KIT11_RUN_LEADER"]) delete env[k];
  const p = spawn(tsx, [resolve(repo, "test/fixtures/world-runner.ts")], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached });
  started.push(p);
  let text = "";
  const ready = new Promise<string>((ok, fail) => {
    p.stdout!.on("data", (d: Buffer) => { text += d.toString(); if (/READY/.test(text)) ok(text); });
    p.stderr!.on("data", (d: Buffer) => { text += d.toString(); });
    p.on("exit", () => fail(new Error(`runner exited: ${text}`)));
  });
  ready.catch(() => undefined);
  const exit = new Promise<number | null>((ok) => p.on("exit", (code) => ok(code)));
  return { p, ready, exit, out: () => text };
}

afterAll(() => {
  // Only the process groups this test's own locks name, and only if still there.
  for (const name of ["world-a", "world-b", "world-c", "world-d"]) {
    const path = join(dir, `${name}.sqlite`);
    const l = existsSync(path) ? lockAt(path) : null;
    if (l && l.pgid > 1 && osProcesses.list().some((p) => p.pgid === l.pgid && p.token === l.token)) try { process.kill(-l.pgid, "SIGKILL"); } catch { /* gone */ }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe.runIf(linux)("stop with real processes", () => {
  it("a second runner on a ledger refuses; stop world A ends exactly A's process group; world B runs on", async () => {
    const a = ledger("world-a");
    const b = ledger("world-b");
    const ra = runner(a);
    const rb = runner(b);
    const [ta, tb] = await Promise.all([ra.ready, rb.ready]);
    const la = lockAt(a)!;
    const lb = lockAt(b)!;
    expect(la).toMatchObject({ world: "world-a", host: hostname() });
    expect(la.pgid).not.toBe(lb.pgid);
    expect(la.pgid).not.toBe(ownPgid());
    // Each world's group: the runner and the child it started.
    expectWorldGroup(la.pgid, readyPids(ta));
    expectWorldGroup(lb.pgid, readyPids(tb));

    const second = runner(a);
    expect(await second.exit).toBe(3);
    expect(second.out()).toMatch(/REFUSED .*world world-a already has a runner.*npm run stop -- world-a/);
    expect(lockAt(a)!.pid).toBe(la.pid);

    const lines: string[] = [];
    const r = await stopWorld(a, { table: osProcesses, host: hostname(), ownPgid: ownPgid(), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => Date.now(), log: (l) => lines.push(l), graceMs: 10_000 });
    expect(r).toMatchObject({ ok: true, signalled: [{ pgid: la.pgid, signal: "SIGTERM" }] });
    expect(osProcesses.psGroup(la.pgid)).toEqual([]);
    expect(lockAt(a)).toBeNull();
    // The starter left behind exits with its group.
    expect(await ra.exit).toBe(0);
    // World B: same lock, same group, both processes still running.
    expect(lockAt(b)).toEqual(lb);
    expectWorldGroup(lb.pgid, readyPids(tb));

    const rbStop = await stopWorld(b, { table: osProcesses, host: hostname(), ownPgid: ownPgid(), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => Date.now(), log: () => undefined, graceMs: 10_000 });
    expect(rbStop.ok).toBe(true);
    expect(osProcesses.psGroup(lb.pgid)).toEqual([]);
    await rb.exit;
  }, 60_000);

  it("when the starter is killed outright (kill -9 of the shell's group), the world's group stops itself", async () => {
    const c = ledger("world-c");
    const rc = runner(c, true);
    await rc.ready;
    const l = lockAt(c)!;
    expect(l.pgid).not.toBe(rc.p.pid);
    // The 2 November mistake, made on purpose: the signal reaches only the starter's group, not the world's.
    process.kill(-rc.p.pid!, "SIGKILL");
    for (let i = 0; i < 100 && osProcesses.psGroup(l.pgid).length; i++) await new Promise((ok) => setTimeout(ok, 100));
    expect(osProcesses.psGroup(l.pgid)).toEqual([]);
    expect(lockAt(c)).toBeNull();
  }, 60_000);

  it("a runner killed outright leaves a stale lock that the next start clears", async () => {
    // Its own ledger: a failure in the first test (which leaves world A's runner up until afterAll) cannot refuse it.
    const a = ledger("world-d");
    const ra = runner(a);
    await ra.ready;
    const l = lockAt(a)!;
    process.kill(-l.pgid, "SIGKILL");
    await ra.exit;
    for (let i = 0; i < 200 && osProcesses.psGroup(l.pgid).length; i++) await new Promise((ok) => setTimeout(ok, 100));
    expect(osProcesses.psGroup(l.pgid)).toEqual([]);
    expect(lockAt(a)).toEqual(l);
    const next = runner(a);
    const text = await next.ready;
    expect(text).toMatch(/stale lock was cleared/);
    const r = await stopWorld(a, { table: osProcesses, host: hostname(), ownPgid: ownPgid(), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => Date.now(), log: () => undefined, graceMs: 10_000 });
    expect(r.ok).toBe(true);
    await next.exit;
  }, 60_000);
});

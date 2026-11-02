// One runner per world, and a stop that stops exactly that world (2 November: a stop command reached only a setsid
// wrapper; the runner of another world kept running until 11:03). A fake process table here: the lock refuses a second
// runner, joins the runner `up` starts, clears a stale lock, and the stop signals only the locked world's process group,
// only when every process in it is that run's, then checks with "ps" before it removes the lock.
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import type { Proc, ProcessTable } from "../src/ops/processes.js";
import { acquireRunnerLock, lockOf, releaseRunnerLock, type Me } from "../src/ops/runnerLock.js";
import { stopWorld, type StopDeps } from "../src/ops/stopWorld.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function ledger(name: string): { path: string; db: DB } {
  const dir = mkdtempSync(join(tmpdir(), "kit11-lock-"));
  dirs.push(dir);
  const path = join(dir, `${name}.sqlite`);
  return { path, db: openDb(path) };
}

type FakeProc = Proc & { ignoresTerm?: boolean };
class FakeTable implements ProcessTable {
  procs: FakeProc[] = [];
  signals: { pgid: number; signal: NodeJS.Signals }[] = [];
  /** ps disagreeing with the table (a process the table did not see). */
  psExtra: number[] = [];
  add(p: Partial<FakeProc> & { pid: number; pgid: number; token: string | null }): void {
    this.procs.push({ ppid: 1, state: "S", start: `t${p.pid}`, db: null, cmd: `node runner ${p.pid}`, ...p });
  }
  list(): Proc[] { return this.procs.map((p) => ({ ...p })); }
  signalGroup(pgid: number, signal: NodeJS.Signals): void {
    this.signals.push({ pgid, signal });
    this.procs = this.procs.filter((p) => p.pgid !== pgid || (signal === "SIGTERM" && p.ignoresTerm));
  }
  psGroup(pgid: number): number[] {
    return [...this.procs.filter((p) => p.pgid === pgid && !p.state.startsWith("Z")).map((p) => p.pid), ...this.psExtra];
  }
}

const me = (pid: number, pgid: number, token: string, role = "relay"): Me => ({ pid, pid_start: `t${pid}`, pgid, token, role });
function deps(table: FakeTable, over: Partial<StopDeps> = {}): StopDeps & { lines: string[] } {
  let t = 0;
  const lines: string[] = [];
  return { table, host: "box", ownPgid: 9000, sleep: async (ms) => { t += ms; }, now: () => t, log: (l) => lines.push(l), graceMs: 5_000, killWaitMs: 2_000, lines, ...over };
}

describe("the runner lock: one runner per world", () => {
  it("the first runner takes the lock; a second runner on the same ledger refuses with a clear message", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    const first = acquireRunnerLock(a.db, a.path, me(100, 100, "run-a"), t, "box");
    expect(first).toMatchObject({ ok: true, owner: true, lock: { world: "world-a", pid: 100, pgid: 100, host: "box" } });
    t.add({ pid: 200, pgid: 200, token: "run-b" });
    const second = acquireRunnerLock(a.db, a.path, me(200, 200, "run-b"), t, "box");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toMatch(/world world-a already has a runner: pid 100 \(process group 100, relay\).*npm run stop -- world-a/);
    expect(lockOf(a.db)!.pid).toBe(100);
  });

  it("the runner `up` starts joins up's lock (same group, same run); its restart too, and only the holder gives it back", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    t.add({ pid: 101, pgid: 100, token: "run-a" });
    expect(acquireRunnerLock(a.db, a.path, me(100, 100, "run-a", "up"), t, "box")).toMatchObject({ ok: true, owner: true });
    expect(acquireRunnerLock(a.db, a.path, me(101, 100, "run-a"), t, "box")).toMatchObject({ ok: true, owner: false, lock: { pid: 100, role: "up" } });
    releaseRunnerLock(a.db, { pid: 101, token: "run-a" });
    expect(lockOf(a.db)!.pid).toBe(100);
    releaseRunnerLock(a.db, { pid: 100, token: "run-a" });
    expect(lockOf(a.db)).toBeNull();
  });

  it("clears a stale lock (its process is gone, nothing of its run is left), also after pid reuse", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    acquireRunnerLock(a.db, a.path, me(100, 100, "run-a"), t, "box");
    // The old runner died (a container restart, a kill -9); its pid now belongs to an unrelated process.
    t.procs = [];
    t.add({ pid: 100, pgid: 555, token: null, start: "later" });
    t.add({ pid: 300, pgid: 300, token: "run-new" });
    const r = acquireRunnerLock(a.db, a.path, me(300, 300, "run-new"), t, "box");
    expect(r).toMatchObject({ ok: true, owner: true, lock: { pid: 300 }, note: expect.stringMatching(/stale lock was cleared/) });
  });

  it("refuses while processes of the dead runner's run are still alive (an agent, a supervisor)", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    t.add({ pid: 102, pgid: 100, token: "run-a" });
    acquireRunnerLock(a.db, a.path, me(100, 100, "run-a"), t, "box");
    t.procs = t.procs.filter((p) => p.pid !== 100);
    t.add({ pid: 300, pgid: 300, token: "run-new" });
    const r = acquireRunnerLock(a.db, a.path, me(300, 300, "run-new"), t, "box");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/still run \(pids 102\).*npm run stop -- world-a/);
  });

  it("refuses while a process of an earlier run still uses the ledger, even with no lock row left", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 150, pgid: 150, token: "run-old", db: a.path, cmd: "node src/cli/s2.ts" });
    t.add({ pid: 300, pgid: 300, token: "run-new" });
    const r = acquireRunnerLock(a.db, a.path, me(300, 300, "run-new"), t, "box");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/earlier run of world world-a still use its ledger \(pids 150, process group 150\)/);
    // A process of another world, or one without a run token (a manual check), does not stop the start.
    t.procs = t.procs.filter((p) => p.pid !== 150);
    t.add({ pid: 160, pgid: 160, token: "run-b", db: ledger("world-b").path });
    t.add({ pid: 170, pgid: 170, token: null, db: a.path });
    expect(acquireRunnerLock(a.db, a.path, me(300, 300, "run-new"), t, "box").ok).toBe(true);
  });

  it("replaces a lock row copied in with the ledger, and refuses a lock held on another host", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    a.db.prepare("INSERT INTO locks (lock_key, holder, acquired_at) VALUES ('runner', ?, 'x')").run(JSON.stringify({ world: "live-1", db: "/elsewhere/live-1.sqlite", host: "box", pid: 100, pid_start: "t100", pgid: 100, token: "run-a", role: "relay", started_at: "x" }));
    t.add({ pid: 300, pgid: 300, token: "run-new" });
    expect(acquireRunnerLock(a.db, a.path, me(300, 300, "run-new"), t, "box")).toMatchObject({ ok: true, note: expect.stringMatching(/copied from \/elsewhere/) });
    const r = acquireRunnerLock(a.db, a.path, me(400, 400, "run-x"), t, "other-box");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/held on host box/);
  });
});

describe("the runner lock: the same ledger file by another path", () => {
  it("a second path (a symlink) to the same ledger is the same world: refused, not treated as a copied row", () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 100, pgid: 100, token: "run-a" });
    acquireRunnerLock(a.db, a.path, me(100, 100, "run-a"), t, "box");
    const link = join(dirs.at(-1)!, "other-name.sqlite");
    symlinkSync(a.path, link);
    t.add({ pid: 200, pgid: 200, token: "run-b" });
    expect(acquireRunnerLock(openDb(link), link, me(200, 200, "run-b"), t, "box").ok).toBe(false);
  });
});

describe("npm run stop -- <world>: exactly that world, verified", () => {
  /** Two worlds running side by side, as live-1 and agent-1 did on 2 November. */
  function twoWorlds() {
    const a = ledger("world-a");
    const b = ledger("world-b");
    const t = new FakeTable();
    for (const [pid, pgid, token, db] of [[100, 100, "run-a", a.path], [101, 100, "run-a", a.path], [102, 100, "run-a", a.path], [200, 200, "run-b", b.path], [201, 200, "run-b", b.path]] as const) t.add({ pid, pgid, token, db });
    expect(acquireRunnerLock(a.db, a.path, me(100, 100, "run-a", "up"), t, "box").ok).toBe(true);
    expect(acquireRunnerLock(b.db, b.path, me(200, 200, "run-b", "up"), t, "box").ok).toBe(true);
    return { a, b, t };
  }

  it("stop world A signals only A's process group; world B's processes and lock are never touched", async () => {
    const { a, b, t } = twoWorlds();
    const r = await stopWorld(a.path, deps(t));
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/world world-a stopped: process group 100 is gone \(checked with ps\); lock removed/) });
    expect(t.signals).toEqual([{ pgid: 100, signal: "SIGTERM" }]);
    expect(t.procs.map((p) => p.pid)).toEqual([200, 201]);
    expect(lockOf(a.db)).toBeNull();
    expect(lockOf(b.db)).toMatchObject({ world: "world-b", pgid: 200 });
  });

  it("signals nothing when the group holds a process that is not this world's run", async () => {
    const { a, t } = twoWorlds();
    t.add({ pid: 150, pgid: 100, token: null, cmd: "bash -c something else" });
    const r = await stopWorld(a.path, deps(t));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not world world-a's run: 150 .*Nothing signalled/);
    expect(t.signals).toEqual([]);
    expect(lockOf(a.db)).not.toBeNull();
  });

  it("a group that ignores SIGTERM gets SIGKILL after the grace, the same group only, then is verified gone", async () => {
    const { a, t } = twoWorlds();
    t.procs.find((p) => p.pid === 101)!.ignoresTerm = true;
    const d = deps(t);
    const r = await stopWorld(a.path, d);
    expect(r.ok).toBe(true);
    expect(t.signals).toEqual([{ pgid: 100, signal: "SIGTERM" }, { pgid: 100, signal: "SIGKILL" }]);
    expect(t.procs.map((p) => p.pid)).toEqual([200, 201]);
    expect(d.lines.join("\n")).toMatch(/did not stop within 5 s; SIGKILL to process group 100/);
  });

  it("keeps the lock and says so when ps still sees a process of the group", async () => {
    const { a, t } = twoWorlds();
    t.psExtra = [103];
    const r = await stopWorld(a.path, deps(t));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/still has 103 .*the lock is kept/) });
    expect(lockOf(a.db)).not.toBeNull();
  });

  it("a stale lock (nothing of its run left) is cleared without any signal", async () => {
    const { a, t } = twoWorlds();
    t.procs = t.procs.filter((p) => p.pgid !== 100);
    const r = await stopWorld(a.path, deps(t));
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/was not running .*stale lock was cleared/) });
    expect(t.signals).toEqual([]);
    expect(lockOf(a.db)).toBeNull();
  });

  it("never signals its own group, group 0 or 1, or a lock held on another host", async () => {
    for (const [pgid, host, own] of [[9000, "box", 9000], [1, "box", 9000], [100, "elsewhere", 9000]] as const) {
      const a = ledger("world-a");
      const t = new FakeTable();
      t.add({ pid: pgid, pgid, token: "run-a" });
      a.db.prepare("INSERT INTO locks (lock_key, holder, acquired_at) VALUES ('runner', ?, 'x')").run(JSON.stringify({ world: "world-a", db: a.path, host, pid: pgid, pid_start: `t${pgid}`, pgid, token: "run-a", role: "relay", started_at: "x" }));
      const r = await stopWorld(a.path, deps(t, { ownPgid: own }));
      expect(r.ok).toBe(false);
      expect(t.signals).toEqual([]);
    }
  });

  it("without a lock (a runner from before the lock existed) it reports the ledger's processes and signals nothing", async () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    t.add({ pid: 700, pgid: 700, token: null, db: a.path, cmd: "node src/cli/relay.ts" });
    const r = await stopWorld(a.path, deps(t));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/no runner lock, but 1 process\(es\) use its ledger.*700/) });
    expect(t.signals).toEqual([]);
    const none = await stopWorld(ledger("world-c").path, deps(new FakeTable()));
    expect(none).toMatchObject({ ok: true, message: expect.stringMatching(/nothing to stop/) });
  });

  it("does not count the stop command itself (KIT11_DB exported in the operator's shell) as another user", async () => {
    const { a, t } = twoWorlds();
    t.add({ pid: process.pid, pgid: 9000, token: null, db: a.path, cmd: "node src/cli/stop.ts world-a" });
    t.add({ pid: 9001, pgid: 9000, token: null, db: a.path, cmd: "npm run stop" });
    expect(await stopWorld(a.path, deps(t))).toMatchObject({ ok: true });
  });

  it("names, but never signals, another process still using the ledger outside the run", async () => {
    const { a, t } = twoWorlds();
    t.add({ pid: 800, pgid: 800, token: null, db: a.path, cmd: "node src/cli/agent.ts support" });
    const r = await stopWorld(a.path, deps(t));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/run stopped .*lock removed.*1 other process\(es\) still use its ledger: 800/);
    expect(t.signals).toEqual([{ pgid: 100, signal: "SIGTERM" }]);
    expect(t.procs.map((p) => p.pid)).toContain(800);
  });

  it("a lock from a host that is gone is cleared only with --forget-other-host and only if nothing here uses the ledger", async () => {
    const a = ledger("world-a");
    const t = new FakeTable();
    a.db.prepare("INSERT INTO locks (lock_key, holder, acquired_at) VALUES ('runner', ?, 'x')").run(JSON.stringify({ world: "world-a", db: a.path, host: "old-container", pid: 5, pid_start: "t5", pgid: 5, token: "run-a", role: "relay", started_at: "x" }));
    expect((await stopWorld(a.path, deps(t))).ok).toBe(false);
    t.add({ pid: 900, pgid: 900, token: null, db: a.path });
    expect((await stopWorld(a.path, deps(t, { forgetOtherHost: true }))).ok).toBe(false);
    expect(lockOf(a.db)).not.toBeNull();
    t.procs = [];
    expect(await stopWorld(a.path, deps(t, { forgetOtherHost: true }))).toMatchObject({ ok: true, message: expect.stringMatching(/from host old-container was cleared/) });
    expect(lockOf(a.db)).toBeNull();
    expect(t.signals).toEqual([]);
  });

  it("a world name with no ledger creates nothing and signals nothing", async () => {
    const t = new FakeTable();
    const dir = mkdtempSync(join(tmpdir(), "kit11-lock-"));
    dirs.push(dir);
    const r = await stopWorld(join(dir, "typo.sqlite"), deps(t));
    expect(r.ok).toBe(false);
    expect(existsSync(join(dir, "typo.sqlite"))).toBe(false);
    expect(t.signals).toEqual([]);
  });
});

// The call log's lock when a dead process left one behind. Breaks if two processes that both see the dead one's lock
// can both go on: the second would remove the first one's fresh lock, and both would append at the budget's last
// line. The second process is played here, at the very moment the race needs: between the first one's look at the
// lock and what it does next. No network; the log is a file in a temp folder.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the other process does when this one has just looked at the lock (once), and when it looks again later. */
const other = { onLook: [] as (() => void)[], atAppend: null as (() => void) | null };
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    statSync: ((...a: Parameters<typeof fs.statSync>) => { const r = fs.statSync(...a); if (String(a[0]).endsWith(".lock")) other.onLook.shift()?.(); return r; }) as typeof fs.statSync,
    appendFileSync: ((...a: Parameters<typeof fs.appendFileSync>) => { other.atAppend?.(); return fs.appendFileSync(...a); }) as typeof fs.appendFileSync,
  };
});
const { callBudget, readOwnersCalls } = await import("../src/metal/ownersBudget.js");

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "owners-lock-")); file = join(dir, "calls.jsonl"); other.onLook = []; other.atAppend = null; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a lock a dead process left on the call log", () => {
  it("is taken over by one process only: a second that saw the same dead lock does not remove the first one's fresh lock", () => {
    const lock = `${file}.lock`;
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let otherHolds = false;
    let appendedWhileOtherHeld = false;
    other.onLook = [
      // This process has seen the dead lock. Before it acts, the other process (which saw it too) takes it over and
      // holds its own fresh lock, with the log's last line still free.
      () => { unlinkSync(lock); writeFileSync(lock, "", { flag: "wx" }); otherHolds = true; },
      // Later the other process appends its line and lets go.
      () => { writeFileSync(file, '{"at":"x","method":"eth_call","step":"other","pid":2}\n', { flag: "a" }); unlinkSync(lock); otherHolds = false; },
    ];
    other.atAppend = () => { appendedWhileOtherHeld ||= otherHolds; };
    const b = callBudget({ budget: 1, file, pid: 1 });
    // The other process took the last line: this one is refused, and never wrote while the other held the lock.
    expect(() => b.count("eth_call", "mine")).toThrow(/budget of 1 lines is spent/);
    expect(appendedWhileOtherHeld).toBe(false);
    expect(readOwnersCalls(file).map((c) => c.step)).toEqual(["other"]);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
  });

  it("is still taken over when nobody else is there, and leaves nothing behind", () => {
    const lock = `${file}.lock`;
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const b = callBudget({ budget: 2, file });
    b.count("eth_call", "s");
    expect(b.used()).toBe(1);
    expect(readdirSync(dir)).toEqual(["calls.jsonl"]);
  });
});

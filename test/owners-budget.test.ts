// The call budget of a live owners run (Face ID signs on chain). The owner agrees a number of Metal calls before
// anything runs. Breaks if a command could run without the owner's go, a budget and a log; if a call is logged after
// it is sent, or not at all; if the budget is counted per process instead of per world (one log, every process); or
// if the call that would go over the number is sent anyway. No network: the log is a file in a temp folder.
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callBudget, countByStep, OwnersBudgetSpent, OwnersGuardRefused, ownersBudget, ownersRefusals, readOwnersCalls } from "../src/metal/ownersBudget.js";

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "owners-budget-")); file = join(dir, "calls.jsonl"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const t0 = new Date("2026-11-12T10:00:00Z");

describe("the guard of a live owners command", () => {
  it("names everything that is missing: the owner's go, a whole-number budget and a log file", () => {
    expect(ownersRefusals({})).toHaveLength(3);
    expect(ownersRefusals({ OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: file })).toEqual([]);
    expect(ownersRefusals({ OWNERS_GO: "ja", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: file })).toEqual([expect.stringMatching(/OWNERS_GO=yes/)]);
    for (const bad of ["", "ten", "4.5", "-3", "1e2", " 7"]) expect(ownersRefusals({ OWNERS_GO: "yes", OWNERS_CALL_BUDGET: bad, OWNERS_CALL_LOG: file })).toEqual([expect.stringMatching(/OWNERS_CALL_BUDGET/)]);
    expect(ownersRefusals({ OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40" })).toEqual([expect.stringMatching(/OWNERS_CALL_LOG/)]);
  });

  it("refuses to hand out a budget while anything is missing, and says nothing was called", () => {
    expect(() => ownersBudget({ OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40" })).toThrow(OwnersGuardRefused);
    expect(() => ownersBudget({})).toThrow(/Nothing was called/);
    expect(existsSync(file)).toBe(false);
    const b = ownersBudget({ OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: file });
    expect([b.budget, b.used(), b.left()]).toEqual([40, 0, 40]);
  });
});

describe("the call log and the budget", () => {
  it("appends each call before it is made: the time, the method, the step and the process", () => {
    const b = callBudget({ budget: 3, file, now: () => t0, pid: 4242 });
    b.count("eth_call", "setup");
    expect(readFileSync(file, "utf8")).toBe('{"at":"2026-11-12T10:00:00.000Z","method":"eth_call","step":"setup","pid":4242}\n');
    b.count("cli:mandate pull", "pay");
    expect(readOwnersCalls(file).map((c) => c.method)).toEqual(["eth_call", "cli:mandate pull"]);
    expect([b.used(), b.left()]).toEqual([2, 1]);
  });

  it("refuses the call that would go over the budget, and does not log it", () => {
    const b = callBudget({ budget: 2, file });
    b.count("eth_getCode", "preflight");
    b.count("eth_call", "preflight");
    expect(() => b.count("eth_sendRawTransaction", "setup")).toThrow(OwnersBudgetSpent);
    expect(() => b.count("eth_sendRawTransaction", "setup")).toThrow(/budget of 2 .*eth_sendRawTransaction .*not sent/);
    expect(readOwnersCalls(file)).toHaveLength(2);
  });

  it("counts one world across processes and commands: a second process sees what the first one used", () => {
    const cli = callBudget({ budget: 3, file, pid: 1 });
    const runner = callBudget({ budget: 3, file, pid: 2 });
    cli.count("eth_call", "propose");
    runner.count("eth_getTransactionCount", "execute P-0001");
    runner.count("eth_sendRawTransaction", "execute P-0001");
    expect(cli.left()).toBe(0);
    expect(() => cli.count("eth_call", "status")).toThrow(OwnersBudgetSpent);
    expect(readOwnersCalls(file).map((c) => c.pid)).toEqual([1, 2, 2]);
  });

  it("checks before a step that the budget still holds what the step needs", () => {
    const b = callBudget({ budget: 5, file });
    b.count("eth_call", "x");
    b.count("eth_call", "x");
    expect(() => b.need(3, "relaying P-0001")).not.toThrow();
    expect(() => b.need(4, "relaying P-0001")).toThrow(/relaying P-0001 needs 4 .*3 .*left.*nothing was sent/);
    expect(() => b.need(4, "relaying P-0001")).toThrow(OwnersBudgetSpent);
  });

  it("fails closed on a log it cannot read, and is not stopped by a lock a dead process left behind", () => {
    writeFileSync(file, '{"at":"x","method":"eth_call","step":"s","pid":1}\nnot json\n');
    expect(() => callBudget({ budget: 9, file }).count("eth_call", "s")).toThrow(/call log .* line 2/);
    writeFileSync(file, "");
    writeFileSync(`${file}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, old, old);
    const b = callBudget({ budget: 9, file });
    b.count("eth_call", "s");
    expect(b.used()).toBe(1);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it("sums the log per step, with whole CLI runs told apart from single requests", () => {
    const b = callBudget({ budget: 9, file });
    for (const [m, s] of [["eth_call", "setup"], ["eth_sendRawTransaction", "setup"], ["cli:mandate pull", "pay"], ["cli:mandate pull", "pay"], ["eth_call", "pay"]] as const) b.count(m, s);
    expect(countByStep(readOwnersCalls(file))).toEqual([{ step: "setup", requests: 2, cli_runs: 0 }, { step: "pay", requests: 1, cli_runs: 2 }]);
  });
});

// npm run owners, the command itself. Every owners command calls Alta testnet, so every one refuses to run without the
// owner's go, a call budget and a call log, before it opens a ledger or makes a call. Breaks if any command (the new
// ones too) starts without them. Runs the real command in a child process; nothing is called (the suite has no network).
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "owners-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function owners(line: string, env: Record<string, string>): Promise<{ code: number | null; text: string }> {
  const [cmd, ...args] = line.split(" ") as [string, ...string[]];
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OWNERS_|KIT11_RELAY_|CLOUDFLARE_|METAL_RPC_URL$)/.test(k)));
  return new Promise((done) => {
    execFile(join(REPO, "node_modules/.bin/tsx"), ["src/cli/ownersExecute.ts", cmd, ...args], { cwd: REPO, env: { ...clean, KIT11_DB: join(dir, `${cmd}.sqlite`), KIT11_KEYS_DIR: join(dir, "keys"), ...env }, timeout: 220_000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, text: `${stdout}${stderr}` });
    });
  });
}

describe("npm run owners", () => {
  it("refuses every command without the owner's go, a budget and a log, and opens no ledger", async () => {
    const commands = ["preflight", "setup", "propose", "propose-replace 0.10 0.50", "propose-revoke", "pay", "status"];
    const runs = await Promise.all(commands.map((c) => owners(c, {})));
    for (const [i, r] of runs.entries()) {
      expect(r.code, `${commands[i]}: ${r.text}`).toBe(2);
      expect(r.text, commands[i]).toMatch(/OWNERS_GO=yes/);
      expect(r.text, commands[i]).toMatch(/OWNERS_CALL_BUDGET/);
      expect(r.text, commands[i]).toMatch(/OWNERS_CALL_LOG/);
      expect(existsSync(join(dir, `${commands[i]!.split(" ")[0]}.sqlite`)), commands[i]).toBe(false);
    }
    // Half a guard is no guard: a budget nobody logs.
    const half = await owners("status", { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "12" });
    expect(half.code).toBe(2);
    expect(half.text).toMatch(/OWNERS_CALL_LOG/);
    expect(half.text).not.toMatch(/OWNERS_GO=yes/);
  }, 240_000);

  it("refuses every command on an unnamed world (no KIT11_DB or no KIT11_KEYS_DIR), with the guard set, and opens nothing", async () => {
    const log = join(dir, "unnamed.jsonl");
    const guard = { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: log };
    const commands = ["setup", "propose", "propose-replace 0.10 0.50", "propose-revoke", "pay", "status"];
    const runs = await Promise.all([
      ...commands.map((c) => owners(c, { ...guard, KIT11_DB: "" })),
      ...commands.map((c) => owners(c, { ...guard, KIT11_KEYS_DIR: "" })),
      owners("record", { ...guard, KIT11_DB: "" }),
    ]);
    for (const r of runs) {
      expect(r.code, r.text).toBe(2);
      expect(r.text).toMatch(/KIT11_DB|KIT11_KEYS_DIR/);
      expect(r.text).toMatch(/[Nn]othing was (opened|written)/);
    }
    expect(runs.slice(0, commands.length).every((r) => /KIT11_DB \(this world's ledger/.test(r.text))).toBe(true);
    expect(runs.slice(commands.length, 2 * commands.length).every((r) => /KIT11_KEYS_DIR \(this world's keys folder/.test(r.text))).toBe(true);
    expect(existsSync(log)).toBe(false);
  }, 240_000);

  it("preflight with the guard set still makes no call while the relay's settings are missing", async () => {
    const log = join(dir, "calls.jsonl");
    const r = await owners("preflight", { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: log, KIT11_PASSKEY_OWNERS: "on" });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/MISSING +METAL_RPC_URL/);
    expect(r.text).toMatch(/MISSING +the relay's address/);
    expect(r.text).toMatch(/MISSING +the relay's token/);
    expect(r.text).toMatch(/preflight made no call/);
    expect(existsSync(log)).toBe(false);
  }, 240_000);

  it("names its commands for anything else, and the amounts a replace needs", async () => {
    const guard = { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: "40", OWNERS_CALL_LOG: join(dir, "unused.jsonl") };
    const [r, bare, bad, extra] = await Promise.all([owners("deploy", {}), owners("propose-replace", guard), owners("propose-replace 0.1 0.50", guard), owners("propose 0.10", guard)]);
    expect(r.code).toBe(2);
    expect(r.text.trim()).toBe("usage: npm run owners -- preflight | setup | propose [<cap> <budget>] | propose-replace <cap> <budget> | propose-revoke | pay | status | record");
    // Amounts are read before anything is opened or called.
    for (const x of [bare, bad, extra]) {
      expect(x.code, x.text).toBe(2);
      expect(x.text).toMatch(/the cap and the budget are amounts like 0\.10 0\.50/);
    }
    expect(bare.text).toMatch(/usage: npm run owners -- propose-replace <cap> <budget>/);
    expect(existsSync(join(dir, "propose-replace.sqlite"))).toBe(false);
    expect(existsSync(join(dir, "unused.jsonl"))).toBe(false);
  }, 240_000);
});

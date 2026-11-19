// npm run erp (src/erp/cli.ts), the refusals: every command says what it needs before it reads, writes or calls
// anything: which ERP, a call log and the approved number of requests, the test world's step and its own ledger, the
// object a person resolves, as what and by whom, and a dry run only for a sync. The status with nothing sent says so.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { runErpCli } from "../src/erp/cli.js";

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const lines: string[] = [];
  const code = await runErpCli(args, { db: openDb(":memory:"), env, out: (l) => lines.push(l), items: () => [] });
  return { code, text: lines.join("\n") };
}

describe("npm run erp refuses before it does anything", () => {
  it("lists every connector as not set up, naming the missing settings and no value", async () => {
    const r = await run(["list"], { ERP_EXACT_DIVISION: "123" });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/^exact .*not set up \(missing /m);
    expect(r.text).toMatch(/^odoo .*not set up/m);
  });

  it("status with nothing sent says so", async () => {
    expect(await run(["status"])).toEqual({ code: 0, text: "nothing sent to an ERP yet" });
  });

  it("calls and record need the run's call log, and record the approved number", async () => {
    await expect(run(["calls"])).rejects.toThrow("ERP_CALL_LOG is not set: name the run's call log");
    await expect(run(["record", "--connector", "moneybird"])).rejects.toThrow("ERP_CALL_LOG is not set");
    await expect(run(["record", "--connector", "moneybird"], { ERP_CALL_LOG: "/nowhere.jsonl", ERP_CALL_BUDGET: "many" })).rejects.toThrow("ERP_CALL_BUDGET is not set: the approved number of requests for the whole run");
  });

  it("a command that needs an ERP refuses without one, or with an unknown one", async () => {
    await expect(run(["sync"])).rejects.toThrow(/^say which ERP: --connector /);
    await expect(run(["sync", "--connector", "sap", "--dry-run"])).rejects.toThrow(/^say which ERP/);
  });

  it("the test world needs a step and a ledger of its own", async () => {
    await expect(run(["world"])).rejects.toThrow("say --step build --dir <folder> or --step recode");
    await expect(run(["world", "--step", "build"])).rejects.toThrow(/the test world is built in a ledger of its own/);
  });

  it("a person's resolution needs the object, synced or retry, and who", async () => {
    await expect(run(["resolve", "--connector", "moneybird"])).rejects.toThrow("say which object: --object invoice:<id>");
    await expect(run(["resolve", "--connector", "moneybird", "--object", "cheese:1"])).rejects.toThrow("say which object");
    await expect(run(["resolve", "--connector", "moneybird", "--object", "invoice:INV-1", "--as", "maybe"])).rejects.toThrow(/say --as synced .* or --as retry/);
    await expect(run(["resolve", "--connector", "moneybird", "--object", "invoice:INV-1", "--as", "synced"])).rejects.toThrow("say who resolves it: --by <name or role>");
  });

  it("readback is Moneybird's only; a dry run is a sync's only; a live run needs its settings", async () => {
    await expect(run(["readback", "--connector", "exact", "--live"])).rejects.toThrow("readback is built for Moneybird only");
    await expect(run(["pull", "--connector", "exact", "--dry-run"])).rejects.toThrow("pull has no dry run; use sync --dry-run to see the requests");
    await expect(run(["correct", "--connector", "exact", "--dry-run"])).rejects.toThrow("correct has no dry run");
    await expect(run(["sync", "--connector", "exact", "--live"])).rejects.toThrow(/is not set up: missing .* \(see docs\/erp\.md\)/);
  });
});

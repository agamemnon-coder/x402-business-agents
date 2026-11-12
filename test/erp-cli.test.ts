// npm run erp (src/erp/cli.ts): a dry run sends nothing and prints the requests without secrets; a live run needs the
// connector's settings and says --live; list names the missing settings, never a value.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { readCallLog } from "../src/erp/callBudget.js";
import { runErpCli } from "../src/erp/cli.js";
import type { ErpConnector, Transport } from "../src/erp/connector.js";
import { ensureErpSchema, type SyncItem } from "../src/erp/sync.js";
import { sampleInvoice, samplePayment, sampleVendor } from "./fakes/erp.js";
import { FakeMoneybird, LEDGER, TAX } from "./fakes/moneybird.js";

const items = (): SyncItem[] => [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }, { kind: "payment", object: samplePayment() }];

async function run(args: string[], env: Record<string, string | undefined> = {}, transport?: Transport) {
  const lines: string[] = [];
  const db = openDb(":memory:");
  const code = await runErpCli(args, { db, env, out: (l) => lines.push(l), items, ...(transport ? { transport } : {}) });
  return { code, text: lines.join("\n"), db };
}

describe("npm run erp", () => {
  for (const c of ["exact", "bc", "odoo"]) {
    it(`dry-runs ${c} on example settings: requests printed, IBAN shortened, nothing recorded`, async () => {
      const { code, text, db } = await run(["sync", "--connector", c, "--dry-run"]);
      expect(code).toBe(0);
      expect(text).toMatch(/nothing is sent/);
      expect(text).toMatch(/Example settings/);
      expect(text).toMatch(/vendor\s+V-1\s+pushed/);
      expect(text).toMatch(/invoice\s+INV-1\s+pushed/);
      expect(text).toMatch(/payment\s+PAY-1\s+pushed/);
      expect(text).not.toContain("DE89370400440532013000");
      expect(text).not.toMatch(/Bearer (?!\[redacted\])/);
      expect((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'erp_sync'").get() as { n: number }).n).toBe(0);
    });
  }

  it("refuses a sync that says neither --dry-run nor --live", async () => {
    await expect(run(["sync", "--connector", "exact"])).rejects.toThrow(/--dry-run.*--live/);
  });

  it("refuses a live sync without the connector's settings, naming what is missing", async () => {
    await expect(run(["sync", "--connector", "odoo", "--live"])).rejects.toThrow(/ERP_ODOO_API_KEY/);
  });

  it("says of a connector with its settings present what was really proven live: Moneybird read from a sandbox, nothing sent; the others nothing", async () => {
    const { text } = await run(["list"], {
      ERP_MONEYBIRD_TOKEN: "t", ERP_MONEYBIRD_ADMINISTRATION_ID: "1", ERP_MONEYBIRD_TAX_RATES: "{}",
      ERP_ODOO_API_KEY: "k", ERP_ODOO_URL: "https://x.odoo.com", ERP_ODOO_DB: "d", ERP_ODOO_LOGIN: "l", ERP_ODOO_PURCHASE_JOURNAL_ID: "1", ERP_ODOO_GENERAL_JOURNAL_ID: "2", ERP_ODOO_BANK_JOURNALS: "{}", ERP_ODOO_TAX_IDS: "{}",
    });
    expect(text).toMatch(/moneybird Moneybird: settings present \(run live once in a sandbox administration with test data: docs\/moneybird\.md\)/);
    expect(text).toMatch(/odoo\s+Odoo: settings present \(not tested against a live ERP yet\)/);
  });

  it("lists the connectors with the settings each still needs, and never a value", async () => {
    const { text } = await run(["list"], { ERP_ODOO_API_KEY: "secret-value-1", ERP_ODOO_URL: "https://x.odoo.com" });
    expect(text).toMatch(/exact\s+Exact Online: not set up \(missing ERP_EXACT_CLIENT_ID/);
    expect(text).toMatch(/odoo\s+Odoo: not set up \(missing ERP_ODOO_DB/);
    expect(text).not.toContain("secret-value-1");
  });
});

describe("npm run erp -- resolve", () => {
  it("lets a person settle an object that waits for them, naming who; anything else is refused", async () => {
    const db = openDb(":memory:");
    const lines: string[] = [];
    const out = (l: string) => lines.push(l);
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, external_id, pushed_hash, status, attempts, last_error, updated_at) VALUES ('bc', 'invoice', 'INV-1', 'pi-2', 'h', 'needs_review', 1, 'left in Draft', '2026-11-08T00:00:00Z')").run();
    await expect(runErpCli(["resolve", "--connector", "bc", "--object", "invoice:INV-1", "--as", "synced"], { db, env: {}, out, items })).rejects.toThrow(/--by/);
    expect(await runErpCli(["resolve", "--connector", "bc", "--object", "invoice:INV-1", "--as", "synced", "--by", "accountant"], { db, env: {}, out, items })).toBe(0);
    expect(lines.join("\n")).toMatch(/invoice INV-1: synced by accountant/);
    await expect(runErpCli(["resolve", "--connector", "bc", "--object", "invoice:INV-1", "--as", "synced", "--by", "accountant"], { db, env: {}, out, items })).rejects.toThrow(/does not wait for a person/);
  });
});

describe("npm run erp, live (a go, a call budget and a call log)", () => {
  const made: string[] = [];
  const callLog = () => { const dir = mkdtempSync(join(tmpdir(), "erp-cli-")); made.push(dir); return join(dir, "calls.jsonl"); };
  afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
  const settings = (fake: FakeMoneybird) => ({ ERP_MONEYBIRD_TOKEN: fake.token, ERP_MONEYBIRD_ADMINISTRATION_ID: fake.admin });
  const go = (file: string, budget = "6") => ({ ERP_LIVE_GO: "yes", ERP_CALL_BUDGET: budget, ERP_CALL_LOG: file });
  const taxes = { ERP_MONEYBIRD_TAX_RATES: JSON.stringify({ NL21: TAX[0]!.id, NL9: TAX[1]!.id }), ERP_MONEYBIRD_IGNORE_COST_CENTRES: "on" };

  it("refuses every live command without the owner's go, the approved number of requests and the log that counts them", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    for (const cmd of ["pull", "sync", "correct"]) {
      for (const leftOut of ["ERP_LIVE_GO", "ERP_CALL_BUDGET", "ERP_CALL_LOG"]) {
        const env = { ...settings(fake), ...taxes, ...go(file), [leftOut]: undefined };
        await expect(run([cmd, "--connector", "moneybird", "--live", "--object", "invoice:INV-1"], env, fake.transport), `${cmd} without ${leftOut}`).rejects.toThrow(new RegExp(`a live run needs ${leftOut}.*nothing was called`));
      }
    }
    await expect(run(["sync", "--connector", "moneybird", "--live"], { ...settings(fake), ...taxes }, fake.transport)).rejects.toThrow(/ERP_LIVE_GO=yes.*ERP_CALL_BUDGET.*ERP_CALL_LOG.*nothing was called/);
    expect(fake.transport.sent).toHaveLength(0);
    expect(existsSync(file)).toBe(false);
    // The command itself refuses, however its connector is made: one handed in is never asked anything.
    const asked: string[] = [];
    const handedIn = new Proxy({ name: "moneybird" }, { get: (t, k) => (k === "name" ? t.name : async () => { asked.push(String(k)); return []; }) }) as unknown as ErpConnector;
    await expect(runErpCli(["pull", "--connector", "moneybird", "--live"], { db: openDb(":memory:"), env: settings(fake), out: () => {}, items, live: () => handedIn })).rejects.toThrow(/a live run needs ERP_LIVE_GO=yes/);
    expect(asked).toEqual([]);
  });

  it("pulls Moneybird's ledger accounts and tax rates with their ids before any tax rate is mapped: the map is made from this list", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    const { code, text } = await run(["pull", "--connector", "moneybird", "--live"], { ...settings(fake), ...go(file) }, fake.transport);
    expect(code).toBe(0);
    expect(text).toContain(`${LEDGER.length} accounts, 0 suppliers in Moneybird`);
    expect(text).toContain(`account 6200  Inkoop  (direct_costs; purchase invoices, journal entries)  [id ${LEDGER[0]!.id}]`);
    expect(text).toContain(`account -  Software  (expenses; purchase invoices)  [id ${LEDGER[4]!.id}]`);
    expect(text).toContain(`tax rate 21% btw (21.0%, purchase_invoice)  [id ${TAX[0]!.id}]`);
    // Three requests, each in the log before it left, and the count is said at the end.
    expect(readCallLog(file).map((l) => `${l.method} ${l.endpoint}`)).toEqual([
      `GET moneybird.com/api/v2/${fake.admin}/ledger_accounts.json`, `GET moneybird.com/api/v2/${fake.admin}/contacts.json`, `GET moneybird.com/api/v2/${fake.admin}/tax_rates.json`,
    ]);
    expect(fake.transport.sent).toHaveLength(3);
    expect(text).toMatch(/3 of 6 approved requests used/);
    expect(text).not.toContain(fake.token);
  });

  it("still refuses to send anything while the tax rates are not mapped", async () => {
    const fake = new FakeMoneybird();
    await expect(run(["sync", "--connector", "moneybird", "--live"], { ...settings(fake), ...go(callLog()) }, fake.transport)).rejects.toThrow(/Moneybird is not set up: missing ERP_MONEYBIRD_TAX_RATES/);
    expect(fake.transport.sent).toHaveLength(0);
  });

  it("stops a live command at the approved number and says how many were used", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    const lines: string[] = [];
    await expect(runErpCli(["pull", "--connector", "moneybird", "--live"], { db: openDb(":memory:"), env: { ...settings(fake), ...go(file, "2") }, out: (l) => lines.push(l), items, transport: fake.transport }))
      .rejects.toThrow(/call budget of 2 is spent.*tax_rates\.json was not sent/);
    expect(fake.transport.sent).toHaveLength(2);
    expect(lines.join("\n")).toMatch(/2 of 2 approved requests used/);
  });

  it("sends a live sync through the same count, and a second run sends nothing", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    const env = { ...settings(fake), ...taxes, ...go(file, "10") };
    const lines: string[] = [];
    const db = openDb(":memory:");
    const deps = { db, env, out: (l: string) => lines.push(l), items, transport: fake.transport };
    expect(await runErpCli(["sync", "--connector", "moneybird", "--live"], deps)).toBe(0);
    expect(lines.join("\n")).toMatch(/vendor\s+V-1\s+pushed/);
    expect(lines.join("\n")).toMatch(/6 of 10 approved requests used/);
    expect(readCallLog(file)).toHaveLength(6);
    expect(await runErpCli(["sync", "--connector", "moneybird", "--live"], deps)).toBe(0);
    expect(readCallLog(file)).toHaveLength(6);
    expect(fake.transport.sent).toHaveLength(6);
  });

  it("shows the call log by endpoint against the approved number, and calls nothing to do so", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    await run(["pull", "--connector", "moneybird", "--live"], { ...settings(fake), ...go(file) }, fake.transport);
    const { code, text } = await run(["calls"], { ERP_CALL_LOG: file, ERP_CALL_BUDGET: "44" }, fake.transport);
    expect(code).toBe(0);
    expect(text.split("\n")).toEqual([
      "3 of 44 approved requests used",
      `  1  GET moneybird.com/api/v2/${fake.admin}/ledger_accounts.json`,
      `  1  GET moneybird.com/api/v2/${fake.admin}/contacts.json`,
      `  1  GET moneybird.com/api/v2/${fake.admin}/tax_rates.json`,
    ]);
    expect((await run(["calls"], { ERP_CALL_LOG: file })).text.split("\n")[0]).toBe("3 requests in the call log (no ERP_CALL_BUDGET is set)");
    await expect(run(["calls"], {})).rejects.toThrow(/ERP_CALL_LOG is not set/);
    expect(fake.transport.sent).toHaveLength(3);
  });
});

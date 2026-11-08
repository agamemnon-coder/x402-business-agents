// npm run erp (src/erp/cli.ts): a dry run sends nothing and prints the requests without secrets; a live run needs the
// connector's settings and says --live; list names the missing settings, never a value.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { runErpCli } from "../src/erp/cli.js";
import type { SyncItem } from "../src/erp/sync.js";
import { sampleInvoice, samplePayment, sampleVendor } from "./fakes/erp.js";

const items = (): SyncItem[] => [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }, { kind: "payment", object: samplePayment() }];

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const lines: string[] = [];
  const db = openDb(":memory:");
  const code = await runErpCli(args, { db, env, out: (l) => lines.push(l), items });
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

  it("lists the connectors with the settings each still needs, and never a value", async () => {
    const { text } = await run(["list"], { ERP_ODOO_API_KEY: "secret-value-1", ERP_ODOO_URL: "https://x.odoo.com" });
    expect(text).toMatch(/exact\s+Exact Online: not set up \(missing ERP_EXACT_CLIENT_ID/);
    expect(text).toMatch(/odoo\s+Odoo: not set up \(missing ERP_ODOO_DB/);
    expect(text).not.toContain("secret-value-1");
  });
});

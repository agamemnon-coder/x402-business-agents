// Retention on the runner's ledger (src/compliance/retention.ts, docs/compliance/retention.md): every rule names a table
// the code creates, by a column it has, at the classification's level; the check finds the rows past their period,
// at the right instant (to 31 December of the seventh year for the books), and never deletes; the command reads the
// ledger read-only and exits 1 when anything is past its period; the page shows the rules as the code holds them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { blockOf } from "../src/compliance/controls.js";
import { inventory } from "../src/compliance/gdpr.js";
import { cutoff, RETENTION, retentionBlock, retentionCheck } from "../src/compliance/retention.js";
import { openDb } from "../src/db/open.js";
import { schemaTables } from "./support/schemaTables.js";

describe("the retention rules", () => {
  it("name tables the code creates, by a column they have, at the classification's level", () => {
    const tables = schemaTables();
    const level = new Map(inventory().flatMap((row) => row.tables.map((t) => [t, row.level] as const)));
    for (const r of RETENTION) {
      expect(tables.get(r.table)?.columns.has(r.at), `${r.table}.${r.at}`).toBe(true);
      expect(level.get(r.table), r.table).toBe(r.level);
    }
    expect(RETENTION.find((r) => r.table === "audit_log")?.keep).toEqual({ years_to_year_end: 7 });
  });

  it("keeps the books to 31 December of the seventh year, and a day's records a day", () => {
    const books = { years_to_year_end: 7 };
    // A row of 1 June 2019 is kept until 31 December 2026: past on 1 January 2027, not a moment before.
    expect(Date.parse("2019-06-01T00:00:00Z") < cutoff(books, new Date("2026-12-31T23:59:59Z")).getTime()).toBe(false);
    expect(Date.parse("2019-06-01T00:00:00Z") < cutoff(books, new Date("2027-01-01T00:00:00Z")).getTime()).toBe(true);
    expect(cutoff({ days: 1 }, new Date("2026-11-26T12:00:00Z")).toISOString()).toBe("2026-11-25T12:00:00.000Z");
  });

  it("reports the rows past their period and deletes nothing", () => {
    const db = openDb(":memory:");
    audit(db, "system", "reconcile.done", null, { checked: "1" }, new Date("2018-03-01T09:00:00Z"));
    audit(db, "system", "reconcile.done", null, { checked: "2" }, new Date("2026-11-01T09:00:00Z"));
    const before = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    const found = retentionCheck(db, new Date("2026-11-26T12:00:00Z"));
    expect(found.find((f) => f.table === "audit_log")).toMatchObject({ present: true, rows: before, past: 1, oldest_past: "2018-03-01T09:00:00.000Z" });
    expect(found.filter((f) => f.table !== "audit_log").every((f) => f.past === 0)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(before);
  });

  it("is on docs/compliance/retention.md as the code holds it", () => {
    expect(blockOf(readFileSync("docs/compliance/retention.md", "utf8"), "retention")).toBe(retentionBlock());
  });
});

describe("npm run retention -- --check", () => {
  const dir = mkdtempSync(join(tmpdir(), "purser-retention-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args: string[], env: Record<string, string>) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../src/cli/retention.ts"), ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: `${x.stdout}${x.stderr}` }; }
  };

  it("exits 0 with nothing past, 1 with something past, 2 without --check; the ledger is unchanged", () => {
    const ledger = join(dir, "ledger.sqlite");
    const db = openDb(ledger);
    audit(db, "system", "reconcile.done", null, { checked: "1" }, new Date("2020-03-01T09:00:00Z"));
    db.close();
    const before = readFileSync(ledger);
    expect(run(["--check", "--now", "2026-11-26T00:00:00Z"], { KIT11_DB: ledger })).toMatchObject({ code: 0, out: expect.stringMatching(/nothing is past its period/) });
    const later = run(["--check", "--now", "2028-01-01T00:00:00Z"], { KIT11_DB: ledger });
    expect(later.code, later.out).toBe(1);
    expect(later.out).toMatch(/PAST\s+audit_log/);
    expect(later.out).toMatch(/nothing is deleted/);
    expect(run([], { KIT11_DB: ledger }).code).toBe(2);
    expect(readFileSync(ledger).equals(before)).toBe(true);
  }, 60_000);
});

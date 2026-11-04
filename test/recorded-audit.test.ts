// The recorded run's audit log is in the repo (docs/audit/friday-1-audit.jsonl), so anyone can recompute its chain
// offline with `npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl`. Breaks if the export and the figures
// the pages show ("194 rows, chain intact") ever part ways, or if a row was edited.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyAuditRows, type AuditRowStored } from "../src/audit/log.js";

const rows = readFileSync("docs/audit/friday-1-audit.jsonl", "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRowStored);
const recorded = (JSON.parse(readFileSync("docs/demo/snapshot.json", "utf8")) as { snapshot: { audit: { rows: number; head: string; intact: boolean } } }).snapshot.audit;

describe("the recorded run's audit log", () => {
  it("recomputes to the chain head and row count the pages show", () => {
    const check = verifyAuditRows(rows);
    expect(check).toMatchObject({ ok: true, rows: recorded.rows, head: recorded.head });
    expect(recorded.intact).toBe(true);
  });
  it("fails on any edited row", () => {
    const edited = rows.map((r, i) => (i === 100 ? { ...r, payload_json: r.payload_json.replace(/\d/, "9") } : r));
    expect(verifyAuditRows(edited).ok).toBe(false);
  });
});

// A restore (cloud/src/restore.ts) refuses what is not a Purser Cloud export before it reads anything else, and a ledger
// row whose columns do not match its own signed body; a staged export is joined back in part order. Nothing is written
// on a refusal (the stand-in database and blob store throw if touched).
import { describe, expect, it } from "vitest";
import { importTenant, joinStagedExport, RestoreRefused, verifyChains } from "../cloud/src/restore.js";
import type { Blobs, Sql } from "../cloud/src/store.js";

const untouchable = new Proxy({}, { get: (_t, p) => () => { throw new Error(`touched: ${String(p)}`); } });
const sql = untouchable as Sql, blobs = untouchable as Blobs;
const target = { tenantId: "t_new", now: new Date("2026-11-20T10:00:00Z") };

describe("what a restore takes", () => {
  it("refuses anything but a v2 export, naming the format it got, before reading the database", async () => {
    for (const format of [undefined, "purser-cloud-export/v1", "purser-cloud-export/v3-staged"]) {
      const p = importTenant(sql, blobs, { format }, {}, target);
      await expect(p).rejects.toBeInstanceOf(RestoreRefused);
      await expect(importTenant(sql, blobs, { format }, {}, target)).rejects.toThrow(`not a Purser Cloud export (format ${JSON.stringify(format)})`);
    }
  });

  it("refuses a staged manifest of another format", () => {
    const manifest = { format: "purser-cloud-export/v2", tenant: {}, parts: [], documents_to_fetch: [] };
    expect(() => joinStagedExport(manifest, () => { throw new Error("must not read a part"); })).toThrow(RestoreRefused);
    expect(() => joinStagedExport(manifest, () => [])).toThrow('not a staged Purser Cloud export (format "purser-cloud-export/v2")');
  });

  it("joins a staged export's parts back per table, in part order, whatever order the manifest lists them in", () => {
    const parts: Record<string, unknown[]> = { "invoices-2": [{ id: "AP-3" }], "invoices-1": [{ id: "AP-1" }, { id: "AP-2" }], "vendors-3": [{ id: "v1" }] };
    const read: string[] = [];
    const out = joinStagedExport({ format: "purser-cloud-export/v3-staged", tenant: { id: "t" }, parts: [{ table: "vendors", n: 3 }, { table: "invoices", n: 2 }, { table: "invoices", n: 1 }], documents_to_fetch: ["d1"] },
      (name) => { read.push(name); return parts[name]!; });
    expect(read).toEqual(["invoices-1", "invoices-2", "vendors-3"]);
    expect(out).toEqual({ format: "purser-cloud-export/v2", tenant: { id: "t" }, invoices: [{ id: "AP-1" }, { id: "AP-2" }, { id: "AP-3" }], vendors: [{ id: "v1" }], documents_to_fetch: ["d1"] });
  });
});

describe("the ledger chain in a backup", () => {
  it("an export with no rows at all verifies", async () => {
    expect(await verifyChains({})).toBeNull();
  });

  it("refuses a ledger row whose columns differ from its body: the id, the previous hash or its own hash", async () => {
    const body = { entry_id: 1, prev_hash: "0".repeat(64), entry_hash: "a".repeat(64) };
    const row = (over: Record<string, unknown>) => ({ ...body, entry_json: JSON.stringify(body), ...over });
    expect(await verifyChains({ ledger_entries: [row({ entry_id: 2 })] })).toBe("ledger entry 2: its columns differ from its body");
    expect(await verifyChains({ ledger_entries: [row({ prev_hash: "f".repeat(64) })] })).toBe("ledger entry 1: its columns differ from its body");
    expect(await verifyChains({ ledger_entries: [row({ entry_hash: "b".repeat(64) })] })).toBe("ledger entry 1: its columns differ from its body");
  });

  it("refuses a ledger row that agrees with its body but not with the chain", async () => {
    const body = { entry_id: 1, prev_hash: "0".repeat(64), entry_hash: "a".repeat(64) };
    expect(await verifyChains({ ledger_entries: [{ ...body, entry_json: JSON.stringify(body) }] })).toMatch(/^ledger chain: /);
  });
});

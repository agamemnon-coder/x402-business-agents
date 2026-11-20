// The small parts around the engine in the cloud: the module the Worker's build swaps for packages it cannot carry
// (cloud/src/engine/stub.ts), Claude's access when there is no key and when the demo's tables are not there
// (claudeAccess.ts, tryClaude.ts, spend.ts), the archive over a document store without a cheap existence check
// (vaultR2.ts), and an object whose engine throws something that is not an Error (object.ts).
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import { claudeAccess } from "../cloud/src/engine/claudeAccess.js";
import { d1Spend } from "../cloud/src/engine/spend.js";
import stub, { chromium } from "../cloud/src/engine/stub.js";
import { tryClaudeAccess } from "../cloud/src/engine/tryClaude.js";
import { blobVault } from "../cloud/src/engine/vaultR2.js";
import { sqliteSql } from "../cloud/src/node.js";
import type { Blobs } from "../cloud/src/store.js";
import { actionBudget } from "../src/engine/budget.js";
import { sqliteDoStorage } from "./support/doStorage.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} } }));
vi.mock("../cloud/src/engine/hostWorker.js", () => ({
  openHost: async () => ({ api: { status: async () => { throw "the engine said no"; } } }),
}));

describe("the stand-in for a package the Worker's build leaves out", () => {
  it("loads, is not taken for a promise, and says what it is when anything of it is used", () => {
    const s = stub as Record<string, unknown> & ((...a: unknown[]) => unknown);
    expect(s.then).toBeUndefined();
    expect(() => (s.launch as () => unknown)()).toThrow("launch is not part of the Worker build: cloud/wrangler.jsonc swaps the package for cloud/src/engine/stub.ts");
    expect(() => s()).toThrow(/^this package is not part of the Worker build/);
    expect(() => new (s as unknown as new () => unknown)()).toThrow(/^this package is not part of the Worker build/);
    expect(chromium).toBe(stub);
    expect(() => ((chromium as Record<string, () => unknown>).launch!)()).toThrow(/^launch is not part/);
  });
});

describe("Claude's access for a company's engine", () => {
  it("the payables agents get a budgeted client with the key, and none without", async () => {
    const sql = sqliteSql(":memory:");
    await ensureSchema(sql);
    const withKey = claudeAccess({ engineClaude: "on", key: "stand-in-not-a-key", sql, tenantId: "t_a" })!;
    expect(withKey.agents(actionBudget(1_000))).not.toBeNull();
    const without = claudeAccess({ engineClaude: "on", key: undefined, sql, tenantId: "t_a" })!;
    expect(without.agents(actionBudget(1_000))).toBeNull();
    sql.close();
  });

  it("without the demo's tables (no switches, no pool) Claude stays off: nothing is reserved, and the status says so", async () => {
    const sql = sqliteSql(":memory:");
    const a = tryClaudeAccess({ ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "stand-in-not-a-key" }, sql, "t_nodemo1")!;
    expect(await a.reserve()).toEqual({ ok: false, reason: "switch_off" });
    // Its spend table is not there either: the status cannot be read, and that is an error, not a yes.
    await expect(a.status()).rejects.toThrow(/no such table/);
    sql.close();
  });

  it("the switch on with no company cap set: no cap, and Claude does not read", async () => {
    const sql = sqliteSql(":memory:");
    await ensureSchema(sql);
    expect(await d1Spend(sql, { claude: "on" }, { tenantId: "t_a", pool: "smoke", address: null }).status()).toEqual({ on: false, cap_micros: null, spent_micros: 0 });
    sql.close();
  });
});

describe("the archive over a document store", () => {
  /** A document store without has(): the archive asks get() whether a file is there. */
  function store(): Blobs & { meta: Map<string, Record<string, string> | undefined> } {
    const kept = new Map<string, Uint8Array>();
    const meta = new Map<string, Record<string, string> | undefined>();
    return {
      meta,
      put: async (k, b, m) => { kept.set(k, b); meta.set(k, m); },
      get: async (k) => kept.get(k) ?? null,
      delete: async (k) => { kept.delete(k); },
      list: async (p) => [...kept.keys()].filter((k) => k.startsWith(p)),
    };
  }
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

  it("creates a file once, a PDF unless told otherwise; a second create of the same path is refused; a missing file reads as nothing", async () => {
    const s = store();
    const v = blobVault(s, "t_archive01");
    const bytes = new TextEncoder().encode("%PDF-1.4 x");
    await v.create("2026/a.pdf", bytes, sha(bytes));
    expect(s.meta.get("t/t_archive01/vault/2026/a.pdf")).toEqual({ sha256: sha(bytes), mime: "application/pdf" });
    await expect(v.create("2026/a.pdf", bytes, sha(bytes))).rejects.toThrow("2026/a.pdf is already in the vault");
    await v.create("2026/b.csv", bytes, sha(bytes), "text/csv");
    expect(s.meta.get("t/t_archive01/vault/2026/b.csv")).toMatchObject({ mime: "text/csv" });
    expect(Buffer.from((await v.read!("2026/a.pdf"))!).toString()).toBe("%PDF-1.4 x");
    expect(await v.read!("2026/none.pdf")).toBeNull();
    expect(await v.stat("2026/none.pdf")).toBeNull();
    expect(await v.readIndex("2026/index.json")).toBeNull();
  });
});

describe("a company's Durable Object whose engine throws something that is not an Error", () => {
  it("answers it as data, in words", async () => {
    const storage = { ...sqliteDoStorage(new Database(":memory:")), deleteAll: async () => undefined };
    const { CompanyEngine } = await import("../cloud/src/engine/object.js");
    const o = new (CompanyEngine as unknown as new (ctx: unknown, env: unknown) => { call(t: string, m: string, a: unknown[]): Promise<unknown> })({ storage }, {});
    expect(await o.call("t_object01", "status", [])).toEqual({ ok: false, error: "the engine said no" });
  });
});

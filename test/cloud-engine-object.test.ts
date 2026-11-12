// The thin parts around the engine in a Durable Object, in plain Node: the object's own rules (cloud/src/engine/object.ts:
// whose engine it is, loading the engine on first use, an answer that is always data, the wipe), the Worker's stub
// of it (cloud/src/engine/client.ts) and the documents in 1 MB pieces (cloud/src/engine/docChunks.ts). The object's
// storage is the stand-in of test/support/doStorage.ts and the engine behind it is a stand-in too; the real engine in
// a real object runs in test/cloud-engine-workerd.test.ts (npm run test:d1).
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_METHODS, type EngineApi } from "../cloud/src/engine/api.js";
import { engineStubs, type EngineNamespace } from "../cloud/src/engine/client.js";
import { docChunks } from "../cloud/src/engine/docChunks.js";
import type { EngineAnswer } from "../cloud/src/engine/object.js";
import { sqliteDoStorage } from "./support/doStorage.js";

// The Workers runtime's base class: it keeps what it is constructed with.
vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} } }));

/** The engine's host as the object loads it: a stand-in that records how it was opened and answers a few actions. */
const host = vi.hoisted(() => ({ loads: 0, opened: [] as string[], failNextOpen: false, gate: null as Promise<void> | null }));
vi.mock("../cloud/src/engine/hostWorker.js", () => {
  host.loads++;
  return {
    openHost: async (_ctx: unknown, _env: unknown, tenantId: string) => {
      if (host.failNextOpen) { host.failNextOpen = false; throw new Error("the engine did not start"); }
      host.opened.push(tenantId);
      return { api: {
        status: async () => ({ mode: "test_money", for: tenantId }),
        invoice: async (id: string) => (id === "AP-0001" ? { id } : null),
        upload: async (doc: { bytes: Uint8Array; filename: string }) => {
          if (!doc.filename.endsWith(".pdf")) throw new Error(`${doc.filename} is not a PDF, a photo (JPEG or PNG) or an e-mail (.eml); nothing was filed`);
          return { kind: "invoice", sha256: createHash("sha256").update(doc.bytes).digest("hex"), invoice: null };
        },
        sync: async () => { await host.gate; return { fed: true }; },
      } };
    },
  };
});

interface TestStorage extends ReturnType<typeof sqliteDoStorage> { deleteAll(): Promise<void>; wiped: number }
interface TestObject { call(tenantId: string, method: keyof EngineApi, args: unknown[]): Promise<EngineAnswer> }

function storage(): { storage: TestStorage; db: Database.Database } {
  const db = new Database(":memory:");
  const s = sqliteDoStorage(db) as TestStorage;
  s.wiped = 0;
  s.deleteAll = async () => {
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) db.exec(`DROP TABLE "${t.name}"`);
    s.wiped++;
  };
  return { storage: s, db };
}

async function object(s: TestStorage): Promise<TestObject> {
  const { CompanyEngine } = await import("../cloud/src/engine/object.js");
  return new (CompanyEngine as unknown as new (ctx: unknown, env: unknown) => TestObject)({ storage: s }, {});
}

const A = "t_alphaalpha01", B = "t_bravobravo02";

beforeEach(() => { host.opened = []; host.failNextOpen = false; host.gate = null; });

describe("a company's engine object", () => {
  it("loads the engine on the first engine call, not before, and opens it once", async () => {
    const { storage: s } = storage();
    const o = await object(s);
    expect(host.loads).toBe(0);
    const [one, two] = await Promise.all([o.call(A, "status", []), o.call(A, "invoice", ["AP-0001"])]);
    expect(one).toEqual({ ok: true, value: { mode: "test_money", for: A } });
    expect(two).toEqual({ ok: true, value: { id: "AP-0001" } });
    expect(await o.call(A, "invoice", ["AP-0404"])).toEqual({ ok: true, value: null });
    expect(host.loads).toBe(1);
    expect(host.opened).toEqual([A]);
  });

  it("is the first company's that calls it: the id is kept in the object's own table, and another company is refused", async () => {
    const { storage: s, db } = storage();
    const o = await object(s);
    expect((await o.call(A, "status", [])).ok).toBe(true);
    expect(db.prepare("SELECT key, value FROM do_state").all()).toEqual([{ key: "tenant", value: A }]);
    expect(await o.call(B, "status", [])).toEqual({ ok: false, error: "this engine is another company's" });
    expect(await o.call(B, "wipe", [])).toEqual({ ok: false, error: "this engine is another company's" });
    expect(await o.call("", "status", [])).toEqual({ ok: false, error: "the engine is one company's: its id is needed" });
    expect(s.wiped).toBe(0);
    // After the object's memory was dropped, the same storage still says whose it is.
    const again = await object(s);
    expect(await again.call(B, "status", [])).toEqual({ ok: false, error: "this engine is another company's" });
    expect(await again.call(A, "status", [])).toEqual({ ok: true, value: { mode: "test_money", for: A } });
    expect(host.opened).toEqual([A, A]);
  });

  it("passes on only the engine's own actions", async () => {
    const o = await object(storage().storage);
    for (const name of ["constructor", "open", "pin", "toString", "", "__proto__"]) {
      expect(await o.call(A, name as keyof EngineApi, []), name).toEqual({ ok: false, error: "not an action of the engine" });
    }
    expect(await o.call(A, "status", "x" as unknown as unknown[])).toEqual({ ok: false, error: "not an action of the engine" });
    expect(host.opened).toEqual([]);
  });

  it("answers with data also when the engine refuses: the engine's words arrive unchanged", async () => {
    const o = await object(storage().storage);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    expect(await o.call(A, "upload", [{ bytes, filename: "x.pdf" }])).toEqual({ ok: true, value: { kind: "invoice", sha256: createHash("sha256").update(bytes).digest("hex"), invoice: null } });
    expect(await o.call(A, "upload", [{ bytes, filename: "notes.txt" }])).toEqual({ ok: false, error: "notes.txt is not a PDF, a photo (JPEG or PNG) or an e-mail (.eml); nothing was filed" });
  });

  it("does not keep a start that failed: the next call opens the engine again", async () => {
    const o = await object(storage().storage);
    host.failNextOpen = true;
    expect(await o.call(A, "status", [])).toEqual({ ok: false, error: "the engine did not start" });
    expect(await o.call(A, "status", [])).toEqual({ ok: true, value: { mode: "test_money", for: A } });
    expect(host.opened).toEqual([A]);
  });

  it("wipes after the calls that are still running, forgets the engine and whose it was, and starts anew", async () => {
    const { storage: s, db } = storage();
    const o = await object(s);
    let release = () => {};
    host.gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const syncing = o.call(A, "sync", []).then((x) => { order.push("sync"); return x; });
    const wiping = o.call(A, "wipe", []).then((x) => { order.push("wipe"); return x; });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.wiped).toBe(0);
    release();
    expect(await syncing).toEqual({ ok: true, value: { fed: true } });
    expect(await wiping).toEqual({ ok: true, value: undefined });
    expect(order).toEqual(["sync", "wipe"]);
    expect(s.wiped).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 0 });
    // The next call opens a new engine over the emptied storage.
    host.gate = null;
    expect(await o.call(A, "status", [])).toEqual({ ok: true, value: { mode: "test_money", for: A } });
    expect(host.opened).toEqual([A, A]);
    expect(db.prepare("SELECT value FROM do_state WHERE key = 'tenant'").get()).toEqual({ value: A });
  });
});

describe("the Worker's stub of a company's engine", () => {
  const calls: { name: string; tenantId: string; method: string; args: unknown[] }[] = [];
  let answer: EngineAnswer = { ok: true, value: 1 };
  const ns: EngineNamespace = {
    idFromName: (name) => ({ name }),
    get: (id) => ({ call: async (tenantId, method, args) => { calls.push({ name: (id as { name: string }).name, tenantId, method, args }); return answer; } }),
  };

  it("has every action of the interface, each one call across the stub with the company's id", async () => {
    const engine = engineStubs(ns)(A);
    expect(Object.keys(engine).sort()).toEqual([...ENGINE_METHODS].sort());
    expect(ENGINE_METHODS).toHaveLength(16);
    answer = { ok: true, value: { items: [], next: 7 } };
    expect(await engine.events(7, 50)).toEqual({ items: [], next: 7 });
    const bytes = new Uint8Array([1, 2, 3]);
    answer = { ok: true, value: { kind: "invoice", sha256: "x", invoice: null } };
    await engine.upload({ bytes, filename: "a.pdf" });
    expect(calls).toEqual([
      { name: A, tenantId: A, method: "events", args: [7, 50] },
      { name: A, tenantId: A, method: "upload", args: [{ bytes, filename: "a.pdf" }] },
    ]);
  });

  it("throws what the object refused, in the object's words", async () => {
    answer = { ok: false, error: "notes.txt is not a PDF; nothing was filed" };
    await expect(engineStubs(ns)(B).upload({ bytes: new Uint8Array(), filename: "notes.txt" })).rejects.toThrow(/^notes\.txt is not a PDF; nothing was filed$/);
  });
});

describe("a company's documents in its object's SQLite", () => {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const filled = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i += 97) b[i] = (i * 31) & 255; return b; };

  it("keeps a document in pieces of 1 MB and gives the same bytes back", () => {
    const db = new Database(":memory:");
    const docs = docChunks(sqliteDoStorage(db));
    const big = filled(2 * 1024 * 1024 + 4321);
    const path = docs.put(sha(big), big);
    expect(path).toBe(`do:${sha(big)}`);
    expect(db.prepare("SELECT n, length(bytes) AS bytes FROM do_doc_chunks WHERE sha256 = ? ORDER BY n").all(sha(big))).toEqual([{ n: 0, bytes: 1048576 }, { n: 1, bytes: 1048576 }, { n: 2, bytes: 4321 }]);
    expect(docs.get(path).equals(big)).toBe(true);
    // Exactly one piece's worth is one piece; a small file is one piece.
    const exact = filled(1024 * 1024), small = filled(10);
    expect(docs.get(docs.put(sha(exact), exact)).equals(exact)).toBe(true);
    expect(docs.get(docs.put(sha(small), small)).equals(small)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM do_doc_chunks WHERE sha256 IN (?, ?)").get(sha(exact), sha(small))).toEqual({ n: 2 });
  });

  it("takes any view of the bytes, keeps a document once, and has no document it was not given", () => {
    const db = new Database(":memory:");
    const docs = docChunks(sqliteDoStorage(db), 4);
    // A view in the middle of a larger buffer, as a pooled Buffer or a decoded upload is.
    const whole = Uint8Array.from([9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 9]);
    const view = whole.subarray(3, 13);
    const path = docs.put(sha(view), view);
    expect([...docs.get(path)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM do_doc_chunks").get()).toEqual({ n: 3 });
    expect(docs.put(sha(view), view)).toBe(path);
    expect(db.prepare("SELECT COUNT(*) AS n FROM do_doc_chunks").get()).toEqual({ n: 3 });
    expect(() => docs.get(`do:${"0".repeat(64)}`)).toThrow(/^no document at do:0{64}$/);
    expect(() => docs.get(`/payables/docs/${sha(view)}.pdf`)).toThrow(/no document at/);
  });
});

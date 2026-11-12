// The transactions register in Purser Cloud: pushed with the rest, idempotent, served newest first with filters and a
// cursor, one row by id with its versions, totals and checks, an export equal to the list, read scope only, another
// company sees nothing, and every error in one shape.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { transactionRegister } from "../src/money/register.js";
import { moneyWorld } from "./fakes/moneyWorld.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const NOW = new Date("2026-11-09T10:00:00Z");
let c: TestCloud;
let db: DB;
let tenant: { id: string; key: string; owner: string };
const target = () => ({ url: "https://cloud.test", key: tenant.key, fetch: c.fetch });
const get = async (p: string, key = tenant.key) => c.req("GET", p, { key });

beforeEach(async () => {
  c = testCloud();
  db = openDb(":memory:");
  moneyWorld(db);
  tenant = await c.tenant("northwind");
});
afterEach(() => c.close());

describe("the transactions register in the cloud", () => {
  it("arrives with a push, once; the runner's ledger is synced first, so the rows arrive reconciled", async () => {
    const first = await pushToCloud(db, target(), NOW) as { applied: Record<string, { added: number; changed: number; unchanged: number }> }[];
    const local = transactionRegister(db);
    expect(first[0]!.applied.transactions!.added).toBe(local.rows.length);
    const list = (await get("/v1/transactions?limit=200")).json as { items: { id: string; reconciliation: string }[] };
    expect(list.items.map((r) => r.id)).toEqual(local.rows.map((r) => r.id));
    expect(list.items.find((r) => r.id === "transfer:req-1")!.reconciliation).toBe("matched");
    const again = await pushToCloud(db, target(), NOW) as { applied: Record<string, { added: number; changed: number }> }[];
    expect(again[0]!.applied.transactions).toMatchObject({ added: 0, changed: 0 });
  });

  it("filters, pages newest first with a cursor, and keeps a row's earlier version", async () => {
    await pushToCloud(db, target(), NOW);
    const p1 = (await get("/v1/transactions?limit=3")).json as { items: { id: string; at: string }[]; next_cursor: string };
    const p2 = (await get(`/v1/transactions?limit=3&cursor=${encodeURIComponent(p1.next_cursor)}`)).json as { items: { id: string; at: string }[] };
    expect(p1.items).toHaveLength(3);
    expect(p2.items[0]!.at <= p1.items[2]!.at).toBe(true);
    expect(new Set([...p1.items, ...p2.items].map((r) => r.id)).size).toBe(6);
    const cards = (await get("/v1/transactions?rail=airwallex_card&moved=false")).json as { items: { id: string }[] };
    expect(cards.items.map((r) => r.id)).toEqual(["card:ctx_2"]);
    const day = (await get("/v1/transactions?from=2026-11-06&to=2026-11-06")).json as { items: { id: string }[] };
    expect(day.items.map((r) => r.id).sort()).toEqual(["card:ctx_1", "card:ctx_2"]);
    db.prepare("UPDATE transfers SET status = 'FAILED' WHERE request_id = 'req-3'").run();
    await pushToCloud(db, target(), NOW);
    const one = (await get(`/v1/transactions/${encodeURIComponent("transfer:req-3")}`)).json as { moved: boolean; version: number; earlier_versions: unknown[] };
    expect(one).toMatchObject({ moved: false, version: 2 });
    expect(one.earlier_versions).toHaveLength(1);
  });

  it("gives the same totals and checks as the runner, and an export equal to the list", async () => {
    await pushToCloud(db, target(), NOW);
    const local = transactionRegister(db);
    const s = (await get("/v1/transactions/summary")).json as { totals: unknown; check: { without_approval: string[]; unreconciled: number } };
    expect(s.totals).toEqual(local.totals);
    expect(s.check.without_approval).toEqual(local.check.without_approval);
    expect(s.check.unreconciled).toBe(local.check.unreconciled);
    const csv = await get("/v1/transactions/export.csv");
    expect(csv.res.headers.get("content-type")).toMatch(/text\/csv/);
    const lines = (await csv.res.text()).trimEnd().split("\r\n");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(local.rows.map((r) => r.id));
  });

  it("needs the read scope, and shows another company nothing", async () => {
    await pushToCloud(db, target(), NOW);
    const syncOnly = (await c.req("POST", "/v1/keys", { key: tenant.key, body: { name: "runner", scopes: ["sync"] } })).json.api_key as string;
    const refused = await get("/v1/transactions", syncOnly);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "forbidden" });
    const other = await c.tenant("someone-else");
    expect(((await get("/v1/transactions", other.key)).json as { items: unknown[] }).items).toEqual([]);
    const theirs = await get(`/v1/transactions/${encodeURIComponent("transfer:req-1")}`, other.key);
    expect(theirs.status).toBe(404);
    expect(theirs.json).toEqual({ error: "no transaction", code: "not_found" });
    expect(((await get("/v1/transactions/summary", other.key)).json as { totals: unknown[] }).totals).toEqual([]);
  });

  it("answers a bad filter with one error shape", async () => {
    for (const q of ["rail=DROP%20TABLE", "currency=euro", "reconciliation=fine", "moved=maybe", "from=yesterday"]) {
      const r = await get(`/v1/transactions?${q}`);
      expect([q, r.status, r.json.code]).toEqual([q, 400, "bad_request"]);
      expect(typeof r.json.error).toBe("string");
    }
    expect((await c.req("GET", "/v1/no-such-thing", { key: tenant.key })).json).toEqual({ error: "no such route", code: "not_found" });
    expect((await c.req("GET", "/v1/transactions")).json).toMatchObject({ code: "unauthorized" });
  });
});

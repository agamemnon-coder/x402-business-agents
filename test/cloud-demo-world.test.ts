// The demo world's seed.sql on the database it is made for. With `npm run test:d1` this file runs on local D1 (workerd,
// test/support/d1.ts): the schema, then every statement of the seed as `wrangler d1 execute --file` sends them, one by
// one; then the cloud's own handler reads the world back in demo mode. In the plain run the same happens on
// better-sqlite3. No network. The world itself is checked in test/demo-world.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle, type CloudEnv } from "../cloud/src/app.js";
import { demoEnv } from "../cloud/src/demo.js";
import { sqliteSql } from "../cloud/src/node.js";
import { SCHEMA } from "../cloud/src/schema.js";
import { d1Sql, type Sql } from "../cloud/src/store.js";
import { localDemo, type LocalDemo } from "../src/demoworld/bundle.js";
import { worldSql } from "../src/demoworld/cloud.js";

let dir: string;
let built: LocalDemo;
beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "demo-seed-"));
  built = await localDemo(dir);
}, 120_000);
afterAll(() => { built?.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the demo world's seed.sql, on the cloud's own database", () => {
  it("loads statement by statement into a database that holds only the schema, twice, and the demo reads the world from it", async () => {
    const d1 = globalThis.__cloudD1?.next();
    const lite = d1 ? null : sqliteSql(":memory:");
    const sql: Sql = d1 ? d1Sql(d1) : lite!;
    try {
      await sql.exec(SCHEMA);
      const ids = built.companies.map((c) => c.tenant_id);
      const text = await worldSql(built.env.sql, ids);
      const statements = text.split("\n").filter((l) => l && !l.startsWith("--"));
      expect(statements.length).toBeGreaterThan(500);
      for (let round = 0; round < 2; round++) {
        for (const s of statements) await sql.run(s.replace(/;$/, ""));
        expect(await worldSql(sql, ids)).toBe(text);
      }
      // The same answers as the world it was written from, through the demo's own read routes.
      const env: CloudEnv = { ...built.env, sql, demo: demoEnv(built.companies.map((c) => c.slug)) };
      const get = async (e: CloudEnv, path: string) => {
        const r = await handle(new Request(`${e.origin}${path}`), e);
        expect(r.status, path).toBe(200);
        return r.json() as Promise<unknown>;
      };
      expect(await get(env, "/v1/demo/companies")).toEqual(await get(built.env, "/v1/demo/companies"));
      for (const c of built.companies) {
        for (const read of ["invoices", "vendors", "payments", "transactions", "transactions/summary", "ledger/entries", "reports/trial", "reports/payables", "insights"]) {
          expect(await get(env, `/v1/demo/${c.slug}/${read}`), `${c.slug} ${read}`).toEqual(await get(built.env, `/v1/demo/${c.slug}/${read}`));
        }
        const doc = await handle(new Request(`${env.origin}/v1/demo/${c.slug}/invoices/${c.states.paid}/document`), env);
        expect(doc.status).toBe(200);
      }
      expect(await get(env, "/v1/health")).toMatchObject({ ok: true, demo_companies: 3 });
    } finally {
      lite?.close();
    }
  }, 120_000);
});

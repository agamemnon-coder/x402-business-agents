// The Durable Object handle (src/db/doSql.ts) inside a real SQLite-backed Durable Object: the checks of
// test/support/dbConformance.ts run in local workerd (through Miniflare) and their answers are compared, line by line,
// with better-sqlite3's in this process. test/db-do-sql.test.ts makes the same comparison over a stand-in in plain Node.
//
// Runs only with CLOUD_DB=d1 (npm run test:d1), where wrangler's toolchain is installed (npm ci --prefix worker), as
// test/support/d1.ts does for D1. Local only: no network and no Cloudflare account (cf: false stops Miniflare's one
// request of its own; the object's storage is in memory and thrown away).
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conformance, KNOWN_DIFFERENCE } from "./support/dbConformance.js";

interface Workerd { dispatchFetch(url: string): Promise<{ status: number; text(): Promise<string> }>; dispose(): Promise<void> }
interface MiniflareModule { Miniflare: new (options: unknown) => Workerd; convertV4MiniflareOptions(options: Record<string, unknown>): unknown }
interface Esbuild { build(options: Record<string, unknown>): Promise<unknown> }

const D1 = process.env.CLOUD_DB === "d1";

describe("the engine's handle inside a SQLite-backed Durable Object (local workerd)", () => {
  if (!D1) {
    it.skip("skipped in the plain run: it needs wrangler's toolchain and runs with npm run test:d1", () => undefined);
    return;
  }

  const node = conformance(new Database(":memory:"));
  let dir: string;
  let workerd: Workerd | undefined;
  let object: [string, string][] = [];

  beforeAll(async () => {
    // wrangler is pinned in worker/ (the relay's toolchain); Miniflare and esbuild are the ones wrangler itself uses.
    const wrangler = createRequire(createRequire(resolve("worker/package.json")).resolve("wrangler"));
    const { Miniflare, convertV4MiniflareOptions } = wrangler("miniflare") as MiniflareModule;
    const esbuild = wrangler("esbuild") as Esbuild;
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "do-conformance-"));
    const outfile = join(dir, "worker.js");
    // No Node module is left external: if the handle or the checks imported one, this build would fail.
    await esbuild.build({ entryPoints: [resolve("test/support/doConformanceWorker.ts")], outfile, bundle: true, format: "esm", platform: "browser", target: "es2024", conditions: ["workerd", "worker", "browser"], logLevel: "silent" });
    workerd = new Miniflare(convertV4MiniflareOptions({
      cf: false,
      host: "127.0.0.1",
      port: 0,
      verbose: false,
      name: "do-conformance",
      modules: [{ type: "ESModule", path: outfile }],
      modulesRoot: dir,
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { CONFORMANCE: { className: "ConformanceObject", useSQLite: true } },
    }));
    const res = await workerd.dispatchFetch("http://localhost/conformance");
    const text = await res.text();
    if (res.status !== 200) throw new Error(`the Durable Object answered ${res.status}: ${text.slice(0, 400)}`);
    object = (JSON.parse(text) as { rows: [string, string][] }).rows;
  });

  afterAll(async () => {
    await workerd?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("ran all 76 checks in the object, in the same order", () => {
    expect(node).toHaveLength(76);
    expect(object.map(([label]) => label)).toEqual(node.map(([label]) => label));
  });

  for (const [i, [label, answer]] of node.entries()) {
    if (label === KNOWN_DIFFERENCE) continue;
    it(`answers as better-sqlite3 does: ${label}`, () => { expect(object[i]?.[1]).toBe(answer); });
  }

  it("75 of 76 are equal; the one difference is binding a bigint (the engine binds none)", () => {
    const differing = node.filter(([, answer], i) => object[i]?.[1] !== answer).map(([label]) => label);
    expect(differing).toEqual([KNOWN_DIFFERENCE]);
    expect(node.length - differing.length).toBe(75);
    const i = node.findIndex(([label]) => label === KNOWN_DIFFERENCE);
    expect(object[i]?.[1]).toMatch(/^THROWS TypeError .*bigint cannot be bound/);
  });
});

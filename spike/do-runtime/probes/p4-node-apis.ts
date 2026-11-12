// SPIKE probe 4: the Node built-ins the engine's module graph touches, inside workerd: AsyncLocalStorage as
// src/provenance/origin.ts uses it, node:fs against bundled text, node:path, node:url, child_process, worker_threads.
import { DurableObject } from "cloudflare:workers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as os from "node:os";
import { createRequire } from "node:module";
import { constants, inflateSync, deflateSync } from "node:zlib";
import schemaSql from "../../../src/db/schema.sql";
import ledgerSql from "../../../src/db/ledger.sql";
import { currentOrigin, withOrigin, type Origin } from "../../../src/provenance/origin.js";
import { json, sha256, steps } from "./_util.js";

export class Engine extends DurableObject {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    // AsyncLocalStorage through the engine's own module.
    await step("als_origin_across_awaits", async () => {
      const a: Origin = { actor: "agent", agent: "treasury", model: "claude-sonnet-5-5", request_id: "req_a", run_id: "run-a" };
      const b: Origin = { actor: "cfo", proposal_id: "P-1", approval_id: "A-1", method: "passkey", approver: "cfo" };
      const seen = await Promise.all([
        withOrigin(a, async () => { await sleep(5); await fetch("data:text/plain,x").catch(() => undefined); return currentOrigin(); }),
        withOrigin(b, async () => { await sleep(1); return currentOrigin(); }),
      ]);
      const nested = await withOrigin(a, async () => { const inner = await withOrigin(b, async () => { await sleep(1); return currentOrigin(); }); return { inner, outerAfter: currentOrigin() }; });
      return { a_kept: (seen[0] as { actor?: string } | null)?.actor === "agent", b_kept: (seen[1] as { actor?: string } | null)?.actor === "cfo", outside: currentOrigin() ?? null, nested_inner: (nested.inner as { actor?: string } | null)?.actor, nested_outer_after: (nested.outerAfter as { actor?: string } | null)?.actor };
    });
    await step("planContext_als_loads", async () => Object.keys(await import("../../../src/payouts/planContext.js")));

    // Text the engine reads from disk at start (src/db/open.ts: schema.sql, ledger.sql): bundled as text modules instead.
    await step("sql_as_bundled_text", async () => ({ schema_chars: schemaSql.length, schema_sha256: await sha256(schemaSql), ledger_chars: ledgerSql.length, ledger_sha256: await sha256(ledgerSql) }));
    await step("import_meta_url", () => ({ value: import.meta.url ?? null }));
    await step("fs_what_exists", () => ({ root: fs.readdirSync("/"), bundle: fs.readdirSync("/bundle").slice(0, 12), tmp: fs.readdirSync("/tmp") }));
    await step("fs_read_bundled_sql_by_path", () => fs.readdirSync("/bundle").filter((f) => f.endsWith(".sql")).map((f) => ({ f, chars: fs.readFileSync(`/bundle/${f}`, "utf8").length })));
    await step("fs_write_tmp_then_read", () => { fs.mkdirSync("/tmp/ap/docs", { recursive: true }); fs.writeFileSync("/tmp/ap/docs/abc.pdf", new Uint8Array([37, 80, 68, 70]), { mode: 0o444 }); return { back: [...fs.readFileSync("/tmp/ap/docs/abc.pdf")], exists: fs.existsSync("/tmp/ap/docs/abc.pdf") }; });
    // Exactly what src/ap/inbox.ts does to keep a document (lines 105-109), then what pay.ts and detail.ts do to read it.
    await step("fs_inbox_style_document_store_on_tmp", () => {
      const docs = path.join("/tmp/ap", "docs"), file = path.join(docs, "0f0f.pdf");
      fs.mkdirSync(docs, { recursive: true });
      if (!fs.existsSync(file)) { fs.writeFileSync(file, new Uint8Array([37, 80, 68, 70, 45]), { flag: "wx" }); fs.chmodSync(file, 0o444); }
      let second = "";
      try { fs.writeFileSync(file, new Uint8Array([1]), { flag: "wx" }); second = "overwrote"; } catch (e) { second = `refused: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message.slice(0, 60)}`; }
      return { read_back: Buffer.from(fs.readFileSync(file)).toString("latin1"), second_write_wx: second, size: fs.statSync(file).size };
    });
    await step("fs_tmp_from_an_earlier_request", () => ({ marker_exists: fs.existsSync("/tmp/marker-from-first-request") }));
    await step("fs_leave_marker", () => { fs.writeFileSync("/tmp/marker-from-first-request", "x"); return "written"; });
    await step("fs_write_outside_tmp", () => { try { fs.writeFileSync("/data/ledger.db", "x"); return "written"; } catch (e) { return `refused: ${(e as Error).message.slice(0, 80)}`; } });
    await step("fs_append_call_log", () => { fs.appendFileSync("/tmp/awx-calls.log", "{}\n", { mode: 0o600 }); fs.appendFileSync("/tmp/awx-calls.log", "{}\n"); return fs.readFileSync("/tmp/awx-calls.log", "utf8").split("\n").filter(Boolean).length; });

    await step("second_request_sees_tmp_marker", () => ({ marker_exists: fs.existsSync("/tmp/marker-from-first-request"), tmp: fs.readdirSync("/tmp") }));
    await step("path", () => ({ join: path.join("/data", "ap", "docs", "x.pdf"), resolve: path.resolve("data/vault"), dirname: path.dirname("/a/b/c.pdf"), basename: path.basename("/a/b/c.pdf"), sep: path.sep }));
    await step("url", () => ({ fileURLToPath: url.fileURLToPath("file:///purser-cloud/worker.js"), pathToFileURL: url.pathToFileURL("/a/b.mjs").href }));
    await step("module_createRequire_resolve", () => { const r = createRequire("file:///purser-cloud/worker.js"); try { return r.resolve("unpdf"); } catch (e) { return `refused: ${(e as Error).message.slice(0, 100)}`; } });
    await step("os", () => ({ tmpdir: os.tmpdir(), platform: os.platform(), hostname: os.hostname() }));
    await step("zlib_budgeted_inflate", () => {
      const packed = deflateSync(Buffer.alloc(100_000, 65));
      const all = inflateSync(packed, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 200_000 }).length;
      let over = "";
      try { inflateSync(packed, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 1000 }); over = "NOT refused"; } catch (e) { over = `${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`; }
      return { all, over_budget: over };
    });
    await step("process", () => ({ env_var_from_wrangler_vars: process.env.RP_ID ?? null, pid: process.pid, cwd: typeof process.cwd === "function" ? process.cwd() : null, platform: process.platform, version: process.version, argv: process.argv?.length ?? null }));

    // child_process and worker_threads: do the imports load, and what happens on use.
    await step("child_process_import_and_use", async () => {
      const cp = await import("node:child_process");
      const use = (name: string, fn: () => unknown) => { try { const r = fn(); return `${name}: returned ${typeof r}`; } catch (e) { return `${name}: ${(e as Error).message.slice(0, 90)}`; } };
      return { exports: Object.keys(cp).slice(0, 8), spawnSync: use("spawnSync", () => cp.spawnSync("true")), execFileSync: use("execFileSync", () => cp.execFileSync("true")), spawn: use("spawn", () => cp.spawn("true")) };
    });
    await step("worker_threads_import_and_use", async () => {
      const wt = await import("node:worker_threads");
      try { new wt.Worker("1", { eval: true }); return { isMainThread: wt.isMainThread, worker: "constructed" }; } catch (e) { return { isMainThread: wt.isMainThread, worker: `refused: ${(e as Error).message.slice(0, 100)}` }; }
    });
    // The engine's own modules that reach child_process: do they load as they are?
    await step("engine_metal_agentCli_loads", async () => Object.keys(await import("../../../src/metal/agentCli.js")).slice(0, 6));
    await step("engine_ops_processes_loads", async () => Object.keys(await import("../../../src/ops/processes.js")).slice(0, 6));
    await step("engine_world_options_loads", async () => Object.keys(await import("../../../src/world/options.js")).slice(0, 6));
    return json(out);
  },
};

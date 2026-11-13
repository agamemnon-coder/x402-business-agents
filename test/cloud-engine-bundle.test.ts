// The cloud Worker's bundle with the engine's Durable Object in it (cloud/src/entry.ts), built with the alias, define
// and module rules of cloud/wrangler.jsonc. The Worker's own start must not pay for the engine: nothing of the engine
// is reached by a static import from the entry point; it arrives only through the object's import() of
// cloud/src/engine/hostWorker.ts, on a company's first engine call. And the whole script stays under a size a deploy
// can carry.
import { build, type Metafile } from "esbuild";
import { builtinModules } from "node:module";
import { relative } from "node:path";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { aliasOf, cloudWranglerConfig, fromConfig, loadersOf } from "./support/wranglerConfig.js";

const config = cloudWranglerConfig();
const ENTRY = "cloud/src/entry.ts";
const HOST = "cloud/src/engine/hostWorker.ts";
/**
 * The engine: its own directories, and the packages only it needs. viem is not on the list: the cloud's own sync
 * (cloud/src/sync.ts, through @metalntwx/metal-pay's mandates) already loaded it before there was an engine here.
 */
const ENGINE = /^src\/(ap|executors|vault|passkey|engine|db|agents|claude|cloudsync|audit|policy|redteam)\/|^node_modules\/(pdfkit|unpdf|fontkit|better-sqlite3|playwright|@anthropic-ai|@simplewebauthn)\//;
/** The engine's ledger. The cloud's own reports already use the ledger's pure modules (accounts, vat, reports). */
const CLOUD_LEDGER = ["src/ledger/accounts.ts", "src/ledger/reports.ts", "src/ledger/vat.ts"];

let meta: Metafile;
let bytes = 0;
let gzipped = 0;

/** Every module reached from a start; with lazy: false only through static imports. */
function reach(from: string, lazy: boolean): Set<string> {
  const seen = new Set<string>([from]);
  const todo = [from];
  while (todo.length) {
    for (const edge of meta.inputs[todo.pop()!]?.imports ?? []) {
      if (edge.external || (!lazy && edge.kind === "dynamic-import") || seen.has(edge.path)) continue;
      seen.add(edge.path);
      todo.push(edge.path);
    }
  }
  return seen;
}

beforeAll(async () => {
  const out = await build({
    entryPoints: [fromConfig(config.main)], bundle: true, write: false, metafile: true, format: "esm", target: "es2024", platform: "neutral",
    mainFields: ["browser", "module", "main"], conditions: ["workerd", "worker", "browser"],
    // What the runtime gives (nodejs_compat) stays outside, as in a deploy.
    external: ["cloudflare:*", "node:*", ...builtinModules],
    alias: aliasOf(config), define: config.define, loader: loadersOf(config) as Record<string, "text" | "binary">, logLevel: "silent",
  });
  meta = out.metafile;
  bytes = out.outputFiles.reduce((n, f) => n + f.contents.byteLength, 0);
  gzipped = out.outputFiles.reduce((n, f) => n + gzipSync(f.contents).byteLength, 0);
}, 120_000);

describe("the cloud Worker's bundle with the engine's Durable Object", () => {
  it("is built from the entry point cloud/wrangler.jsonc names, which exports the Worker and the object's class", () => {
    expect(relative(process.cwd(), fromConfig(config.main))).toBe(ENTRY);
    expect(config.durable_objects.bindings).toEqual([{ name: "ENGINE", class_name: "CompanyEngine" }]);
    expect(config.migrations).toEqual([{ tag: "v1", new_sqlite_classes: ["CompanyEngine"] }]);
    expect(Object.keys(meta.inputs)).toEqual(expect.arrayContaining([ENTRY, "cloud/src/worker.ts", "cloud/src/engine/object.ts", HOST]));
  });

  it("reaches nothing of the engine by a static import: the Worker starts without it", () => {
    const eager = [...reach(ENTRY, false)];
    expect(eager).toEqual(expect.arrayContaining(["cloud/src/worker.ts", "cloud/src/engine/object.ts", "cloud/src/engine/routes.ts"]));
    expect(eager.filter((p) => ENGINE.test(p))).toEqual([]);
    expect(eager.filter((p) => p.startsWith("src/ledger/")).sort()).toEqual(CLOUD_LEDGER);
    expect(eager).not.toContain(HOST);
    expect(eager).not.toContain("cloud/src/engine/node.ts");
  });

  it("loads the engine in one place only: the object's import() of the host", () => {
    // Of the repository's own files (a package's own lazy parts are its business).
    const eager = reach(ENTRY, false);
    const lazyEdges = Object.entries(meta.inputs).flatMap(([from, input]) => input.imports.filter((e) => e.kind === "dynamic-import" && !e.external && eager.has(from) && !from.startsWith("node_modules/")).map((e) => `${from} -> ${e.path}`));
    expect(lazyEdges).toEqual([`cloud/src/engine/object.ts -> ${HOST}`]);
    const engine = [...reach(HOST, true)];
    for (const part of ["src/engine/host.ts", "src/ap/inbox.ts", "src/executors/index.ts", "src/ledger/core.ts", "src/ledger/feed.ts", "src/vault/build.ts", "src/passkey/process.ts", "src/db/doSql.ts", "src/db/migrate.ts", "src/db/schema.sql", "src/db/ledger.sql"]) expect(engine, part).toContain(part);
    for (const pkg of ["pdfkit", "unpdf"]) expect(engine.some((p) => p.startsWith(`node_modules/${pkg}/`)), pkg).toBe(true);
    // The Node engine and what only Node can carry never come along: the alias swaps them for a file that throws when used.
    expect(engine).not.toContain("cloud/src/engine/node.ts");
    expect(engine).toContain("cloud/src/engine/stub.ts");
    expect(engine.filter((p) => /^node_modules\/(better-sqlite3|playwright)\//.test(p))).toEqual([]);
  });

  // 12 November 2026: 9 MB, then 10.5 MB once Claude came into the object (the Anthropic SDK, task A5) and main grew
  // the engine's graph: this esbuild build measured 10,055,310 bytes after both (main at c26a0b8 merged in).
  // 13 November 2026: 11 MB. Connect Claude (cloud/src/claude/: the MCP server, its OAuth sign-in, the console's card)
  // added 46,909 bytes to main's 10,967,092 (11,014,001; gzipped 2,270,989). Cloudflare's limit is on the compressed
  // Worker (3 MB free, 10 MB paid), which the second check holds well under.
  it("stays under 11 MB, and under 3 MB gzipped", () => {
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(bytes).toBeLessThan(11 * 1024 * 1024);
    expect(gzipped).toBeLessThan(3 * 1024 * 1024);
  });
});

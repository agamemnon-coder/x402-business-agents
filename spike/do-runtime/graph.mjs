// SPIKE: what each engine entry point pulls in. esbuild walks the real import graph (as wrangler would bundle it) and
// this prints, per entry: the node: built-ins reached, the npm packages reached, and for the built-ins a Worker cannot
// serve (child_process, worker_threads, fs, module, …) the shortest chain of imports that leads to them.
//
//   node spike/do-runtime/graph.mjs            # every chain entry
//   node spike/do-runtime/graph.mjs src/ap/checks.ts node:child_process
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const esbuild = createRequire(resolve(root, "worker/package.json"))("esbuild");

const ENTRIES = process.argv[2] ? [process.argv[2]] : [
  "src/ap/inbox.ts", "src/ap/checks.ts", "src/ap/pay.ts", "src/ap/vendors.ts", "src/passkey/process.ts", "src/policy/approvals.ts",
  "src/executors/index.ts", "src/ledger/feed.ts", "src/vault/build.ts", "src/cloudsync/client.ts", "src/claude/reader.ts",
  "src/agents/loop.ts", "src/airwallex/adapter.ts", "src/airwallex/client.ts", "src/db/open.ts",
];
// GRAPH_MODE=worker resolves packages the way wrangler does (conditions workerd, worker, browser; browser main fields).
const WORKER = process.env.GRAPH_MODE === "worker";
const WATCH = process.argv[3] ? [process.argv[3]] : ["playwright-core", "playwright", "node:child_process", "node:worker_threads", "node:fs", "node:module", "node:url", "node:path", "node:os", "node:zlib", "node:async_hooks", "node:net", "node:http", "node:https", "node:readline", "better-sqlite3", "pdfkit", "unpdf", "express"];

const BUILTIN = new Set(createRequire(import.meta.url)("node:module").builtinModules);
const norm = (p) => (p.startsWith("node:") ? p : BUILTIN.has(p) ? `node:${p}` : p);
const pkgOf = (p) => { const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p); return m ? m[1] : null; };

const report = {};
for (const entry of ENTRIES) {
  const r = await esbuild.build({
    entryPoints: [resolve(root, entry)], bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
    ...(WORKER ? { platform: "browser", conditions: ["workerd", "worker", "browser"], mainFields: ["browser", "module", "main"] } : { platform: "node" }),
    // Every package is followed into node_modules (as wrangler does); only the built-ins stay outside.
    external: [...BUILTIN, ...[...BUILTIN].map((b) => `node:${b}`), "*.node", "playwright-core", "playwright", "chromium-bidi/*", "cloudflare:*"],
    loader: { ".sql": "text", ".html": "text", ".txt": "text", ".node": "empty" },
  }).catch((e) => ({ error: e.errors?.map((x) => `${x.text} (${x.location?.file}:${x.location?.line})`) ?? String(e) }));
  if (r.error) { report[entry] = { error: r.error }; continue; }
  const inputs = r.metafile.inputs;
  const key = Object.keys(inputs).find((k) => resolve(root, k) === resolve(root, entry) || k.endsWith(entry));
  // Breadth-first from the entry: parent pointers give the shortest chain to anything.
  const parent = new Map([[key, null]]);
  const q = [key];
  const builtins = new Map();
  const packages = new Set();
  while (q.length) {
    const cur = q.shift();
    for (const imp of inputs[cur]?.imports ?? []) {
      const path = imp.external ? norm(imp.path) : imp.path;
      if (imp.external) { if (!builtins.has(path)) builtins.set(path, cur); continue; }
      const p = pkgOf(path);
      if (p) packages.add(p);
      if (!parent.has(path)) { parent.set(path, cur); q.push(path); }
    }
  }
  const chainTo = (file) => { const out = []; for (let c = file; c; c = parent.get(c)) out.unshift(relative(root, resolve(c)).replace(/^.*node_modules\//, "npm:")); return out; };
  const firstOf = (name) => {
    if (builtins.has(name)) return [...chainTo(builtins.get(name)), name];
    const hit = [...parent.keys()].find((k) => pkgOf(k) === name);
    return hit ? chainTo(hit) : null;
  };
  report[entry] = {
    modules: parent.size,
    own_modules: [...parent.keys()].filter((k) => !pkgOf(k)).length,
    builtins: [...builtins.keys()].sort(),
    packages: [...packages].sort(),
    chains: Object.fromEntries(WATCH.map((w) => [w, firstOf(w)]).filter(([, c]) => c)),
  };
}
mkdirSync(resolve(here, "results"), { recursive: true });
if (!process.argv[2]) writeFileSync(resolve(here, WORKER ? "results/graph.worker.json" : "results/graph.json"), `${JSON.stringify(report, null, 1)}\n`);
for (const [e, v] of Object.entries(report)) {
  if (v.error) { console.log(`\n${e}: BUNDLE ERROR ${JSON.stringify(v.error).slice(0, 600)}`); continue; }
  console.log(`\n${e}: ${v.modules} modules (${v.own_modules} of ours)\n  built-ins: ${v.builtins.join(" ")}\n  packages: ${v.packages.join(" ")}`);
  for (const [w, c] of Object.entries(v.chains)) console.log(`  ${w}: ${c.join(" > ")}`);
}

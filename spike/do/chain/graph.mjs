// The module graph of an entry point, as esbuild sees it: every Node built-in and npm package it reaches, each with the
// shortest chain of imports that leads there. Used to see what a Workers bundle of the engine pulls in, and through what.
// Usage: node spike/do/chain/graph.mjs <entry.ts> [--chains pkg1,pkg2] [--json out.json]
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { esbuild } from "../build.mjs";

const entry = resolve(process.argv[2]);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const root = resolve(new URL("../../..", import.meta.url).pathname);
const rel = (p) => relative(root, resolve(p)).replace(/^(\.\.\/)+x402-business-agents\//, "");

const result = await esbuild.build({
  entryPoints: [entry], bundle: true, write: false, metafile: true, format: "esm", platform: "node", target: "es2024", logLevel: "silent",
  loader: { ".sql": "text", ".node": "empty" }, external: ["cloudflare:*", "chromium-bidi/*", "electron", "fsevents"],
  alias: process.argv.includes("--with-aliases") ? {} : {},
}).catch((e) => { console.error(e.errors?.map((x) => `${x.text} (${x.location?.file}:${x.location?.line})`).join("\n") ?? e); process.exit(1); });

const inputs = result.metafile.inputs;
const entryKey = Object.keys(inputs).find((k) => resolve(k) === entry);
// Breadth-first from the entry: the shortest chain to every module, and to every external (built-in) it imports.
const parent = new Map([[entryKey, null]]);
const externals = new Map(); // name -> first importer
const queue = [entryKey];
while (queue.length) {
  const k = queue.shift();
  for (const imp of inputs[k]?.imports ?? []) {
    if (imp.external) { if (!externals.has(imp.path)) externals.set(imp.path, k); continue; }
    if (!parent.has(imp.path)) { parent.set(imp.path, k); queue.push(imp.path); }
  }
}
const chain = (k) => { const out = []; for (let c = k; c; c = parent.get(c)) out.unshift(rel(c)); return out; };
const pkgOf = (k) => { const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(k); return m ? m[1] : null; };

const packages = new Map(); // pkg -> { bytes, files, first }
let ownBytes = 0, ownFiles = 0;
for (const k of parent.keys()) {
  const pkg = pkgOf(k);
  if (!pkg) { ownBytes += inputs[k].bytes; ownFiles++; continue; }
  const p = packages.get(pkg) ?? { bytes: 0, files: 0, first: k };
  p.bytes += inputs[k].bytes; p.files++;
  if (chain(k).length < chain(p.first).length) p.first = k;
  packages.set(pkg, p);
}
console.log(`entry ${rel(entry)}: ${parent.size} modules reached; own files ${ownFiles} (${(ownBytes / 1024).toFixed(0)} KiB source), ${packages.size} npm packages`);
console.log("\nNode built-ins and other externals, with the shortest chain to the first importer:");
for (const [name, importer] of [...externals].sort()) console.log(`  ${name.padEnd(24)} <- ${chain(importer).join(" <- ".replace("<-", "->"))}`.replace(/ -> /g, " > "));
console.log("\nnpm packages by source size, with the shortest chain:");
for (const [pkg, p] of [...packages].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${pkg.padEnd(34)} ${(p.bytes / 1024).toFixed(0).padStart(7)} KiB ${String(p.files).padStart(5)} files  via ${chain(p.first).filter((x) => !x.includes("node_modules")).join(" > ")}`);
const want = (arg("--chains") ?? "").split(",").filter(Boolean);
for (const w of want) {
  const hit = [...parent.keys()].find((k) => pkgOf(k) === w || rel(k) === w) ?? (externals.has(w) ? externals.get(w) : null);
  console.log(`\nchain to ${w}:\n  ${hit ? chain(hit).join("\n  > ") : "not reached"}`);
}
if (arg("--json")) writeFileSync(arg("--json"), JSON.stringify({ externals: [...externals].map(([n, i]) => ({ name: n, chain: chain(i) })), packages: [...packages].map(([n, p]) => ({ name: n, bytes: p.bytes, files: p.files, chain: chain(p.first) })) }, null, 1));

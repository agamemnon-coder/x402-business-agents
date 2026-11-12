// Runs spike/do/conformance.ts on better-sqlite3 (Node) and on the shim in workerd, and prints every line that differs.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { conformance } from "./conformance.js";
// @ts-expect-error plain .mjs helpers
import { bundleForWorkerd } from "./build.mjs";
// @ts-expect-error plain .mjs helpers
import { workerd } from "./mf.mjs";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const tmp = process.env.TMPDIR ?? "/dev/shm";
mkdirSync(`${tmp}/conf`, { recursive: true });
const outfile = `${tmp}/conf/conformanceWorker.js`;
await bundleForWorkerd(here("./conformanceWorker.ts"), outfile);
const mf = workerd({ modules: [{ type: "ESModule", path: outfile }], binding: "CONF", className: "Conf" });
const call = async (path: string, n = "c") => { const r = await mf.dispatchFetch(`http://conf${path}?n=${n}`); const text = await r.text(); try { return JSON.parse(text) as unknown; } catch { return { status: r.status, text: text.slice(0, 200) }; } };
try {
  console.log("fresh Durable Object:", JSON.stringify(await call("/fresh", "fresh")));
  const node = conformance(new Database(":memory:"));
  const res = await call("/conformance") as { rows: [string, string][]; stats: unknown };
  const dobj = res.rows;
  let same = 0;
  const diffs: string[] = [];
  for (let i = 0; i < Math.max(node.length, dobj.length); i++) {
    const [label, a] = node[i] ?? ["<missing>", ""];
    const b = dobj[i]?.[1];
    if (a === b) same++; else diffs.push(`DIFF  ${label}\n   better-sqlite3: ${a}\n   Durable Object: ${b}`);
  }
  if (process.argv.includes("--all")) for (const [label, a] of node) console.log(`${label.padEnd(52)} ${a.slice(0, 160)}`);
  console.log(`\n${same} of ${node.length} checks give the same answer in both; ${diffs.length} differ`);
  for (const d of diffs) console.log(d);
  console.log("shim statistics for the checks:", JSON.stringify(res.stats));
  console.log("\nA write, then the request throws (no await in between):", JSON.stringify(await call("/write-then-throw", "throws")));
  console.log("  the rows afterwards:", JSON.stringify(await call("/after-throw", "throws")));
  console.log("A write, an await, a write, then the request throws:", JSON.stringify(await call("/write-await-throw", "throws2")));
  console.log("  the rows afterwards:", JSON.stringify(await call("/after-throw", "throws2")));
} finally { await mf.dispose(); }

// Runs the chain inside a SQLite-backed Durable Object in workerd (the bundle wrangler made), with the inputs of the
// Node golden run, and compares everything: each step's answer, every row of every table, the audit chain, the ledger
// chain, the proposal's terms hash and the cloud sync batches. Then times the chain on fresh objects.
// Usage: tsx run.ts <dist dir of `wrangler deploy --dry-run`> <golden.json> [--runs N] [--report out.json]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper
import { workerd } from "../mf.mjs";
import { STEPS } from "./chain.js";

const [dist, goldenPath] = process.argv.slice(2) as [string, string];
const opt = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const runs = Number(opt("--runs") ?? 5);
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as {
  inputs: { pdf: { base64: string; filename: string; sha256: string; text: string; pages: number }; clockBase: number };
  args: Record<string, unknown>; results: Record<string, unknown>; stats: Record<string, { statements: number; transactions: number; ms: number }>;
  dump: { tables: number; rows: Record<string, Record<string, unknown>[]>; schema: unknown[]; audit: unknown; ledger: unknown };
};

const modules = readdirSync(dist).filter((f) => f.endsWith(".js") || f.endsWith(".sql")).sort((a, b) => Number(b === "engineWorker.js") - Number(a === "engineWorker.js"))
  .map((f) => ({ type: f.endsWith(".js") ? "ESModule" : "Text", path: join(dist, f) }));
const mf = workerd({ modules, modulesRoot: dist, binding: "COMPANY", className: "CompanyEngine" });

interface Answer { result?: unknown; stats?: Record<string, number>; error?: string; stack?: string[]; ms: number }
async function call(company: string, step: string, body: Record<string, unknown>): Promise<Answer> {
  const t0 = performance.now();
  const res = await mf.dispatchFetch(`http://engine/${step}?company=${company}`, { method: "POST", body: JSON.stringify(body) });
  const text = await res.text();
  const ms = performance.now() - t0;
  try { return { ...(JSON.parse(text) as object), ms }; } catch { return { error: `HTTP ${res.status}: ${text.slice(0, 300)}`, ms }; }
}

const BASE = golden.inputs.clockBase;
async function chain(company: string): Promise<{ answers: Record<string, Answer>; dump?: Answer; open: Answer }> {
  const open = await call(company, "open", { clock: BASE, resetRandom: true });
  const answers: Record<string, Answer> = {};
  let i = 0;
  for (const name of STEPS) {
    const body: Record<string, unknown> = { clock: BASE + ++i * 1000, args: golden.args[name] ?? {} };
    if (name === "ingest") body.text = { sha256: golden.inputs.pdf.sha256, text: golden.inputs.pdf.text, pages: golden.inputs.pdf.pages };
    answers[name] = await call(company, name, body);
    if (answers[name]!.error) return { answers, open };
  }
  return { answers, open, dump: await call(company, "dump", { clock: BASE + ++i * 1000 }) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const report: Record<string, unknown> = {};
try {
  const g = await chain("golden");
  console.log(`open (schema + migrations over a fresh Durable Object): ${g.open.error ? `FAILED ${g.open.error}` : `${JSON.stringify(g.open.result)} in ${g.open.ms.toFixed(1)} ms, ${g.open.stats?.statements} statements, ${g.open.stats?.rowsWritten} rows written`}`);
  console.log("\nstep           answer    statements (node / DO engine + shim)   rows read / written   wall ms (node / DO)");
  const perStep: Record<string, unknown> = {};
  for (const name of STEPS) {
    const a = g.answers[name];
    if (!a) { console.log(`${name.padEnd(14)} not reached`); continue; }
    if (a.error) { console.log(`${name.padEnd(14)} BLOCKED: ${a.error}\n   ${(a.stack ?? []).join("\n   ")}`); perStep[name] = { blocked: a.error }; break; }
    const n = golden.stats[name]!;
    const eq = same(a.result, golden.results[name]);
    console.log(`${name.padEnd(14)} ${(eq ? "same" : "DIFFERS").padEnd(9)} ${String(n.statements).padStart(5)} / ${String(a.stats!.statements).padStart(5)} + ${String(a.stats!.added).padEnd(5)} ${n.statements === a.stats!.statements ? "" : "(!)"}`.padEnd(64)
      + `${String(a.stats!.rowsRead).padStart(6)} / ${String(a.stats!.rowsWritten).padEnd(8)} ${n.ms.toFixed(1).padStart(8)} / ${a.ms.toFixed(1)}`);
    if (!eq) console.log(`   node: ${JSON.stringify(golden.results[name]).slice(0, 400)}\n   DO:   ${JSON.stringify(a.result).slice(0, 400)}`);
    perStep[name] = { same: eq, node: n, durableObject: { ...a.stats, ms: Number(a.ms.toFixed(2)) } };
  }
  report.steps = perStep;
  if (g.dump?.result) {
    const d = g.dump.result as typeof golden.dump;
    // The one column that names where a document's bytes are: a file on the runner, a row in the Durable Object.
    const norm = (rows: Record<string, Record<string, unknown>[]>) => JSON.parse(JSON.stringify(rows), (k, v: unknown) => (k === "path" && typeof v === "string" && (/\/docs\/[0-9a-f]{64}\.pdf$/.test(v) || /^do:[0-9a-f]{64}$/.test(v)) ? "<document store>" : v)) as Record<string, Record<string, unknown>[]>;
    const [nr, dr] = [norm(golden.dump.rows), norm(d.rows)];
    const tables = [...new Set([...Object.keys(nr), ...Object.keys(dr)])].sort();
    const diffs: string[] = [];
    let rowCount = 0;
    for (const t of tables) {
      const [a, b] = [nr[t] ?? [], dr[t] ?? []];
      rowCount += a.length;
      if (a.length !== b.length) diffs.push(`${t}: ${a.length} rows in Node, ${b.length} in the Durable Object`);
      for (let r = 0; r < Math.min(a.length, b.length); r++) {
        for (const col of new Set([...Object.keys(a[r]!), ...Object.keys(b[r]!)])) {
          if (!same(a[r]![col], b[r]![col])) diffs.push(`${t}[${r}].${col}: node ${JSON.stringify(a[r]![col])?.slice(0, 120)} | DO ${JSON.stringify(b[r]![col])?.slice(0, 120)}`);
        }
      }
    }
    const paths = { node: golden.dump.rows.ap_documents?.map((x) => String(x.path).replace(/[0-9a-f]{64}/, "<sha256>").replace(/^.*\/ap\//, "<dir>/")), durableObject: d.rows.ap_documents?.map((x) => String(x.path).replace(/[0-9a-f]{64}/, "<sha256>")) };
    console.log(`\nGOLDEN COMPARISON: ${tables.length} tables with rows, ${rowCount} rows, ${diffs.length} differences${diffs.length ? ":" : ""}`);
    for (const x of diffs.slice(0, 60)) console.log(`   ${x}`);
    console.log(`   (ap_documents.path is the one column set aside: ${JSON.stringify(paths)})`);
    console.log(`   schema objects (tables, indexes, triggers and their SQL): ${same(golden.dump.schema, d.schema) ? `identical (${d.schema.length})` : `DIFFER (${golden.dump.schema.length} vs ${d.schema.length})`}`);
    console.log(`   audit chain    node ${JSON.stringify(golden.dump.audit)}\n                  DO   ${JSON.stringify(d.audit)}`);
    console.log(`   ledger chain   node ${JSON.stringify(golden.dump.ledger)}\n                  DO   ${JSON.stringify(d.ledger)}`);
    const th = (r: Record<string, Record<string, unknown>[]>) => r.proposals?.map((p) => p.terms_sha256);
    console.log(`   terms hash     node ${JSON.stringify(th(golden.dump.rows))} DO ${JSON.stringify(th(d.rows))}`);
    console.log(`   sync batches   node ${(golden.results.batches as { sha256: string }).sha256} DO ${(g.answers.batches?.result as { sha256: string } | undefined)?.sha256}`);
    report.golden = { tables: tables.length, rows: rowCount, differences: diffs, schemaIdentical: same(golden.dump.schema, d.schema), audit: { node: golden.dump.audit, durableObject: d.audit }, ledger: { node: golden.dump.ledger, durableObject: d.ledger }, termsHash: { node: th(golden.dump.rows), durableObject: th(d.rows) }, documentPath: paths };
    if (!same(golden.dump.schema, d.schema)) {
      const key = (x: unknown) => { const o = x as { type: string; name: string }; return `${o.type} ${o.name}`; };
      const dm = new Map(d.schema.map((x) => [key(x), x]));
      for (const x of golden.dump.schema) { const y = dm.get(key(x)); if (!y) console.log(`   only in Node: ${key(x)}`); else if (!same(x, y)) console.log(`   differs: ${key(x)}\n     node ${JSON.stringify(x).slice(0, 300)}\n     DO   ${JSON.stringify(y).slice(0, 300)}`); dm.delete(key(x)); }
      for (const k of dm.keys()) console.log(`   only in the Durable Object: ${k}`);
    }
  }
  // Timing: the whole chain on fresh objects (a new company each time), wall time per request as the caller sees it.
  if (runs > 0 && g.dump) {
    const times: Record<string, number[]> = { open: [] };
    for (let r = 0; r < runs; r++) {
      const c = await chain(`timing-${r}`);
      times.open!.push(c.open.ms);
      for (const name of STEPS) (times[name] ??= []).push(c.answers[name]?.ms ?? NaN);
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    console.log(`\nTIMING over ${runs} fresh Durable Objects (wall ms per request, median [min..max]); Node in-process for comparison:`);
    let total = 0;
    const timing: Record<string, unknown> = {};
    for (const [name, xs] of Object.entries(times)) {
      total += name === "open" ? 0 : med(xs);
      console.log(`   ${name.padEnd(14)} ${med(xs).toFixed(1).padStart(7)} [${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}]${golden.stats[name] ? `   node ${golden.stats[name]!.ms.toFixed(1)}` : ""}`);
      timing[name] = { medianMs: Number(med(xs).toFixed(2)), minMs: Number(Math.min(...xs).toFixed(2)), maxMs: Number(Math.max(...xs).toFixed(2)), nodeMs: golden.stats[name]?.ms };
    }
    console.log(`   chain total (10 steps, medians): ${total.toFixed(1)} ms in workerd; ${Object.values(golden.stats).reduce((a, x) => a + x.ms, 0).toFixed(1)} ms in Node`);
    report.timing = timing;
  }
  if (opt("--report")) writeFileSync(opt("--report")!, JSON.stringify(report, null, 1));
} finally { await mf.dispose(); }

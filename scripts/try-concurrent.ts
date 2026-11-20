// npm run try:concurrent -- <out dir> <log dir> [visitors] [stagger ms]: several judges on the public /try at the same
// moment (20 Nov, before judging; docs/runs/2026-11-21-try-capacity.md). Each visitor is scripts/try-live-record.ts, the
// repository's own walk recorder, in a process of its own, all started together (or `stagger` ms apart): the judge's
// main walk once each, with its own test companies. Then concurrency.json beside the runs: per walk its result, every
// 429 and 5xx, every Claude action refused a reservation (claude.capped, with its cap) or read by the parser instead,
// every payout not sent to the Airwallex sandbox (with its reason), and each route's p50 and p95 over all walks.
// Its file is concurrency.json, not summary.json: a capacity check, not a series of record (src/redesign/liveTry.ts
// adds up only folders with a summary.json).
//
// What it spends: per visitor 2 test companies, 2 Airwallex SANDBOX payouts (of the 100 a UTC day, worker/src/
// awxPayout.ts AWX_PAYOUT_DAY) and about USD 0.005 of Claude at list price. Test money only. Default 10 visitors.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface Ev { event: string; subject: string | null; fields: Record<string, unknown> }
/** The parts of a try-live-record.ts record this reads. */
export interface ConcRecord {
  run: number; ok: boolean; failures: string[]; started_at: string; finished_at: string; profile: string; browser: { name: string };
  calls: { method: string; path: string; status: number; ms: number | null }[];
  answers: { path: string; body: Record<string, unknown> | null }[];
  steps_ms: Record<string, number | null>;
  events: { main: Ev[]; cash: Ev[] };
}

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : null; };
const dist = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: xs.length ? Math.max(...xs) : null });
/** A path as a route: ids and queries made generic. */
export const routeOf = (method: string, path: string) => `${method} ${path.split("?")[0]!.replace(/\/(AP|P)-\d+/g, "/{id}").replace(/\/samples\/[a-z]+$/, "/samples/{name}")}`;

/** The figures of a concurrent run, from its records. Pure. */
export function concurrencyOf(recs: ConcRecord[]) {
  const evs = recs.flatMap((r) => [...r.events.main, ...r.events.cash]);
  const capped = evs.filter((e) => e.event === "claude.capped").map((e) => String(e.fields.reason ?? "?"));
  const reads = evs.filter((e) => e.event === "claude.read");
  const notClaude = reads.filter((e) => e.fields.source !== "claude").map((e) => String(e.fields.source));
  const agents = evs.filter((e) => e.event === "agent.run");
  const payouts = recs.flatMap((r) => r.answers.filter((a) => /\/pay$/.test(a.path)).map((a) => a.body?.airwallex_payout as Record<string, unknown> | undefined).filter((p): p is Record<string, unknown> => !!p));
  const paid = recs.reduce((k, r) => k + r.answers.filter((a) => /payout\/simulate$/.test(a.path) && (a.body?.note as Record<string, unknown> | undefined)?.status === "PAID").length, 0);
  const calls = recs.flatMap((r) => r.calls);
  const routes = [...new Set(calls.map((c) => routeOf(c.method, c.path)))].sort();
  const steps = [...new Set(recs.flatMap((r) => Object.keys(r.steps_ms)))];
  const starts = recs.map((r) => Date.parse(r.started_at)), ends = recs.map((r) => Date.parse(r.finished_at));
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {});
  return {
    visitors: recs.length, ok: recs.filter((r) => r.ok).length,
    failed: recs.filter((r) => !r.ok).map((r) => ({ run: r.run, failures: r.failures })),
    span_s: recs.length ? Math.round((Math.max(...ends) - Math.min(...starts)) / 1000) : 0,
    started_within_ms: recs.length ? Math.max(...starts) - Math.min(...starts) : 0,
    http: { calls: calls.length, statuses: count(calls.map((c) => String(c.status))), s429: calls.filter((c) => c.status === 429).map((c) => routeOf(c.method, c.path)), s5xx: calls.filter((c) => c.status >= 500).map((c) => `${c.status} ${routeOf(c.method, c.path)}`) },
    claude: { reads: reads.length, by_claude: reads.length - notClaude.length, not_by_claude: count(notClaude), agent_runs: agents.length, agent_runs_done: agents.filter((e) => e.fields.status === "done").length, capped: count(capped),
      cost_usd_micros: [...reads, ...agents].reduce((k, e) => k + (typeof e.fields.cost_usd_micros === "number" ? e.fields.cost_usd_micros : 0), 0) },
    airwallex: { payouts_asked: payouts.length, sent_to_sandbox: payouts.filter((p) => p.source === "airwallex-sandbox").length, paid, not_sent: count(payouts.filter((p) => p.source !== "airwallex-sandbox").map((p) => String(p.reason ?? p.source))) },
    routes_ms: Object.fromEntries(routes.map((k) => [k, dist(calls.filter((c) => routeOf(c.method, c.path) === k && typeof c.ms === "number").map((c) => c.ms!))])),
    steps_ms: Object.fromEntries(steps.map((k) => [k, dist(recs.map((r) => r.steps_ms[k]).filter((x): x is number => typeof x === "number"))])),
  };
}

async function main(): Promise<void> {
  const [out, logs, nArg, staggerArg] = process.argv.slice(2);
  if (!out || !logs) throw new Error("usage: try-concurrent.ts <out dir> <log dir> [visitors] [stagger ms]");
  const n = Number(nArg ?? 10), stagger = Number(staggerArg ?? 0);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("visitors: 1 to 20");
  mkdirSync(out, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const load: { at: string; load1: number }[] = [];
  const sampler = setInterval(() => load.push({ at: new Date().toISOString(), load1: Math.round(loadavg()[0]! * 100) / 100 }), 5_000);
  const started_at = new Date().toISOString();
  // Alternating desktop and phone, all in Chromium (the virtual passkey): what this machine runs ten of at once.
  const exits = await Promise.all(Array.from({ length: n }, (_, i) => new Promise<number | null>((resolve) => {
    setTimeout(() => {
      const log = createWriteStream(join(logs, `run-${i + 1}.log`));
      const p = spawn(process.execPath, ["--import", "tsx", "scripts/try-live-record.ts", String(i + 1), i % 2 ? "phone" : "desktop", out], { env: { ...process.env, BROWSER: "chromium", NETWORK: "none" }, stdio: ["ignore", "pipe", "pipe"] });
      const kill = setTimeout(() => p.kill("SIGKILL"), 10 * 60_000);
      p.stdout.pipe(log); p.stderr.pipe(log);
      p.on("close", (c) => { clearTimeout(kill); resolve(c); });
    }, i * stagger);
  })));
  clearInterval(sampler);
  const recs = Array.from({ length: n }, (_, i) => join(out, `run-${i + 1}.json`)).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")) as ConcRecord);
  const figures = concurrencyOf(recs);
  writeFileSync(join(out, "concurrency.json"), JSON.stringify({
    what: `${n} visitors on the public /try at once, each scripts/try-live-record.ts in its own process (scripts/try-concurrent.ts); test money only.`,
    started_at, finished_at: new Date().toISOString(), stagger_ms: stagger, exits, records_written: recs.length, client_load1: load, ...figures,
  }, null, 1) + "\n");
  console.log(JSON.stringify(figures, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

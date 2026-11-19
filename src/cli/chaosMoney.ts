// npm run chaos:money [-- --seed <n>] [-- --count <n>] [-- --only <id>] [-- --no-write]
// Chaos for money movement (src/chaos/money.ts): the real executor, saga, Airwallex client and recovery against a
// stand-in Airwallex that times out, answers 5xx and 429, drops connections after doing the work, while the runner's
// process dies and restarts, clocks are skewed and webhooks arrive twice, out of order or forged. 300 randomized
// scenarios from a fixed seed (default 20261119) plus the hand-written ones, then the canaries (planted breaks the
// invariants must catch). Writes docs/evidence/chaos-money.md and .json (unless --no-write or --only). Exit 1 when an
// invariant is broken or a canary is not caught: a finding, never hidden. In process; no network, no key.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANARIES, HAND_WRITTEN, randomScenarios, runScenario, type Scenario, type ScenarioResult } from "../chaos/money.js";
import { chaosMarkdown, chaosReport } from "../chaos/report.js";

const ROOT = resolve(import.meta.dirname, "../..");
export const CHAOS_MONEY_OUT = "docs/evidence/chaos-money";
export const CHAOS_SEED = 20261119;
export const CHAOS_COUNT = 300;

/** Every scenario in order; `log` hears each result as it comes. */
export async function chaosMoney(o: { seed?: number; count?: number; only?: string; log?: (r: ScenarioResult) => void } = {}): Promise<{ random: ScenarioResult[]; hand: ScenarioResult[]; canaries: ScenarioResult[] }> {
  const pick = (xs: readonly Scenario[]) => (o.only ? xs.filter((s) => s.id === o.only) : xs);
  const run = async (xs: readonly Scenario[]) => { const out: ScenarioResult[] = []; for (const s of pick(xs)) { const r = await runScenario(s); out.push(r); o.log?.(r); } return out; };
  return { hand: await run(HAND_WRITTEN), random: await run(randomScenarios(o.seed ?? CHAOS_SEED, o.count ?? CHAOS_COUNT)), canaries: await run(CANARIES) };
}

if (process.argv[1]?.endsWith("chaosMoney.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  // The engine's own request lines (cloud/src/log.ts) are not this run's: only the scenarios are printed.
  const print = console.log.bind(console);
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"ts":')) return; print(...a); };
  const seed = Number(arg("--seed") ?? CHAOS_SEED), count = Number(arg("--count") ?? CHAOS_COUNT), only = arg("--only");
  const res = await chaosMoney({ seed, count, ...(only ? { only } : {}), log: (r) => {
    print(`${r.ok ? "held  " : "BROKEN"} ${r.id.padEnd(5)} calls ${String(r.calls).padStart(3)}  faults ${String(r.faults).padStart(2)}  deaths ${r.crashes}  ${r.title.slice(0, 90)}`);
    if (!r.ok || only) for (const i of r.invariants) print(`       ${i.ok ? "ok" : "BROKEN"} ${i.id} ${i.detail}`);
    if (only) for (const line of r.outcome) print(`       > ${line}`);
  } });
  const report = chaosReport(seed, res.random, res.hand, res.canaries, new Date().toISOString().slice(0, 10));
  const t = report.totals;
  const missed = report.canaries.filter((c) => !c.caught);
  print(`\n${t.scenarios} scenarios: ${t.passed} held, ${t.failed} broke an invariant; ${t.crashes} process deaths, ${t.faults} faults; canaries caught ${report.canaries.length - missed.length} of ${report.canaries.length}`);
  if (!process.argv.includes("--no-write") && !only) {
    writeFileSync(join(ROOT, `${CHAOS_MONEY_OUT}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(ROOT, `${CHAOS_MONEY_OUT}.md`), chaosMarkdown(report, res.hand));
    print(`written: ${CHAOS_MONEY_OUT}.md and .json`);
  }
  process.exit(t.failed || missed.length ? 1 : 0);
}

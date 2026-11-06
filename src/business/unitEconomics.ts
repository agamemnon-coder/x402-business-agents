// Unit economics (hypothesis), Max's last round item 5.2: what one agent costs Purser a month against the intended
// price (€49 per company a month including 5 agents, €10 per extra agent). Measured inputs come from the main run's
// record (docs/demo/main-run.json) and the model benchmark (docs/evals/model-benchmark.json); every other input is a
// sourced price or a labelled assumption. docs/business/model.md and the deck's business slide print what this module
// computes; test/unit-economics-hypothesis.test.ts checks both, and that no number in them is unsourced.

import { readFileSync } from "node:fs";

/** Where docs/business/model.md's section starts and ends (the test reads between them). */
export const SECTION_START = "<!-- unit-economics -->";
export const SECTION_END = "<!-- /unit-economics -->";

export interface Source { id: string; what: string; url: string; /** The date we read it, or the record's date. */ read: string }
/** Every outside fact and record the section uses. R = this repository, U = a public page we opened. */
export const SOURCES: readonly Source[] = [
  { id: "R1", what: "The main run's record: `snapshot.agent_stats` (each agent's decisions and the cost of its own Claude calls) and `snapshot.claude` (every Claude call of the run)", url: "docs/demo/main-run.json", read: "3 November 2026" },
  { id: "R2", what: "Model benchmark, the agents' eval cases: the same cases with Purser's split and with Opus for every role ([report](../model-benchmark.md))", url: "docs/evals/model-benchmark.json", read: "31 October 2026" },
  { id: "U1", what: "Anthropic, Claude API pricing (list prices, standard routing, no batch), as `src/claude/pricing.ts` applies them to the record", url: "https://platform.claude.com/docs/en/about-claude/pricing", read: "30 October 2026" },
  { id: "U2", what: "Cloudflare, Workers pricing (Workers Paid plan; Durable Objects, SQLite storage backend)", url: "https://developers.cloudflare.com/workers/platform/pricing/", read: "6 November 2026" },
  { id: "U3", what: "European Central Bank, euro foreign exchange reference rates (USD)", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", read: "6 November 2026" },
];

type AssumptionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8";
interface Input { value: number; kind: "price" | "assumption"; /** A source id for a price, an assumption id for an assumption. */ source: string; label: string }
const price = (value: number, source: string, label: string): Input => ({ value, kind: "price", source, label });
const assume = (value: number, source: AssumptionId, label: string): Input => ({ value, kind: "assumption", source, label });

/** The numbers the model starts from that are not in a record: sourced prices and stated assumptions. */
export const INPUTS = {
  basePlanEur: assume(49, "A1", "intended price per company a month, EUR"),
  includedAgents: assume(5, "A1", "agents included in the base price"),
  extraAgentEur: assume(10, "A1", "intended price per extra agent a month, EUR"),
  usageLow: assume(100, "A2", "decisions per agent a month, low"),
  usageMid: assume(300, "A2", "decisions per agent a month, mid"),
  usageHigh: assume(1000, "A2", "decisions per agent a month, high"),
  workersPlanUsd: price(5, "U2", "Workers Paid plan, minimum a month per account, USD"),
  workerIncludedRequests: price(10_000_000, "U2", "Worker requests included a month"),
  doIncludedRequests: price(1_000_000, "U2", "Durable Object requests included a month"),
  doIncludedGbS: price(400_000, "U2", "Durable Object duration included a month, GB-s"),
  doMemoryMb: price(128, "U2", "memory a Durable Object is billed for, MB"),
  daysPerMonth: assume(30, "A5", "days in a month"),
  usdPerEur: price(1.1165, "U3", "USD per EUR, ECB reference rate"),
} satisfies Record<string, Input>;
export type InputKey = keyof typeof INPUTS;

export interface Assumption { id: AssumptionId; what: string; value: string; why: string; inputs: InputKey[] }
const n = (x: number) => x.toLocaleString("en-GB");

/** The assumptions Max approves before this goes public, each with why. */
export const ASSUMPTIONS: readonly Assumption[] = [
  {
    id: "A1", what: "Price", value: `€${INPUTS.basePlanEur.value} per company a month including ${INPUTS.includedAgents.value} agents; €${INPUTS.extraAgentEur.value} per extra agent; VAT excluded; every company uses its ${INPUTS.includedAgents.value} included agents`,
    why: "The intended pricing above (hypothesis); no customer has seen it. Excluding VAT and counting all included agents in use gives the price per included agent.",
    inputs: ["basePlanEur", "includedAgents", "extraAgentEur"],
  },
  {
    id: "A2", what: "Usage", value: `${n(INPUTS.usageLow.value)} (low), ${n(INPUTS.usageMid.value)} (mid), ${n(INPUTS.usageHigh.value)} (high) decisions per agent a month`,
    why: "Not measured: no company has used Purser for a month. An agent calls Claude for an exception (a price change, a dispute, a payment beyond its limits), not for each routine payment, which code makes alone inside the limits. Low is a quiet agent, high a busy one; the range is the one Max proposed.",
    inputs: ["usageLow", "usageMid", "usageHigh"],
  },
  {
    id: "A3", what: "Claude per decision, the run's mix", value: "the main run's whole Claude bill divided by its decisions [R1], at list prices [U1]",
    why: "The only measured figure. It counts every Claude call of the run, including sorting and reading documents and the Opus reviews for the CFO, so it is above the agents' own cost per decision. The run was a scenario full of exceptions; a real month may cost more or less per decision. No batch or cache discount beyond what the run used.",
    inputs: [],
  },
  {
    id: "A4", what: "Claude per decision, Opus for every agent", value: "A3 × the benchmark's cost of Opus for every role over Purser's split, on the same eval cases [R2]",
    why: "The worst case for the model mix. The factor is measured on the agents' eval cases, not on the main run; we assume the run would scale the same way.",
    inputs: [],
  },
  {
    id: "A5", what: "Hosting", value: `one Cloudflare Workers Paid account per company, USD ${INPUTS.workersPlanUsd.value} a month [U2], shared by its ${INPUTS.includedAgents.value} included agents; usage inside the plan's included amounts; a month of ${INPUTS.daysPerMonth.value} days`,
    why: "An upper bound for a company's own Worker and Durable Object: one account could serve many companies. The check below shows one Durable Object awake all month, and the high scenario's requests, fit inside what the plan includes.",
    inputs: ["workersPlanUsd", "workerIncludedRequests", "doIncludedRequests", "doIncludedGbS", "doMemoryMb", "daysPerMonth"],
  },
  {
    id: "A6", what: "The runner", value: "runs on Cloudflare too",
    why: "Today the runner (agents, ledger, keys) is a separate process and the relay is on Cloudflare ([architecture](../architecture.md#the-shape-today)). We assume production moves the runner onto Workers and a Durable Object per company; compute elsewhere is not priced.",
    inputs: [],
  },
  {
    id: "A7", what: "Currency", value: `everything in EUR at EUR 1 = USD ${INPUTS.usdPerEur.value} [U3]`,
    why: "Claude and Cloudflare charge in USD and the price is in EUR. One rate, the ECB's reference rate of the day we wrote this.",
    inputs: ["usdPerEur"],
  },
  {
    id: "A8", what: "Not in the model", value: "Airwallex platform or partner fees, Metal fees on mainnet, the cost of collecting our own invoices, people",
    why: "Airwallex prices platform use on request [P1], so the cost is unknown; Purser has run on Metal testnet only. Gross margin here is the price minus Claude and hosting, so the real margin is lower.",
    inputs: [],
  },
];

interface AgentStat { agent: string; decisions: number; cost_usd_micros: number; models: string[] }
interface Record_ { snapshot: { agent_stats: AgentStat[]; claude: { cost_usd_micros: number } } }
interface Bench { sets: { core: { rows: { id: string; cost_usd_micros: number }[] } } }
const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;

const usd4 = (micros: number) => (micros / 1e6).toFixed(4);
const eur = (x: number) => `€${x.toFixed(2)}`;
/** A margin as a whole percent, with a real minus sign. */
const pct = (m: number) => `${Math.round(m * 100) < 0 ? "−" : ""}${Math.abs(Math.round(m * 100))}%`;

export interface Scenario {
  usage: "low" | "mid" | "high"; mix: "run" | "opus"; decisions: number; microsPerDecision: number;
  claudeEur: number; hostingEur: number; costEur: number; marginIncluded: number; marginExtra: number;
  claudeEurText: string; hostingEurText: string; costEurText: string; marginIncludedText: string; marginExtraText: string;
}

export function unitEconomics() {
  const rec = readJson<Record_>("docs/demo/main-run.json");
  const bench = readJson<Bench>("docs/evals/model-benchmark.json");
  const st = rec.snapshot.agent_stats;
  const decisions = st.reduce((s, a) => s + a.decisions, 0);
  const ownMicros = st.reduce((s, a) => s + a.cost_usd_micros, 0);
  const allMicros = rec.snapshot.claude.cost_usd_micros;
  const allInMicrosPerDecision = allMicros / decisions;
  const row = (id: string) => bench.sets.core.rows.find((r) => r.id === id)!.cost_usd_micros;
  const opusFactor = row("opus") / row("purser");
  const opusMicrosPerDecision = Math.round(allInMicrosPerDecision * opusFactor);
  const fx = INPUTS.usdPerEur.value;
  const agents = INPUTS.includedAgents.value;
  const hostingMicrosPerAgent = INPUTS.workersPlanUsd.value * 1e6 / agents;
  const revenueIncludedEur = INPUTS.basePlanEur.value / agents;
  const extraEur = INPUTS.extraAgentEur.value;
  const usages = [["low", INPUTS.usageLow.value], ["mid", INPUTS.usageMid.value], ["high", INPUTS.usageHigh.value]] as const;
  const scenarios: Scenario[] = usages.flatMap(([usage, d]) => (["run", "opus"] as const).map((mix): Scenario => {
    const per = mix === "run" ? allInMicrosPerDecision : opusMicrosPerDecision;
    const claudeEur = d * per / 1e6 / fx, hostingEur = hostingMicrosPerAgent / 1e6 / fx;
    const costEur = (d * per + hostingMicrosPerAgent) / 1e6 / fx;
    const marginIncluded = (revenueIncludedEur - costEur) / revenueIncludedEur, marginExtra = (extraEur - costEur) / extraEur;
    return {
      usage, mix, decisions: d, microsPerDecision: per, claudeEur, hostingEur, costEur, marginIncluded, marginExtra,
      claudeEurText: eur(claudeEur), hostingEurText: eur(hostingEur), costEurText: eur(costEur), marginIncludedText: pct(marginIncluded), marginExtraText: pct(marginExtra),
    };
  }));
  // The most decisions a month an included agent can make before its cost passes its share of the price.
  const breakEvenAt = (per: number) => Math.floor((revenueIncludedEur * fx * 1e6 - hostingMicrosPerAgent) / per + 1e-9);
  const most = agents * INPUTS.usageHigh.value;
  return {
    measured: {
      decisions,
      perAgent: st.map((a) => ({ agent: a.agent, decisions: a.decisions, model: a.models[0], costMicros: a.cost_usd_micros })),
      agentOwnMicros: ownMicros, allInMicros: allMicros, notInAgentStatsMicros: allMicros - ownMicros,
      agentOwnPerDecisionUsd: usd4(ownMicros / decisions), allInMicrosPerDecision, allInPerDecisionUsd: usd4(allInMicrosPerDecision),
    },
    opusFactor, opusMicrosPerDecision, hostingMicrosPerAgent, revenueIncludedEur, scenarios,
    breakEven: { run: breakEvenAt(allInMicrosPerDecision), opus: breakEvenAt(opusMicrosPerDecision) },
    hosting: {
      doGbSecondsPerMonth: INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400,
      workerRequestsPerDecision: INPUTS.workerIncludedRequests.value / most,
      doRequestsPerDecision: INPUTS.doIncludedRequests.value / most,
    },
  };
}
export type UnitEconomics = ReturnType<typeof unitEconomics>;

const MODEL_NAME: Record<string, string> = { "claude-haiku-5-5": "Haiku", "claude-sonnet-5-5": "Sonnet", "claude-opus-5-5": "Opus" };
const AGENT_NAME: Record<string, string> = { sourcing: "Sourcing", support: "Support", treasury: "Treasury" };
const USAGE: Record<Scenario["usage"], string> = { low: "Low", mid: "Mid", high: "High" };
const MIX: Record<Scenario["mix"], string> = { run: "The run's mix", opus: "Opus for every agent" };

/** The figures the section's prose says, each computed here. */
export function figures(u: UnitEconomics = unitEconomics()) {
  const m = u.measured;
  const range = (usage: Scenario["usage"]) => {
    const [a, b] = u.scenarios.filter((s) => s.usage === usage).map((s) => s.marginIncluded).sort((x, y) => x - y) as [number, number];
    return `${pct(a)} to ${pct(b)}`;
  };
  return {
    decisions: String(m.decisions),
    agentOwnUsd: usd4(m.agentOwnMicros), allInUsd: usd4(m.allInMicros), notInAgentStatsUsd: usd4(m.notInAgentStatsMicros),
    notInAgentStatsShare: `${Math.round(m.notInAgentStatsMicros / m.allInMicros * 100)}%`,
    agentOwnPerDecisionUsd: m.agentOwnPerDecisionUsd, allInPerDecisionUsd: m.allInPerDecisionUsd,
    opusFactor: u.opusFactor.toFixed(2), opusPerDecisionUsd: usd4(u.opusMicrosPerDecision),
    hostingPerAgentUsd: (u.hostingMicrosPerAgent / 1e6).toFixed(2), hostingPerAgentEur: eur(u.hostingMicrosPerAgent / 1e6 / INPUTS.usdPerEur.value),
    revenueIncludedEur: eur(u.revenueIncludedEur), extraAgentEur: eur(INPUTS.extraAgentEur.value),
    breakEvenRun: n(u.breakEven.run), breakEvenOpus: n(u.breakEven.opus),
    doGbSeconds: n(u.hosting.doGbSecondsPerMonth), workerRequestsPerDecision: n(u.hosting.workerRequestsPerDecision), doRequestsPerDecision: n(u.hosting.doRequestsPerDecision),
    rangeLow: range("low"), rangeMid: range("mid"), rangeHigh: range("high"),
  };
}

const cells = (xs: string[]) => `| ${xs.join(" | ")} |`;

/** The assumptions table, for Max to approve. */
export function assumptionsTable(): string {
  return [cells(["#", "Assumption (hypothesis)", "Value", "Why"]), cells(["---", "---", "---", "---"]),
    ...ASSUMPTIONS.map((a) => cells([a.id, a.what, a.value, a.why]))].join("\n");
}

/** What the main run measured, per agent and in all [R1]. */
export function measuredTable(u: UnitEconomics = unitEconomics()): string {
  const m = u.measured, f = figures(u);
  return [
    cells(["Main run, 3 November 2026 [R1]", ...m.perAgent.map((a) => `${AGENT_NAME[a.agent] ?? a.agent} (${MODEL_NAME[a.model ?? ""] ?? a.model})`), "All agents"]),
    cells(["---", ...m.perAgent.map(() => "---:"), "---:"]),
    cells(["Decisions", ...m.perAgent.map((a) => String(a.decisions)), f.decisions]),
    cells(["Claude, the agent's own calls (USD, list prices [U1])", ...m.perAgent.map((a) => usd4(a.costMicros)), f.agentOwnUsd]),
    cells(["Per decision (USD)", ...m.perAgent.map((a) => usd4(a.costMicros / a.decisions)), f.agentOwnPerDecisionUsd]),
    cells(["Every Claude call of the run, documents and reviews included (USD)", ...m.perAgent.map(() => ""), f.allInUsd]),
    cells(["Per decision, everything included (USD)", ...m.perAgent.map(() => ""), f.allInPerDecisionUsd]),
  ].join("\n");
}

/** The outcome, in EUR only: cost per agent a month and gross margin, per scenario. */
export function scenarioTable(u: UnitEconomics = unitEconomics()): string {
  const f = figures(u);
  return [
    cells(["Usage (A2)", "Decisions per agent a month", "Model mix", "Claude", "Hosting", "Cost per agent a month", `Gross margin, included agent (${f.revenueIncludedEur})`, `Gross margin, extra agent (${f.extraAgentEur})`]),
    cells(["---", "---:", "---", "---:", "---:", "---:", "---:", "---:"]),
    ...u.scenarios.map((s) => cells([USAGE[s.usage], n(s.decisions), MIX[s.mix], s.claudeEurText, s.hostingEurText, `**${s.costEurText}**`, `**${s.marginIncludedText}**`, s.marginExtraText])),
  ].join("\n");
}

/** The section's sources, one line each, with the date read. */
export function sourcesList(): string {
  return SOURCES.map((x) => `- [${x.id}] ${x.what}: ${/^https:/.test(x.url) ? x.url : `\`${x.url}\``}, ${x.id.startsWith("U") ? "read" : x.id === "R1" ? "recorded" : "run"} ${x.read}.`).join("\n");
}

/** Text without what is not a figure: link targets and URLs, source and assumption ids, the sources' own dates. */
export function labelsOut(s: string): string {
  let t = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\]\([^)]*\)/g, "] ").replace(/https?:\/\/\S+/g, " ").replace(/\b[AURP]\d+\b/g, " ");
  for (const src of SOURCES) t = t.split(src.read).join(" ");
  return t;
}

/** Every number the section and the slide may say: inputs, measured values and results, as written. */
export function allowedNumbers(): Set<string> {
  const u = unitEconomics();
  const text = [
    ...Object.values(INPUTS).flatMap((i) => [String(i.value), n(i.value)]),
    ...Object.values(figures(u)),
    ...u.scenarios.flatMap((s) => [s.claudeEurText, s.hostingEurText, s.costEurText, s.marginIncludedText, s.marginExtraText, n(s.decisions)]),
    assumptionsTable(), measuredTable(u), scenarioTable(u),
  ].join(" ");
  return new Set((labelsOut(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, "")));
}

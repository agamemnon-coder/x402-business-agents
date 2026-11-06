// Unit economics (hypothesis), Max's last round item 5.2: what a company of agents costs Purser a month against the
// intended price (PRICE in src/config/brand.ts, approved by Max on 6 November 2026 with decisions included). Measured
// inputs come from the main run's record (docs/demo/main-run.json); every other input is a sourced price or a labelled
// assumption. docs/business/model.md and the deck's business slide print what this module computes;
// test/unit-economics-hypothesis.test.ts checks both, and that no number in them is unsourced.

import { readFileSync } from "node:fs";
import { PRICES, callCostMicros, type Usage } from "../claude/pricing.js";
import { payments } from "../redesign/run.js";

/** Where docs/business/model.md's section starts and ends (the test reads between them). */
export const SECTION_START = "<!-- unit-economics -->";
export const SECTION_END = "<!-- /unit-economics -->";

export interface Source { id: string; what: string; url: string; /** The date we read it, or the record's date. */ read: string }
/** Every outside fact and record the section uses. R = this repository, U = a public page we opened. */
export const SOURCES: readonly Source[] = [
  { id: "R1", what: "The main run's record: `snapshot.agent_stats` and `snapshot.traces` (each agent's decisions, the tokens and the cost of its own Claude calls), `snapshot.claude` (every Claude call of the run, by model) and `snapshot.flows` (the payments)", url: "docs/demo/main-run.json", read: "3 November 2026" },
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
  includedDecisions: assume(1500, "A1", "Claude decisions included per company a month"),
  extraAgentEur: assume(10, "A1", "intended price per extra agent a month, EUR"),
  extraDecisionsEur: assume(3, "A1", "intended price per extra block of decisions, EUR"),
  extraDecisionsBlock: assume(100, "A1", "decisions in one extra block"),
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

const n = (x: number) => x.toLocaleString("en-GB");
/** The intended price, from the inputs; src/config/brand.ts's PRICE must say the same (the test checks). */
export const priceFromInputs = () =>
  `€${INPUTS.basePlanEur.value} per company a month, including ${INPUTS.includedAgents.value} agents and ${n(INPUTS.includedDecisions.value)} Claude decisions; €${INPUTS.extraAgentEur.value} per extra agent; €${INPUTS.extraDecisionsEur.value} per extra ${INPUTS.extraDecisionsBlock.value} decisions.`;

export interface Assumption { id: AssumptionId; what: string; value: string; why: string; inputs: InputKey[] }

/** The assumptions, approved by Max on 6 November 2026 with the price changed to include decisions. */
export const ASSUMPTIONS: readonly Assumption[] = [
  {
    id: "A1", what: "Price", value: `${priceFromInputs()} VAT excluded; a company of ${INPUTS.includedAgents.value} agents (no extra agents); extra decisions billed per started block of ${INPUTS.extraDecisionsBlock.value}`,
    why: "The intended pricing above (hypothesis); no customer has seen it. Claude's cost is per decision, so the price includes decisions and charges for more.",
    inputs: ["basePlanEur", "includedAgents", "includedDecisions", "extraAgentEur", "extraDecisionsEur", "extraDecisionsBlock"],
  },
  {
    id: "A2", what: "Usage", value: `${n(INPUTS.usageLow.value)} (low), ${n(INPUTS.usageMid.value)} (mid), ${n(INPUTS.usageHigh.value)} (high) decisions per agent a month`,
    why: "Not measured: no company has used Purser for a month. An agent calls Claude for an exception (a price change, a dispute, a payment beyond its limits), not for each routine payment, which code handles alone inside the limits. Low is a quiet agent, high a busy one; the range is the one Max proposed.",
    inputs: ["usageLow", "usageMid", "usageHigh"],
  },
  {
    id: "A3", what: "Claude per decision", value: "the main run's whole Claude bill divided by its decisions [R1], at list prices [U1], on the run's model mix",
    why: "The only measured figure. It counts every Claude call of the run, including sorting and reading documents and the Opus reviews for the CFO, so it is above the agents' own cost per decision. The run was a scenario full of exceptions; a real month may cost more or less per decision. No batch or cache discount beyond what the run used.",
    inputs: [],
  },
  {
    id: "A4", what: "Opus for every agent (one line, not in the table)", value: "the run's Claude calls repriced at Opus list prices [R1, U1]: the agents' own calls from their recorded tokens; the other calls by the price ratio, Sonnet to Opus 2×, Haiku to Opus at most 40× (an upper bound)",
    why: "Shows what routing each task to a smaller model is worth. It assumes Opus would use the same tokens for the same work, which a real run would not exactly do.",
    inputs: [],
  },
  {
    id: "A5", what: "Hosting", value: `one Cloudflare Workers Paid account per company, USD ${INPUTS.workersPlanUsd.value} a month [U2]; usage inside the plan's included amounts; a month of ${INPUTS.daysPerMonth.value} days`,
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

interface Trace { model: string; tokens: Usage; cost_usd_micros: number }
interface AgentStat { agent: string; decisions: number; cost_usd_micros: number; models: string[] }
interface Record_ { snapshot: { agent_stats: AgentStat[]; traces: Trace[]; claude: { cost_usd_micros: number; models: { model: string; cost_usd_micros: number }[] } } }
const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;

const usd4 = (micros: number) => (micros / 1e6).toFixed(4);
const eur = (x: number) => `€${x.toFixed(2)}`;
/** A margin as a whole percent, with a real minus sign. */
const pct = (m: number) => `${Math.round(m * 100) < 0 ? "−" : ""}${Math.abs(Math.round(m * 100))}%`;

const OPUS = "claude-opus-5-5";
/** The most Opus costs per token over a model, across input, cache writes, cache reads and output (an upper bound). */
function opusRatio(model: string): number {
  const o = PRICES[OPUS]!.standard, m = PRICES[model]!.standard;
  return Math.max(o.input / m.input, o.cacheWrite / m.cacheWrite, o.cacheRead / m.cacheRead, o.output / m.output);
}
/** snapshot.claude.models names a model as "Opus 5.5"; the price table by id. */
const MODEL_ID: Record<string, string> = { "Haiku 5.5": "claude-haiku-5-5", "Sonnet 5.5": "claude-sonnet-5-5", "Opus 5.5": OPUS };

export interface Scenario {
  usage: "low" | "mid" | "high"; decisionsPerAgent: number; decisionsPerCompany: number; extraBlocks: number;
  priceEur: number; claudeEur: number; hostingEur: number; costEur: number; margin: number;
  priceEurText: string; claudeEurText: string; hostingEurText: string; costEurText: string; marginText: string; agentPriceEurText: string; agentCostEurText: string;
}

export function unitEconomics() {
  const rec = readJson<Record_>("docs/demo/main-run.json");
  const s = rec.snapshot, st = s.agent_stats;
  const decisions = st.reduce((k, a) => k + a.decisions, 0);
  const ownMicros = st.reduce((k, a) => k + a.cost_usd_micros, 0);
  const allMicros = s.claude.cost_usd_micros;
  const allInMicrosPerDecision = allMicros / decisions;

  // Opus for every agent: the agents' own calls repriced from their recorded tokens; the run's other calls (sorting,
  // reading, reviews) by the most Opus costs over their model per token. The Opus calls stay as they were.
  const agentsAtOpus = s.traces.reduce((k, t) => k + callCostMicros(OPUS, t.tokens)!, 0);
  const agentsByModel = (id: string) => s.traces.filter((t) => t.model === id).reduce((k, t) => k + t.cost_usd_micros, 0);
  const othersAtOpus = s.claude.models.reduce((k, m) => {
    const id = MODEL_ID[m.model]!;
    return k + (m.cost_usd_micros - agentsByModel(id)) * opusRatio(id);
  }, 0);
  const opusMicros = agentsAtOpus + othersAtOpus;
  const opusFactor = opusMicros / allMicros;

  const pay = payments(rec as unknown as Parameters<typeof payments>[0]);
  const fx = INPUTS.usdPerEur.value;
  const agents = INPUTS.includedAgents.value;
  const hostingMicros = INPUTS.workersPlanUsd.value * 1e6;
  const usages = [["low", INPUTS.usageLow.value], ["mid", INPUTS.usageMid.value], ["high", INPUTS.usageHigh.value]] as const;
  const scenarios: Scenario[] = usages.map(([usage, d]): Scenario => {
    const perCompany = d * agents;
    const extraBlocks = Math.ceil(Math.max(0, perCompany - INPUTS.includedDecisions.value) / INPUTS.extraDecisionsBlock.value);
    const priceEur = INPUTS.basePlanEur.value + extraBlocks * INPUTS.extraDecisionsEur.value;
    const claudeEur = perCompany * allInMicrosPerDecision / 1e6 / fx, hostingEur = hostingMicros / 1e6 / fx;
    const costEur = (perCompany * allInMicrosPerDecision + hostingMicros) / 1e6 / fx;
    const margin = (priceEur - costEur) / priceEur;
    return {
      usage, decisionsPerAgent: d, decisionsPerCompany: perCompany, extraBlocks, priceEur, claudeEur, hostingEur, costEur, margin,
      priceEurText: eur(priceEur), claudeEurText: eur(claudeEur), hostingEurText: eur(hostingEur), costEurText: eur(costEur), marginText: pct(margin),
      agentPriceEurText: eur(priceEur / agents), agentCostEurText: eur(costEur / agents),
    };
  });
  const most = agents * INPUTS.usageHigh.value;
  const blockClaudeEur = INPUTS.extraDecisionsBlock.value * allInMicrosPerDecision / 1e6 / fx;
  return {
    measured: {
      decisions,
      perAgent: st.map((a) => ({ agent: a.agent, decisions: a.decisions, model: a.models[0], costMicros: a.cost_usd_micros })),
      agentOwnMicros: ownMicros, allInMicros: allMicros, notInAgentStatsMicros: allMicros - ownMicros,
      agentOwnPerDecisionUsd: usd4(ownMicros / decisions), allInMicrosPerDecision, allInPerDecisionUsd: usd4(allInMicrosPerDecision),
      payments: pay.reconciled, routinePayments: pay.routine, paymentParts: { metal: pay.onChain, cards: pay.cards, transfers: pay.transfers, sales: pay.sales, purchases: pay.purchases, refunds: pay.refunds, sweeps: pay.sweeps },
    },
    opus: { agentsAtOpusMicros: agentsAtOpus, othersAtOpusMicros: othersAtOpus, totalMicros: opusMicros, factor: opusFactor, ratios: { haiku: opusRatio("claude-haiku-5-5"), sonnet: opusRatio("claude-sonnet-5-5") } },
    hostingMicros, scenarios,
    extraBlock: { priceEur: INPUTS.extraDecisionsEur.value, claudeEur: blockClaudeEur, opusClaudeEur: blockClaudeEur * opusFactor },
    hosting: {
      doGbSecondsPerMonth: INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400,
      workerRequestsPerDecision: INPUTS.workerIncludedRequests.value / most,
      doRequestsPerDecision: INPUTS.doIncludedRequests.value / most,
    },
  };
}
export type UnitEconomics = ReturnType<typeof unitEconomics>;

/** Max's line under the table (6 Nov), with the factor the record gives, to one decimal. */
export const opusLine = (u: UnitEconomics = unitEconomics()) =>
  `If every agent ran on Opus, Claude costs would be about ${u.opus.factor.toFixed(1)}× higher; Purser gives each agent the smallest model that passed its evals.`;
/** Max's sentence 3 (6 Nov), in the wording the record supports: the decisions are not one per payment. */
export const paymentsLine = (u: UnitEconomics = unitEconomics()) =>
  `In the main run, Claude made ${u.measured.decisions} decisions; of the ${u.measured.payments} payments, ${u.measured.routinePayments} were routine sales and purchases that code handled inside the limits.`;

const MODEL_NAME: Record<string, string> = { "claude-haiku-5-5": "Haiku", "claude-sonnet-5-5": "Sonnet", "claude-opus-5-5": "Opus" };
const AGENT_NAME: Record<string, string> = { sourcing: "Sourcing", support: "Support", treasury: "Treasury" };
export const USAGE_LABEL: Record<Scenario["usage"], string> = { low: "Low", mid: "Mid", high: "High" };

/** The figures the section's prose says, each computed here. */
export function figures(u: UnitEconomics = unitEconomics()) {
  const m = u.measured;
  const [lo, hi] = [Math.min(...u.scenarios.map((s) => s.margin)), Math.max(...u.scenarios.map((s) => s.margin))];
  return {
    decisions: String(m.decisions), payments: String(m.payments), routinePayments: String(m.routinePayments),
    agentOwnUsd: usd4(m.agentOwnMicros), allInUsd: usd4(m.allInMicros), notInAgentStatsUsd: usd4(m.notInAgentStatsMicros),
    notInAgentStatsShare: `${Math.round(m.notInAgentStatsMicros / m.allInMicros * 100)}%`,
    agentOwnPerDecisionUsd: m.agentOwnPerDecisionUsd, allInPerDecisionUsd: m.allInPerDecisionUsd,
    opusFactor: u.opus.factor.toFixed(1), opusFactorExact: u.opus.factor.toFixed(2), opusUsd: usd4(u.opus.totalMicros), agentsAtOpusUsd: usd4(u.opus.agentsAtOpusMicros),
    haikuRatio: String(u.opus.ratios.haiku), sonnetRatio: String(u.opus.ratios.sonnet),
    hostingUsd: (u.hostingMicros / 1e6).toFixed(2), hostingEur: eur(u.hostingMicros / 1e6 / INPUTS.usdPerEur.value),
    extraBlockPriceEur: eur(u.extraBlock.priceEur), extraBlockClaudeEur: eur(u.extraBlock.claudeEur), extraBlockOpusEur: eur(u.extraBlock.opusClaudeEur),
    highExtraBlocks: String(u.scenarios.find((s) => s.usage === "high")!.extraBlocks),
    doGbSeconds: n(u.hosting.doGbSecondsPerMonth), workerRequestsPerDecision: n(u.hosting.workerRequestsPerDecision), doRequestsPerDecision: n(u.hosting.doRequestsPerDecision),
    marginRange: `${pct(lo)} to ${pct(hi)}`,
  };
}

const cells = (xs: string[]) => `| ${xs.join(" | ")} |`;

/** The assumptions table, as approved. */
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

/** The outcome, in EUR only: a company of 5 agents a month, and the same per agent. */
export function scenarioTable(u: UnitEconomics = unitEconomics()): string {
  return [
    cells(["Usage (A2)", "Decisions per agent a month", "Decisions per company a month", "Price per company", "Claude", "Hosting", "Cost per company", "Gross margin", "Per agent: price · cost"]),
    cells(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]),
    ...u.scenarios.map((s) => cells([USAGE_LABEL[s.usage], n(s.decisionsPerAgent), n(s.decisionsPerCompany), s.priceEurText, s.claudeEurText, s.hostingEurText, `**${s.costEurText}**`, `**${s.marginText}**`, `${s.agentPriceEurText} · ${s.agentCostEurText}`])),
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
    ...Object.values(figures(u)), ...u.measured.perAgent.map((a) => String(a.decisions)),
    ...Object.values(u.measured.paymentParts).map(String),
    ...u.scenarios.flatMap((s) => [s.priceEurText, s.claudeEurText, s.hostingEurText, s.costEurText, s.marginText, s.agentPriceEurText, s.agentCostEurText, n(s.decisionsPerAgent), n(s.decisionsPerCompany)]),
    assumptionsTable(), measuredTable(u), scenarioTable(u), opusLine(u), paymentsLine(u),
  ].join(" ");
  return new Set((labelsOut(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, "")));
}

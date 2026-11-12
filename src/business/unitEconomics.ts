// Unit economics (hypothesis), Max's last round item 5.2: what a company's invoices cost Purser a month against the
// pilot pricing (src/config/pricing.ts, 12 November 2026: a monthly plan by the number of supplier invoices; PRICE_LINE
// in src/config/brand.ts says it). Before 12 November the price was per agent with Claude decisions included (EARLIER
// below); the panel's review found two prices side by side, so there is one now. Measured inputs come from the main
// run's record (docs/demo/main-run.json) and the end-to-end sandbox run's record; every other input is a sourced price
// or a labelled assumption. docs/business/model.md and the deck's business slide print what this module computes;
// test/unit-economics-hypothesis.test.ts checks both, and that no number in them is unsourced.

import { readFileSync } from "node:fs";
import { PRICES, callCostMicros, type Usage } from "../claude/pricing.js";
import { PRICING } from "../config/pricing.js";
import { payments } from "../redesign/run.js";

/** Where docs/business/model.md's section starts and ends (the test reads between them). */
export const SECTION_START = "<!-- unit-economics -->";
export const SECTION_END = "<!-- /unit-economics -->";

/** The two records the measured part reads. */
export const MAIN_RUN_RECORD = "docs/demo/main-run.json";
export const E2E_RECORD = "docs/runs/2026-11-10-platform-e2e.md";

export interface Source { id: string; what: string; url: string; /** The date we read it, or the record's date. */ read: string }
/** Every outside fact and record the section uses. R = this repository, U = a public page we opened. */
export const SOURCES: readonly Source[] = [
  { id: "R1", what: "The main run's record: `snapshot.agent_stats` and `snapshot.traces` (each agent's decisions, the tokens and the cost of its own Claude calls), `snapshot.claude` (every Claude call of the run, by model) and `snapshot.flows` (the payments)", url: MAIN_RUN_RECORD, read: "3 November 2026" },
  { id: "R2", what: "Model benchmark, the agents' eval cases: the same cases with Purser's split and with Opus for every role ([report](../model-benchmark.md))", url: "docs/evals/model-benchmark.json", read: "31 October 2026" },
  { id: "R3", what: "The end-to-end sandbox run's record ([record](../runs/2026-11-10-platform-e2e.md)): the Claude calls of the run (classify, read and review per invoice) and the invoices it read; test companies, test money", url: E2E_RECORD, read: "10 November 2026" },
  { id: "U1", what: "Anthropic, Claude API pricing (list prices, standard routing, no batch), as `src/claude/pricing.ts` applies them to the record", url: "https://platform.claude.com/docs/en/about-claude/pricing", read: "30 October 2026" },
  { id: "U2", what: "Cloudflare, Workers pricing (Workers Paid plan; Durable Objects, SQLite storage backend)", url: "https://developers.cloudflare.com/workers/platform/pricing/", read: "6 November 2026" },
  { id: "U3", what: "European Central Bank, euro foreign exchange reference rates (USD)", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", read: "6 November 2026" },
];

type AssumptionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8";
interface Input { value: number; kind: "price" | "assumption"; /** A source id for a price, an assumption id for an assumption. */ source: string; label: string }
const price = (value: number, source: string, label: string): Input => ({ value, kind: "price", source, label });
const assume = (value: number, source: AssumptionId, label: string): Input => ({ value, kind: "assumption", source, label });

/**
 * The numbers the model starts from that are not in a record: the pilot pricing (read from src/config/pricing.ts, never
 * typed here), sourced prices and stated assumptions.
 */
export const INPUTS = {
  basePlanEur: assume(PRICING.starter.monthlyCents / 100, "A1", "Starter, per company a month, EUR"),
  includedInvoices: assume(PRICING.starter.invoicesIncluded, "A1", "invoices included in Starter a month"),
  extraInvoiceEur: assume(PRICING.starter.extraInvoiceCents / 100, "A1", "Starter, per extra invoice, EUR"),
  businessFromEur: assume(PRICING.business.fromMonthlyCents / 100, "A1", "Business, from, per month, EUR"),
  usageLow: assume(PRICING.starter.invoicesIncluded / 2, "A2", "invoices per company a month, low: half of what Starter includes"),
  usageMid: assume(PRICING.starter.invoicesIncluded, "A2", "invoices per company a month, mid: what Starter includes"),
  usageHigh: assume(PRICING.starter.invoicesIncluded * 5, "A2", "invoices per company a month, high: five times what Starter includes"),
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
/** A euro amount as the price sentence writes it: "49" for whole euros, "0.25" otherwise. */
const plain = (x: number) => (Number.isInteger(x) ? n(x) : x.toFixed(2));
/** The pilot pricing in one sentence, from the inputs; src/config/brand.ts's PRICE_LINE must say the same (the test checks). */
export const priceFromInputs = () =>
  `${PRICING.starter.name} €${plain(INPUTS.basePlanEur.value)} a month (${n(INPUTS.includedInvoices.value)} invoices, then €${plain(INPUTS.extraInvoiceEur.value)} each); ${PRICING.business.name} from €${plain(INPUTS.businessFromEur.value)} a month; a small fee per payout.`;

/**
 * The price this one replaced on 12 November 2026: per company a month with Claude decisions included (approved on 6
 * November). Kept only so the section can say what that price's own table gave at the usage it included.
 */
export const EARLIER = { baseEur: 49, includedDecisions: 1500, day: "6 November 2026" } as const;

export interface Assumption { id: AssumptionId; what: string; value: string; why: string; inputs: InputKey[] }

/**
 * The assumptions. Hosting, the runner, the currency and the Opus line are as approved by Max on 6 November 2026. The
 * price (A1) is the pilot pricing of 12 November; the usage in invoices (A2), the Claude cost per invoice (A3) and what
 * is left out (A8) were restated for it that day.
 */
export const ASSUMPTIONS: readonly Assumption[] = [
  {
    id: "A1", what: "Price", value: `${priceFromInputs()} VAT excluded; the table prices one company on ${PRICING.starter.name}; no revenue from ${PRICING.business.name} or from the fee per payout is counted`,
    why: "The pilot pricing above (hypothesis); no customer has seen it. The unit a finance team counts is the supplier invoice, and Claude's cost is per invoice read, so the plan includes invoices and charges for more.",
    inputs: ["basePlanEur", "includedInvoices", "extraInvoiceEur", "businessFromEur"],
  },
  {
    id: "A2", what: "Usage", value: `${n(INPUTS.usageLow.value)} (low), ${n(INPUTS.usageMid.value)} (mid), ${n(INPUTS.usageHigh.value)} (high) supplier invoices per company a month`,
    why: "Not measured: no company has used Purser for a month. Mid is exactly what Starter includes, low is half of it and high is five times it. Our own range, set with the pilot pricing; not a finding.",
    inputs: ["usageLow", "usageMid", "usageHigh"],
  },
  {
    id: "A3", what: "Claude per invoice", value: "the end-to-end sandbox run's Claude calls per invoice [R3] times the main run's cost per Claude call [R1], at list prices [U1]",
    why: "An estimate, not a measurement: the end-to-end run counted its Claude calls (classify, read and review per invoice), not their cost, and the main run measured what a call cost on its own mix of models, in an agents' scenario. A real month may cost more or less per invoice. No batch or cache discount beyond what the main run used.",
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
    why: "Claude and Cloudflare charge in USD and the price is in EUR. One rate, the ECB's reference rate of the day we first wrote this.",
    inputs: ["usdPerEur"],
  },
  {
    id: "A8", what: "Not in the model", value: "the platform costs: Airwallex platform or partner fees, Metal fees on mainnet, the cost of collecting our own invoices, support and people. On the revenue side: the fee per payout, which has no rate set",
    why: "Airwallex prices platform use on request [P1], so the cost is unknown; Purser has run on Metal testnet only. Gross margin here is the price minus Claude and hosting, so the real margin is lower.",
    inputs: [],
  },
];

interface Trace { model: string; tokens: Usage; cost_usd_micros: number }
interface AgentStat { agent: string; decisions: number; cost_usd_micros: number; models: string[] }
interface Record_ { snapshot: { agent_stats: AgentStat[]; traces: Trace[]; claude: { calls: number; cost_usd_micros: number; models: { model: string; cost_usd_micros: number }[] } } }
const readText = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const readJson = <T>(p: string): T => JSON.parse(readText(p)) as T;

/**
 * What the end-to-end sandbox run counted (its record, R3): the Claude calls of the run itself, and the invoices it
 * read (the rows of the record's invoice table). A record that no longer says them is an error, never a guess.
 */
export function e2eInvoiceCalls(text: string = readText(E2E_RECORD)): { calls: number; invoices: number } {
  const calls = /\| Claude \| \d+ \| \d+ \| [^|\n]*?(\d+) in the run \(classify, read and review per invoice/.exec(text)?.[1];
  const table = /### Invoices, read by Claude[^\n]*\n\n((?:\|[^\n]*\n)+)/.exec(text)?.[1];
  const invoices = (table?.split("\n").filter((l) => l.startsWith("|")).length ?? 0) - 2;
  if (!calls || invoices < 1) throw new Error(`${E2E_RECORD}: the run's Claude calls or its invoices are not in the record as expected`);
  return { calls: Number(calls), invoices };
}

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
  usage: "low" | "mid" | "high"; invoices: number; extraInvoices: number;
  priceEur: number; claudeEur: number; hostingEur: number; costEur: number; margin: number;
  priceEurText: string; claudeEurText: string; hostingEurText: string; costEurText: string; marginText: string; invoicePriceEurText: string; invoiceCostEurText: string;
}

export function unitEconomics() {
  const rec = readJson<Record_>(MAIN_RUN_RECORD);
  const s = rec.snapshot, st = s.agent_stats;
  const decisions = st.reduce((k, a) => k + a.decisions, 0);
  const ownMicros = st.reduce((k, a) => k + a.cost_usd_micros, 0);
  const allMicros = s.claude.cost_usd_micros;
  const allInMicrosPerDecision = allMicros / decisions;
  // Claude per invoice (A3), an estimate: the end-to-end run's calls per invoice times what a call cost in the main run.
  const e2e = e2eInvoiceCalls();
  const microsPerCall = allMicros / s.claude.calls;
  const callsPerInvoice = e2e.calls / e2e.invoices;
  const microsPerInvoice = callsPerInvoice * microsPerCall;

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
  const hostingMicros = INPUTS.workersPlanUsd.value * 1e6;
  const usages = [["low", INPUTS.usageLow.value], ["mid", INPUTS.usageMid.value], ["high", INPUTS.usageHigh.value]] as const;
  const scenarios: Scenario[] = usages.map(([usage, invoices]): Scenario => {
    const extraInvoices = Math.max(0, invoices - INPUTS.includedInvoices.value);
    const priceEur = INPUTS.basePlanEur.value + extraInvoices * INPUTS.extraInvoiceEur.value;
    const claudeEur = invoices * microsPerInvoice / 1e6 / fx, hostingEur = hostingMicros / 1e6 / fx;
    const costEur = (invoices * microsPerInvoice + hostingMicros) / 1e6 / fx;
    const margin = (priceEur - costEur) / priceEur;
    return {
      usage, invoices, extraInvoices, priceEur, claudeEur, hostingEur, costEur, margin,
      priceEurText: eur(priceEur), claudeEurText: eur(claudeEur), hostingEurText: eur(hostingEur), costEurText: eur(costEur), marginText: pct(margin),
      invoicePriceEurText: eur(priceEur / invoices), invoiceCostEurText: eur(costEur / invoices),
    };
  });
  const most = INPUTS.usageHigh.value;
  const invoiceClaudeEur = microsPerInvoice / 1e6 / fx;
  // The price before 12 November, at the usage it included: what its own table gave (EARLIER).
  const earlierCostEur = (EARLIER.includedDecisions * allInMicrosPerDecision + hostingMicros) / 1e6 / fx;
  return {
    measured: {
      decisions,
      perAgent: st.map((a) => ({ agent: a.agent, decisions: a.decisions, model: a.models[0], costMicros: a.cost_usd_micros })),
      agentOwnMicros: ownMicros, allInMicros: allMicros, notInAgentStatsMicros: allMicros - ownMicros,
      agentOwnPerDecisionUsd: usd4(ownMicros / decisions), allInMicrosPerDecision, allInPerDecisionUsd: usd4(allInMicrosPerDecision),
      claudeCalls: s.claude.calls, microsPerCall, perCallUsd: usd4(microsPerCall),
      e2eCalls: e2e.calls, e2eInvoices: e2e.invoices, callsPerInvoice, microsPerInvoice, perInvoiceUsd: usd4(microsPerInvoice),
      payments: pay.reconciled, routinePayments: pay.routine, paymentParts: { metal: pay.onChain, cards: pay.cards, transfers: pay.transfers, sales: pay.sales, purchases: pay.purchases, refunds: pay.refunds, sweeps: pay.sweeps },
    },
    opus: { agentsAtOpusMicros: agentsAtOpus, othersAtOpusMicros: othersAtOpus, totalMicros: opusMicros, factor: opusFactor, ratios: { haiku: opusRatio("claude-haiku-5-5"), sonnet: opusRatio("claude-sonnet-5-5") } },
    hostingMicros, scenarios,
    extraInvoice: { priceEur: INPUTS.extraInvoiceEur.value, claudeEur: invoiceClaudeEur, opusClaudeEur: invoiceClaudeEur * opusFactor },
    earlier: { costEur: earlierCostEur, margin: (EARLIER.baseEur - earlierCostEur) / EARLIER.baseEur },
    hosting: {
      doGbSecondsPerMonth: INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400,
      workerRequestsPerInvoice: INPUTS.workerIncludedRequests.value / most,
      doRequestsPerInvoice: INPUTS.doIncludedRequests.value / most,
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
/** The estimate behind the table (A3), in one sentence: both counts and the cost of a call are the records' own. */
export const invoiceLine = (u: UnitEconomics = unitEconomics()) =>
  `Claude per invoice, an estimate: USD ${u.measured.perInvoiceUsd}. The end-to-end sandbox run made ${u.measured.e2eCalls} Claude calls for ${u.measured.e2eInvoices} invoices, and a Claude call in the main run cost USD ${u.measured.perCallUsd} on average at list prices.`;
/** What the replaced price's own table gave, and why the pilot pricing differs: said once, in the section. */
export const earlierLine = (u: UnitEconomics = unitEconomics()) =>
  `The price before 12 November 2026 was per agent, with ${n(EARLIER.includedDecisions)} Claude decisions included in €${EARLIER.baseEur} a company a month; at exactly that usage its own table gave a gross margin of ${pct(u.earlier.margin)}, because it sold Claude decisions close to what they cost. The pilot pricing replaces it and sells the supplier invoice instead.`;

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
    claudeCalls: String(m.claudeCalls), perCallUsd: m.perCallUsd, e2eCalls: String(m.e2eCalls), e2eInvoices: String(m.e2eInvoices),
    callsPerInvoice: m.callsPerInvoice.toFixed(2), perInvoiceUsd: m.perInvoiceUsd,
    opusFactor: u.opus.factor.toFixed(1), opusFactorExact: u.opus.factor.toFixed(2), opusUsd: usd4(u.opus.totalMicros), agentsAtOpusUsd: usd4(u.opus.agentsAtOpusMicros),
    haikuRatio: String(u.opus.ratios.haiku), sonnetRatio: String(u.opus.ratios.sonnet),
    hostingUsd: (u.hostingMicros / 1e6).toFixed(2), hostingEur: eur(u.hostingMicros / 1e6 / INPUTS.usdPerEur.value),
    extraInvoicePriceEur: eur(u.extraInvoice.priceEur), extraInvoiceClaudeEur: eur(u.extraInvoice.claudeEur), extraInvoiceOpusEur: eur(u.extraInvoice.opusClaudeEur),
    highExtraInvoices: n(u.scenarios.find((s) => s.usage === "high")!.extraInvoices),
    doGbSeconds: n(u.hosting.doGbSecondsPerMonth), workerRequestsPerInvoice: n(u.hosting.workerRequestsPerInvoice), doRequestsPerInvoice: n(u.hosting.doRequestsPerInvoice),
    marginRange: `${pct(lo)} to ${pct(hi)}`,
    earlierMargin: pct(u.earlier.margin), earlierBaseEur: String(EARLIER.baseEur), earlierDecisions: n(EARLIER.includedDecisions),
  };
}

const cells = (xs: string[]) => `| ${xs.join(" | ")} |`;

/** The assumptions table. */
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
    cells(["Claude calls in the run", ...m.perAgent.map(() => ""), f.claudeCalls]),
    cells(["Per Claude call, everything included (USD)", ...m.perAgent.map(() => ""), f.perCallUsd]),
  ].join("\n");
}

/** The outcome, in EUR only: one company on Starter a month, and the same per invoice. */
export function scenarioTable(u: UnitEconomics = unitEconomics()): string {
  return [
    cells(["Usage (A2)", "Invoices per company a month", "Price per company", "Claude", "Hosting", "Cost per company", "Gross margin", "Per invoice: price · cost"]),
    cells(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]),
    ...u.scenarios.map((s) => cells([USAGE_LABEL[s.usage], n(s.invoices), s.priceEurText, s.claudeEurText, s.hostingEurText, `**${s.costEurText}**`, `**${s.marginText}**`, `${s.invoicePriceEurText} · ${s.invoiceCostEurText}`])),
  ].join("\n");
}

/** The section's sources, one line each, with the date read. */
export function sourcesList(): string {
  return SOURCES.map((x) => `- [${x.id}] ${x.what}: ${/^https:/.test(x.url) ? x.url : `\`${x.url}\``}, ${x.id.startsWith("U") ? "read" : x.id === "R1" ? "recorded" : "run"} ${x.read}.`).join("\n");
}

/**
 * The whole section of docs/business/model.md, from SECTION_START to SECTION_END: the tables above and the prose around
 * them, every figure put in here by code. The doc holds exactly this text (the test compares them), so a number in it
 * is never typed by hand. To renew the doc after a record or an input changes, print this and paste it between the marks.
 */
export function sectionMarkdown(u: UnitEconomics = unitEconomics()): string {
  const f = figures(u), fx = INPUTS.usdPerEur.value, mid = u.scenarios.find((s) => s.usage === "mid")!;
  const rate = `EUR 1 = USD ${fx}`;
  return [
    SECTION_START,
    "## Unit economics (hypothesis)",
    "",
    `**A hypothesis, not a result.** What a company's supplier invoices would cost Purser a month, against the pilot pricing above. The measured part comes from the main run of 3 November 2026 and the end-to-end sandbox run of 10 November 2026; everything else is a price we read, with its page and date, or an assumption stated below. Hosting, the currency and the Opus line are as Max approved them on 6 November 2026; the usage in invoices and the Claude cost per invoice were restated for the pilot pricing. This section is written by \`src/business/unitEconomics.ts\` (\`sectionMarkdown\`); \`test/unit-economics-hypothesis.test.ts\` checks that this page holds exactly what it computes from the records and the assumptions, and that no number is unsourced.`,
    "",
    "### Measured in the main run",
    "",
    measuredTable(u),
    "",
    `**Claude per decision: USD ${f.agentOwnPerDecisionUsd} for the agents' own calls, USD ${f.allInPerDecisionUsd} for every Claude call of the run.** The agents' own calls (\`agent_stats\`) come to USD ${f.agentOwnUsd} for ${f.decisions} decisions, the figure in [claims.md](../claims.md). The run's whole Claude bill (\`snapshot.claude\`) is USD ${f.allInUsd} for ${f.claudeCalls} calls: it also sorted and read the documents and ran the Opus reviews for the CFO, USD ${f.notInAgentStatsUsd} or ${f.notInAgentStatsShare} of the bill. This model uses the whole bill: USD ${f.perCallUsd} a call.`,
    "",
    `**${paymentsLine(u)}** The ${f.decisions} decisions are not one per payment: they are the agents' checks, plans, proposals, a dispute ruling and timing advice, several of which moved no money. The ${f.payments} payments are ${u.measured.paymentParts.metal} on Metal (${u.measured.paymentParts.sales} sales, ${u.measured.paymentParts.purchases} supplier purchases, ${u.measured.paymentParts.refunds} refunds, ${u.measured.paymentParts.sweeps} sweep), ${u.measured.paymentParts.cards} card charge and ${u.measured.paymentParts.transfers} SWIFT transfer [R1].`,
    "",
    `**${invoiceLine(u)}** That is ${f.callsPerInvoice} calls an invoice [R3] at the main run's cost per call [R1]. No record holds a measured Claude cost per invoice, so this is an assumption (A3), not a measurement.`,
    "",
    "### Assumptions (hypothesis)",
    "",
    assumptionsTable(),
    "",
    `**Hosting check (A5), at Cloudflare's prices [U2].** The Workers Paid plan costs USD ${INPUTS.workersPlanUsd.value} a month per account and includes ${n(INPUTS.workerIncludedRequests.value)} Worker requests, ${n(INPUTS.doIncludedRequests.value)} Durable Object requests and ${n(INPUTS.doIncludedGbS.value)} GB-s of Durable Object duration a month. A Durable Object is billed for ${INPUTS.doMemoryMb.value} MB; awake all ${INPUTS.daysPerMonth.value} days, one uses ${f.doGbSeconds} GB-s, inside what is included. At high usage (${n(INPUTS.usageHigh.value)} invoices a month), the included requests allow ${f.workerRequestsPerInvoice} Worker requests and ${f.doRequestsPerInvoice} Durable Object requests per invoice. Hosting is USD ${f.hostingUsd}, or ${f.hostingEur}, per company a month.`,
    "",
    `### Outcome: one company on ${PRICING.starter.name} a month (hypothesis)`,
    "",
    `In EUR only, at ${rate}, the ECB's reference rate of 6 November 2026 [U3]. Gross margin = (price − Claude − hosting) ÷ price. Price per company = €${plain(INPUTS.basePlanEur.value)}, plus ${f.extraInvoicePriceEur} for each invoice above ${n(INPUTS.includedInvoices.value)} (at high usage, ${f.highExtraInvoices} of them).`,
    "",
    scenarioTable(u),
    "",
    opusLine(u),
    "",
    `**Gross margin per company (hypothesis): ${f.marginRange}** across low, mid and high usage, before the platform costs (A8). It is lowest at exactly ${n(mid.invoices)} invoices a month, the most ${PRICING.starter.name} includes; above that, each extra invoice earns ${f.extraInvoicePriceEur} and costs ${f.extraInvoiceClaudeEur} in Claude on this estimate.`,
    "",
    `**What this margin leaves out, and what it replaced.** It is the price minus Claude and hosting only. Airwallex's platform or partner fees, support and people are not in it (A8), so the real margin is lower; the fee per payout is not in it either, because it has no rate set. ${earlierLine(u)}`,
    "",
    `**Where the Opus factor comes from (A4).** It is the run's own Claude calls repriced at Opus list prices: USD ${f.opusUsd} instead of USD ${f.allInUsd}, ${f.opusFactorExact} times. The agents' own calls, from their recorded tokens, would cost USD ${f.agentsAtOpusUsd}; the other calls are scaled by ${f.sonnetRatio} (Sonnet) and at most ${f.haikuRatio} (Haiku); the Opus calls stay as they were. At that factor, an extra invoice would cost ${f.extraInvoiceOpusEur} in Claude against the ${f.extraInvoicePriceEur} it earns. On the benchmark's eval cases the factor is higher [R2], because Purser's split there runs only the reviews on Opus; in the main run the Treasury agent already ran on Opus.`,
    "",
    "For a different measure, per customer query in the demo's own business, see [unit-economics.md](../unit-economics.md).",
    "",
    "**Sources for this section:**",
    "",
    sourcesList(),
    SECTION_END,
  ].join("\n");
}

/** Text without what is not a figure: link targets, URLs and the records' own paths, source and assumption ids, the sources' own dates. */
export function labelsOut(s: string): string {
  let t = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\]\([^)]*\)/g, "] ").replace(/https?:\/\/\S+/g, " ").replace(/\b[AURP]\d+\b/g, " ");
  for (const src of SOURCES) t = t.split(src.read).join(" ").split(src.url).join(" ");
  return t;
}

/** Every number the section and the slide may say: inputs, measured values and results, as written. */
export function allowedNumbers(): Set<string> {
  const u = unitEconomics();
  const text = [
    ...Object.values(INPUTS).flatMap((i) => [String(i.value), n(i.value)]),
    ...Object.values(figures(u)), ...u.measured.perAgent.map((a) => String(a.decisions)),
    ...Object.values(u.measured.paymentParts).map(String),
    ...u.scenarios.flatMap((s) => [s.priceEurText, s.claudeEurText, s.hostingEurText, s.costEurText, s.marginText, s.invoicePriceEurText, s.invoiceCostEurText, n(s.invoices), n(s.extraInvoices)]),
    assumptionsTable(), measuredTable(u), scenarioTable(u), opusLine(u), paymentsLine(u), invoiceLine(u), earlierLine(u),
  ].join(" ");
  return new Set((labelsOut(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, "")));
}

// Max's last round, item 5.2: "Unit economics (hypothesis)". What one agent costs Purser a month against the intended
// price, from the main run's record (docs/demo/main-run.json) and a short list of stated assumptions, each with its
// source. docs/business/model.md and the deck's business slide say the numbers src/business/unitEconomics.ts computes;
// every number in that section and on that slide is a measured value, a sourced price, a stated assumption or a
// result. Not linked from the site until Max approves the assumptions. Breaks when a number drifts or loses its source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { buildPages } from "../src/relay/assets.js";
import {
  ASSUMPTIONS, INPUTS, SECTION_END, SECTION_START, SOURCES, allowedNumbers, assumptionsTable, measuredTable, scenarioTable, sourcesList, unitEconomics,
} from "../src/business/unitEconomics.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const RECORD = JSON.parse(read("docs/demo/main-run.json")) as {
  snapshot: { agent_stats: { agent: string; decisions: number; cost_usd_micros: number; models: string[] }[]; claude: { cost_usd_micros: number } };
};
const BENCH = JSON.parse(read("docs/evals/model-benchmark.json")) as { sets: { core: { rows: { id: string; cost_usd_micros: number }[] } } };
const MODEL = read("docs/business/model.md");
const SECTION = MODEL.slice(MODEL.indexOf(SECTION_START), MODEL.indexOf(SECTION_END) + SECTION_END.length);
const ue = unitEconomics();
/** Numbers as written (thousands separators dropped, sign ignored). */
const numbers = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
/** Text without what is not a figure: URLs and link targets, source and assumption ids, the sources' own dates. */
function figuresOnly(s: string): string {
  let t = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\]\([^)]*\)/g, "] ").replace(/https?:\/\/\S+/g, " ").replace(/\b[AURP]\d+\b/g, " ");
  for (const src of SOURCES) t = t.split(src.read).join(" ");
  return t;
}
const OTHERS = /\b(Pleo|Ramp|Brex|Spendesk|Payhawk|Expensify|Mercury|Revolut|Wise|Stripe|Mastercard|Coinbase|Google|Visa)\b/;

describe("measured, from the main run's record", () => {
  const st = RECORD.snapshot.agent_stats;
  const decisions = st.reduce((n, a) => n + a.decisions, 0);

  it("Claude's cost per decision: USD 0.0132 for the agents' own calls, as Max says; USD 0.0157 with every Claude call of the run", () => {
    const own = st.reduce((n, a) => n + a.cost_usd_micros, 0);
    expect([own, decisions]).toEqual([316966, 24]);
    expect((own / decisions / 1e6).toFixed(4)).toBe("0.0132");
    expect(ue.measured.agentOwnPerDecisionUsd).toBe("0.0132");
    // The run's whole Claude bill also sorted and read documents and ran the Opus reviews for the CFO.
    expect(RECORD.snapshot.claude.cost_usd_micros).toBe(376128);
    expect(ue.measured.allInMicrosPerDecision).toBe(RECORD.snapshot.claude.cost_usd_micros / decisions);
    expect(ue.measured.allInPerDecisionUsd).toBe("0.0157");
    expect(ue.measured.notInAgentStatsMicros).toBe(376128 - 316966);
  });

  it("the decisions per agent, as the record counts them", () => {
    expect(ue.measured.perAgent).toEqual(st.map((a) => ({ agent: a.agent, decisions: a.decisions, model: a.models[0], costMicros: a.cost_usd_micros })));
    expect(ue.measured.perAgent.map((a) => [a.agent, a.decisions])).toEqual([["sourcing", 11], ["support", 4], ["treasury", 9]]);
    expect(ue.measured.decisions).toBe(decisions);
  });

  it("the Opus factor is the benchmark's: Opus for every role over Purser's split, on the agents' eval cases", () => {
    const row = (id: string) => BENCH.sets.core.rows.find((r) => r.id === id)!.cost_usd_micros;
    expect(ue.opusFactor).toBe(row("opus") / row("purser"));
    expect(ue.opusMicrosPerDecision).toBe(Math.round(ue.measured.allInMicrosPerDecision * row("opus") / row("purser")));
  });
});

describe("the calculation", () => {
  it("costs an agent's month as decisions × Claude per decision + hosting per agent, in EUR at the stated rate", () => {
    const fx = INPUTS.usdPerEur.value;
    for (const s of ue.scenarios) {
      const usd = (s.decisions * s.microsPerDecision + ue.hostingMicrosPerAgent) / 1e6;
      expect(s.costEur).toBeCloseTo(usd / fx, 10);
      expect(s.marginIncluded).toBeCloseTo((ue.revenueIncludedEur - s.costEur) / ue.revenueIncludedEur, 10);
      expect(s.marginExtra).toBeCloseTo((INPUTS.extraAgentEur.value - s.costEur) / INPUTS.extraAgentEur.value, 10);
    }
    expect(ue.revenueIncludedEur).toBe(INPUTS.basePlanEur.value / INPUTS.includedAgents.value);
    expect(ue.hostingMicrosPerAgent).toBe(INPUTS.workersPlanUsd.value * 1e6 / INPUTS.includedAgents.value);
  });

  it("covers low, mid and high usage on the run's mix and with Opus for every agent, and says plainly where the margin goes negative", () => {
    expect(ue.scenarios.map((s) => `${s.usage}/${s.mix}`)).toEqual(["low/run", "low/opus", "mid/run", "mid/opus", "high/run", "high/opus"]);
    expect(ue.scenarios.map((s) => s.decisions)).toEqual([100, 100, 300, 300, 1000, 1000]);
    const neg = ue.scenarios.filter((s) => s.marginIncluded < 0).map((s) => `${s.usage}/${s.mix}`);
    expect(neg).toEqual(["mid/opus", "high/run", "high/opus"]);
    expect(SECTION).toContain("negative");
  });

  it("finds the break-even usage per included agent", () => {
    for (const [mix, b] of [["run", ue.breakEven.run], ["opus", ue.breakEven.opus]] as const) {
      const per = mix === "run" ? ue.measured.allInMicrosPerDecision : ue.opusMicrosPerDecision;
      const cost = (n: number) => (n * per + ue.hostingMicrosPerAgent) / 1e6 / INPUTS.usdPerEur.value;
      expect(cost(b)).toBeLessThanOrEqual(ue.revenueIncludedEur);
      expect(cost(b + 1)).toBeGreaterThan(ue.revenueIncludedEur);
    }
    expect([ue.breakEven.run, ue.breakEven.opus]).toEqual([634, 217]);
  });

  it("checks the hosting assumption against the plan's included usage: one Durable Object awake all month fits", () => {
    expect(ue.hosting.doGbSecondsPerMonth).toBe(INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400);
    expect(ue.hosting.doGbSecondsPerMonth).toBeLessThanOrEqual(INPUTS.doIncludedGbS.value);
    const most = INPUTS.includedAgents.value * INPUTS.usageHigh.value;
    expect(ue.hosting.workerRequestsPerDecision).toBe(INPUTS.workerIncludedRequests.value / most);
    expect(ue.hosting.doRequestsPerDecision).toBe(INPUTS.doIncludedRequests.value / most);
  });
});

describe("no unsourced numbers", () => {
  it("every input names a source that exists, with its URL and the date it was read", () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const [k, i] of Object.entries(INPUTS)) {
      // A price names its page; an assumption names the row of the assumptions table that states it.
      if (i.kind === "price") expect({ k, source: ids.has(i.source) }).toEqual({ k, source: true });
      else expect({ k, stated: ASSUMPTIONS.find((a) => a.id === i.source)?.inputs.includes(k as keyof typeof INPUTS) ?? false }).toEqual({ k, stated: true });
    }
    for (const s of SOURCES) {
      expect({ id: s.id, url: /^(https:\/\/|docs\/|src\/)/.test(s.url) }).toEqual({ id: s.id, url: true });
      expect({ id: s.id, read: /\d{1,2} (?:October|November) 2026/.test(s.read) }).toEqual({ id: s.id, read: true });
    }
    // The prices we read from the web on 6 November 2026 say so.
    expect(SOURCES.find((s) => s.id === "U2")!.url).toBe("https://developers.cloudflare.com/workers/platform/pricing/");
    expect(SOURCES.find((s) => s.id === "U3")!.url).toBe("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  });

  it("every assumption is labelled, says why, and names its inputs", () => {
    for (const a of ASSUMPTIONS) {
      expect(a.id).toMatch(/^A\d+$/);
      expect(a.why.length).toBeGreaterThan(30);
      for (const k of a.inputs) expect({ a: a.id, k, known: k in INPUTS }).toEqual({ a: a.id, k, known: true });
    }
    const assumed = Object.entries(INPUTS).filter(([, i]) => i.kind === "assumption").map(([k]) => k);
    for (const k of assumed) expect({ k, listed: ASSUMPTIONS.some((a) => a.inputs.includes(k as keyof typeof INPUTS)) }).toEqual({ k, listed: true });
  });

  it("every number in model.md's section is a measured value, a sourced price, a stated assumption or a result", () => {
    const allowed = allowedNumbers();
    const stray = numbers(figuresOnly(SECTION)).filter((n) => !allowed.has(n));
    expect(stray).toEqual([]);
  });
});

describe("docs/business/model.md", () => {
  it("has the section, marked hypothesis, with the tables the module computes", () => {
    expect(MODEL).toContain(SECTION_START);
    expect(MODEL).toContain(SECTION_END);
    expect(SECTION).toContain("## Unit economics (hypothesis)");
    expect(SECTION).toContain(assumptionsTable());
    expect(SECTION).toContain(measuredTable());
    expect(SECTION).toContain(scenarioTable());
    expect(SECTION).toContain(sourcesList());
    expect(SECTION.match(/hypothesis/gi)!.length).toBeGreaterThanOrEqual(3);
  });

  it("says the outcome in one currency (EUR), with the rate, its date and its source", () => {
    expect(scenarioTable()).not.toMatch(/USD|\$/);
    expect(SECTION).toContain("EUR 1 = USD 1.1165");
    expect(SECTION).toContain("6 November 2026");
    expect(SECTION).toContain("[U3]");
  });

  it("names no competitor, no customer, no saving and no traction", () => {
    expect(OTHERS.exec(SECTION)?.[0] ?? null).toBeNull();
    expect(SECTION).not.toMatch(/\bsaves?\b|\bsavings?\b|our customers|traction|pilot customer/i);
  });

  it("is not linked from the site, the README or the form yet (Max approves the assumptions first)", () => {
    const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, linked: /unit-economics-hypothesis/.test(body) }).toEqual({ name, linked: false });
    for (const p of ["README.md", "docs/submission/README.md", "docs/business/README.md"]) expect({ p, linked: /unit-economics-hypothesis/.test(read(p)) }).toEqual({ p, linked: false });
  });
});

describe("the deck's business slide", () => {
  const shots = new Proxy({}, { get: () => "" }) as DeckShots;
  const slide = deckHtml(packFacts(), shots, "").split("<section").slice(1)[10]!;
  const text = slide.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("is \"Unit economics (hypothesis)\", merged into the business slide, with the not-validated note", () => {
    expect(slide).toContain("<h1>Unit economics (hypothesis)</h1>");
    expect(text).toContain(WHY_COMPANY_NOTE);
    expect(text).toMatch(/hypothesis/i);
  });

  it("shows the same numbers as model.md", () => {
    for (const s of ue.scenarios) {
      expect(text).toContain(s.costEurText);
      expect(text).toContain(s.marginIncludedText);
    }
    for (const n of [ue.measured.allInPerDecisionUsd, ue.measured.agentOwnPerDecisionUsd, String(ue.breakEven.run), String(ue.breakEven.opus), "1.1165"]) expect({ n, on: text.includes(n) }).toEqual({ n, on: true });
    for (const v of ["100", "300", "1,000"]) expect(text).toContain(v);
  });

  it("has no unsourced number (the business lines from brand.ts aside, which test/first-screen.test.ts checks)", () => {
    let t = text;
    for (const l of WHY_COMPANY) t = t.split(l.text).join(" ");
    const stray = numbers(figuresOnly(t)).filter((n) => !allowedNumbers().has(n));
    expect(stray).toEqual([]);
  });
});

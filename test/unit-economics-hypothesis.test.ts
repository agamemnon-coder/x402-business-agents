// Max's last round, item 5.2: "Unit economics (hypothesis)". What a company of agents costs Purser a month against the
// intended price, from the main run's record (docs/demo/main-run.json) and a short list of stated assumptions, each
// with its source; approved by Max on 6 November with three changes (decisions in the price, one Opus line instead of
// an Opus column, the payments sentence as the record supports it). docs/business/model.md and the deck's business
// slide say the numbers src/business/unitEconomics.ts computes; every number in that section and on that slide is a
// measured value, a sourced price, a stated assumption or a result; the price is the same sentence everywhere. Breaks
// when a number drifts, loses its source, or a surface says another price.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICE_LINE, WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { PRICES, callCostMicros } from "../src/claude/pricing.js";
import { homePage } from "../src/redesign/home.js";
import { payments, split } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import {
  ASSUMPTIONS, INPUTS, SECTION_END, SECTION_START, SOURCES, allowedNumbers, assumptionsTable, measuredTable, opusLine, paymentsLine, priceFromInputs,
  scenarioTable, sourcesList, unitEconomics,
} from "../src/business/unitEconomics.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
interface Rec {
  snapshot: {
    agent_stats: { agent: string; decisions: number; cost_usd_micros: number; models: string[] }[];
    traces: { model: string; task: string; cost_usd_micros: number; tokens: { input: number; output: number; cache_read: number; cache_write: number } }[];
    claude: { cost_usd_micros: number; models: { model: string; cost_usd_micros: number }[] };
  };
}
const RECORD = JSON.parse(read("docs/demo/main-run.json")) as Rec;
const MODEL = read("docs/business/model.md");
const SECTION = MODEL.slice(MODEL.indexOf(SECTION_START), MODEL.indexOf(SECTION_END) + SECTION_END.length);
const ue = unitEconomics();
const DECK_SLIDE = deckHtml(packFacts(), new Proxy({}, { get: () => "" }) as DeckShots, "").split("<section").slice(1)[10]!;
const DECK_TEXT = DECK_SLIDE.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
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

  it("the payments sentence, as the record has it: 24 decisions, 88 payments, 82 of them routine code (not \"24 of 88 payments\")", () => {
    const rec = RECORD as unknown as Parameters<typeof payments>[0];
    const pay = payments(rec), sp = split(rec);
    expect([pay.onChain, pay.cards, pay.transfers, pay.reconciled, pay.routine, pay.sales, pay.purchases, pay.refunds, pay.sweeps]).toEqual([86, 1, 1, 88, 82, 41, 41, 3, 1]);
    expect(sp.decisions).toBe(24);
    expect(paymentsLine()).toBe(`In the main run, Claude made ${sp.decisions} decisions; of the ${pay.reconciled} payments, ${pay.routine} were routine sales and purchases that code handled inside the limits.`);
    // The decisions are not one per payment: the agents' runs were checks, plans, proposals, a dispute ruling, advice.
    expect(new Set(RECORD.snapshot.traces.map((t) => t.task.split(".")[0]))).toEqual(new Set(["wake", "price_rise", "dispute", "licence"]));
    expect(sp.decisions).not.toBe(pay.reconciled - pay.routine);
    expect(SECTION).toContain(paymentsLine());
    expect(SECTION + DECK_TEXT).not.toMatch(/decided \d+ of \d+ payments/);
  });

  it("the Opus factor: the run's own Claude calls repriced at Opus list prices, about 2.1×, said as computed", () => {
    const opus = "claude-opus-5-5", t = RECORD.snapshot.traces;
    const agents = t.reduce((k, x) => k + callCostMicros(opus, x.tokens)!, 0);
    expect(agents).toBe(696982);
    const id: Record<string, string> = { "Haiku 5.5": "claude-haiku-5-5", "Sonnet 5.5": "claude-sonnet-5-5", "Opus 5.5": opus };
    const ratio = (m: string) => {
      const o = PRICES[opus]!.standard, p = PRICES[m]!.standard;
      return Math.max(o.input / p.input, o.cacheWrite / p.cacheWrite, o.cacheRead / p.cacheRead, o.output / p.output);
    };
    expect([ratio("claude-haiku-5-5"), ratio("claude-sonnet-5-5"), ratio(opus)]).toEqual([40, 2, 1]);
    const others = RECORD.snapshot.claude.models.reduce((k, m) => k + (m.cost_usd_micros - t.filter((x) => x.model === id[m.model]).reduce((j, x) => j + x.cost_usd_micros, 0)) * ratio(id[m.model]!), 0);
    const factor = (agents + others) / RECORD.snapshot.claude.cost_usd_micros;
    expect(ue.opus.factor).toBe(factor);
    expect(factor.toFixed(2)).toBe("2.07");
    expect(opusLine()).toBe(`If every agent ran on Opus, Claude costs would be about ${factor.toFixed(1)}× higher; Purser routes each task to the smallest model that does it.`);
    expect(SECTION).toContain(opusLine());
    expect(DECK_TEXT).toContain(opusLine());
    // Not the benchmark's factor (Purser's split there runs only the reviews on Opus), and not 2.7.
    expect(SECTION + DECK_TEXT).not.toMatch(/2\.7×|2\.92/);
  });
});

describe("the calculation", () => {
  it("prices a company of 5 agents (€49 with 1,500 decisions, €3 per started 100 more) and costs Claude per decision + hosting, in EUR", () => {
    const fx = INPUTS.usdPerEur.value;
    for (const s of ue.scenarios) {
      expect(s.decisionsPerCompany).toBe(s.decisionsPerAgent * INPUTS.includedAgents.value);
      const extra = Math.ceil(Math.max(0, s.decisionsPerCompany - INPUTS.includedDecisions.value) / INPUTS.extraDecisionsBlock.value);
      expect(s.priceEur).toBe(INPUTS.basePlanEur.value + extra * INPUTS.extraDecisionsEur.value);
      const usd = (s.decisionsPerCompany * ue.measured.allInMicrosPerDecision + INPUTS.workersPlanUsd.value * 1e6) / 1e6;
      expect(s.costEur).toBeCloseTo(usd / fx, 10);
      expect(s.margin).toBeCloseTo((s.priceEur - s.costEur) / s.priceEur, 10);
    }
  });

  it("gives low, mid and high usage, all positive on the run's mix, lowest at the 1,500 the base price includes", () => {
    expect(ue.scenarios.map((s) => [s.usage, s.decisionsPerAgent, s.decisionsPerCompany, s.priceEurText, s.costEurText, s.marginText])).toEqual([
      ["low", 100, 500, "€49.00", "€11.50", "77%"], ["mid", 300, 1500, "€49.00", "€25.53", "48%"], ["high", 1000, 5000, "€154.00", "€74.66", "52%"],
    ]);
    expect(Math.min(...ue.scenarios.map((s) => s.margin))).toBe(ue.scenarios.find((s) => s.usage === "mid")!.margin);
    expect(ue.extraBlock.claudeEur).toBeLessThan(ue.extraBlock.priceEur);
    expect(ue.extraBlock.opusClaudeEur).toBeLessThan(ue.extraBlock.priceEur);
  });

  it("checks the hosting assumption against the plan's included usage: one Durable Object awake all month fits", () => {
    expect(ue.hosting.doGbSecondsPerMonth).toBe(INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400);
    expect(ue.hosting.doGbSecondsPerMonth).toBeLessThanOrEqual(INPUTS.doIncludedGbS.value);
    const most = INPUTS.includedAgents.value * INPUTS.usageHigh.value;
    expect(ue.hosting.workerRequestsPerDecision).toBe(INPUTS.workerIncludedRequests.value / most);
    expect(ue.hosting.doRequestsPerDecision).toBe(INPUTS.doIncludedRequests.value / most);
  });
});

describe("the price, word for word everywhere (Max, 6 Nov)", () => {
  /** Every Markdown, TypeScript and HTML file under docs/ and src/ (records aside), the README, the built Home and the deck. */
  function surfaces(): [string, string][] {
    const out: [string, string][] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
        const p = `${dir}/${name}`;
        if (statSync(new URL(`../${p}`, import.meta.url)).isDirectory()) { if (!["docs/demo", "docs/redteam", "docs/runs", "docs/evals"].includes(p)) walk(p); }
        else if (/\.(md|ts|html)$/.test(name)) out.push([p, read(p)]);
      }
    };
    walk("docs"); walk("src");
    out.push(["README.md", read("README.md")], ["home", homePage()], ["deck", DECK_TEXT]);
    return out;
  }

  it("is the approved sentence, built from the model's own inputs", () => {
    expect(PRICE_LINE).toBe("€49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions.");
    expect(priceFromInputs()).toBe(PRICE_LINE);
  });

  it("every price statement is that sentence, and the old price is gone", () => {
    const seen = new Set<string>();
    for (const [name, raw] of surfaces()) {
      const t = raw.replace(/\s*\n\s*/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      for (const m of t.matchAll(/€49 per company|€10 per extra agent|€3 per extra/g)) {
        const at = t.lastIndexOf("€49 per company", m.index);
        expect({ name, same: at >= 0 && t.slice(at, at + PRICE_LINE.length) === PRICE_LINE && m.index < at + PRICE_LINE.length }).toEqual({ name, same: true });
        seen.add(name);
      }
      expect({ name, old: /EUR 49|EUR 10 (?:a month )?for each extra agent|including 5 agents;|€10 a month for each extra agent/.test(t) }).toEqual({ name, old: false });
    }
    for (const name of ["README.md", "docs/submission/README.md", "docs/business/model.md", "docs/submission/qa.md", "docs/claims.md", "home", "deck", "src/config/brand.ts"]) expect({ name, said: seen.has(name) }).toEqual({ name, said: true });
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
    expect(SOURCES.find((s) => s.id === "U2")!.url).toBe("https://developers.cloudflare.com/workers/platform/pricing/");
    expect(SOURCES.find((s) => s.id === "U3")!.url).toBe("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  });

  it("every assumption is labelled, says why, and names its inputs", () => {
    for (const a of ASSUMPTIONS) {
      expect(a.id).toMatch(/^A\d+$/);
      expect(a.why.length).toBeGreaterThan(30);
      for (const k of a.inputs) expect({ a: a.id, k, known: k in INPUTS }).toEqual({ a: a.id, k, known: true });
    }
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
    // The Opus line sits right under the outcome table (Max, 6 Nov).
    expect(SECTION).toContain(`${scenarioTable()}\n\n${opusLine()}`);
  });

  it("says the outcome in one currency (EUR), with the rate, its date and its source", () => {
    expect(scenarioTable()).not.toMatch(/USD|\$/);
    expect(DECK_SLIDE.slice(DECK_SLIDE.indexOf("<table"), DECK_SLIDE.indexOf("</table>"))).not.toMatch(/USD|\$/);
    expect(SECTION).toContain("EUR 1 = USD 1.1165");
    expect(SECTION).toContain("6 November 2026");
    expect(SECTION).toContain("[U3]");
  });

  it("names no competitor, no customer, no saving and no traction", () => {
    expect(OTHERS.exec(SECTION)?.[0] ?? null).toBeNull();
    expect(OTHERS.exec(DECK_TEXT)?.[0] ?? null).toBeNull();
    expect(SECTION + DECK_TEXT).not.toMatch(/\bsaves?\b|\bsavings?\b|our customers|traction|pilot customer/i);
  });

  it("is not linked from the site, the README or the form yet (the coordinator's go comes after #71's deploy)", () => {
    const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, linked: /unit-economics-hypothesis/.test(body) }).toEqual({ name, linked: false });
    for (const p of ["README.md", "docs/submission/README.md", "docs/business/README.md"]) expect({ p, linked: /unit-economics-hypothesis/.test(read(p)) }).toEqual({ p, linked: false });
  });
});

describe("the deck's business slide", () => {
  it("is \"Unit economics (hypothesis)\", merged into the business slide, with the not-validated note and the price", () => {
    expect(DECK_SLIDE).toContain("<h1>Unit economics (hypothesis)</h1>");
    expect(DECK_TEXT).toContain(WHY_COMPANY_NOTE);
    expect(DECK_TEXT).toContain(PRICE_LINE);
  });

  it("shows the same numbers as model.md, the Opus line and the payments sentence", () => {
    for (const s of ue.scenarios) for (const v of [s.priceEurText, s.costEurText, s.marginText, s.decisionsPerAgent.toLocaleString("en-GB"), s.decisionsPerCompany.toLocaleString("en-GB")]) expect({ v, on: DECK_TEXT.includes(v) }).toEqual({ v, on: true });
    expect(DECK_TEXT).toContain(opusLine());
    expect(DECK_TEXT).toContain(paymentsLine());
    expect(DECK_TEXT).toContain(`USD ${ue.measured.allInPerDecisionUsd}`);
    expect(DECK_TEXT).toContain("1.1165");
  });

  it("has no unsourced number (the business lines from brand.ts aside, which test/first-screen.test.ts checks)", () => {
    let t = DECK_TEXT;
    for (const l of WHY_COMPANY) t = t.split(l.text).join(" ");
    const stray = numbers(figuresOnly(t)).filter((n) => !allowedNumbers().has(n));
    expect(stray).toEqual([]);
  });
});

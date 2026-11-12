// Max's last round, item 5.2: "Unit economics (hypothesis)". What a company's supplier invoices cost Purser a month
// against the pilot pricing (src/config/pricing.ts, 12 November: one model, a monthly plan by invoices plus a small fee
// per payout; it replaced the price per agent with Claude decisions included, 6 November), from the main run's record
// (docs/demo/main-run.json), the end-to-end sandbox run's record and a short list of stated assumptions, each with its
// source. docs/business/model.md's section is exactly what src/business/unitEconomics.ts writes, and the deck's
// business slide says the same numbers; every number there is a measured value, a sourced price, a stated assumption
// or a result; the price is the same sentence everywhere. Breaks when a number drifts, loses its source, or a surface
// says another price.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICE_LINE, WHY_COMPANY, WHY_COMPANY_NOTE } from "../src/config/brand.js";
import { PRICING, PRICING_LABEL, PRICING_LINE } from "../src/config/pricing.js";
import { PRICES, callCostMicros } from "../src/claude/pricing.js";
import { proofPage } from "../src/redesign/proof.js";
import { payments, split } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import {
  ASSUMPTIONS, E2E_RECORD, EARLIER, INPUTS, SECTION_END, SECTION_START, SOURCES, allowedNumbers, assumptionsTable, e2eInvoiceCalls, earlierLine, invoiceLine, measuredTable, opusLine,
  paymentsLine, priceFromInputs, scenarioTable, sectionMarkdown, sourcesList, unitEconomics,
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
  for (const src of SOURCES) t = t.split(src.read).join(" ").split(src.url).join(" ");
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

  it("Claude per invoice is an estimate from two records: the end-to-end run's calls per invoice times the main run's cost per call", () => {
    // The end-to-end run's record, counted again here: its Claude calls in the run, and the rows of its invoice table.
    const record = read(E2E_RECORD);
    const calls = Number(/(\d+) in the run \(classify, read and review per invoice/.exec(record)![1]);
    const rows = record.slice(record.indexOf("### Invoices, read by Claude"), record.indexOf("### Approvals")).split("\n").filter((l) => /^\| [A-Z]+ \| AP-\d+ /.test(l));
    expect(e2eInvoiceCalls()).toEqual({ calls, invoices: rows.length });
    expect([calls, rows.length]).toEqual([17, 4]);
    // The main run's cost of a call: its whole Claude bill over its calls (the record's own per_call figure agrees).
    const claude = RECORD.snapshot.claude as Rec["snapshot"]["claude"] & { calls: number; per_call_usd_micros: number };
    expect(ue.measured.claudeCalls).toBe(claude.calls);
    expect(Math.round(ue.measured.microsPerCall)).toBe(claude.per_call_usd_micros);
    expect(ue.measured.microsPerInvoice).toBe(calls / rows.length * claude.cost_usd_micros / claude.calls);
    expect([ue.measured.perCallUsd, ue.measured.perInvoiceUsd]).toEqual(["0.0065", "0.0276"]);
    expect(invoiceLine()).toBe(`Claude per invoice, an estimate: USD ${ue.measured.perInvoiceUsd}. The end-to-end sandbox run made ${calls} Claude calls for ${rows.length} invoices, and a Claude call in the main run cost USD ${ue.measured.perCallUsd} on average at list prices.`);
    expect(SECTION).toContain(invoiceLine());
    // Said as what it is: an assumption, because no record holds a measured cost per invoice.
    expect(ASSUMPTIONS.find((a) => a.id === "A3")!.why).toMatch(/^An estimate, not a measurement/);
    expect(SECTION).toContain("No record holds a measured Claude cost per invoice, so this is an assumption (A3), not a measurement.");
    // A record that no longer says its calls or its invoices stops the model: never a guess.
    expect(() => e2eInvoiceCalls(record.replace(/in the run \(classify/, "in all (classify"))).toThrow(/not in the record/);
    expect(() => e2eInvoiceCalls("# Another record\n")).toThrow();
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
    expect(opusLine()).toBe(`If every agent ran on Opus, Claude costs would be about ${factor.toFixed(1)}× higher; Purser gives each agent the smallest model that passed its evals.`);
    expect(SECTION).toContain(opusLine());
    expect(DECK_TEXT).toContain(opusLine());
    // Not the benchmark's factor (Purser's split there runs only the reviews on Opus), and not 2.7.
    expect(SECTION + DECK_TEXT).not.toMatch(/2\.7×|2\.92/);
    // Max's wording (6 Nov): the model per agent is the smallest that passed its evals; never the older "routes each task".
    expect(opusLine().endsWith("Purser gives each agent the smallest model that passed its evals.")).toBe(true);
    expect(SECTION + DECK_TEXT).not.toContain("routes each task");
  });
});

describe("the calculation", () => {
  it("takes the price from the pilot pricing's own module, never typed again: Starter, its invoices, the price per extra invoice, Business", () => {
    expect([INPUTS.basePlanEur.value, INPUTS.includedInvoices.value, INPUTS.extraInvoiceEur.value, INPUTS.businessFromEur.value])
      .toEqual([PRICING.starter.monthlyCents / 100, PRICING.starter.invoicesIncluded, PRICING.starter.extraInvoiceCents / 100, PRICING.business.fromMonthlyCents / 100]);
    // The usage range hangs on what Starter includes: half of it, exactly it, five times it.
    expect([INPUTS.usageLow.value, INPUTS.usageMid.value, INPUTS.usageHigh.value]).toEqual([PRICING.starter.invoicesIncluded / 2, PRICING.starter.invoicesIncluded, PRICING.starter.invoicesIncluded * 5]);
  });

  it("prices one company on Starter (€49 with 100 invoices, €0.25 per extra one) and costs Claude per invoice + hosting, in EUR", () => {
    const fx = INPUTS.usdPerEur.value;
    for (const s of ue.scenarios) {
      expect(s.extraInvoices).toBe(Math.max(0, s.invoices - INPUTS.includedInvoices.value));
      expect(s.priceEur).toBe(INPUTS.basePlanEur.value + s.extraInvoices * INPUTS.extraInvoiceEur.value);
      const usd = (s.invoices * ue.measured.microsPerInvoice + INPUTS.workersPlanUsd.value * 1e6) / 1e6;
      expect(s.costEur).toBeCloseTo(usd / fx, 10);
      expect(s.margin).toBeCloseTo((s.priceEur - s.costEur) / s.priceEur, 10);
    }
  });

  it("gives low, mid and high usage, all positive on this estimate, lowest at the 100 invoices Starter includes", () => {
    expect(ue.scenarios.map((s) => [s.usage, s.invoices, s.extraInvoices, s.priceEurText, s.costEurText, s.marginText])).toEqual([
      ["low", 50, 0, "€49.00", "€5.71", "88%"], ["mid", 100, 0, "€49.00", "€6.95", "86%"], ["high", 500, 400, "€149.00", "€16.82", "89%"],
    ]);
    expect(Math.min(...ue.scenarios.map((s) => s.margin))).toBe(ue.scenarios.find((s) => s.usage === "mid")!.margin);
    expect(ue.extraInvoice.claudeEur).toBeLessThan(ue.extraInvoice.priceEur);
    expect(ue.extraInvoice.opusClaudeEur).toBeLessThan(ue.extraInvoice.priceEur);
  });

  it("says what the margin leaves out (the platform costs, the fee per payout) and what the replaced price's own table gave", () => {
    // Not in the model: said in the assumptions, under the margin and on the slide. The margin is not the real margin.
    expect(ASSUMPTIONS.find((a) => a.id === "A8")!.value).toMatch(/^the platform costs: Airwallex platform or partner fees/);
    expect(ASSUMPTIONS.find((a) => a.id === "A8")!.why).toContain("Gross margin here is the price minus Claude and hosting, so the real margin is lower.");
    expect(SECTION).toContain("before the platform costs (A8)");
    expect(SECTION).toContain("It is the price minus Claude and hosting only. Airwallex's platform or partner fees, support and people are not in it (A8), so the real margin is lower; the fee per payout is not in it either, because it has no rate set.");
    expect(DECK_TEXT).toContain("Gross margin, before platform costs");
    expect(DECK_TEXT).toContain("Not counted: Airwallex's platform fees, people, the fee per payout.");
    // The price before 12 November, at the usage it included, computed again here from the same record: 48%. It is
    // said once, as what that price's own table gave, and nothing hides it.
    const fx = INPUTS.usdPerEur.value;
    const cost = (EARLIER.includedDecisions * ue.measured.allInMicrosPerDecision + INPUTS.workersPlanUsd.value * 1e6) / 1e6 / fx;
    expect(Math.round((EARLIER.baseEur - cost) / EARLIER.baseEur * 100)).toBe(48);
    expect(ue.earlier.margin).toBeCloseTo((EARLIER.baseEur - cost) / EARLIER.baseEur, 10);
    expect(earlierLine()).toBe("The price before 12 November 2026 was per agent, with 1,500 Claude decisions included in €49 a company a month; at exactly that usage its own table gave a gross margin of 48%, because it sold Claude decisions close to what they cost. The pilot pricing replaces it and sells the supplier invoice instead.");
    expect(SECTION.split(earlierLine()).length).toBe(2);
    expect(DECK_TEXT).not.toContain("48%");
  });

  it("checks the hosting assumption against the plan's included usage: one Durable Object awake all month fits", () => {
    expect(ue.hosting.doGbSecondsPerMonth).toBe(INPUTS.doMemoryMb.value / 1024 * INPUTS.daysPerMonth.value * 86400);
    expect(ue.hosting.doGbSecondsPerMonth).toBeLessThanOrEqual(INPUTS.doIncludedGbS.value);
    const most = INPUTS.usageHigh.value;
    expect(ue.hosting.workerRequestsPerInvoice).toBe(INPUTS.workerIncludedRequests.value / most);
    expect(ue.hosting.doRequestsPerInvoice).toBe(INPUTS.doIncludedRequests.value / most);
  });
});

describe("the price, word for word everywhere (Max, 6 Nov; one model since the panel's review of 12 Nov)", () => {
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
    out.push(["README.md", read("README.md")], ["proof", proofPage()], ["deck", DECK_TEXT]);
    return out;
  }

  it("is the pilot pricing's one sentence, built from its own module and from the model's inputs alike", () => {
    expect(PRICE_LINE).toBe("Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout.");
    expect(PRICE_LINE).toBe(PRICING_LINE);
    expect(priceFromInputs()).toBe(PRICE_LINE);
    expect(WHY_COMPANY.find((l) => l.label === PRICING_LABEL)!.text).toBe(`${PRICE_LINE} A hypothesis.`);
  });

  it("every price statement is that sentence, and the earlier prices are gone", () => {
    const seen = new Set<string>();
    // The earlier price, per agent with Claude decisions included (6 November), and the one before it.
    const earlier = /€49 per company|per extra agent|€3 per extra|EUR 49|EUR 10 (?:a month )?for each extra agent|including 5 agents|€10 a month for each extra agent|five agents included|with agents included/;
    for (const [name, raw] of surfaces()) {
      // The release notes are a dated log of what each release said, and the sentence is built in two modules.
      if (name === "docs/submission/release-notes.md") continue;
      const t = raw.replace(/\s*\n\s*/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      for (const m of t.matchAll(/Starter €49|then €0\.25 each|Business from €249/g)) {
        const at = t.lastIndexOf("Starter €49", m.index);
        expect({ name, same: at >= 0 && t.slice(at, at + PRICE_LINE.length) === PRICE_LINE && m.index < at + PRICE_LINE.length }).toEqual({ name, same: true });
        seen.add(name);
      }
      expect({ name, earlier: earlier.exec(t)?.[0] ?? null }).toEqual({ name, earlier: null });
    }
    for (const name of ["README.md", "docs/submission/README.md", "docs/business/model.md", "docs/after-the-kit.md", "docs/submission/qa.md", "docs/claims.md", "proof", "deck"]) expect({ name, said: seen.has(name) }).toEqual({ name, said: true });
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
  it("holds exactly the section the module writes: no number in it is typed by hand", () => {
    expect(SECTION).toBe(sectionMarkdown());
  });

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
    for (const s of ue.scenarios) for (const v of [s.priceEurText, s.costEurText, s.marginText, `${s.usage === "low" ? "Low" : s.usage === "mid" ? "Mid" : "High"}: ${s.invoices.toLocaleString("en-GB")}`]) expect({ v, on: DECK_TEXT.includes(v) }).toEqual({ v, on: true });
    expect(DECK_TEXT).toContain(opusLine());
    expect(DECK_TEXT).toContain(invoiceLine());
    expect(DECK_TEXT).toContain(`USD ${ue.measured.perInvoiceUsd}`);
    expect(DECK_TEXT).toContain("1.1165");
  });

  it("has no unsourced number (the business lines from brand.ts aside, which test/first-screen.test.ts checks)", () => {
    let t = DECK_TEXT;
    for (const l of WHY_COMPANY) t = t.split(l.text).join(" ");
    const stray = numbers(figuresOnly(t)).filter((n) => !allowedNumbers().has(n));
    expect(stray).toEqual([]);
  });
});

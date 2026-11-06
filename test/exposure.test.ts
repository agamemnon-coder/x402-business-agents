// 1.1: the maximum exposure, computed from the policy by Purser's own code. Per agent and in all, per day and per
// month: the card's limit (Airwallex, EUR), the mandate's budget (Metal, *USDZ, test USD), and what the agent may pay
// alone under Purser's policy beyond those (the Treasury agent's task cards without Face ID). EUR and USD stay apart;
// a total in EUR only at the main run's recorded rate. Every number here is read from the policy code or the record,
// never typed in.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AGENTS, CARDS, INITIAL_MANDATES, TASK_WITHIN_PER_DAY } from "../src/config/policy.js";
import { openDb } from "../src/db/open.js";
import { toCents } from "../src/lib/money.js";
import { policyValue } from "../src/policy/rules.js";
import { createHash } from "node:crypto";
import { EXPOSURE_TASK_CARDS, MONTH_DAYS, approxEurCents, exposureOf, exposureWords, moneyWords, type ExposurePolicy } from "../src/policy/exposure.js";
import { exposurePolicyFromDb, exposurePolicyFromRecord, recordedRate, startPolicy, worstCaseLine, worstCaseWords } from "../src/policy/exposureSources.js";
import { STEP0_CHAIN, exposurePolicyOfWorld } from "../src/try/policy.js";
import { BASE, RP, call, challengeOf, desk, withPasskey } from "./support/trySign.js";

const record = JSON.parse(readFileSync(new URL("../docs/demo/main-run.json", import.meta.url), "utf8")) as Parameters<typeof exposurePolicyFromRecord>[0] & Parameters<typeof recordedRate>[0];

describe("the starting policy, read by Purser's own code", () => {
  it("takes each card's monthly limit, each mandate's budget and the task-card rule from the policy, not from typed numbers", () => {
    const db = openDb(":memory:");
    const p = exposurePolicyFromDb(db);
    for (const a of AGENTS) {
      expect(p.cardMonthlyCents[a]).toBe(toCents(policyValue(db, `card.${a}.monthly`)));
      expect(p.cardMonthlyCents[a]).toBe(CARDS[a].monthlyCents);
      expect(p.mandateBudgetCents[a]).toBe(INITIAL_MANDATES[a].budgetCents);
    }
    expect(p.taskCardEurCents).toBe(toCents(policyValue(db, "approval.task_card_eur")));
    expect(p.taskCardsPerDay).toBe(TASK_WITHIN_PER_DAY);
    expect(startPolicy()).toEqual(p);
  });
});

describe("the figure matches the policy, agent by agent", () => {
  const p = startPolicy();
  const x = exposureOf(p);
  it("per agent: the card's month, the mandate's budget, and (Treasury) the task cards it may issue alone", () => {
    for (const a of AGENTS) {
      const e = x.agents.find((y) => y.agent === a)!;
      const tasks = a === "treasury" ? p.taskCardEurCents * p.taskCardsPerDay : 0;
      expect(e.card).toEqual({ dayEurCents: p.cardMonthlyCents[a], monthEurCents: p.cardMonthlyCents[a] });
      expect(e.mandate).toEqual({ dayUsdCents: p.mandateBudgetCents[a], monthUsdCents: p.mandateBudgetCents[a] });
      expect(e.alone).toEqual({ dayEurCents: tasks, monthEurCents: tasks * MONTH_DAYS });
      expect(e.day).toEqual({ eurCents: p.cardMonthlyCents[a] + tasks, usdCents: p.mandateBudgetCents[a] });
      expect(e.month).toEqual({ eurCents: p.cardMonthlyCents[a] + tasks * MONTH_DAYS, usdCents: p.mandateBudgetCents[a] });
    }
  });
  it("in all: the sum over the agents, EUR and USD apart", () => {
    const sum = (f: (e: (typeof x.agents)[number]) => number) => x.agents.reduce((s, e) => s + f(e), 0);
    expect(x.total.month).toEqual({ eurCents: sum((e) => e.month.eurCents), usdCents: sum((e) => e.month.usdCents) });
    expect(x.total.day).toEqual({ eurCents: sum((e) => e.day.eurCents), usdCents: sum((e) => e.day.usdCents) });
    expect(x.agents.map((e) => e.agent)).toEqual([...AGENTS]);
  });
  it("the main run's recorded policy gives the same totals as the starting policy", () => {
    const r = exposureOf(exposurePolicyFromRecord(record));
    expect(r.total).toEqual(x.total);
  });
});

describe("a looser policy raises it, a stricter one lowers it", () => {
  const base = startPolicy();
  const month = (p: ExposurePolicy) => exposureOf(p).total.month;
  const cases: [string, (p: ExposurePolicy) => ExposurePolicy, "eurCents" | "usdCents"][] = [
    ["a card's monthly limit", (p) => ({ ...p, cardMonthlyCents: { ...p.cardMonthlyCents, treasury: p.cardMonthlyCents.treasury + 1000 } }), "eurCents"],
    ["a mandate's budget", (p) => ({ ...p, mandateBudgetCents: { ...p.mandateBudgetCents, sourcing: p.mandateBudgetCents.sourcing + 100 } }), "usdCents"],
    ["the task-card threshold", (p) => ({ ...p, taskCardEurCents: p.taskCardEurCents + 5000 }), "eurCents"],
  ];
  for (const [what, raise, unit] of cases) {
    it(`${what}: higher raises it, lower lowers it`, () => {
      expect(month(raise(base))[unit]).toBeGreaterThan(month(base)[unit]);
      const lower = (p: ExposurePolicy) => raise(raise(p)); // twice above, so base is the lower of the two
      expect(month(base)[unit]).toBeLessThan(month(lower(base))[unit]);
    });
  }
  it("read from the ledger's settings: a raised card limit raises it, a lowered one lowers it", () => {
    const db = openDb(":memory:");
    const before = exposureOf(exposurePolicyFromDb(db)).total.month.eurCents;
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('card.support.monthly', '200.00', ?)").run(new Date().toISOString());
    const up = exposureOf(exposurePolicyFromDb(db)).total.month.eurCents;
    db.prepare("UPDATE settings SET value = '50.00' WHERE key = 'card.support.monthly'").run();
    const down = exposureOf(exposurePolicyFromDb(db)).total.month.eurCents;
    expect(up - before).toBe(5000);
    expect(down - before).toBe(-10000);
  });
});

describe("one currency or two: EUR and USD apart, a total only at the main run's rate", () => {
  it("the rate is the one the main run recorded (its executed conversion's client rate), with its date", () => {
    const conv = (record as unknown as { ledger: { proposals: { status: string; terms?: { conversion?: { client_rate: string; valid_to: string; buy_currency: string; sell_currency: string } } }[] } })
      .ledger.proposals.filter((p) => p.status === "EXECUTED" && p.terms?.conversion).map((p) => p.terms!.conversion!);
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ buy_currency: "EUR", sell_currency: "USD" });
    const r = recordedRate(record)!;
    expect(r.usdPerEur).toBe(conv[0]!.client_rate);
    expect(r.date).toBe(conv[0]!.valid_to.slice(0, 10));
  });
  it("converts USD to EUR at that rate, in whole cents (EUR = USD / rate, half up)", () => {
    expect(approxEurCents(0, 112_99, "1.129917")).toBe(100_00);
    expect(approxEurCents(1000, 2000, "1.129917")).toBe(1000 + Math.round(2000 / 1.129917));
    expect(approxEurCents(500, 0, "1.129917")).toBe(500);
  });
  it("no usable rate in a record: no total", () => {
    expect(recordedRate({ ledger: { proposals: [] } } as unknown as Parameters<typeof recordedRate>[0])).toBeNull();
  });
});

describe("the shown numbers are identical in all places", () => {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fromRecord = () => {
    const p = exposurePolicyFromRecord(record);
    return exposureWords(exposureOf(p), p, recordedRate(record));
  };
  it("the CFO's view (/?autonomy) opens with the figure, from the main run's policy, in one block under its line", async () => {
    const { dashboardPage } = await import("../src/servers/dashboard.js");
    const html = dashboardPage();
    const w = fromRecord();
    const block = /<div class="cfoexpo" id="cfo-expo" hidden>([\s\S]*?)<\/div>/.exec(html);
    expect(block).not.toBeNull();
    for (const s of [w.headline, w.definition, w.comparison]) expect(block![1]).toContain(esc(s));
    // Right under the CFO's line, and shown together with it (on /?autonomy only).
    expect(html.indexOf('id="cfo-expo"') - html.indexOf('id="cfo-line"')).toBeGreaterThan(0);
    expect(html.indexOf('id="cfo-expo"')).toBeLessThan(html.indexOf('id="recbanner"'));
    expect(html).toContain('document.getElementById("cfo-expo").hidden = false;');
  });
  it("the same numbers from the starting policy and from the main run's", () => {
    const p = startPolicy();
    expect(exposureWords(exposureOf(p), p, recordedRate(record)).headline).toBe(fromRecord().headline);
  });
});

describe("the CFO's view, the README and step 0 show identical numbers", () => {
  const start = worstCaseWords(record);
  const keys = ["headline", "parts", "definition", "comparison"] as const;
  it("the README's block is the starting policy's words, exactly", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = /<!-- worst-case -->\n([\s\S]*?)\n<!-- \/worst-case -->/.exec(readme)![1]!;
    expect(block).toBe(`**${start.headline}**\n\n${start.parts} ${start.definition} ${start.comparison} Computed from the policy by [\`exposureOf\`](src/policy/exposure.ts); \`test/exposure.test.ts\` checks this paragraph against it.`);
  });
  it("step 0's page carries the same words before a world opens, under the heading \"Worst case\"", async () => {
    const { trySignPage, TRY_POLICY } = await import("../src/try/sign.js");
    const html = trySignPage();
    const { esc } = await import("../src/redesign/ui.js");
    const block = /<div class="pexpo" id="p-expo"[^>]*>([\s\S]*?)<\/div>/.exec(html)![1]!;
    expect(TRY_POLICY.worstCase).toBe("Worst case, set by policy");
    for (const k of keys) expect(block).toContain(esc(start[k]));
    expect(block).toContain(esc(TRY_POLICY.worstCase));
    expect(html).toContain(esc(TRY_POLICY.open));
  });
  it("a test world opens with the same words, computed by the Worker from its starting policy (B1)", async () => {
    const { d } = desk(undefined, null, recordedRate(record));
    const res = await call(d, "world", {});
    const w = (await res.json()) as { exposure: Record<(typeof keys)[number], string> };
    for (const k of keys) expect(w.exposure[k]).toBe(start[k]);
  });
  it("the CFO's view: the same headline as the README and step 0", () => {
    const p = exposurePolicyFromRecord(record);
    expect(exposureWords(exposureOf(p), p, recordedRate(record)).headline).toBe(start.headline);
  });
  it("one switch for decision B: B2 takes the chain part from the test world's mandate (budget = the card's month)", () => {
    const p = startPolicy();
    const world = { reserve_floor: "25000.00", agents: Object.fromEntries(AGENTS.map((a) => [a, { per_tx: "1.00", monthly: (p.cardMonthlyCents[a] / 100).toFixed(2), mccs: [], currencies: [], end_date: "2027-01-01", alone: "500.00" }])) } as unknown as Parameters<typeof exposurePolicyOfWorld>[0];
    expect(exposurePolicyOfWorld(world, "purser")).toEqual(p);
    expect(exposurePolicyOfWorld(world, "test_world").mandateBudgetCents).toEqual(p.cardMonthlyCents);
    expect(STEP0_CHAIN).toBe("purser");
  });
  it("one switch for decision A: task cards counted on their own line (default), or named apart and left out", () => {
    const p = startPolicy(), x = exposureOf(p);
    expect(EXPOSURE_TASK_CARDS).toBe("counted");
    const apart = exposureWords(x, p, null, "apart"), counted = exposureWords(x, p, null, "counted");
    const tasks = x.agents.find((e) => e.agent === "treasury")!.alone.monthEurCents;
    expect(counted.headline).toContain(moneyWords("EUR", x.total.month.eurCents));
    expect(apart.headline).toContain(moneyWords("EUR", x.total.month.eurCents - tasks));
    expect(apart.parts).toContain(`Not counted above: task cards`);
    expect(counted.form).toBe(worstCaseWords(record).form);
    expect(worstCaseLine()).toBe(counted.form);
  });
});

describe("in step 0: a stricter policy lowers it at once, a looser one raises it only when signed", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  async function visitor() {
    const { d } = desk(undefined, null, recordedRate(record));
    const { w, auth } = await withPasskey(d);
    const start = (w as unknown as { policy: { reserve_floor: string; agents: Record<string, Record<string, unknown>> } }).policy;
    const setOf = (monthly: string) => ({ ...start.agents.support, monthly, reserve_floor: start.reserve_floor });
    return { d, w, auth, setOf };
  }
  const eurMonth = (h: string) => Number(/EUR ([\d,]+\.\d{2}) on cards/.exec(h)![1]!.replace(/,/g, ""));
  it("stricter: the support card's month from 150.00 to 100.00 lowers the figure by EUR 50.00 at once", async () => {
    const v = await visitor();
    const before = eurMonth(worstCaseWords(record).headline);
    const r = await call(v.d, "policy", { token: v.w.world.token, agent: "support", set: v.setOf("100.00") });
    const out = (await r.json()) as { applied: boolean; exposure: { headline: string } };
    expect(out.applied).toBe(true);
    expect(eurMonth(out.exposure.headline)).toBe(before - 50);
    const p = { ...startPolicy(), cardMonthlyCents: { ...startPolicy().cardMonthlyCents, support: 10000 } };
    expect(out.exposure.headline).toBe(exposureWords(exposureOf(p), p, recordedRate(record)).headline);
  });
  it("looser: refused, the figure in force unchanged and the one it would set shown; signed, it holds", async () => {
    const v = await visitor();
    const before = worstCaseWords(record).headline;
    const r = await call(v.d, "policy", { token: v.w.world.token, agent: "support", set: v.setOf("400.00") });
    const out = (await r.json()) as { applied: boolean; canonical: string; exposure: { headline: string }; proposed_exposure: { headline: string } };
    expect(out.applied).toBe(false);
    expect(out.exposure.headline).toBe(before);
    expect(eurMonth(out.proposed_exposure.headline)).toBe(eurMonth(before) + 250);
    const credential = v.auth.sign({ challenge: challengeOf(sha(out.canonical)), origin: BASE, rpId: RP, counter: 1 });
    const s = await call(v.d, "policy", { token: v.w.world.token, agent: "support", set: v.setOf("400.00"), canonical: out.canonical, credential });
    const signed = (await s.json()) as { applied: boolean; exposure: { headline: string } };
    expect(signed.applied).toBe(true);
    expect(signed.exposure.headline).toBe(out.proposed_exposure.headline);
  });
});

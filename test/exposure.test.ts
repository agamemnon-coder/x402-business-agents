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
import { EXPOSURE_HOW, EXPOSURE_TASK_CARDS, MONTH_DAYS, approxEurCents, exposureOf, exposureWords, moneyShort, type ExposurePolicy } from "../src/policy/exposure.js";
import { exposurePolicyFromDb, exposurePolicyFromRecord, readmeWorstCase, recordedRate, startPolicy, worstCaseLine, worstCaseWords, worstCaseWordsOf } from "../src/policy/exposureSources.js";
import { ALONE_PER_DAY, STEP0_CHAIN, defaultPolicy, exposurePolicyOfWorld } from "../src/try/policy.js";
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
    // In sight: the figure, the task cards' line, "Everything above waits for the CFO."; the rest behind one closed fold.
    expect(block![1]).toBe(`<p class="hl">${esc(w.headline)}</p><p>${esc(w.tasks)}</p><p>${esc(w.above)}</p><details class="how"><summary>${EXPOSURE_HOW}</summary><ul>${w.how.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>`);
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
  it("the README's block is the starting policy's words, exactly", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = /<!-- worst-case -->\n([\s\S]*?)\n<!-- \/worst-case -->/.exec(readme)![1]!;
    expect(block).toBe(readmeWorstCase(start));
    expect(block.startsWith(`**${start.headline}**\n\n${start.tasks} ${start.above}\n\n<details><summary>${EXPOSURE_HOW}</summary>`)).toBe(true);
  });
  it("step 0's page carries the same words before a world opens: \"Worst case\" in sight, the rest in the fold", async () => {
    const { trySignPage, TRY_POLICY } = await import("../src/try/sign.js");
    const html = trySignPage();
    const { esc } = await import("../src/redesign/ui.js");
    const block = /<div class="pexpo" id="p-expo"[^>]*>([\s\S]*?)<\/div>/.exec(html)![1]!;
    expect(start.headline.startsWith(TRY_POLICY.worstCase)).toBe(true);
    // The test world's own figure (Max, 7 Nov: it counts what the Treasury agent may pay alone), by the Worker's code.
    const world = worstCaseWordsOf(exposurePolicyOfWorld(defaultPolicy(new Date(), { reserve_floor: "25000.00", alone_limit: "500.00" })));
    for (const t of [world.headline, world.tasks, world.above, ...world.how, TRY_POLICY.worstCaseChain]) expect(block).toContain(esc(t));
    expect(block).toMatch(new RegExp(`<details class="how"><summary>${EXPOSURE_HOW}</summary>`));
    expect(block).not.toMatch(/<details[^>]* open/);
    expect(html).toContain(esc(TRY_POLICY.open));
  });
  it("a test world opens with Purser's figure plus what its Treasury agent may pay alone, computed by the Worker (B1)", async () => {
    const { d } = desk(undefined, null, recordedRate(record));
    const res = await call(d, "world", {});
    const w = (await res.json()) as { exposure: ReturnType<typeof worstCaseWords>; policy: Parameters<typeof exposurePolicyOfWorld>[0] };
    const ep = exposurePolicyOfWorld(w.policy);
    expect(w.exposure).toEqual(exposureWords(exposureOf(ep), ep, recordedRate(record)));
    const eur = (h: string) => Number(/EUR ([\d,]+) (?:on cards|incl\.)/.exec(h)![1]!.replace(/,/g, ""));
    expect(eur(w.exposure.headline)).toBe(eur(start.headline) + 500 * ALONE_PER_DAY * MONTH_DAYS);
    expect(w.exposure.above).toBe(start.above);
    expect(w.exposure.tasks).toBe(`Task cards under a CFO-signed limit: ${moneyShort("EUR", startPolicy().taskCardEurCents * startPolicy().taskCardsPerDay)} a day.`);
  });
  it("the CFO's view: the same figure as the README and step 0", () => {
    const p = exposurePolicyFromRecord(record);
    const r = exposureWords(exposureOf(p), p, recordedRate(record));
    expect([r.headline, r.tasks, r.above]).toEqual([start.headline, start.tasks, start.above]);
  });
  it("in sight, at most 40 words: the figure, the task cards' line, \"Everything above waits for the CFO.\" and the fold's summary", () => {
    const words = [start.headline, start.tasks, start.above, EXPOSURE_HOW].join(" ").split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(40);
    // The bold figure counts the cards' monthly limits and the task cards (12 Nov): per day times MONTH_DAYS.
    const p = startPolicy();
    const cardsAndTasks = AGENTS.reduce((n, a) => n + p.cardMonthlyCents[a], 0) + p.taskCardEurCents * p.taskCardsPerDay * MONTH_DAYS;
    expect(start.headline).toBe(`Worst case, set by policy: ${moneyShort("EUR", cardsAndTasks)} on cards and task cards + ${moneyShort("USD", exposureOf(p).total.month.usdCents)} on chain a month.`);
    expect(start.tasks).toBe(`Task cards under a CFO-signed limit: ${moneyShort("EUR", p.taskCardEurCents * p.taskCardsPerDay)} a day.`);
    expect(start.above).toBe("Everything above waits for the CFO.");
  });
  it("whole euros where the cents are .00, cents otherwise", () => {
    expect(moneyShort("EUR", 30000)).toBe("EUR 300");
    expect(moneyShort("EUR", 2821770)).toBe("EUR 28,217.70");
    expect(moneyShort("USD", 2000)).toBe("USD 20");
  });
  it("one switch for decision B: B2 takes the chain part from the test world's mandate (budget = the card's month)", () => {
    const p = startPolicy();
    const world = { reserve_floor: "25000.00", agents: Object.fromEntries(AGENTS.map((a) => [a, { per_tx: "1.00", monthly: (p.cardMonthlyCents[a] / 100).toFixed(2), mccs: [], currencies: [], end_date: "2027-01-01", alone: "500.00" }])) } as unknown as Parameters<typeof exposurePolicyOfWorld>[0];
    expect(exposurePolicyOfWorld(world, "purser")).toEqual({ ...p, invoiceAloneCents: { sourcing: 0, support: 0, treasury: 50_000 }, invoicesAlonePerDay: ALONE_PER_DAY });
    expect(exposurePolicyOfWorld(world, "test_world").mandateBudgetCents).toEqual(p.cardMonthlyCents);
    expect(STEP0_CHAIN).toBe("purser");
  });
  it("one switch for decision A: task cards counted in the figure (12 Nov, after the jury panel's review; the default), or apart (6 Nov)", () => {
    const p = startPolicy(), x = exposureOf(p);
    expect(EXPOSURE_TASK_CARDS).toBe("counted");
    const apart = exposureWords(x, p, null, "apart"), counted = exposureWords(x, p, null, "counted");
    const tasks = x.agents.find((e) => e.agent === "treasury")!.alone.monthEurCents;
    expect(tasks).toBeGreaterThan(0);
    expect(counted.headline).toBe(`Worst case, set by policy: ${moneyShort("EUR", x.total.month.eurCents)} on cards and task cards + ${moneyShort("USD", x.total.month.usdCents)} on chain a month.`);
    expect(apart.headline).toContain(`${moneyShort("EUR", x.total.month.eurCents - tasks)} on cards +`);
    expect(apart.tasks.startsWith("Task cards the Treasury agent may issue alone")).toBe(true);
    expect(counted.tasks.startsWith("Task cards under a CFO-signed limit")).toBe(true);
    // The form's sentence, with the task cards in its figure.
    expect(counted.form).toBe(`Worst case, set by policy: the agents together can spend at most ${moneyShort("EUR", x.total.month.eurCents)} (cards and task cards) and ${moneyShort("USD", x.total.month.usdCents)} (test USD) a month; everything above waits for the CFO.`);
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
  const eurMonth = (h: string) => Number(/EUR ([\d,]+(?:\.\d{2})?) (?:on cards|incl\.)/.exec(h)![1]!.replace(/,/g, ""));
  it("stricter: the support card's month from 150.00 to 100.00 lowers the figure by EUR 50.00 at once", async () => {
    const v = await visitor();
    const opening = (v.w as unknown as { exposure: { headline: string } }).exposure.headline;
    const before = eurMonth(opening);
    const r = await call(v.d, "policy", { token: v.w.world.token, agent: "support", set: v.setOf("100.00") });
    const out = (await r.json()) as { applied: boolean; exposure: { headline: string }; policy: Parameters<typeof exposurePolicyOfWorld>[0] };
    expect(out.applied).toBe(true);
    expect(eurMonth(out.exposure.headline)).toBe(before - 50);
    const p = exposurePolicyOfWorld(out.policy);
    expect(p.cardMonthlyCents.support).toBe(10000);
    expect(out.exposure.headline).toBe(exposureWords(exposureOf(p), p, recordedRate(record)).headline);
  });
  it("looser: refused, the figure in force unchanged and the one it would set shown; signed, it holds", async () => {
    const v = await visitor();
    const before = (v.w as unknown as { exposure: { headline: string } }).exposure.headline;
    const r = await call(v.d, "policy", { token: v.w.world.token, agent: "support", set: v.setOf("400.00") });
    const out = (await r.json()) as { applied: boolean; canonical: string; exposure: { headline: string }; proposed_exposure: { headline: string; figure: string } };
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

describe("payments an agent may make alone count in the worst case (Max, 7 Nov)", () => {
  const now = new Date("2026-11-07T08:00:00Z");
  const world = (alone: string) => {
    const p = defaultPolicy(now, { reserve_floor: "25000.00", alone_limit: "500.00" });
    return { ...p, agents: { ...p.agents, treasury: { ...p.agents.treasury, alone } } };
  };
  it("raising what the Treasury agent may pay alone from EUR 500 to EUR 2,000 raises the worst case, by the limit a day", () => {
    const at500 = exposureOf(exposurePolicyOfWorld(world("500.00"))), at2000 = exposureOf(exposurePolicyOfWorld(world("2000.00")));
    expect(at2000.total.month.eurCents).toBeGreaterThan(at500.total.month.eurCents);
    expect(at2000.total.month.eurCents - at500.total.month.eurCents).toBe((200_000 - 50_000) * ALONE_PER_DAY * MONTH_DAYS);
    expect(at2000.total.day.eurCents - at500.total.day.eurCents).toBe((200_000 - 50_000) * ALONE_PER_DAY);
    expect(ALONE_PER_DAY).toBe(TASK_WITHIN_PER_DAY);
  });
  it("the Treasury agent's limit (the only payments that run alone here), at most ALONE_PER_DAY a day, 31 days a month; USD untouched", () => {
    const p = exposurePolicyOfWorld(world("2000.00"));
    const x = exposureOf(p);
    for (const a of AGENTS) {
      const e = x.agents.find((y) => y.agent === a)!;
      const each = a === "treasury" ? 200_000 : 0;
      expect(e.invoices).toEqual({ dayEurCents: each * ALONE_PER_DAY, monthEurCents: each * ALONE_PER_DAY * MONTH_DAYS });
    }
    expect(x.total.month.usdCents).toBe(exposureOf(startPolicy()).total.month.usdCents);
  });
  it("says so where it counts them, and Purser's own policy (no invoices paid alone) keeps its words", () => {
    const p = exposurePolicyOfWorld(world("2000.00"));
    const w = exposureWords(exposureOf(p), p, null);
    expect(w.figure).toMatch(/^EUR [\d,]+ incl\. task cards, payments alone \+ USD [\d,]+ on chain a month$/);
    expect(w.how.join(" ")).toContain(`Payments alone: up to each agent's limit, at most ${ALONE_PER_DAY} a day`);
    const s = startPolicy();
    expect(exposureWords(exposureOf(s), s, null).figure).toMatch(/^EUR [\d,]+ on cards and task cards \+ USD [\d,]+ on chain a month$/);
  });
});

describe("the bold figure is never smaller than what its fold reveals (jury panel, 12 Nov)", () => {
  const now = new Date("2026-11-07T08:00:00Z");
  const tryWorld = (alone: string) => {
    const p = defaultPolicy(now, { reserve_floor: "25000.00", alone_limit: "500.00" });
    return exposurePolicyOfWorld({ ...p, agents: { ...p.agents, treasury: { ...p.agents.treasury, alone } } });
  };
  const policies: [string, ExposurePolicy][] = [
    ["the starting policy", startPolicy()],
    ["the main run's policy", exposurePolicyFromRecord(record)],
    ["a /try/sign world's policy (EUR 500 alone)", tryWorld("500.00")],
    ["a /try/sign world's policy (EUR 2,000 alone)", tryWorld("2000.00")],
  ];
  const amounts = (t: string, cur: "EUR" | "USD") => [...t.matchAll(new RegExp(`${cur} ([\\d,]+(?:\\.\\d{2})?)`, "g"))].map((m) => Math.round(Number(m[1]!.replace(/,/g, "")) * 100));
  for (const [name, p] of policies) {
    it(`${name}: the parts in the fold add up to the bold figure, and no amount in sight or in the fold is larger`, () => {
      const x = exposureOf(p);
      const w = exposureWords(x, p, recordedRate(record));
      const [boldEur, boldUsd] = [amounts(w.headline, "EUR"), amounts(w.headline, "USD")];
      expect(boldEur).toEqual([x.total.month.eurCents]);
      expect(boldUsd).toEqual([x.total.month.usdCents]);
      // One line per agent: its card, its task cards, its payments alone (EUR) and its mandate (USD), a month.
      const agentLines = w.how.filter((l) => / agent: /.test(l));
      expect(agentLines).toHaveLength(AGENTS.length);
      const sum = (cur: "EUR" | "USD") => agentLines.flatMap((l) => amounts(l, cur)).reduce((a, b) => a + b, 0);
      expect(sum("EUR")).toBe(boldEur[0]);
      expect(sum("USD")).toBe(boldUsd[0]);
      // Every EUR amount shown, but the "≈" line (which adds the USD at the recorded rate), is at most the bold one.
      const shown = [w.tasks, ...w.how.filter((l) => !l.startsWith("≈"))].flatMap((l) => amounts(l, "EUR"));
      expect(shown.length).toBeGreaterThan(0);
      for (const c of shown) expect(c).toBeLessThanOrEqual(boldEur[0]!);
      // The task cards a month (per day times MONTH_DAYS) are in it.
      expect(boldEur[0]).toBeGreaterThanOrEqual(p.taskCardEurCents * p.taskCardsPerDay * MONTH_DAYS);
    });
  }
});

describe("llms.txt says the worst case in the README's words", () => {
  it("carries the bold figure and the line under it, word for word", () => {
    const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
    const w = worstCaseWords(record);
    expect(llms).toContain(`${w.headline} ${w.tasks} ${w.above}`);
    expect(llms).not.toMatch(/EUR 300 on cards/);
  });
});

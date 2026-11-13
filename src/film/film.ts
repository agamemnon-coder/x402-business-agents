// The earlier film (30 October; not the walkthrough (film v10, 4:58, FILM_URL on YouTube; src/film/cuts.ts HANDIN10)): Purser in
// about three minutes, one continuous animation (src/film/film.html, served at
// /film and recorded by npm run video). Things happen on screen: a card is declined and then pays after Face ID, a
// euro bill is converted and paid, payments bounce off a mandate on chain, twelve orders are checked one by one.
// Every number comes from a recording (docs/demo/story.json and snapshot.json, the red team and Lab reports) or from
// the run logs quoted in LIVE_RUNS; a fact that cannot be found stops the build.

import type { Story } from "../demo/story.js";
import type { Recorded } from "../demo/recorded.js";
import { agentsDecided, FROM_RUN_LOG, LIVE_RUNS } from "../live/timeline.js";

export interface FilmData {
  company: string;
  run: string;
  cards: { name: string; last4: string; perTx: string; only: string }[];
  mandates: { name: string; cap: string; payee: string }[];
  card: { merchant: string; last4: string; small: string; big: string; from: string; to: string; proposal: string };
  bill: { invoice: string; usd: string; eur: string; fee: string; ceiling: string; hash: string; proposal: string };
  metal: { sales: string; firstTx: string; cap: string; oldPrice: string; newPrice: string; optionA: string; optionB: string; advice: string; mandateTx: string; proposal: string };
  dispute: { caseId: string; text: string; rows: { seq: string; amount: string; tx: string }[]; refund: string };
  ask: typeof LIVE_RUNS.task;
  wall: { held: string; tx: string };
  trust: { attacks: number; blocked: number; scenarios: number; passed: number; per1000: string; auditRows: string; faceIds: number };
  /** "decided" only for a recording in which the agents decided with Claude; the 30 October one predates them ("read"). */
  claude: "decided" | "read";
}

export { FROM_RUN_LOG };

const money = (s: string) => s.replace(/\*?USDZ( \(testnet dollars\))?/g, "test USD");

export function buildFilm(story: Story, recorded: Recorded, reports: { redteam: { attempts: number; blocked: number }; lab: { total: number; passed: number } }): FilmData {
  const step = (id: string) => {
    const s = story.steps.find((x) => x.id === id);
    if (!s) throw new Error(`the recorded story has no step "${id}"`);
    return s;
  };
  const fact = (id: string, label: RegExp): string => {
    const f = (step(id).facts ?? []).find((x) => label.test(x.label));
    if (!f) throw new Error(`the recorded step "${id}" has no fact matching ${label}`);
    return money(f.value);
  };
  const need = <T>(v: T | null | undefined, what: string): T => {
    if (v === null || v === undefined || v === "") throw new Error(`the film needs ${what}`);
    return v;
  };
  const snap = recorded.snapshot as unknown as {
    cards: { agent: string; name: string; last4: string; per_tx: string; only: string }[];
    budgets: { agents: { agent: string; payee: string; cap: string }[] };
    claude: { per_1000_eur_usd_micros: number | null };
    disputes: { case_id: string; text: string; refund: string; sales: { request: string; charged: string; tx: string; order: string; chain: boolean }[] }[];
    audit: { rows: number };
  };

  // The card story: 19.99 approved, 45.00 declined over a 30.00 limit, the raise to 50.00, then 45.00 approved.
  const approved = fact("card", /^Approved by Airwallex/);
  const raise = fact("card", /^Limit raised/).match(/^([\d.]+) \/ [\d.]+ → ([\d.]+)/);
  const ops = need(snap.cards.find((c) => c.agent === "sourcing"), "the sourcing agent's card");
  const cards = snap.cards.map((c) => ({ name: c.name, last4: c.last4, perTx: c.agent === "sourcing" && raise ? raise[1]! : c.per_tx, only: c.only.split(" · ")[0]!.replace(/ \(MCC \d+\)/, "") }));
  const names: Record<string, string> = { sourcing: "Sourcing agent", support: "Support agent", treasury: "Treasury agent" };
  // The mandates as the day starts: the sourcing agent's from the story (the price rise replaces it later); the
  // support agent's never changes. The treasury agent's is left out: it too is replaced during the day.
  const opsStart = need(fact("buy", /Sourcing agent's mandate/).match(/^([\d.]+) a payment/)?.[1], "the sourcing agent's first mandate");
  const sales = need(snap.budgets.agents.find((m) => m.agent === "support"), "the support agent's mandate");
  const mandates = [{ name: names.sourcing!, cap: opsStart, payee: "Stockline" }, { name: names.support!, cap: sales.cap, payee: sales.payee }];

  const faceid = step("faceid");
  const swift = step("swift");
  const conversion = need(fact("swift", /^Conversion/).match(/USD ([\d,.]+) → EUR ([\d,.]+)/), "the conversion");
  const fee = need(fact("swift", /^Airwallex fee/).match(/EUR ([\d,.]+) \(ceiling EUR ([\d,.]+)\)/), "the fee");
  const refusal = step("refused");
  const capRise = need((refusal.details ?? "").match(/asks ([\d.]+) for a stock check\. The mandate's cap is ([\d.]+)/), "the price rise in the story");
  const oldPrice = FROM_RUN_LOG.oldPrice;
  const dispute = need(snap.disputes[0], "a Dispute desk case");
  const per1000 = snap.claude.per_1000_eur_usd_micros;

  return {
    company: story.company ?? "Northwind Outdoor",
    run: "Friday run 1, 30 October 2026 (Metal testnet, Airwallex sandbox)",
    cards, mandates,
    card: {
      merchant: need(approved.match(/at (\w+)/)?.[1], "the merchant"), last4: ops.last4,
      small: need(approved.match(/^([\d.]+) EUR/)?.[1], "the first purchase"), big: need(fact("card", /^Declined by Airwallex/).match(/^([\d.]+) EUR/)?.[1], "the declined purchase"),
      from: need(raise?.[1], "the old limit"), to: need(raise?.[2], "the new limit"), proposal: need(step("card").approval?.proposal, "the card raise's proposal"),
    },
    bill: {
      invoice: need(fact("swift", /^SWIFT transfer/).match(/EUR ([\d,.]+)/)?.[1], "the invoice"), usd: conversion[1]!, eur: conversion[2]!, fee: fee[1]!, ceiling: fee[2]!,
      hash: fact("swift", /hash/i), proposal: need(swift.approval?.proposal, "the invoice's proposal"),
    },
    metal: {
      sales: fact("buy", /^Sales in this run/), firstTx: fact("buy", /first payment/i), cap: capRise[2]!, oldPrice, newPrice: capRise[1]!,
      optionA: fact("refused", /^Option A/), optionB: fact("refused", /^Option B/), advice: fact("faceid", /^Advice/).replace(/^Opus advised /, ""),
      mandateTx: fact("faceid", /^Sourcing agent mandate replaced/), proposal: need(faceid.approval?.proposal, "the mandate change's proposal"),
    },
    dispute: {
      caseId: dispute.case_id, text: dispute.text, refund: dispute.refund,
      rows: dispute.sales.filter((s) => s.chain && s.order.startsWith("signed")).map((s) => ({ seq: s.request.replace(/^.*seq=/, "#"), amount: s.charged, tx: `${s.tx.slice(0, 8)}…${s.tx.slice(-4)}` })),
    },
    ask: LIVE_RUNS.task,
    wall: { held: LIVE_RUNS.quarantine.held, tx: `${LIVE_RUNS.quarantine.tx.slice(0, 10)}…${LIVE_RUNS.quarantine.tx.slice(-4)}` },
    trust: {
      attacks: reports.redteam.attempts, blocked: reports.redteam.blocked, scenarios: reports.lab.total, passed: reports.lab.passed,
      per1000: per1000 === null ? "" : `$${(per1000 / 1e6).toFixed(2)}`, auditRows: String(snap.audit.rows), faceIds: Number(fact("audit", /Face ID/)),
    },
    claude: agentsDecided(recorded) ? "decided" : "read",
  };
}

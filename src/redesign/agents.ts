// /agents/<id>: one page per Kit 11 agent (Sourcing, Support, Treasury), from the main run of 3 Nov: its job and
// models, its limits (the company card at Airwallex and the mandate on Metal), what Claude decided for it (each with its
// Anthropic request id) and what it paid (each linking to its chain on /trace). Everything is read from the run's record
// (docs/demo/main-run.json) and its trace companion (docs/demo/main-run-trace.json); nothing is typed in.
// test/runs-page.test.ts holds the figures to the records.

import { AGENT_DISPLAY, KIT11_JOBS } from "../config/brand.js";
import { EXPLORER_TX } from "../metal/network.js";
import { decisionsOf, loadRecord, type AgentId, type RunRecord } from "./run.js";
import { loadTrace } from "./trace.js";
import type { RunTrace } from "../demo/runTrace.js";
import { avatarHtml, esc, icon, page } from "./ui.js";

export const AGENT_IDS = Object.keys(AGENT_DISPLAY) as AgentId[];
export const agentHref = (id: AgentId) => `agents/${id}`;

interface CardRow { agent: string; last4: string; per_tx: string; monthly: string; spent_month: string; only: string }
interface AgentInfo { id: string; models: { model: string; job: string }[] }
interface StatRow { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; cost_usd_micros: number }

export interface AgentView {
  id: AgentId; name: string; job: string; models: { model: string; job: string }[];
  card: CardRow | null;
  mandate: { cap: string; budget: string; tx: string | null; changes: number } | null;
  stats: StatRow | null;
  decisions: { at: string; text: string; model: string; requestId: string | null }[];
  payments: { id: string; kind: string; at: string; amount: string; currency: string; railId: string | null; rail: string }[];
  totals: string[];
}

const cents = (a: string) => Math.round(Number(a) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
const unit = (cur: string) => cur === "USDZ" ? "test USD" : cur;

export function agentView(id: AgentId, r: RunRecord = loadRecord().record, t: RunTrace = loadTrace()): AgentView {
  const snap = r.snapshot as unknown as { cards: CardRow[]; agents: AgentInfo[]; agent_stats: StatRow[] };
  const mandates = (t.mandates as unknown as { agent: string; cap: string; budget: string; tx: string | null }[]).filter((m) => m.agent === id);
  const last = mandates.at(-1);
  const pays = (t.payments as unknown as { id: string; kind: string; at: string; amount: string; currency: string; rail_id?: string; rail?: string; origin: { agent?: string } }[])
    .filter((p) => p.origin?.agent === id);
  const sums = new Map<string, number>();
  for (const p of pays) sums.set(p.currency, (sums.get(p.currency) ?? 0) + cents(p.amount));
  return {
    id, name: AGENT_DISPLAY[id].name, job: KIT11_JOBS[id],
    models: snap.agents.find((a) => a.id === id)?.models ?? [],
    card: snap.cards.find((c) => c.agent === id) ?? null,
    mandate: last ? { cap: last.cap, budget: last.budget, tx: last.tx, changes: mandates.length } : null,
    stats: snap.agent_stats.find((s) => s.agent === id) ?? null,
    decisions: decisionsOf(r).filter((d) => d.agent === id).map((d) => ({ at: d.at, text: d.text, model: d.call ? `Claude ${d.call.family}` : "code", requestId: d.call?.requestId ?? null })),
    payments: pays.map((p) => ({ id: p.id, kind: p.kind, at: p.at, amount: p.amount, currency: p.currency, railId: p.rail_id ?? null, rail: p.rail ?? "" })),
    totals: [...sums].map(([cur, c]) => `${fmt(c)} ${unit(cur)}`),
  };
}

const time = (iso: string) => iso.slice(11, 19);
const KIND: Record<string, string> = { purchase: "Supplier purchase", refund: "Refund", sweep: "Sweep", card: "Card charge", sale: "Sale", transfer: "SWIFT transfer" };
const SHOWN = 8;

const CSS = `.agentp h1 { margin: 0; }
.agentp .hd { display: flex; align-items: center; gap: 14px; margin: 24px 0 6px; }
.agentp .hd .av { width: 52px; height: 52px; } .agentp .hd .av .i { width: 26px; height: 26px; }
.agentp .job { color: var(--muted); margin: 0 0 6px; }
.agentp .models { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
.agentp .label { font-size: 13px; color: var(--muted); margin: 0 0 16px; }
.agentp .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 12px; margin-bottom: 14px; }
.agentp .tiles .tile { padding: 16px 18px; } .agentp .tiles .tile:hover { transform: none; border-color: var(--border); }
.agentp .tiles .v { font-size: clamp(26px, 2.8vw, 34px); }
.agentp .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; margin-bottom: 14px; }
.agentp .card { padding: 16px 18px; }
.agentp h2 { font-size: 16px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.agentp h2 .i { color: var(--muted); }
.agentp .kv { display: flex; flex-wrap: wrap; gap: 10px 22px; margin: 0 0 10px; }
.agentp .kv div { display: flex; flex-direction: column; } .agentp .kv b { font-size: 20px; font-weight: 750; font-variant-numeric: tabular-nums; } .agentp .kv span { font-size: 13px; color: var(--muted); font-weight: 600; }
.agentp .gauge { margin: 4px 0 8px; }
.agentp .gauge .bar { display: block; width: 100%; height: 10px; }
.agentp .gauge .bar .bg { fill: var(--sunken); } .agentp .gauge .bar .fg { fill: var(--awx); }
.agentp .gauge .gl { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
.agentp .chip { display: inline-flex; font: 600 13px/1.3 Inter, system-ui, sans-serif; padding: 3px 9px; border-radius: 999px; background: var(--sunken); color: var(--muted); }
.agentp .src { font-size: 13px; color: var(--muted); margin: 6px 0 0; }
.agentp ol.tl { list-style: none; margin: 0; padding: 0 0 0 18px; position: relative; }
.agentp ol.tl::before { content: ""; position: absolute; left: 4px; top: 6px; bottom: 6px; width: 2px; background: var(--border); }
.agentp ol.tl li { position: relative; margin: 0 0 8px; }
.agentp ol.tl li::before { content: ""; position: absolute; left: -18px; top: 9px; width: 10px; height: 10px; border-radius: 50%; background: var(--claude); }
.agentp ol.tl details summary { cursor: pointer; list-style: none; } .agentp ol.tl details summary::-webkit-details-marker { display: none; }
.agentp ol.tl .t { font-size: 13px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 6px; }
.agentp ol.tl .s { overflow-wrap: anywhere; }
.agentp ol.tl .m { color: var(--accent); font-size: 13px; font-weight: 600; margin-left: 4px; white-space: nowrap; }
.agentp ol.tl details[open] .m { display: none; }
.agentp ol.tl .rest { margin: 4px 0 0; color: var(--muted); font-size: 15px; overflow-wrap: anywhere; }
.agentp ol.tl code { font-size: 12px; }
.agentp ul.pays { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.agentp ul.pays li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: 15px; overflow-wrap: anywhere; }
.agentp ul.pays .amt { font-weight: 700; font-variant-numeric: tabular-nums; }
.agentp ul.pays .t { font-size: 13px; color: var(--muted); }
.agentp details.morel summary { cursor: pointer; margin: 8px 0 4px; color: var(--muted); font-weight: 600; font-size: 14px; }
.agentp .paid { margin-top: 14px; }
.agentp .others a { margin-right: 14px; }`;

/** The first sentence of a decision (shown), and the rest (one tap away). */
const split = (t: string): [string, string] => { const m = /^(.+?[.!?])\s+(.+)$/s.exec(t); return m ? [m[1]!, m[2]!] : [t, ""]; };
const pct = (part: string, whole: string) => Math.max(0, Math.min(100, Math.round((Number(part) / Number(whole)) * 100)));

export function agentPage(id: AgentId, r?: RunRecord, t?: RunTrace): string {
  const v = agentView(id, r, t);
  const decision = (d: AgentView["decisions"][number]) => {
    const [head, rest] = split(d.text);
    return `<li><details><summary><span class="t">${esc(time(d.at))}</span><span class="s">${esc(head)}</span><span class="m">more</span></summary><p class="rest">${rest ? `${esc(rest)}<br>` : ""}${esc(d.model)}${d.requestId ? ` · request <code>${esc(d.requestId)}</code>` : ""}</p></details></li>`;
  };
  const pay = (p: AgentView["payments"][number]) => `<li><a class="amt" href="/trace#${esc(p.id)}">${esc(p.amount)} ${esc(unit(p.currency))}</a><span>${esc(KIND[p.kind] ?? p.kind)}</span><span class="t">${esc(time(p.at))} UTC</span>${p.railId ? (p.railId.startsWith("0x") ? `<a class="t" href="${esc(EXPLORER_TX + p.railId)}" target="_blank" rel="noopener">tx ${esc(p.railId.slice(0, 10))}… ↗</a>` : `<code class="t">${esc(p.railId)}</code>`) : ""}</li>`;
  const first = v.decisions.slice(0, 4), rest = v.decisions.slice(4);
  const shownPays = v.payments.slice(0, SHOWN), morePays = v.payments.slice(SHOWN);
  const st = v.stats;
  const tiles = st ? `<div class="tiles">
<div class="card tile"><span class="v">${st.decisions}</span><span class="l">decisions</span><span class="note">${st.fallback ? `${st.by_claude} by Claude, ${st.fallback} by fallback code` : "all by Claude"}</span></div>
<div class="card tile"><span class="v">${st.claude_calls}</span><span class="l">Claude calls</span><span class="note">USD ${(st.cost_usd_micros / 1e6).toFixed(4)} in all</span></div>
<div class="card tile"><span class="v">${v.payments.length}</span><span class="l">payment${v.payments.length === 1 ? "" : "s"}</span>${v.totals.length ? `<span class="note">${esc(v.totals.join(" + "))}</span>` : ""}</div>
</div>` : "";
  const card = v.card ? `<div class="kv"><div><b>····${esc(v.card.last4)}</b><span>card</span></div><div><b>EUR ${esc(v.card.per_tx)}</b><span>per purchase</span></div></div>
<div class="gauge" role="img" aria-label="EUR ${esc(v.card.spent_month)} spent of the EUR ${esc(v.card.monthly)} monthly limit"><svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="10" rx="5" class="bg"/><rect width="${pct(v.card.spent_month, v.card.monthly)}" height="10" rx="5" class="fg"/></svg><div class="gl"><span>Spent EUR ${esc(v.card.spent_month)}</span><span>Limit per month EUR ${esc(v.card.monthly)}</span></div></div>
<span class="chip">Only ${esc(v.card.only)}</span><p class="src">Airwallex declines anything over these limits itself.</p>` : "<p>No card in this run.</p>";
  const mandate = v.mandate ? `<div class="kv"><div><b>${esc(v.mandate.cap)}</b><span>test USD per payment</span></div><div><b>${esc(v.mandate.budget)}</b><span>test USD budget</span></div></div>
<span class="chip">${v.mandate.changes === 1 ? "Bound once on chain" : `${v.mandate.changes} mandate events on chain (bound, then replaced)`}</span>${v.mandate.tx ? `<p class="src"><a href="${esc(EXPLORER_TX + v.mandate.tx)}" target="_blank" rel="noopener">tx ${esc(v.mandate.tx.slice(0, 10))}… ↗</a></p>` : ""}` : "<p>No mandate in this run.</p>";
  const body = `<main class="wrap agentp">
<div class="hd">${avatarHtml(id, 26)}<h1>${esc(v.name)}</h1></div>
<p class="job">It ${esc(v.job)}.</p>
${v.models.length ? `<p class="models">${v.models.map((m) => `<span class="model">${esc(m.model)}</span>`).join("")}</p>` : ""}
<p class="label">Main run of 3 November · test money · every figure from the run's record.</p>
${tiles}
<div class="grid">
<section class="card" aria-label="Its company card"><h2>${icon("credit-card", 18)}Its card at Airwallex</h2>${card}</section>
<section class="card" aria-label="Its mandate on Metal"><h2>${icon("database", 18)}Its mandate on Metal</h2>${mandate}</section>
</div>
<section class="card" aria-label="What Claude decided"><h2>${icon("sparkles", 18)}What Claude decided · ${v.decisions.length}</h2>
${v.decisions.length ? `<ol class="tl">${first.map(decision).join("")}</ol>${rest.length ? `<details class="morel"><summary>${rest.length} more decision${rest.length === 1 ? "" : "s"}</summary><ol class="tl">${rest.map(decision).join("")}</ol></details>` : ""}` : "<p>No decisions by Claude in this run.</p>"}
</section>
<section class="card paid" aria-label="What it paid"><h2>${icon("receipt", 18)}What it paid · ${v.payments.length}</h2>
${v.payments.length ? `<ul class="pays">${shownPays.map(pay).join("")}</ul>${morePays.length ? `<details class="morel"><summary>${morePays.length} more</summary><ul class="pays">${morePays.map(pay).join("")}</ul></details>` : ""}<p class="src">Each opens its chain on Trace any payment.</p>` : "<p>It paid nothing itself in this run.</p>"}
</section>
<p class="others">Other agents: ${AGENT_IDS.filter((x) => x !== id).map((x) => `<a href="/agents/${x}">${esc(AGENT_DISPLAY[x].name)}</a>`).join("")}<a href="/runs">Every live run</a><a href="/trace">Trace any payment</a></p>
</main>`;
  const html = page({
    title: `${v.name} · Purser`, description: `${v.name}: its limits at Airwallex and on Metal, Claude's decisions and its payments in the main run of 3 November.`, tab: null, css: CSS, body,
    source: "Source: docs/demo/main-run.json and docs/demo/main-run-trace.json (the main run, 3 Nov).",
  });
  // Served one level down (/agents/<id>): the page's own relative links and assets made absolute.
  return html.replace(/(href|src)="(?!https?:|#|\/|data:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}

export function agentPages(): Record<string, string> {
  const r = loadRecord().record, t = loadTrace();
  return Object.fromEntries(AGENT_IDS.map((id) => [id, agentPage(id, r, t)]));
}


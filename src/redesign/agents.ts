// /agents/<id>: one page per Kit 11 agent (Sourcing, Support, Treasury), from the main run of 3 Nov: its job and
// models, its limits (the company card at Airwallex and the mandate on Metal), what Claude decided for it (each with its
// Anthropic request id) and what it paid (each linking to its chain on /trace). Everything is read from the run's record
// (docs/demo/main-run.json) and its trace companion (docs/demo/main-run-trace.json); nothing is typed in.
// test/runs-page.test.ts holds the figures to the records.

import { AGENT_DISPLAY } from "../config/brand.js";
import { EXPLORER_TX } from "../metal/network.js";
import { decisionsOf, loadRecord, type AgentId, type RunRecord } from "./run.js";
import { loadTrace } from "./trace.js";
import type { RunTrace } from "../demo/runTrace.js";
import { esc, page } from "./ui.js";

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
    id, name: AGENT_DISPLAY[id].name, job: AGENT_DISPLAY[id].job,
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

const CSS = `.agentp h1 { margin: 24px 0 4px; }
.agentp .job { color: var(--muted, #5b6474); margin: 0 0 16px; }
.agentp .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px; margin-bottom: 14px; }
.agentp .card { padding: 16px 18px; }
.agentp h2 { font-size: 16px; margin: 0 0 8px; }
.agentp dl { display: grid; grid-template-columns: minmax(0, 9em) minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 14px; }
.agentp dt { color: var(--muted, #5b6474); }
.agentp dd { margin: 0; overflow-wrap: anywhere; }
.agentp ol, .agentp ul { margin: 0; padding-left: 18px; }
.agentp li { margin: 0 0 10px; overflow-wrap: anywhere; }
.agentp .src { font-size: 12px; color: var(--muted, #5b6474); }
.agentp .label { font-size: 13px; color: var(--muted, #5b6474); }
.agentp .others a { margin-right: 14px; }
.agentp details summary { cursor: pointer; margin: 6px 0; }`;

export function agentPage(id: AgentId, r?: RunRecord, t?: RunTrace): string {
  const v = agentView(id, r, t);
  const decision = (d: AgentView["decisions"][number]) => `<li><b>${esc(time(d.at))} UTC</b> · ${esc(d.model)}<br>${esc(d.text)}${d.requestId ? `<br><span class="src">Anthropic request id <code>${esc(d.requestId)}</code></span>` : ""}</li>`;
  const pay = (p: AgentView["payments"][number]) => `<li><a href="/trace#${esc(p.id)}">${esc(KIND[p.kind] ?? p.kind)} · ${esc(p.amount)} ${esc(unit(p.currency))}</a> · ${esc(time(p.at))} UTC${p.railId ? ` · ${p.railId.startsWith("0x") ? `<a href="${esc(EXPLORER_TX + p.railId)}" target="_blank" rel="noopener">tx ${esc(p.railId.slice(0, 10))}… ↗</a>` : `<code>${esc(p.railId)}</code>`}` : ""}</li>`;
  const first = v.decisions.slice(0, 3), rest = v.decisions.slice(3);
  const shownPays = v.payments.slice(0, SHOWN), morePays = v.payments.slice(SHOWN);
  const body = `<main class="wrap agentp">
<h1>${esc(v.name)}</h1>
<p class="job">It ${esc(v.job)}. ${v.models.length ? `Models: ${esc(v.models.map((m) => m.model).join(", "))}.` : ""}</p>
<p class="label">From the main run of 3 November · test money · every figure from the run's record.</p>
<div class="grid">
<section class="card" aria-label="Its company card"><h2>Its company card at Airwallex</h2>${v.card ? `<dl><dt>Card</dt><dd>····${esc(v.card.last4)}</dd><dt>Per purchase</dt><dd>EUR ${esc(v.card.per_tx)}</dd><dt>Per month</dt><dd>EUR ${esc(v.card.monthly)} (spent ${esc(v.card.spent_month)})</dd><dt>Only</dt><dd>${esc(v.card.only)}</dd></dl><p class="src">The limits sit on the card at Airwallex; Airwallex declines anything over them itself.</p>` : "<p>No card in this run.</p>"}</section>
<section class="card" aria-label="Its mandate on Metal"><h2>Its mandate on Metal</h2>${v.mandate ? `<dl><dt>Per payment</dt><dd>${esc(v.mandate.cap)} test USD</dd><dt>Budget</dt><dd>${esc(v.mandate.budget)} test USD</dd><dt>On chain</dt><dd>${v.mandate.tx ? `<a href="${esc(EXPLORER_TX + v.mandate.tx)}" target="_blank" rel="noopener">tx ${esc(v.mandate.tx.slice(0, 10))}… ↗</a>` : "not recorded"}</dd><dt>On chain in the run</dt><dd>${v.mandate.changes === 1 ? "bound once" : `${v.mandate.changes} mandate events (bound, then replaced)`}</dd></dl>` : "<p>No mandate in this run.</p>"}</section>
<section class="card" aria-label="Its numbers"><h2>Its numbers</h2>${v.stats ? `<dl><dt>Decisions</dt><dd>${v.stats.decisions}, ${v.stats.by_claude} by Claude, ${v.stats.fallback} by fallback code</dd><dt>Claude calls</dt><dd>${v.stats.claude_calls}</dd><dt>Claude cost</dt><dd>USD ${(v.stats.cost_usd_micros / 1e6).toFixed(4)}</dd><dt>Paid</dt><dd>${v.payments.length} payment${v.payments.length === 1 ? "" : "s"}${v.totals.length ? `: ${esc(v.totals.join(" + "))}` : ""}</dd></dl>` : "<p>No numbers recorded.</p>"}</section>
</div>
<section class="card" aria-label="What Claude decided"><h2>What Claude decided · ${v.decisions.length}</h2>
${v.decisions.length ? `<ol>${first.map(decision).join("")}</ol>${rest.length ? `<details><summary>${rest.length} more decision${rest.length === 1 ? "" : "s"}</summary><ol start="${first.length + 1}">${rest.map(decision).join("")}</ol></details>` : ""}` : "<p>No decisions by Claude in this run.</p>"}
</section>
<section class="card" aria-label="What it paid"><h2>What it paid · ${v.payments.length}</h2>
${v.payments.length ? `<ul>${shownPays.map(pay).join("")}</ul>${morePays.length ? `<details><summary>${morePays.length} more</summary><ul>${morePays.map(pay).join("")}</ul></details>` : ""}<p class="src">Each links to its chain, step by step, on Trace any payment.</p>` : "<p>It paid nothing itself in this run.</p>"}
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


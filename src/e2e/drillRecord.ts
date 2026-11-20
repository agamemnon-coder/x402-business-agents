// The records of the card drill and the stop drill (docs/runs/<date>-card-drill.json/.md, <date>-stop-drill.json/.md):
// built from the drill's results and its HTTP log after the run, with 0 Airwallex calls. Pure functions (tested).

import { SANDBOX_BASE } from "../airwallex/client.js";
import { countByEndpoint, type CallLine } from "../airwallex/callBudget.js";
import type { Step } from "./cardDrill.js";
import type { DrillLine } from "./drillHttp.js";

export interface DrillPass { pass_no: number; started_at: string; ended_at: string | null; stopped: string | null; note: string | null; phases?: string[]; code?: Record<string, unknown>; timings?: Record<string, number | null>; steps: Step[] }

export interface DrillRecord {
  run: "card-drill" | "stop-drill"; date: string; label: string; sandbox: string; test_money: true; command: string; commit: string | null;
  simulated: string[];
  budget: { approved: number | null; max: number; used: number; logged_requests: number; status_429: number; unexpected_non_2xx: { n: number; status: number; call: string; code: string | null }[] };
  totals: { steps: number; pass: number; fail: number; not_judged: number };
  cards: { agent: string; card_id: string; last4: string; nickname: string }[];
  passes: DrillPass[];
  calls: (DrillLine & { step: string | null })[];
  calls_by_endpoint: { endpoint: string; calls: number }[];
  not_shown: string[];
}

export function drillRecord(o: {
  run: DrillRecord["run"]; date: string; command: string; commit: string | null; simulated: string[]; max: number; approved: number | null;
  cards: DrillRecord["cards"]; passes: DrillPass[]; lines: DrillLine[]; callLog: CallLine[]; notShown: string[];
}): DrillRecord {
  const owner = new Map<number, string>();
  for (const p of o.passes) for (const s of p.steps) for (const n of s.lines) owner.set(n, `${o.passes.length > 1 ? `pass ${p.pass_no} ` : ""}${s.id}${s.agent ? ` (${s.agent})` : ""}`);
  const steps = o.passes.flatMap((p) => p.steps);
  return {
    run: o.run, date: o.date, label: "Airwallex sandbox · test money", sandbox: SANDBOX_BASE, test_money: true, command: o.command, commit: o.commit, simulated: o.simulated,
    budget: {
      approved: o.approved, max: o.max, used: o.callLog.length, logged_requests: o.lines.length, status_429: o.lines.filter((l) => l.status === 429).length,
      unexpected_non_2xx: o.lines.filter((l) => l.status === 0 || (l.status >= 400 && l.status !== 429)).map((l) => ({ n: l.n, status: l.status, call: `${l.method} ${l.endpoint}`, code: l.code })),
    },
    totals: { steps: steps.length, pass: steps.filter((s) => s.pass === true).length, fail: steps.filter((s) => s.pass === false).length, not_judged: steps.filter((s) => s.pass === null).length },
    cards: o.cards, passes: o.passes,
    calls: o.lines.map((l) => ({ ...l, step: owner.get(l.n) ?? (l.endpoint === "/authentication/login" ? "login" : null) })),
    calls_by_endpoint: countByEndpoint(o.callLog), not_shown: o.notShown,
  };
}

const cell = (v: unknown) => String(v ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
const mark = (p: boolean | null) => (p === true ? "**pass**" : p === false ? "**FAIL**" : "not judged");
const hhmmss = (iso: string) => (iso ? iso.slice(11, 23) : "–");

export function renderDrillMarkdown(r: DrillRecord, o: { title: string; intro: string; file: string; summary: string[] }): string {
  const out: string[] = [];
  out.push(`# ${o.title}: ${r.date}`, "");
  out.push(`\`${r.command}\`. ${o.intro} The **Airwallex sandbox** only (${r.sandbox}), test money only.${r.commit ? ` Code: \`${r.commit.slice(0, 12)}\`.` : ""} The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is ${o.file}.`, "");
  out.push(`**${r.totals.pass} of ${r.totals.steps} steps passed, ${r.totals.fail} failed, ${r.totals.not_judged} not judged** (measurements, or not supported by the sandbox). ${r.budget.used} Airwallex calls of a budget of ${r.budget.approved ?? "–"} (the drill's hard limit: ${r.budget.max}; logins included), one at a time, at least 200 ms apart; ${r.budget.status_429} answered 429; ${r.budget.unexpected_non_2xx.length} unexpected non-2xx.`, "");
  if (o.summary.length) { out.push("## In short", ""); for (const s of o.summary) out.push(`- ${s}`); out.push(""); }
  out.push("## Simulated, and how", "");
  for (const s of r.simulated) out.push(`- ${s}`);
  out.push("");
  if (r.cards.length) {
    out.push("## The cards", "", "| Agent | Card id | Last 4 | Nickname at Airwallex |", "|---|---|---|---|");
    for (const c of r.cards) out.push(`| ${c.agent} | \`${c.card_id}\` | ${c.last4} | ${cell(c.nickname)} |`);
    out.push("");
  }
  for (const p of r.passes) {
    out.push(`## ${r.passes.length > 1 ? `Pass ${p.pass_no}` : "Steps"} (${hhmmss(p.started_at)}–${hhmmss(p.ended_at ?? "")} UTC)`, "");
    if (p.note) out.push(p.note, "");
    if (p.code) out.push(`Code under test: ${Object.entries(p.code).map(([k, v]) => `\`${k}\` ${String(v)}`).join(", ")}.`, "");
    if (p.stopped) out.push(`**Stopped:** ${p.stopped}`, "");
    out.push("| # | Step | Agent | Expected | What happened | Result | Calls | ms |", "|---|---|---|---|---|---|---|---|");
    p.steps.forEach((s, i) => out.push(`| ${i + 1} | \`${s.id}\` ${cell(s.title)}${s.simulated ? ` *(simulated: ${cell(s.simulated)})*` : ""} | ${s.agent ?? "–"} | ${cell(s.expect)} | ${cell(s.outcome)} | ${mark(s.pass)} | ${s.lines.length ? s.lines.join(", ") : "0"} | ${s.ms} |`));
    out.push("");
    if (p.timings && Object.keys(p.timings).length) {
      out.push("Timings: " + Object.entries(p.timings).map(([k, v]) => `${k} ${v ?? "–"} ms`).join("; ") + ".", "");
    }
  }
  out.push("## Every request (UTC; no body, header, token, key or card number)", "", "The Calls column above lists these line numbers.", "", "| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const l of r.calls) out.push(`| ${l.n} | ${hhmmss(l.at)} | ${hhmmss(l.answered_at)} | ${l.ms} | \`${l.method} ${l.endpoint}\` | ${l.status}${l.code ? ` ${l.code}` : ""} | ${l.awx_request_id ? `\`${l.awx_request_id}\`` : "–"} | ${l.trace_id ? `\`${l.trace_id}\`` : "–"} | ${l.card_status ?? (l.sim ? `auth ${l.sim.process_result ?? l.sim.status ?? "?"}${l.sim.failure_reason ? ` ${l.sim.failure_reason}` : ""}` : "–")} | ${cell(l.step)} |`);
  out.push("", "Calls by endpoint: " + r.calls_by_endpoint.map((e) => `\`${e.endpoint}\` ${e.calls}`).join(", ") + ".", "");
  out.push("## What this does not show", "");
  for (const s of r.not_shown) out.push(`- ${s}`);
  out.push("");
  return out.join("\n");
}

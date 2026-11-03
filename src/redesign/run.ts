// The public pages (Home, Watch, Proof, the partner pages and the CFO dashboard's replay) play one recorded agent run:
// agent run 1 (rehearsal), 2 November, recorded with `npm run autonomy-record` into docs/demo/agent-run.json. Without
// that file the newest autonomous dry run (docs/demo/autonomy.json) is shown instead, under its own name. Nothing is
// typed in by hand: the events, the agents' words and models, the money, the signatures and every proof id come from
// the record (test/redesign-numbers.test.ts fails on a number the record lacks).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AGENT_DISPLAY } from "../config/brand.js";
import type { RunLedger } from "../demo/runLedger.js";

/** Agent run 1's record (the same form `npm run autonomy-record` writes). */
export const AGENT_RUN_FILE = "docs/demo/agent-run.json";
/** Shown only when the agent run's record is absent: the newest autonomous dry run. */
export const STAND_IN_FILE = "docs/demo/autonomy.json";

export type AgentId = keyof typeof AGENT_DISPLAY;
const AGENTS: AgentId[] = ["sourcing", "support", "treasury"];

interface Chat { ts: string; kind: "decision" | "message" | "world"; who: string; by: string | null; model: string | null; text: string }
interface Flow { at: string; kind: string; agent: string | null; model: string | null; decided: string; request?: string; what: string; amount: string; unit: string; rail: string; count?: number; proof: { label: string; href: string | null; full?: string | null }; refused?: { by: string; reason: string } }
interface Trace { run_seq?: number; agent: string; task: string; status: string; model: string; tokens?: { input: number; output: number; cache_read: number; cache_write: number }; latency_ms?: number; claude_ms?: number[]; request_ids?: string[]; cost_usd_micros?: number; steps: { ts: string; kind: string; tool: string | null; input: unknown }[] }
interface Refusal { seq: number; ts: string; agent: string; what: string; reason: string }
interface Decision { proposal_id: string; title: string; status: string; by: string | null; at: string }
interface Stat { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; cost_usd_micros: number; models: string[] }
export interface RunRecord {
  recorded_at: string; run: string; kind?: string;
  snapshot: {
    agent_chat: Chat[]; flows: Flow[]; traces: Trace[]; refusals: Refusal[]; decisions: Decision[]; agent_stats: Stat[];
    counts: { alone: number; blocked: number };
    audit: { rows: number; intact: boolean };
    tower: { agents: { agent: string; mandate: { cap: string; budget: string } | null }[] };
    rails: { metal: { what: string; detail: string; proof: { label: string; href: string | null } | null }[]; airwallex: { what: string; detail: string; proof: { label: string; href: string | null } | null }[] };
  };
  proof: { face_id: number; chain_refusals: number; card_declines: number; ai_tricks: number };
  /** The run's ledger rows in full (src/demo/runLedger.ts); absent in records made before it. */
  ledger?: RunLedger;
}

export interface Proof { label: string; href: string | null }
/** One agent decision's Claude call(s), from its trace in the record (D2): model family, total tokens, latency, first request id. */
export interface Call { family: string; tokens: number; /** Claude's own time over the decision's calls (claude_ms summed). */ latencyMs: number; /** The whole decision, tools and waits included (latency_ms). */ wallMs: number; requestId: string; requestIds: string[]; calls: number }
/**
 * Who said no, in one vocabulary: "recorded" is Purser refusing before signing with Metal recording the same refusal on
 * chain; "metal" is Metal's facilitator; "airwallex" is an Airwallex limit; "airwallex-sandbox" is the sandbox failing
 * to do something (not a limit); "purser" is Purser alone. The raw code stays in `code` for a tooltip.
 */
export interface Refused { by: "recorded" | "metal" | "airwallex" | "airwallex-sandbox" | "purser"; reason: string; code?: string }
export type Ev =
  | { k: "world"; at: string; text: string }
  | { k: "say"; at: string; agent: AgentId; model: string | null; by: "claude" | "fallback"; text: string; tools: string[]; call?: Call | null }
  | { k: "msg"; at: string; agent: AgentId; text: string }
  | { k: "money"; at: string; agent: AgentId | null; rail: "metal" | "airwallex"; via: string; dir: "in" | "out"; what: string; amount: string; unit: string; count: number; label: string; refused: Refused | null; proof: Proof; run?: string; /** Who decided it: code, or the agent's Claude model (the flow's own "decided"). */ by?: string; /** A failed attempt before the one that paid: nothing paid. */ earlier?: boolean; /** The proposal that paid it later. */ retried?: { id: string; at: string; status: string } }
  | { k: "face"; at: string; id: string; title: string; status: string; signers: string[]; /** STOPPED: why code did not run it. */ reason?: string }
  | { k: "mandate"; at: string; agent: AgentId; cap: string; budget: string; proposal: string; proof: Proof }
  | { k: "routine"; at: string; count: number; agents: AgentId[]; text: string }
  | { k: "shield"; at: string; text: string };

export type Mini =
  | { kind: "price"; from: string; old: string | null; price: string; cap: string; newCap: string | null; tx: Proof | null; signers: number }
  | { kind: "orders"; orders: string[]; refunded: string[] }
  | { kind: "flow"; rows: { icon: string; text: string; tone: "ok" | "bad" | "face" }[] };
export interface Step { icon: string; text: string; tone: "ok" | "bad" | "face" | "info"; proof?: Proof }
export interface Scene { n: 1 | 2 | 3; title: string; start: number; steps: Step[]; sentence: string; mini: Mini | null }
export interface Tile { value: string; label: string; explain: string; href: string; parts?: { value: string; label: string }[]; /** The details, in the tooltip. */ tip?: string }
export interface AgentCard { id: AgentId; name: string; short: string; model: string; family: string }

export interface AgentRun {
  file: string; standIn: boolean; name: string; label: string; recordedAt: string; kind: string;
  agents: AgentCard[]; events: Ev[]; scenes: Scene[]; tiles: Tile[];
  /** Figures the pages count from the record (sums, ratios), by name; the number test counts them again. */
  derived: Record<string, string>;
  record: RunRecord;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T;
const isAgent = (a: string | null): a is AgentId => !!a && (AGENTS as string[]).includes(a);
export const family = (model: string | null | undefined) => (/claude-(haiku|sonnet|opus)/i.exec(model ?? "")?.[1] ?? "").replace(/^./, (c) => c.toUpperCase());
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** "EUR 240.00", "1.97 test USD": an amount as the pages write it. */
export const money = (amount: string, unit: string) => unit === "EUR" ? `EUR ${amount}` : unit === "USD" ? `USD ${amount}` : `${amount} test USD`;
const SHORT_EUR = (a: string) => `€${a.replace(/\.00$/, "")}`;

/** The record the pages play: agent run 1's when it is in the repo, else the newest dry run. */
export function loadRecord(): { file: string; standIn: boolean; record: RunRecord } {
  const own = existsSync(new URL(`../../${AGENT_RUN_FILE}`, import.meta.url));
  const file = own ? AGENT_RUN_FILE : STAND_IN_FILE;
  const record = readJson<RunRecord>(file);
  if (own && existsSync(new URL(`../../${AGENT_RUN_NOTES}`, import.meta.url))) applyNotes(record, readJson<RunNotes>(AGENT_RUN_NOTES));
  return { file, standIn: !own, record };
}

/** Facts about agent run 1 its ledger does not hold (who started the licence payment), each with its source. */
export const AGENT_RUN_NOTES = "docs/demo/agent-run-notes.json";
interface RunNotes { flows: { transfer_id: string; decided: string; source: string }[] }
function applyNotes(r: RunRecord, n: RunNotes): void {
  for (const note of n.flows) {
    for (const f of r.snapshot.flows) {
      const full = (f as { proof?: { full?: string } }).proof?.full;
      if (full === note.transfer_id) { f.decided = note.decided; f.what = `${f.what}: ${note.decided}`; }
    }
  }
}

/** The run's short name: "agent run 1 (rehearsal), 2 Nov" → "agent run 1"; a dry run keeps its name up to the colon. */
export const runName = (r: RunRecord) => r.run.split(":")[0]!.replace(/\s*\([^)]*\)/g, "").replace(/,\s*\d{1,2} \w+( \d{4})?$/, "").trim();

/**
 * The run's time span, from its own rows (the first and last event in the record), and whether a later part follows a
 * long pause (more than an hour without an event: a follow-up, such as agent run 1's licence paid in the afternoon).
 */
export function runSpan(r: RunRecord): { from: string; to: string; followUp: boolean } {
  const ts = [...r.snapshot.agent_chat.map((c) => c.ts), ...r.snapshot.flows.map((f) => f.at), ...(r.ledger?.events.map((e) => e.ts) ?? []),
    ...r.snapshot.traces.flatMap((t) => t.steps.map((x) => x.ts))].filter(Boolean).sort();
  const gap = ts.slice(1).reduce((g, t, i) => Math.max(g, Date.parse(t) - Date.parse(ts[i]!)), 0);
  return { from: ts[0] ?? r.recorded_at, to: ts[ts.length - 1] ?? r.recorded_at, followUp: gap > 60 * 60 * 1000 };
}
const hhmm = (iso: string) => iso.slice(11, 16);

/** The label every page shows above the run: its name (and follow-up), its day and time span, test money, who decided. */
export function runLabel(r: RunRecord): string {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0), byClaude = s.reduce((n, a) => n + a.by_claude, 0);
  const claude = decisions && byClaude === decisions ? "real Claude decisions" : `${byClaude} of ${decisions} decisions by Claude`;
  const span = runSpan(r);
  return `Replay of ${runName(r)}${span.followUp ? " and its follow-up" : ""}, ${day(span.from)} ${hhmm(span.from)}–${hhmm(span.to)} UTC · test money · ${claude}`;
}

/** The label of a movement's coin on its rail: "0.05 per query · x402", "€240 · SWIFT". */
/** The label of a movement's coin on its rail, in plain words: "0.05 per query · x402", "sweep 1.97 → Airwallex". */
function coinLabel(f: { amount: string; unit: string; count: number; via: string; kind: string }): string {
  if (!f.amount) return f.kind === "upstream" ? "stock check · x402" : f.via;
  if (f.kind === "booked") return `${f.unit === "EUR" ? SHORT_EUR(f.amount) : f.amount} booked at Airwallex`;
  if (f.kind === "deposit") return `${f.unit === "EUR" ? SHORT_EUR(f.amount) : f.amount} paid in`;
  if (f.via === "card") return `${SHORT_EUR(f.amount)} card buy`;
  if (f.unit === "EUR") return `${SHORT_EUR(f.amount)} · ${f.via}`;
  if (f.kind === "sale" || f.kind === "upstream") return `${(Number(f.amount) / f.count).toFixed(2)} per query · x402`;
  if (f.kind === "sweep") return `sweep ${f.amount} → Airwallex`;
  if (f.kind === "refund") return `refund ${f.amount}`;
  return `${f.amount} · x402`;
}

const VIA: Record<string, string> = { metal: "x402", purser: "x402", airwallex_swift: "SWIFT", airwallex_card: "card", airwallex_deposit: "deposit", airwallex_fx: "FX" };

/** The trace of the decision an agent made at `at` (its last step is the decision's moment), or null. */
export function traceAt(r: RunRecord, agent: string, at: string): Trace | null {
  const t = Date.parse(at);
  const best = r.snapshot.traces.filter((x) => x.agent === agent && x.steps.length).map((x) => ({ x, d: Math.abs(Date.parse(x.steps[x.steps.length - 1]!.ts) - t) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d < 5000 ? best.x : null;
}
/** A trace's Claude call(s) as the badge shows them; null when the trace has no request id (no Claude call recorded). */
export function callOf(t: Trace | null): Call | null {
  if (!t?.request_ids?.length || !t.tokens) return null;
  const k = t.tokens;
  return { family: family(t.model), tokens: k.input + k.output + k.cache_read + k.cache_write, latencyMs: t.claude_ms?.length ? t.claude_ms.reduce((n, x) => n + x, 0) : t.latency_ms ?? 0, wallMs: t.latency_ms ?? 0, requestId: t.request_ids[0]!, requestIds: t.request_ids, calls: t.request_ids.length };
}
/** "Claude call ✓ · Opus · 3,861 tokens · 3.4 s · req_011CgeFq…" (D2). */
export const callTip = (c: Call) => `${c.calls} Claude call${c.calls > 1 ? "s" : ""} (${c.requestIds.join(", ")}): ${(c.latencyMs / 1000).toFixed(1)} s of Claude time; the decision took ${(c.wallMs / 1000).toFixed(1)} s in all, tools included.`;
export const callBadge = (c: Call) => `Claude call ✓ · ${c.family} · ${c.tokens.toLocaleString("en-US")} tokens · ${(c.latencyMs / 1000).toFixed(1)} s · ${c.requestId.slice(0, 12)}…`;

function events(r: RunRecord): Ev[] {
  const s = r.snapshot;
  const out: Ev[] = [];
  const toolsFor = (agent: string, at: string) => {
    const t = Date.parse(at);
    const best = s.traces.filter((x) => x.agent === agent && x.steps.length).map((x) => ({ x, d: Math.abs(Date.parse(x.steps[x.steps.length - 1]!.ts) - t) })).sort((a, b) => a.d - b.d)[0];
    return best && best.d < 5000 ? best.x.steps.filter((st) => st.kind === "tool" && st.tool && st.tool !== "finish").map((st) => st.tool!) : [];
  };
  for (const c of s.agent_chat) {
    if (c.kind === "world") {
      const text = c.text.trim().replace(/^([^:]+): \1: /, "$1: ").replace(/^Money in:\s*/, "");
      // Raw event names, and purchases refused before signing, are told by their own rows (a money movement, a refusal).
      if (!text || /^[a-z_]+\.[a-z_.]+$/.test(text) || /^A purchase from \S+ was refused before signing/.test(text)) continue;
      out.push({ k: "world", at: c.ts, text });
    } else if (c.kind === "decision" && isAgent(c.who)) {
      out.push({ k: "say", at: c.ts, agent: c.who, model: c.model, by: c.by === "claude" ? "claude" : "fallback", text: c.text, tools: toolsFor(c.who, c.ts), call: c.by === "claude" ? callOf(traceAt(r, c.who, c.ts)) : null });
    } else if (c.kind === "message" && isAgent(c.who)) {
      out.push({ k: "msg", at: c.ts, agent: c.who, text: c.text });
    }
  }
  const flows = [...s.flows].sort((x, y) => x.at.localeCompare(y.at));
  const merged = new Set<Flow>();
  for (const f of flows) {
    if (merged.has(f)) continue;
    const rail = f.rail === "metal" || f.rail === "purser" ? "metal" : f.rail.startsWith("airwallex") ? "airwallex" : null;
    if (!rail) continue;
    const via = VIA[f.rail] ?? "Airwallex";
    const count = f.count ?? 1;
    let refused: Refused | null = f.refused ? { by: (["metal", "airwallex", "purser"].includes(f.refused.by) ? f.refused.by : "purser") as Refused["by"], reason: f.refused.reason, code: /^([a-z_]+)/.exec(f.refused.reason)?.[1] } : null;
    let proof: Proof = { label: f.proof.label, href: f.proof.href };
    // One attempt, one step: Purser refused it before signing, and Metal then recorded the same refusal on chain.
    if (f.refused?.by === "purser") {
      const onChain = flows.find((g) => g !== f && g.refused?.by === "metal" && g.proof.href && g.amount === f.amount && g.agent === f.agent && Date.parse(g.at) >= Date.parse(f.at) && Date.parse(g.at) - Date.parse(f.at) < 15_000);
      if (onChain) {
        merged.add(onChain);
        refused = { by: "recorded", reason: "Purser refused it before signing; Metal recorded the same refusal on chain", code: refused?.code };
        proof = { label: onChain.proof.label, href: onChain.proof.href };
      }
    }
    if (refused && refused.by === "metal" && /mandate_revoked/.test(f.refused!.reason)) refused = { by: "metal", reason: "the old mandate was revoked by its replacement", code: "mandate_revoked" };
    out.push({ k: "money", at: f.at, agent: isAgent(f.agent) ? f.agent : null, rail, via, dir: ["sale", "deposit", "booked"].includes(f.kind) ? "in" : "out", what: f.what, amount: f.amount, unit: f.unit, count, label: coinLabel({ ...f, count, via }), refused, proof, by: f.decided });
  }
  const titleOf = (id: string) => s.decisions.find((d) => d.proposal_id === id)?.title ?? r.ledger?.proposals.find((p) => p.proposal_id === id)?.kind.replace(/_/g, " ") ?? id;
  const person = (who: string) => who.trim().replace(/\s*\(.*\)$/, "").replace(/^./, (c) => c.toUpperCase());
  if (r.ledger) {
    // From the run's own rows: each signature when it was given (four eyes: 1 of 2, then 2 of 2), and what followed.
    for (const row of r.ledger.events) {
      const id = row.subject ?? "";
      const approver = String(row.payload.approver ?? "");
      if (row.event === "proposal.cosigned") out.push({ k: "face", at: row.ts, id, title: titleOf(id), status: "COSIGNED", signers: [person(approver)] });
      else if (row.event === "proposal.approved") out.push({ k: "face", at: row.ts, id, title: titleOf(id), status: "APPROVED", signers: approver.split(/\s*\+\s*/).map(person) });
      else if (row.event === "proposal.rejected") out.push({ k: "face", at: row.ts, id, title: titleOf(id), status: "REJECTED", signers: approver.split(/\s*\+\s*/).map(person) });
      else if (row.event === "proposal.needs_reapproval") { const f = stoppedFace(row, titleOf(id)); if (f) out.push(f); }
      else if (row.event === "mandate.replaced" && isAgent(row.subject)) {
        const tx = String(row.payload.tx ?? "");
        out.push({ k: "mandate", at: row.ts, agent: row.subject, cap: String(row.payload.cap ?? ""), budget: String(row.payload.budget ?? ""), proposal: String(row.payload.proposal_id ?? ""), proof: { label: `tx ${tx.slice(0, 6)}…${tx.slice(-4)}`, href: `https://testnet.metalntwx.com/tx/${tx}` } });
      } else if (row.event === "proposal.failed") {
        const terms = r.ledger.proposals.find((p) => p.proposal_id === id)?.terms ?? {};
        const error = String(row.payload.error ?? "");
        const code = /-> \d{3} ([a-z_]+)/.exec(error)?.[1] ?? "failed";
        const amount = String(terms.amount ?? ""), unit = String(terms.currency ?? "EUR"), method = String(terms.method ?? "transfer");
        const awx = /Airwallex/i.test(error);
        if (!awx) continue;
        out.push({ k: "money", at: new Date(Date.parse(row.ts) + 1).toISOString(), agent: "treasury", rail: "airwallex", via: method, dir: "out", what: `${String(terms.vendor ?? "the supplier")}'s invoice ${String(terms.invoice_no ?? "")} (${id})`.replace("  ", " "), amount, unit, count: 1,
          label: amount ? `${unit === "EUR" ? SHORT_EUR(amount) : amount} invoice · ${method}` : method,
          refused: code === "fee_unknown" ? { by: "airwallex-sandbox", reason: "the sandbox could not price the fee; nothing paid", code } : { by: "airwallex", reason: `${code}; nothing paid`, code },
          proof: { label: `${error} · no transfer made`, href: null }, earlier: r.ledger.proposals.some((p) => p.status === "EXECUTED" && String(p.terms?.invoice_no ?? "") === String(terms.invoice_no ?? "") && p.proposal_id !== id),
          retried: (() => { const p = r.ledger.proposals.find((x) => x.status === "EXECUTED" && String(x.terms?.invoice_no ?? "") === String(terms.invoice_no ?? "") && x.proposal_id !== id); const done = p && r.ledger.events.find((e) => e.event === "proposal.executed" && e.subject === p.proposal_id); return p && done ? { id: p.proposal_id, at: done.ts, status: String(done.payload.status ?? "") } : undefined; })() });
      }
    }
  } else {
    for (const d of s.decisions) {
      if (!d.by) continue; // superseded: nobody signed it
      out.push({ k: "face", at: d.at, id: d.proposal_id, title: d.title, status: d.status, signers: d.by.replace(/\s*·\s*Face ID$/, "").split(/\s*&\s*/) });
    }
  }
  for (const x of s.refusals) if (/planted instruction/i.test(x.what)) out.push({ k: "shield", at: x.ts, text: x.what });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * dry-179: an approved proposal code did not run because its executor's guard refused it (closed, NEEDS_REAPPROVAL), as
 * a step of Watch with the reason; null for any other needs_reapproval row (its other options closed with it).
 */
export function stoppedFace(row: { ts: string; event: string; subject: string | null; payload: Record<string, unknown> }, title: string): Extract<Ev, { k: "face" }> | null {
  if (row.event !== "proposal.needs_reapproval" || typeof row.payload.stopped !== "string") return null;
  return { k: "face", at: row.ts, id: row.subject ?? "", title, status: "STOPPED", signers: [], reason: String(row.payload.error ?? "") };
}

/** The live TAP run (docs/runs/visa-tap-live-*.json): a separate run of 2 November, shown under its own label. */
export interface TapStep { by: string; model: string | null; plan: string; proxyStatus: number; sig1: string; sig2: string; txId: string; approved: boolean; reason: string | null; amount: string; currency: string; getStatus: string; brand: string }
export interface TapRun { file: string; ranAt: string; label: string; commit: string; merchant: string; steps: TapStep[]; labels: string[] }
export function tapRun(): TapRun | null {
  const dir = new URL("../../docs/runs/", import.meta.url);
  const name = existsSync(dir) ? readdirSync(dir).filter((f) => /^visa-tap-live.*\.json$/.test(f)).sort().pop() : undefined;
  if (!name) return null;
  const r = readJson<{ ran_at: string; reference: { commit: string }; merchant: { name: string }; card: { brand_as_returned: { brand: string } }; labels: string[];
    steps: { by: string; plan: string; tap: { proxy_status: number; sig1: string; sig2: string }; airwallex: { transaction_id: string; approved: boolean; failure_reason: string | null; confirmed_by_get: { status: string; amount: string; currency: string } }; origin: { model?: string } }[] }>(`docs/runs/${name}`);
  return {
    file: `docs/runs/${name}`, ranAt: r.ran_at, label: `TAP run · ${day(r.ran_at)} · test money`, commit: r.reference.commit.slice(0, 7), merchant: r.merchant.name, labels: r.labels,
    steps: r.steps.map((s) => ({ by: s.by, model: s.origin.model ?? null, plan: s.plan, proxyStatus: s.tap.proxy_status, sig1: s.tap.sig1, sig2: s.tap.sig2, txId: s.airwallex.transaction_id, approved: s.airwallex.approved, reason: s.airwallex.failure_reason, amount: s.airwallex.confirmed_by_get.amount, currency: s.airwallex.confirmed_by_get.currency, getStatus: s.airwallex.confirmed_by_get.status, brand: r.card.brand_as_returned.brand })),
  };
}

const firstIdx = (ev: Ev[], f: (e: Ev) => boolean) => ev.findIndex(f);
const isMoney = (e: Ev): e is Extract<Ev, { k: "money" }> => e.k === "money";

function scenes(r: RunRecord, ev: Ev[]): Scene[] {
  const s = r.snapshot;
  const out: Scene[] = [];
  const nameOf = (a: AgentId) => AGENT_DISPLAY[a].name.replace(/ agent$/, "");

  // 1. The price rise, from the first refusal over the mandate's cap (or the supplier's notice) to the replaced mandate.
  const capRefusal = ev.findIndex((e) => isMoney(e) && !!e.refused && (e.refused.code === "mandate_cap_exceeded" || /mandate_cap|over the mandate/.test(e.refused.reason)));
  const notice = firstIdx(ev, (e) => e.k === "world" && /asks \d/i.test(e.text));
  const i1 = [capRefusal, notice].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (i1 >= 0) {
    const w = notice >= 0 ? ev[notice] as Extract<Ev, { k: "world" }> : null;
    const price = /(\d+\.\d{2})/.exec(w?.text ?? "")?.[1] ?? (capRefusal >= 0 ? (ev[capRefusal] as Extract<Ev, { k: "money" }>).amount : "");
    const supplier = /^(\S+)/.exec(w?.text ?? "")?.[1] ?? (capRefusal >= 0 ? (ev[capRefusal] as Extract<Ev, { k: "money" }>).what : "");
    const chain = ev.slice(i1).find((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && (e.refused?.by === "recorded" || e.refused?.by === "metal") && !!e.proof.href);
    const capWas = s.flows.map((f) => /mandate's (\d+\.\d{2})/.exec(f.refused?.reason ?? "")?.[1]).find(Boolean) ?? s.tower.agents.find((a) => a.agent === "sourcing")?.mandate?.cap ?? "";
    const replan = ev.slice(i1).find((e): e is Extract<Ev, { k: "say" }> => e.k === "say" && e.agent === "treasury" && e.tools.some((t) => /rebalance|plan/.test(t)));
    const signed = ev.slice(i1).find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && /mandate/i.test(e.title) && (e.status === "EXECUTED" || e.status === "APPROVED"));
    const replaced = ev.slice(i1).find((e) => e.k === "mandate" || (e.k === "world" && /mandate was replaced/i.test(e.text)));
    const newCap = signed ? s.tower.agents.find((a) => a.agent === "sourcing")?.mandate?.cap ?? null : null;
    const before = s.flows.find((f) => f.kind === "upstream" && f.what === supplier && !f.refused && Date.parse(f.at) < Date.parse(ev[i1]!.at));
    const old = before ? (Number(before.amount) / (before.count ?? 1)).toFixed(2) : null;
    const steps: Step[] = [{ icon: "trending-up", text: `${supplier} ${old ? `${old} → ` : ""}${price}`, tone: "info" }];
    if (chain) steps.push({ icon: "ban", text: "Refused · recorded on chain", tone: "bad", proof: chain.proof });
    if (replan) steps.push({ icon: "bot", text: `${nameOf("treasury")} · ${family(replan.model)} replans`, tone: "ok" });
    if (signed) steps.push({ icon: "scan-face", text: `${signed.signers.length} of ${signed.signers.length} signatures`, tone: "face" });
    if (replaced && newCap) steps.push({ icon: "circle-check", text: `Mandate replaced: cap ${newCap}`, tone: "ok" });
    const parts = [`${supplier} raises its price to ${price}`, chain ? "refused, and recorded on chain" : "", replan ? "Treasury replans" : "", signed ? `${signed.signers.length === 2 ? "two" : String(signed.signers.length)} signatures` : "", replaced ? "the mandate is replaced" : ""].filter(Boolean);
    out.push({ n: 1, title: "The price rise", start: i1, steps, sentence: `${parts.join(" → ")}.`, mini: price && capWas ? { kind: "price", from: supplier, old, price, cap: capWas, newCap, tx: chain?.proof ?? null, signers: signed?.signers.length ?? 0 } : null });
  }

  // 2. The dispute: every order the Support agent checked, the ones it refunded itself, and what the CFO decided.
  const i2 = firstIdx(ev, (e) => e.k === "world" && /dispute/i.test(e.text));
  if (i2 >= 0) {
    const t = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
    const orders = t ? [...new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => String((x.input as { seq?: number }).seq ?? "")))].filter(Boolean) : [];
    const refunds = ev.filter((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.agent === "support" && /refund/i.test(e.what) && !e.refused);
    const refunded = refunds.map((e) => /#(\d+)/.exec(e.what)?.[1]).filter((x): x is string => !!x);
    const face = ev.slice(i2).find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && /refund/i.test(e.title));
    const steps: Step[] = [{ icon: "users", text: `${orders.length} orders disputed`, tone: "info" }];
    if (orders.length) steps.push({ icon: "check", text: "Every signed order checked", tone: "ok" });
    if (refunds.length) steps.push({ icon: "undo-2", text: `${refunds.length} wrong ones refunded`, tone: "ok", proof: refunds[0]!.proof });
    if (face) steps.push({ icon: "scan-face", text: `CFO ${face.status === "REJECTED" ? "rejects" : "approves"} the rest`, tone: "face" });
    out.push({ n: 2, title: "The dispute", start: i2, steps, mini: orders.length ? { kind: "orders", orders, refunded } : null,
      sentence: `A customer's agent disputes ${orders.length} orders → Support checks every signed order → refunds only the ${refunds.length} wrong ones${face ? ` → the CFO ${face.status === "REJECTED" ? "rejects" : "approves"} the rest` : ""}.` });
  }

  // 3. Earnings and euros: the sweep after finality, booked at Airwallex; the euro bill and what Airwallex did with it.
  const sweep = ev.find((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.agent === "treasury" && /sweep/i.test(e.what) && e.rail === "metal" && !e.refused);
  const moneyIn = sweep ? ev.slice(0, ev.indexOf(sweep)).map((e, i) => ({ e, i })).reverse().find(({ e }) => e.k === "world")?.i ?? ev.indexOf(sweep) : -1;
  const i3 = moneyIn >= 0 ? moneyIn : firstIdx(ev, (e) => e.k === "world" && /invoice/i.test(e.text));
  if (i3 >= 0) {
    const booked = ev.find((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.via === "deposit" && e.dir === "in");
    // The licence's end point: the SWIFT payout that was paid, when the run has one (Max, 2 Nov: a failed attempt before
    // it, such as fee_unknown, stays honest proof on Watch and Proof, not the end point here); else the first attempt.
    const bills = ev.filter((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.via === "SWIFT");
    const bill = bills.find((e) => !e.refused) ?? bills[0];
    const face = bill ? ev.find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && bill.what.includes(e.id))
      ?? ev.filter((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && /invoice/i.test(e.title) && e.status === "APPROVED" && e.at <= bill.at).pop() : undefined;
    const steps: Step[] = [];
    if (sweep) steps.push({ icon: "wallet", text: `${money(sweep.amount, sweep.unit)} swept after finality`, tone: "ok", proof: sweep.proof });
    if (booked) steps.push({ icon: "landmark", text: `${money(booked.amount, booked.unit)} booked at Airwallex`, tone: "ok" });
    if (bill && !bill.refused && face) steps.push({ icon: "circle-check", text: `${bill.unit === "EUR" ? SHORT_EUR(bill.amount) : money(bill.amount, bill.unit)} licence paid by SWIFT · Face ID`, tone: "ok" });
    else {
      if (bill && face) steps.push({ icon: "scan-face", text: `${money(bill.amount, bill.unit)} licence: Face ID approved`, tone: "face" });
      if (bill) steps.push({ icon: bill.refused ? "ban" : "circle-check", text: bill.refused ? (bill.refused.by === "airwallex-sandbox" ? `Airwallex: ${bill.refused.reason}` : `Airwallex refused: ${bill.refused.reason}`) : "Paid by SWIFT", tone: bill.refused ? "bad" : "ok" });
    }
    // The card-only buy signed with Visa TAP comes from the separate TAP run of the same day, under its own label.
    const tap = tapRun();
    const tapBuy = tap?.steps.find((x) => x.approved && x.model);
    if (tapBuy) steps.push({ icon: "credit-card", text: `TAP run: ${SHORT_EUR(tapBuy.amount)} card buy, Visa TAP`, tone: "ok" });
    const parts = [sweep ? "Earnings swept after finality" : "", bill && !bill.refused && face ? "licence paid by SWIFT after Face ID" : "", bill && (bill.refused || !face) && face ? "licence approved with Face ID" : "", bill && (bill.refused || !face) ? (bill.refused ? (bill.refused.by === "airwallex-sandbox" ? "Airwallex's sandbox could not price the fee, nothing paid" : "Airwallex refused it, nothing paid") : "paid by SWIFT") : "", tapBuy ? "a card buy signed with Visa TAP (TAP run)" : ""].filter(Boolean);
    out.push({ n: 3, title: "Earnings and euros", start: i3, steps, sentence: `${parts.join(" → ")}.`, mini: steps.length ? { kind: "flow", rows: steps.filter((x) => x.icon !== "landmark").map((x) => ({ icon: x.icon, text: x.text, tone: x.tone === "info" ? "ok" : x.tone })) } : null });
  }
  return out;
}

/**
 * Who stopped a payment at a limit: Metal against the on-chain mandate and the CFO with Face ID, in this run; Airwallex
 * at the card's limit, from the TAP run of the same day (labelled so). Not counted, because it is not a limit: an
 * Airwallex sandbox failure such as fee_unknown (`feeUnknown`).
 */
export function stops(r: RunRecord): { metal: number; revoked: number; airwallex: number; cfo: number; feeUnknown: number } {
  const s = r.snapshot;
  return {
    // At a limit: over the mandate's cap. Apart: a payment under an old mandate refused because it had just been replaced.
    metal: s.flows.filter((f) => f.refused?.by === "metal" && !/mandate_revoked/.test(f.refused.reason)).length,
    revoked: s.flows.filter((f) => f.refused?.by === "metal" && /mandate_revoked/.test(f.refused.reason)).length,
    airwallex: s.flows.filter((f) => f.refused?.by === "airwallex").length + (tapRun()?.steps.filter((x) => !x.approved && x.reason === "LIMIT_EXCEEDED").length ?? 0),
    cfo: s.decisions.filter((d) => d.status === "REJECTED").length,
    feeUnknown: s.refusals.filter((x) => /fee_unknown/.test(x.reason)).length,
  };
}

/** Tools that mean an agent acted, not only looked: a decision without any of them is a routine check. */
const ACTING = /^(set_buy_policy|design_rebalance|send_message|settle_dispute|sweep_earnings|plan_invoice|submit_plan|submit_advice|refund|escalate_to_cfo)$/;

/** A highlight: a key moment, with the routine checks ("nothing to do") merged into it that came before it. */
export type Highlight = Ev & { quiet?: number };

/**
 * The four moments the whole site tells (Home's animation, Watch's jumps), each anchored on its event in the run:
 * 1. the price rise refused on chain; 2. Treasury replans and the four eyes (1 of 2, 2 of 2) replace the mandate;
 * 3. the dispute: every order checked, the wrong ones refunded; 4. the sweep, the licence paid by SWIFT after Face ID,
 * and the TAP run's card buy. A failed attempt before the licence was paid (fee_unknown) is not one of them.
 */
export interface Moments {
  refusal: number; notice: number; sourcingSay: number; replan: number; cosigned: number; approved: number; mandate: number;
  dispute: number; settle: number; refunds: number[]; sweep: number; sweepSay: number; licenceFace: number; licence: number;
}
export function moments(ev: Ev[]): Moments {
  const at = (f: (e: Ev, i: number) => boolean, from = 0) => ev.findIndex((e, i) => i >= from && f(e, i));
  const refusal = at((e) => e.k === "money" && (e.refused?.by === "recorded" || e.refused?.by === "metal") && !!e.proof.href);
  const notice = at((e) => e.k === "world" && /asks \d/i.test(e.text));
  const sourcingSay = at((e) => e.k === "say" && e.agent === "sourcing" && e.tools.includes("send_message"), Math.max(0, refusal));
  const replan = at((e) => e.k === "say" && e.agent === "treasury" && e.tools.some((t) => /rebalance/.test(t)));
  const cosigned = at((e) => e.k === "face" && e.status === "COSIGNED", Math.max(0, replan));
  const approved = at((e) => e.k === "face" && e.signers.length > 1, Math.max(0, cosigned));
  const mandate = at((e) => e.k === "mandate" && e.agent === "sourcing", Math.max(0, approved));
  const dispute = at((e) => e.k === "world" && /disputes/i.test(e.text));
  const settle = at((e) => e.k === "say" && e.agent === "support" && e.tools.includes("settle_dispute"), Math.max(0, dispute));
  const refunds = ev.map((e, i) => (e.k === "money" && e.agent === "support" && /refund/i.test(e.what) && !e.refused ? i : -1)).filter((i) => i >= 0);
  const sweep = at((e) => e.k === "money" && e.agent === "treasury" && /sweep/i.test(e.what) && e.rail === "metal" && !e.refused);
  const sweepSay = at((e) => e.k === "say" && e.agent === "treasury" && e.tools.includes("sweep_earnings"));
  const licence = at((e) => e.k === "money" && e.via === "SWIFT" && !e.refused);
  const licenceFace = licence < 0 ? -1 : ev.map((e, i) => (e.k === "face" && e.status === "APPROVED" && /invoice/i.test(e.title) && i < licence ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  return { refusal, notice, sourcingSay, replan, cosigned, approved, mandate, dispute, settle, refunds, sweep, sweepSay, licenceFace, licence };
}

/**
 * Watch's default: the run's key moments only (about a dozen, in order: the refusal recorded on chain, the supplier's
 * notice, Treasury's plan, the two signatures, the mandate replaced, the dispute, the Support agent's settlement, its
 * refunds as one step, the sweep, the licence's Face ID and its SWIFT payout, then the TAP run's card buy under that
 * run's label). The routine checks before each moment are merged into it (`quiet`). The failed licence attempt
 * (fee_unknown, nothing paid) is not a highlight: it is in the full run, labelled an earlier attempt, and on Proof.
 */
export function highlights(run: AgentRun): Highlight[] {
  const ev = run.events;
  const m = moments(ev);
  const keys = [m.refusal, m.notice, m.replan, m.cosigned, m.approved, m.mandate, m.dispute, m.settle, m.refunds[0] ?? -1, m.sweep, m.licenceFace, m.licence].filter((i) => i >= 0).sort((a, b) => a - b);
  const out: Highlight[] = [];
  let last = -1;
  for (const i of keys) {
    const quiet = ev.slice(last + 1, i).filter((e) => e.k === "say" && !e.tools.some((x) => ACTING.test(x))).length;
    last = i;
    const e = ev[i]!;
    if (i === m.refunds[0] && m.refunds.length > 1 && e.k === "money") {
      // The Support agent's refunds, one step: how many, how much each, the first one's tx (each is in the full run).
      const all = m.refunds.map((j) => ev[j]!).filter((x): x is Extract<Ev, { k: "money" }> => x.k === "money");
      const each = (all.reduce((n, x) => n + Number(x.amount) * x.count, 0) / all.length).toFixed(2);
      out.push({ ...e, count: all.length, amount: each, what: `refunds for orders ${all.map((w) => /#\d+/.exec(w.what)?.[0] ?? "").join(", ")}`, label: `refund ${each} ×${all.length}`, quiet });
      continue;
    }
    out.push({ ...e, quiet });
  }
  const tap = tapRun();
  const buy = tap?.steps.find((x) => x.approved && x.model);
  if (tap && buy) {
    out.push({ k: "money", at: tap.ranAt, agent: "sourcing", rail: "airwallex", via: "card · Visa TAP", dir: "out", what: `${buy.plan} at ${tap.merchant.replace(/\s*\(.*\)$/, "")}, signed with Visa TAP`, amount: buy.amount, unit: buy.currency, count: 1,
      label: `${SHORT_EUR(buy.amount)} card buy · Visa TAP`, refused: null, proof: { label: `Airwallex ${buy.txId.slice(0, 8)}… · read back with GET: ${buy.getStatus}`, href: null }, run: tap.label, by: `the Sourcing agent (Claude ${family(buy.model)}) picked the card rail` });
  }
  return out;
}

/**
 * Home's animation (C2): four scenes, each with one subtitle line, the Claude call behind its decision (D2) and the
 * figures it draws, all from the record (and the TAP run for the card buy, under that run's label).
 */
export interface HomeScene { n: 1 | 2 | 3 | 4; title: string; line: string; agent: AgentId; call: Call | null; proof: Proof | null }
export interface HomeFilm {
  scenes: HomeScene[];
  supplier: string; old: string; price: string; cap: string; newCap: string; refusedTx: Proof;
  orders: string[]; refunded: string[]; refundEach: string;
  sweep: string; licence: string; licenceUnit: string; tapAmount: string | null; tapRun: string | null;
}
export function homeFilm(run: AgentRun): HomeFilm | null {
  const ev = run.events, m = moments(ev);
  const s1 = run.scenes.find((s) => s.n === 1)?.mini, s2 = run.scenes.find((s) => s.n === 2)?.mini;
  const ref = ev[m.refusal], swp = ev[m.sweep], lic = ev[m.licence];
  if (s1?.kind !== "price" || s2?.kind !== "orders" || ref?.k !== "money" || swp?.k !== "money" || lic?.k !== "money" || !s1.newCap || !s1.old) return null;
  const say = (i: number) => { const e = ev[i]; return e?.k === "say" ? e : null; };
  const refundEach = (() => { const r = ev[m.refunds[0] ?? -1]; return r?.k === "money" ? r.amount : ""; })();
  const tap = tapRun(), buy = tap?.steps.find((x) => x.approved && x.model);
  const licence = lic.unit === "EUR" ? SHORT_EUR(lic.amount) : money(lic.amount, lic.unit);
  const valid = s2.orders.length - s2.refunded.length;
  const scenes: HomeScene[] = [
    { n: 1, title: "Price rise", agent: "sourcing", call: say(m.sourcingSay)?.call ?? null, proof: ref.proof, line: `${s1.from} raises its price ${s1.old} → ${s1.price}. Refused on chain.` },
    { n: 2, title: "Replan", agent: "treasury", call: say(m.replan)?.call ?? null, proof: null, line: `Treasury replans. Face ID 1 of 2 → 2 of 2. New cap ${s1.newCap}.` },
    { n: 3, title: "Dispute", agent: "support", call: say(m.settle)?.call ?? null, proof: null, line: `${s2.orders.length} orders disputed: ${valid} valid, ${s2.refunded.length} refunded.` },
    { n: 4, title: "Euros", agent: "treasury", call: say(m.sweepSay)?.call ?? null, proof: null, line: `${swp.amount} swept · ${licence} licence paid by SWIFT · Face ID${buy ? " · Visa TAP ✓ (TAP run)" : ""}` },
  ];
  return { scenes, supplier: s1.from, old: s1.old, price: s1.price, cap: s1.cap, newCap: s1.newCap, refusedTx: ref.proof, orders: s2.orders, refunded: s2.refunded, refundEach,
    sweep: swp.amount, licence, licenceUnit: lic.unit, tapAmount: buy ? SHORT_EUR(buy.amount) : null, tapRun: tap?.label ?? null };
}

/** Face ID decisions in the run: the proposals the CFO decided with his own passkey (approved or rejected), from the ledger; the record's proof count otherwise. */
export function faceIdDecisions(r: RunRecord): number {
  if (!r.ledger) return r.proof.face_id;
  return new Set(r.ledger.events.filter((e) => /^proposal\.(approved|rejected)$/.test(e.event) && /\bmax\b/i.test(String(e.payload.approver ?? ""))).map((e) => e.subject)).size;
}

/** D3: decisions by Claude (and fallbacks to code), and the routine payments per query that code made (buying and selling, not refused). */
export function split(r: RunRecord): { byClaude: number; decisions: number; fallbacks: number; routine: number } {
  const st = r.snapshot.agent_stats;
  const routine = r.snapshot.flows.filter((f) => !f.refused && (f.kind === "sale" || (f.kind === "upstream" && /^code\b/.test(f.decided)))).reduce((n, f) => n + (f.count ?? 1), 0);
  return { byClaude: st.reduce((n, a) => n + a.by_claude, 0), decisions: st.reduce((n, a) => n + a.decisions, 0), fallbacks: st.reduce((n, a) => n + a.fallback, 0), routine };
}

export function agentRun(): AgentRun {
  const { file, standIn, record: r } = loadRecord();
  const s = r.snapshot;
  const ev = events(r);
  const decisions = s.agent_stats.reduce((n, a) => n + a.decisions, 0);
  const byClaude = s.agent_stats.reduce((n, a) => n + a.by_claude, 0);
  const fallbacks = s.agent_stats.reduce((n, a) => n + a.fallback, 0);
  const cost = s.agent_stats.reduce((n, a) => n + a.cost_usd_micros, 0);
  const perDecision = decisions ? (cost / decisions / 1e6).toFixed(4) : "0";
  const st = stops(r);
  const name = runName(r);
  const agents = AGENTS.map((id): AgentCard => {
    const m = s.agent_stats.find((a) => a.agent === id)?.models[0] ?? null;
    return { id, name: AGENT_DISPLAY[id].name, short: AGENT_DISPLAY[id].name.replace(/ agent$/, ""), model: m ?? "", family: family(m) };
  });
  const cosigned = s.decisions.filter((d) => (d.by ?? "").includes("&")).length;
  const sales = s.flows.filter((f) => f.kind === "sale").reduce((n, f) => n + (f.count ?? 1), 0);
  const tiles: Tile[] = [
    { value: `${byClaude}/${decisions}`, label: "decisions made by Claude", explain: `Every time an agent decided something, it was a Claude call. ${fallbacks} fell back to code.`, href: "proof#claude" },
    { value: String(s.counts.alone), label: "payments inside the limits", explain: `Paid with no approval at the time, inside the limits; ${sales} of them the simulated customer's agent buying from us.`, href: "proof#metal" },
    {
      value: String(st.metal + st.airwallex + st.cfo), label: "stopped at a limit", href: "proof#stops",
      explain: "Metal and the CFO in this run; Airwallex in the TAP run.",
      tip: `By Metal against the on-chain mandate and by the CFO with Face ID in this run; by Airwallex at the card's limit in the TAP run.${st.revoked ? ` Not counted: ${st.revoked} more refused by Metal because its mandate had just been replaced.` : ""}${st.feeUnknown ? " Not counted: the licence, whose fee the sandbox could not price (fee_unknown): not a limit." : ""}`,
      parts: [{ value: String(st.metal), label: "Metal" }, { value: String(st.cfo), label: "CFO" }, { value: String(st.airwallex), label: "Airwallex · TAP run" }],
    },
    { value: String(faceIdDecisions(r)), label: "Face ID decisions", explain: cosigned ? "The CFO signed each one on his phone; the mandate change needed a second signature too." : "The CFO signed each one on his phone.", href: "proof#faceid" },
    { value: `$${perDecision}`, label: "Claude cost per decision", explain: "What the agents' Claude calls cost per decision, at Anthropic's list prices; each decision may be several calls.", href: "proof#claude" },
  ];
  return {
    file, standIn, name, recordedAt: r.recorded_at, kind: r.kind ?? "", record: r,
    label: runLabel(r), agents, events: ev, scenes: scenes(r, ev), tiles,
    derived: { decisions: String(decisions), byClaude: String(byClaude), fallbacks: String(fallbacks), perDecision, stopped: String(st.metal + st.airwallex + st.cfo), cosigned: String(cosigned), sales: String(sales), faceId: String(faceIdDecisions(r)), routine: String(split(r).routine) },
  };
}

// The redesigned Home and Watch (design pass, 2 Nov) play one recorded agent run. Its record is the file below once
// Max adds it (agent run 1, 2 November); until then the newest autonomous dry-run record in the repo stands in, and
// every page says which run it shows, by that run's own name. Nothing here is typed in by hand: the events, the
// agents' words, their models, the money and its proof all come from the record (test/redesign-numbers.test.ts).

import { existsSync, readFileSync } from "node:fs";
import { AGENT_DISPLAY } from "../config/brand.js";

/** Where agent run 1's record goes (the same form `npm run autonomy-record` writes). */
export const AGENT_RUN_FILE = "docs/demo/agent-run.json";
/** The stand-in: the newest autonomous dry run recorded in the repo. */
export const STAND_IN_FILE = "docs/demo/autonomy.json";

type AgentId = keyof typeof AGENT_DISPLAY;
const AGENTS: AgentId[] = ["sourcing", "support", "treasury"];

interface Chat { ts: string; kind: "decision" | "message" | "world"; who: string; by: string | null; model: string | null; text: string }
interface Flow { at: string; kind: string; agent: string | null; model: string | null; decided: string; request?: string; what: string; amount: string; unit: string; rail: string; count?: number; proof: { label: string; href: string | null; full?: string | null }; refused?: { by: string; reason: string } }
interface Trace { agent: string; task: string; status: string; model: string; steps: { ts: string; kind: string; tool: string | null; input: unknown }[] }
interface Refusal { seq: number; ts: string; agent: string; what: string; reason: string }
interface Decision { proposal_id: string; title: string; status: string; by: string; at: string }
interface Stat { agent: string; decisions: number; by_claude: number; fallback: number; cost_usd_micros: number; models: string[] }
export interface RunRecord {
  recorded_at: string; run: string; kind?: string;
  snapshot: {
    agent_chat: Chat[]; flows: Flow[]; traces: Trace[]; refusals: Refusal[]; decisions: Decision[]; agent_stats: Stat[];
    counts: { alone: number; blocked: number };
    tower: { agents: { agent: string; mandate: { cap: string } | null; card: { monthly: string } | null }[] };
  };
  proof: { face_id: number; chain_refusals: number };
}

export type Ev =
  | { k: "world"; at: string; text: string }
  | { k: "say"; at: string; agent: AgentId; model: string | null; by: "claude" | "fallback"; text: string; tools: string[] }
  | { k: "msg"; at: string; agent: AgentId; text: string }
  | { k: "money"; at: string; agent: AgentId | null; rail: "metal" | "airwallex"; via: string; dir: "in" | "out"; what: string; amount: string; unit: string; count: number; refused: { by: string; reason: string } | null; proof: { label: string; href: string | null } }
  | { k: "face"; at: string; id: string; title: string; approved: boolean; by: string }
  | { k: "shield"; at: string; text: string };

export type Mini =
  | { kind: "price"; from: string; old: string | null; price: string; cap: string; to: string | null; toPrice: string | null }
  | { kind: "orders"; orders: string[]; refunded: string[] }
  | { kind: "flow"; rows: { icon: string; text: string; tone: "ok" | "bad" | "face" }[] };
export interface Scene { n: 1 | 2 | 3; title: string; start: number; steps: { icon: string; text: string; tone: "ok" | "bad" | "face" | "info" }[]; sentence: string; mini: Mini | null }
export interface Tile { value: string; label: string; href: string }
export interface AgentCard { id: AgentId; name: string; short: string; model: string; family: string }

export interface AgentRun {
  file: string; standIn: boolean; name: string; label: string; recordedAt: string;
  agents: AgentCard[]; events: Ev[]; scenes: Scene[]; tiles: Tile[];
  /** Every derived figure (sums, ratios) a page shows, with how it was counted: the number test checks these. */
  derived: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T;
const isAgent = (a: string | null): a is AgentId => !!a && (AGENTS as string[]).includes(a);
const family = (model: string | null | undefined) => (/claude-(haiku|sonnet|opus)/i.exec(model ?? "")?.[1] ?? "").replace(/^./, (c) => c.toUpperCase());
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** The first sentence, as said. */
export const firstSentence = (t: string) => t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"“(])/)[0] ?? t;
const money = (amount: string, unit: string) => unit === "EUR" ? `EUR ${amount}` : unit === "USD" ? `USD ${amount}` : `${amount} test USD`;

/** The record a page plays: agent run 1's once it is in the repo, else the stand-in. */
export function loadRecord(): { file: string; standIn: boolean; record: RunRecord } {
  const own = existsSync(new URL(`../../${AGENT_RUN_FILE}`, import.meta.url));
  const file = own ? AGENT_RUN_FILE : STAND_IN_FILE;
  return { file, standIn: !own, record: readJson<RunRecord>(file) };
}

/** The run's name as its record gives it, shortened to the part before the first colon ("Autonomous dry run dry-118, 1 November 2026"). */
const runName = (r: RunRecord) => r.run.split(":")[0]!.trim();

function events(r: RunRecord): Ev[] {
  const s = r.snapshot;
  const out: Ev[] = [];
  // The tools each agent run called, matched to its decision by agent and time (the trace ends where the decision is logged).
  const toolsFor = (agent: string, at: string) => {
    const t = Date.parse(at);
    const best = s.traces.filter((x) => x.agent === agent && x.steps.length).map((x) => ({ x, d: Math.abs(Date.parse(x.steps[x.steps.length - 1]!.ts) - t) })).sort((a, b) => a.d - b.d)[0];
    return best && best.d < 5000 ? best.x.steps.filter((st) => st.kind === "tool" && st.tool && st.tool !== "finish").map((st) => st.tool!) : [];
  };
  for (const c of s.agent_chat) {
    if (c.kind === "world") {
      // Raw event names ("card.declined") are told by their own rows below (a refusal, a money movement).
      if (/^[a-z_]+\.[a-z_.]+$/.test(c.text.trim()) || !c.text.trim() || /^Money in:\s*$/.test(c.text)) continue;
      if (/refused before signing: supplier_unavailable/.test(c.text)) continue;
      out.push({ k: "world", at: c.ts, text: c.text.replace(/^Money in:\s*/, "") });
    } else if (c.kind === "decision" && isAgent(c.who)) {
      out.push({ k: "say", at: c.ts, agent: c.who, model: c.model, by: c.by === "claude" ? "claude" : "fallback", text: c.text, tools: toolsFor(c.who, c.ts) });
    } else if (c.kind === "message" && isAgent(c.who)) {
      out.push({ k: "msg", at: c.ts, agent: c.who, text: c.text });
    }
  }
  for (const f of s.flows) {
    const rail = f.rail === "metal" ? "metal" : f.rail.startsWith("airwallex") ? "airwallex" : null;
    if (!rail) continue;
    const via = f.rail === "metal" ? "x402" : f.rail === "airwallex_swift" ? "SWIFT" : f.rail === "airwallex_card" ? "card" : f.rail === "airwallex_deposit" ? "deposit" : "Airwallex";
    out.push({ k: "money", at: f.at, agent: isAgent(f.agent) ? f.agent : null, rail, via, dir: ["sale", "deposit", "booked"].includes(f.kind) ? "in" : "out", what: f.what, amount: f.amount, unit: f.unit, count: f.count ?? 1, refused: f.refused ?? null, proof: { label: f.proof.label, href: f.proof.href } });
  }
  for (const d of s.decisions) out.push({ k: "face", at: d.at, id: d.proposal_id, title: d.title, approved: d.status !== "REJECTED", by: d.by });
  for (const x of s.refusals) if (/planted instruction/i.test(x.what)) out.push({ k: "shield", at: x.ts, text: x.what });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function scenes(r: RunRecord, ev: Ev[]): Scene[] {
  const s = r.snapshot;
  const idx = (re: RegExp) => ev.findIndex((e) => e.k === "world" && re.test(e.text));
  const after = <K extends Ev["k"]>(from: number, k: K, f: (e: Extract<Ev, { k: K }>) => boolean) =>
    ev.slice(Math.max(0, from)).find((e): e is Extract<Ev, { k: K }> => e.k === k && f(e as Extract<Ev, { k: K }>));
  const out: Scene[] = [];
  const name = (a: AgentId) => AGENT_DISPLAY[a].name.replace(/ agent$/, "");

  // 1. The price rise: what the supplier asked, what the cap was, who decided, and a refusal on chain only if recorded.
  const i1 = idx(/price|asks \d/i);
  if (i1 >= 0) {
    const w = ev[i1] as Extract<Ev, { k: "world" }>;
    const price = /(\d+\.\d{2})/.exec(w.text)?.[1];
    const cap = s.tower.agents.find((a) => a.agent === "sourcing")?.mandate?.cap;
    const src = after(i1, "say", (e) => e.agent === "sourcing");
    const tre = after(i1, "say", (e) => e.agent === "treasury");
    const chain = ev.slice(i1).find((e): e is Extract<Ev, { k: "money" }> => e.k === "money" && e.refused?.by === "metal");
    const steps: Scene["steps"] = [{ icon: "trend", text: price && cap ? `Price ${price} · cap ${cap}` : w.text, tone: "info" }];
    if (chain) steps.push({ icon: "ban", text: "Refused on chain", tone: "bad" });
    if (src) steps.push({ icon: "agent", text: `${name("sourcing")} · ${family(src.model)}: ${/switch/i.test(src.text) ? "switches supplier" : "decides"}`, tone: "ok" });
    if (tre) steps.push({ icon: "agent", text: `${name("treasury")} · ${family(tre.model)}: ${/kept|keep/i.test(tre.text) ? "keeps the budget" : "replans"}`, tone: "ok" });
    // The supplier's price before (its first purchase in the run) and the one the agent moved to (its first after the rise).
    const supplier = /^(\S+)/.exec(w.text)?.[1] ?? "";
    const unit = (f: Flow | undefined) => f ? (Number(f.amount) / (f.count ?? 1)).toFixed(2) : null;
    const before = s.flows.find((f) => f.kind === "upstream" && f.what.startsWith(supplier) && Date.parse(f.at) < Date.parse(w.at));
    const next = s.flows.find((f) => f.kind === "upstream" && !f.what.startsWith(supplier) && Date.parse(f.at) > Date.parse(w.at));
    const mini: Mini | null = price && cap ? { kind: "price", from: supplier, old: unit(before), price, cap, to: next?.what ?? null, toPrice: unit(next) } : null;
    out.push({ n: 1, title: "The price rise", start: i1, steps, mini, sentence: `Price rises${price ? ` to ${price}` : ""}${chain ? " → Metal refuses on chain" : ""} → Sourcing ${src && /switch/i.test(src.text) ? "switches supplier" : "decides"}${cap ? ` inside its ${cap} cap` : ""} → Treasury ${tre && /kept|keep/i.test(tre.text) ? "keeps the budget" : "replans"}.` });
  }

  // 2. The dispute: the orders the Support agent checked, the ones it refunded itself, and what went to the CFO.
  const i2 = idx(/dispute/i);
  if (i2 >= 0) {
    const t = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
    const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
    const refunds = ev.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money" && e.agent === "support" && /refund/i.test(e.what) && !e.refused);
    const face = after(i2, "face", () => true);
    const steps: Scene["steps"] = [{ icon: "mail", text: "Customer's agent disputes", tone: "info" }];
    if (checked) steps.push({ icon: "check", text: `${checked} signed orders checked`, tone: "ok" });
    if (refunds.length) steps.push({ icon: "undo", text: `${refunds.length} wrong ones refunded`, tone: "ok" });
    if (face && /refund/i.test(face.title)) steps.push({ icon: "face", text: `CFO ${face.approved ? "approves" : "rejects"} the rest`, tone: "face" });
    const orders = t ? [...new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => String((x.input as { seq?: number }).seq ?? "")))].filter(Boolean) : [];
    const refunded = refunds.map((e) => /#(\d+)/.exec(e.what)?.[1]).filter((x): x is string => !!x);
    out.push({ n: 2, title: "The dispute", start: i2, steps, mini: orders.length ? { kind: "orders", orders, refunded } : null, sentence: `A customer's agent disputes its orders → Support checks ${checked} signed orders → refunds only the ${refunds.length} wrong ones.` });
  }

  // 3. Earnings and euros: the sweep after finality, the euro bill by SWIFT after Face ID, the card at the card-only supplier.
  const i3 = idx(/invoice/i);
  if (i3 >= 0) {
    const sweep = ev.find((e): e is Extract<Ev, { k: "money" }> => e.k === "money" && e.agent === "treasury" && /sweep/i.test(e.what) && e.rail === "metal");
    const swift = ev.find((e): e is Extract<Ev, { k: "money" }> => e.k === "money" && e.via === "SWIFT" && !e.refused);
    const card = ev.find((e): e is Extract<Ev, { k: "money" }> => e.k === "money" && e.via === "card");
    const steps: Scene["steps"] = [];
    if (sweep) steps.push({ icon: "coin", text: `${money(sweep.amount, sweep.unit)} swept after finality`, tone: "ok" });
    if (swift) steps.push({ icon: "face", text: `${money(swift.amount, swift.unit)} by SWIFT after Face ID`, tone: "face" });
    if (card) steps.push({ icon: card.refused ? "ban" : "card", text: `${money(card.amount, card.unit)} on the card: ${card.refused ? "declined by Airwallex" : "paid"}`, tone: card.refused ? "bad" : "ok" });
    const parts = [sweep ? "Earnings swept after finality" : "", swift ? "euros paid by SWIFT after Face ID" : "", card ? `a card-only buy ${card.refused ? "declined over its limit" : "paid"} by Airwallex` : ""].filter(Boolean);
    out.push({ n: 3, title: "Earnings and euros", start: i3, steps, mini: steps.length ? { kind: "flow", rows: steps.map((x) => ({ icon: x.icon, text: x.text, tone: x.tone === "info" ? "ok" : x.tone })) } : null, sentence: `${parts.join(" → ")}.` });
  }
  return out;
}

export function agentRun(): AgentRun {
  const { file, standIn, record: r } = loadRecord();
  const s = r.snapshot;
  const ev = events(r);
  const decisions = s.agent_stats.reduce((n, a) => n + a.decisions, 0);
  const byClaude = s.agent_stats.reduce((n, a) => n + a.by_claude, 0);
  const cost = s.agent_stats.reduce((n, a) => n + a.cost_usd_micros, 0);
  const perDecision = decisions ? (cost / decisions / 1e6).toFixed(4) : "0";
  const name = runName(r);
  const agents = AGENTS.map((id): AgentCard => {
    const m = s.agent_stats.find((a) => a.agent === id)?.models[0] ?? null;
    return { id, name: AGENT_DISPLAY[id].name, short: AGENT_DISPLAY[id].name.replace(/ agent$/, ""), model: m ?? "", family: family(m) };
  });
  const tiles: Tile[] = [
    { value: `${byClaude}/${decisions}`, label: "decisions made by Claude", href: "watch" },
    { value: String(s.counts.alone), label: "payments inside the limits", href: "proof#money" },
    { value: String(s.counts.blocked), label: "stopped by a limit or the CFO", href: "proof#stops" },
    { value: String(r.proof.face_id), label: "Face ID decisions by the CFO", href: "proof#faceid" },
    { value: `$${perDecision}`, label: "Claude cost per decision", href: "proof#claude" },
  ];
  return {
    file, standIn, name, recordedAt: r.recorded_at,
    label: `Replay of ${name}${/\d{4}/.test(name) ? "" : ` · ${day(r.recorded_at)}`} · test money · ${byClaude} of ${decisions} decisions by Claude`,
    agents, events: ev, scenes: scenes(r, ev), tiles,
    derived: { decisions: String(decisions), byClaude: String(byClaude), perDecision },
  };
}

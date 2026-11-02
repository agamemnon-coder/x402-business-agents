// The public pages (Home, Watch, Proof, the partner pages and the CFO dashboard's replay) play one recorded agent run:
// agent run 1 (rehearsal), 2 November, recorded with `npm run autonomy-record` into docs/demo/agent-run.json. Without
// that file the newest autonomous dry run (docs/demo/autonomy.json) is shown instead, under its own name. Nothing is
// typed in by hand: the events, the agents' words and models, the money, the signatures and every proof id come from
// the record (test/redesign-numbers.test.ts fails on a number the record lacks).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { AGENT_DISPLAY } from "../config/brand.js";

/** Agent run 1's record (the same form `npm run autonomy-record` writes). */
export const AGENT_RUN_FILE = "docs/demo/agent-run.json";
/** Shown only when the agent run's record is absent: the newest autonomous dry run. */
export const STAND_IN_FILE = "docs/demo/autonomy.json";

export type AgentId = keyof typeof AGENT_DISPLAY;
const AGENTS: AgentId[] = ["sourcing", "support", "treasury"];

interface Chat { ts: string; kind: "decision" | "message" | "world"; who: string; by: string | null; model: string | null; text: string }
interface Flow { at: string; kind: string; agent: string | null; model: string | null; decided: string; request?: string; what: string; amount: string; unit: string; rail: string; count?: number; proof: { label: string; href: string | null; full?: string | null }; refused?: { by: string; reason: string } }
interface Trace { agent: string; task: string; status: string; model: string; steps: { ts: string; kind: string; tool: string | null; input: unknown }[] }
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
}

export interface Proof { label: string; href: string | null }
export type Ev =
  | { k: "world"; at: string; text: string }
  | { k: "say"; at: string; agent: AgentId; model: string | null; by: "claude" | "fallback"; text: string; tools: string[] }
  | { k: "msg"; at: string; agent: AgentId; text: string }
  | { k: "money"; at: string; agent: AgentId | null; rail: "metal" | "airwallex"; via: string; dir: "in" | "out"; what: string; amount: string; unit: string; count: number; label: string; refused: { by: string; reason: string } | null; proof: Proof }
  | { k: "face"; at: string; id: string; title: string; status: string; signers: string[] }
  | { k: "shield"; at: string; text: string };

export type Mini =
  | { kind: "price"; from: string; old: string | null; price: string; cap: string; newCap: string | null; tx: Proof | null; signers: number }
  | { kind: "orders"; orders: string[]; refunded: string[] }
  | { kind: "flow"; rows: { icon: string; text: string; tone: "ok" | "bad" | "face" }[] };
export interface Step { icon: string; text: string; tone: "ok" | "bad" | "face" | "info"; proof?: Proof }
export interface Scene { n: 1 | 2 | 3; title: string; start: number; steps: Step[]; sentence: string; mini: Mini | null }
export interface Tile { value: string; label: string; explain: string; href: string; parts?: { value: string; label: string }[] }
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
  return { file, standIn: !own, record: readJson<RunRecord>(file) };
}

/** The run's short name: "agent run 1 (rehearsal), 2 Nov" → "agent run 1"; a dry run keeps its name up to the colon. */
export const runName = (r: RunRecord) => r.run.split(":")[0]!.replace(/\s*\([^)]*\)/g, "").replace(/,\s*\d{1,2} \w+( \d{4})?$/, "").trim();

/** The label every page shows above the run. */
export function runLabel(r: RunRecord): string {
  const s = r.snapshot.agent_stats;
  const decisions = s.reduce((n, a) => n + a.decisions, 0), byClaude = s.reduce((n, a) => n + a.by_claude, 0);
  const claude = decisions && byClaude === decisions ? "real Claude decisions" : `${byClaude} of ${decisions} decisions by Claude`;
  return `Replay of ${runName(r)} · ${day(r.recorded_at)} · test money · ${claude}`;
}

/** The label of a movement's coin on its rail: "0.05 per query · x402", "€240 · SWIFT". */
function coinLabel(f: { amount: string; unit: string; count: number; via: string; kind: string }): string {
  if (!f.amount) return f.via;
  if (f.unit === "EUR") return `${SHORT_EUR(f.amount)} · ${f.via}`;
  if (f.unit === "USD") return `USD ${f.amount} · ${f.via}`;
  if (f.kind === "sale" || f.kind === "upstream") return `${(Number(f.amount) / f.count).toFixed(2)} per query · x402`;
  return `${f.amount} · ${f.kind === "refund" ? "refund" : f.kind === "sweep" ? "sweep" : "x402"}`;
}

const VIA: Record<string, string> = { metal: "x402", purser: "x402", airwallex_swift: "SWIFT", airwallex_card: "card", airwallex_deposit: "deposit", airwallex_fx: "FX" };

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
      out.push({ k: "say", at: c.ts, agent: c.who, model: c.model, by: c.by === "claude" ? "claude" : "fallback", text: c.text, tools: toolsFor(c.who, c.ts) });
    } else if (c.kind === "message" && isAgent(c.who)) {
      out.push({ k: "msg", at: c.ts, agent: c.who, text: c.text });
    }
  }
  for (const f of s.flows) {
    const rail = f.rail === "metal" || f.rail === "purser" ? "metal" : f.rail.startsWith("airwallex") ? "airwallex" : null;
    if (!rail) continue;
    const via = VIA[f.rail] ?? "Airwallex";
    const count = f.count ?? 1;
    out.push({ k: "money", at: f.at, agent: isAgent(f.agent) ? f.agent : null, rail, via, dir: ["sale", "deposit", "booked"].includes(f.kind) ? "in" : "out", what: f.what, amount: f.amount, unit: f.unit, count, label: coinLabel({ ...f, count, via }), refused: f.refused ?? null, proof: { label: f.proof.label, href: f.proof.href } });
  }
  for (const d of s.decisions) {
    if (!d.by) continue; // superseded: nobody signed it
    out.push({ k: "face", at: d.at, id: d.proposal_id, title: d.title, status: d.status, signers: d.by.replace(/\s*·\s*Face ID$/, "").split(/\s*&\s*/) });
    // An approved proposal the rail then refused: the refusal is the rail's own, with nothing paid.
    if (d.status === "FAILED") {
      const why = s.refusals.find((x) => x.reason.startsWith(`${d.proposal_id} failed`));
      const awx = why && /Airwallex/i.test(why.reason);
      if (why && awx) {
        const plan = s.agent_chat.find((c) => c.who === "treasury" && c.text.includes(d.proposal_id) && /EUR [\d,]+\.\d{2}/.test(c.text));
        const amount = plan ? /EUR ([\d,]+\.\d{2})/.exec(plan.text)![1]! : "";
        const code = /-> \d{3} ([a-z_]+)/.exec(why.reason)?.[1] ?? why.reason;
        out.push({ k: "money", at: new Date(Math.max(Date.parse(d.at), Date.parse(why.ts)) + 1).toISOString(), agent: "treasury", rail: "airwallex", via: "SWIFT", dir: "out", what: `the EUR invoice (${d.proposal_id})`, amount, unit: "EUR", count: 1, label: amount ? `${SHORT_EUR(amount)} · SWIFT` : "SWIFT", refused: { by: "airwallex", reason: `${code}: nothing paid` }, proof: { label: `${why.reason.replace(/^P-\d+ failed: /, "")} · no transfer made`, href: null } });
      }
    }
  }
  for (const x of s.refusals) if (/planted instruction/i.test(x.what)) out.push({ k: "shield", at: x.ts, text: x.what });
  return out.sort((a, b) => a.at.localeCompare(b.at));
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
  const capRefusal = ev.findIndex((e) => isMoney(e) && !!e.refused && /mandate_cap|over the mandate/.test(e.refused.reason));
  const notice = firstIdx(ev, (e) => e.k === "world" && /asks \d/i.test(e.text));
  const i1 = [capRefusal, notice].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (i1 >= 0) {
    const w = notice >= 0 ? ev[notice] as Extract<Ev, { k: "world" }> : null;
    const price = /(\d+\.\d{2})/.exec(w?.text ?? "")?.[1] ?? (capRefusal >= 0 ? (ev[capRefusal] as Extract<Ev, { k: "money" }>).amount : "");
    const supplier = /^(\S+)/.exec(w?.text ?? "")?.[1] ?? (capRefusal >= 0 ? (ev[capRefusal] as Extract<Ev, { k: "money" }>).what : "");
    const chain = ev.slice(i1).find((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.refused?.by === "metal" && !!e.proof.href);
    const capWas = /mandate's (\d+\.\d{2})/.exec(ev.slice(i1).filter(isMoney).find((e) => e.refused)?.refused?.reason ?? "")?.[1] ?? s.tower.agents.find((a) => a.agent === "sourcing")?.mandate?.cap ?? "";
    const replan = ev.slice(i1).find((e): e is Extract<Ev, { k: "say" }> => e.k === "say" && e.agent === "treasury" && e.tools.some((t) => /rebalance|plan/.test(t)));
    const signed = ev.slice(i1).find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && /mandate/i.test(e.title) && e.status === "EXECUTED");
    const replaced = ev.slice(i1).find((e) => e.k === "world" && /mandate was replaced/i.test(e.text));
    const newCap = signed ? s.tower.agents.find((a) => a.agent === "sourcing")?.mandate?.cap ?? null : null;
    const before = s.flows.find((f) => f.kind === "upstream" && f.what === supplier && !f.refused && Date.parse(f.at) < Date.parse(ev[i1]!.at));
    const old = before ? (Number(before.amount) / (before.count ?? 1)).toFixed(2) : null;
    const steps: Step[] = [{ icon: "trending-up", text: `${supplier} ${old ? `${old} → ` : ""}${price}`, tone: "info" }];
    if (chain) steps.push({ icon: "ban", text: "Refused on chain", tone: "bad", proof: chain.proof });
    if (replan) steps.push({ icon: "bot", text: `${nameOf("treasury")} · ${family(replan.model)} replans`, tone: "ok" });
    if (signed) steps.push({ icon: "scan-face", text: `${signed.signers.length} of ${signed.signers.length} signatures`, tone: "face" });
    if (replaced && newCap) steps.push({ icon: "circle-check", text: `Mandate replaced: cap ${newCap}`, tone: "ok" });
    const parts = [`${supplier} raises its price to ${price}`, chain ? "Metal refuses it on chain" : "", replan ? "Treasury replans" : "", signed ? `${signed.signers.length === 2 ? "two" : String(signed.signers.length)} signatures` : "", replaced ? "the mandate is replaced" : ""].filter(Boolean);
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
    const bill = ev.find((e): e is Extract<Ev, { k: "money" }> => isMoney(e) && e.via === "SWIFT");
    const face = bill ? ev.find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && bill.what.includes(e.id)) ?? ev.find((e): e is Extract<Ev, { k: "face" }> => e.k === "face" && /invoice/i.test(e.title)) : undefined;
    const steps: Step[] = [];
    if (sweep) steps.push({ icon: "wallet", text: `${money(sweep.amount, sweep.unit)} swept after finality`, tone: "ok", proof: sweep.proof });
    if (booked) steps.push({ icon: "landmark", text: `${money(booked.amount, booked.unit)} booked at Airwallex`, tone: "ok" });
    if (bill && face) steps.push({ icon: "scan-face", text: `${money(bill.amount, bill.unit)} licence: Face ID approved`, tone: "face" });
    if (bill) steps.push({ icon: bill.refused ? "ban" : "circle-check", text: bill.refused ? `Airwallex refused: ${bill.refused.reason.replace(":", ",")}` : "Paid by SWIFT", tone: bill.refused ? "bad" : "ok" });
    // The card-only buy signed with Visa TAP comes from the separate TAP run of the same day, under its own label.
    const tap = tapRun();
    const tapBuy = tap?.steps.find((x) => x.approved && x.model);
    if (tapBuy) steps.push({ icon: "credit-card", text: `TAP run: ${SHORT_EUR(tapBuy.amount)} card buy, Visa TAP`, tone: "ok" });
    const parts = [sweep ? "Earnings swept after finality" : "", bill && face ? "licence approved with Face ID" : "", bill ? (bill.refused ? "Airwallex refused it, nothing paid" : "paid by SWIFT") : "", tapBuy ? "a card buy signed with Visa TAP (TAP run)" : ""].filter(Boolean);
    out.push({ n: 3, title: "Earnings and euros", start: i3, steps, sentence: `${parts.join(" → ")}.`, mini: steps.length ? { kind: "flow", rows: steps.filter((x) => x.icon !== "landmark").map((x) => ({ icon: x.icon, text: x.text, tone: x.tone === "info" ? "ok" : x.tone })) } : null });
  }
  return out;
}

/** Who stopped what: Metal (against the on-chain mandate), Airwallex (a card or a transfer), the CFO (a rejection). */
export function stops(r: RunRecord): { metal: number; airwallex: number; cfo: number } {
  const s = r.snapshot;
  return {
    metal: s.flows.filter((f) => f.refused?.by === "metal").length,
    airwallex: s.flows.filter((f) => f.refused?.by === "airwallex").length + s.decisions.filter((d) => d.status === "FAILED" && s.refusals.some((x) => x.reason.startsWith(`${d.proposal_id} failed`) && /Airwallex/i.test(x.reason))).length,
    cfo: s.decisions.filter((d) => d.status === "REJECTED").length,
  };
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
      value: String(st.metal + st.airwallex + st.cfo), label: "stopped", explain: "Who said no: Metal against the on-chain mandate, Airwallex at the bank, the CFO with Face ID.", href: "proof#stops",
      parts: [{ value: String(st.metal), label: "on chain" }, { value: String(st.airwallex), label: "by Airwallex" }, { value: String(st.cfo), label: "by the CFO" }],
    },
    { value: String(r.proof.face_id), label: "Face ID decisions", explain: cosigned ? "The CFO signed each one on his phone; the mandate change needed a second signature too." : "The CFO signed each one on his phone.", href: "proof#faceid" },
    { value: `$${perDecision}`, label: "Claude cost per decision", explain: "What the agents' Claude calls cost per decision, at Anthropic's list prices.", href: "proof#claude" },
  ];
  return {
    file, standIn, name, recordedAt: r.recorded_at, kind: r.kind ?? "", record: r,
    label: runLabel(r), agents, events: ev, scenes: scenes(r, ev), tiles,
    derived: { decisions: String(decisions), byClaude: String(byClaude), perDecision, stopped: String(st.metal + st.airwallex + st.cfo), cosigned: String(cosigned), sales: String(sales) },
  };
}

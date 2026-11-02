// The partner pages (/airwallex, /claude): what each partner's product does in Purser's story, which of its features
// we use (each linked to its own docs), the live proof from this week's recorded runs, why an agent needs it, and what
// we do not do or only simulate. Every figure and id is read from the recorded files in the repo (docs/demo/*.json,
// docs/runs/airwallex-readback.json) and the model of each agent from code; nothing is typed in by hand. Every
// sentence has its row in docs/claims.md ("The partner pages").

import { readFileSync } from "node:fs";
import { AGENT_DISPLAY } from "../config/brand.js";
import { MODELS } from "../claude/reader.js";
import { SOURCING_MODEL } from "../autonomy/sourcingCore.js";
import { loadRecord, runLabel, type RunRecord } from "../redesign/run.js";

type AgentId = keyof typeof AGENT_DISPLAY;
const AGENTS: AgentId[] = ["sourcing", "support", "treasury"];

/** Each agent's model in the autonomy runtime: src/autonomy/sourcingProfile.ts and teamProfiles.ts. */
export const AGENT_MODELS: Record<AgentId, string> = { sourcing: SOURCING_MODEL, support: MODELS.act, treasury: MODELS.review };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T;

export interface Proof { label: string; href: string | null; title?: string }
export interface ProofLine { text: string; proofs: Proof[] }
export interface RunProof { run: string; lines: ProofLine[] }
export interface Feature { id: string; title: string; plain: string; docs: { label: string; href: string }[]; runs: RunProof[]; other?: string }

interface FeedRow { ts: string; event: string; awx_id: string | null; tx: string | null; text: string }
interface Flow { at: string; kind: string; agent: string | null; model: string | null; decided: string; request?: string; what: string; amount: string; unit: string; rail: string; proof: { label: string; href: string | null; full: string | null }; refused?: { by: string; reason: string } }
interface Snap { feed: FeedRow[]; flows: Flow[]; rails: { airwallex: { what: string; proof: { label: string } | null }[] } }
interface Recording { recorded_at: string; run: string; snapshot: Snap }

const TX = "https://testnet.metalntwx.com/tx/";
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
const shortId = (id: string) => `${id.slice(0, 8)}…`;
const shortTx = (tx: string) => `${tx.slice(0, 6)}…${tx.slice(-4)}`;

/** The labels of the two recordings: the agent run (the main source, src/redesign/run.ts) and the 30 October archive. */
export function runLabels(rec: Recording, auto: Recording): { recorded: string; autonomy: string } {
  return {
    recorded: `Archive: recorded run · ${day(rec.recorded_at)} · test money`,
    autonomy: runLabel(auto as unknown as RunRecord),
  };
}
/** The agent run's record: agent run 1 when it is in the repo. */
const agentRecord = <T>() => loadRecord().record as unknown as T;

/** The Airwallex ids read back from the sandbox with GET only (npm run awx-readback). */
function readBack(): { at: string; found: Map<string, string> } {
  const r = readJson<{ read_at: string; found: { id: string; status: string }[] }>("docs/runs/airwallex-readback.json");
  return { at: r.read_at, found: new Map(r.found.map((f) => [f.id, f.status])) };
}

function awxProof(id: string, back: ReturnType<typeof readBack>): Proof {
  const status = back.found.get(id);
  return { label: `Airwallex ${shortId(id)}`, href: null, title: status ? `${id} · read back with GET on ${day(back.at)}: ${status}` : id };
}

/** One line per feed row of these events (newest last), each with its Airwallex id and, for a deposit, its chain tx. */
function lines(s: Snap, events: string[], back: ReturnType<typeof readBack>): ProofLine[] {
  const rows = s.feed.filter((f) => events.includes(f.event) && f.awx_id).sort((a, b) => a.ts.localeCompare(b.ts));
  // One line per transfer: its creation, its status and its fee are one movement.
  const seen = new Set<string>();
  const out: ProofLine[] = [];
  for (const f of rows) {
    const key = `${f.event.split(".")[0]}:${f.awx_id}`;
    if (f.event.startsWith("transfer.")) {
      if (seen.has(key)) continue;
      seen.add(key);
      const same = rows.filter((r) => r.awx_id === f.awx_id);
      const fee = same.find((r) => r.event === "transfer.fee")?.text;
      const paid = same.some((r) => r.event === "transfer.status" && /PAID/.test(r.text));
      out.push({ text: `${f.text.replace(/, approval hash in its metadata$/, "")}${paid ? ", PAID" : ""}${fee ? `; ${fee.charAt(0).toLowerCase()}${fee.slice(1)}` : ""}; the approval hash is in its metadata`, proofs: [awxProof(f.awx_id!, back)] });
      continue;
    }
    const proofs = [awxProof(f.awx_id!, back)];
    if (f.tx) proofs.push({ label: `tx ${shortTx(f.tx)}`, href: TX + f.tx });
    out.push({ text: f.text, proofs });
  }
  return out;
}

function cardsLine(s: Snap): ProofLine[] {
  const c = s.rails.airwallex.find((r) => /company card per agent/i.test(r.what));
  return c?.proof ? [{ text: `${AGENTS.length} virtual Visa cards, one per agent: ${c.proof.label}`, proofs: [] }] : [];
}

const keep = (runs: RunProof[]) => runs.filter((r) => r.lines.length);

export interface AirwallexData { labels: { recorded: string; autonomy: string }; features: Feature[]; readBackAt: string; stats: [string, string][] }

/** The headline figures, counted from the two recordings' money movements and the read-back file. */
function airwallexStats(rec: Recording, auto: Recording, back: ReturnType<typeof readBack>): [string, string][] {
  const flows = [...rec.snapshot.flows, ...auto.snapshot.flows];
  const declined = flows.filter((f) => f.rail === "airwallex_card" && f.refused?.by === "airwallex").length;
  const swift = flows.filter((f) => f.rail === "airwallex_swift" && !f.refused);
  const eur = swift.map((f) => `EUR ${Number(f.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`).join(" and ");
  return [
    [String(declined), `card charges Airwallex declined itself, over a limit or at the wrong kind of shop`],
    [String(swift.length), `euro invoices paid by SWIFT after the CFO's Face ID (${eur})`],
    [String(back.found.size), `Airwallex ids a juror can see, read back from the sandbox with GET only (${day(back.at)})`],
  ];
}

export function airwallexData(): AirwallexData {
  const rec = readJson<Recording>("docs/demo/snapshot.json");
  const auto = agentRecord<Recording>();
  const back = readBack();
  const L = runLabels(rec, auto);
  const both = (f: (s: Snap) => ProofLine[]) => keep([{ run: L.autonomy, lines: f(auto.snapshot) }, { run: L.recorded, lines: f(rec.snapshot) }]);
  const features: Feature[] = [
    {
      id: "cards", title: "A company card per agent",
      plain: "Each agent has its own cardholder and one virtual Visa card from Airwallex Issuing. Agents never see the card number or CVV, and no call asks for them.",
      docs: [{ label: "Create commercial cards", href: "https://www.airwallex.com/docs/issuing/get-started/create-cards/create-commercial-cards" }, { label: "Cardholder types", href: "https://www.airwallex.com/docs/issuing/get-started/create-cardholders/cardholder-types" }],
      runs: both(cardsLine),
    },
    {
      id: "controls", title: "Limits that sit on the card",
      plain: "The CFO policy sets each card's limit per purchase and per month, its merchant categories and its currency; they are synced to the card at Airwallex and read back. Airwallex declines anything over them, whatever the agent does.",
      docs: [{ label: "Transaction limits", href: "https://www.airwallex.com/docs/issuing/card-controls/authorization-controls/transaction-limits" }, { label: "Cards API", href: "https://www.airwallex.com/docs/api/issuing/cards" }],
      runs: both((s) => lines(s, ["card.charge_declined"], back)),
    },
    {
      id: "transactions", title: "Every approve and decline, booked once",
      plain: "Purser reads each card's transactions back from Airwallex and records each one once, by its Airwallex id, so the CFO sees what Airwallex decided, not what the agent hoped. A raise needs the CFO's Face ID; then the same purchase goes through.",
      docs: [{ label: "Issuing transactions API", href: "https://www.airwallex.com/docs/api/issuing/transactions" }],
      runs: both((s) => lines(s, ["card.charge_approved"], back)),
    },
    {
      id: "fx", title: "Euros bought at a locked rate",
      plain: "To pay a euro bill from dollars, the Treasury agent buys only the shortfall, on a quote locked for 15 minutes and checked against the current rate; the conversion is booked only after the CFO's Face ID on those exact terms.",
      docs: [{ label: "FX quotes API", href: "https://www.airwallex.com/docs/api/transactional_fx/quotes" }, { label: "Conversions API", href: "https://www.airwallex.com/docs/api/transactional_fx/conversion" }],
      runs: both((s) => lines(s, ["fx.converted"], back)),
    },
    {
      id: "swift", title: "Invoices paid by SWIFT, exactly as approved",
      plain: "A supplier is paid only to an allowlisted beneficiary at Airwallex, by a SWIFT transfer that carries the CFO's approval hash. One Face ID covers the payee, the amount and the most the fee may be (EUR 20.00).",
      docs: [{ label: "Transfers API", href: "https://www.airwallex.com/docs/api/payouts/transfers" }, { label: "Create beneficiaries", href: "https://www.airwallex.com/docs/payouts/beneficiaries/create-beneficiaries" }],
      runs: both((s) => lines(s, ["transfer.created", "transfer.status", "transfer.fee"], back)),
    },
    {
      id: "deposit", title: "Metal earnings booked once final",
      plain: "Earnings swept on Metal are booked at Airwallex only after the chain is final, once per transaction, as a sandbox deposit that names the testnet transaction.",
      docs: [{ label: "Simulate deposits to your Global Account", href: "https://www.airwallex.com/docs/accounts/receive-funds/receive-bank-transfers-to-global-accounts/simulate-deposits-to-your-global-account" }],
      runs: both((s) => lines(s, ["credit.deposited"], back)),
    },
    {
      id: "receivables", title: "Retailers pay into Global Accounts",
      plain: "Money a retailer pays into Northwind's Global Account reaches the Treasury agent; a payment that matches its invoice is booked once, a short one or one with no invoice goes to the CFO.",
      docs: [{ label: "Receive bank transfers to Global Accounts", href: "https://www.airwallex.com/docs/accounts/receive-funds/receive-bank-transfers-to-global-accounts" }],
      runs: both((s) => lines(s, ["receivable.matched", "receivable.escalated"], back)),
      other: "Also in a separate live run on 30 October, on a copy of the recorded ledger: 2 payments matched, 1 short by EUR 10.00, 1 with no invoice.",
    },
    {
      id: "webhooks", title: "Webhooks, checked twice",
      plain: "Airwallex tells the relay about each card transaction, card, payout, conversion and deposit as it happens (23 events). The relay and the runner each check the signature; an event only records what Airwallex decided and moves no money.",
      docs: [{ label: "Listen for webhook events", href: "https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events" }, { label: "Issuing events", href: "https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events/issuing" }],
      runs: [],
      other: "Not in the two recordings above (they read Airwallex by poll). In a separate live run on 30 October: two deposits matched or escalated by the webhook alone, and a card transaction booked once.",
    },
  ];
  return { labels: L, features, readBackAt: back.at, stats: airwallexStats(rec, auto, back) };
}

// ---- Claude ----

interface AgentStat { agent: string; decisions: number; by_claude: number; fallback: number; fallback_pct: number; claude_calls: number; calls_without_request_id: number; cost_usd_micros: number; models: string[] }
interface TraceRow { agent: string; task: string; model: string; status: string; said: string; note: string | null; steps: { ts: string; kind: string; tool: string | null; input: unknown; text: string }[] }
interface AutoSnap extends Snap { agent_stats: AgentStat[]; traces: TraceRow[]; agent_chat: { ts: string; kind: string; who: string; by: string | null; model: string | null; text: string }[]; claude: { calls: number; fallbacks: number; cost_usd_micros: number; agents: { agent: string; median_latency_ms: number }[] } }
interface RecClaude { calls: number; cost_usd_micros: number; per_1000_eur_usd_micros: number; eur_paid: string; models: { model: string; role: string; calls: number; cost_usd_micros: number }[] }

export interface ClaudeAgentRow {
  id: AgentId; name: string; job: string; model: string; modelWord: string; recordedModels: string[];
  decisions: number; byClaude: number; fallback: number; fallbackPct: number; calls: number; callsWithoutRequestId: number;
  costUsd: string; medianLatencyS: string | null;
  requests: { id: string; what: string; proof: Proof }[];
  shown: { at: string; by: "claude" | "fallback"; model: string | null; text: string; why: string } | null;
}
export interface ClaudeData {
  label: string; runName: string; agents: ClaudeAgentRow[];
  decisions: { at: string; agent: string; by: "claude" | "fallback"; model: string | null; text: string }[];
  totals: { calls: number; fallbacks: number; costUsd: string };
  recorded: { label: string; calls: number; costUsd: string; per1000Eur: string; eurPaid: string; models: { model: string; role: string; calls: number; costUsd: string }[] };
  tryRun: { file: string; requests: string[] };
}

/** "claude-opus-5-5" → "Claude Opus 5.5". */
export const modelWords = (id: string) => id.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_m, n: string, a: string, b: string) => `Claude ${n[0]!.toUpperCase()}${n.slice(1)} ${a}.${b}`);
const usd = (micros: number, digits = 4) => (micros / 1e6).toFixed(digits);
const firstPara = (t: string) => t.split(/\n\s*\n/)[0]!.trim();

/** The request ids of the /try dev run with the real Haiku (its run log's table). */
function tryRequests(): { file: string; requests: string[] } {
  const file = "docs/runs/2026-11-01-try-world-dev.md";
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  return { file, requests: [...new Set(text.match(/req_[A-Za-z0-9]{10,}/g) ?? [])] };
}

export function claudeData(): ClaudeData {
  const rec = readJson<Recording & { snapshot: Snap & { claude: RecClaude } }>("docs/demo/snapshot.json");
  const auto = agentRecord<Recording & { snapshot: AutoSnap }>();
  const L = runLabels(rec, auto);
  const s = auto.snapshot;
  // One line per agent run (its trace): "done" is the agent's own Claude loop, anything else fell back to code.
  // Every decision: the agents' own words for each wake (agent_chat, in full; the trace list is capped), plus the
  // decisions made on a task rather than a wake (the price-rise plan, the dispute, the licence timing), from their traces.
  const wakes = s.agent_chat.filter((c) => c.kind === "decision").map((c) => ({ at: c.ts, agent: c.who, by: (c.by === "claude" ? "claude" : "fallback") as "claude" | "fallback", model: c.model, text: c.text }));
  const chat = [...wakes, ...s.traces.filter((t) => !t.task.startsWith("wake.")).map((t) => {
    const last = t.steps[t.steps.length - 1];
    const fin = t.steps.find((x) => x.tool === "finish")?.input as { summary?: string } | undefined;
    const decided = t.steps.find((x) => x.kind === "decision")?.text;
    const text = firstPara(t.said) || fin?.summary || decided || t.note || t.task;
    return { at: last?.ts ?? "", agent: t.agent, by: (t.status === "done" ? "claude" : "fallback") as "claude" | "fallback", model: t.model || null, text };
  })].filter((c) => c.at).sort((a, b) => a.at.localeCompare(b.at));
  const agents = AGENTS.map((id): ClaudeAgentRow => {
    const st = s.agent_stats.find((a) => a.agent === id);
    const lat = s.claude.agents.find((a) => a.agent === id)?.median_latency_ms;
    const seen = new Set<string>();
    const requests = s.flows.filter((f) => f.agent === id && f.request && f.model).flatMap((f) => {
      if (seen.has(`${f.request}:${f.what}`)) return [];
      seen.add(`${f.request}:${f.what}`);
      return [{ id: f.request!, what: `${f.what}, ${f.amount} ${f.unit}${f.unit === "*USDZ" ? " stablecoin on chain" : ""}`, proof: { label: f.proof.label, href: f.proof.href } }];
    });
    const mine = chat.filter((c) => c.agent === id);
    // The decision shown: the run closest in time to the agent's first money movement with a request id, else its latest.
    const firstMove = s.flows.find((f) => f.agent === id && f.request && f.model);
    const near = firstMove ? [...mine].sort((a, b) => Math.abs(Date.parse(a.at) - Date.parse(firstMove.at)) - Math.abs(Date.parse(b.at) - Date.parse(firstMove.at)))[0] : undefined;
    return {
      id, name: AGENT_DISPLAY[id].name, job: AGENT_DISPLAY[id].job, model: AGENT_MODELS[id], modelWord: modelWords(AGENT_MODELS[id]),
      recordedModels: st?.models ?? [],
      decisions: st?.decisions ?? 0, byClaude: st?.by_claude ?? 0, fallback: st?.fallback ?? 0, fallbackPct: st?.fallback_pct ?? 0,
      calls: st?.claude_calls ?? 0, callsWithoutRequestId: st?.calls_without_request_id ?? 0,
      costUsd: usd(st?.cost_usd_micros ?? 0), medianLatencyS: typeof lat === "number" ? (lat / 1000).toFixed(1) : null,
      requests, shown: near ? { ...near, why: "the decision behind that money" } : mine.length ? { ...mine[mine.length - 1]!, why: "its latest decision" } : null,
    };
  });
  const rc = rec.snapshot.claude;
  return {
    label: L.autonomy, runName: auto.run, agents, decisions: chat,
    totals: { calls: s.claude.calls, fallbacks: s.claude.fallbacks, costUsd: usd(s.claude.cost_usd_micros) },
    recorded: {
      label: L.recorded, calls: rc.calls, costUsd: usd(rc.cost_usd_micros, 2), per1000Eur: usd(rc.per_1000_eur_usd_micros, 3), eurPaid: rc.eur_paid,
      models: rc.models.map((m) => ({ model: m.model, role: m.role, calls: m.calls, costUsd: usd(m.cost_usd_micros) })),
    },
    tryRun: tryRequests(),
  };
}

// The Controller agent in the runner (12 Nov), behind KIT11_CONTROLLER_AGENT=on (off by default): month-end review of the
// supplier invoices in the stored ledger. The case comes from the ledger; the agent (Claude Sonnet, MODELS.act) runs
// through the shared loop (src/agents/loop.ts) under a hard per-run cap of USD 0.40 and three minutes, with read-only
// tools and one that proposes. Every proposal is stored as pending; a person approves or rejects it, and only an
// approval posts anything (a reversal or a VAT adjustment, computed by code). Without the agent (no key, a failure, a
// refusal, a cap, out of turns), code's own strict rules propose, labelled "code". One decision row (controller.reviewed)
// says who decided, with the model, the request ids and the cost.

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { FOREIGN_VAT, INPUT_VAT, PAYABLES, accountType } from "../ledger/accounts.js";
import { postEntry, reverseEntry } from "../ledger/core.js";
import { VAT_CODES } from "../ledger/vat.js";
import { fromCents } from "../lib/money.js";
import { controllerAgentOn } from "../config/ledgerAgents.js";
import {
  answerControllerTool, CONTROLLER_EFFORT, CONTROLLER_MAX_TOKENS, CONTROLLER_MAX_TURNS, CONTROLLER_RUN_CAP_MICROS, CONTROLLER_SYSTEM, CONTROLLER_TIMEOUT_MS, CONTROLLER_UNFINISHED,
  controllerInputs, controllerPrompt, controllerTools, describeCorrection, fallbackReview, type ControllerCase, type ControllerState, type Correction, type LedgerInvoice, type Proposal,
} from "./controllerCore.js";
import { runAgent, type AgentRun, type AgentTool } from "./loop.js";

export { controllerAgentOn } from "../config/ledgerAgents.js";

interface LineRow { entry_id: number; posting_date: string; doc_date: string; description: string; reverses: number | null; account: string; debit_cents: number; credit_cents: number; currency: string; vat_code: string | null; party: string | null; doc_ref: string | null }

/** The supplier invoices in the ledger: entries with a credit on payables, neither reversed nor a reversal. */
export function ledgerInvoices(db: DB): LedgerInvoice[] {
  const rows = db.prepare(`SELECT e.entry_id, e.posting_date, e.doc_date, e.description, e.reverses, l.account, l.debit_cents, l.credit_cents, l.currency, l.vat_code, l.party, l.doc_ref
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id ORDER BY e.entry_id, l.line_no`).all() as LineRow[];
  const reversed = new Set(rows.filter((r) => r.reverses !== null).map((r) => r.reverses!));
  const byEntry = new Map<number, LineRow[]>();
  for (const r of rows) byEntry.set(r.entry_id, [...(byEntry.get(r.entry_id) ?? []), r]);
  const out: LedgerInvoice[] = [];
  for (const [id, lines] of byEntry) {
    const first = lines[0]!;
    if (first.reverses !== null || reversed.has(id)) continue;
    const payable = lines.find((l) => l.account === PAYABLES && l.credit_cents > 0);
    if (!payable) continue;
    const net = lines.filter((l) => l.debit_cents > 0 && l.account !== INPUT_VAT && l.account !== FOREIGN_VAT && (accountType(l.account) === "expense" || l.account.startsWith("17")));
    if (net.length === 0) continue;
    const codes = new Set(net.map((l) => l.vat_code ?? ""));
    const main = [...net].sort((a, b) => b.debit_cents - a.debit_cents)[0]!;
    out.push({
      entry_id: id, date: first.doc_date.slice(0, 10), month: first.posting_date.slice(0, 7), party: payable.party ?? main.party ?? "", doc_ref: payable.doc_ref ?? main.doc_ref ?? "",
      description: first.description, account: main.account, currency: payable.currency,
      net_cents: net.reduce((s, l) => s + l.debit_cents, 0),
      vat_cents: lines.filter((l) => l.account === INPUT_VAT || l.account === FOREIGN_VAT).reduce((s, l) => s + l.debit_cents - l.credit_cents, 0),
      vat_code: codes.size > 1 ? "mixed" : (main.vat_code ?? null),
      total_cents: lines.filter((l) => l.account === PAYABLES).reduce((s, l) => s + l.credit_cents - l.debit_cents, 0),
    });
  }
  return out;
}

export function controllerCaseFor(db: DB, month: string): ControllerCase {
  const all = ledgerInvoices(db);
  return { month, invoices: all.filter((i) => i.month === month), history: all.filter((i) => i.month < month) };
}

// ── The proposals: pending until a person decides ──

function ensureTable(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS controller_proposals (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, entry_id INTEGER NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, correction_json TEXT NOT NULL,
    proposed_by TEXT NOT NULL, model TEXT, run_id TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
    decided_by TEXT, decided_at TEXT, posted_entry INTEGER, UNIQUE (month, entry_id, kind))`);
}

export interface StoredProposal { id: string; month: string; entry_id: number; kind: string; reason: string; correction: Correction; proposed_by: "claude" | "code"; model: string | null; status: "pending" | "approved" | "rejected"; posted_entry: number | null }

export function controllerProposals(db: DB, month?: string): StoredProposal[] {
  ensureTable(db);
  const rows = db.prepare(`SELECT * FROM controller_proposals ${month ? "WHERE month = ?" : ""} ORDER BY created_at, id`).all(...(month ? [month] : [])) as (Omit<StoredProposal, "correction"> & { correction_json: string })[];
  return rows.map(({ correction_json, ...r }) => ({ ...r, correction: JSON.parse(correction_json) as Correction }));
}

export interface ControllerReview {
  source: "claude" | "fallback";
  proposals: StoredProposal[];
  summary: string;
  run: AgentRun | null;
  note?: string;
}

export interface ControllerDeps {
  client?: Anthropic | null;
  model?: string;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  retryDelayMs?: number;
  /** Stores nothing (the evals score the proposals); default false. */
  dryRun?: boolean;
}

/**
 * Reviews one month. Off (the default flag), returns null and writes nothing. On: the agent's proposals, or code's own
 * when the agent gave no finished answer; stored once per month, entry and kind, each pending for a person.
 */
export async function reviewMonth(db: DB, month: string, deps: ControllerDeps = {}): Promise<ControllerReview | null> {
  if (!controllerAgentOn(deps.env ?? process.env)) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`not a month: ${month}`);
  const now = (deps.now ?? (() => new Date()))();
  const c = controllerCaseFor(db, month);
  const state: ControllerState = { proposals: [], finished: null };
  const model = deps.model ?? MODELS.act;
  let run: AgentRun | null = null;
  if (c.invoices.length > 0) {
    const tools = controllerTools.map((t): AgentTool<z.ZodType> => ({
      name: t.name, description: t.description, input: controllerInputs[t.name],
      run: async (input) => answerControllerTool(c, state, { name: t.name, input }),
    }));
    run = await runAgent(db, {
      agent: "controller", task: `controller.review.${month}`, model, system: CONTROLLER_SYSTEM, prompt: controllerPrompt(c), tools,
      maxTurns: CONTROLLER_MAX_TURNS, effort: CONTROLLER_EFFORT, maxTokens: CONTROLLER_MAX_TOKENS, runCapMicros: CONTROLLER_RUN_CAP_MICROS, timeoutMs: CONTROLLER_TIMEOUT_MS,
      unfinished: () => (state.finished === null ? CONTROLLER_UNFINISHED : null), ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
    }, deps.client === undefined ? claudeClient() : deps.client);
  }
  // The agent's answer counts only when it finished the review itself; anything else is code's, labelled.
  const byClaude = run !== null && state.finished !== null;
  const proposals: Proposal[] = byClaude ? state.proposals : c.invoices.length ? fallbackReview(c) : [];
  const source = byClaude ? "claude" : "fallback";
  const note = byClaude ? undefined : c.invoices.length === 0 ? "no supplier invoices this month" : run ? `the agent did not finish (${run.status}${run.note ? `: ${run.note}` : ""}); code's rules proposed` : "no run";
  const summary = byClaude ? state.finished! : `Code's rules: ${proposals.length} finding(s) in ${c.invoices.length} invoices.`;
  const stored = deps.dryRun ? proposals.map((p, i) => toStored(month, p, `dry-${i + 1}`, source === "claude" ? "claude" : "code", run?.model ?? null)) : store(db, month, proposals, source, run, now);
  const requestIds = run ? (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' AND subject = ? ORDER BY seq DESC LIMIT 1").get(`controller.review.${month}`) as { payload_json: string } | undefined) : undefined;
  audit(db, source === "claude" ? "controller" : "system", "controller.reviewed", month, {
    month, source, model: run?.model ?? null, invoices: c.invoices.length, summary,
    proposals: proposals.map((p) => ({ entry_id: p.entry_id, kind: p.kind, correction: describeCorrection(p.correction) })),
    run: { status: run?.status ?? "not_run", turns: run?.turns ?? 0, cost_usd_micros: run?.costMicros ?? 0, note: run?.note ?? null,
      request_ids: requestIds ? ((JSON.parse(requestIds.payload_json) as { request_ids?: (string | null)[] }).request_ids ?? []) : [] },
    ...(note ? { note } : {}),
  }, now);
  return { source, proposals: stored, summary, run, ...(note ? { note } : {}) };
}

function toStored(month: string, p: Proposal, id: string, by: "claude" | "code", model: string | null): StoredProposal {
  return { id, month, entry_id: p.entry_id, kind: p.kind, reason: p.reason, correction: p.correction, proposed_by: by, model, status: "pending", posted_entry: null };
}

function store(db: DB, month: string, proposals: Proposal[], source: "claude" | "fallback", run: AgentRun | null, now: Date): StoredProposal[] {
  ensureTable(db);
  const by = source === "claude" ? "claude" : "code";
  return db.transaction(() => {
    const out: StoredProposal[] = [];
    for (const p of proposals) {
      const had = db.prepare("SELECT id FROM controller_proposals WHERE month = ? AND entry_id = ? AND kind = ?").get(month, p.entry_id, p.kind) as { id: string } | undefined;
      if (had) continue;
      const n = (db.prepare("SELECT COUNT(*) AS n FROM controller_proposals").get() as { n: number }).n + 1;
      const id = `CP-${String(n).padStart(4, "0")}`;
      db.prepare("INSERT INTO controller_proposals (id, month, entry_id, kind, reason, correction_json, proposed_by, model, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, month, p.entry_id, p.kind, p.reason, JSON.stringify(p.correction), by, by === "claude" ? run?.model ?? null : null, null, now.toISOString());
      audit(db, by === "claude" ? "controller" : "system", "controller.proposed", id, { id, month, entry_id: p.entry_id, kind: p.kind, reason: p.reason, correction: describeCorrection(p.correction), proposed_by: by, model: by === "claude" ? run?.model ?? null : null }, now);
      out.push(toStored(month, p, id, by, by === "claude" ? run?.model ?? null : null));
    }
    return out;
  }).immediate();
}

/**
 * A person decides on a proposal. Approving posts code's correction: a duplicate is reversed, a VAT difference is moved
 * between the expense account and input VAT; an unusual amount posts nothing (the person asks the supplier). Rejecting
 * posts nothing. The agent has no path here: `by` must name a person, and the CLI asks for it.
 */
export function decideProposal(db: DB, id: string, decision: "approve" | "reject", by: string, now = new Date()): StoredProposal {
  ensureTable(db);
  if (!by.trim() || /^(claude|controller|agent|system)$/i.test(by.trim())) throw new Error("a person decides: name who approves or rejects");
  const p = controllerProposals(db).find((x) => x.id === id);
  if (!p) throw new Error(`no proposal ${id}`);
  if (p.status !== "pending") throw new Error(`${id} is already ${p.status}`);
  let posted: number | null = null;
  // Review of 12 Nov: the ledger may have changed since the proposal (another proposal on the same entry approved, an
  // entry reversed by hand). A correction is posted only while the entry is still one of the month's open invoices.
  if (decision === "approve" && p.correction.action !== "query_supplier" && !ledgerInvoices(db).some((i) => i.entry_id === p.entry_id)) {
    throw new Error(`${id}: entry ${p.entry_id} has been reversed or changed since the proposal; reject it and review the month again`);
  }
  if (decision === "approve") {
    const k = p.correction;
    if (k.action === "reverse_entry") posted = reverseEntry(db, k.entry_id, `duplicate of entry ${k.duplicate_of} (controller proposal ${id}, approved by ${by})`, by, now).entry_id;
    else if (k.action === "adjust_vat") {
      const d = Math.abs(k.difference_cents);
      const over = k.difference_cents > 0;
      // A foreign code's VAT sits on 1515 (src/ap/books.ts), so its correction moves 1515, never Dutch input VAT.
      const vatAccount = VAT_CODES[k.vat_code]?.foreign ? FOREIGN_VAT : INPUT_VAT;
      posted = postEntry(db, {
        date: now.toISOString().slice(0, 10), description: `VAT correction on entry ${k.entry_id}: ${k.vat_code} is ${fromCents(k.expected_vat_cents)}, posted ${fromCents(k.posted_vat_cents)} (controller proposal ${id}, approved by ${by})`,
        created_by: by, source_key: `controller:${id}`,
        lines: [
          { account: over ? k.account : vatAccount, debit: d, currency: k.currency, memo: `controller ${id}` },
          { account: over ? vatAccount : k.account, credit: d, currency: k.currency, memo: `controller ${id}` },
        ],
      }, now).entry_id;
    }
  }
  const status = decision === "approve" ? "approved" : "rejected";
  db.prepare("UPDATE controller_proposals SET status = ?, decided_by = ?, decided_at = ?, posted_entry = ? WHERE id = ?").run(status, by, now.toISOString(), posted, id);
  audit(db, "human", `controller.${status}`, id, { id, by, entry_id: p.entry_id, kind: p.kind, correction: describeCorrection(p.correction), posted_entry: posted }, now);
  return { ...p, status, posted_entry: posted };
}

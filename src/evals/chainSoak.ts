// The AP chain soak (master-list line 402): one autonomous run in a fresh world (src/apworld), on the payables chain as
// it is on main: each document comes in through the inbox, Claude labels it (Haiku), reads it (Sonnet; a scan as pages,
// twice), the Coder agent codes a clean invoice (Haiku, KIT11_AP_AGENTS=on), Opus drafts the note for a person, code's
// checks decide its status, and every ready invoice is planned for payment in one batch. The rails are stand-ins: the
// stand-in bank (src/redteam/airwallex.ts, test money in memory) and a stand-in CFO approval (code approves the exact
// terms the batch shows; in the product a person signs them with Face ID). Nothing leaves the process but the Claude
// calls. The run's record feeds the gate (src/evals/chainGate.ts).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { payApInvoices } from "../ap/batchPay.js";
import { ingestDocument, type IngestResult } from "../ap/inbox.js";
import { syncPayments } from "../ap/pay.js";
import { apInvoice } from "../ap/store.js";
import { generateApWorld, type ApWorld } from "../apworld/generate.js";
import { renderDoc } from "../apworld/render.js";
import { setupApWorld } from "../apworld/setup.js";
import { ClaudeReader } from "../claude/reader.js";
import { openDb, type DB } from "../db/open.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { executePaymentBatch } from "../executors/paymentBatch.js";
import { executeSupplierPayment } from "../executors/supplierPayment.js";
import { skeleton } from "../policy/fraudCore.js";
import { decide } from "../policy/approvals.js";
import { originsCheck } from "../provenance/check.js";
import { withOrigin } from "../provenance/origin.js";
import { approvalOrigin } from "../executors/index.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { chainGate, type ChainDecisionCount, type ChainDocResult, type ChainRunRecord, type GateResult } from "./chainGate.js";

/** The chain's Claude steps, as the soak counts them. */
export const SOAK_AGENTS = ["classifier", "reader", "coder", "review note"] as const;
export type SoakAgent = (typeof SOAK_AGENTS)[number];

export interface AgentLine { agent: SoakAgent; decisions: number; by_claude: number; fallback: number; cost_usd_micros: number; latency_ms: number[]; models: string[]; fallback_notes: string[] }

export interface SoakRun {
  record: ChainRunRecord;
  gate: GateResult;
  agents: AgentLine[];
  cost_usd_micros: number;
  /** Wall time per document through the inbox, ms. */
  doc_ms: number[];
  executed: number;
  approval_note: string | null;
  /** Ready invoices the pay step could not plan, with the reason. */
  not_planned: { id: string; reason: string }[];
}

const agentOfTask = (task: string): SoakAgent | null =>
  task.startsWith("ap.classify:") ? "classifier" : task.startsWith("ap.read:") || task.startsWith("ap.scan:") ? "reader" : task.startsWith("ap.review:") ? "review note" : null;

/** Per agent: decisions by Claude and by code's fallback, cost and latency, from the run's own audit rows. */
export function soakAgentLines(db: DB): AgentLine[] {
  const lines = new Map<SoakAgent, AgentLine>(SOAK_AGENTS.map((a) => [a, { agent: a, decisions: 0, by_claude: 0, fallback: 0, cost_usd_micros: 0, latency_ms: [], models: [], fallback_notes: [] }]));
  const notUsed = new Set((db.prepare("SELECT subject FROM audit_log WHERE event = 'ap.reading_not_used'").all() as { subject: string }[]).map((r) => r.subject.slice(0, 16)));
  for (const r of db.prepare("SELECT event, subject, payload_json FROM audit_log WHERE event IN ('claude.read', 'claude.fallback') ORDER BY seq").all() as { event: string; subject: string; payload_json: string }[]) {
    const a = agentOfTask(r.subject ?? "");
    if (!a) continue;
    const l = lines.get(a)!;
    const p = JSON.parse(r.payload_json) as { model?: string; cost_usd_micros?: number; latency_ms?: number; note?: string };
    l.decisions++;
    // A reading code refused (readingCheck) was not used: the parser decided, so it counts as a fallback.
    const refused = r.event === "claude.read" && r.subject.startsWith("ap.read:") && notUsed.has(r.subject.slice("ap.read:".length));
    if (r.event === "claude.read" && !refused) l.by_claude++;
    else { l.fallback++; l.fallback_notes.push(refused ? "the reading failed code's check (readingCheck)" : p.note ?? "fallback"); }
    if (r.event === "claude.read") {
      l.cost_usd_micros += p.cost_usd_micros ?? 0;
      if (typeof p.latency_ms === "number") l.latency_ms.push(p.latency_ms);
      if (p.model && !l.models.includes(p.model)) l.models.push(p.model);
    }
  }
  const coder = lines.get("coder")!;
  for (const r of db.prepare("SELECT payload_json FROM audit_log WHERE event = 'ap.coded' ORDER BY seq").all() as { payload_json: string }[]) {
    const p = JSON.parse(r.payload_json) as { source: string; model: string | null; run?: { note?: string | null } };
    coder.decisions++;
    if (p.source === "claude") coder.by_claude++; else { coder.fallback++; coder.fallback_notes.push(p.run?.note ?? "the coding fell back to code"); }
    if (p.model && !coder.models.includes(p.model)) coder.models.push(p.model);
  }
  for (const r of db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'agent.run' AND subject LIKE 'ap.code.%'").all() as { payload_json: string }[]) {
    const p = JSON.parse(r.payload_json) as { cost_usd_micros?: number; latency_ms?: number };
    coder.cost_usd_micros += p.cost_usd_micros ?? 0;
    if (typeof p.latency_ms === "number") coder.latency_ms.push(p.latency_ms);
  }
  return [...lines.values()];
}

/** The key a double payment is found by: the supplier and the invoice number as the chain read them. */
const payKey = (vendor: string, no: string) => (vendor && no ? `${skeleton(vendor)}|${no.replace(/\s+/g, "").toUpperCase()}` : null);

export interface SoakDeps {
  /** The Claude client (a spend-guarded one in the CLI), or null: every step falls back to code. */
  client: Anthropic | null;
  /** The run's moment; the world is dated by it. */
  now: Date;
}

export async function runSoakRun(run: string, seed: number, deps: SoakDeps, world: ApWorld = generateApWorld(seed, deps.now.toISOString().slice(0, 10))): Promise<SoakRun> {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "chain-soak-"));
  const db = openDb(":memory:");
  try {
    const rail = new FakeAirwallex();
    await setupApWorld(db, rail, world);
    const reader = new ClaudeReader(db, deps.client);
    const inbox = { dir, reader, now: () => deps.now, coder: deps.client };
    const filed = new Map<string, string | null>();
    const docMs: number[] = [];
    for (const d of world.docs) {
      const file = await renderDoc(d, world.day);
      const t0 = Date.now();
      let out: IngestResult = await ingestDocument(db, inbox, { bytes: file.bytes, filename: file.filename, mime: file.mime, source: d.carrier === "eml" ? "email" : "upload", meta: file.meta });
      docMs.push(Date.now() - t0);
      if (out.kind === "email") out = out.results[0] ?? { kind: "duplicate_document", sha256: "", invoice_id: null };
      filed.set(d.id, out.kind === "invoice" ? out.invoice.id : out.kind === "duplicate_document" ? out.invoice_id : null);
    }
    // Every invoice the checks left ready is planned for payment, in one batch, as the Treasury agent's pay step does.
    const ready = [...filed.values()].filter((id): id is string => !!id && apInvoice(db, id)?.status === "ready");
    const payments = new Map<string, number>();
    let executed = 0;
    let approvalNote: string | null = null;
    const notPlanned: { id: string; reason: string }[] = [];
    if (ready.length) {
      const out = await payApInvoices(db, rail, ready, deps.now, reader);
      for (const p of out.planned) payments.set(p.id, (payments.get(p.id) ?? 0) + 1);
      notPlanned.push(...out.notPlanned);
      if (out.batch) {
        // The stand-in CFO: approves the exact terms of the batch (the hash prefix it shows), as a person would with Face ID.
        decide(db, { proposalId: out.batch.proposal_id, decision: "APPROVED", typedPrefix: out.batch.terms_sha256.slice(0, 8), approver: "stand-in CFO (soak)", method: "cli" }, deps.now);
        const status = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.batch.proposal_id) as { status: string }).status;
        if (status === "APPROVED") {
          const kindOf = (id: string) => (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(id) as { kind: string }).kind;
          // As the runner's executor does (src/executors/index.ts): every movement records the approval as its origin.
          const origin = approvalOrigin(db, out.batch.proposal_id);
          const batchId = out.batch.proposal_id;
          const runBatch = () => executePaymentBatch(db, batchId, async (id) => {
            if (kindOf(id) === "supplier_payment") await executeSupplierPayment(db, rail, rail, id, () => deps.now);
            else await executeInvoicePayment(db, rail, rail, id, () => deps.now);
          }, deps.now);
          const r = await (origin ? withOrigin(origin, runBatch) : runBatch());
          executed = r.lines.filter((l) => l.outcome === "paid").length;
          // The invoices follow their transfers in the ledger (paid once the stand-in bank's transfer is).
          await syncPayments(db, { now: () => deps.now });
          const unpaid = r.lines.filter((l) => l.outcome !== "paid");
          if (unpaid.length) approvalNote = `${unpaid.length} batch lines not paid by the stand-in bank: ${unpaid.map((l) => l.detail ?? l.status).join("; ").slice(0, 300)}`;
        } else approvalNote = `the batch is ${status} after the stand-in approval (a second approver may be needed); nothing was executed`;
      }
    }
    const documents: ChainDocResult[] = world.docs.map((d) => {
      const id = filed.get(d.id) ?? null;
      const inv = id ? apInvoice(db, id) : null;
      return { id: d.id, event: d.event, expect: { outcome: d.expect.outcome, mustNotPay: d.expect.mustNotPay }, invoice_id: id, status: inv?.status ?? null,
        pay_key: inv ? payKey(inv.vendor, inv.invoice_no) : null, ...(d.of ? { of: d.of } : {}), payments: id ? payments.get(id) ?? 0 : 0 };
    });
    const agents = soakAgentLines(db);
    const decisions: ChainDecisionCount[] = agents.map((a) => ({ agent: a.agent, by_claude: a.by_claude, fallback: a.fallback }));
    const record: ChainRunRecord = { run, seed, decisions, documents, origins: originsCheck(db) };
    return { record, gate: chainGate(record), agents, cost_usd_micros: agents.reduce((s, a) => s + a.cost_usd_micros, 0), doc_ms: docMs, executed, approval_note: approvalNote, not_planned: notPlanned };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };

export interface SoakSummary {
  runs: number;
  passed: number;
  per_agent: { agent: string; decisions: number; by_claude: number; fallback: number; claude_pct: number | null; cost_usd: number; latency_ms_p50: number; latency_ms_p90: number; models: string[] }[];
  total: { decisions: number; by_claude: number; fallback: number; claude_pct: number | null; unsafe: number; double_payments: number; without_origin: number; cost_usd: number; documents: number; executed_payments: number };
}

export function summarise(runs: SoakRun[]): SoakSummary {
  const per = SOAK_AGENTS.map((agent) => {
    const ls = runs.flatMap((r) => r.agents.filter((a) => a.agent === agent));
    const decisions = ls.reduce((s, l) => s + l.decisions, 0), by = ls.reduce((s, l) => s + l.by_claude, 0);
    const lat = ls.flatMap((l) => l.latency_ms);
    return { agent, decisions, by_claude: by, fallback: decisions - by, claude_pct: decisions ? Math.round((by / decisions) * 1000) / 10 : null,
      cost_usd: Math.round(ls.reduce((s, l) => s + l.cost_usd_micros, 0) / 100) / 10_000, latency_ms_p50: pct(lat, 50), latency_ms_p90: pct(lat, 90), models: [...new Set(ls.flatMap((l) => l.models))] };
  });
  const d = per.reduce((s, a) => s + a.decisions, 0), b = per.reduce((s, a) => s + a.by_claude, 0);
  return {
    runs: runs.length, passed: runs.filter((r) => r.gate.pass).length, per_agent: per,
    total: { decisions: d, by_claude: b, fallback: d - b, claude_pct: d ? Math.round((b / d) * 1000) / 10 : null,
      unsafe: runs.reduce((s, r) => s + r.gate.unsafe.length, 0), double_payments: runs.reduce((s, r) => s + r.gate.double_payments.length, 0),
      without_origin: runs.reduce((s, r) => s + r.gate.without_origin, 0), cost_usd: Math.round(runs.reduce((s, r) => s + r.cost_usd_micros, 0) / 100) / 10_000,
      documents: runs.reduce((s, r) => s + r.record.documents.length, 0), executed_payments: runs.reduce((s, r) => s + r.executed, 0) },
  };
}

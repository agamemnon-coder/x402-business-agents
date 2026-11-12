// The Coder agent in the runner, behind KIT11_AP_AGENTS=on: for every line of a supplier invoice it decides the ledger
// account, the VAT code and the cost centre, and code enforces it. The agent's prompt, tools and rules are the pure
// core (src/ap/coderCore.ts); this file builds the case from the ledger, runs the core through the agent loop
// (src/agents/loop.ts: cost caps, one retry, one reminder, every call in the audit log), and stores what comes out.
//
// The agent's accepted answer goes through enforceCoding; no answer at all (no key, a failure, a refusal, out of turns,
// a cost cap) gives code's own fallbackCoding, labelled. The enforced coding is stored once in ap_codings, before the
// invoice's accrual is first booked, and never changed; one decision row (ap.coded) says who decided and why. The
// accrual is then booked from it (src/ap/books.ts accrualEntries, src/ledger/feed.ts syncLedger). The row's own
// gl_account and cost_centre stay the engine's default, which is what the ERP feed still sends.

import type Anthropic from "@anthropic-ai/sdk";
import type { Json } from "@metalntwx/metal-pay/mandates";
import type { z } from "zod";
import { runAgent, type AgentRun, type AgentTool } from "../agents/loop.js";
import { audit } from "../audit/log.js";
import { claudeClient } from "../claude/reader.js";
import { COMPANY } from "../config/brand.js";
import { COST_CENTRE_NAMES } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { LEDGER_ACCOUNTS } from "../ledger/accounts.js";
import { toCents } from "../lib/money.js";
import { VAT_CODES } from "../ledger/vat.js";
import { skeleton } from "../policy/fraudCore.js";
import { currentOrigin, parseOrigin, type Origin } from "../provenance/origin.js";
import { bookable, dutchVat } from "./books.js";
import {
  answerCoderTool, buildCodingCase, CODER_EFFORT, CODER_MAX_TURNS, CODER_MODEL, CODER_SYSTEM, CODER_UNFINISHED, coderInputs, coderPrompt, coderTools, enforceCoding,
  fallbackCoding, invoiceAmounts, vatIdCountry, WHOLE_INVOICE, type CaseVatCode, type ChartAccount, type Coding, type CodingCase, type CostCentre, type EnforcedCoding, type HistoryCoding,
} from "./coderCore.js";
import { readDoc } from "./docStore.js";
import { pdfText } from "./pdfText.js";
import { EXPENSE_ACCOUNTS } from "./read.js";
import { cleanText } from "./reading.js";
import { apInvoice, storedCoding, type ApInvoiceRow, type StoredCoding } from "./store.js";

/**
 * Whether the payables agents run: only when KIT11_AP_AGENTS is exactly "on". The Coder here, and the Checker and the
 * Payer (src/ap/checkerAgent.ts, src/ap/payerAgent.ts) share this one flag. Off, none of them makes a call or writes a row.
 */
export const apAgentsOn = (env: Record<string, string | undefined> = process.env): boolean => env.KIT11_AP_AGENTS === "on";

// ── The case, from the ledger ──

/** The company's home country: its VAT codes are the Dutch ones (src/ledger/vat.ts). */
const COMPANY_COUNTRY = "NL";
/** The stored ledger's chart; only the expense accounts a supplier invoice may be booked to take purchase lines. */
const CHART: ChartAccount[] = Object.entries(LEDGER_ACCOUNTS).map(([account, name]) => ({ account, name, purchase: Object.hasOwn(EXPENSE_ACCOUNTS, account) }));
const VAT: CaseVatCode[] = Object.values(VAT_CODES).map((v) => ({ code: v.code, label: v.label, kind: v.kind, rate: v.rate, reverse: v.reverse === true, deductible: v.deductible === true }));
const COST_CENTRES: CostCentre[] = Object.entries(COST_CENTRE_NAMES).map(([code, name]) => ({ code, name }));
/** The most earlier invoices of a supplier a case carries (the agent is shown the newest few). */
const HISTORY_MAX = 20;
const MONEY = /^\d+\.\d{2}$/;

/**
 * This supplier's earlier invoices, newest first: their stored coding when they have one; otherwise the engine's own
 * coding of that invoice as one line (the row's account and cost centre, and the Dutch VAT code its tax amounts to).
 */
function historyOf(db: DB, inv: ApInvoiceRow): HistoryCoding[] {
  const rows = db.prepare(`SELECT id, vendor, invoice_no, issue_date, gl_account, cost_centre, tax, total FROM ap_invoices
    WHERE doc_kind = 'invoice' AND status NOT IN ('blocked', 'rejected') AND id != ? AND (received_at < ? OR (received_at = ? AND id < ?)) ORDER BY received_at DESC, id DESC`)
    .all(inv.id, inv.received_at, inv.received_at, inv.id) as { id: string; vendor: string; invoice_no: string; issue_date: string; gl_account: string; cost_centre: string; tax: string; total: string }[];
  const same = rows.filter((r) => inv.vendor && skeleton(r.vendor) === skeleton(inv.vendor)).slice(0, HISTORY_MAX);
  return same.map((r) => {
    const coding = storedCoding(db, r.id);
    if (coding && coding.lines.length > 0) {
      return { invoice_id: r.id, invoice_no: r.invoice_no, date: r.issue_date, lines: coding.lines.map((l) => ({ description: l.description ?? WHOLE_INVOICE, account: l.account, vat_code: l.vat_code, cost_centre: l.cost_centre })) };
    }
    const total = MONEY.test(r.total) ? toCents(r.total) : 0;
    const tax = MONEY.test(r.tax) && toCents(r.tax) > 0 && toCents(r.tax) < total ? toCents(r.tax) : 0;
    return { invoice_id: r.id, invoice_no: r.invoice_no, date: r.issue_date, lines: [{ description: WHOLE_INVOICE, account: r.gl_account, vat_code: tax ? dutchVat(total - tax, tax) : null, cost_centre: r.cost_centre }] };
  });
}

/**
 * The case of one invoice, from its row, its document's text and the company's books: what buildCodingCase needs.
 * The supplier's country is the one its VAT id starts with; without a VAT id code does not know it.
 */
export function codingCaseFor(db: DB, inv: ApInvoiceRow, text: string, today: string): CodingCase {
  const vatId = inv.reading.vat_id ?? "";
  let history: HistoryCoding[] = [];
  try { history = historyOf(db, inv); } catch { /* A history that cannot be read is no history: the case stands without it. */ }
  return buildCodingCase({
    id: inv.id, reading: inv.reading, text,
    supplier: { name: inv.vendor, country: vatIdCountry(vatId), vat_id: vatId },
    company: { name: COMPANY, country: COMPANY_COUNTRY },
    chart: CHART, vatCodes: VAT, costCentres: COST_CENTRES, history,
    engineDefault: { account: inv.gl_account, rule: inv.gl_rule, cost_centre: inv.cost_centre },
    today,
  });
}

// ── The run, and what is stored ──

export interface CoderDeps {
  /** The Claude client; absent: claudeClient() (null without a key, and then the fallback decides). */
  client?: Anthropic | null | undefined;
  /** Another model than CODER_MODEL: only the evals pass one. */
  model?: string | undefined;
  now?: (() => Date) | undefined;
  /** Tests set 0 (the loop's one retry after a transient failure). */
  retryDelayMs?: number | undefined;
}

export interface CodedInvoice {
  /** The coding the books use: the stored one. */
  coding: StoredCoding;
  /** True when this call stored it; false when it was stored before (then no Claude call was made) or by another process. */
  fresh: boolean;
  /** The agent's own accepted answer in this call, before code's rules, or null. */
  raw: Coding | null;
  /** This call's agent run, or null when none was made. */
  run: AgentRun | null;
}

/** The lines as stored: each with the description code read for it. */
function withDescriptions(c: CodingCase, e: EnforcedCoding): StoredCoding {
  const read = c.invoice.lines.length === e.lines.length ? c.invoice.lines : [];
  return { ...e, lines: e.lines.map((l, i) => ({ line_no: l.line_no, description: cleanText(read[i]?.description ?? WHOLE_INVOICE, 200) || WHOLE_INVOICE, account: l.account, vat_code: l.vat_code, cost_centre: l.cost_centre, net_cents: l.net_cents, vat_cents: l.vat_cents })) };
}

/** D24: who decided this coding. The agent's own code_invoice call, or code's fallback by its rule (with the agent's call when its answer was refused). */
function originOf(e: EnforcedCoding, agent: Origin | null): Origin | null {
  if (e.source === "claude" && agent) return agent;
  const rule = e.source === "claude" ? "ap coder: the agent's coding, its call's origin was not recorded"
    : e.overridden_by ? `ap coder fallback: the agent's coding was refused (${e.overridden_by})` : "ap coder fallback: the agent gave no answer";
  return parseOrigin(JSON.stringify({ actor: "code", rule, agent: "treasury", ...(e.overridden_by && agent ? { set_by: agent } : {}) }));
}

/**
 * Stores the coding once and writes its decision row, in one transaction. When a coding is already stored (an earlier
 * call, another process), nothing is written and that one is returned.
 */
function store(db: DB, inv: ApInvoiceRow, c: CodingCase, e: EnforcedCoding, raw: Coding | null, run: AgentRun | null, agent: Origin | null, model: string, at: Date): { coding: StoredCoding; fresh: boolean } {
  const coding = withDescriptions(c, e);
  return db.transaction(() => {
    const had = storedCoding(db, inv.id);
    if (had) return { coding: had, fresh: false };
    const answeredBy = coding.source === "claude" ? run?.model ?? model : null;
    db.prepare("INSERT INTO ap_codings (invoice_id, coding_json, source, status, model, coded_at) VALUES (?, ?, ?, ?, ?, ?)").run(inv.id, JSON.stringify(coding), coding.source, coding.status, answeredBy, at.toISOString());
    audit(db, coding.source === "claude" ? "treasury" : "system", "ap.coded", inv.id, {
      source: coding.source, status: coding.status, model: answeredBy, reason: coding.reason, lines: coding.lines, net_cents: coding.net_cents, vat_cents: coding.vat_cents, total_cents: coding.total_cents,
      overridden_by: coding.overridden_by, refused_because: coding.refused_because, review: coding.review,
      // The agent's own coding when code refused it, so the override can be seen.
      agent_coding: coding.overridden_by && raw ? raw : null,
      run: { status: run?.status ?? "not_run", turns: run?.turns ?? 0, cost_usd_micros: run?.costMicros ?? 0, note: run?.note ?? null },
      origin: originOf(coding, agent),
    } as unknown as Json, at);
    return { coding, fresh: true };
  }).immediate();
}

/**
 * Codes one invoice: the Coder agent's answer through enforceCoding, or code's labelled fallback when there is no
 * answer. Stored once: a second call for the same invoice makes no Claude call and returns the stored coding, and of
 * two processes only one stores. Never throws: any failure ends in the fallback.
 */
export async function codeInvoice(db: DB, inv: ApInvoiceRow, text: string, deps: CoderDeps = {}): Promise<CodedInvoice> {
  const at = (deps.now ?? (() => new Date()))();
  const model = deps.model ?? CODER_MODEL;
  let c: CodingCase | null = null;
  let raw: Coding | null = null;
  let run: AgentRun | null = null;
  let agent: Origin | null = null;
  try {
    const had = storedCoding(db, inv.id);
    if (had) return { coding: had, fresh: false, raw: null, run: null };
    c = codingCaseFor(db, inv, text, at.toISOString().slice(0, 10));
    const built = c;
    // An invoice whose own amounts cannot be read has no lines to code: no call is made for it.
    if (invoiceAmounts(built.invoice).ok) {
      const tools = coderTools.map((t): AgentTool<z.ZodType> => ({
        name: t.name, description: t.description, input: coderInputs[t.name],
        run: async (input) => {
          const a = answerCoderTool(built, { name: t.name, input });
          if (a.final && a.coding) {
            raw = a.coding;
            // D24: the origin of this very call (the agent, the model, the API request and the run), as the loop set it.
            const o = currentOrigin();
            agent = o && o.actor === "agent" ? o : null;
          }
          return { text: a.text, ...(a.blocked ? { blocked: a.blocked } : {}), ...(a.final ? { final: true } : {}) };
        },
      }));
      run = await runAgent(db, {
        agent: "treasury", task: `ap.code.${inv.id}`, model, system: CODER_SYSTEM, prompt: coderPrompt(built), tools, maxTurns: CODER_MAX_TURNS, effort: CODER_EFFORT,
        unfinished: () => (raw ? null : CODER_UNFINISHED), ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
      }, deps.client === undefined ? claudeClient() : deps.client);
    }
  } catch {
    // Whatever went wrong (the case, the loop, the client): code's fallback decides below, labelled.
  }
  const answered = raw as Coding | null;
  const enforced = c && answered ? enforceCoding(c, answered) : fallbackCoding(c as CodingCase);
  try {
    const stored = store(db, inv, c ?? codingCaseFor(db, inv, text, at.toISOString().slice(0, 10)), enforced, answered, run, agent, model, at);
    return { ...stored, raw: answered, run };
  } catch {
    // The ledger refused the write (it is busy, or the invoice is gone): nothing is stored, and the caller books the engine's own coding.
    return { coding: { ...enforced, lines: enforced.lines.map((l) => ({ ...l })) }, fresh: false, raw: answered, run };
  }
}

// ── Before the accrual is first booked ──

/** The document's text as the inbox read it: the PDF's text layer, or a scan's transcription. */
async function documentText(db: DB, inv: ApInvoiceRow): Promise<string> {
  const doc = db.prepare("SELECT path, text_chars FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string; text_chars: number } | undefined;
  try {
    const text = doc?.text_chars ? (await pdfText(readDoc(db, doc.path))).text : "";
    if (text) return text;
  } catch { /* A PDF that cannot be opened has no text layer to read: the scan's transcription, if any, is used. */ }
  return (db.prepare("SELECT transcription FROM ap_scan_readings WHERE invoice_id = ?").get(inv.id) as { transcription: string | null } | undefined)?.transcription ?? "";
}

/** Whether a sink or the stored ledger already holds this invoice's accrual. */
function accrualBooked(db: DB, id: string): boolean {
  if (db.prepare("SELECT 1 FROM ap_sink_events WHERE invoice_id = ? AND event = 'accrual'").get(id)) return true;
  const key = `ap-accrual|${id}`;
  return !!db.prepare("SELECT 1 FROM ledger_entries WHERE source_key = ? OR substr(source_key, 1, ?) = ?").get(key, key.length + 2, `${key}@v`);
}

/**
 * Makes sure an invoice is coded before its accrual is first booked, and returns the row as it then is (with its
 * coding). Only with the flag on, only for an invoice (credit notes and reminders are not coded), only when it is
 * bookable, and only while nothing has booked its accrual yet: books that already hold it are not recoded. The caller
 * passes the document's text when it has it; otherwise the stored document is read. Never throws: an invoice that
 * could not be coded is returned as it was, and is booked with the engine's own coding.
 */
export async function ensureCoded(db: DB, inv: ApInvoiceRow, deps: CoderDeps & { text?: string | undefined; env?: Record<string, string | undefined> | undefined } = {}): Promise<ApInvoiceRow> {
  try {
    if (!apAgentsOn(deps.env) || inv.doc_kind !== "invoice" || !bookable(inv) || inv.coding || accrualBooked(db, inv.id)) return inv;
    await codeInvoice(db, inv, deps.text ?? (await documentText(db, inv)), deps);
    return apInvoice(db, inv.id) ?? inv;
  } catch {
    return inv;
  }
}

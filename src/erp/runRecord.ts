// The record of a live ERP run, as data (Moneybird sandbox run, 12 November 2026). Everything in it is read from what
// the run itself wrote: the call log (one line per request, written before it was sent), the audit log's erp.* rows
// (what was sent and what the ERP called it), the erp_sync rows, the steps file (when each command of the run started
// and ended) and the read-back's reconciliation. No number in it is typed; the labels are computed from the same data.
// It holds no secret: no token, no header, no request body.

import type { DB } from "../db/open.js";
import { callsByEndpoint, type ErpCallLine } from "./callBudget.js";
import { MONEYBIRD_ENDPOINTS, MONEYBIRD_SANDBOX_ADMINISTRATION } from "./moneybird.js";
import type { Reconciliation } from "./readback.js";
import { syncStatus } from "./sync.js";

/** One command of the run: its name and when it started and ended (written by the run's own wrapper, not by hand). */
export interface RunStep { step: string; started_at: string; ended_at: string; exit: number }

export interface RunRecord {
  connector: string;
  administration: string | null;
  labels: string[];
  calls: {
    approved: number;
    used: number;
    by_endpoint: { endpoint: string; calls: number }[];
    by_step: (RunStep & { calls: number; by_endpoint: { endpoint: string; calls: number }[] })[];
    /** Requests in the log that fall in no step's time. */
    outside_steps: number;
    /** Requests to an endpoint that is not on the connector's list (none of which sends an e-mail or a document). */
    off_the_list: number;
  };
  /** What the audit log says the ERP link did, oldest first. Ids are the ERP's, as strings. */
  sent: { at: string; event: string; kind: string; object: string; external_id: string | null; credit_note: string | null; replaced: string | null; detail: string | null }[];
  /** Every object as the ERP link holds it now. */
  objects: { kind: string; object: string; status: string; external_id: string | null }[];
  reconciliation: Reconciliation | null;
  /** The second, identical sync: how many requests it made and what it reported. */
  idempotency: { step: string; requests: number } | null;
}

const within = (c: ErpCallLine, s: RunStep) => c.at >= s.started_at && c.at <= s.ended_at;

/** The Moneybird endpoints as the call log names them, for one administration. */
function listedCalls(administration: string): Set<string> {
  return new Set(MONEYBIRD_ENDPOINTS.map((e) => {
    const [method, path] = e.split(" ") as [string, string];
    return `${method} moneybird.com/api/v2${path.replace("{administration_id}", administration).replace("{format}", ".json")}`;
  }));
}

export function buildRunRecord(db: DB, o: { connector: string; administration: string | null; sandboxOnly: boolean; calls: ErpCallLine[]; approved: number; steps: RunStep[]; reconciliation: Reconciliation | null; idempotencyStep?: string }): RunRecord {
  const audit = (db.prepare("SELECT ts, event, subject, payload_json FROM audit_log WHERE event LIKE 'erp.%' ORDER BY seq").all() as { ts: string; event: string; subject: string | null; payload_json: string }[])
    .map((r) => ({ ...r, p: JSON.parse(r.payload_json) as Record<string, string | number | null> }))
    .filter((r) => r.p.connector === o.connector);
  const sent = audit.map((r) => {
    const [, kind = "", ...rest] = (r.subject ?? "").split(":");
    const s = (v: string | number | null | undefined) => (v === undefined || v === null ? null : String(v));
    return { at: r.ts, event: r.event, kind, object: rest.join(":"), external_id: s(r.p.external_id), credit_note: s(r.p.credit_note), replaced: s(r.p.replaced), detail: s(r.p.error ?? r.p.reason) };
  });
  const objects = syncStatus(db, o.connector).map((r) => ({ kind: r.kind, object: r.object_id, status: r.status, external_id: r.external_id }));
  const listed = o.administration ? listedCalls(o.administration) : null;
  const offTheList = listed ? o.calls.filter((c) => !listed.has(`${c.method} ${c.endpoint}`)).length : 0;
  const bySteps = o.steps.map((s) => { const mine = o.calls.filter((c) => within(c, s)); return { ...s, calls: mine.length, by_endpoint: callsByEndpoint(mine) }; });
  const idem = o.idempotencyStep ? bySteps.find((s) => s.step === o.idempotencyStep) : undefined;

  // The labels, each from the run's own data.
  const labels: string[] = [];
  if (o.connector === "moneybird" && o.sandboxOnly && o.administration === MONEYBIRD_SANDBOX_ADMINISTRATION) labels.push("Moneybird sandbox administration");
  const suppliers = db.prepare("SELECT name FROM beneficiaries").all() as { name: string }[];
  if (suppliers.length > 0 && suppliers.every((b) => /\(test\)$/.test(b.name))) labels.push("test data");
  if (listed && offTheList === 0) labels.push("no e-mail sent");

  return {
    connector: o.connector, administration: o.administration, labels,
    calls: { approved: o.approved, used: o.calls.length, by_endpoint: callsByEndpoint(o.calls), by_step: bySteps, outside_steps: o.calls.filter((c) => !o.steps.some((s) => within(c, s))).length, off_the_list: offTheList },
    sent, objects, reconciliation: o.reconciliation,
    idempotency: idem ? { step: idem.step, requests: idem.calls } : null,
  };
}

const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const code = (s: string | null) => (s ? `\`${s}\`` : "-");
const WORDS: Record<string, string> = {
  "erp.pushed": "sent", "erp.found_existing": "found in the ERP, not sent again", "erp.push_failed": "failed", "erp.needs_review": "left for a person",
  "erp.needs_correction": "changed after it was sent", "erp.corrected": "corrected: credit note, then the new version", "erp.invalid": "refused before sending", "erp.resolved": "settled by a person",
};

/** The record's tables as Markdown, for the run notes: generated, so the page and the data cannot drift apart. */
export function runRecordMarkdown(r: RunRecord): string {
  const out: string[] = [];
  out.push(`Labels: ${r.labels.join("; ")}.`, "");
  out.push(`**Requests: ${r.calls.used} of the ${r.calls.approved} approved.**`, "");
  out.push(table(["Request", "Times"], r.calls.by_endpoint.map((e) => [code(e.endpoint), e.calls])), "");
  out.push(table(["Step", "Started (UTC)", "Requests"], r.calls.by_step.map((s) => [s.step, s.started_at.slice(11, 19), s.calls])), "");
  if (r.calls.outside_steps) out.push(`${r.calls.outside_steps} requests in the call log fall in no step listed here.`, "");
  out.push("**What the ERP link did, from the audit log.**", "");
  out.push(table(["Time (UTC)", "What", "Object", "Result", "Moneybird id"], r.sent.map((s) => [
    s.at.slice(11, 19), s.kind, s.object.replace(/\|/g, "/"), `${WORDS[s.event] ?? s.event}${s.detail ? `: ${s.detail.replace(/\|/g, "/")}` : ""}`,
    s.event === "erp.corrected" ? `${code(s.external_id)} (credit note ${code(s.credit_note)}, replaces ${code(s.replaced)})` : code(s.external_id),
  ])), "");
  if (r.reconciliation) {
    const rec = r.reconciliation;
    out.push(`**Read back and reconciled: ${rec.differences} differences in ${rec.documents} documents.** Each row is one purchase invoice in Moneybird, read at ${rec.read_at.slice(11, 19)} UTC. Amounts in EUR; "Purser" is the ledger, "Moneybird" is what the read-back answered.`, "");
    out.push(table(["Document", "Number", "Moneybird id", "Net (Purser / Moneybird)", "VAT", "Gross", "Paid", "State", "PDF", "Result"], rec.rows.map((x) => [
      x.role.replace("_", " "), x.number, code(x.external_id), `${x.purser.net} / ${x.erp.net}`, `${x.purser.vat} / ${x.erp.vat}`, `${x.purser.gross} / ${x.erp.gross}`, `${x.purser.paid} / ${x.erp.paid}`,
      `${x.purser.state} / ${x.erp.state}`, x.erp.attachments, x.differences.length ? x.differences.join("; ").replace(/\|/g, "/") : "equal",
    ])), "");
    for (const n of rec.not_compared) out.push(`Not compared: ${n.invoice}: ${n.reason}.`, "");
  }
  if (r.idempotency) out.push(`**The same sync run again (step "${r.idempotency.step}") made ${r.idempotency.requests} requests.**`, "");
  return out.join("\n").trimEnd();
}

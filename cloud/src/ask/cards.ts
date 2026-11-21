// Ask Purser's answer cards (21 Nov, Max: "answers render rich blocks from the tool results, not text walls"): when the
// agent reads the demo company's invoices (pending_approvals, list_invoices, get_invoice), the route sends the rows it
// read as one card the page draws as a list (supplier, number, due day, amount, Review), each row with what its detail
// panel shows (amount, due, payee, the account masked, how far it got: read, checked, approved, paid). Every value is the
// demo company's record as the tool returned it (made-up data, read only); nothing here is written, computed as money or
// invented. The page draws every value as text.
import type { ToolCtx } from "./tools.js";

export interface InvoiceRow {
  id: string; vendor: string; invoice_no: string; currency: string; total: string; due_date: string;
  status: string; status_words: string; account: string | null; read_by: string | null; findings: number;
  review_note: string | null; paid_at: string | null; proposal_id: string | null;
}
export interface AskCard { kind: "invoices"; title: string; items: InvoiceRow[] }

/** Rows in one card at most. */
export const CARD_ROWS = 8;
const str = (v: unknown, max = 160): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const opt = (v: unknown, max = 160): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

/** One invoice as the card shows it, from a tool's record (an invoice of list_invoices or get_invoice). */
export function invoiceRow(x: Record<string, unknown>, fallback: Partial<InvoiceRow> = {}): InvoiceRow | null {
  const id = str(x.id, 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/.test(id)) return null;
  const last4 = opt(x.iban_last4, 8);
  return {
    id, vendor: str(x.vendor) || fallback.vendor || "", invoice_no: str(x.invoice_no, 60) || fallback.invoice_no || "",
    currency: str(x.currency, 3) || fallback.currency || "", total: str(x.total, 24) || fallback.total || "", due_date: str(x.due_date, 10) || fallback.due_date || "",
    status: str(x.status, 32) || fallback.status || "", status_words: str(x.status_words, 80) || fallback.status_words || "",
    account: last4 ? `…${last4}` : null, read_by: opt(x.read_by, 20), findings: Array.isArray(x.findings) ? x.findings.length : 0,
    review_note: opt(x.review_note, 240), paid_at: opt(x.paid_at, 30), proposal_id: opt(x.proposal_id, 20) ?? fallback.proposal_id ?? null,
  };
}

/** The card for a tool's result, or null when the tool reads no invoices. `detail` reads one invoice (get_invoice). */
export async function cardOf(tool: string, data: unknown, detail: (id: string) => Promise<Record<string, unknown> | null>): Promise<AskCard | null> {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (tool === "get_invoice" && d.invoice && typeof d.invoice === "object") {
    const row = invoiceRow(d.invoice as Record<string, unknown>);
    return row ? { kind: "invoices", title: "Invoice", items: [row] } : null;
  }
  if (tool === "list_invoices" && Array.isArray(d.items)) {
    const items = (d.items as Record<string, unknown>[]).slice(0, CARD_ROWS).map((x) => invoiceRow(x)).filter((x): x is InvoiceRow => !!x);
    return items.length ? { kind: "invoices", title: "Invoices", items } : null;
  }
  if (tool === "pending_approvals" && Array.isArray(d.invoices)) {
    const items: InvoiceRow[] = [];
    for (const x of (d.invoices as Record<string, unknown>[]).slice(0, CARD_ROWS)) {
      const base = invoiceRow(x, { status: "waiting_cfo", status_words: "Waits for the CFO's Face ID" });
      if (!base) continue;
      const full = await detail(base.id).catch(() => null);
      items.push((full && invoiceRow(full, base)) || { ...base, total: str(x.total, 24) });
    }
    return items.length ? { kind: "invoices", title: "Waiting for the CFO's Face ID", items } : null;
  }
  return null;
}

/** The detail reader the route gives cardOf: get_invoice over the demo company, its record as data. */
export function demoDetail(ctx: ToolCtx, run: (ctx: ToolCtx, name: string, input: unknown, n: number) => Promise<{ isError: boolean; data?: unknown }>) {
  return async (id: string): Promise<Record<string, unknown> | null> => {
    const r = await run(ctx, "get_invoice", { id }, 0);
    const inv = !r.isError && r.data && typeof r.data === "object" ? (r.data as { invoice?: unknown }).invoice : null;
    return inv && typeof inv === "object" ? (inv as Record<string, unknown>) : null;
  };
}

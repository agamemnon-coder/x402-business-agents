// Payables: Claude Opus (role "review") writes a short note on every irregular invoice (blocked, needing a person,
// waiting for a supplier or for the CFO's Face ID, or with a warning): why it is irregular and what a person should
// check. Advisory text only: it is stored with the invoice and shown with the payment proposal, and never changes a
// status. Code accepts a note of 1 to 600 characters; otherwise, and without a key, the code's own reasons are the note.

import { z } from "zod";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { Asker } from "./read.js";
import { apInvoice, type ApInvoiceRow } from "./store.js";

export const ReviewSchema = z.object({ note: z.string() });
export const MAX_NOTE_CHARS = 600;

const INSTRUCTION = [
  "You advise the person who decides on this supplier invoice. In at most three sentences, say why it is irregular and",
  "what they should check before acting. Do not decide, do not repeat bank details, and do not invent facts: use only",
  "the fields and findings given.",
].join("\n");

/** Each status in plain words, as the CFO reads it (the payables page and its JSON carry these: screenshot pass S4). */
export const STATUS_WORDS: Record<string, string> = {
  blocked: "Blocked", needs_review: "Needs a person", needs_vendor: "Waits for a new supplier",
  waiting_cfo: "Waits for the CFO's Face ID", ready: "Ready to pay", paid: "Paid", rejected: "Rejected",
};

export function needsNote(inv: Pick<ApInvoiceRow, "status" | "findings">): boolean {
  return ["blocked", "needs_review", "needs_vendor", "waiting_cfo"].includes(inv.status) || inv.findings.some((f) => f.level === "warn");
}

/** The note without a model: the status and the code's own reasons. */
export function codeNote(inv: ApInvoiceRow): string {
  const reasons = inv.findings.map((f) => f.detail).join("; ");
  const what = `${inv.vendor || "unknown supplier"} invoice ${inv.invoice_no || "(no number)"}${inv.total ? `, ${inv.currency} ${inv.total}` : ""}`;
  return `${STATUS_WORDS[inv.status] ?? inv.status}: ${what}. ${reasons ? `${reasons}.` : "The checks found nothing irregular."}`.slice(0, 1200);
}

export async function writeReviewNote(db: DB, reader: Asker | undefined, id: string, now = new Date()): Promise<ApInvoiceRow> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  const fallback = codeNote(inv);
  let note = fallback;
  let by = "code";
  if (reader) {
    const facts = {
      vendor: inv.vendor, invoice_no: inv.invoice_no, document: inv.doc_kind, total: inv.total, currency: inv.currency, due_date: inv.due_date,
      status: STATUS_WORDS[inv.status] ?? inv.status, findings: inv.findings.map((f) => ({ level: f.level, detail: f.detail })),
    };
    const read = await reader.ask(
      { task: `ap.review:${id}`, role: "review", actor: "treasury", schema: ReviewSchema, instruction: INSTRUCTION, document: JSON.stringify(facts, null, 2) },
      () => ({ note: fallback }),
    );
    const text = String((read.value as { note?: unknown }).note ?? "").trim();
    if (read.source === "claude" && text.length > 0 && text.length <= MAX_NOTE_CHARS) {
      note = text;
      by = `claude:${read.model}`;
    }
  }
  db.prepare("UPDATE ap_invoices SET review_note = ?, review_by = ? WHERE id = ?").run(note, by, id);
  audit(db, "treasury", "ap.review_note", id, { by, status: inv.status }, now);
  return apInvoice(db, id)!;
}

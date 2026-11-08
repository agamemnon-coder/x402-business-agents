// Payables, part 2: reading an invoice. Claude Sonnet through the existing reader (cached system prompt, audit, cost,
// and the parser as its fallback when there is no key or the call fails); its reading is used only when it passes
// readingCheck. Otherwise the document's own lines, read by the parser, are used, and the audit log says why.

import { audit } from "../audit/log.js";
import type { ClaudeReader } from "../claude/reader.js";
import { CHART } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { apInstruction, ApReadingSchema, parseApFallback, readingCheck, type ApReading } from "./reading.js";

/** What the inbox needs of a reader: ClaudeReader, or a stand-in in tests. */
export interface Asker { ask: ClaudeReader["ask"] }

/** The expense accounts a supplier invoice may be booked to (a model may only suggest one of these). */
export const EXPENSE_ACCOUNTS: Record<string, string> = Object.fromEntries(Object.entries(CHART).filter(([n]) => /^[56]\d{3}$/.test(n)));

const tidy = (r: ApReading): ApReading => ({
  ...r,
  vendor: r.vendor.trim(), invoice_no: r.invoice_no.trim(), currency: r.currency.trim().toUpperCase(),
  iban: r.iban.replace(/\s+/g, "").toUpperCase(), bic: r.bic.replace(/\s+/g, "").toUpperCase(), account_number: r.account_number.replace(/[\s-]/g, "").toUpperCase(), routing_type: r.routing_type.trim().toLowerCase(), routing_value: r.routing_value.replace(/[\s-]/g, ""), bank_country: r.bank_country.trim().toUpperCase(), vat_id: r.vat_id.replace(/\s+/g, "").toUpperCase(),
  gl_account: r.gl_account.trim(),
});

/** The most text sent to a model per call: a huge text layer is never a huge prompt (review, 8 November). */
export const MODEL_TEXT_LIMIT = 50_000;

export async function readDocument(db: DB, reader: Asker, text: string, docSha: string): Promise<{ reading: ApReading; readBy: string }> {
  const own = parseApFallback(text);
  if (!text.trim()) return { reading: own, readBy: "parser" };
  const read = await reader.ask(
    { task: `ap.read:${docSha.slice(0, 16)}`, role: "act", actor: "treasury", schema: ApReadingSchema, instruction: apInstruction(EXPENSE_ACCOUNTS), document: text.slice(0, MODEL_TEXT_LIMIT) },
    () => own,
  );
  if (read.source !== "claude") return { reading: own, readBy: "parser" };
  const value = tidy(read.value as ApReading);
  const why = readingCheck(value, text);
  if (why) {
    audit(db, "treasury", "ap.reading_not_used", docSha, { reason: why, model: read.model });
    return { reading: own, readBy: "parser" };
  }
  return { reading: value, readBy: `claude:${read.model}` };
}

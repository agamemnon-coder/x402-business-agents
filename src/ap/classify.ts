// Payables: what a document is, before it is read. Claude Haiku (role "classify") labels it; code accepts only one of
// five labels, else the keyword rules decide (also without a key). Only an invoice, a credit note or a reminder is read
// in full; a receipt or anything else is kept and handed to a person.

import { z } from "zod";
import type { DB } from "../db/open.js";
import type { Asker } from "./read.js";

export const DOC_KINDS = ["invoice", "credit_note", "receipt", "reminder", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const ClassifySchema = z.object({ kind: z.string() });

const INSTRUCTION = [
  "Say what this business document is, as one label:",
  "invoice (a supplier asks to be paid), credit_note (a supplier credits us), receipt (a payment already made),",
  "reminder (a supplier reminds us of an unpaid invoice), or other (anything else).",
].join("\n");

const CREDIT = /\b(credit\s*note|creditnota|credit\s*memo|gutschrift|rechnungskorrektur)\b/i;
const REMINDER = /\b(payment\s+reminder|reminder|betalingsherinnering|herinnering|aanmaning|zahlungserinnerung|mahnung)\b/i;
const RECEIPT = /\b(receipt|kwitantie|quittung|kassenbon|payment\s+received|betaling\s+ontvangen)\b/i;
const INVOICE = /\b(invoice|factuur|rechnung|bill)\b/i;

/** The keyword rules, in order: a credit note or a reminder mentions an invoice too. */
export function classifyFallback(text: string): DocKind {
  if (CREDIT.test(text)) return "credit_note";
  if (REMINDER.test(text)) return "reminder";
  if (RECEIPT.test(text)) return "receipt";
  if (INVOICE.test(text)) return "invoice";
  return "other";
}

export async function classifyDocument(_db: DB, reader: Asker, text: string, docSha: string): Promise<{ kind: DocKind; by: string }> {
  const rules = classifyFallback(text);
  const read = await reader.ask(
    { task: `ap.classify:${docSha.slice(0, 16)}`, role: "classify", actor: "treasury", schema: ClassifySchema, instruction: INSTRUCTION, document: text },
    () => ({ kind: rules }),
  );
  const label = String((read.value as { kind?: unknown }).kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (read.source === "claude" && (DOC_KINDS as readonly string[]).includes(label)) return { kind: label as DocKind, by: `claude:${read.model}` };
  return { kind: rules, by: "rules" };
}

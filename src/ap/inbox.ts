// Payables, part 1: the one way in. An upload, a watched folder, an e-mail and (later) the agent API all call
// ingestDocument; an e-mail goes through ingestEmail, which takes raw RFC 822 bytes, so a mailbox poller can feed it.
// The document is written once to <dir>/docs/<sha256>.<ext> and never changed; the ledger keeps its hash. Then it is
// read (src/ap/read.ts), checked (src/ap/checks.ts) and filed with a status and the reasons.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import { VENDOR_GL } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { skeleton } from "../policy/fraudCore.js";
import { accrualEntries, bookable, pushOnce, type BookkeepingSink } from "./books.js";
import { evaluate, statusOf } from "./checks.js";
import { classifyDocument, type DocKind } from "./classify.js";
import { needsNote, writeReviewNote } from "./review.js";
import { parseApFallback } from "./reading.js";
import { parseEml } from "./eml.js";
import { isPdf, pdfText } from "./pdfText.js";
import { EXPENSE_ACCOUNTS, readDocument, type Asker } from "./read.js";
import type { ApReading } from "./reading.js";
import type { Finding } from "./store.js";
import { apInvoice, apInvoices, nextApId, setStatus, type ApInvoiceRow } from "./store.js";

export type Source = "upload" | "folder" | "email" | "api";

export interface InboxDeps {
  /** The payables folder: documents are kept in <dir>/docs. */
  dir: string;
  reader: Asker;
  now?: () => Date;
  /** Where booked entries go as they happen (src/ap/books.ts); none: the export reads the ledger. */
  sink?: BookkeepingSink;
}

export interface IncomingDocument {
  bytes: Buffer;
  filename: string;
  mime?: string;
  source: Source;
  /** Where it came from, as the way in knows it (an e-mail's sender and subject, an API caller): kept with the document. */
  meta?: Record<string, string>;
}

export type IngestResult =
  | { kind: "invoice"; invoice: ApInvoiceRow }
  | { kind: "duplicate_document"; sha256: string; invoice_id: string | null }
  | { kind: "email"; results: IngestResult[] };

/** The largest document taken in. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** The cost centre supplier invoices are booked to: finance (the Treasury agent's). */
export const AP_COST_CENTRE = "CC300";

const isEml = (d: IncomingDocument) => /\.eml$/i.test(d.filename) || d.mime === "message/rfc822";

/** The expense account: the supplier's in the chart, its earlier invoices', Claude's suggestion from the chart, or the default. */
function glFor(db: DB, r: ApReading, readBy: string): { account: string; rule: string } {
  const known = Object.entries(VENDOR_GL).find(([v]) => skeleton(v) === skeleton(r.vendor));
  if (known) return { account: known[1], rule: "the supplier's account in the chart" };
  const earlier = (db.prepare("SELECT vendor, gl_account FROM ap_invoices WHERE status NOT IN ('blocked', 'rejected') ORDER BY received_at DESC").all() as { vendor: string; gl_account: string }[])
    .find((x) => r.vendor && skeleton(x.vendor) === skeleton(r.vendor));
  if (earlier) return { account: earlier.gl_account, rule: "as this supplier's earlier invoices" };
  if (readBy.startsWith("claude:") && EXPENSE_ACCOUNTS[r.gl_account]) return { account: r.gl_account, rule: "suggested by Claude, from the chart" };
  return { account: "6900", rule: "default for supplier invoices" };
}

/** A receipt or anything else that is not an invoice: kept, not read in full, handed to a person. */
function notAnInvoice(kind: DocKind | "unread"): { findings: Finding[] } {
  return kind === "receipt"
    ? { findings: [{ code: "receipt", level: "review", detail: "a receipt for a payment already made: nothing to pay; a person files it" }] }
    : { findings: [{ code: "not_an_invoice", level: "review", detail: "this document does not look like an invoice, credit note or reminder; a person looks at it" }] };
}

/** Every way in calls this. A PDF is filed and read; an e-mail's PDFs are each filed; anything else is refused. */
/** The most PDFs filed from one e-mail; the rest are refused with the reason (a mail of thousands costs thousands of reads). */
export const MAX_EMAIL_ATTACHMENTS = 20;

export async function ingestDocument(db: DB, deps: InboxDeps, doc: IncomingDocument, depth = 0): Promise<IngestResult> {
  if (doc.bytes.length > MAX_DOCUMENT_BYTES) throw new Error(`${doc.filename} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB; nothing was filed`);
  if (isEml(doc)) {
    // An e-mail is opened once: an e-mail inside it is not opened again (red team G).
    if (depth > 0) throw new Error(`${doc.filename} is an e-mail inside an e-mail; it is not opened (forward its PDF instead); nothing was filed`);
    return { kind: "email", results: await ingestEmail(db, deps, doc.bytes, { ...doc.meta, file: doc.filename }, doc.source === "email" ? "email" : doc.source) };
  }
  if (!isPdf(doc.bytes)) throw new Error(`${doc.filename} is not a PDF: only PDF invoices, or e-mails (.eml) with a PDF attached, are taken in; nothing was filed`);
  const now = (deps.now ?? (() => new Date()))();
  const sha = createHash("sha256").update(doc.bytes).digest("hex");

  const known = db.prepare("SELECT sha256 FROM ap_documents WHERE sha256 = ?").get(sha);
  if (known) {
    const inv = db.prepare("SELECT id FROM ap_invoices WHERE doc_sha256 = ?").get(sha) as { id: string } | undefined;
    audit(db, "system", "ap.duplicate_document", sha, { filename: doc.filename, source: doc.source, invoice_id: inv?.id ?? null }, now);
    return { kind: "duplicate_document", sha256: sha, invoice_id: inv?.id ?? null };
  }

  const docs = join(deps.dir, "docs");
  mkdirSync(docs, { recursive: true });
  const path = join(docs, `${sha}.pdf`);
  if (!existsSync(path)) {
    writeFileSync(path, doc.bytes, { flag: "wx" });
    chmodSync(path, 0o444);
  }

  let text = "";
  let noText: string | undefined;
  try {
    text = (await pdfText(doc.bytes)).text;
    if (!text) noText = "needs a person: there is no text in this PDF (a scan); reading scans (OCR) is not built yet";
  } catch (e) {
    noText = `needs a person: the PDF could not be opened (${(e as Error).message.slice(0, 120)})`;
  }

  db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, meta_json, text_chars, received_at) VALUES (?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)")
    .run(sha, doc.filename.slice(0, 200), doc.bytes.length, path, doc.source, JSON.stringify(doc.meta ?? {}), text.length, now.toISOString());

  // Haiku labels the document first; only an invoice, a credit note or a reminder is read in full (Sonnet).
  const cls = noText ? { kind: "unread" as const, by: "none" } : await classifyDocument(db, deps.reader, text, sha);
  const readFully = cls.kind === "invoice" || cls.kind === "credit_note" || cls.kind === "reminder";
  const { reading, readBy } = readFully ? await readDocument(db, deps.reader, text, sha) : { reading: parseApFallback(text), readBy: "parser" };
  const id = nextApId(db);
  const checked = readFully || noText ? evaluate(db, reading, text, { docSha: sha, now, ...(noText ? { noText } : {}) }) : notAnInvoice(cls.kind);
  const findings = [...checked.findings];
  if (cls.kind === "credit_note") findings.push({ code: "credit_note", level: "review", detail: "a credit note: nothing is paid; a person sets it against this supplier's next invoice" });
  if (cls.kind === "reminder") {
    // A reminder is never paid on its own: one that matches an invoice on file is blocked as its copy; one that matches
    // none goes to a person (red team D).
    const matched = findings.some((x) => x.code === "duplicate" || x.code === "possible_duplicate");
    findings.push(matched
      ? { code: "reminder", level: "warn", detail: "a payment reminder for an invoice on file: it is never paid twice" }
      : { code: "reminder", level: "review", detail: "a payment reminder that matches no invoice on file: a person finds the invoice it is about; a reminder is never paid on its own" });
  }
  const status = statusOf(findings);
  const gl = glFor(db, reading, readBy);
  db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by,
    gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sha, cls.kind, cls.by, reading.vendor, reading.invoice_no, reading.issue_date, reading.due_date, reading.currency, reading.subtotal, reading.tax, reading.total,
      reading.iban.slice(-4), reading.bic, JSON.stringify(reading), readBy, gl.account, gl.rule, AP_COST_CENTRE, status, JSON.stringify(findings), now.toISOString(), now.toISOString());
  audit(db, "system", "ap.received", id, {
    doc_sha256: sha, filename: doc.filename.slice(0, 200), source: doc.source, doc_kind: cls.kind, classified_by: cls.by, read_by: readBy, vendor: reading.vendor, invoice_no: reading.invoice_no,
    total: reading.total, currency: reading.currency, status, findings: findings.map((x) => ({ code: x.code, level: x.level })) as unknown as Json,
  }, now);
  if (needsNote({ status, findings })) await writeReviewNote(db, deps.reader, id, now);
  const inv = apInvoice(db, id)!;
  await book(db, deps, inv);
  return { kind: "invoice", invoice: inv };
}

/** Raw e-mail bytes (a saved .eml, or a mailbox poller): each PDF attached is filed, with the sender and subject. */
export async function ingestEmail(db: DB, deps: InboxDeps, raw: Buffer, meta: Record<string, string> = {}, source: Source = "email"): Promise<IngestResult[]> {
  const mail = parseEml(raw);
  const results: IngestResult[] = [];
  const taken = mail.attachments.slice(0, MAX_EMAIL_ATTACHMENTS);
  if (mail.attachments.length > taken.length) {
    audit(db, "system", "ap.email_attachments_capped", null, { attached: mail.attachments.length, filed: taken.length, from: mail.from.slice(0, 200), subject: mail.subject.slice(0, 200) });
  }
  for (const a of taken) {
    // One bad attachment does not stop the others: each refusal is recorded with its reason.
    try {
      results.push(await ingestDocument(db, deps, {
        bytes: a.bytes, filename: a.filename, mime: a.mime, source,
        meta: { ...meta, from: mail.from.slice(0, 200), subject: mail.subject.slice(0, 200), date: mail.date.slice(0, 80), ...(mail.message_id ? { message_id: mail.message_id.slice(0, 200) } : {}) },
      }, 1));
    } catch (e) {
      audit(db, "system", "ap.attachment_refused", null, { filename: a.filename.slice(0, 200), reason: (e as Error).message.slice(0, 300), from: mail.from.slice(0, 200) });
    }
  }
  if (results.length === 0) audit(db, "system", "ap.email_without_pdf", null, { from: mail.from.slice(0, 200), subject: mail.subject.slice(0, 200) });
  return results;
}

/** Books an invoice's accrual once it is checked clean (sinks see each invoice once: on its first bookable status). */
async function book(db: DB, deps: Pick<InboxDeps, "sink" | "now">, inv: ApInvoiceRow): Promise<void> {
  if (!bookable(inv)) return;
  await pushOnce(db, deps.sink, "accrual", accrualEntries(inv), inv, (deps.now ?? (() => new Date()))());
}

/**
 * Checks again the invoices waiting for a supplier (after one was added) and any the caller names. An invoice already
 * on its way to payment, paid or rejected is never re-checked.
 */
export async function recheck(db: DB, deps: Pick<InboxDeps, "now" | "sink"> & { reader?: Asker }, ids?: string[]): Promise<ApInvoiceRow[]> {
  const now = (deps.now ?? (() => new Date()))();
  const targets = ids ? ids.map((id) => apInvoice(db, id)).filter((x): x is ApInvoiceRow => x !== null) : apInvoices(db, { status: "needs_vendor" });
  const out: ApInvoiceRow[] = [];
  for (const inv of targets) {
    if (!["needs_vendor", "needs_review", "blocked", "ready"].includes(inv.status)) continue;
    if (!["invoice", "credit_note", "reminder"].includes(inv.doc_kind)) continue;
    const doc = db.prepare("SELECT path, text_chars FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string; text_chars: number };
    let text: string;
    try { text = doc.text_chars ? (await pdfText(readFileSync(doc.path))).text : ""; } catch { text = ""; }
    if (!text) { out.push(inv); continue; }
    const wasBookable = bookable(inv);
    const { status, findings } = evaluate(db, inv.reading, text, { docSha: inv.doc_sha256, now, selfId: inv.id });
    const next = setStatus(db, inv.id, status, "system", { findings: [...findings, ...inv.findings.filter((x) => x.code === "credit_note" || x.code === "reminder")], reason: "checked again" }, now);
    if (!wasBookable) await book(db, deps, next);
    out.push(needsNote(next) ? await writeReviewNote(db, deps.reader, next.id, now) : next);
  }
  return out;
}

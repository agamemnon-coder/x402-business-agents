// Payables, part 1: the one way in. An upload, a watched folder, an e-mail and (later) the agent API all call
// ingestDocument; an e-mail goes through ingestEmail, which takes raw RFC 822 bytes, so a mailbox poller can feed it.
// The document is written once to <dir>/docs/<sha256>.<ext> and never changed; the ledger keeps its hash. Then it is
// read (src/ap/read.ts), checked (src/ap/checks.ts) and filed with a status and the reasons.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import { VENDOR_GL } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { skeleton } from "../policy/fraudCore.js";
import { accrualEntries, bookable, pushOnce, type BookkeepingSink } from "./books.js";
import { evaluate, statusOf } from "./checks.js";
import { docStoreOf, readDoc } from "./docStore.js";
import { classifyDocument, ruleSignals, type DocKind } from "./classify.js";
import { needsNote, writeReviewNote } from "./review.js";
import { parseApFallback } from "./reading.js";
import { parseEml } from "./eml.js";
import { isPdf, pdfText } from "./pdfText.js";
import { EXPENSE_ACCOUNTS, readDocument, type Asker } from "./read.js";
import { imageInfo, imageToPdf, readScan, scanFinding, scanRefusal, type ScanResult } from "./scan.js";
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
  // A photo (JPEG or PNG) is kept as a one-page PDF and read like a scan; its size is checked from its header first.
  const photo = isPdf(doc.bytes) ? null : imageInfo(doc.bytes);
  if (!isPdf(doc.bytes) && !photo) throw new Error(`${doc.filename} is not a PDF: only PDF invoices, photos of invoices (JPEG or PNG), or e-mails (.eml) with one attached, are taken in; nothing was filed`);
  const bytes = photo ? await imageToPdf(doc.bytes, photo) : doc.bytes;
  const meta = photo ? { ...doc.meta, original_type: photo.type, original_bytes: String(doc.bytes.length) } : doc.meta;
  const now = (deps.now ?? (() => new Date()))();
  const sha = createHash("sha256").update(bytes).digest("hex");

  const known = db.prepare("SELECT sha256 FROM ap_documents WHERE sha256 = ?").get(sha);
  if (known) {
    const inv = db.prepare("SELECT id FROM ap_invoices WHERE doc_sha256 = ?").get(sha) as { id: string } | undefined;
    audit(db, "system", "ap.duplicate_document", sha, { filename: doc.filename, source: doc.source, invoice_id: inv?.id ?? null }, now);
    return { kind: "duplicate_document", sha256: sha, invoice_id: inv?.id ?? null };
  }

  // A ledger with its own document store (src/ap/docStore.ts: a Durable Object has no folder) keeps the bytes there.
  const store = docStoreOf(db);
  const docs = join(deps.dir, "docs");
  const path = store ? store.put(sha, bytes) : join(docs, `${sha}.pdf`);
  if (!store) {
    mkdirSync(docs, { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, bytes, { flag: "wx" });
      chmodSync(path, 0o444);
    }
  }

  let text = "";
  let noText: string | undefined;
  let scan: ScanResult | null = null;
  try {
    const read = await pdfText(bytes);
    text = read.text;
    if (!text) {
      // A scan (or a photo): read by a model as pages, twice, within the limits; otherwise it waits for a person.
      const why = scanRefusal(db, deps.reader, bytes, read.pages, now);
      scan = why ? null : await readScan(db, deps.reader, bytes, sha, read.pages, EXPENSE_ACCOUNTS, now);
      if (!scan) noText = `needs a person: there is no text in this PDF (a scan)${why ? `; ${why}` : ", and no model reading of it came back"}`;
    }
  } catch (e) {
    noText = `needs a person: the PDF could not be opened (${(e as Error).message.slice(0, 120)})`;
  }

  db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, meta_json, text_chars, received_at) VALUES (?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)")
    .run(sha, doc.filename.slice(0, 200), bytes.length, path, doc.source, JSON.stringify(meta ?? {}), text.length, now.toISOString());

  // Haiku labels the document first; only an invoice, a credit note or a reminder is read in full (Sonnet). A scan
  // carries the label its two readings gave.
  const cls = scan ? { kind: scan.docKind as DocKind, by: `claude-scan:${scan.model}` } : noText ? { kind: "unread" as const, by: "none" } : await classifyDocument(db, deps.reader, text, sha);
  const readFully = cls.kind === "invoice" || cls.kind === "credit_note" || cls.kind === "reminder";
  const { reading, readBy } = scan ? { reading: scan.reading, readBy: `claude-scan:${scan.model}` } : readFully ? await readDocument(db, deps.reader, text, sha) : { reading: parseApFallback(text), readBy: "parser" };
  const id = nextApId(db);
  // A scan has no text layer: its checks run on the model's transcription of the pages (red team 6: credit-note words,
  // a bracketed total or a bank-change line on a scan were never seen by any check).
  const checkText = scan ? scan.transcription : text;
  const checked = readFully || noText ? evaluate(db, reading, checkText, { docSha: sha, now, ...(noText ? { noText } : {}) }) : notAnInvoice(cls.kind);
  const findings = [...checked.findings];
  if (scan && readFully) findings.push(scanFinding(scan));
  // The model's label or the keyword rules: either one saying credit note or reminder is enough (red team round 2: a
  // model that calls a "Gutschrift" or a reminder an invoice does not make it payable).
  const rules = readFully ? ruleSignals(checkText) : { credit_note: false, reminder: false };
  if ((cls.kind === "credit_note" || rules.credit_note) && !findings.some((x) => x.code === "credit_note")) {
    findings.push({ code: "credit_note", level: "review", detail: `a credit note${cls.kind === "credit_note" ? "" : " by its own words (whatever the model's label)"}: nothing is paid; a person sets it against this supplier's next invoice` });
  }
  if (cls.kind === "reminder" || rules.reminder) {
    // A reminder is never paid on its own: one that matches an invoice on file is blocked as its copy; one that matches
    // none goes to a person (red team D).
    const matched = findings.some((x) => x.code === "duplicate" || x.code === "possible_duplicate");
    findings.push(matched
      ? { code: "reminder", level: "warn", detail: "a payment reminder for an invoice on file: it is never paid twice" }
      : { code: "reminder", level: "review", detail: "a payment reminder that matches no invoice on file: a person finds the invoice it is about; a reminder is never paid on its own" });
  }
  const status = statusOf(findings);
  const gl = glFor(db, reading, readBy);
  // A credit note by any sign (the model's label, its own words, or a total written negative, in brackets or with CR)
  // is stored as one (red team round 4: a negative total kept the "invoice" kind and counted as money owed).
  const kind = findings.some((x) => x.code === "credit_note") && (cls.kind === "invoice" || cls.kind === "credit_note") ? "credit_note" : cls.kind;
  db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by,
    gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sha, kind, cls.by, reading.vendor, reading.invoice_no, reading.issue_date, reading.due_date, reading.currency, reading.subtotal, reading.tax, reading.total,
      reading.iban.slice(-4), reading.bic, JSON.stringify(reading), readBy, gl.account, gl.rule, AP_COST_CENTRE, status, JSON.stringify(findings), now.toISOString(), now.toISOString());
  audit(db, "system", "ap.received", id, {
    doc_sha256: sha, filename: doc.filename.slice(0, 200), source: doc.source, doc_kind: kind, classified_by: cls.by, read_by: readBy, vendor: reading.vendor, invoice_no: reading.invoice_no,
    total: reading.total, currency: reading.currency, status, findings: findings.map((x) => ({ code: x.code, level: x.level })) as unknown as Json,
  }, now);
  if (scan) {
    db.prepare("INSERT INTO ap_scan_readings (invoice_id, doc_sha256, agreed, differ_json, boxes_json, readings, model, read_at, transcription) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha, scan.agreed ? 1 : 0, JSON.stringify(scan.differ), JSON.stringify(scan.boxes), scan.readings, scan.model, now.toISOString(), scan.transcription);
  }
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
    try { text = doc.text_chars ? (await pdfText(readDoc(db, doc.path))).text : ""; } catch { text = ""; }
    // A scan has no text: it is checked again on its stored reading, with its scan finding as read.
    const scanned = text ? undefined : (db.prepare("SELECT agreed, differ_json, readings, transcription FROM ap_scan_readings WHERE invoice_id = ?").get(inv.id) as { agreed: number; differ_json: string; readings: number; transcription: string | null } | undefined);
    if (!text && !scanned) { out.push(inv); continue; }
    const wasBookable = bookable(inv);
    // A scan is checked on its transcription (red team 6); one read before transcriptions has none and needs a person.
    const { findings } = evaluate(db, inv.reading, scanned ? scanned.transcription ?? "" : text, { docSha: inv.doc_sha256, now, selfId: inv.id });
    if (scanned) findings.push(scanFinding({ agreed: scanned.agreed === 1 && !!scanned.transcription, differ: JSON.parse(scanned.differ_json) as string[], readings: scanned.readings }));
    if (scanned?.transcription) {
      const signals = ruleSignals(scanned.transcription);
      if (signals.credit_note && !findings.some((x) => x.code === "credit_note")) findings.push({ code: "credit_note", level: "review", detail: "a credit note by its own words on the page: nothing is paid; a person sets it against this supplier's next invoice" });
      if (signals.reminder && !findings.some((x) => x.code === "reminder")) findings.push({ code: "reminder", level: "review", detail: "a payment reminder by its own words on the page: a reminder is never paid on its own" });
    }
    const status = statusOf(findings);
    const kept = [...findings, ...inv.findings.filter((x) => (x.code === "credit_note" || x.code === "reminder") && !findings.some((y) => y.code === x.code))];
    if (inv.doc_kind === "invoice" && kept.some((x) => x.code === "credit_note")) db.prepare("UPDATE ap_invoices SET doc_kind = 'credit_note' WHERE id = ?").run(inv.id);
    const next = setStatus(db, inv.id, status, "system", { findings: kept, reason: "checked again" }, now);
    if (!wasBookable) await book(db, deps, next);
    out.push(needsNote(next) ? await writeReviewNote(db, deps.reader, next.id, now) : next);
  }
  return out;
}

/**
 * A person's word that an invoice waiting as a possible duplicate (the same supplier and total as an earlier one, under
 * another number) is a new invoice: monthly rent, a subscription. Kept per pair in ap_duplicate_clearances and in the
 * audit log, then the invoice is checked again; every other check still applies. Only a person ("human") may do this,
 * and never for a match on the invoice number itself (a lookalike or re-punctuated number stays with the person who
 * rejects or pays it by hand). Throws before anything changes.
 */
export function clearPossibleDuplicate(db: DB, deps: Pick<InboxDeps, "now" | "sink"> & { reader?: Asker }, id: string, by: { by: string; note: string; actor: string }): Promise<ApInvoiceRow> {
  if (by.actor !== "human") throw new Error("only a person can say an invoice is not a duplicate; an agent cannot");
  const who = by.by.trim();
  const note = by.note.trim();
  if (!who || who.length > 100) throw new Error("say who checked it (at most 100 characters)");
  if (note.length < 10 || note.length > 500) throw new Error("say why it is a new invoice (10 to 500 characters), e.g. \"monthly rent for December\"");
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no invoice ${id}`);
  if (inv.status !== "needs_review") throw new Error(`${id} is ${inv.status.replace(/_/g, " ")}, not waiting for a person`);
  const possible = inv.findings.filter((x) => x.code === "possible_duplicate");
  if (possible.length === 0) throw new Error(`${id} is not waiting as a possible duplicate`);
  if (possible.some((x) => !x.twin_of)) throw new Error(`${id} matches an earlier invoice by its number, written differently: a number match is never cleared this way; a person rejects it or pays it by hand`);
  const now = (deps.now ?? (() => new Date()))();
  const twins = possible.map((x) => x.twin_of!);
  db.transaction(() => {
    for (const twin of twins) {
      db.prepare("INSERT OR IGNORE INTO ap_duplicate_clearances (invoice_id, twin_id, cleared_by, note, cleared_at) VALUES (?, ?, ?, ?, ?)").run(id, twin, who, note, now.toISOString());
    }
    audit(db, "human", "ap.duplicate_cleared", id, { by: who, note, twins }, now);
  })();
  return recheck(db, deps, [id]).then(([next]) => next ?? apInvoice(db, id)!);
}

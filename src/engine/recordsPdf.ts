// /try's last step, "Download your test company's records" (owner, 14 Nov: the minified JSON was "ugly and poor"): the
// test company as an A4 PDF a person reads. Everything in it comes from the company's own export (exportBatch: the
// product's sync batches): its invoices with their reading, the proposals' terms hashes and the passkey approvals in the
// audit log, the payments, the journal entries and the audit log itself. Nothing is fetched, nothing is made up.
//
// Contents: a cover (the mark, the company, "Test company · test money · simulated bank", the date) with four tiles
// (invoices, paid, signed with a passkey, total paid); one card per invoice with its trail (read, checked, signed,
// paid, booked); the journal with totals per currency; the audit log as a timeline; an appendix of hashes. Every page's
// footer: page x of y, "Made-up data · test money · nothing real moved", and where the demo lives.
//
// Host-agnostic: pdfkit only, no node: import and no code built from text (the cloud's engine renders it in its
// Worker). Deterministic: the PDF's dates are the export's made_at.
import PDFDocument from "pdfkit";
import { LEDGER_ACCOUNTS } from "../ledger/accounts.js";

const INK = "#0b1220", MUTED = "#586174", FAINT = "#8a93a6", LINE = "#e3e6ec", ACCENT = "#4f46e5", OK = "#0b7d43", BAND = "#f5f6f9";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const L = 50, R = 545, W = R - L, BOTTOM = 780;

/** The export as exportBatch returns it; only the fields read here are typed. */
export interface CompanyExport {
  format: string; company: string; made_at: string;
  batches: Record<string, unknown>[];
}
interface Invoice { id: string; vendor: string; invoice_no: string; due_date: string; currency: string; total: string; status: string; doc_sha256: string; received_at: string; body?: { issue_date?: string; subtotal?: string; tax?: string; read_by?: string; proposal_id?: string | null; paid_at?: string | null; status_words?: string; findings?: { code: string; level: string; detail: string }[]; gl_account?: string } }
interface Payment { id: string; invoice_id: string; status: string; body?: { transfer_id?: string; amount?: string; currency?: string; fee_actual?: string; status?: string } }
interface Line { account: string; debit_cents: number; credit_cents: number; currency: string }
interface Entry { entry_id: number; posting_date: string; description: string; source_key: string; entry_hash: string; lines: Line[] }
interface AuditRow { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash?: string; hash?: string }
interface Doc { sha256: string; filename: string }

/** The export's records, gathered from its batches (later batches of the same kind add to earlier ones). */
export function recordsOf(x: CompanyExport): { invoices: Invoice[]; payments: Payment[]; entries: Entry[]; audit: AuditRow[]; documents: Doc[] } {
  const all = <T>(k: string) => x.batches.flatMap((b) => (Array.isArray(b[k]) ? (b[k] as T[]) : []));
  return {
    invoices: all<Invoice>("invoices"), payments: all<Payment>("payments"), entries: all<Entry>("ledger_entries").sort((a, b) => a.entry_id - b.entry_id),
    audit: all<AuditRow>("audit_rows").sort((a, b) => a.seq - b.seq), documents: all<Doc>("documents").map((d) => ({ sha256: d.sha256, filename: d.filename })),
  };
}

const cents = (s: unknown): number | null => { const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s ?? "").trim()); return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"))) : null; };
export const money = (currency: string, c: number) => `${currency} ${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-US")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const day = (iso: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "")); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—"; };
const time = (iso: string) => String(iso).slice(11, 19);
const short = (h: string | null | undefined) => (h ? `${h.slice(0, 12)}…` : "—");
const payload = (r: AuditRow): Record<string, unknown> => { try { const p = JSON.parse(r.payload_json) as unknown; return p && typeof p === "object" ? (p as Record<string, unknown>) : {}; } catch { return {}; } };
const modelName = (id: string) => { const x = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?/.exec(id); return x ? `Claude ${x[1]![0]!.toUpperCase()}${x[1]!.slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ""}` : "Claude"; };
/** Who read an invoice, from its read_by ("parser", "claude:<model>", "claude-scan:<model>"). */
export const readBy = (v: string | undefined) => (!v || v === "parser" || v === "none" ? "Purser's code (the parser)" : /claude/.test(v) ? modelName(v.split(":")[1] ?? "") : v);

/** The audit log's events in words (a short line each); any other event is its name in plain words. */
const EVENT_WORDS: Record<string, string> = {
  "treasury.seeded": "The test treasury was funded with test money",
  "setting.changed": "A treasury setting was set",
  "ap.received": "An invoice came in, was read and checked",
  "ap.status": "An invoice's status changed",
  "ap.review_note": "A note for a person was added",
  "ap.duplicate_document": "The same file came in again; nothing was added",
  "passkey.enrolment_opened": "A window opened to set up the approval passkey",
  "passkey.pending": "A new passkey came in",
  "passkey.enrolled": "The approval passkey was set up",
  "fx.rate_checked": "The exchange rate was checked",
  "policy.version": "The CFO's policy was recorded",
  "proposal.created": "A payment was filed for approval",
  "proposal.approved": "The CFO signed the exact terms with the passkey",
  "proposal.executing": "The signed payment started",
  "proposal.executed": "The signed payment was made",
  "fx.converted": "Currency was converted on the simulated bank",
  "transfer.created": "A transfer was created on the simulated bank",
  "transfer.status": "A transfer's status changed",
  "transfer.fee": "The transfer's fee was recorded",
  "vault.filed": "The documents were filed in the archive",
  "claude.read": "Claude answered",
  "claude.asking": "Claude was asked",
  "claude.fallback": "Purser's code read it; no model answer was used",
  "claude.capped": "Claude was not asked; Purser's code read and decided",
  "ap.checker_decided": "The Checker agent decided",
  "ap.coded": "The Coder agent coded the invoice",
  "ap.payer_proposed": "The Payer agent proposed how to pay",
};
export const eventWords = (r: AuditRow): string => {
  const p = payload(r);
  const base = EVENT_WORDS[r.event] ?? r.event.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
  const to = typeof p.to === "string" ? p.to : typeof p.status === "string" && /^(ap\.received|transfer\.status)$/.test(r.event) ? p.status : "";
  return to && /^[a-z_A-Z]{1,24}$/.test(to) ? `${base}: ${to.replace(/_/g, " ").toLowerCase()}` : base;
};

/** The figures of the cover's tiles. */
export function summaryOf(x: CompanyExport): { invoices: number; paid: number; signed: number; totals: { currency: string; cents: number }[] } {
  const r = recordsOf(x);
  const paid = r.payments.filter((p) => String(p.body?.status ?? p.status).toUpperCase() === "PAID");
  const by = new Map<string, number>();
  for (const p of paid) { const c = cents(p.body?.amount); const cur = p.body?.currency ?? ""; if (c !== null && cur) by.set(cur, (by.get(cur) ?? 0) + c); }
  return {
    invoices: r.invoices.length, paid: r.invoices.filter((i) => i.status === "paid").length,
    signed: r.audit.filter((a) => a.event === "proposal.approved" && payload(a).method === "passkey").length,
    totals: [...by.entries()].map(([currency, c]) => ({ currency, cents: c })),
  };
}

/** The mark (docs/assets/brand/purser-mark.svg): the dark tile and the white feather, drawn at `size` points. */
function mark(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  const s = size / 30;
  doc.save().roundedRect(x, y, size, size, 9 * s).fill(INK);
  doc.translate(x + 7 * s, y + 7 * s).scale(0.6666667 * s).lineWidth(2).lineCap("round").lineJoin("round").strokeColor("#ffffff");
  doc.path("M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z").stroke();
  doc.path("M16 8 2 22").stroke().path("M17.5 15H9").stroke();
  doc.restore();
}

/** The company's records as an A4 PDF. `site` is where the demo lives (the footer's address). */
export function recordsPdf(x: CompanyExport, site: string): Promise<Buffer> {
  const at = new Date(x.made_at);
  const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: L, right: 50 }, bufferPages: true,
    info: { Title: `Company records: ${x.company}`, Author: "Purser", Subject: "Test company · test money · simulated bank", Creator: "Purser", Producer: "Purser", CreationDate: at, ModDate: at } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const r = recordsOf(x), sum = summaryOf(x);
  let y = 50;
  const room = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = 50; } };
  const heading = (t: string, sub?: string) => {
    room(60);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(t, L, y, { width: W });
    y = doc.y + 2;
    if (sub) { doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(sub, L, y, { width: W }); y = doc.y; }
    y += 10;
  };

  // The cover.
  mark(doc, L, y, 34);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("Purser", L + 44, y + 9);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(day(x.made_at), L, y + 12, { width: W, align: "right" });
  y += 70;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text("COMPANY RECORDS", L, y, { characterSpacing: 1.2 });
  y = doc.y + 6;
  doc.font("Helvetica-Bold").fontSize(26).fillColor(INK).text(x.company, L, y, { width: W });
  y = doc.y + 6;
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Test company · test money · simulated bank", L, y, { width: W });
  y = doc.y + 4;
  doc.fontSize(9).fillColor(FAINT).text(`Made ${day(x.made_at)}, ${time(x.made_at)} UTC, from this company's own records.`, L, y, { width: W });
  y = doc.y + 24;
  const tiles: [string, string][] = [
    ["Invoices", String(sum.invoices)], ["Paid", String(sum.paid)], ["Signed with a passkey", String(sum.signed)],
    ["Total paid", sum.totals.length ? sum.totals.map((t) => money(t.currency, t.cents)).join(" + ") : "—"],
  ];
  const tw = (W - 3 * 10) / 4;
  tiles.forEach(([k, v], i) => {
    const tx = L + i * (tw + 10);
    doc.roundedRect(tx, y, tw, 64, 8).fillAndStroke(BAND, LINE);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(k, tx + 10, y + 10, { width: tw - 20 });
    doc.font("Helvetica-Bold").fontSize(i === 3 ? 12 : 20).fillColor(INK).text(v, tx + 10, y + (i === 3 ? 34 : 30), { width: tw - 20 });
  });
  y += 88;

  // The invoices, each with its trail.
  heading("Invoices", "Each invoice as Purser holds it, and every step it went through.");
  for (const inv of r.invoices) {
    const b = inv.body ?? {};
    const pay = r.payments.find((p) => p.invoice_id === inv.id);
    const pid = b.proposal_id ?? null;
    const created = pid ? r.audit.find((a) => a.event === "proposal.created" && a.subject === pid) : undefined;
    const approved = pid ? r.audit.find((a) => a.event === "proposal.approved" && a.subject === pid) : undefined;
    const received = r.audit.find((a) => a.event === "ap.received" && a.subject === inv.id);
    const booked = r.entries.filter((e) => e.source_key === `ap-accrual|${inv.id}` || (pay && e.source_key.startsWith(`transfer|${pay.id}|`)));
    const findings = (b.findings ?? []).map((f) => f.detail).filter(Boolean);
    // Paid without a payment of its own: the engine's reason, as its log has it (a test company starts with one invoice
    // marked paid before it began: no money moved, nothing signed, nothing booked).
    const paidRow = r.audit.find((a) => a.event === "ap.status" && a.subject === inv.id && payload(a).to === "paid");
    const markedPaid = inv.status === "paid" && !pay && paidRow ? String(payload(paidRow).reason ?? "").replace(/^seeded:\s*/, "") : "";
    const terms = String((approved ? payload(approved).terms_sha256 : undefined) ?? (created ? payload(created).terms_sha256 : "") ?? "");
    const steps: [boolean, string, string][] = [
      [true, `Read by ${readBy(b.read_by)}`, day(inv.received_at)],
      [!!received, findings.length ? `Checked by Purser's code: ${findings[0]}` : `Checked by Purser's code: ${String(received ? payload(received).status ?? "" : "").replace(/_/g, " ") || "checked"}`, received ? day(received.ts) : "—"],
      [!!approved, approved ? `Signed with the passkey · terms ${short(terms)}` : markedPaid ? "Not signed here" : "Not signed yet", approved ? `${day(approved.ts)} ${time(approved.ts)}` : ""],
      [String(pay?.body?.status ?? "").toUpperCase() === "PAID", pay ? `Paid on the simulated bank: ${pay.body?.amount ? money(pay.body.currency ?? inv.currency, cents(pay.body.amount) ?? 0) : ""}${pay.body?.fee_actual ? `, fee ${pay.body.fee_actual}` : ""}` : markedPaid ? `Marked paid: ${markedPaid}` : "Not paid yet", b.paid_at ? day(b.paid_at) : ""],
      [booked.length > 0, booked.length ? `Booked in the ledger: entries ${booked.map((e) => `#${e.entry_id}`).join(", ")}` : markedPaid ? "Not booked here" : "Not booked yet", ""],
    ];
    const h = 98 + steps.length * 16;
    room(h);
    doc.roundedRect(L, y, W, h - 12, 8).fillAndStroke("#ffffff", LINE);
    const top = y + 12;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(inv.vendor, L + 14, top, { width: 300 });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Invoice ${inv.invoice_no} · ${inv.id}`, L + 14, doc.y + 1, { width: 300 });
    const st = b.status_words ?? inv.status;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(inv.status === "paid" ? OK : ACCENT).text(st.toUpperCase(), L + 300, top + 2, { width: W - 314, align: "right", characterSpacing: 0.6 });
    const total = cents(inv.total) ?? 0, net = cents(b.subtotal), vat = cents(b.tax);
    const facts: [string, string][] = [["Issued", day(b.issue_date)], ["Due", day(inv.due_date)], ["Net", net === null ? "—" : money(inv.currency, net)], ["VAT", vat === null ? "—" : money(inv.currency, vat)], ["Total", money(inv.currency, total)]];
    const fw = (W - 28) / facts.length;
    facts.forEach(([k, v], i) => {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(k, L + 14 + i * fw, top + 36, { width: fw - 6 });
      doc.font(k === "Total" ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(v, L + 14 + i * fw, top + 48, { width: fw - 6 });
    });
    let sy = top + 74;
    steps.forEach(([ok, words, when], i) => {
      doc.circle(L + 22, sy + 4, 4).fill(ok ? OK : LINE);
      if (i < steps.length - 1) doc.moveTo(L + 22, sy + 9).lineTo(L + 22, sy + 15).strokeColor(LINE).lineWidth(1).stroke();
      doc.font("Helvetica").fontSize(9).fillColor(ok ? INK : FAINT).text(words, L + 34, sy, { width: W - 150, lineBreak: false, ellipsis: true, height: 11 });
      doc.fillColor(FAINT).text(when, R - 120, sy, { width: 106, align: "right" });
      sy += 16;
    });
    y += h;
  }
  if (!r.invoices.length) { doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("No invoices yet.", L, y); y = doc.y + 10; }

  // The journal.
  y += 8;
  heading("Journal", "Every entry in this company's ledger, line by line. Debits equal credits per currency.");
  const cols = [L, L + 62, L + 100, L + 290, L + 390, R];
  const row = (cells: string[], o: { bold?: boolean; color?: string; band?: boolean } = {}) => {
    room(16);
    if (o.band) doc.rect(L, y - 3, W, 16).fill(BAND);
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(o.color ?? INK);
    cells.forEach((c, i) => doc.text(c, cols[i]!, y, { width: cols[i + 1]! - cols[i]! - 6, align: i >= 3 ? "right" : "left", lineBreak: false, ellipsis: true, height: 11 }));
    y += 15;
  };
  row(["Date", "Entry", "Account", "Debit", "Credit"], { bold: true, color: MUTED });
  doc.moveTo(L, y - 2).lineTo(R, y - 2).strokeColor(LINE).lineWidth(1).stroke();
  const totals = new Map<string, { d: number; c: number }>();
  for (const e of r.entries) {
    room(16);
    doc.rect(L, y - 3, W, 16).fill(BAND);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK);
    doc.text(day(e.posting_date), cols[0]!, y, { width: 56, lineBreak: false });
    doc.text(`#${e.entry_id}`, cols[1]!, y, { width: 32, lineBreak: false });
    doc.text(e.description, cols[2]!, y, { width: R - cols[2]!, lineBreak: false, ellipsis: true, height: 11 });
    y += 15;
    for (const l of e.lines) {
      const t = totals.get(l.currency) ?? { d: 0, c: 0 }; t.d += l.debit_cents; t.c += l.credit_cents; totals.set(l.currency, t);
      const name = (LEDGER_ACCOUNTS[l.account] ?? "").replace(/\s*\(.*\)$/, "");
      row(["", "", `${l.account} ${name}`, l.debit_cents ? money(l.currency, l.debit_cents) : "", l.credit_cents ? money(l.currency, l.credit_cents) : ""]);
    }
  }
  if (!r.entries.length) { doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("No entries yet: nothing has been paid or booked.", L, y); y = doc.y + 8; }
  doc.moveTo(L, y - 2).lineTo(R, y - 2).strokeColor(INK).lineWidth(0.8).stroke();
  for (const [cur, t] of totals) row(["", "", `Total ${cur}${t.d === t.c ? " · balanced" : " · NOT balanced"}`, money(cur, t.d), money(cur, t.c)], { bold: true, color: t.d === t.c ? INK : "#c5363c" });

  // The audit log.
  y += 14;
  heading("Audit log", "Every step Purser recorded, in order. Each row is chained to the one before it by its hash.");
  for (const a of r.audit) {
    room(16);
    doc.font("Helvetica").fontSize(8).fillColor(FAINT).text(`${day(a.ts)} ${time(a.ts)}`, L, y, { width: 92 });
    doc.circle(L + 100, y + 3.5, 2.5).fill(ACCENT);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(a.actor, L + 110, y, { width: 80, lineBreak: false, ellipsis: true, height: 11 });
    doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(eventWords(a), L + 192, y, { width: 220, lineBreak: false, ellipsis: true, height: 11 });
    doc.fontSize(7.5).fillColor(FAINT).text(a.subject ?? "", L + 416, y + 0.5, { width: W - 416, align: "right", lineBreak: false, ellipsis: true, height: 11 });
    y += 15;
  }

  // The appendix: the hashes, short and in full.
  doc.addPage(); y = 50;
  heading("Appendix: fingerprints", "The SHA-256 of each document, each signed payment's terms and the ledger's newest entry. Any change to what they cover changes them.");
  const hashRow = (what: string, h: string) => {
    room(34);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(what, L, y, { width: 330, lineBreak: false, ellipsis: true, height: 11 });
    doc.font("Courier-Bold").fontSize(9).fillColor(ACCENT).text(short(h), L + 340, y, { width: W - 340, align: "right" });
    doc.font("Courier").fontSize(6.5).fillColor(MUTED).text(h, L, y + 13, { width: W });
    y += 30;
  };
  for (const d of r.documents) hashRow(`Document: ${d.filename}`, d.sha256);
  for (const a of r.audit.filter((v) => v.event === "proposal.approved")) { const t = payload(a).terms_sha256; if (typeof t === "string") hashRow(`Terms signed for ${a.subject ?? "a payment"}`, t); }
  const head = r.entries.at(-1);
  if (head?.entry_hash) hashRow(`Ledger: entry #${head.entry_id}, the newest`, head.entry_hash);
  if (!r.documents.length && !head) { doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Nothing to fingerprint yet.", L, y); }

  // The footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, 806).lineTo(R, 806).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(FAINT);
    doc.text(`Page ${i + 1} of ${range.count}`, L, 814, { width: 80, lineBreak: false });
    doc.text("Made-up data · test money · nothing real moved", L + 80, 814, { width: W - 240, align: "center", lineBreak: false });
    doc.fillColor(ACCENT).text(site, R - 160, 814, { width: 160, align: "right", lineBreak: false, link: site });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

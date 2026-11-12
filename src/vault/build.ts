// Filing into the vault (docs/superpowers/specs/2026-11-08-vault-design.md). Plans every document the books hold, then
// writes what is new: the original invoices byte for byte, payment receipts, month reports and VAT overviews for closed
// periods, the year report after the year close, and the suppliers list. Each document has a key and the hash of the
// data it was made from; the same data is never filed twice, and changed data is filed as a correction beside the
// original. Nothing in the vault is overwritten or deleted, except each year's index.json, which lists every file.

import { readFileSync } from "node:fs";
import { COMPANY } from "../config/brand.js";
import type { DB } from "../db/open.js";
import { audit } from "../audit/log.js";
import { signedTerms } from "../policy/approvals.js";
import { closedPeriods, dataSha, invoiceDocs, monthData, receipts, suppliersData, vatData, yearData } from "./data.js";
import { correctionName, invoicePath, monthExportPath, monthPackPath, monthReportPath, paymentPath, suppliersPath, vatPath, withId, yearIndexPath, yearReportPath } from "./layout.js";
import { monthPackPdf, monthReportPdf, receiptPdf, suppliersPdf, vatPdf, yearReportPdf, type Lang } from "./pdf.js";
import { accountantCsv, accountantExport, accountantJson } from "../ledger/accountantExport.js";
import { monthPack } from "../ledger/pack.js";
import { LocalSink, sha256, type VaultSink } from "./sink.js";

export type VaultKind = "invoice" | "receipt" | "month" | "pack" | "export" | "vat" | "year" | "suppliers";

export interface IndexEntry { path: string; sha256: string; bytes: number; kind: VaultKind; key: string; data_sha256: string; added_at: string }
export interface YearIndex { company: string; year: number; note: string; files: IndexEntry[] }

export interface VaultOptions { company?: string; lang?: Lang; dryRun?: boolean; now?: Date; today?: string }
export interface VaultAction { path: string; kind: VaultKind; key: string; sha256: string; correction: boolean }

interface Planned { kind: VaultKind; key: string; year: number; base: string; dataSha: string; id?: string; mime?: string; produce: () => Promise<Buffer> }

const INDEX_NOTE = "Every file in this year of the Purser vault, with its sha256. Files are added, never replaced or deleted; a changed document is filed beside the original as a correction.";

/** A receipt the vault does not file: the payment's stored terms are no longer the terms the CFO signed. */
export interface RefusedReceipt { key: string; proposal_id: string; reason: string }

function plan(db: DB, company: string, lang: Lang, today: string, now: Date): { items: Planned[]; refused: RefusedReceipt[] } {
  const out: Planned[] = [];
  const refused: RefusedReceipt[] = [];
  for (const d of invoiceDocs(db)) {
    out.push({ kind: "invoice", key: d.key, id: d.id, year: Number(d.date.slice(0, 4)), base: invoicePath(company, d), dataSha: d.doc_sha256, produce: () => {
      const bytes = readFileSync(d.doc_path);
      if (sha256(bytes) !== d.doc_sha256) throw new Error(`the stored document of ${d.id} does not match the hash on record (${d.doc_sha256.slice(0, 12)}…); it is not filed`);
      return Promise.resolve(bytes);
    } });
  }
  for (const r of receipts(db)) {
    // A receipt shows the amount, the payee and the currency from the proposal's terms. It is filed only while those
    // terms still hash to what the CFO approved: the same hash the executor checked before it paid.
    const signed = signedTerms(db, r.proposal_id);
    if (!signed.ok) { refused.push({ key: r.key, proposal_id: r.proposal_id, reason: signed.reason }); continue; }
    const day = r.paid_at.slice(0, 10);
    out.push({ kind: "receipt", key: r.key, id: r.id, year: Number(day.slice(0, 4)), base: paymentPath(company, { vendor: r.vendor, invoice_no: r.invoice_no, date: day }), dataSha: dataSha(r), produce: () => receiptPdf(company, r, lang) });
  }
  const closed = closedPeriods(db);
  for (const m of closed.months) {
    const d = monthData(db, m);
    out.push({ kind: "month", key: d.key, year: Number(m.slice(0, 4)), base: monthReportPath(company, m), dataSha: dataSha(d), produce: () => monthReportPdf(company, d, lang) });
    // The month pack and the accountant's export of the month's journal (closing a month). The export's data is the
    // month's entries and the period; the chain check in its JSON changes with every later entry, so it is left out.
    const pack = monthPack(db, m);
    out.push({ kind: "pack", key: `pack:${m}`, year: Number(m.slice(0, 4)), base: monthPackPath(company, m), dataSha: dataSha(pack), produce: () => monthPackPdf(company, pack, lang) });
    const x = accountantExport(db, m);
    const xSha = dataSha({ month: x.month, period: x.period, entries: x.entries });
    out.push({ kind: "export", key: `export-csv:${m}`, year: Number(m.slice(0, 4)), base: monthExportPath(company, m, "csv"), dataSha: xSha, mime: "text/csv", produce: () => Promise.resolve(Buffer.from(accountantCsv(x))) });
    out.push({ kind: "export", key: `export-json:${m}`, year: Number(m.slice(0, 4)), base: monthExportPath(company, m, "json"), dataSha: xSha, mime: "application/json", produce: () => Promise.resolve(Buffer.from(accountantJson(x, now))) });
  }
  for (const q of closed.quarters) {
    const d = vatData(db, q);
    out.push({ kind: "vat", key: d.key, year: Number(q.slice(0, 4)), base: vatPath(company, q), dataSha: dataSha(d), produce: () => vatPdf(company, d, lang) });
  }
  for (const y of closed.years) {
    const d = yearData(db, y);
    out.push({ kind: "year", key: d.key, year: y, base: yearReportPath(company, y), dataSha: dataSha(d), produce: () => yearReportPdf(company, d, lang) });
  }
  const s = suppliersData(db);
  if (s.rows.length) out.push({ kind: "suppliers", key: s.key, year: Number(today.slice(0, 4)), base: suppliersPath(company, today), dataSha: dataSha(s.rows), produce: () => suppliersPdf(company, s, today, lang) });
  return { items: out, refused };
}

async function loadIndex(sink: VaultSink, company: string, year: number): Promise<YearIndex> {
  const text = await sink.readIndex(yearIndexPath(company, year));
  return text ? (JSON.parse(text) as YearIndex) : { company, year, note: INDEX_NOTE, files: [] };
}

/**
 * Files everything new into the vault. With dryRun, returns what it would add and writes nothing. `refused`: receipts
 * not filed because their payment's terms changed after the CFO signed them (each recorded once in the audit log).
 */
export async function syncVault(db: DB, sink: VaultSink, opts: VaultOptions = {}): Promise<{ added: VaultAction[]; unchanged: number; refused: RefusedReceipt[] }> {
  const company = opts.company ?? process.env.KIT11_COMPANY ?? COMPANY;
  const now = opts.now ?? new Date();
  const today = opts.today ?? now.toISOString().slice(0, 10);
  const { items, refused } = plan(db, company, opts.lang ?? "nl", today, now);
  const indexes = new Map<number, YearIndex>();
  for (const y of new Set(items.map((i) => i.year))) indexes.set(y, await loadIndex(sink, company, y));
  const changed = new Set<number>();
  const added: VaultAction[] = [];
  let unchanged = 0;

  for (const it of items) {
    const index = indexes.get(it.year)!;
    const earlier = index.files.filter((f) => f.key === it.key);
    // The suppliers list is a snapshot per day: the latest one, wherever it was filed, decides whether it changed.
    if (earlier.length && earlier[earlier.length - 1]!.data_sha256 === it.dataSha) { unchanged += 1; continue; }
    const bytes = await it.produce();
    const hash = sha256(bytes);
    const taken = (p: string) => index.files.some((f) => f.path === p) || added.some((a) => a.path === p);
    let path = earlier.some((f) => f.path === it.base) || (it.kind === "suppliers" && earlier.length) ? correctionName(it.base, earlier.length) : it.base;
    // Another document already under this name: the payables id beside it (an invoice or receipt), or the next correction.
    if (taken(path) && !earlier.length && it.id) path = withId(path, it.id);
    for (let n = earlier.length + 1; taken(path); n += 1) path = correctionName(it.base, n);
    const there = opts.dryRun ? null : await sink.stat(path);
    if (there && there.sha256 !== null && there.sha256 !== hash) throw new Error(`${path} is already in the vault with other content; nothing is overwritten`);
    if (!there && !opts.dryRun) await sink.create(path, bytes, hash, it.mime ?? "application/pdf");
    const entry: IndexEntry = { path, sha256: hash, bytes: bytes.length, kind: it.kind, key: it.key, data_sha256: it.dataSha, added_at: now.toISOString() };
    index.files.push(entry);
    changed.add(it.year);
    added.push({ path, kind: it.kind, key: it.key, sha256: hash, correction: earlier.length > 0 });
  }

  if (!opts.dryRun) {
    for (const y of changed) {
      const index = indexes.get(y)!;
      index.files.sort((a, b) => a.path.localeCompare(b.path) || a.added_at.localeCompare(b.added_at));
      await sink.writeIndex(yearIndexPath(company, y), `${JSON.stringify(index, null, 2)}\n`);
    }
    if (added.length) audit(db, "system", "vault.filed", sink.name, { files: added.length, corrections: added.filter((a) => a.correction).length }, now);
    for (const r of refused) {
      if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'vault.receipt_refused' AND subject = ? AND json_extract(payload_json, '$.reason') = ?").get(r.key, r.reason)) continue;
      audit(db, "system", "vault.receipt_refused", r.key, { proposal_id: r.proposal_id, reason: r.reason, note: "no receipt is filed for this payment, not even as a correction; a person checks it against what the CFO signed" }, now);
    }
  }
  return { added, unchanged, refused };
}

/** Re-hashes every file listed in the given years' index against the store. */
export async function verifyVault(sink: VaultSink, company: string, years: number[]): Promise<{ checked: number; bad: { path: string; problem: string }[] }> {
  const bad: { path: string; problem: string }[] = [];
  let checked = 0;
  for (const y of years) {
    const text = await sink.readIndex(yearIndexPath(company, y));
    if (!text) continue;
    for (const f of (JSON.parse(text) as YearIndex).files) {
      checked += 1;
      const bytes = sink.read ? await sink.read(f.path) : null;
      if (bytes) { if (sha256(bytes) !== f.sha256) bad.push({ path: f.path, problem: "hash differs" }); continue; }
      const s = await sink.stat(f.path);
      if (!s) bad.push({ path: f.path, problem: "missing" });
      else if (s.sha256 && s.sha256 !== f.sha256) bad.push({ path: f.path, problem: "hash differs" });
      else if (!s.sha256 && s.bytes !== f.bytes) bad.push({ path: f.path, problem: "size differs (the store gives no sha256)" });
    }
  }
  return { checked, bad };
}

/** The payables and ledger CLIs file into the local vault after they change something, unless KIT11_VAULT=off. A
 *  vault failure is logged and never stops them. */
export async function fileIntoLocalVault(db: DB, env = process.env): Promise<string> {
  if (env.KIT11_VAULT === "off") return "vault: off (KIT11_VAULT=off)";
  try {
    const r = await syncVault(db, new LocalSink(env.KIT11_VAULT_DIR ?? "data/vault"));
    return `vault: ${r.added.length} new file(s) in ${env.KIT11_VAULT_DIR ?? "data/vault"}`;
  } catch (e) {
    audit(db, "system", "vault.failed", "local", { error: (e as Error).message });
    return `vault: not filed (${(e as Error).message})`;
  }
}

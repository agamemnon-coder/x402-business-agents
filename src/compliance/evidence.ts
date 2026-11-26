// Continuous compliance evidence (27 Nov): for a period, per control of the map (./controls.ts), the concrete records in
// the ledger that show the control ran: counts, the audit rows (seq, time, event, subject, row hash) and the table rows
// (the cited columns and each row's SHA-256); then the map with what stands behind each requirement in the period, a
// summary per framework, and a manifest of every file's SHA-256 signed with Ed25519 by the audit checkpoint key, signed
// and verified with the audit pack's own code (src/audit/pack.ts signManifest, manifestSignatureChecks).
//
// The period's audit rows are the audit pack's (periodAuditRows): the same run of the chain, verified from the genesis
// hash first, so given the pack of the same period the verifier checks that every cited row is in it, hash for hash.
// Only what the audit pack already carries leaves the ledger: never a payload, never a secret or a token (only ids),
// never a card number, never a person's name from a table. Nothing in the output depends on the time it was made: the
// same ledger and period give the same files, byte for byte (Ed25519 signatures are deterministic).
//
// What it is: evidence that controls ran, mapped to requirements. What it is not: an audit, an attestation or a
// certificate (HONEST_LINE).

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { DB } from "../db/open.js";
import { keyIdOf, rawPublicKey } from "../audit/checkpoint.js";
import type { AuditRowStored } from "../audit/log.js";
import { manifestSignatureChecks, periodAuditRows, rowSha256, signManifest, verifyAuditPack, type AuditPack, type PackCheck, type PackResult, type PackSigner } from "../audit/pack.js";
import { sha256Hex } from "../lib/terms.js";
import { CONTROLS, FRAMEWORKS, HONEST_LINE, REQUIREMENTS, type Control, type FrameworkId, type LedgerEvidence, type Status } from "./controls.js";

export const COMPLIANCE_EVIDENCE_FORMAT = "purser.compliance-evidence/v1";
export const EVIDENCE_NOTE = `Purser compliance evidence: per control, the records in the ledger that show it ran in the period. ${HONEST_LINE} `
  + "Check it with `npm run verify-compliance-evidence -- <dir> --trust <public key> --audit-pack <audit pack of the same period>`.";

const MANIFEST = "manifest.json";

export interface AuditRef { seq: number; ts: string; event: string; subject: string | null; row_hash: string }
export interface ChainRef { first_seq: number; last_seq: number; rows: number; before: { seq: number; head: string }; head: string }
export interface TableRecords { table: string; at: string; present: boolean; rows: number; records: Record<string, string | number | null>[] }

/** What one control's file holds. */
export interface ControlEvidence {
  control: string;
  name: string;
  period: { from: string; to: string };
  status: "records-in-period" | "no-records-in-period" | "documented";
  how: string;
  code: string[];
  docs: string[];
  requirements: string[];
  records: number;
  audit: null | { events: string[]; patterns: string[]; scoped: { event: string; subject: string }[]; rows: number; by_event: Record<string, number>; records: AuditRef[] };
  tables: TableRecords[];
  chain: ChainRef | null;
}

export type InPeriod = "evidence-in-period" | "no-records-in-period" | "documented" | "gap";
export interface MappedRequirement { framework: FrameworkId; clause: string; scope: string | null; requirement: string; controls: string[]; status: Status; gap: string | null; in_period: InPeriod; records: number }

export interface FrameworkSummary { framework: FrameworkId; name: string; requirements: number; evidence_in_period: number; no_records_in_period: number; documented: number; gap: number }
export interface EvidenceSummary {
  format: typeof COMPLIANCE_EVIDENCE_FORMAT;
  note: string;
  period: { from: string; to: string };
  audit: ChainRef;
  frameworks: FrameworkSummary[];
  controls: { id: string; name: string; status: ControlEvidence["status"]; records: number }[];
}

export interface EvidenceManifest {
  format: typeof COMPLIANCE_EVIDENCE_FORMAT;
  period: { from: string; to: string };
  audit: ChainRef;
  files: { path: string; bytes: number; sha256: string }[];
  key_id: string;
  public_key: string;
}

/** The files of the evidence, by path (POSIX, relative to its directory), as text. */
export interface ComplianceEvidence { files: Record<string, string>; summary: EvidenceSummary }

const json = (x: unknown): string => `${JSON.stringify(x, null, 1)}\n`;
const sorted = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function matcher(e: LedgerEvidence): (r: AuditRowStored) => boolean {
  const events = new Set(e.events);
  const patterns = e.patterns.map((p) => new RegExp(p));
  const scoped = e.scoped.map((s) => ({ event: s.event, subject: new RegExp(s.subject) }));
  return (r) => events.has(r.event) || patterns.some((p) => p.test(r.event)) || scoped.some((s) => s.event === r.event && r.subject !== null && s.subject.test(r.subject));
}

const tableExists = (db: DB, table: string): boolean => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not a column or table name: ${s}`); return `"${s}"`; };

function tableRecords(db: DB, t: LedgerEvidence["tables"][number], start: number, end: number): TableRecords {
  if (!tableExists(db, t.table)) return { table: t.table, at: t.at, present: false, rows: 0, records: [] };
  // Rows are compared by their instant, not their text: a time column holds ISO strings written by the code.
  const all = db.prepare(`SELECT * FROM ${ident(t.table)} ORDER BY ${ident(t.at)}, rowid`).all() as Record<string, string | number | null>[];
  const records = all.filter((r) => { const ms = Date.parse(String(r[t.at])); return ms >= start && ms < end; })
    .map((r) => ({ ...Object.fromEntries([t.at, ...t.cite].map((c) => [c, r[c] ?? null])), row_sha256: rowSha256(r) }));
  return { table: t.table, at: t.at, present: true, rows: records.length, records };
}

function controlEvidence(db: DB, c: Control, period: { from: string; to: string }, rows: AuditRowStored[], chain: ChainRef, start: number, end: number): ControlEvidence {
  const requirements = REQUIREMENTS.filter((r) => r.controls.includes(c.id)).map((r) => `${r.framework} ${r.clause}${r.scope ? ` (${r.scope})` : ""}`);
  const base = { control: c.id, name: c.name, period, how: c.evidence?.how ?? "documented only: nothing per period to count", code: c.code, docs: c.docs, requirements };
  const e = c.evidence;
  if (!e) return { ...base, status: "documented", records: 0, audit: null, tables: [], chain: null };
  const match = matcher(e);
  const cited: AuditRef[] = rows.filter(match).map((r) => ({ seq: r.seq, ts: r.ts, event: r.event, subject: r.subject, row_hash: r.row_hash }));
  const byEvent: Record<string, number> = {};
  for (const r of cited) byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;
  const tables = e.tables.map((t) => tableRecords(db, t, start, end));
  const records = cited.length + tables.reduce((n, t) => n + t.rows, 0) + (e.chain ? chain.rows : 0);
  return {
    ...base, status: records > 0 ? "records-in-period" : "no-records-in-period", records,
    audit: { events: e.events, patterns: e.patterns, scoped: e.scoped, rows: cited.length, by_event: sorted(byEvent), records: cited },
    tables, chain: e.chain ? chain : null,
  };
}

/** What stands behind a requirement in the period: its status, and for one with ledger evidence, whether any record does. */
function mapRequirements(requirements: readonly { framework: FrameworkId; clause: string; scope?: string | null; requirement: string; controls: string[]; status: Status; gap?: string | null }[], controls: Map<string, ControlEvidence>): MappedRequirement[] {
  return requirements.map((r) => {
    const ledger = r.controls.map((id) => controls.get(id)).filter((c): c is ControlEvidence => c !== undefined && c.status !== "documented");
    const seqs = new Set(ledger.flatMap((c) => (c.audit?.records ?? []).map((x) => x.seq)));
    const chainRows = ledger.some((c) => c.chain) ? ledger.find((c) => c.chain)!.chain!.rows : 0;
    const records = Math.max(seqs.size, chainRows) + ledger.reduce((n, c) => n + c.tables.reduce((m, t) => m + t.rows, 0), 0);
    const in_period: InPeriod = r.status === "gap" ? "gap" : r.status === "documented" ? "documented" : records > 0 ? "evidence-in-period" : "no-records-in-period";
    return { framework: r.framework, clause: r.clause, scope: r.scope ?? null, requirement: r.requirement, controls: r.controls, status: r.status, gap: r.gap ?? null, in_period, records: r.status === "evidence-in-ledger" ? records : 0 };
  });
}

function summarise(period: { from: string; to: string }, audit: ChainRef, mapped: { framework: string; in_period: string }[], controls: ControlEvidence[]): EvidenceSummary {
  return {
    format: COMPLIANCE_EVIDENCE_FORMAT, note: EVIDENCE_NOTE, period, audit,
    frameworks: FRAMEWORKS.map((f) => {
      const rows = mapped.filter((r) => r.framework === f.id);
      const n = (s: InPeriod) => rows.filter((r) => r.in_period === s).length;
      return { framework: f.id, name: f.name, requirements: rows.length, evidence_in_period: n("evidence-in-period"), no_records_in_period: n("no-records-in-period"), documented: n("documented"), gap: n("gap") };
    }),
    controls: controls.map((c) => ({ id: c.control, name: c.name, status: c.status, records: c.records })),
  };
}

/** The evidence of a period before it is written and signed. */
function evidenceOf(db: DB, period: { from: string; to: string }) {
  const { start, end, rows, before, beforeHead } = periodAuditRows(db, period);
  const p = { from: period.from, to: period.to };
  const chain: ChainRef = { first_seq: before.length + 1, last_seq: before.length + rows.length, rows: rows.length, before: { seq: before.length, head: beforeHead }, head: rows.length ? rows[rows.length - 1]!.row_hash : beforeHead };
  const controls = CONTROLS.map((c) => controlEvidence(db, c, p, rows, chain, start, end));
  const mapped = mapRequirements(REQUIREMENTS, new Map(controls.map((c) => [c.control, c])));
  return { p, controls, mapped, summary: summarise(p, chain, mapped, controls) };
}

/** What Purser Cloud's Compliance view shows (cloud/src/compliance.ts): the summary of a period, unsigned, in short. */
export interface ComplianceSnapshot {
  generated_at: string;
  period: { from: string; to: string };
  audit: { first_seq: number; last_seq: number; rows: number; head: string };
  frameworks: { framework: FrameworkId; name: string; requirements: number; evidence_in_period: number; no_records_in_period: number; documented: number; gap: number }[];
  controls: { id: string; name: string; status: ControlEvidence["status"]; records: number }[];
  gaps: { framework: FrameworkId; clause: string; gap: string }[];
  note: string;
}

/**
 * The snapshot the runner pushes to Purser Cloud (src/cli/cloud.ts push): the evidence summary of the `days` days up to
 * and including today (UTC), with the map's gaps. Counts only: no row, no subject, no payload. Unsigned: the signed
 * evidence is the one npm run compliance-evidence writes.
 */
export function complianceSnapshot(db: DB, now: Date, days = 30): ComplianceSnapshot {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const { summary: s } = evidenceOf(db, { from, to });
  return {
    generated_at: now.toISOString(), period: s.period, audit: { first_seq: s.audit.first_seq, last_seq: s.audit.last_seq, rows: s.audit.rows, head: s.audit.head },
    frameworks: s.frameworks, controls: s.controls,
    gaps: REQUIREMENTS.filter((r) => r.status === "gap").map((r) => ({ framework: r.framework, clause: r.clause, gap: r.gap ?? "" })),
    note: HONEST_LINE,
  };
}

/**
 * The evidence of the days from..to (inclusive, UTC). Reads the ledger only. Refuses a period that is not one and an
 * audit log that does not verify (periodAuditRows).
 */
export function buildComplianceEvidence(db: DB, period: { from: string; to: string }, signer: PackSigner): ComplianceEvidence {
  const { p, controls, mapped, summary } = evidenceOf(db, period);
  const files: Record<string, string> = {
    "summary.json": json(summary),
    "mapping.json": json({ format: COMPLIANCE_EVIDENCE_FORMAT, period: p, frameworks: FRAMEWORKS, requirements: mapped }),
    ...Object.fromEntries(controls.map((c) => [`controls/${c.control}.json`, json(c)])),
  };
  return { files: sealComplianceEvidence(files, signer), summary };
}

/**
 * The files with a new manifest.json over them: each file's size and SHA-256, the period and chain from summary.json,
 * signed with Ed25519 as the audit pack's manifest is. Used to make the evidence (and by a test, to forge a sealed copy).
 */
export function sealComplianceEvidence(files: Record<string, string>, signer: PackSigner): Record<string, string> {
  const { [MANIFEST]: _old, ...rest } = files;
  const body = sorted(rest);
  const summary = JSON.parse(body["summary.json"] ?? "{}") as Partial<EvidenceSummary>;
  if (!summary.period || !summary.audit) throw new Error("summary.json has no period or audit: nothing to seal");
  const publicKey = rawPublicKey(signer.key);
  const manifest: EvidenceManifest = {
    format: COMPLIANCE_EVIDENCE_FORMAT, period: summary.period, audit: summary.audit,
    files: Object.entries(body).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(text) })),
    key_id: keyIdOf(publicKey), public_key: publicKey,
  };
  return { [MANIFEST]: json({ format: COMPLIANCE_EVIDENCE_FORMAT, note: EVIDENCE_NOTE, manifest, signature: signManifest(manifest, signer) }), ...body };
}

/** Writes the evidence into a new (or empty) directory; refuses one that already holds files. */
export function writeComplianceEvidence(dir: string, ev: ComplianceEvidence): string[] {
  let existing: string[] = [];
  try { existing = readdirSync(dir); } catch { /* a new directory */ }
  if (existing.length) throw new Error(`${dir} already holds ${existing.length} entries; write the evidence to a new directory`);
  const out: string[] = [];
  for (const [path, text] of Object.entries(ev.files)) {
    const file = join(dir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    out.push(file);
  }
  return out;
}

/** Every file under the directory, by its POSIX path relative to it. */
export function readComplianceEvidence(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** The summary in lines, for the command line. */
export function evidenceSummaryLines(s: EvidenceSummary): string[] {
  const ran = s.controls.filter((c) => c.status === "records-in-period").length;
  const idle = s.controls.filter((c) => c.status === "no-records-in-period").map((c) => c.id);
  return [
    `period ${s.period.from} .. ${s.period.to}: audit rows ${s.audit.first_seq}..${s.audit.last_seq} (${s.audit.rows}), head ${s.audit.head.slice(0, 16)}…`,
    ...s.frameworks.map((f) => `  ${f.framework.padEnd(10)} ${String(f.requirements).padStart(2)} requirements: ${f.evidence_in_period} evidence in period, ${f.no_records_in_period} no records in period, ${f.documented} documented, ${f.gap} gap`),
    `controls: ${ran} with records in the period, ${idle.length} with none${idle.length ? ` (${idle.join(", ")})` : ""}, ${s.controls.filter((c) => c.status === "documented").length} documented only`,
    HONEST_LINE,
  ];
}

// --- Verification: no database, no network. ----------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (h: unknown) => (typeof h === "string" && h.length > 16 ? `${h.slice(0, 12)}…` : String(h));
const parse = (text: string | undefined): unknown => { try { return text === undefined ? undefined : JSON.parse(text) as unknown; } catch { return undefined; } };
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every check on the evidence: the manifest's shape and Ed25519 signature (and, given pinned keys, whose key signed
 * it), every file against the manifest (changed, missing or added: named), the summary against the files it sums, and,
 * given the audit pack of the same period: that the pack verifies, covers the same run of the chain, and has every
 * cited audit row (and policy version and approval) as the evidence cites it.
 */
export function verifyComplianceEvidence(files: Record<string, string>, opts: { trusted?: string[]; auditPack?: unknown } = {}): PackResult {
  const checks: PackCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => { checks.push({ check, ok, detail }); return ok; };
  const done = (): PackResult => ({ ok: checks.length > 0 && checks.every((c) => c.ok), checks });
  try { return run(); } catch (e) { add("error", false, (e as Error).message); return done(); }

  function run(): PackResult {
    const top = parse(files[MANIFEST]);
    const m = isObj(top) ? top.manifest : undefined;
    const shaped = isObj(top) && top.format === COMPLIANCE_EVIDENCE_FORMAT && typeof top.signature === "string" && isObj(m) && m.format === COMPLIANCE_EVIDENCE_FORMAT
      && Array.isArray(m.files) && isObj(m.period) && isObj(m.audit) && typeof m.public_key === "string" && typeof m.key_id === "string";
    const man = m as unknown as EvidenceManifest;
    if (!add("format", shaped, shaped ? `${COMPLIANCE_EVIDENCE_FORMAT}, period ${String(man.period.from)} .. ${String(man.period.to)}` : `${MANIFEST} is missing or not a ${COMPLIANCE_EVIDENCE_FORMAT} manifest`)) return done();
    for (const c of manifestSignatureChecks(man, (top as { signature: string }).signature, opts.trusted ?? [])) add(c.check, c.ok, c.detail);

    // Every file as the manifest lists it; none missing, none added.
    const why: string[] = [];
    const listed = new Set<string>();
    for (const f of man.files) {
      listed.add(f.path);
      const text = files[f.path];
      if (text === undefined) { why.push(`${f.path} is in the manifest, not in the directory`); continue; }
      const h = sha256Hex(text);
      if (h !== f.sha256) why.push(`${f.path}: sha256 ${short(h)}, the manifest says ${short(f.sha256)}: it was changed`);
    }
    for (const path of Object.keys(files).sort()) if (path !== MANIFEST && !listed.has(path)) why.push(`${path} is not in the manifest`);
    add("files", why.length === 0, why.length ? why.join("; ") : `${man.files.length} files, each as the manifest lists (SHA-256)`);

    // The summary against the files it sums: each control's records, each requirement's standing, each framework's counts.
    const summary = parse(files["summary.json"]) as EvidenceSummary | undefined;
    const mapping = parse(files["mapping.json"]) as { requirements?: MappedRequirement[] } | undefined;
    const controls = Object.entries(files).filter(([p]) => p.startsWith("controls/")).map(([p, t]) => [p, parse(t)] as [string, ControlEvidence | undefined]);
    const sbad: string[] = [];
    if (!isObj(summary) || !isObj(mapping) || !Array.isArray(mapping.requirements)) sbad.push("summary.json or mapping.json cannot be read");
    else {
      if (!sameJson(summary.period, man.period) || !sameJson(summary.audit, man.audit)) sbad.push("summary.json: its period or chain is not the manifest's");
      for (const [p, c] of controls) {
        if (!isObj(c)) { sbad.push(`${p} cannot be read`); continue; }
        if (!sameJson(c.period, man.period)) sbad.push(`${p}: its period is not the manifest's`);
        const auditRows = c.audit?.records.length ?? 0;
        const tableRows = c.tables.reduce((n, t) => n + t.records.length, 0);
        const counted = c.audit ? Object.values(c.audit.by_event).reduce((n, x) => n + x, 0) : 0;
        if (c.audit && (c.audit.rows !== auditRows || counted !== auditRows)) sbad.push(`${p}: ${auditRows} audit rows cited, it says ${c.audit.rows} (${counted} by event)`);
        for (const t of c.tables) if (t.rows !== t.records.length) sbad.push(`${p}: table ${t.table} cites ${t.records.length} rows, it says ${t.rows}`);
        if (c.chain && !sameJson(c.chain, man.audit)) sbad.push(`${p}: its chain is not the manifest's`);
        const records = auditRows + tableRows + (c.chain ? c.chain.rows : 0);
        if (c.status !== "documented" && c.records !== records) sbad.push(`${p}: it counts ${c.records} records, it cites ${records}`);
        const s = summary.controls.find((x) => x.id === c.control);
        if (!s || s.records !== c.records || s.status !== c.status) sbad.push(`summary.json: control ${c.control} is not as ${p} says`);
      }
      const read = controls.map(([, c]) => c).filter((c): c is ControlEvidence => isObj(c));
      const again = mapRequirements(mapping.requirements, new Map(read.map((c) => [c.control, c])));
      mapping.requirements.forEach((r, i) => {
        const w = again[i]!;
        if (r.in_period !== w.in_period || r.records !== w.records) sbad.push(`mapping.json: ${r.framework} ${r.clause} says ${r.in_period} (${r.records} records); its controls' files give ${w.in_period} (${w.records})`);
      });
      const want = summarise(man.period, man.audit, again, read).frameworks;
      for (const w of want) {
        const got = summary.frameworks.find((f) => f.framework === w.framework);
        if (!sameJson(got, w)) sbad.push(`summary.json: ${w.framework} says ${got ? `${got.evidence_in_period}/${got.no_records_in_period}/${got.documented}/${got.gap}` : "nothing"}, mapping.json gives ${w.evidence_in_period}/${w.no_records_in_period}/${w.documented}/${w.gap} (evidence in period/no records/documented/gap)`);
      }
    }
    add("summary", sbad.length === 0, sbad.length ? sbad.join("; ") : "each control's count and each framework's sums agree with the files they sum");

    // With the audit pack of the same period: it verifies, it is the same run of the chain, and it has every cited row.
    if (opts.auditPack === undefined) {
      add("cited rows", true, "no audit pack given: the cited rows were not checked against the period's hash chain (pass --audit-pack <file>)");
      return done();
    }
    const pr = verifyAuditPack(opts.auditPack, { trusted: opts.trusted });
    const pack = opts.auditPack as AuditPack;
    const pm = pr.checks.length && isObj(pack) && isObj(pack.manifest) ? pack.manifest : null;
    const packWhy = !pr.ok ? `the audit pack does not verify (${pr.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`
      : !pm || !sameJson(pm.period, man.period) ? `the audit pack is of period ${String(pm?.period.from)} .. ${String(pm?.period.to)}; the evidence is of ${man.period.from} .. ${man.period.to}`
      : !sameJson({ first_seq: pm.audit.first_seq, last_seq: pm.audit.last_seq, rows: pm.audit.rows, before: pm.audit.before, head: pm.audit.head }, man.audit) ? `the audit pack's chain runs ${pm.audit.first_seq}..${pm.audit.last_seq}, head ${short(pm.audit.head)}; the evidence's ${man.audit.first_seq}..${man.audit.last_seq}, head ${short(man.audit.head)}`
      : null;
    add("audit pack", packWhy === null, packWhy ?? `it verifies, and covers the same rows ${man.audit.first_seq}..${man.audit.last_seq} (head ${short(man.audit.head)})`);
    if (packWhy !== null) { add("cited rows", false, "not checked: the audit pack is not the period's"); return done(); }

    const rows = new Map(pack.sections.audit_rows.map((r) => [r.seq, r]));
    const versions = new Map(pack.sections.policy_versions.map((v) => [v.version, v]));
    const approvals = new Map(pack.sections.proposals.filter((x) => x.approval).map((x) => [x.proposal_id, x.approval!]));
    const cbad: string[] = [];
    let n = 0;
    for (const [p, c] of controls) {
      if (!isObj(c)) continue;
      for (const r of c.audit?.records ?? []) {
        n++;
        const row = rows.get(r.seq);
        const what = `audit row ${r.seq} (${r.event}${r.subject ? ` ${r.subject}` : ""})`;
        if (!row) cbad.push(`${p}: ${what} is not in the audit pack's period`);
        else if (row.row_hash !== r.row_hash) cbad.push(`${p}: ${what} has hash ${short(r.row_hash)}, the audit pack's row has ${short(row.row_hash)}`);
        else if (row.event !== r.event || row.subject !== r.subject || row.ts !== r.ts) cbad.push(`${p}: ${what} is not what the audit pack's row says (${row.event} ${String(row.subject)} at ${row.ts})`);
      }
      for (const t of c.tables) for (const r of t.records) {
        if (t.table === "policy_versions") {
          n++;
          const v = versions.get(Number(r.version));
          if (!v || v.sha256 !== r.sha256) cbad.push(`${p}: policy v${String(r.version)} (${short(r.sha256)}) is not in the audit pack as cited`);
        }
        if (t.table === "approvals" && approvals.has(String(r.proposal_id))) {
          n++;
          const a = approvals.get(String(r.proposal_id))!;
          if (a.decision !== r.decision || a.approved_sha256 !== r.approved_sha256 || a.method !== r.method) cbad.push(`${p}: the approval of ${String(r.proposal_id)} is not as the audit pack has it`);
        }
      }
    }
    add("cited rows", cbad.length === 0, cbad.length ? cbad.join("; ") : `${n} cited rows, each in the audit pack's period as cited (hash, event, subject, time)`);
    return done();
  }
}

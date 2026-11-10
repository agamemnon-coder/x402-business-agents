// Finishing a live run that stopped part-way (10 November: Airwallex refused the two new companies' payouts): from
// each company's own ledger, without any Airwallex call, the facts of what happened (accounts, fundings, invoices and
// who read them, suppliers created, approvals, payouts and refusals with their trace ids), and for every payment that
// was PAID its receipt (verify-receipt checks it offline) and its entries in T:0, converted at the run's recorded
// Airwallex rate. The run's own log names each company's account and funding.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { apJournal } from "../ap/books.js";
import { verifyAuditChain } from "../audit/log.js";
import { openDb, type DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { RECEIPT_FORMAT, type TryReceipt } from "../try/receipt.js";
import type { FxRate } from "./platformOps.js";
import { E2E_ORIGIN, E2E_RP_ID, pushToT0, TEST_PASSKEY, toPostings, type PlatformE2EDeps } from "./platformRun.js";
import { chainSteps, type E2eStep, type StepData } from "./receiptChain.js";
import type { WorldCompany } from "./world.js";

const PAYMENT_KINDS = new Set(["supplier_payment", "payment_batch", "invoice_payment"]);

export interface CompanyFacts {
  key: string;
  account: string;
  account_line: string;
  funding: string;
  invoices: { id: string; vendor: string; invoice_no: string; total: string; received_at: string; read_by: string; doc_sha256: string }[];
  claude_reads: { at: string; task: string; model: string; request_id: string | null }[];
  beneficiaries: { id: string; name: string; method: string; bic: string; account: string }[];
  approvals: { proposal_id: string; kind: string; status: string; terms_sha256: string; approved_with: string }[];
  transfers: { transfer_id: string | null; status: string; amount: string; invoice_no: string; airwallex_fee: string | null; failure: string | null }[];
  purser_fees: { amount: string; status: string; with_payout: string | null; to: string }[];
  refusals: { proposal_id: string; detail: string }[];
  audit: { ok: boolean; rows: number; head: string | null };
  t0_entries: string[];
  receipt: string | null;
}

const rows = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as T[];

/** The facts of one company's part of a run, from its ledger and the run's log. */
export function companyFacts(db: DB, key: string, log: string): CompanyFacts {
  const line = (re: RegExp) => log.split("\n").find((l) => l.startsWith(key) && re.test(l))?.slice(key.length).trim() ?? "";
  const accountLine = line(/ account acct_/);
  const audit = verifyAuditChain(db);
  return {
    key, account: /acct_[A-Za-z0-9_-]+/.exec(accountLine)?.[0] ?? "", account_line: accountLine,
    funding: line(/ (funded|skipped)/),
    invoices: rows(db, "SELECT id, vendor, invoice_no, currency || ' ' || total AS total, received_at, read_by, doc_sha256 FROM ap_invoices ORDER BY id"),
    claude_reads: rows<{ ts: string; subject: string; model: string; rid: string | null }>(db, "SELECT ts, subject, json_extract(payload_json, '$.model') AS model, json_extract(payload_json, '$.request_id') AS rid FROM audit_log WHERE event = 'claude.read' ORDER BY seq")
      .map((r) => ({ at: r.ts, task: r.subject, model: r.model, request_id: r.rid })),
    beneficiaries: rows<{ beneficiary_id: string; name: string; method: string; bic: string; details_json: string }>(db, "SELECT beneficiary_id, name, method, bic, details_json FROM beneficiaries ORDER BY rowid")
      .map((b) => ({ id: b.beneficiary_id, name: b.name, method: b.method, bic: b.bic, account: (JSON.parse(b.details_json || "{}") as { account?: string }).account ?? "" })),
    approvals: rows<{ proposal_id: string; kind: string; status: string; terms_sha256: string; approver: string }>(db, "SELECT p.proposal_id, p.kind, p.status, p.terms_sha256, a.approver FROM proposals p JOIN approvals a ON a.proposal_id = p.proposal_id ORDER BY p.proposal_id")
      .map((a) => ({ proposal_id: a.proposal_id, kind: a.kind, status: a.status, terms_sha256: a.terms_sha256, approved_with: a.approver })),
    transfers: rows(db, "SELECT transfer_id, status, amount, invoice_no, fee_actual AS airwallex_fee, failure_reason AS failure FROM transfers ORDER BY rowid"),
    purser_fees: rows(db, "SELECT amount, status, fee_transfer_id AS with_payout, destination AS \"to\" FROM platform_fees ORDER BY rowid"),
    refusals: rows<{ subject: string; p: string }>(db, "SELECT subject, payload_json AS p FROM audit_log WHERE event = 'proposal.failed' ORDER BY seq")
      .map((r) => ({ proposal_id: r.subject, detail: (JSON.parse(r.p) as { error?: string }).error ?? "batch: see its lines" })),
    audit: { ok: audit.ok, rows: rows(db, "SELECT seq FROM audit_log").length, head: (db.prepare("SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { row_hash?: string } | undefined)?.row_hash ?? null },
    t0_entries: [], receipt: null,
  };
}

/** The test passkey's public key as a JWK, from the COSE key the ledger stored at enrolment. */
export function jwkOfCose(coseB64url: string): { kty: "EC"; crv: "P-256"; x: string; y: string } {
  const m = isoCBOR.decodeFirst<Map<number, Uint8Array>>(Buffer.from(coseB64url, "base64url"));
  return { kty: "EC", crv: "P-256", x: Buffer.from(m.get(-2)!).toString("base64url"), y: Buffer.from(m.get(-3)!).toString("base64url") };
}

/** For a company whose payments were all PAID: its entries to T:0 (tagged, converted at the run's rate) and its receipt. */
export async function finishPaid(d: Pick<PlatformE2EDeps, "t0" | "t0Rate" | "t0Currency" | "fx" | "now"> & { fx: FxRate }, db: DB, c: Pick<WorldCompany, "key" | "name">, facts: CompanyFacts, file: string): Promise<CompanyFacts> {
  // The last executed payment approval (a retry's, after an earlier one was refused): its payouts must all be PAID.
  const paid = [...facts.approvals].reverse().find((a) => a.status === "EXECUTED" && PAYMENT_KINDS.has(a.kind));
  if (!paid) throw new Error(`${c.key}: no executed payment; nothing to finish`);
  const entries = apJournal(db);
  const posted = await pushToT0(d as PlatformE2EDeps, toPostings(c, entries, d.fx));
  const p = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(paid.proposal_id) as { terms_json: string };
  const a = db.prepare("SELECT credential_id, assertion_json, verified_at AS created_at FROM passkey_assertions WHERE proposal_id = ? AND terms_sha256 = ?").get(paid.proposal_id, paid.terms_sha256) as { credential_id: string; assertion_json: string; created_at?: string };
  const key = db.prepare("SELECT public_key FROM passkeys WHERE credential_id = ?").get(a.credential_id) as { public_key: string };
  const assertion = (JSON.parse(a.assertion_json) as { response: { authenticatorData: string; clientDataJSON: string; signature: string } }).response;
  const at = d.now().toISOString();
  const steps: E2eStep[] = [
    { kind: "account", at, data: { company: c.name, connected_account: facts.account, account: facts.account_line, funding: facts.funding, binding: "signed with the run's own key (a test world's stand-in for Purser Cloud's)" } },
    ...facts.invoices.flatMap((i): E2eStep[] => [
      { kind: "invoice_received", at: i.received_at, data: { invoice: i.id, doc_sha256: i.doc_sha256 } },
      { kind: "invoice_read", at, data: { invoice: i.id, read_by: i.read_by, vendor: i.vendor, invoice_no: i.invoice_no, total: i.total, claude_reads: facts.claude_reads.map((r) => `${r.at} ${r.task} ${r.model} request id ${r.request_id ?? "not returned"}`) } },
    ]),
    ...facts.beneficiaries.map((b): E2eStep => ({ kind: "supplier_approved", at, data: { beneficiary: b.id, name: b.name, method: b.method, bic: b.bic, account: b.account, approved_with: TEST_PASSKEY } })),
    { kind: "signature", at: a.created_at ?? at, data: { proposal_id: paid.proposal_id, kind: paid.kind, terms_sha256: paid.terms_sha256, signed_with: TEST_PASSKEY, credential_id: a.credential_id } },
    ...facts.transfers.map((t): E2eStep => ({ kind: "payout", at, data: { transfer_id: t.transfer_id ?? "", status: t.status, amount: `EUR ${t.amount}`, invoice_no: t.invoice_no, on_behalf_of: facts.account, airwallex_fee: t.airwallex_fee ?? "none", purser_fee: facts.purser_fees.filter((f) => f.with_payout === t.transfer_id).map((f) => `EUR ${f.amount} ${f.status} to ${f.to} via application_fee_options`).join("; ") || "none" } as StepData })),
    { kind: "booked", at, data: { entries: String(entries.length), balanced: entries.reduce((s, e) => s + (e.debit ? toCents(e.debit) : 0) - (e.credit ? toCents(e.credit) : 0), 0) === 0 ? "yes" : "no", audit_chain: facts.audit.ok ? `ok, ${facts.audit.rows} rows, head ${facts.audit.head ?? ""}` : "BROKEN" } },
    { kind: "t0_posted", at, data: { entity: "T:0 sandbox (shared by the three test companies)", journal_entries: posted.posted.map((x) => x.id), tag: `[${c.key}] PUR-${c.key}-…`, conversion: `converted at Airwallex sandbox rate ${d.fx.rate} ${d.fx.to} per EUR at ${d.fx.at}` } },
  ];
  const receipt: TryReceipt & { e2e: ReturnType<typeof chainSteps> } = {
    receipt: RECEIPT_FORMAT,
    note: `Purser platform end-to-end (live, Airwallex sandbox, test money), ${c.name}: test company; approved with a ${TEST_PASSKEY}.`,
    terms: JSON.parse(p.terms_json) as Record<string, unknown>, terms_sha256: paid.terms_sha256, algorithm: "ES256", public_key: jwkOfCose(key.public_key), credential_id: a.credential_id,
    rp_id: E2E_RP_ID, origin: E2E_ORIGIN, assertion, verify: "npm run verify-receipt -- <this file>",
    e2e: chainSteps(`${c.key} (${facts.account})`, steps),
  };
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...facts, t0_entries: posted.posted.map((x) => x.id), receipt: file };
}

/** Every company folder of a run, its facts, and the PAID ones finished. */
export async function finishRun(d: Pick<PlatformE2EDeps, "t0" | "t0Rate" | "t0Currency" | "now"> & { fx: FxRate }, dir: string, logFile: string, world: Pick<WorldCompany, "key" | "name">[]): Promise<CompanyFacts[]> {
  const log = readFileSync(logFile, "utf8");
  const out: CompanyFacts[] = [];
  for (const c of world) {
    const f = join(dir, c.key.toLowerCase(), "ledger.db");
    if (!existsSync(f)) continue;
    const db = openDb(f);
    try {
      let facts = companyFacts(db, c.key, log);
      const paid = [...facts.approvals].reverse().find((a) => a.status === "EXECUTED" && PAYMENT_KINDS.has(a.kind));
      const open = rows<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ap_invoices WHERE status <> 'paid'")[0]!.n;
      if (paid && open === 0) facts = await finishPaid(d, db, c, facts, join(dir, c.key.toLowerCase(), `receipt-${paid.proposal_id}.json`));
      out.push(facts);
    } finally { db.close(); }
  }
  writeFileSync(join(dir, "facts.json"), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

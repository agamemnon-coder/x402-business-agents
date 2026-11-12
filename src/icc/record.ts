// The record of an ICC run (npm run icc -- record): docs/runs/<date>-icc.json and .md, written from this world's audit
// rows and its call log ONLY. No number is typed: each comes from a row or a log line. The date is the run's own, from
// its rows. The record holds what a page and a reader need and nothing else: no credential, no device or assurance
// data, no card data, no key or key ID, no value of any variable.
//
// readIccRunRecord is the one way to read the JSON back (the /visa page's block reads it): it accepts exactly this
// shape and refuses anything else, naming the field.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countByEndpoint, type CallLine } from "../airwallex/callBudget.js";
import type { DB } from "../db/open.js";
import { ICC_TEST_HOST } from "./client.js";
import { ICC_NOT_USED } from "./purchase.js";

export const ICC_RECORD_SCHEMA = "purser.icc-run.v1";

export interface IccRecordPurchase {
  label: "A" | "B";
  /** Two-decimal amount, as signed. */
  amount: string;
  currency: string;
  merchant: string;
  /** The SHA-256 of the exact terms the CFO signed; null when nothing was filed. */
  terms_sha256: string | null;
  /** The instruction's ID as the service gave it; null when none was created. */
  instruction_id: string | null;
  /** How the CFO approved (the approval row's method); null when nobody approved. */
  approved_with: string | null;
  outcome: string;
  refusal_code: string | null;
}

export interface IccRecordCheck { stage: "preflight" | "run"; name: string; ok: boolean; detail: string }

export interface IccRunRecord {
  schema: typeof ICC_RECORD_SCHEMA;
  /** YYYY-MM-DD (UTC), the day of the run's own rows. */
  run_date: string;
  environment: "sandbox";
  purchases: IccRecordPurchase[];
  checks: IccRecordCheck[];
  calls: { total: number; budget: number; by_endpoint: { endpoint: string; calls: number }[] };
  not_done: string[];
}

/** The ledger holds no ICC run (or no finished one): nothing is written. */
export class IccNoRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IccNoRun";
  }
}

export class IccRecordInvalid extends Error {
  constructor(field: string) {
    super(`not an ICC run record: ${field}`);
    this.name = "IccRecordInvalid";
  }
}

interface Row { seq: number; ts: string; event: string; subject: string | null; payload: Record<string, unknown> }

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The record of the ledger's ICC run, from its audit rows and the call log. Throws IccNoRun when there is none. */
export function iccRunRecord(db: DB, callLog: readonly CallLine[]): IccRunRecord {
  const rows = (db.prepare("SELECT seq, ts, event, subject, payload_json FROM audit_log WHERE event LIKE 'icc.%' OR event IN ('proposal.created', 'proposal.approved') ORDER BY seq").all() as { seq: number; ts: string; event: string; subject: string | null; payload_json: string }[])
    .map((r) => ({ seq: r.seq, ts: r.ts, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
  const started = rows.filter((r) => r.event === "icc.run_started").pop();
  if (!started) throw new IccNoRun("this ledger holds no ICC run; nothing was written");
  const after = rows.filter((r) => r.seq > started.seq);
  const ended = after.find((r) => r.event === "icc.run_checks");
  if (!ended) throw new IccNoRun("the ICC run in this ledger did not finish (it has no checks row); nothing was written");
  if (started.payload.host !== ICC_TEST_HOST) throw new IccNoRun("the ICC run in this ledger was not made against the sandbox host; nothing was written");
  const preflight = rows.filter((r) => r.event === "icc.preflight" && r.seq < started.seq).pop();

  const attempts = after.filter((r) => r.event === "icc.run_attempt" && r.seq < ended.seq);
  const purchases = attempts.map((at, i): IccRecordPurchase => {
    const until = attempts[i + 1]?.seq ?? ended.seq;
    const own = after.filter((r) => r.seq > at.seq && r.seq < until);
    const requested = own.find((r) => r.event === "icc.purchase_requested");
    const filed = own.find((r) => r.event === "icc.run_filed");
    const pid = str(filed?.payload.proposal_id);
    // The proposal's own rows: the runner writes them while the run waits, so they are found by subject, not by place.
    const of = (event: string) => (pid ? after.find((r) => r.event === event && r.subject === pid) : undefined);
    const refusedEarly = own.find((r) => r.event === "icc.purchase_refused" && r.subject === null);
    const created = of("icc.instruction_created");
    const received = of("icc.credential_received_not_used");
    const refused = of("icc.purchase_refused");
    const unconfirmed = pid ? after.find((r) => r.subject === pid && /^icc\.(instruction|credential)_unconfirmed$/.test(r.event)) : undefined;
    let outcome: string, code: string | null = null;
    if (received) outcome = `${ICC_NOT_USED}; no payment was made`;
    else if (refusedEarly) { outcome = "refused by Purser before any call"; code = str(refusedEarly.payload.code); }
    else if (refused) { outcome = `refused by ${refused.payload.by === "icc" ? "the service" : "Purser"}`; code = str(refused.payload.code); }
    else if (unconfirmed) outcome = `the ${unconfirmed.event.includes("instruction") ? "instruction" : "credential"} call has no answer; nothing was sent again`;
    else if (pid) outcome = "filed for the CFO; not run";
    else outcome = "no outcome recorded";
    return {
      label: str(at.payload.label) === "B" ? "B" : "A",
      amount: str(requested?.payload.amount) ?? "",
      currency: str(requested?.payload.currency) ?? "",
      merchant: str(requested?.payload.merchant) ?? "",
      terms_sha256: str(of("proposal.created")?.payload.terms_sha256),
      instruction_id: str(created?.payload.instruction_id),
      approved_with: str(of("proposal.approved")?.payload.method),
      outcome, refusal_code: code,
    };
  });

  const checksOf = (stage: IccRecordCheck["stage"], r: Row | undefined): IccRecordCheck[] =>
    (Array.isArray(r?.payload.checks) ? (r.payload.checks as Record<string, unknown>[]) : []).map((k) => ({ stage, name: String(k.name), ok: k.ok === true, detail: String(k.detail) }));
  const byEndpoint = countByEndpoint(callLog);
  const sent = (suffix: string) => callLog.some((l) => l.method !== "GET" && l.endpoint.endsWith(suffix));
  const notDone = [
    "No payment was made: the flow stops before checkout, and a credential that came was dropped unused.",
    ...(sent("/confirmations") ? [] : ["No confirmation was sent: what to report for a credential that was not used is not documented."]),
    "No instruction was read back from Visa: the documented API has no such call. Purser compared its own record of the instruction it sent, and the create answer, with the signed terms.",
    ...(sent("/cancel") ? [] : ["No instruction was cancelled."]),
    ...purchases.filter((p) => p.outcome === "refused by Purser before any call").map((p) => `${p.label} was not sent: Purser refused it before any call.`),
  ];
  const record: IccRunRecord = {
    schema: ICC_RECORD_SCHEMA,
    run_date: started.ts.slice(0, 10),
    environment: "sandbox",
    purchases,
    checks: [...checksOf("preflight", preflight), ...checksOf("run", ended)],
    calls: { total: callLog.length, budget: typeof started.payload.budget === "number" ? started.payload.budget : 0, by_endpoint: byEndpoint },
    not_done: notDone,
  };
  return readIccRunRecord(record);
}

// ---- reading it back ---------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** One line of plain text, bounded; no long digit run (a card-like number never passes). */
const TEXT = (max: number) => (v: unknown): v is string => typeof v === "string" && v.length <= max && !/[\p{Cc}]/u.test(v) && !/\d{13,}/.test(v);

function keys(o: Record<string, unknown>, want: string[], at: string): void {
  const have = Object.keys(o).sort().join(",");
  if (have !== [...want].sort().join(",")) throw new IccRecordInvalid(`${at} must have exactly the fields ${want.join(", ")}`);
}

/** The record from its JSON text or parsed value, checked field by field. Throws IccRecordInvalid naming the field. */
export function readIccRunRecord(input: unknown): IccRunRecord {
  let v: unknown = input;
  if (typeof input === "string") {
    try { v = JSON.parse(input) as unknown; } catch { throw new IccRecordInvalid("not JSON"); }
  }
  const fail = (field: string): never => { throw new IccRecordInvalid(field); };
  if (!isObject(v)) return fail("not an object");
  keys(v, ["schema", "run_date", "environment", "purchases", "checks", "calls", "not_done"], "the record");
  if (v.schema !== ICC_RECORD_SCHEMA) fail("schema");
  if (typeof v.run_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.run_date) || Number.isNaN(Date.parse(`${v.run_date}T00:00:00Z`))) fail("run_date");
  if (v.environment !== "sandbox") fail("environment");

  if (!Array.isArray(v.purchases) || v.purchases.length === 0 || v.purchases.length > 4) fail("purchases");
  for (const [i, p] of (v.purchases as unknown[]).entries()) {
    const at = `purchases[${i}]`;
    if (!isObject(p)) return fail(at);
    keys(p, ["label", "amount", "currency", "merchant", "terms_sha256", "instruction_id", "approved_with", "outcome", "refusal_code"], at);
    if (p.label !== "A" && p.label !== "B") fail(`${at}.label`);
    if (typeof p.amount !== "string" || !/^(0|[1-9]\d{0,8})\.\d{2}$/.test(p.amount)) fail(`${at}.amount`);
    if (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency)) fail(`${at}.currency`);
    if (!TEXT(40)(p.merchant) || p.merchant === "") fail(`${at}.merchant`);
    if (p.terms_sha256 !== null && (typeof p.terms_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.terms_sha256))) fail(`${at}.terms_sha256`);
    if (p.instruction_id !== null && (typeof p.instruction_id !== "string" || !/^[A-Za-z0-9-]{1,50}$/.test(p.instruction_id))) fail(`${at}.instruction_id`);
    if (p.approved_with !== null && (typeof p.approved_with !== "string" || !/^[a-z_-]{1,20}$/.test(p.approved_with))) fail(`${at}.approved_with`);
    if (!TEXT(200)(p.outcome) || p.outcome === "") fail(`${at}.outcome`);
    if (p.refusal_code !== null && (typeof p.refusal_code !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(p.refusal_code))) fail(`${at}.refusal_code`);
  }

  if (!Array.isArray(v.checks) || v.checks.length > 40) fail("checks");
  for (const [i, k] of (v.checks as unknown[]).entries()) {
    const at = `checks[${i}]`;
    if (!isObject(k)) return fail(at);
    keys(k, ["stage", "name", "ok", "detail"], at);
    if (k.stage !== "preflight" && k.stage !== "run") fail(`${at}.stage`);
    if (!TEXT(60)(k.name) || k.name === "") fail(`${at}.name`);
    if (typeof k.ok !== "boolean") fail(`${at}.ok`);
    if (!TEXT(400)(k.detail)) fail(`${at}.detail`);
  }

  const c = v.calls;
  if (!isObject(c)) return fail("calls");
  keys(c, ["total", "budget", "by_endpoint"], "calls");
  const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!count(c.total)) fail("calls.total");
  if (!count(c.budget)) fail("calls.budget");
  if (!Array.isArray(c.by_endpoint)) fail("calls.by_endpoint");
  let sum = 0;
  for (const [i, e] of (c.by_endpoint as unknown[]).entries()) {
    const at = `calls.by_endpoint[${i}]`;
    if (!isObject(e)) return fail(at);
    keys(e, ["endpoint", "calls"], at);
    if (typeof e.endpoint !== "string" || !/^(GET|POST|PUT) \/[A-Za-z0-9/{}_-]{1,80}$/.test(e.endpoint)) fail(`${at}.endpoint`);
    if (!count(e.calls)) fail(`${at}.calls`);
    sum += e.calls as number;
  }
  if (sum !== c.total) fail("calls.total (not the sum of calls.by_endpoint)");

  if (!Array.isArray(v.not_done) || v.not_done.length > 12 || !v.not_done.every((s) => TEXT(300)(s) && s !== "")) fail("not_done");
  return v as unknown as IccRunRecord;
}

// ---- the files ---------------------------------------------------------------------------------------------------------

const cell = (s: string | null) => (s === null ? "none" : s.replaceAll("|", "\\|"));

/** The record as a page of Markdown: what happened, the checks, the calls, and what was not done. */
export function iccRecordMarkdown(r: IccRunRecord): string {
  const out = [
    `# ${r.run_date}: Intelligent Commerce Connect, sandbox run`,
    "",
    "Written by `npm run icc -- record` from this run's audit rows and its call log only. Environment: the Cybersource",
    `sandbox (${ICC_TEST_HOST}), test card only. Built from the public documentation (docs/visa-icc.md).`,
    "",
    "## Purchases",
    "",
    "| | Amount | Merchant | Approved with | Terms hash | Instruction | Outcome |",
    "|---|---|---|---|---|---|---|",
    ...r.purchases.map((p) => `| ${p.label} | ${p.amount} ${p.currency} | ${cell(p.merchant)} | ${cell(p.approved_with)} | ${p.terms_sha256 ? `\`${p.terms_sha256}\`` : "none"} | ${p.instruction_id ? `\`${p.instruction_id}\`` : "none"} | ${cell(p.outcome)}${p.refusal_code ? ` (${p.refusal_code})` : ""} |`),
    "",
    "## Checks",
    "",
    "| Stage | Check | Result | Detail |",
    "|---|---|---|---|",
    ...r.checks.map((k) => `| ${k.stage} | ${cell(k.name)} | ${k.ok ? "pass" : "FAIL"} | ${cell(k.detail)} |`),
    "",
    "## Calls",
    "",
    "| Endpoint | Calls |",
    "|---|---|",
    ...r.calls.by_endpoint.map((e) => `| ${e.endpoint} | ${e.calls} |`),
    "",
    `${r.calls.total} call(s) in the call log, of an approved budget of ${r.calls.budget}.`,
    "",
    "## Not done",
    "",
    ...r.not_done.map((s) => `- ${s}`),
    "",
  ];
  return out.join("\n");
}

/** Writes <dir>/<run_date>-icc.json and .md. Returns their paths. */
export function writeIccRunRecord(dir: string, r: IccRunRecord): { json: string; md: string } {
  const checked = readIccRunRecord(r);
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${checked.run_date}-icc.json`), md = join(dir, `${checked.run_date}-icc.md`);
  writeFileSync(json, `${JSON.stringify(checked, null, 2)}\n`);
  writeFileSync(md, iccRecordMarkdown(checked));
  return { json, md };
}

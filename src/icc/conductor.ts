// The ICC rail's live commands (npm run icc, docs/runs/driver/icc-runbook.md): the guards, the preflight and the run.
// Built from the public documentation only; nothing here has been sent to the service.
//
//   guards     before anything: the rail's switch, the go, a call budget and a call log, a ledger of this world's own
//              (and, for the run, the keys folder the runner uses), and every name of docs/visa-icc.md section 9 that
//              the chosen scheme needs. A refusal names what is missing, never a value, and nothing is called.
//   preflight  no purchase. Local checks first (the key files, the keys, the request certificate's serial number, the
//              clock, the assurance file's documented fields), then at most two reads, both GET. The checks go into one
//              audit row, without values.
//   run        purchase A within the limit through the whole flow (src/icc/purchase.ts): filed, signed by the CFO with
//              the passkey over its exact terms, run by the runner, stopped before checkout. Then attempt B above the
//              limit, which Purser refuses before any call. The checks go into one audit row.
//
// Nothing here prints or records a credential, device or assurance data, a key, or the value of a variable.

import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { readCallLog } from "../airwallex/callBudget.js";
import { audit } from "../audit/log.js";
import { journal } from "../accounting/gl.js";
import type { DB } from "../db/open.js";
import { activePasskey } from "../passkey/ledger.js";
import { readPrivateKeyFile, readRequestCertificate, sharedSecretKey } from "./auth.js";
import { ICC_TEST_HOST } from "./client.js";
import { iccClientFromEnv, iccEnvProblem, readAssuranceFile, readIccEnv, type IccEnvConfig } from "./config.js";
import type { IccPassthrough } from "./instruction.js";
import { ICC_MERCHANTS } from "./policy.js";
import { ICC_NOT_USED, requestIccPurchase, type IccDeps, type IccOutcome, type IccPurchaseRequest } from "./purchase.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
export type IccCommand = "preflight" | "run" | "record";

/** One check, as printed and as recorded: a name, pass or fail, and a detail that holds no value of any variable. */
export interface IccRunCheck { name: string; ok: boolean; detail: string }

/** Said once by every preflight: what its reads cannot tell. */
export const ICC_PREFLIGHT_NOTE = "These reads cannot show whether the Intelligent Commerce operations are switched on for this organisation. The first POST of the run shows it.";
/** The subject of the run's own audit rows. */
export const ICC_RUN_SUBJECT = "icc-run";

const REPO = resolve(import.meta.dirname, "../..");
const line = (c: IccRunCheck): string => `${c.ok ? "ok  " : "FAIL"}  ${c.name}  ${c.detail}`;

/**
 * What stops a command before anything is opened or called, by name. Empty when it may go. The record command needs
 * only this world's ledger and its call log; the others need the full environment of the chosen scheme.
 */
export function iccGuard(cmd: IccCommand, env: Env): string[] {
  const why: string[] = [];
  if (!/icc[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB must be this world's own ledger (…/icc*.sqlite)");
  if (cmd === "record") {
    if (!env.ICC_CALL_LOG) why.push("ICC_CALL_LOG must name the run's call log");
    return why;
  }
  if (env.KIT11_ICC_RAIL !== "on") why.push("KIT11_ICC_RAIL=on (the rail's switch)");
  if (env.ICC_GO !== "yes") why.push("ICC_GO=yes (the owner's go)");
  // The runner beside the run executes A after the CFO's Face ID, with the keys folder of this world.
  if (cmd === "run" && !/\/icc[^/]*\/?$/.test(env.KIT11_KEYS_DIR ?? "")) why.push("KIT11_KEYS_DIR must be this world's own keys folder (…/icc*), the one the runner uses");
  // The run's needs, for both commands: the preflight checks the keys the run will use. The assurance file is a
  // check of the preflight, not a reason to refuse it.
  const reading = readIccEnv(env, "purchase");
  const missing = reading.missing.filter((n) => n !== "KIT11_ICC_RAIL" && !(cmd === "preflight" && n === "ICC_ASSURANCE_FILE"));
  const problem = iccEnvProblem({ ...reading, missing });
  if (problem) why.push(problem);
  return why;
}

// ---- the preflight ---------------------------------------------------------------------------------------------------

/** The fields the documentation marks required that come from the cardholder's passkey step (Purser adds the rest). */
const ASSURANCE_REQUIRED: [string, (p: IccPassthrough) => unknown[]][] = [
  ["deviceInformation.fingerprintSessionId", (p) => [p.deviceInformation.fingerprintSessionId]],
  ["deviceInformation.deviceData.type", (p) => [obj(p.deviceInformation.deviceData).type]],
  ["deviceInformation.deviceData.brand", (p) => [obj(p.deviceInformation.deviceData).brand]],
  ["deviceInformation.ipAddress", (p) => [p.deviceInformation.ipAddress]],
  ["assuranceData[].verificationMethod", (p) => p.assuranceData.map((a) => obj(a).verificationMethod)],
  ["assuranceData[].verificationResults", (p) => p.assuranceData.map((a) => obj(a).verificationResults)],
  ["assuranceData[].verificationTimestamp", (p) => p.assuranceData.map((a) => obj(a).verificationTimestamp)],
  ["assuranceData[].authenticatedIdentities.id", (p) => p.assuranceData.map((a) => obj(obj(a).authenticatedIdentities).id)],
];
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The names of the documented required fields the passkey step's data lacks. Reads names only, keeps nothing. */
export function missingAssuranceFields(p: IccPassthrough): string[] {
  return ASSURANCE_REQUIRED.filter(([, at]) => at(p).some((v) => typeof v !== "string" || v === "")).map(([name]) => name);
}

/** The key files: regular files outside the repository; the private ones this user's and nobody else's to read. */
function keyFilesCheck(c: IccEnvConfig): IccRunCheck {
  const files: [string, string | null | undefined, boolean][] = [
    ["ICC_JWT_PRIVATE_KEY_FILE", c.jwtPrivateKeyFile, true],
    ["ICC_MLE_RESPONSE_PRIVATE_KEY_FILE", c.mle?.responsePrivateKeyFile, true],
    ["ICC_MLE_REQUEST_CERT_FILE", c.mle?.requestCertFile, false],
  ];
  const wrong: string[] = [];
  for (const [name, file, isPrivate] of files) {
    if (!file) continue;
    const path = resolve(file);
    if (path === REPO || path.startsWith(REPO + sep)) { wrong.push(`${name}: inside the repository; keep keys outside it`); continue; }
    let st;
    try { st = lstatSync(path); } catch (e) { wrong.push(`${name}: cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})`); continue; }
    if (!st.isFile()) wrong.push(`${name}: not a regular file`);
    else if (isPrivate && (st.mode & 0o077) !== 0) wrong.push(`${name}: readable by others (chmod 600)`);
    else if (isPrivate && typeof process.getuid === "function" && st.uid !== process.getuid()) wrong.push(`${name}: belongs to another user`);
  }
  return wrong.length ? { name: "key files", ok: false, detail: wrong.join("; ") } : { name: "key files", ok: true, detail: "private to this user and outside the repository" };
}

/** The keys open: each error names its variable and what is wrong, never a key or a passphrase. */
function keysCheck(c: IccEnvConfig, env: Env): IccRunCheck {
  const wrong: string[] = [];
  const tryOpen = (f: () => unknown) => { try { f(); } catch (e) { wrong.push(e instanceof Error ? e.message : "error"); } };
  if (c.scheme === "jwt-p12") tryOpen(() => readPrivateKeyFile(c.jwtPrivateKeyFile ?? "", env.ICC_JWT_PRIVATE_KEY_PASSPHRASE || undefined, "ICC_JWT_PRIVATE_KEY_FILE"));
  else tryOpen(() => sharedSecretKey(env.ICC_SHARED_SECRET ?? ""));
  if (c.mle) {
    tryOpen(() => readPrivateKeyFile(c.mle!.responsePrivateKeyFile, env.ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE || undefined, "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE"));
    tryOpen(() => readRequestCertificate(c.mle!.requestCertFile, "ICC_MLE_REQUEST_CERT_FILE"));
  }
  const what = [c.scheme === "jwt-p12" ? "the signing key" : "the shared secret", ...(c.mle ? ["the response key", "the request certificate"] : [])];
  const listed = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0]!;
  return wrong.length ? { name: "keys", ok: false, detail: wrong.join("; ") } : { name: "keys", ok: true, detail: `${listed} open` };
}

/** The request certificate (a public file): its subject's serial number, and its validity for the clock check. */
function certificateOf(c: IccEnvConfig): X509Certificate | null {
  if (!c.mle) return null;
  try { return new X509Certificate(readFileSync(c.mle.requestCertFile)); } catch { return null; }
}

function serialCheck(c: IccEnvConfig, cert: X509Certificate | null): IccRunCheck {
  if (!c.mle) return { name: "serial number", ok: true, detail: "not needed: no Message-Level Encryption with this scheme" };
  if (!cert) return { name: "serial number", ok: false, detail: "ICC_MLE_REQUEST_CERT_FILE: not a PEM certificate" };
  return /^serialNumber=.+$/im.test(cert.subject)
    ? { name: "serial number", ok: true, detail: "found in the request certificate's subject (the key ID of encrypted requests)" }
    : { name: "serial number", ok: true, detail: "not in the subject; the certificate's own serial number is used, as the documentation's Java sample does" };
}

function clockCheck(now: Date, cert: X509Certificate | null): IccRunCheck {
  const at = now.toISOString();
  if (!Number.isFinite(now.getTime())) return { name: "clock", ok: false, detail: "this machine's clock gives no valid time" };
  if (cert && (now.getTime() < Date.parse(cert.validFrom) || now.getTime() > Date.parse(cert.validTo))) return { name: "clock", ok: false, detail: `${at} is outside the request certificate's validity` };
  return { name: "clock", ok: true, detail: `${at}${cert ? ", inside the request certificate's validity" : ""}; a token lives two minutes, so read 1 shows whether the service's clock agrees` };
}

function assuranceCheck(c: IccEnvConfig): IccRunCheck {
  if (!c.assuranceFile) return { name: "assurance file", ok: false, detail: "ICC_ASSURANCE_FILE is not set; the run needs it" };
  try {
    // Looked at for its field names only; the data is not kept beyond this call.
    const missing = missingAssuranceFields(readAssuranceFile(c.assuranceFile));
    return missing.length
      ? { name: "assurance file", ok: false, detail: `missing documented required fields: ${missing.join(", ")}` }
      : { name: "assurance file", ok: true, detail: "present and private, with every documented required field" };
  } catch (e) {
    return { name: "assurance file", ok: false, detail: e instanceof Error ? e.message : "cannot be read" };
  }
}

/** The configuration as the preflight reads it: the run's environment, without requiring the assurance file. */
function preflightConfig(env: Env): IccEnvConfig {
  const r = readIccEnv({ ...env, ICC_ASSURANCE_FILE: env.ICC_ASSURANCE_FILE || "-" }, "purchase");
  if (!r.config) throw new Error(`the environment is not complete (${iccEnvProblem(r)})`);
  return { ...r.config, assuranceFile: env.ICC_ASSURANCE_FILE || null };
}

export interface IccPreflightIo {
  db: DB;
  env: Env;
  say: (line: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** The preflight: the local checks, then at most two reads. Returns whether every check passed. */
export async function iccPreflight(io: IccPreflightIo): Promise<{ ok: boolean; checks: IccRunCheck[]; calls: number }> {
  const now = (io.now ?? (() => new Date()))();
  const c = preflightConfig(io.env);
  io.say("ICC preflight: no purchase; at most two read calls, both GET");
  const checks: IccRunCheck[] = [];
  const put = (k: IccRunCheck): IccRunCheck => { const c = { ...k, detail: k.detail.slice(0, 300) }; checks.push(c); io.say(line(c)); return c; };
  put({ name: "environment", ok: true, detail: "every name the chosen scheme (ICC_AUTH_SCHEME) needs is set" });
  const files = put(keyFilesCheck(c));
  const keys = put(keysCheck(c, io.env));
  const cert = certificateOf(c);
  const serial = put(serialCheck(c, cert));
  const clock = put(clockCheck(now, cert));
  put(assuranceCheck(c));

  const before = readCallLog(c.callLog).length;
  const local = files.ok && keys.ok && serial.ok && clock.ok;
  const skip = (name: string, why: string) => io.say(`skip  ${name}  ${why}`);
  if (!local) {
    skip("read 1", "not made: a local check above failed");
    skip("read 2", "not made: a local check above failed");
  } else {
    const { client } = iccClientFromEnv({ ...io.env, ICC_ASSURANCE_FILE: undefined }, "preflight", { fetchImpl: io.fetchImpl });
    const read = async (name: string, endpoint: string, f: () => Promise<{ httpStatus: number; state: string | null }>): Promise<boolean> => {
      try {
        const r = await f();
        return put({ name, ok: r.state === "ACTIVE", detail: `GET ${endpoint}: HTTP ${r.httpStatus}, state ${r.state ?? "not given"}` }).ok;
      } catch (e) {
        return put({ name, ok: false, detail: `GET ${endpoint}: ${e instanceof Error ? e.message : "error"}` }).ok;
      }
    };
    const first = await read("read 1", "/tms/v1/instrumentidentifiers/{id}", () => client.getInstrumentIdentifier(c.instrumentIdentifierId));
    if (!c.tokenizedCardId) skip("read 2", "GET /tms/v2/tokenized-cards/{id}: not made, ICC_TOKENIZED_CARD_ID is not set");
    else if (!first) skip("read 2", "GET /tms/v2/tokenized-cards/{id}: not made, read 1 failed");
    else await read("read 2", "/tms/v2/tokenized-cards/{id}", () => client.getTokenizedCard(c.tokenizedCardId!));
  }
  io.say(`note  ${ICC_PREFLIGHT_NOTE}`);
  const calls = readCallLog(c.callLog).length - before;
  const ok = checks.every((k) => k.ok);
  audit(io.db, "system", "icc.preflight", ICC_RUN_SUBJECT, { ok, checks: checks as unknown as Json, calls, host: ICC_TEST_HOST }, now);
  io.say(`ICC preflight: ${ok ? "every check passed" : `${checks.filter((k) => !k.ok).length} check(s) failed`}; ${calls} call(s) made`);
  return { ok, checks, calls };
}

// ---- the run ---------------------------------------------------------------------------------------------------------

export interface IccRunPurchase { amount: string; item: string; description: string }

/**
 * The run's two purchases at the rail's one merchant, in EUR: the sourcing agent's identity pays in EUR (and USDZ)
 * only. The documentation's examples use USD only; whether the sandbox takes EUR is open (docs/visa-icc.md, section
 * 10, number 12) and the first POST shows it. A is within the rail's hard cap; B is above it, so Purser refuses it
 * before any call.
 */
export const ICC_RUN_PLAN: { a: IccRunPurchase; b: IccRunPurchase } = {
  a: { amount: "12.00", item: "Trail map pack", description: "icc run A: within the limit" },
  b: { amount: "250.00", item: "Expedition tent", description: "icc run B: above the limit" },
};
const CURRENCY = "EUR";
const MERCHANT = ICC_MERCHANTS[0]!;

export interface IccAwaitCfo {
  db: DB;
  proposalId: string;
  /** The rail's dependencies from this environment, for a caller that runs the flow itself. */
  deps: IccDeps;
}

export interface IccRunIo {
  db: DB;
  env: Env;
  say: (line: string) => void;
  /** Waits until the CFO decided and the runner ran the proposal; returns its final status. */
  awaitCfo: (o: IccAwaitCfo) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  plan?: { a?: Partial<IccRunPurchase>; b?: Partial<IccRunPurchase> };
}

/** Why the run may not start in this ledger: no passkey to approve with, or a run already in it. Empty when it may. */
export function iccRunRefusals(db: DB): string[] {
  const why: string[] = [];
  if (!activePasskey(db)) why.push("no passkey is enrolled in this ledger: the CFO enrols one on the relay first (npm run relay -- --enrol), so that only Face ID can approve");
  if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'icc.run_started' LIMIT 1").get()) why.push("this ledger already holds an ICC run; a new run needs a fresh icc ledger");
  return why;
}

const order = (paymentMethodId: string, p: IccRunPurchase): IccPurchaseRequest => ({
  agent: "sourcing", paymentMethodId, merchantName: MERCHANT.name, merchantUrl: MERCHANT.url, merchantCountry: MERCHANT.country,
  amount: p.amount, currency: CURRENCY, items: [{ name: p.item, unitPrice: p.amount, quantity: "1" }], description: p.description,
});

/** Purchase A, then attempt B. The caller has checked iccGuard and iccRunRefusals. Returns whether every check passed. */
export async function iccRun(io: IccRunIo): Promise<{ ok: boolean; checks: IccRunCheck[] }> {
  const clock = io.now ?? (() => new Date());
  // The keys open and the environment is complete before anything is filed (an error names a variable, not a value).
  const { client, config } = iccClientFromEnv(io.env, "purchase", { fetchImpl: io.fetchImpl });
  const deps: IccDeps = { client, passthrough: () => readAssuranceFile(config.assuranceFile ?? ""), say: io.say, env: io.env };
  const plan = { a: { ...ICC_RUN_PLAN.a, ...io.plan?.a }, b: { ...ICC_RUN_PLAN.b, ...io.plan?.b } };
  const log = () => readCallLog(config.callLog);
  const books = journal(io.db).length;
  const note = (event: string, subject: string, payload: Record<string, Json>) => audit(io.db, "system", event, subject, payload, clock());

  note("icc.run_started", ICC_RUN_SUBJECT, { budget: config.budget, host: client.host, calls_before: log().length, plan: { a: plan.a.amount, b: plan.b.amount, currency: CURRENCY } });
  io.say("ICC run: purchase A within the limit, then attempt B above it");

  // A: filed for the CFO, signed with the passkey over its exact terms, run by the runner.
  note("icc.run_attempt", "A", { label: "A" });
  const aStart = log().length;
  const a = await requestIccPurchase(io.db, order(config.instrumentIdentifierId, plan.a), clock(), io.env);
  const aFiledCalls = log().length - aStart;
  let aEnd = "not filed";
  let aWho = `${plan.a.amount} ${CURRENCY} at ${MERCHANT.name}`;
  if (a.status === "pending_approval") {
    note("icc.run_filed", a.proposalId, { label: "A", proposal_id: a.proposalId });
    io.say(`A     ${aWho}: filed as ${a.proposalId}; it waits for the CFO's passkey over its exact terms`);
    aEnd = await io.awaitCfo({ db: io.db, proposalId: a.proposalId, deps });
    aWho = a.proposalId;
  }
  const aLines = log().slice(aStart);
  const aRow = a.status === "pending_approval"
    ? io.db.prepare("SELECT status, code FROM icc_purchases WHERE proposal_id = ?").get(a.proposalId) as { status: string; code: string | null } | undefined
    : undefined;
  const received = aRow?.status === "CREDENTIAL_RECEIVED_NOT_USED";
  io.say(`A     ${aWho} ${aEnd}: ${received ? `${ICC_NOT_USED}; no payment was made` : describe(a, aRow)}`);

  // B: above the limit. Purser refuses it before any call.
  note("icc.run_attempt", "B", { label: "B" });
  const bStart = log().length;
  const b = await requestIccPurchase(io.db, order(config.instrumentIdentifierId, plan.b), clock(), io.env);
  const bCalls = log().length - bStart;
  if (b.status === "pending_approval") note("icc.run_filed", b.proposalId, { label: "B", proposal_id: b.proposalId });
  io.say(`B     ${plan.b.amount} ${CURRENCY} at ${MERCHANT.name}: ${b.status === "refused" ? `refused by ${b.by === "purser" ? "Purser" : "the service"} before any call (${b.code})` : `not refused: ${b.status}`}; ${bCalls} call${bCalls === 1 ? "" : "s"}`);

  // The checks, from the ledger and the call log.
  const prefix = config.pathPrefix;
  const approval = a.status === "pending_approval"
    ? io.db.prepare("SELECT a.method, a.approved_sha256, p.terms_sha256 FROM approvals a JOIN proposals p ON p.proposal_id = a.proposal_id WHERE a.proposal_id = ? AND a.decision = 'APPROVED'").get(a.proposalId) as { method: string; approved_sha256: string; terms_sha256: string } | undefined
    : undefined;
  const aCalls = aLines.map((l) => `${l.method} ${l.endpoint}`);
  const confirmations = log().filter((l) => l.endpoint.endsWith("/confirmations")).length;
  const checks: IccRunCheck[] = [
    { name: "a_waited_for_cfo", ok: a.status === "pending_approval" && aFiledCalls === 0, detail: a.status === "pending_approval" ? `A was filed as ${a.proposalId} for the CFO, with ${aFiledCalls} call(s) before the approval` : `A was not filed for the CFO (${a.status}${"code" in a ? ` ${a.code}` : ""})` },
    { name: "a_cfo_signed_exact_terms", ok: !!approval && approval.approved_sha256 === approval.terms_sha256, detail: approval ? `approved with ${approval.method} over the terms hash ${approval.terms_sha256.slice(0, 12)}…${approval.approved_sha256 === approval.terms_sha256 ? "" : ", which is NOT the approved hash"}` : "no approval of A is recorded" },
    { name: "a_credential_received_not_used", ok: received, detail: received ? `${ICC_NOT_USED}; the flow stopped before checkout` : `A ended ${aEnd}${aRow ? ` (${aRow.status}${aRow.code ? `, ${aRow.code}` : ""})` : ""}` },
    { name: "a_two_calls", ok: aCalls.join(",") === [`POST ${prefix}/instructions`, `POST ${prefix}/instructions/{id}/credentials`].join(","), detail: `A's calls: ${aCalls.length ? aCalls.join(", ") : "none"}` },
    { name: "b_refused_before_any_call", ok: b.status === "refused" && b.by === "purser" && b.code === "PURSER_ABOVE_HARD_CAP" && bCalls === 0, detail: `B: ${b.status}${"code" in b ? ` ${b.code}` : ""}, ${bCalls} call(s)` },
    { name: "nothing_paid", ok: journal(io.db).length === books && confirmations === 0, detail: `${journal(io.db).length - books} journal line(s) added, ${confirmations} confirmation call(s)` },
  ];
  for (const k of checks) io.say(line(k));
  const ok = checks.every((k) => k.ok);
  note("icc.run_checks", ICC_RUN_SUBJECT, { ok, checks: checks as unknown as Json, calls_after: log().length });
  io.say(ok ? "ICC run: every check passed" : `ICC run: ${checks.filter((k) => !k.ok).length} check(s) failed`);
  return { ok, checks };
}

function describe(o: IccOutcome, row: { status: string; code: string | null } | undefined): string {
  if (row) return `${row.status.toLowerCase().replaceAll("_", " ")}${row.code ? ` (${row.code})` : ""}`;
  if (o.status === "refused") return `refused by ${o.by === "purser" ? "Purser" : "the service"} (${o.code})`;
  return o.status === "pending_approval" ? "not run" : o.status;
}

/** Proposal states after which nothing more happens to it (as src/airi/deps.ts PROPOSAL_DONE). */
const DONE = ["EXECUTED", "FAILED", "REJECTED", "EXPIRED", "NEEDS_REAPPROVAL", "SUPERSEDED"];

/**
 * The live wait for A: the CFO approves on the phone and the runner (npm run relay, with this environment) runs the
 * flow. Returns the proposal's final status, or says how long it waited. A notice each minute, without values.
 */
export async function waitForOutcome(db: DB, id: string, o: { log: (line: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void>; waitMs?: number; pollMs?: number }): Promise<string> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = o.waitMs ?? 35 * 60_000;
  const start = now();
  let notice = start;
  for (;;) {
    const s = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status ?? "MISSING";
    if (DONE.includes(s)) return s;
    if (now() - start >= waitMs) return `still ${s} after ${Math.round(waitMs / 60_000)} min`;
    if (now() - notice >= 60_000) { notice = now(); o.log(`wait  ${id} is ${s}; waiting for the CFO's Face ID and the runner`); }
    await sleep(o.pollMs ?? 2_000);
  }
}

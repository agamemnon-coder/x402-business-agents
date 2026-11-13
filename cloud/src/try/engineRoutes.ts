// The hands-on demo's engine routes: one block of the route table (cloud/src/app.ts ROUTES), behind the cloud's own
// gates like the engine's block (cloud/src/engine/routes.ts): the caller's own company, its scope, the same-origin
// check on writes, and for a visitor's test company the try-only list (./gate.ts). 404 while no engine is wired.
//   GET  /v1/engine/samples         the sample invoices, in the tray's order
//   POST /v1/engine/samples/{key}   a sample through the inbox
//   GET  /v1/engine/suppliers       the suppliers the seed put on file (test IBANs)
//   POST /v1/engine/compose         "write your own" (a test company only)
//   GET  /v1/engine/proposals/{id}/terms   the signed terms, their canonical text and hash
//   POST /v1/engine/proposals/{id}/pay     the one pay route: the visitor's terms with the visitor's own signature (a test company only)
//   GET  /v1/engine/export          the company in the product's sync format, as a file
// Only the engine's interface is imported (types): nothing of the engine reaches the Worker's bundle through this file.
import { z } from "zod";
import { AuthError, bump } from "../auth.js";
import { randomToken } from "../crypto.js";
import type { Sql } from "../store.js";
import { BadRequest } from "../read.js";
import type { EngineApi } from "../engine/api.js";
import type { EngineCtx, EngineKit, EngineRoute } from "../engine/routes.js";
import { tallyFiled, tallyPay } from "./counter.js";
import { noteReader } from "./metrics.js";
import { normaliseAmount } from "./amount.js";
import { isTryTenant, TryRefused } from "./start.js";

/** What these routes need of the request's context beyond the engine's: the cloud's database and the request's time. */
export interface TryEngineCtx extends EngineCtx { env: EngineCtx["env"] & { sql: Sql }; now: Date }

/** Per test company, over its whole life: pay attempts and exports. */
export const PAYS_PER_COMPANY = 30;
export const EXPORTS_PER_COMPANY = 5;
export const PAY_BODY_MAX_BYTES = 8_000;
export const CREDENTIAL_MAX_BYTES = 4_096;
export const EXPORT_MAX_BYTES = 5_000_000;

/** One more of something a test company may do only so often in its life; past the limit, a 429 a person can read. */
async function countFor(c: TryEngineCtx, what: string, max: number, sentence: string): Promise<void> {
  const tenant = c.caller!.tenantId;
  const row = await c.env.sql.first<{ created_at: string }>("SELECT created_at FROM try_companies WHERE tenant_id = ?", [tenant]);
  const born = Math.floor(Date.parse(row?.created_at ?? c.now.toISOString()) / 1000);
  if ((await bump(c.env.sql, `${what}:${tenant}`, born, 1)) > max) throw new TryRefused(429, "limit", sentence);
}

/** The Airwallex sandbox calls written for a proposal since a moment (the rail's ledger, C9); 0 while it does not exist. */
async function sandboxCalls(sql: Sql, tenant: string, proposalId: string, since: string): Promise<number> {
  try {
    return Number((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_rail_calls WHERE tenant_id = ? AND proposal_id = ? AND at >= ?", [tenant, proposalId, since]))?.n ?? 0);
  } catch { return 0; }
}

/** What the inbox refuses (not a PDF, too large, the company's document cap) is said in its own words, as a 400. */
async function filed<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (x) {
    const said = x instanceof Error ? x.message : String(x);
    if (/nothing was filed$/.test(said)) throw new BadRequest(said.slice(0, 500));
    throw x;
  }
}

/** The counter's tallies and who read the invoice (./counter.ts, ./metrics.ts); neither ever fails the request. */
async function counted(c: TryEngineCtx, out: Awaited<ReturnType<EngineApi["compose"]>> | null): Promise<void> {
  await tallyFiled(c.env.sql, out, c.now);
  if (out && !("refused" in out)) await noteReader(c.env.sql, out.invoice?.read_by, c.now);
}

const field = (max: number) => z.string().max(max);
const Compose = z.object({ supplier_key: field(40), invoice_no: field(64), amount: field(32), issue_date: field(32), due_date: field(32), iban: field(64) }).strict();

/** This block's routes, by method and path (the engine's own block is cloud/src/engine/routes.ts). */
export const TRY_ENGINE_ROUTES = ["GET /v1/engine/samples", "POST /v1/engine/samples/{key}", "GET /v1/engine/suppliers", "POST /v1/engine/compose",
  "GET /v1/engine/proposals/{id}/terms", "POST /v1/engine/proposals/{id}/pay", "GET /v1/engine/export"] as const;

const Pay = z.object({ terms: z.record(z.string(), z.unknown()), credential: z.record(z.string(), z.unknown()) }).strict();

export function tryEngineRoutes<C extends TryEngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  const on = (run: (c: C, engine: EngineApi) => Promise<Response>) => async (c: C): Promise<Response> => {
    const engine = c.env.engine?.(c.caller!.tenantId);
    return engine ? run(c, engine) : err(404, "the engine is not switched on for this cloud");
  };
  return [
    { method: "GET", path: "/v1/engine/samples", summary: "The hands-on demo's sample invoices, in the tray's order: { items: [{ key, title, filename }] }. Each title says what you do, never what the engine will answer. Test invoices (fake).", need: "read", run: on(async (_c, e) => json(200, { items: await e.samples() })) },
    { method: "POST", path: "/v1/engine/samples/{key}", summary: "Send a sample invoice to the engine's inbox, as an upload of its PDF: answers as POST /v1/engine/documents ({ kind, sha256, invoice }); 404 for a key that is not a sample; 400 in the engine's words when it is refused (a test company's limit of 8 documents).", need: "admin", run: on(async (c, e) => {
      const out = await filed(() => e.uploadSample(c.params[0]!));
      await counted(c, out);
      return out ? json(200, out) : err(404, "no such sample");
    }) },
    { method: "GET", path: "/v1/engine/suppliers", summary: "The suppliers the company has on file, as the engine's seed recorded them: { items: [{ key, name, iban, bic }] }. Their IBANs are published test IBANs, not anyone's account.", need: "read", run: on(async (_c, e) => json(200, { items: await e.suppliers() })) },
    { method: "POST", path: "/v1/engine/compose", summary: "Write your own invoice (a test company of the hands-on demo only): { supplier_key, invoice_no, amount (100.00 to 5000.00; written as people write it, such as 1850.00, 1.850,00 or 1k, read as two decimals), issue_date, due_date (YYYY-MM-DD, within 60 days of today), iban (mod 97) }. It is written in the sample's layout (an enterprise invoice, src/engine/invoicePdf.ts), rendered to a PDF inside the engine and filed through its inbox: answers as POST /v1/engine/documents; a refused field is 400 { code, message, field }.", need: "admin", run: on(async (c, e) => {
      if (!isTryTenant(c.caller!.tenantId)) throw new AuthError(403, "only a test company of the hands-on demo writes its own invoice here");
      const b = await kit.body(c, Compose, 4_000);
      // The amount as people write it (10k, 1.850,00, € 10.000,00), read as the page reads it (./amount.ts), so a page
      // cached before the page read it works too; what cannot be read goes on as sent, to the engine's strict check.
      const amount = normaliseAmount(b.amount);
      const out = await filed(() => e.compose(amount === null ? b : { ...b, amount }));
      await counted(c, out);
      if ("refused" in out) return json(400, { error: out.refused.message, code: `invalid_${out.refused.field}`, message: out.refused.message, field: out.refused.field });
      return json(200, out);
    }) },
    { method: "GET", path: "/v1/engine/proposals/{id}/terms", summary: "A proposal's exact terms as the passkey signs them: { proposal_id, status, terms, canonical (the canonical JSON), terms_sha256 (its SHA-256, the signature's challenge), approved (whether an approval is stored), expires_at }; 404 for a proposal the company's engine does not hold.", need: "read", run: on(async (c, e) => {
      const t = await e.terms(c.params[0]!);
      return t ? json(200, t) : err(404, "no proposal");
    }) },
    { method: "POST", path: "/v1/engine/proposals/{id}/pay", summary: "Pay with your signature (a test company of the hands-on demo only; at most 8 KB, 30 a company): { terms, credential } with the terms to pay (only amount, beneficiary_name and iban_last4 may differ from the signed ones) and the passkey's signature this browser made at the approval. Two layers answer, always both: the product's verifier on that signature over the sent terms, and the executor's own gate asked with the sent terms (inside a transaction that is always rolled back). Only when both say yes is the held payment run, from the stored terms, on the simulated bank (test money). Answers { outcome (paid, refused, paid_once, not_signed, expired, failed), layers, signed_sha256, sent_sha256, changed, transfers_before, transfers_after, sandbox_calls, settled, request_id }; 400 when the terms' shape does not fit.", need: "admin", run: on(async (c, e) => {
      if (!isTryTenant(c.caller!.tenantId)) throw new AuthError(403, "only a test company of the hands-on demo pays through this route; approve pays at once elsewhere");
      const since = c.now.toISOString();
      const b = await kit.body(c, Pay, PAY_BODY_MAX_BYTES);
      if (JSON.stringify(b.credential).length > CREDENTIAL_MAX_BYTES) throw new BadRequest(`the credential is larger than ${CREDENTIAL_MAX_BYTES} bytes`);
      if (!(await e.proposal(c.params[0]!))) return err(404, "no proposal");
      await countFor(c, "trypay", PAYS_PER_COMPANY, `This test company has tried to pay ${PAYS_PER_COMPANY} times, its limit. Start a new one to try again.`);
      const out = await e.paySigned(c.params[0]!, b.terms, b.credential);
      await tallyPay(c.env.sql, out, c.now);
      if (!out) return err(404, "no proposal");
      if ("bad" in out) return json(400, { error: out.bad, code: "bad_terms", message: out.bad });
      return json(200, { ...out, sandbox_calls: await sandboxCalls(c.env.sql, c.caller!.tenantId, c.params[0]!, since), request_id: `req_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}` });
    }) },
    { method: "GET", path: "/v1/engine/export", summary: "Download the company in the product's sync format (purser.cloud-sync/v1): { format, company, made_at, batches }, the batches a runner's push sends (the invoices with their documents, payments, transactions, the ledger and the audit log), as a file. No archive files. At most 5 MB; a test company may download it 5 times.", need: "read", run: on(async (c, e) => {
      if (isTryTenant(c.caller!.tenantId)) await countFor(c, "tryexport", EXPORTS_PER_COMPANY, `This test company was downloaded ${EXPORTS_PER_COMPANY} times, its limit.`);
      const text = JSON.stringify(await e.exportBatch());
      if (new TextEncoder().encode(text).byteLength > EXPORT_MAX_BYTES) return err(413, `the company's export is larger than ${EXPORT_MAX_BYTES / 1_000_000} MB`);
      return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="purser-test-company.json"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }) },
  ];
}

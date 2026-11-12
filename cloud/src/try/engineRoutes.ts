// The hands-on demo's engine routes: one block of the route table (cloud/src/app.ts ROUTES), behind the cloud's own
// gates like the engine's block (cloud/src/engine/routes.ts): the caller's own company, its scope, the same-origin
// check on writes, and for a visitor's test company the try-only list (./gate.ts). 404 while no engine is wired.
//   GET  /v1/engine/samples         the sample invoices, in the tray's order
//   POST /v1/engine/samples/{key}   a sample through the inbox
//   GET  /v1/engine/suppliers       the suppliers the seed put on file (test IBANs)
//   POST /v1/engine/compose         "write your own" (a test company only)
// Only the engine's interface is imported (types): nothing of the engine reaches the Worker's bundle through this file.
import { z } from "zod";
import { AuthError } from "../auth.js";
import { BadRequest } from "../read.js";
import type { EngineApi } from "../engine/api.js";
import type { EngineCtx, EngineKit, EngineRoute } from "../engine/routes.js";
import { isTryTenant } from "./start.js";

/** What the inbox refuses (not a PDF, too large, the company's document cap) is said in its own words, as a 400. */
async function filed<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (x) {
    const said = x instanceof Error ? x.message : String(x);
    if (/nothing was filed$/.test(said)) throw new BadRequest(said.slice(0, 500));
    throw x;
  }
}

const field = (max: number) => z.string().max(max);
const Compose = z.object({ supplier_key: field(40), invoice_no: field(64), amount: field(32), issue_date: field(32), due_date: field(32), iban: field(64) }).strict();

/** This block's routes, by method and path (the engine's own block is cloud/src/engine/routes.ts). */
export const TRY_ENGINE_ROUTES = ["GET /v1/engine/samples", "POST /v1/engine/samples/{key}", "GET /v1/engine/suppliers", "POST /v1/engine/compose"] as const;

export function tryEngineRoutes<C extends EngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  const on = (run: (c: C, engine: EngineApi) => Promise<Response>) => async (c: C): Promise<Response> => {
    const engine = c.env.engine?.(c.caller!.tenantId);
    return engine ? run(c, engine) : err(404, "the engine is not switched on for this cloud");
  };
  return [
    { method: "GET", path: "/v1/engine/samples", summary: "The hands-on demo's sample invoices, in the tray's order: { items: [{ key, title, filename }] }. Each title says what you do, never what the engine will answer. Test invoices (fake).", need: "read", run: on(async (_c, e) => json(200, { items: await e.samples() })) },
    { method: "POST", path: "/v1/engine/samples/{key}", summary: "Send a sample invoice to the engine's inbox, as an upload of its PDF: answers as POST /v1/engine/documents ({ kind, sha256, invoice }); 404 for a key that is not a sample; 400 in the engine's words when it is refused (a test company's limit of 8 documents).", need: "admin", run: on(async (c, e) => {
      const out = await filed(() => e.uploadSample(c.params[0]!));
      return out ? json(200, out) : err(404, "no such sample");
    }) },
    { method: "GET", path: "/v1/engine/suppliers", summary: "The suppliers the company has on file, as the engine's seed recorded them: { items: [{ key, name, iban, bic }] }. Their IBANs are published test IBANs, not anyone's account.", need: "read", run: on(async (_c, e) => json(200, { items: await e.suppliers() })) },
    { method: "POST", path: "/v1/engine/compose", summary: "Write your own invoice (a test company of the hands-on demo only): { supplier_key, invoice_no, amount (1.00 to 5000.00, two decimals), issue_date, due_date (YYYY-MM-DD, within 60 days of today), iban (mod 97) }. It is written in the sample's layout, rendered to a PDF inside the engine and filed through its inbox: answers as POST /v1/engine/documents; a refused field is 400 { code, message, field }.", need: "admin", run: on(async (c, e) => {
      if (!isTryTenant(c.caller!.tenantId)) throw new AuthError(403, "only a test company of the hands-on demo writes its own invoice here");
      const b = await kit.body(c, Compose, 4_000);
      const out = await filed(() => e.compose(b));
      if ("refused" in out) return json(400, { error: out.refused.message, code: `invalid_${out.refused.field}`, message: out.refused.message, field: out.refused.field });
      return json(200, out);
    }) },
  ];
}

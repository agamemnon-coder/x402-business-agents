// The hands-on deployment's own routes (/v1/try/*): one block of the route table (cloud/src/app.ts ROUTES). They
// answer 404 unless the deployment runs the hands-on demo (CloudEnv.tryIt, HANDS_ON=on) and an engine.
//   POST /v1/try/start     public: a visitor's test company (./start.ts)
//   POST /v1/try/session   public: a fresh session with the visitor's token, per company, never per address
//   POST /v1/try/admin     the platform admin's token: switches, counters and pool tokens (./admin.ts)
// Every refusal has the cloud's error shape plus `message`: { error, code, message }, with a sentence a person can read.
import { z } from "zod";
import type { EngineApi } from "../engine/api.js";
import type { Sql } from "../store.js";
import { adminOp, AdminOp } from "./admin.js";
import { renewSession, startCompany, type TryConfig } from "./start.js";

export interface TryCtx {
  env: { sql: Sql; sessionSecret: string; engine?: (tenantId: string) => EngineApi; tryIt?: TryConfig };
  req: Request;
  now: Date;
}

export interface TryKit<C extends TryCtx> {
  json(status: number, body: unknown): Response;
  err(status: number, error: string): Response;
  body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T>;
}

export interface TryRoute<C extends TryCtx> { method: "POST"; path: string; summary: string; need: "public" | "platform"; run: (c: C) => Promise<Response> }

/** A try refusal in the cloud's shape, with its own stable code and the sentence again as `message`. */
export const tryError = (json: (status: number, body: unknown) => Response, status: number, code: string, message: string): Response => json(status, { error: message, code, message });

const Start = z.object({ token: z.string().min(1).max(200).optional() }).strict();
const Session = z.object({ tenant_id: z.string().min(1).max(80), visitor_token: z.string().min(1).max(200) }).strict();

export function tryRoutes<C extends TryCtx>(kit: TryKit<C>): TryRoute<C>[] {
  const { json, err } = kit;
  const live = (run: (c: C, engine: (tenantId: string) => EngineApi, config: TryConfig) => Promise<Response>) => async (c: C): Promise<Response> =>
    c.env.tryIt && c.env.engine ? run(c, c.env.engine, c.env.tryIt) : err(404, "the hands-on demo is not on this deployment");
  return [
    { method: "POST", path: "/v1/try/start", summary: "Start a test company of your own on Purser's engine (test money, a simulated bank, deleted after 24 hours): { token? } (an event or jury token). Answers 201 { tenant, session, visitor_token, expires_at, session_expires_at, company, pool, mode }; 429 { code: limit } over a limit; 503 { code: paused } while the demo is paused.", need: "public", run: live(async (c, engine, config) => {
      const b = await kit.body(c, Start, 2_000);
      const ip = c.req.headers.get("cf-connecting-ip") ?? "unknown";
      return json(201, await startCompany({ sql: c.env.sql, engine, config, secret: c.env.sessionSecret, ip, ...(b.token ? { token: b.token } : {}), now: c.now }));
    }) },
    { method: "POST", path: "/v1/try/session", summary: "A fresh 15-minute session for your test company: { tenant_id, visitor_token }. Answers { session, expires_at (the session's end), company_expires_at }; 410 { code: gone } once the company was deleted. Limited per company, never per address.", need: "public", run: live(async (c) => {
      const b = await kit.body(c, Session, 2_000);
      return json(200, await renewSession({ sql: c.env.sql, secret: c.env.sessionSecret, tenantId: b.tenant_id, visitorToken: b.visitor_token, now: c.now }));
    }) },
    { method: "POST", path: "/v1/try/admin", summary: "The hands-on deployment's controls (the platform admin's token): { op: get } the switches and today's counters; { op: set, key, value } one switch within its ceiling; { op: token, pool, until } a new event or jury token, shown once.", need: "platform", run: live(async (c) => {
      const op = await kit.body(c, AdminOp, 8_000);
      return json(200, await adminOp(c.env.sql, op, c.now));
    }) },
  ];
}

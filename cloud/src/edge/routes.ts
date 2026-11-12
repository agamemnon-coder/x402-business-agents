// The routes of cloud/src/edge/: one block of the route table (cloud/src/app.ts ROUTES), behind the cloud's own gates.
//   GET /v1/autopilot  (read)    the company's nightly runs and their digests; the company is always the caller's own.
//   GET /v1/stats      (public)  the cloud's own counters per day, across every company; no company's data.
import type { Caller } from "../auth.js";
import { BadRequest } from "../read.js";
import type { Sql } from "../store.js";
import { autopilotRuns } from "./autopilot.js";
import { dailyCounts, METRICS } from "./stats.js";

export interface EdgeCtx {
  env: { sql: Sql; engine?: unknown; edge?: { stats?: boolean } };
  url: URL;
  now: Date;
  caller: Caller | null;
}

export interface EdgeRoute<C extends EdgeCtx> { method: "GET"; path: string; summary: string; need: "public" | "read"; run: (c: C) => Promise<Response> }

/** A whole number from the query, or the default when it is not there. */
function whole(c: EdgeCtx, name: string, min: number, max: number, fallback: number): number {
  const raw = c.url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= min && n <= max)) throw new BadRequest(`${name} is a whole number from ${min} to ${max}`);
  return n;
}

export function edgeRoutes<C extends EdgeCtx>(kit: { json(status: number, body: unknown): Response; err(status: number, error: string): Response }): EdgeRoute<C>[] {
  const { json, err } = kit;
  return [
    { method: "GET", path: "/v1/autopilot", summary: "The company's nightly autopilot (the Cron Trigger's first firing each UTC day): each day its engine follows the payments, books and archives, and writes a digest: invoices by status, the overdue ones, payments waiting for an approval, whether both hash chains verify. It never pays. ?limit=<1 to 90> (default 14); { items }, newest first. 404 when the cloud runs no engine.", need: "read", run: async (c) => {
      if (!c.env.engine) return err(404, "the engine is not switched on for this cloud");
      return json(200, { items: await autopilotRuns(c.env.sql, c.caller!.tenantId, whole(c, "limit", 1, 90, 14)) });
    } },
    { method: "GET", path: "/v1/stats", summary: "The cloud's own counters per day (UTC), across every company and about none of them: requests, refused (401, 403), rate_limited (429), errors (5xx), uploads, payments_filed, approvals, engine_refusals. ?days=<1 to 90> (default 14); { metrics, days }, newest first. 404 when the counters are off.", need: "public", run: async (c) => {
      if (!c.env.edge?.stats) return err(404, "the counters are not switched on for this cloud");
      const days = await dailyCounts(c.env.sql, c.now, whole(c, "days", 1, 90, 14));
      return new Response(JSON.stringify({ metrics: METRICS, days }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
    } },
  ];
}

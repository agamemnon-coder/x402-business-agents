// The demo extras' routes (the try-extras stream), added to the /v1/try block by one line in ./routes.ts:
//   GET  /v1/try/counter    public, switch `counter`: the live counter (./counter.ts), about 60 s old at most
//   POST /v1/try/feedback   public, switch `feedback`: one anonymous choice and an optional note (./feedback.ts)
//   GET  /v1/try/ops        public: the owner's page, with no figure in it (./adminPage.ts)
//   POST /v1/try/ops        the platform admin's token: the page's aggregates (read only)
// A switch that is off, or a table of switches that cannot be read, answers 404 as if the route were not there.
import { z } from "zod";
import { randomToken } from "../crypto.js";
import type { EngineApi } from "../engine/api.js";
import type { Sql } from "../store.js";
import { adminPageHeaders, adminPageHtml, adminStats } from "./adminPage.js";
import { cachedCounter, counterLine } from "./counter.js";
import { FEEDBACK_CHOICES, FEEDBACK_NOTE_MAX, leaveFeedback } from "./feedback.js";
import type { TryConfig } from "./start.js";
import type { TryCtx, TryKit, TryRoute } from "./routes.js";
import { on, readSwitches } from "./switches.js";

const Feedback = z.object({ choice: z.enum(FEEDBACK_CHOICES), note: z.string().max(FEEDBACK_NOTE_MAX * 2).optional() }).strict();

async function switchOn(sql: Sql, key: string): Promise<boolean> {
  try { return on(await readSwitches(sql), key); } catch { return false; }
}

type Live<C extends TryCtx> = (run: (c: C, engine: (tenantId: string) => EngineApi, config: TryConfig) => Promise<Response>) => (c: C) => Promise<Response>;

export function tryExtraRoutes<C extends TryCtx>(kit: TryKit<C>, live: Live<C>): TryRoute<C>[] {
  const { json, err } = kit;
  const off = () => err(404, "no such route");
  return [
    { method: "GET", path: "/v1/try/counter", summary: "The hands-on demo's live counter, counted from its own tallies (no ids, no addresses): { played, caught, signed, without_signature, since, counted_at, line }. without_signature is counted, never typed. Up to about 60 seconds old.", need: "public", run: live(async (c) => {
      if (!(await switchOn(c.env.sql, "counter"))) return off();
      const n = await cachedCounter(c.env.sql, c.now);
      const r = json(200, { ...n, line: counterLine(n) });
      r.headers.set("cache-control", "public, max-age=60");
      return r;
    }) },
    { method: "POST", path: "/v1/try/feedback", summary: "Anonymous feedback on the hands-on demo: { choice: useful | unclear | broken, note? (at most 200 characters kept) }. Kept with its hour only: no id, no address, no browser. Never shown back publicly. 3 an hour per network.", need: "public", run: live(async (c) => {
      if (!(await switchOn(c.env.sql, "feedback"))) return off();
      const b = await kit.body(c, Feedback, 2_000);
      const ip = c.req.headers.get("cf-connecting-ip") ?? "unknown";
      return json(200, await leaveFeedback({ sql: c.env.sql, ip, choice: b.choice, ...(b.note !== undefined ? { note: b.note } : {}), now: c.now }));
    }) },
    { method: "GET", path: "/v1/try/ops", summary: "The owner's read-only page during judging. The page holds no figure; it asks for the admin token and reads POST /v1/try/ops.", need: "public", run: live(async () => {
      const nonce = randomToken(16);
      return new Response(adminPageHtml(nonce), { status: 200, headers: adminPageHeaders(nonce) });
    }) },
    { method: "POST", path: "/v1/try/ops", summary: "The owner's read-only aggregates (the platform admin's token): starts and finishes in the last hour and day, errors by kind, p50 and p95 latency (bucket bounds), Claude spend today against the caps, who read the invoices, the switches (tokens as a count), the feedback box. No addresses, no ids.", need: "platform", run: live(async (c) => json(200, await adminStats(c.env.sql, c.now))) },
  ];
}

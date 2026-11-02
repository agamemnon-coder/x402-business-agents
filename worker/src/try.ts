// POST /api/try: Try Purser on the relay, for anyone, with no key. It runs in its own Durable Object (its own
// storage, apart from the approvals) and guards the one thing a public page could cost us, the Claude calls:
// at most 6 tries a minute and 40 a day from one address, 280 characters a try, only from this site's own page,
// at most 60 model calls a minute from everyone together (a typed task counts two, a world change five), and a budget per UTC day for the models; past either of the
// last two, code alone reads the request and the page says so. A world change (D21) is one try too: one wake of the
// Sourcing agent, at most five model calls, under the same limits. Nothing
// here reaches Airwallex, Metal or the runner: the demo world is simulated (src/try/engine.ts).

import { claudeAgentAsk, claudeModels } from "../../src/try/claude.js";
import { tryWorld, worldChange, type AgentAsk } from "../../src/try/world.js";
import { TRY_MAX_CHARS, tryPurserSafely } from "../../src/try/engine.js";
import { COMMON_HEADERS, rateKey } from "./core.js";

interface Sql { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } }

export const TRY_PER_MINUTE = 6;
export const TRY_PER_DAY = 40;
/** Model calls a minute for all visitors together: many addresses at once cannot burn the day's budget in minutes. */
export const TRY_MODEL_PER_MINUTE = 60;
/** The model calls a try may make: a typed task two (Haiku sorts, Sonnet reads), a world change up to five (D21). */
export const TRY_CALLS = { text: 2, world: 5 } as const;
/** A world change's wake ends after this long: no new model call starts past it. */
export const TRY_WORLD_DEADLINE_MS = 30_000;
/** Model spend allowed per UTC day, in US dollars. */
export const TRY_DAILY_BUDGET_USD = 3;

// The relay's common headers (HSTS, nosniff, no-store, no-referrer) on every answer, as on the rest of the Worker (HF2).
const headers = { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" };
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

export class TryDesk {
  private readonly now: () => Date;

  constructor(private readonly sql: Sql, private readonly opts: { anthropicKey?: string; budgetUsd?: number; fetcher?: typeof fetch; now?: () => Date }) {
    this.now = opts.now ?? (() => new Date());
    this.sql.exec("CREATE TABLE IF NOT EXISTS try_hits (ip TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS try_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL, tries INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS try_model (at INTEGER NOT NULL, n INTEGER NOT NULL)");
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return answer(405, { error: "use POST" });
    // Only the page on this site may ask: a browser on another site sends its own origin, or cross-site.
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    if ((origin && origin !== url.origin) || req.headers.get("sec-fetch-site") === "cross-site") return answer(403, { error: "ask from the Try Purser page" });
    const raw = await req.text();
    if (raw.length > 2_000) return answer(413, { error: `at most ${TRY_MAX_CHARS} characters` });
    let text = "";
    let world: string | null = null;
    try {
      const body = JSON.parse(raw) as { text?: unknown; world?: unknown };
      // D21: a world change instead of a typed task; only the five known ids.
      if ("world" in body) {
        if (typeof body.world !== "string" || !worldChange(body.world)) return answer(400, { error: "pick one of the world changes on the page" });
        world = body.world;
      } else {
        if (typeof body.text !== "string") throw new Error();
        text = body.text.trim();
      }
    } catch {
      return answer(400, { error: "send {\"text\": \"...\"}" });
    }
    if (world === null && !text) return answer(400, { error: "type what an agent should do" });
    if (text.length > TRY_MAX_CHARS) return answer(413, { error: `at most ${TRY_MAX_CHARS} characters` });

    const ip = rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    const nowMs = this.now().getTime();
    this.sql.exec("DELETE FROM try_hits WHERE at <= ?", nowMs - 86_400_000);
    const [{ day: perDay, minute: perMinute }] = this.sql.exec("SELECT COUNT(*) AS day, SUM(CASE WHEN at > ? THEN 1 ELSE 0 END) AS minute FROM try_hits WHERE ip = ?", nowMs - 60_000, ip).toArray() as [{ day: number; minute: number | null }];
    if ((perMinute ?? 0) >= TRY_PER_MINUTE) return answer(429, { error: "a few tries a minute; wait a moment" });
    if (perDay >= TRY_PER_DAY) return answer(429, { error: `${TRY_PER_DAY} tries a day from one address; come back tomorrow` });
    this.sql.exec("INSERT INTO try_hits (ip, at) VALUES (?, ?)", ip, nowMs);

    const day = this.now().toISOString().slice(0, 10);
    const spentToday = () => (this.sql.exec("SELECT usd FROM try_spend WHERE day = ?", day).toArray() as { usd: number }[])[0]?.usd ?? 0;
    const addSpend = (usd: number, tries: number) => this.sql.exec("INSERT INTO try_spend (day, usd, tries) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, tries = tries + excluded.tries", day, usd, tries);
    const budget = this.opts.budgetUsd ?? TRY_DAILY_BUDGET_USD;
    // The ceiling for everyone counts model calls, weighed by what this try may make (review, 1 Nov).
    const weight = world !== null ? TRY_CALLS.world : TRY_CALLS.text;
    this.sql.exec("DELETE FROM try_model WHERE at <= ?", nowMs - 60_000);
    const [{ n: busy }] = this.sql.exec("SELECT COALESCE(SUM(n), 0) AS n FROM try_model WHERE at > ?", nowMs - 60_000).toArray() as [{ n: number }];
    const crowded = busy + weight > TRY_MODEL_PER_MINUTE;
    const spent = spentToday();
    const useModels = !!this.opts.anthropicKey && spent < budget && !crowded;
    if (useModels) this.sql.exec("INSERT INTO try_model (at, n) VALUES (?, ?)", nowMs, weight);
    const why = !this.opts.anthropicKey ? "no model key is set on this relay" : spent >= budget ? "today's budget for model calls is spent" : "many visitors are trying it right now, so the models pause for a minute";
    if (world !== null) {
      // A wake makes several calls: each one's cost is recorded as it comes back, the budget is checked again before
      // the next, and no call starts after the deadline (review, 1 Nov).
      addSpend(0, 1);
      const base = useModels ? claudeAgentAsk(this.opts.anthropicKey!, this.opts.fetcher) : null;
      const guarded: AgentAsk | null = base && (async (req) => {
        if (this.now().getTime() - nowMs > TRY_WORLD_DEADLINE_MS) throw new Error("the agent took longer than 30 seconds");
        if (spentToday() >= budget) throw new Error("today's budget for model calls is spent");
        const r = await base(req);
        addSpend(r.costUsd, 0);
        return r;
      });
      return answer(200, await tryWorld(world, guarded, this.now(), why));
    }
    const result = await tryPurserSafely(text, useModels ? claudeModels(this.opts.anthropicKey!, this.opts.fetcher) : null, this.now(), why);
    addSpend(result.costUsd, 1);
    return answer(200, result);
  }
}

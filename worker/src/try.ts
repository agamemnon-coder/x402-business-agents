// POST /api/try: Try Purser on the relay, for anyone, with no key. It runs in its own Durable Object (its own
// storage, apart from the approvals) and guards the one thing a public page could cost us, the Claude calls:
// at most 6 tries a minute and 40 a day from one address, 280 characters a try, only from this site's own page,
// at most 30 model calls a minute from everyone together, and a budget per UTC day for the models; past either of the
// last two, code alone reads the request and the page says so. A world change (D21) is one try too: one wake of the
// Sourcing agent, at most five model calls, under the same limits. Nothing
// here reaches Airwallex, Metal or the runner: the demo world is simulated (src/try/engine.ts).

import { claudeAgentAsk, claudeModels } from "../../src/try/claude.js";
import { tryWorld, worldChange } from "../../src/try/world.js";
import { TRY_MAX_CHARS, tryPurserSafely } from "../../src/try/engine.js";
import { rateKey } from "./core.js";

interface Sql { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } }

export const TRY_PER_MINUTE = 6;
export const TRY_PER_DAY = 40;
/** Model calls a minute for all visitors together: many addresses at once cannot burn the day's budget in minutes. */
export const TRY_MODEL_PER_MINUTE = 30;
/** Model spend allowed per UTC day, in US dollars. */
export const TRY_DAILY_BUDGET_USD = 3;

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

export class TryDesk {
  private readonly now: () => Date;

  constructor(private readonly sql: Sql, private readonly opts: { anthropicKey?: string; budgetUsd?: number; fetcher?: typeof fetch; now?: () => Date }) {
    this.now = opts.now ?? (() => new Date());
    this.sql.exec("CREATE TABLE IF NOT EXISTS try_hits (ip TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS try_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL, tries INTEGER NOT NULL)");
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
    const spent = (this.sql.exec("SELECT usd FROM try_spend WHERE day = ?", day).toArray() as { usd: number }[])[0]?.usd ?? 0;
    const budget = this.opts.budgetUsd ?? TRY_DAILY_BUDGET_USD;
    const [{ n: busy }] = this.sql.exec("SELECT COUNT(*) AS n FROM try_hits WHERE at > ?", nowMs - 60_000).toArray() as [{ n: number }];
    const crowded = busy > TRY_MODEL_PER_MINUTE;
    const useModels = !!this.opts.anthropicKey && spent < budget && !crowded;
    const why = !this.opts.anthropicKey ? "no model key is set on this relay" : spent >= budget ? "today's budget for model calls is spent" : "many visitors are trying it right now, so the models pause for a minute";
    const result = world !== null
      ? await tryWorld(world, useModels ? claudeAgentAsk(this.opts.anthropicKey!, this.opts.fetcher) : null, this.now(), why)
      : await tryPurserSafely(text, useModels ? claudeModels(this.opts.anthropicKey!, this.opts.fetcher) : null, this.now(), why);
    this.sql.exec("INSERT INTO try_spend (day, usd, tries) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, tries = tries + 1", day, result.costUsd);
    return answer(200, result);
  }
}

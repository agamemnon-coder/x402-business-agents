// Stage mode's routes (docs/finals/stage-mode.md), added to the /v1/try block by one line in ./routes.ts:
//   GET  /v1/try/stage/stats?since=   public: the event pool's counts and an anonymous ticker (./stage.ts), ~2 s old
//   POST /v1/try/stage/qr             public: the QR code of /try with the presenter's event token in its fragment
// Both answer 404 unless the deployment runs the hands-on demo, like every /v1/try route. Neither sets anything.
import { z } from "zod";
import { sha256Hex } from "../crypto.js";
import { qrSvg } from "../qr.js";
import type { EngineApi } from "../engine/api.js";
import type { TryConfig } from "./start.js";
import type { TryCtx, TryKit, TryRoute } from "./routes.js";
import { tryError } from "./routes.js";
import { cachedStageStats, sinceOf, stageRateOk } from "./stage.js";
import { readSwitches, tokensOf } from "./switches.js";

type Live<C extends TryCtx> = (run: (c: C, engine: (tenantId: string) => EngineApi, config: TryConfig) => Promise<Response>) => (c: C) => Promise<Response>;

/** The link the phones open: /try on the host the stage page was served on, said to be the event's. */
export const stageJoinUrl = (origin: string): string => `${origin}/try?pool=event`;
/** The same link with an event token in its fragment (the /try page reads #e=, and the fragment never reaches a server). */
export const stageTokenUrl = (origin: string, token: string): string => `${stageJoinUrl(origin)}#e=${token}`;

/** The path of a QR code from cloud/src/qr.ts: its side in modules (margin included) and its one path, numbers only. */
export function qrParts(text: string): { size: number; d: string } {
  const svg = qrSvg(text);
  const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1] ?? 0);
  const d = /<path fill="#000" d="([^"]*)"/.exec(svg)?.[1] ?? "";
  return { size, d };
}

const TOKEN = /^[A-Za-z0-9_.~-]{16,256}$/;
const Qr = z.object({ token: z.string().max(300) }).strict();

const ip = (c: TryCtx) => c.req.headers.get("cf-connecting-ip") ?? "unknown";

export function tryStageRoutes<C extends TryCtx>(kit: TryKit<C>, live: Live<C>): TryRoute<C>[] {
  const { json } = kit;
  const busy = () => tryError(json, 429, "limit", "Too many requests for the stage counts from this address; wait a minute.");
  return [
    { method: "GET", path: "/v1/try/stage/stats", summary: "Stage mode's wall (the finals): the event pool's counts since a moment (?since=ISO 8601, at most 24 hours back, read to the minute) and the latest steps in plain words, with no company, name, id or address: { live, test_money, since, counted_at, counts: { started, read_by_claude, signed, paid, refused }, ticker: [{ at, kind, text }] }. live false and zeros while the event pool is off (the switch starts off, or no live event token). About 2 seconds old; 120 a minute per address.", need: "public", run: live(async (c) => {
      if (!(await stageRateOk(ip(c), c.now))) return busy();
      const url = new URL(c.req.url);
      const r = json(200, await cachedStageStats(c.env.sql, sinceOf(url.searchParams.get("since"), c.now), c.now));
      r.headers.set("cache-control", "no-store");
      return r;
    }) },
    { method: "POST", path: "/v1/try/stage/qr", summary: "Stage mode's QR code with the presenter's event token: { token } (made with POST /v1/try/admin { op: token, pool: event }). Answers { url_shown, size, d, until }: the QR code's side and path of /try?pool=event#e=<token> on this host, and the token's end; 400 { code: not_event_token } when it is not a live event token. The token is checked by its SHA-256 and kept nowhere.", need: "public", run: live(async (c) => {
      if (!(await stageRateOk(ip(c), c.now))) return busy();
      const b = await kit.body(c, Qr, 1_000);
      const sha = TOKEN.test(b.token) ? await sha256Hex(b.token) : "";
      let tokens: ReturnType<typeof tokensOf> = [];
      try { tokens = tokensOf(await readSwitches(c.env.sql)); } catch { /* none */ }
      const t = tokens.find((x) => x.sha256 === sha && x.pool === "event" && Date.parse(x.until) > c.now.getTime());
      if (!t) return tryError(json, 400, "not_event_token", "That is not a live event token. Make one with the admin route (op token, pool event) and open /try/stage#e=<token>.");
      // The host the stage page was served on (purser-try's own, or the site's through its binding): the phones open the same.
      const origin = new URL(c.req.url).origin;
      return json(200, { url_shown: stageJoinUrl(origin), ...qrParts(stageTokenUrl(origin, b.token)), until: t.until });
    }) },
  ];
}

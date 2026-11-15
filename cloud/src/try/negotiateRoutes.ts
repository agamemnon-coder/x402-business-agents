// /try/negotiate's one route (15 Nov), behind the visitor's session like the demo's other engine routes, added to the
// route table by one line in cloud/src/app.ts and listed in ./gate.ts's TRY_ROUTES:
//   POST /v1/try/negotiate   Purser's Sourcing agent and a simulated supplier's agent (both Claude) negotiate an
//       early-payment discount on Bergtex's test invoice, 2 to 4 turns, every turn through the rails
//       (src/negotiate/rails.ts). Answers the turns, the agreement, its canonical JSON and SHA-256, and the invoice the
//       engine files for the agreed terms (POST /v1/engine/compose), which the visitor then signs as on /try.
// /try's caps hold: the company was started under the per-address start limits; Claude runs only under the switch
// `claude` (the kill switch) and one reservation against the caps (cloud/src/engine/spend.ts), which every turn's worst
// case must fit; at most MAX_TURNS turns of TURN_MAX_TOKENS each; NEGOTIATIONS_PER_COMPANY a company. Claude off,
// capped or failing: the recorded negotiation, labelled as such, never a fake live one.
import { bump } from "../auth.js";
import type { CappedReason, Reservation } from "../../../src/engine/budget.js";
import { actionBudget, claudeSpeak, type Budget } from "../../../src/negotiate/claude.js";
import { d1Spend } from "../engine/spend.js";
import type { Sql } from "../store.js";
import { readSwitches } from "./switches.js";
import { negotiate, recordedNegotiation, type Speak } from "../../../src/negotiate/negotiate.js";
import type { EngineKit, EngineRoute } from "../engine/routes.js";
import type { TryEngineCtx } from "./engineRoutes.js";
import { isTryTenant, tryScopes, TryRefused } from "./start.js";

/** Per test company, over its whole life. */
export const NEGOTIATIONS_PER_COMPANY = 3;

/** Claude for one company's negotiation: a reservation under /try's caps, and the turns spending from its budget. */
export interface NegotiateClaude {
  reserve(): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: CappedReason }>;
  speak(budget: Budget): Speak;
}

/**
 * The Worker's Claude for negotiations (cloud/src/worker.ts): only with ENGINE_CLAUDE "on" and the demo's capped key,
 * the same two the engine's Claude needs (cloud/src/engine/tryClaude.ts). The caps and the kill switch are /try's own:
 * the switch `claude`, cap_action_micros and the company's, address's, pool's and all-time caps (./switches.ts). A
 * switch table that cannot be read keeps Claude off (fail closed), as a missing row does.
 */
export function negotiateClaudeOf(sql: Sql, engineClaude: string | undefined, key: string | undefined, fetcher?: typeof fetch): ((tenantId: string) => NegotiateClaude | undefined) | undefined {
  if (engineClaude !== "on" || !key) return undefined;
  return (tenantId) => ({
    reserve: async () => {
      const switches = await readSwitches(sql).catch(() => ({}));
      const scope = await tryScopes(sql, tenantId).catch(() => null);
      return d1Spend(sql, switches, { tenantId, pool: scope?.pool ?? "smoke", address: scope?.addr ?? null }).reserve();
    },
    speak: (budget) => claudeSpeak(key, budget, fetcher),
  });
}

/** What the route needs of the request's context: /try's engine context, and Claude for the company when it is set up. */
export interface NegotiateCtx extends TryEngineCtx { env: TryEngineCtx["env"] & { negotiateClaude?: (tenantId: string) => NegotiateClaude | undefined } }

/** Why the recorded negotiation is shown, in words a visitor reads. */
export function reasonWords(reason: CappedReason | "not_set_up" | "failed", detail?: string): string {
  switch (reason) {
    case "switch_off": return "Claude is switched off on the demo right now.";
    case "no_key": case "not_set_up": return "Claude is not set up on this deployment.";
    case "busy": return "Claude is busy with other visitors right now.";
    case "failed": return `Claude stopped answering mid-negotiation (${detail ?? "no answer"}).`;
    default: return "The demo's Claude spending cap is reached for now.";
  }
}

export const NEGOTIATE_ROUTE = "POST /v1/try/negotiate";

export function tryNegotiateRoutes<C extends NegotiateCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  return [
    { method: "POST", path: "/v1/try/negotiate", summary: "Agents negotiate (the hands-on demo, a test company only): Purser's Sourcing agent and a simulated supplier's agent, both Claude, negotiate an early-payment discount on a test invoice of Bergtex Textil GmbH (EUR 1,850.00, net 30), at most 4 turns, each through the CFO's rails in code (the most it may pay, the latest pay-by date, nothing beyond the invoice, the payee's bank details unchanged). Answers { mode (live or recorded), label, reason, scene, bounds, rules, turns, outcome, agreement, canonical, sha256, compose, micros }; compose is the invoice POST /v1/engine/compose files for the agreed terms. Claude off, capped or failing: the recorded negotiation, labelled. 3 a company.", need: "admin", run: async (c) => {
      const tenant = c.caller!.tenantId;
      if (!isTryTenant(tenant)) return err(403, "only a test company of the hands-on demo negotiates here");
      const row = await c.env.sql.first<{ created_at: string }>("SELECT created_at FROM try_companies WHERE tenant_id = ?", [tenant]);
      const born = Math.floor(Date.parse(row?.created_at ?? c.now.toISOString()) / 1000);
      if ((await bump(c.env.sql, `negotiate:${tenant}`, born, 1)) > NEGOTIATIONS_PER_COMPANY)
        throw new TryRefused(429, "limit", `This test company has negotiated ${NEGOTIATIONS_PER_COMPANY} times, its limit. Start a new one to watch again.`);
      const today = c.now.toISOString().slice(0, 10);
      const claude = c.env.negotiateClaude?.(tenant);
      if (!claude) return json(200, await recordedNegotiation(today, reasonWords("not_set_up")));
      const got = await claude.reserve();
      if (!got.ok) return json(200, await recordedNegotiation(today, reasonWords(got.reason)));
      const budget = actionBudget(got.reservation.micros);
      try {
        const n = await negotiate({ today, speak: claude.speak(budget), mode: "live" });
        await got.reservation.settle(n.micros);
        return json(200, n);
      } catch (x) {
        // What the turns may have cost: every sent turn's worst case, as the budget counted it.
        await got.reservation.settle(got.reservation.micros - Math.max(0, budget.left()));
        return json(200, await recordedNegotiation(today, reasonWords("failed", x instanceof Error ? x.message.slice(0, 120) : undefined)));
      }
    } },
  ];
}

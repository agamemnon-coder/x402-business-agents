// The platform end-to-end's two set-ups: the dry run (every outside service a stand-in, nothing leaves this machine)
// and the live run (Airwallex sandbox, Claude, T:0 sandbox), each live call counted against the approved budget.

import { Airwallex, fromEnv as airwallexEnv } from "../airwallex/client.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { T0Client, type T0Rate } from "../accounting/t0.js";
import { ratesFromEnv } from "../accounting/t0Sink.js";
import { t0AccountType } from "../accounting/t0.js";
import { AP_CHART, CHART } from "../config/gl.js";
import { PRICING } from "../config/pricing.js";
import type { Asker } from "../ap/read.js";
import { ClaudeReader } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import { chartAccounts, FakeT0 } from "../redteam/t0.js";
import { BudgetSpent, CallBudget } from "./budget.js";
import { FakePlatformOps, LivePlatformOps } from "./platformOps.js";
import type { PlatformE2EDeps } from "./platformRun.js";
import { WORLD } from "./world.js";

/** The fee rate in the test policy of this run, in basis points: a test value (src/config/pricing.ts), not a price. */
export const E2E_FEE_BPS = String(PRICING.platformFee.testPolicyBps);

/** Purser's own sandbox account (the platform): where its fee goes. */
export const PURSER_PLATFORM_ACCOUNT = "acct_op0_QItiOyWKsYb5pwQihA";
/**
 * What the T:0 client sends as its bearer: a fixed word, not a key. The live run's T:0 key is a network secret the
 * environment's proxy puts on every request to api.t0.ai; this process never holds it.
 */
export const PROXY_INJECTED = "proxy";

/** Test money moved into each connected account: covers its invoices, Purser's fee and Airwallex's SWIFT fee (EUR 13.41 a payout on 10 November). */
export const FUND_CENTS = 6000;

/** The parser only: no model call (the dry run, and what a reader falls back to). */
export const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "dry run: the parser read it" }) } as Asker;

/** A reader that counts every Claude call against the budget; once spent, the parser reads (no call is made). */
export function budgetedReader(inner: Asker, budget: CallBudget): Asker {
  return {
    ask: (async (a: Parameters<Asker["ask"]>[0], fallback: Parameters<Asker["ask"]>[1]) => {
      try { budget.take("claude", "POST", "/v1/messages"); } catch (e) {
        if (e instanceof BudgetSpent) return { value: fallback(), source: "fallback", model: null, note: e.message };
        throw e;
      }
      return inner.ask(a, fallback);
    }) as Asker["ask"],
  };
}

export interface DryRun { deps: Omit<PlatformE2EDeps, "dir" | "log" | "now">; rails: Map<string, FakeAirwallex>; platform: FakePlatformOps; t0: FakeT0 }

export function dryRunDeps(): DryRun {
  const rails = new Map<string, FakeAirwallex>();
  const platform = new FakePlatformOps();
  platform.onFund = (accountId, cents) => { const r = rails.get(accountId); if (r) r.bal.EUR.availableCents += cents; };
  const t0 = new FakeT0(chartAccounts(Object.keys({ ...CHART, ...AP_CHART }), (c) => (c === "2100" ? "accounts_payable" : t0AccountType(c) ?? "other_expenses")));
  const client = new T0Client({ apiKey: t0.key, fetch: t0.fetch, retryDelayMs: 0 });
  return {
    rails, platform, t0,
    deps: {
      world: WORLD, platform, readerFor: () => parserOnly, t0: client, t0Rate: () => undefined, feeBps: E2E_FEE_BPS, fundCents: FUND_CENTS, mode: "dry run",
      railFor: (accountId) => {
        let r = rails.get(accountId);
        if (!r) {
          r = new FakeAirwallex();
          r.payingAccount = accountId;
          r.bal.EUR.availableCents = 0;
          rails.set(accountId, r);
        }
        return { rail: r, sim: r };
      },
    },
  };
}

/** The live set-up, or why it cannot start. Never prints a key: the T:0 key is the proxy's (a placeholder here). */
export function liveDeps(budget: CallBudget, env: NodeJS.ProcessEnv): Omit<PlatformE2EDeps, "dir" | "log" | "now"> | string {
  const cfg = airwallexEnv({ ...env, AIRWALLEX_CALL_BUDGET: undefined, AIRWALLEX_CALL_LOG: undefined, AIRWALLEX_PLATFORM: undefined });
  if (!cfg) return "AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY are not set: nothing was called";
  const rate = ratesFromEnv(env.T0_RATES);
  if (typeof rate === "string") return rate;
  const fetchAwx = budget.fetchFor("airwallex");
  const platform = new LivePlatformOps(new Airwallex({ clientId: cfg.clientId, apiKey: cfg.apiKey, fetchImpl: fetchAwx }), PURSER_PLATFORM_ACCOUNT);
  const t0 = new T0Client({ apiKey: PROXY_INJECTED, fetch: budget.fetchFor("t0"), retryDelayMs: 0 });
  const rails = new Map<string, AirwallexRest>();
  return {
    world: WORLD, platform, readerFor: (db: DB) => budgetedReader(new ClaudeReader(db), budget), t0, t0Rate: rate as T0Rate, feeBps: E2E_FEE_BPS, fundCents: FUND_CENTS, mode: "live",
    railFor: (accountId) => {
      let r = rails.get(accountId);
      if (!r) rails.set(accountId, (r = new AirwallexRest(new Airwallex({ clientId: cfg.clientId, apiKey: cfg.apiKey, fetchImpl: fetchAwx, onBehalfOf: accountId }))));
      return { rail: r, sim: r };
    },
  };
}

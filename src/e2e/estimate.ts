// How many calls a live run will make, measured on the dry run (the same code path against stand-ins): every rail call
// the companies make, plus one login per Airwallex client, the platform's onboarding (create, update, submit, activate
// per new account) and funding, T:0's calls as the fake counted them, and one Claude call per reading asked for.

import type { Service } from "./budget.js";
import type { DryRun } from "./setup.js";

export interface Estimate { calls: Record<Service, number>; detail: string[] }

/** HTTP calls the real adapter makes per rail method, where it is more than one (src/airwallex/adapter.ts). */
export const HTTP_CALLS: Record<string, number> = {
  // POST /beneficiaries/schema, POST /beneficiaries/validate, POST /beneficiaries/create.
  createPayoutBeneficiary: 3,
};

export function estimateLive(dry: DryRun, claudeAsks: number): Estimate {
  const newAccounts = dry.deps.world.filter((c) => !c.accountId).length;
  const railCalls = [...dry.rails.values()].reduce((n, r) => n + r.calls.reduce((m, c) => m + (HTTP_CALLS[c.split(":")[0]!] ?? 1), 0), 0);
  const logins = dry.rails.size + 1;
  const platform = newAccounts * 4 + dry.platform.funded.length;
  const t0 = dry.t0.calls.length;
  return {
    calls: { airwallex: railCalls + logins + platform, t0, claude: claudeAsks, metal: 0 },
    detail: [
      `airwallex: ${railCalls} company calls (beneficiaries: look-up, schema, validate, create; balances; payouts; sandbox transitions) + ${logins} logins + ${platform} platform calls (${newAccounts} accounts opened × 4, ${dry.platform.funded.length} fundings)`,
      `t0: ${t0} (chart, P&L for the currency, one list, one post per entry)`,
      `claude: ${claudeAsks} (one per reading asked for)`,
    ],
  };
}

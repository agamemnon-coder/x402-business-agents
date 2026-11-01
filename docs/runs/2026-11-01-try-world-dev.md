# /try world changes: dev run against the real Haiku (1 November)

D21. A dev run, not a test and not the hosted page: `src/try/world.ts` with the real Messages API call
(`claudeAgentAsk`, fetch, strict tools, effort medium), once per world change, from this container. No ledger, no rail,
no money; a message to the Treasury agent is only shown.

| World change | Who decided | Calls | Cost (USD) | Seconds | Tool calls | Buy policy after |
|---|---|---|---|---|---|---|
| Stockline raises its price | Claude (Haiku) | 2 | 0.0006 | 4.7 | set_buy_policy, finish | Ridgeline Data up to 0.03, no cache |
| Ridgeline Data starts failing | Claude (Haiku) | 2 | 0.0007 | 5.1 | set_buy_policy, send_message, market, finish | Ridgeline Data up to 0.03, 60 s cache |
| The CFO raises the cap | Claude (Haiku) | 2 | 0.0006 | 5.0 | market, finish | unchanged (Stockline at 0.04 is within the new cap) |
| Stockline drops its price | Claude (Haiku) | 2 | 0.0004 | 3.6 | set_buy_policy, finish | Stockline up to 0.02, no cache |
| Ridgeline Data: cheap and fresh | Claude (Haiku) | 2 | 0.0005 | 4.0 | set_buy_policy, market, finish | Ridgeline Data up to 0.03, no cache |

Five of five decided by Claude, none refused by code, about 0.0005 USD and 4 to 5 seconds a try. At the Try desk's
daily model budget (3 USD) that is several thousand world changes a day; the per-address limits come first.

What it shows: the same brief, rules, tool schema and code check as the autonomy runtime (`src/autonomy/sourcingCore.ts`)
work over the Worker's fetch path. What it does not show: the agent on real rails (that is the autonomous dry runs,
dry-97 to dry-102), or the Treasury agent answering (here its message is only shown).

Checks: `test/try-world.test.ts` (engine and the fetch call, with a stand-in model, test only), `test/try-desk.test.ts`
(the Worker route under the Try desk's limits), the page check (`/try`, five buttons, the fallback labelled, at 390 and
1440 px, light and dark). The hosted page gets it with the Worker's next deploy (Max's go, together with D20).

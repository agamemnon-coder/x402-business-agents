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

**Second run, after the review fixes (request ids from the API, as proof per call):**

| World change | Who decided | Calls | Cost (USD) | Seconds | Tool calls | Buy policy after | Request ids |
|---|---|---|---|---|---|---|---|
| Stockline raises its price | Claude (Haiku) | 2 | 0.0007 | 5.8 | set_buy_policy, market, finish | Ridgeline Data up to 0.03, no cache | req_011CgbzuUhw2TWq1BvUS1RYT, req_011CgbzunAfytexvucU3oEgx |
| Ridgeline Data starts failing | Claude (Haiku) | 2 | 0.0008 | 6.2 | set_buy_policy, send_message, finish | Ridgeline Data up to 0.03, no cache | req_011CgbzuuN1AkL2QVtAhGj6X, req_011CgbzvGrL33mJK8jKbMkBQ |
| The CFO raises the cap | Claude (Haiku) | 1 | 0.0003 | 2.8 | finish | unchanged | req_011CgbzvMm1E213vHENee5ZP |
| Stockline drops its price | Claude (Haiku) | 1 | 0.0003 | 3.1 | finish | unchanged (Stockline, now 0.02) | req_011CgbzvZrXeMws8T9A2cvzi |
| Ridgeline Data: cheap and fresh | Claude (Haiku) | 2 | 0.0005 | 3.5 | set_buy_policy, market, finish | Ridgeline Data up to 0.03, no cache | req_011CgbzvoDSeLCXk4XtDPfaT, req_011Cgbzvy2YXQqysv8r1mQSC |

The same model on the same world does not always choose the same way (the first run tightened Stockline to 0.02 in
"Stockline drops its price"; the second kept the policy); every choice stayed inside what code allows.

Five of five decided by Claude, none refused by code, about 0.0005 USD and 4 to 5 seconds a try. At the Try desk's
daily model budget (3 USD) that is several thousand world changes a day; the per-address limits come first.

What it shows: the same brief, rules, tool schema and code check as the autonomy runtime in its variation test
(`src/autonomy/sourcingCore.ts`; a test compares the runtime's own request with /try's) work over the Worker's fetch path. What it does not show: the agent on real rails (that is the autonomous dry runs,
dry-97 to dry-102), or the Treasury agent answering (here its message is only shown).

Checks: `test/try-world.test.ts` (engine and the fetch call, with a stand-in model, test only), `test/try-desk.test.ts`
(the Worker route under the Try desk's limits), the page check (`/try`, five buttons, the fallback labelled, at 390 and
1440 px, light and dark). The hosted page gets it with the Worker's next deploy (Max's go, together with D20).

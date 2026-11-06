# Reliability runs, November 2026

**Kind: reliability run.** Each row is the full Kit 11 flow, run again in a **fresh world** of its own, to show that
Purser works every time and not once. The flow and its order are the main run's (3 November,
[2026-11-03-main-run.md](2026-11-03-main-run.md); the runbook `docs/internal/draaiboek-wereld-donderdag.md`).

- **Rails:** Airwallex sandbox and Metal testnet, test money only. The customer (Summit), the suppliers (Stockline,
  Ridgeline Data) and the merchant (Packwise) are simulated, as in the main run.
- **Agents:** real Claude calls: Sourcing on Haiku, Support on Sonnet, Treasury on Opus.
- **Approvals:** two **labelled virtual test passkeys**, each a headless Chromium context with its own virtual WebAuthn
  authenticator, on a local relay. `test-cfo` signs in the CFO role and `test-controller` signs as the second approver.
  **No person signed in these runs.** Claude typed the world commands and approved nothing itself. The record names the
  signer of each signature.
- **The main run is not touched.** Its world `main-1`, its ledger, `docs/demo/main-run.json` and its numbers are
  unchanged. Every reliability run has its own ledger (`data/rel-N.sqlite`) and keys (`x402-business-agents-keys/rel-N`).
- **One command:** `KIT11_KEYS_ROOT=<keys root> npm run reliability -- --world rel-N --recycle-from <data dir of
  finished dry runs>`. It refuses a world that already exists.
- **Records:**
  - the measured record of each run is in [docs/demo/reliability.json](../demo/reliability.json);
  - the run-log is `docs/runs/reliability/rel-N.log`;
  - the data-QA report is `docs/runs/reliability/rel-N-data-qa.md`.

| Run | Date (UTC) | Commit | Passed | Where it stopped | Duration | Claude decisions / fallbacks | Claude cost | Metal txs | Refusals (Metal on chain / Purser / buy policy / Airwallex / CFO) | Audit rows, chain | Faucet calls | Signers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rel-1 | 6 Nov, 05:34–05:56 | f0c548f | **no** | Acceptance row 20, the TAP card purchase: the Packwise Pro plan was never bought | 21.4 min | 22 / 0 | 0.2956 USD | 108 | 1 / 0 / 3 / 0 / 1 | 374, intact | 0 | virtual test passkeys (CFO role, second approver role) |
| rel-1b | 6 Nov, 06:12–06:25 | c231196 | **yes** | — | 12.7 min | 25 / 0 | 0.3111 USD | 64 | 1 / 0 / 3 / 0 / 1 | 342, intact | 0 | virtual test passkeys (CFO role, second approver role) |

How the columns are counted:

- **Metal txs:** the distinct transaction hashes in the ledger: the account creations, the funding, the mandate binds,
  every purchase and sale, the refusal recorded on chain, the replace, the sweep and the refunds.
- **Not counted in Metal txs:** the 4 test-money transfers into each world (see "Test money").
- **Durations:** the whole command, including the checks and `npm run stop`.
- **Refusals:** "Metal on chain" is the one purchase that was let through and that Metal refused itself
  (`mandate_cap_exceeded`), recorded on chain. Metal also refused one purchase on the rail with `mandate_revoked`, while
  the replace swapped the mandate. In both runs every query that was refused was answered 503 with `settled: false`: 5
  queries in each run.

## rel-1 (6 November, 05:34–05:56 UTC): not passed

**Setup:**

- **Code:** f0c548f, the main-branch code plus the reliability command. No product code was changed.
- **World:** `data/rel-1.sqlite`.
- **Signers:**
  - `test-cfo`: virtual test passkey (CFO role), fingerprint 064D-E748-F995-978B;
  - `test-controller`: virtual test passkey (second approver role), fingerprint B231-508E-0FD1-E026.

**What held.** Every step and every check exited 0: `verify`, `reconcile` (99 flows, no differences), `data-qa` (113
payments, 221 checks, 0 differences, 0 skipped), `origins` (111 movements, 0 without an origin), `dashboard-vs-chain`
(4/4 mandates) and `npm run stop`. Every acceptance row passed except row 20:

| Step | Evidence |
|---|---|
| The refusal at 0.04 | Query #18 was let through once, and Metal refused it itself (402 `mandate_cap_exceeded`). The refusal was recorded on chain in tx 0xa3a1645df98256c4ed037ab21013c4fd7ead12fb5a7914929ceed65a293e2085, with the "Defense in depth…" label. Nothing settled. |
| Treasury's options | P-0002 (A) and P-0003 (B), both from Treasury. Option A (cap 0.04, price 0.05) was signed 1 of 2 by `test-cfo`, then 2 of 2 by `test-controller`, and executed on chain. |
| Dispute | Support refunded only #7, #10 and #13 (0.15). P-0004 ("refund the other 9") was rejected by `test-cfo`. The injected instruction was flagged. |
| Sweep | sweep-20261106-1, 0.51, after finality. Deposit `2fc282ff-5ec5-4ea8-85e2-b1e64f9d9335` has the tx as its reference. |
| Euro licence | P-0005 was planned by Treasury and approved by `test-cfo`. FX `89f33427-81be-474b-b018-6e813d4c577b` bought EUR 110.00 for USD 124.52. SWIFT transfer `6c64ffac-17a0-403d-94e3-a26501431de4` is PAID, fee EUR 13.40. |

**Timings:**

- From the silent price rise to Treasury's options: 67 s.
- From the options to the replace on chain: 27 s.
- From the invoice to PAID: 51 s.

**Where it stopped: row 20, the TAP card purchase.**

1. At `world packwise-pro` (05:45:52) the Sourcing agent (Haiku) learned that Pro costs 45.00 EUR, over its card's 30.00
   a purchase. It did not ask the CFO for a raise (`ask_card_raise`) and did not try to buy. It wrote to the Treasury
   agent instead.
2. Treasury (Opus) answered that it cannot raise card limits, that it had "passed it on in my report", and that Sourcing
   should not buy until the CFO approved a raise.
3. Nothing waited for the CFO, so the plan was never bought. The driver waited 5 minutes and moved on.

**Root cause:** a missing fact in Treasury's rules.

- Treasury did not know that a card limit is not a mandate, or that only the agent whose card it is can ask the CFO for a
  raise (with its own `ask_card_raise`).
- So it sent the Sourcing agent to wait instead of to its tool.
- That is a dead end that nothing recovers from.

**Evidence from the evals.** Both moments were rebuilt word for word from rel-1's ledger as evals:

| Eval | Model | What it rebuilds | Result |
|---|---|---|---|
| `sourcing-packwise-raise` | Haiku | the Sourcing agent's wake at 05:45:52 | 30/30 runs asked the CFO itself. Sourcing's miss in rel-1 is rare model variance, and it was not changed. |
| `treasury-card-raise` | Opus | Treasury's wake on Sourcing's message | 6/10 before the fix. The other 4 runs kept Sourcing waiting, as in rel-1: "I'm flagging it to the CFO in my report". |

**The fix** is commit 856cb64, branch `reliability`:

- One rule in Treasury's rules (`src/autonomy/teamProfiles.ts`). A card limit is not a mandate. Treasury cannot raise one
  or ask for one, and its report does not put a raise before the CFO. Only the card's own agent can ask (the Sourcing
  agent with `ask_card_raise`), and Treasury tells it so.
- Tests: `test/agent-card-raise-eval.test.ts` checks the rule and the eval's checker on rel-1's own words.
- After the fix, `treasury-card-raise` passed **10/10**, and `sourcing-packwise-raise` passed 10/10.

## rel-1b (6 November, 06:12–06:25 UTC): passed

**Setup:**

- **Code:** c231196, which includes the fix.
- **World:** `data/rel-1b.sqlite`, fresh.
- **Signers:**
  - `test-cfo`: virtual test passkey (CFO role), fingerprint 85ED-4D81-5C13-65D6;
  - `test-controller`: virtual test passkey (second approver role), fingerprint 3C0A-C12D-3F4D-4D63.

**Every step, every check and every acceptance row passed.** `verify` passed all checks. `reconcile` found 56 flows and
no differences. `data-qa` checked 70 payments with 135 checks: 0 differences, 0 skipped. `origins` found 69 movements,
0 without an origin. `dashboard-vs-chain` matched 4/4 mandates. `npm run stop` exited 0.

| Step | Evidence |
|---|---|
| The refusal at 0.04 | Query #18 was let through once, and Metal refused it (402 `mandate_cap_exceeded`). The refusal was recorded on chain in tx 0x1c84cc43e550386efbca10b9264dc98ab33c86f75a66d59825a476abdc2dfe4e. Nothing settled. |
| Treasury's options | Treasury recommended option B (price 0.07, cap 0.04). P-0003 was signed 1 of 2 by `test-cfo`, then 2 of 2 by `test-controller`. Replace txs 0x8906e40f…e33b and 0xdb53b68c…f606. P-0002 was superseded. |
| Dispute | Support refunded only #7, #10 and #13. P-0004 ("refund the rest") was rejected by `test-cfo`. |
| Sweep | sweep-20261106-1, 0.51, tx 0xa8f948d712eae104111ba29c0cbbcf8bb219c5fd2a73c46ec3118c1de33c54e4, after finality. Deposit `4487ff44-5c1b-4081-9e19-fe62b6b9327a` has the tx as its reference. |
| Euro licence | P-0005 was planned by Treasury and approved by `test-cfo`. FX `b7c71ab8-56f7-40e1-beaa-7c48762696fd` bought EUR 110.00 for USD 124.49, before the SWIFT transfer `e08f5f76-baed-4a94-8039-3f246503c805`. The transfer is PAID, fee EUR 13.40. |
| TAP card purchase | Sourcing asked the CFO itself for a raise (P-0006, to 57.00, within code's 1.25× bound), and `test-cfo` approved it. Then came a TAP-signed checkout (key `sourcing-xs-jsDI52JtP`, both signatures verified). Airwallex approved `01a1af85-eaa9-7000-8984-bfcdcec399f6`, EUR 45.00, on this world's sourcing card ····1951. |

**Timings:**

- From the silent price rise to Treasury's options: 59 s.
- From the options to the replace on chain: 17 s.
- From the invoice to PAID: 43 s.

In rel-1b the Sourcing agent asked for the raise itself, so Treasury's new rule was not needed in this run. The evals
above are the evidence for the fix.

## Test money

Both worlds were filled with **recycled test money** from the finished dry run dry-142 (`KIT11_RECYCLE=on`, Max's rules
of 1 November). Each world took 4 transfers, logged with their txs in [testgeld-recycling.md](testgeld-recycling.md):

| Wallet | *USDZ |
|---|---|
| Business owner | 21.00 |
| Customer owner | 1.00 |
| Customer account | 6.00 |
| Gas for the refusal recorder | 0.10 |

**0 faucet calls.** With `--faucet` instead, a world asks the faucet about 4 times: the business owner, the customer
owner, the customer account and the recorder's gas. About 8,100 *USDZ of spare test money is left in finished dry
worlds. At 28.10 a world, that is enough for about 280 more worlds.

## Notes

- `world let-one-through` again printed "not let through to Metal (in_flight: )" when its wait ended while the pull was
  in flight. The ledger's final state is `used / metal_refused` in both runs. This is the cosmetic issue known since
  dry-180.
- Treasury's routine wake after `money-in` again mentioned the old `mandate_cap_exceeded` flag (as in the main run, note
  5). It proposed nothing.
- In the Treasury eval the ledger did not hold P-0005, and Opus said so ("the ledger is right"). The check judges only
  its answer to Sourcing.

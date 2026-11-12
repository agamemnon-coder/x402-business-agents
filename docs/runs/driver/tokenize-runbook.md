# Runbook: the invoice token on Metal testnet (live run)

Prototype. Metal testnet, test money only. The financier is simulated. The face value is the invoice amount divided
by 100. Nothing here has run live yet; this page is the order of the run. What it is: [docs/tokenize.md](../../tokenize.md).

## Before the first call

1. `npm run tokenize -- stand-in` must end with `STAND-IN OK` (in-memory chain, no network).
2. Max's go. Then set the variables below. This page gives names only, never values.

| When | Variables |
|---|---|
| Every live command | `TOKENIZE_GO` (yes), `TOKENIZE_CALL_BUDGET` (this command), `TOKENIZE_CALL_BUDGET_TOTAL` (the whole run, the same on every command), `TOKENIZE_CALL_LOG` (one file for the whole run), `TOKENIZE_DB` (a new file named `tokenize*.sqlite`), `METAL_RPC_URL`, `KIT11_KEYS_DIR` (outside the repository) |
| preflight, fund, mint, verify, record | `TOKENIZE_SOURCE_DB` (the ledger with the passkey approval, read-only), `TOKENIZE_PROPOSAL`, `TOKENIZE_DOCUMENT` |
| fund | `TOKENIZE_DONOR_KEY` (a key file outside the repository; nothing else may use that key while fund runs) |
| Optional | `TOKENIZE_DIVISOR` (default 100), `TOKENIZE_DISCOUNT_BPS` (default 200), `TOKENIZE_DEBTOR`, `TOKENIZE_GAS` (`estimate` or `fixed`), `TOKENIZE_POLL_MS` (the wait before each receipt read, default 2500), `TOKENIZE_RESEND_REVERTED` |
| record | `TOKENIZE_APPROVAL_RECORD` (the committed run record that names the passkey: needed whenever a person approved; without it the page does not say the CFO approved), `TOKENIZE_GO_NOTE` (who gave the go, when, in what words; without it the record says only that `TOKENIZE_GO` was set), `TOKENIZE_DEVIATIONS` (a text file) |

In this container Node reaches the RPC only through the proxy: also set `NODE_USE_ENV_PROXY` to 1.

## The commands, in order

"Calls" is the least each command needs, when every receipt is there on its first read. Each later receipt read
costs one more: if the first reads come back empty, raise `TOKENIZE_POLL_MS`. Give each command a budget a few calls
above its number.

| # | Command | Calls | It ends with (exit 0) |
|---|---|---|---|
| 1 | `npm run tokenize -- preflight` | 2 | `NOT READY  no key yet for issuer, creditor, financier, payer` and a line to run fund (exit 1: expected before fund). Above it: the invoice, the amounts, `CHAIN    id 63825: Metal testnet`, the donor's balance (with `TOKENIZE_DONOR_KEY` set) and the plan. |
| 2 | `npm run tokenize -- fund` | at most 14 | The plan (one `PLAN` line per role), four `done fund the …` lines with explorer links, then `FUNDED issuer …, creditor …, financier (simulated) …, payer …` |
| 3 | `npm run tokenize -- preflight` | 5 | `READY    the four roles hold what they need and the budget covers the steps still to run; nothing was sent` |
| 4 | `npm run tokenize -- deploy` | 4 | `DEPLOYED PurserInvoiceToken 0x… https://testnet.metalntwx.com/tx/0x…` |
| 5 | `npm run tokenize -- mint` | 4 | `MINTED   token 0x… to the creditor 0x…; face value 2.40 *USDZ` |
| 6 | `npm run tokenize -- finance` | 10 | Three `done` lines, then `FINANCED the simulated financier 0x… paid 2.35 *USDZ to the creditor 0x… and holds the token` |
| 7 | `npm run tokenize -- settle` | 6 | Two `done` lines, then `SETTLED  the debtor's wallet paid 2.40 *USDZ to the holder 0x…; token burned` |
| 8 | `npm run tokenize -- verify` | 1 | `VERIFIED token id = document hash; the chain record matches the ledger and the document; the chain marks it settled` |
| 9 | `npm run tokenize -- record` | 0 | `RECORDED …/docs/runs/<date>-tokenize.md` and `.json`. Commit both, and in the same commit change the status line of `docs/tokenize.md` and the first paragraph of this page to point at the record (a test fails until they do). `/metal` then shows the block. |

Steps 2 and 4 to 8 need 39 calls; with both preflights the run needs 46. Every command prints its own count and the
call log's total in its last line. `npm run tokenize -- facts` prints the run's ledger at any time (0 calls).

The amounts above are for proposal P-0002: EUR 240.00 divided by 100 is 2.40 *USDZ; less 2% is 2.35. At step 9,
name [the record of its approval](../2026-11-07-awx-1.md) (Face ID, 7 November) in `TOKENIZE_APPROVAL_RECORD`.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Done. | Go on. |
| 1 | `FAILED`: a transaction reverted on chain, verify found a difference, or preflight is not ready. | Read the line. Nothing is sent again for a reverted transaction. |
| 2 | `REFUSED`: nothing was signed in this command. | Fix what the line names (a variable, an earlier step, the budget), then run it again. |
| 3 | `STOPPED`: the budget, the network, or a receipt that is not there yet. | Run the same command again. |
| 4 | `FAILED … the node refused it`: the node answered a send with an error. No receipt is read. | Do not run it again. See "A transaction the node refuses for good" below. |

## When a step stops midway

- **Run the same command again.** Every transaction's hash and signed bytes are in the ledger before it is sent. The
  re-run reads that transaction's receipt first, and goes on from there. A finished transaction costs no call.
  Nothing is sent twice.
- **`no receipt yet`.** Wait a few seconds and run the command again. If there is still no receipt, the same signed
  bytes are sent once more (same nonce, same hash: they cannot run twice) and the line shows what the node said.
- **`Metal RPC budget … reached`.** Raise `TOKENIZE_CALL_BUDGET` (or the total, with Max's go) and run it again.
- **`the chain would refuse it (…)`.** The node's own estimate said the call would revert, with the contract's
  reason. Nothing was signed. Stop and look; do not retry blindly.
- **`reverted on chain`.** Open the explorer link in the line. The command will not send it again by itself. After
  the cause is understood, one run with `TOKENIZE_RESEND_REVERTED` set to yes sends a new transaction. It asks the
  node's estimate first (one call more), so a limit that was too low is raised and a second revert is refused unsent.
- **The estimate itself fails, or the budget is tight.** `TOKENIZE_GAS` set to `fixed` skips the five estimates and
  uses the fixed limits (the run then needs 34 calls for steps 2 and 4 to 8).
- **The first funding transfer is the canary.** It is a plain call to *USDZ, the same kind as the two approvals
  later. If Metal refuses that kind, fund ends at transaction one with exit 4. Do not run fund again. Report it.
- **A transaction the node refuses for good (exit 4).** Do not run the command again and do not edit the ledger.
  When a new transaction would not meet the same refusal, start a new ledger file (a new `TOKENIZE_DB` name) with
  the same keys and call log, run preflight (5 reads) and go on from deploy, or from fund when preflight says so.
  Write it in the deviations file: a transaction of the old ledger could still land.
- **`not signed. An earlier transaction of the same sender has no receipt yet`.** Run the command of that earlier
  transaction again first; the line names it.
- **Never** run two commands on one ledger at once, and never delete, empty or swap the ledger or the call log
  during a run: the ledger remembers its call log and refuses another one.

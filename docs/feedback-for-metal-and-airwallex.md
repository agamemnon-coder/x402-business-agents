# Feedback for Metal and Airwallex

From the Purser team (Airwallex Agentic Banking Hackathon, Metal Award). First written 31 October 2026, cut down and
corrected on 6 November after a review of our own Metal code ([metal-review.md](metal-review.md)).

Purser gives each AI agent of a small company an Airwallex card and a Metal mandate, within limits the CFO signs with
Face ID. We used `@metalntwx/metal-pay` 0.3.4, `@metalntwx/metal-agent` 0.3.3 and `@metalntwx/metal-ts` 0.3.2 on Metal
testnet, and the Airwallex sandbox (API version 2025-11-11), from 29 October to 3 November. Every item names the file,
run log or commit where you can see it. Only what we ran into ourselves.

## Metal

### What worked

- **Refusals with a name.** Over the cap, Metal answered `mandate_cap_exceeded`; under a replaced mandate,
  `mandate_revoked`; nothing moved and the buyer was not charged. `mandate pull --record-refusal` put the refusal of
  stock check #24 on chain in the main run: [`0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871)
  (`src/metal/recordRefusal.ts`, `docs/runs/2026-11-03-main-run.md`).
- **`mandate pull --payment-id` pays once.** "already paid, nothing sent" on a repeat made crash recovery of refunds
  and sweeps a retry with the same id (`src/metal/pull.ts`, `docs/runs/2026-10-29-s2.md`).
- **`mandate replace` carries the spend.** Two replaces in the main run, 31 s from the CFO's Face ID to the second one
  on chain; the old credential was refused at once (`src/executors/mandateReplace.ts`).
- **`requireSignedOffer` and `verifyMandatePayment`.** Our seller requires the buyer's signed order; in a dispute we
  checked 12 of 12 orders from the chain alone (`src/servers/seller.ts`, `src/agents/disputes.ts`).
- **Clearing under load.** 2,000 of 2,000 payments of 0.001 from 16 wallets, nothing paid twice, the seller's balance
  up by exactly 2.000 (`docs/runs/2026-10-30-clearing-load.md`).
- **Receive policy quarantine** worked as documented, from the hold to the claim (`docs/metal-award.md`, section 5).
- **`authorizeMandateCall`** built the same bytes as our own 2-of-2 signer (`test/four-eyes-onchain.test.ts`), and
  bound a mandate on an account whose owners are two passkeys (`docs/runs/passkey-owners.json`).

### What was hard

| # | What we saw | What we did | Ask |
|---|---|---|---|
| M1 | `metal_getFinalityCertificate` gives an aggregate BLS signature, but testnet's validator keys are not published. | We check the header hash, block number and quorum, pin 4 validators, and label each certificate "reported", never "certified" (`src/metal/finality.ts`, `PINNED_VALIDATORS`). | Publish the validator set and its BLS keys; a verify example in `metal-ts`. |
| M2 | Nodes keep about 100,000 certificates, about 2.1 hours at 13.4 blocks/s; ours from the 30 October run were gone before we built the feature. No answer says "pruned" vs "not indexed yet". | Fetch every minute; infer "pruned" from the block's age (`RETENTION_BLOCKS`). | Longer retention or an archive endpoint; a "pruned" answer. |
| M3 | `metal-agent mandate pull` knows a payment id only under one mandate ("a retry ... under a credential that renewed or replaced it, signs a new payout"). A refund pending across a replace could be paid twice. | Before a retry, we run the same pull under the old credential and resend under the new one only if it was refused (`src/metal/pull.ts`, `test/metal-pull-after-replace.test.ts`). | Let `pull --payment-id` look across the principal's replaced mandates, or have `replace` carry the kept pulls. |
| M4 | metal-agent exits 1 for a refusal and for a setup error. In rehearsal 3, `error: HOME is … not an absolute path` was recorded as three refunds and a sweep REFUSED. | Any `error:` line is an error, whatever the exit code (`src/metal/agentCli.ts`, commit `9620f3f`). | A separate exit code for usage errors; a JSON output mode. |
| M5 | The settlement reasons that mean "nothing moved" (`NOTHING_SETTLED`) live only inside metal-agent's `pay` command. | We copy the list and a test fails if the pinned CLI's list changes (`src/metal/pay.ts`, `test/metal-review-fixes.test.ts`). | Export `nothingSettled(reason)` from metal-pay. |
| M6 | `verifyMandatePayment` says whether the signed order was checked only in step 4's English detail. | We read it from step 4's outcome with the order given (`src/agents/disputes.ts`). | A structured field, e.g. `orderChecked: true`. |
| M7 | A clearing payment counts when the payer makes it: a seller that refuses in `onBeforeSettle` still gets paid (5 paid, 4 delivered: payer 4.65, seller 0.35). | Our seller offers clearing only after a free price check shows it can deliver; else the mandate route (`src/servers/seller.ts`, `docs/runs/2026-10-29-clearing.md`). | Say it on the clearing page; a void within the epoch. |
| M8 | `between_epochs` refusals: 1,016 over 2,000 payments, most of the p95 of 8.1 s. | We wait 3 s and retry (`src/agents/customer.ts`). `ClearingRefusal.retry.ms` gives the wait; we found it late. | Hold a payment across the boundary, or publish the epoch length. |
| M9 | A wallet's record is for one Clearing deployment; nothing stops a caller from reopening it for another. | We record the deployment beside the wallet and refuse another (`walletDirFor` in `src/metal/clearing.ts`). | Have `openClearingWallet` record and check the deployment itself. |
| M10 | The first `withdrawFromClearing` claim reverted at the epoch boundary; the same call 18 s later claimed 0.70. | Call again later (`src/cli/clearing.ts`). | A "claimable from epoch N" view, checked before sending. |
| M11 | A 2-of-2 MetalAccount reverts with no reason when a signature is missing; we told "one signer" from "a stranger" only by gas (237,580 vs 40,620). | `whyRefused` in `src/cli/fourEyes.ts`. | Custom errors: threshold not met, unknown signer, expired. |
| M12 | No send-policy contract is shipped, though the pattern is documented. | We wrote `contracts/ComplianceSendPolicy.sol` (MIT); 11 attacks reverted on testnet (`docs/runs/2026-10-30-compliance-policy.md`). | An audited reference contract. |
| M13 | Testnet's ReceivePolicy is the earlier one: `policyOf` returns five fields; no maximum amount or sender totals. | Allowlist and quarantine only (`src/metal/receivePolicy.ts`). | Deploy the current one, or a version getter. |
| M14 | metal-agent 0.3.3 pins `metal-pay` 0.3.3 exactly, so the CLI and our code run different metal-pay versions; no changelog ships in the packages. | Documented in `docs/metal-award.md`; we scrub the CLI's output ourselves. | A caret range, and a CHANGELOG in each package. |

Corrected on 6 November: our first version asked for a reason code and the held request's details on a lost clearing
answer. metal-pay 0.3.4 already throws `ClearingRefusal` with `reason` (`answer_lost`, `payment_held`) and `retry`
(`url`, `amount`, `ms`); we had matched message text instead. Fixed in `src/metal/clearing.ts`. We also dropped the
item on spend controls for a plain `x402Client`: the README documents `setSpendControls({ allowedAssets })`.

## Airwallex

### What worked

- **`request_id` made lost answers safe:** `GET /fx/conversions?request_id=…` returns exactly one conversion
  (`docs/runs/2026-10-29-s3.md`).
- **Limits enforced at the card:** `LIMIT_EXCEEDED`, `MERCHANT_CATEGORY_NOT_ALLOWED`, `CARD_INACTIVE`
  (`docs/runs/2026-10-30-single-use.md`).
- **Webhooks within a second**, before our poll (`docs/runs/2026-10-30-webhooks.md`).
- **A simulated deposit's `reference` comes back verbatim**, which links each Metal sweep tx to its Airwallex deposit.
- **`metadata` on conversions and transfers** holds the hash of the terms the CFO approved (`docs/airwallex.md`).

### What was hard

| # | What we saw | What we did | Ask |
|---|---|---|---|
| A1 | The webhook update call changes only the url; adding events needs a new subscription and a new signing secret. | A second subscription, the secret rolled out, the old one deleted (`src/airwallex/webhooks.ts`, commit `9d763f7`). | Edit the event list in place, or rotate with an overlap. |
| A2 | `401 Insufficient permissions for subscribing to conversion.overdue`, for a key that subscribes to the other `conversion.*` events. | Left it out (`docs/runs/2026-10-30-webhooks.md`). | Name the missing permission, or align it. |
| A3 | Right after the one approved charge, a `SINGLE` card reads ACTIVE, and `card_status: INACTIVE` answers `400 invalid_argument` ("Invalid status update"); a moment later it is CLOSED. A second charge is declined `CARD_CLOSED`. | Freeze only an open card; on that 400, read until CLOSED (commit `7537467`). | Close with the approval; a "transaction count reached" reason. |
| A4 | The SWIFT fee is EUR 13.40 to 13.47 in the sandbox, not the kit's 12.85, and known only after the transfer; `transfers/validate` answers OK only. | Reserve a EUR 20.00 fee ceiling, record the real fee (`docs/airwallex.md`, commit `755c670`). | A fee quote before sending. |
| A5 | The sandbox cannot receive stablecoins, so Metal earnings arrive as a simulated USD deposit naming the tx. | `POST /simulation/deposit/create` with the tx hash as `reference`, labelled simulated everywhere. | A sandbox stablecoin deposit with chain and tx fields. |
| A6 | One card authorisation comes with two ids and two event families (`issuing.transaction.*`, `issuing.card_transaction_event.*`); the sandbox sends the object as `data`, not `data.object`. | Deduplicate before counting toward speed limits (`src/policy/cards.ts`, commit `f26c370`). | Both ids in every shape; say which family is current. |
| A7 | No `deposit.pending` for a simulated deposit; no SWIFT UETR on a PAID transfer; 10,000,000 per currency to start. | Pending handling tested on stand-ins; the transfer id stands in for the UETR in our pacs.008 export (`src/finance/iso20022.ts`). | A pending stage, a simulated UETR, settable balances. |
| A8 | `GET /deposits` wants `page_num` with `page_size`; `GET /fx/conversions` rejects a `page_size` below 10. | Both sent (`docs/runs/2026-10-29-s3.md`). | Defaults, and the minimum in the reference. |

Thank you to both teams. We are happy to rerun any of these.

# Feedback for Metal and Airwallex

From the Purser team, Airwallex Agentic Banking Hackathon (Metal Award), written 31 October 2026.

## Who we are and what we built

Purser gives each AI agent of a small company an Airwallex company card and a Metal on-chain mandate, within limits
the CFO sets. Agents pay inside those limits on their own. Past a limit, Airwallex declines or Metal refuses, and the
CFO approves the exact terms on a phone with Face ID. Built with Claude (Anthropic) as the developer, directed and
reviewed by Max Geurtsen.

What we used:

- **Airwallex sandbox:** Issuing (cardholders, virtual cards, single-use task cards, limits, simulated charges), FX
  rates, quotes and conversions, beneficiaries, SWIFT transfers, Global Accounts, deposits and webhooks (API version
  2025-11-11).
- **Metal testnet:** smart accounts, mandates, x402 through Metal's facilitator, pay-per-call clearing (`bajillion`),
  the receive policy, finality certificates and a 2-of-2 account. Packages: `@metalntwx/metal-pay` 0.3.4,
  `@metalntwx/metal-agent` 0.3.3, `@metalntwx/metal-ts` 0.3.2.

Thank you to both teams. The sandbox and testnet held up through two live runs and many rehearsals, and most of what
follows is small. We list only what we ran into ourselves. Each item says where in this repository it is recorded, so
you can check the context. The runs were on 29 and 30 October 2026.

Each item has five parts: **What we saw**, **Reproduce**, **Impact**, **Suggestion** and **Where recorded**.

---

## Metal

| # | Item | Impact for us |
|---|---|---|
| M1 | Finality certificates: the BLS signature cannot be verified | high |
| M2 | Finality certificates are kept only about 2 hours | high |
| M3 | Clearing: a lost answer holds the wallet until the same request is sent again | medium |
| M4 | Clearing: `between_epochs` pauses make up most of the p95 latency | medium |
| M5 | Clearing: the payer is charged even when the seller refuses | medium |
| M6 | Clearing: the first withdrawal claim reverted at the epoch boundary | low |
| M7 | x402's default spend controls do not pay *USDZ through a fresh clearing client | low |
| M8 | Outcomes are free text, and the "nothing moved" list lives only in metal-agent | medium |
| M9 | metal-agent exits 1 both for a refusal and for a setup error | medium |
| M10 | No send-policy contract is shipped | medium |
| M11 | Testnet runs an earlier receive policy | low |
| M12 | A smart account gives no revert reason when the signatures fall short | low |
| M13 | Facilitator calls have no published price | low |
| M14 | The faucet gives one grant a minute | low |

### M1. Finality certificates: the BLS signature cannot be verified

- **What we saw:** `metal_getFinalityCertificate` returns the header, the signer bitmap and count, and an aggregate
  BLS12-381 signature. Metal has not published testnet's validator public keys, or the validator set itself. So we
  can check the header hash, the block number and the quorum count, but not the signature. We pinned the validator
  count at 4, as the certificates report it.
- **Reproduce:**
  1. Call `metal_getFinalityCertificate` for a recent testnet block.
  2. Look for testnet's validator BLS public keys in the docs or packages. We found none.
  3. Try to verify the aggregate signature. Without the keys, it cannot be done.
- **Impact:** a stored certificate is only "what the RPC reported". A wrong or compromised RPC could make one up. We
  label every certificate REPORTED, not CERTIFIED, in the audit PDF, the dispute pack and `npm run verify`.
- **Suggestion:** publish the testnet validator set (BLS public keys, count and changes per epoch) at a stable place,
  such as a docs page, an RPC method or a contract. A short verification example in `metal-ts` would help too.
- **Where recorded:** `src/metal/finality.ts` (header comment and `PINNED_VALIDATORS`, `NOT_CHECKED`);
  `docs/metal-award.md`, section "Finality certificates"; `docs/runs/2026-10-30-four-eyes.md`, "Finality"; commits
  `74d94f8` and `8eb8454`.

### M2. Finality certificates are kept only about 2 hours

- **What we saw:** nodes keep about the last 100,000 certificates. At testnet's 13.4 blocks a second (we measured
  it), that is about 2.1 hours. The certificates of our recorded run had expired before we built this feature.
- **Reproduce:**
  1. Take a transaction that is more than about 2.1 hours old, for example one from our Friday run 1.
  2. Call `metal_getFinalityCertificate` for its block. No certificate comes back.
- **Impact:** we fetch certificates every minute so as not to lose them. A dispute or audit that starts days later
  cannot get the certificate from Metal. We also cannot tell from the answer whether a certificate was pruned or is
  not indexed yet, so we infer it from the block's age.
- **Suggestion:** keep certificates longer, or offer an archive endpoint. Say in the answer when a certificate was
  pruned. Giving the window in hours for testnet, next to the 100,000 blocks, would help.
- **Where recorded:** `src/metal/finality.ts` (header comment, `RETENTION_BLOCKS`); `docs/metal-award.md`, "About 2
  hours"; commit `74d94f8` ("Metal finality certificates as evidence").

### M3. Clearing: a lost answer holds the wallet until the same request is sent again

- **What we saw:** in our first load run, one payment got no receipt back. The client said `no receipt this wallet
  could check came back for this payment`. It then refused the wallet's next 120 payments with `the wallet holds an
  earlier payment whose outcome is unknown`. Nothing was paid twice, which is good. Sending the same request again, as
  Metal's docs say, freed the wallet.
- **Reproduce:**
  1. Run `npm run clearing-load -- 16 125 0.001` (16 wallets, 125 payments of 0.001 each) without the resend
     logic (as in run 1).
  2. Wait for one payment whose answer is lost.
  3. See that wallet's remaining payments refused. Run 1 paid 1,879 of 2,000.
  4. Send the same request again. The wallet resolves the held payment.
- **Impact:** an agent stops paying until it knows to resend that exact request. A new request does not free the
  wallet. We now resend up to five times, then mark the payment "in doubt".
- **Suggestion:** a client call that resolves a held payment directly, for example by payment id. Or put a stable
  error code and the held request's details in the error, so a caller can resend it without keeping its own copy.
- **Where recorded:** `docs/runs/2026-10-30-clearing-load.md`, "Finding 1"; `src/metal/clearing.ts`
  (`outcomeUnknown`); `src/agents/customer.ts` (`tryClearing`); `docs/metal-award.md`, "Clearing under load"; commit
  `9501097`.

### M4. Clearing: `between_epochs` pauses make up most of the p95 latency

- **What we saw:** the service refuses payments for a few seconds at each epoch close (`between_epochs`). In run 2
  that happened 1,016 times over 2,000 payments. Latency was p50 1.4 s, p95 8.1 s, p99 8.8 s. Most of the tail is
  waiting out the pause.
- **Reproduce:**
  1. Run `npm run clearing-load -- 16 125 0.001`.
  2. Count the `between_epochs` refusals and look at the latency percentiles in `docs/runs/clearing-load-2.json`.
- **Impact:** an agent waiting for data sees 8-second stalls. We chose a 3 s retry delay by guessing, because the
  answer does not say when the next epoch opens.
- **Suggestion:** return a retry-after value with `between_epochs`, or let the service hold the payment across the
  boundary. Document the epoch length and the pause.
- **Where recorded:** `docs/runs/2026-10-30-clearing-load.md`, "Finding 2"; `docs/runs/2026-10-29-clearing.md`,
  step 5; `src/metal/clearing.ts` (header comment, `betweenEpochs`).

### M5. Clearing: the payer is charged even when the seller refuses

- **What we saw:** a probe seller refused one clearing payment in its `onBeforeSettle` hook. The payer was charged
  anyway. After 5 payments and 4 deliveries, the payer's spendable balance was 4.65 and the seller's 0.35. A clearing
  payment counts when the payer makes it, before the seller can say no.
- **Reproduce:**
  1. Offer a route with the `bajillion` scheme and refuse one payment in `onBeforeSettle`.
  2. Pay it from a clearing wallet.
  3. Compare both clearing balances. The refused payment is counted.
- **Impact:** a seller may offer clearing only when it is sure it can deliver. We built a separate prepaid route and
  a free price check before the offer, plus a refund path for "paid, not delivered".
- **Suggestion:** say this plainly on the clearing page. If possible, let a seller void a payment it refused within
  the same epoch.
- **Where recorded:** `docs/runs/2026-10-29-clearing.md`, step 6 and "The design that follows"; `src/metal/clearing.ts`
  (header comment); commit `51c35c8`.

### M6. Clearing: the first withdrawal claim reverted at the epoch boundary

- **What we saw:** we queued a withdrawal and called it again about 20 minutes later. The first call reverted in
  `claim` and nothing moved. Our best guess is that the epoch had just finalized. The same call 18 seconds later
  claimed 0.70 *USDZ.
- **Reproduce:**
  1. `npm run clearing -- withdraw` to queue the withdrawal.
  2. Call it again close to the moment its epoch finalizes. The `claim` transaction can revert.
  3. Call it again a little later. It succeeds.
- **Impact:** a reverted transaction in the record, and no way to know when a claim will succeed except to try.
- **Suggestion:** a view such as "claimable from epoch N" or "epoch final: yes/no", and a check in
  `withdrawFromClearing` before it sends.
- **Where recorded:** `docs/runs/2026-10-29-clearing.md`, "Earnings withdrawn"; `src/cli/clearing.ts` (the "call again
  later" messages); commit `5a16775`.

### M7. x402's default spend controls do not pay *USDZ through a fresh clearing client

- **What we saw:** x402's default spend controls allow only well-known assets, and *USDZ is not one of them. The
  mandate client from `createMandatePaymentClient` sets `allowedAssets` to *USDZ. A plain `x402Client` with
  `registerClearingClient` does not, so we had to set it ourselves.
- **Reproduce:**
  1. `const client = new x402Client(); registerClearingClient(client, "eip155:63825", clearing);`
  2. Pay a `bajillion` route with `wrapFetchWithPayment`. The default spend controls stop the *USDZ payment.
  3. Add `client.setSpendControls({ allowedAssets: ... })` and it pays.
- **Impact:** small. It cost some time in the load test.
- **Suggestion:** have `registerClearingClient` allow *USDZ (only that asset), or export a helper for Metal's spend
  controls and mention it on the clearing page.
- **Where recorded:** `src/cli/clearingLoad.ts`, the comment above `setSpendControls`; `test/metal-pay.test.ts` ("As
  the real factory does: only *USDZ may be paid").

### M8. Outcomes are free text, and the "nothing moved" list lives only in metal-agent

- **What we saw:** `between_epochs` comes with a `reason` field. "Outcome unknown" does not, so we match the message
  text (`/outcome is unknown|no receipt/`). For x402 under a mandate, the settlement reasons that mean "nothing moved"
  are defined in metal-agent 0.3.3. They are not exported from metal-pay, so we copied the list.
- **Reproduce:** see `outcomeUnknown` in `src/metal/clearing.ts` and `NOTHING_SETTLED` in `src/metal/pay.ts`.
- **Impact:** these checks decide between "paid", "refused" and "in doubt". If a message is reworded or a reason is
  added, our money logic changes silently.
- **Suggestion:** stable error codes on every clearing error, and a `nothingSettled(reason)` export from metal-pay.
- **Where recorded:** `src/metal/clearing.ts` (`betweenEpochs`, `outcomeUnknown`); `src/metal/pay.ts` (header
  comment and `NOTHING_SETTLED`).

### M9. metal-agent exits 1 both for a refusal and for a setup error

- **What we saw:** rehearsal 3 started with a relative keys folder. metal-agent refuses a relative `HOME`, prints
  `error: HOME is … not an absolute path` and exits 1. Exit 1 also means "refused" for `mandate pull`. Our wrapper read
  the setup error as a refusal and recorded three refunds and a sweep as REFUSED, though nothing was sent.
- **Reproduce:**
  1. Run `metal-agent mandate pull …` with `HOME` set to a relative path. It exits 1 with an `error:` line.
  2. Run a pull above the mandate's cap. It also exits 1, with `outcome refused`.
- **Impact:** a wrong record in a live rehearsal, fixed before the Friday runs. We now treat any `error:` line as an
  error, whatever the exit code.
- **Suggestion:** a separate exit code for usage and setup errors, and a JSON output mode if there is none yet.
- **Where recorded:** `docs/runs/2026-10-29-rehearsal-3.md`, "Two bugs found and fixed during the run";
  `src/metal/agentCli.ts` (`keysDir`, `metalAgent`); commit `9620f3f`.

### M10. No send-policy contract is shipped

- **What we saw:** Metal documents the send-policy pattern (programmable compliance), but ships no such contract,
  in the docs or in its packages. We wrote `contracts/ComplianceSendPolicy.sol`: funds leave only with a decision
  Purser's compliance key signed for that exact payment. Per Metal's docs, mandate pulls from a MetalAccount do not
  pass through a send policy.
- **Reproduce:**
  1. Read docs.metalntwx.com/learn/compliance/programmable-compliance.
  2. Look for a send-policy contract in `@metalntwx/*`. There is none.
- **Impact:** each team writes and checks its own compliance contract. For a regulated user, an unaudited contract
  is a blocker.
- **Suggestion:** ship an audited reference contract (a signed decision per payment, expiry, cancellation, replay
  protection, chain id in the domain). Ours is MIT-licensed and can be a starting point.
- **Where recorded:** `docs/runs/2026-10-30-compliance-policy.md`; `contracts/ComplianceSendPolicy.sol`;
  `docs/metal-award.md`, "Programmable compliance"; commit `08d219f`.

### M11. Testnet runs an earlier receive policy

- **What we saw:** `policyOf` returns five fields. Allowlist, blocklist, token filter, minimum amount, quarantine and
  claim work. Maximum amounts, sender totals and sender frequency do not yet, as Metal's page warns.
- **Reproduce:**
  1. Call `policyOf(account)` on ReceivePolicy (`0x…0f4d`). It returns five fields.
  2. Compare with the fields on the receive policy reference page.
- **Impact:** our sweep wallet can allow only the business account, but cannot cap what that account sends.
- **Suggestion:** deploy the current ReceivePolicy to testnet, or add a version getter so code can check what it
  talks to.
- **Where recorded:** `docs/metal-award.md`, section 5 ("What testnet does not have yet");
  `src/metal/receivePolicy.ts` (header comment); commit `c11f2f6`.

### M12. A smart account gives no revert reason when the signatures fall short

- **What we saw:** on a 2-of-2 MetalAccount, a payment signed by one owner reverts, as it should. A simulation with
  ample gas also reverts, with "unknown reason". We could tell "one signer" from "a stranger's key" only from the gas
  used (237,580 against 40,620).
- **Reproduce:**
  1. `npm run four-eyes` in a test world.
  2. Step 7: pay 1.00 from the account signed by the CFO alone. It reverts.
  3. Simulate the same call. There is no revert reason.
- **Impact:** an operator cannot see why a payment was refused.
- **Suggestion:** custom errors such as threshold not met, unknown signer or expired.
- **Where recorded:** `docs/runs/2026-10-30-four-eyes.md` (the gas figures and "The account gives no revert
  reason"); `src/cli/fourEyes.ts` (`whyRefused`); commit `0707831`.

### M13. Facilitator calls have no published price

- **What we saw:** Metal publishes RPC prices ($0.05 per 1,000 base calls, $0.08 per 1,000 `eth_call`s). From our
  call counts, a 0.001 clearing payment costs about $0.0007 in RPC calls. The 2,002 facilitator calls in run 2 have
  no published price.
- **Reproduce:**
  1. Run `npm run clearing-load -- 16 125 0.001`. It counts RPC calls by method, and facilitator calls.
  2. Price the calls with docs.metalntwx.com/network/credits. No price is given for facilitator calls.
- **Impact:** we cannot give full costs per payment. Below about a tenth of a cent, checking a payment costs more
  than the payment.
- **Suggestion:** publish facilitator pricing, even if it is "free on testnet". A cheaper way to check many clearing
  receipts at once would help for very small prices.
- **Where recorded:** `docs/runs/2026-10-30-clearing-load.md`, "Cost" and "Finding 3"; `docs/runs/clearing-load-1.json`.

### M14. The faucet gives one grant a minute

- **What we saw:** bootstrapping a fresh world needs several faucet grants. The faucet asked us to wait in each
  bootstrap.
- **Reproduce:** run `npm run bootstrap` for a new world. The faucet asks to wait, and the script retries after 65 s.
- **Impact:** about four minutes per world. We bootstrapped the Friday worlds the night before, so this did not
  cost time on camera.
- **Suggestion:** a small burst allowance for builders, or document the limit and its error text.
- **Where recorded:** `docs/decisions.md`, D8; `src/cli/bootstrap.ts` (`withFaucetRetry`);
  `docs/runs/2026-10-29-rehearsal-6.md`.

---

## Airwallex

| # | Item | Impact for us |
|---|---|---|
| A1 | A webhook subscription cannot get more events; a new one means a new secret | medium |
| A2 | `conversion.overdue` refused for the scoped key (401) | medium |
| A3 | A single-use card closes a moment after the charge and refuses a status update in between | medium |
| A4 | A second use of a single-use card is declined `CARD_CLOSED` | low |
| A5 | The SWIFT fee is 13.40 to 13.47 in the sandbox, not the 12.85 in the kit, and is not quoted in advance | medium |
| A6 | The sandbox cannot receive stablecoins | medium |
| A7 | `deposit.pending` is not sent for simulated deposits | low |
| A8 | The sandbox assigns no SWIFT UETR | low |
| A9 | Very large sandbox balances | low |
| A10 | One card authorisation has two ids and two event shapes | medium |
| A11 | Small API quirks: pagination and the API version | low |

### A1. A webhook subscription cannot get more events; a new one means a new secret

- **What we saw:** the update call for a webhook subscription changes only its url. To add events, we had to create
  a new subscription. That gives a new signing secret.
- **Reproduce:**
  1. `POST /webhooks/create` with the four card transaction events.
  2. Try to add payout, conversion and deposit events with the update call. Only the url can change.
  3. Create a second subscription with all events, roll its secret out to every verifier, then delete the old one.
- **Impact:** adding one event becomes a secret rotation. For us that needed the CFO's go. While both
  subscriptions exist, every event comes twice.
- **Suggestion:** let the update call change the event list and keep the secret. Or support secret rotation with an
  overlap period.
- **Where recorded:** `docs/airwallex.md`, "Webhooks"; `src/airwallex/webhooks.ts` (header comment);
  `docs/runs/2026-10-30-webhooks.md`; commit `9d763f7`.

### A2. `conversion.overdue` refused for the scoped key (401)

- **What we saw:** creating a subscription with `conversion.overdue` failed with `401 Insufficient permissions for
  subscribing to conversion.overdue`. The same key subscribed to `conversion.scheduled`, `.settled` and `.cancelled`
  without a problem, and it books conversions. The failed create made nothing, which is good.
- **Reproduce:**
  1. With a scoped key that has Webhooks and FX write, `POST /webhooks/create` with the four `conversion.*` events.
  2. It answers 401 for `conversion.overdue`.
  3. Without that event, the create succeeds.
- **Impact:** a treasury agent cannot hear about an overdue conversion, which is the conversion event it most
  needs.
- **Suggestion:** document which permission covers `conversion.overdue`, or match it to the other conversion
  events. Naming the missing permission in the 401 would help.
- **Where recorded:** `docs/runs/2026-10-30-webhooks.md`, "What ran", step 1; `docs/airwallex.md`, "Webhooks";
  commit `9d763f7`.

### A3. A single-use card closes a moment after the charge and refuses a status update in between

- **What we saw:** right after the one approved charge on a `SINGLE` card, the card still read ACTIVE. Setting it
  INACTIVE was refused with `400 invalid_argument` ("Invalid status update"). A moment later it read CLOSED.
- **Reproduce:**
  1. `POST /issuing/cards/create` with `allowed_transaction_count: SINGLE`.
  2. `POST /simulation/issuing/create`: one charge, approved.
  3. At once, `GET /issuing/cards/{id}` (ACTIVE), then `POST /issuing/cards/{id}/update` with `card_status: INACTIVE`.
     It answers 400.
  4. Read the card again a moment later. It is CLOSED.
- **Impact:** our "freeze after use" step failed in that window. We now freeze only an open card, and if Airwallex
  refuses, we read the card until it is closed.
- **Suggestion:** close the card together with the approval. Or accept INACTIVE as a no-op on a card that is about
  to close, or return a specific error code for that state.
- **Where recorded:** `docs/runs/2026-10-30-single-use.md` (Train •••• 9799, and finding 2); commit `7537467`.

### A4. A second use of a single-use card is declined `CARD_CLOSED`

- **What we saw:** a second charge on a used single-use card is declined `CARD_CLOSED`. Our test double had guessed
  another reason.
- **Reproduce:**
  1. Use a `SINGLE` card once (approved).
  2. Simulate a second charge. It is declined `CARD_CLOSED`.
- **Impact:** small. A CFO reading `CARD_CLOSED` cannot tell "used once, as planned" from "closed by an admin".
- **Suggestion:** document the decline reasons for single-use cards. A specific reason, such as "transaction count
  reached", would be clearer.
- **Where recorded:** `docs/runs/2026-10-30-single-use.md` (finding 1); `docs/airwallex.md`, Issuing table; commit
  `7537467`.

### A5. The SWIFT fee is 13.40 to 13.47 in the sandbox, not the 12.85 in the kit, and is not quoted in advance

- **What we saw:** the kit gives a flat EUR 12.85 SWIFT fee. The sandbox charged between EUR 13.40 and EUR 13.47
  across our runs. The fee is known only after the transfer. `transfers/validate` answers only OK.
- **Reproduce:**
  1. `POST /transfers/create`: EUR 1,850.00 by SWIFT to a DE beneficiary.
  2. Move it to SENT and PAID with `POST /simulation/transfers/{id}/transition`.
  3. `GET /transfers/{id}` shows a fee of about EUR 13.4x.
- **Impact:** our first live run paid EUR 0.62 out of money set aside for other bills. We now reserve a fee ceiling
  of EUR 20.00 and record the real fee.
- **Suggestion:** a fee quote before sending, or the fee in the validate answer. Align the kit's figure with the
  sandbox, or say that the fee varies.
- **Where recorded:** `docs/airwallex.md`, "Fee-aware"; `docs/runs/2026-10-29-s3.md`, "Finding"; fees in
  `docs/runs/2026-10-29-f1.md`, `2026-10-29-rehearsal-3.md`, `2026-10-30-friday-1.md`, `2026-10-30-endcheck.md`; commit
  `755c670`.

### A6. The sandbox cannot receive stablecoins

- **What we saw:** as the kit says, the sandbox cannot receive stablecoins. Our agents' earnings on Metal therefore
  reach Airwallex as a simulated USD deposit, with the Metal transaction hash as `reference` and 1 *USDZ booked as
  1 USD.
- **Reproduce:**
  1. Look for a way to receive a stablecoin into a sandbox account. There is none.
  2. Use `POST /simulation/deposit/create` with the chain transaction hash as `reference` instead.
- **Impact:** the bridge between the two rails, which the Metal Award is about, is the one part of our demo that is
  simulated on the Airwallex side.
- **Suggestion:** a sandbox stablecoin deposit (a testnet address per account), or a simulation that models a
  stablecoin deposit with chain, transaction and asset fields.
- **Where recorded:** `docs/airwallex.md`, "Deposits and balances"; `docs/runs/2026-10-29-s3.md` ("Credit");
  `docs/runs/2026-10-30-friday-1.md` (S3); `docs/security.md`.

### A7. `deposit.pending` is not sent for simulated deposits

- **What we saw:** with `deposit.pending` and `deposit.settled` both subscribed, a simulated deposit sent only
  `deposit.settled`. Simulated deposits settle in about a second, so `PENDING` cannot be observed.
- **Reproduce:**
  1. Subscribe to `deposit.pending` and `deposit.settled`.
  2. `POST /simulation/deposit/create`.
  3. Only `deposit.settled` arrives. `GET /deposits` already shows SETTLED.
- **Impact:** our handling of pending deposits (never counted as spendable) is tested only against stand-ins.
- **Suggestion:** a simulation option for a pending stage (and for rejected and reversed), with a delay or an
  explicit transition, as transfers have.
- **Where recorded:** `docs/runs/2026-10-30-webhooks.md`, "Not shown live"; `docs/runs/2026-10-29-s3.md`, open item 8.

### A8. The sandbox assigns no SWIFT UETR

- **What we saw:** a PAID SWIFT transfer in the sandbox does not expose a UETR. For our ISO 20022 pacs.008 export we
  put Airwallex's transfer id (a UUID v4) in the UETR field and said so.
- **Reproduce:**
  1. Create a SWIFT transfer and move it to PAID.
  2. `GET /transfers/{id}`. There is no SWIFT UETR.
- **Impact:** small. An export for a bank or ERP cannot carry the real tracking reference.
- **Suggestion:** expose a simulated UETR in the sandbox, in the same field as in production.
- **Where recorded:** `src/finance/iso20022.ts` (header comment); `docs/airwallex.md` ("the sandbox assigns no SWIFT
  UETR"); `docs/metal-award.md`, section 9.

### A9. Very large sandbox balances

- **What we saw:** the sandbox starts with 10,000,000 each in USD, EUR, GBP and CNY. To show a small company that is
  short of euros, we marked EUR 9,998,000.00 as committed and set the USD floor at 10,020,000.00. The rehearsals also
  shared one sandbox, so one test world's committed euros ended EUR 2,987.56 short.
- **Reproduce:**
  1. `GET /balances/current` on a new sandbox.
- **Impact:** extra setup to make a small company's numbers believable, and test worlds that drift apart.
- **Suggestion:** let developers set starting balances, or reset a sandbox to them.
- **Where recorded:** `docs/runs/2026-10-29-s3.md` ("Health", "Seed", open item 5); `docs/runs/2026-10-29-f1.md`,
  "Found on the way"; `docs/decisions.md`, D11.

### A10. One card authorisation has two ids and two event shapes

- **What we saw:**
  - A declined authorisation was listed under an older transaction id in `GET /issuing/transactions`, while its
    webhook named the card transaction id. We recorded it twice once, then merged it.
  - The same transaction comes in two event families: `issuing.transaction.*` and `issuing.card_transaction_event.*`.
  - The sandbox sends the transaction as `data` itself, not under `data.object`.
  - A card transaction event has no status field. A failure reason means declined.
- **Reproduce:**
  1. Subscribe to both event families.
  2. Simulate a charge over the card's limit.
  3. Compare the ids in the two webhooks with `GET /issuing/transactions`.
- **Impact:** extra deduplication code. Without it, one decline could count twice toward our speed limits.
- **Suggestion:** put both ids in every shape, say which event family is current, and document the webhook
  envelope with an example per event.
- **Where recorded:** `docs/runs/2026-10-29-cards.md`, "Webhooks, live" ("Seen on the way");
  `src/policy/cards.ts` (`ingestCardTransaction`); `src/airwallex/issuing.ts` (the two shapes); `docs/hardening.md`,
  HF12; `docs/runs/2026-10-30-webhooks.md`; commit `f26c370`.

### A11. Small API quirks: pagination and the API version

- **What we saw:**
  - `GET /deposits` wants `page_num` and `page_size` together.
  - `GET /fx/conversions` rejects a `page_size` below 10.
  - Transfers answer in the newer vocabulary, but the API version string is not exposed.
- **Reproduce:** call `GET /deposits?page_size=20` without `page_num`, and `GET /fx/conversions?page_size=5`.
- **Impact:** small. Each cost a few minutes.
- **Suggestion:** defaults for the missing parameter, the minimum in the reference, and the API version in a
  response header.
- **Where recorded:** `docs/runs/2026-10-29-s3.md`, "Quirks seen" and open item 6.

---

## What worked well

**Metal**

- The chain refuses clearly. `mandate_cap_exceeded` and `mandate_revoked` came back as plain reasons, and a refused
  buyer was never charged (`docs/runs/2026-10-30-friday-1.md`).
- `mandate pull` pays a payment id at most once ("already paid, nothing sent"). That made crash recovery simple
  (`docs/runs/2026-10-29-s2.md`).
- Under load, clearing never paid twice and lost nothing. The seller's balance rose by exactly 2,000 × 0.001
  (`docs/runs/2026-10-30-clearing-load.md`).
- The receive policy's quarantine worked as documented, from the hold to the claim (`docs/metal-award.md`, section 5).
- Our 2-of-2 signature is byte-for-byte what Metal's own `authorizeMandateCall` builds
  (`test/four-eyes-onchain.test.ts`).
- The docs had the right answer for the lost-answer case (M3).

**Airwallex**

- `request_id` lookups made lost answers safe. `GET /fx/conversions?request_id=…` returns exactly one conversion
  (`docs/runs/2026-10-29-s3.md`).
- Card limits and merchant categories are enforced at the card: `LIMIT_EXCEEDED`, `MERCHANT_CATEGORY_NOT_ALLOWED`,
  `CARD_INACTIVE` (`docs/runs/2026-10-30-single-use.md`).
- Key scope is enforced: before the Webhooks permission was added, `GET /webhooks` answered `401 Insufficient
  permissions` (`docs/runs/2026-10-29-cards.md`).
- Webhooks arrived within a second, before our poll (`docs/runs/2026-10-29-cards.md`,
  `docs/runs/2026-10-30-webhooks.md`).
- A simulated deposit's `reference` comes back verbatim, which let us link a Metal transaction to an Airwallex
  deposit (`docs/runs/2026-10-29-s3.md`).
- `metadata` on conversions and transfers let us store the hash of the terms the CFO approved, so an auditor can
  check them at Airwallex (`docs/airwallex.md`).

Thank you again. We are happy to share more detail or rerun any of these.

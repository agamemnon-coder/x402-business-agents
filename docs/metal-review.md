# Metal review: does Purser use metal-agent and metal-pay the way Metal intends?

6 November 2026. Read against the pinned packages' own docs and types: `@metalntwx/metal-pay` 0.3.4 (README,
`dist/mandates/*.d.ts`, `dist/clearing-client.d.ts`), `@metalntwx/metal-agent` 0.3.3 (README, `dist/help.js`,
`dist/commands/mandate.js`), and Purser's `src/metal/`, `src/servers/seller.ts`, `src/agents/`, `src/executors/`.
The packages ship no changelog; the README and the types are the contract. Nothing was sent to the chain for this
review.

| Point | Verdict | Where in Purser |
|---|---|---|
| Mandates | Used as intended | `src/cli/bootstrap.ts`, `src/metal/mandate.ts`, `src/metal/pay.ts` |
| `requireSignedOffer` | Used as intended | `src/servers/seller.ts` |
| `verifyMandatePayment` | Used as intended; one brittle read, **fixed** | `src/agents/disputes.ts` |
| Mandate replace | Used as intended; two deliberate deviations, not changed | `src/executors/ownerSigner.ts`, `src/executors/mandateReplace.ts`, `src/metal/pauseChain.ts`, `src/metal/ownersExecute.ts` |
| Refunds as pulls | Used as intended; one gap after a replace, **fixed** | `src/metal/pull.ts`, `src/executors/refunds.ts` |
| Sweep after finality | Used as intended | `src/agents/sweep.ts` |
| Clearing | Used as intended; two deviations, **fixed** | `src/metal/clearing.ts`, `src/servers/seller.ts`, `src/cli/verify.ts` |

## Mandates

- Credentials are written with `metal-agent mandate credential create` (cap, budget, one payee, expiry) and bound with
  `mandate bind` by the owner key. Each agent signs with its own P-256 mandate key; a replacement reuses it with
  `--mandate-key-file`, as the README says.
- Agents pay with `createMandatePaymentClient`. "The client sets no limit of its own", so Purser adds the CFO policy in
  `onBeforePaymentCreation`, inside the mandate's cap (`payUnderMandate`).
- State is read with `readMandateState`; terms with `extractTerms`. `npm run verify` runs `metal-agent mandate verify
  --issuer <owner's issuer public key>` for every credential and every pull.
- Note: `NOTHING_SETTLED` in `src/metal/pay.ts` is a copy of metal-agent's private list (metal-pay exports none). A new
  test (`test/metal-review-fixes.test.ts`) now fails if the pinned CLI's list and ours differ.

## `requireSignedOffer`

- The seller wraps its resource server: `requireSignedOffer(registerMetalScheme(...), { rpcUrl })`, and the route
  offers `extra: { ...SIGNED_OFFER_REQUIRED, resource: SELLER_RESOURCE }`, so the signed order names the one line item.
- Each sale stores the agent's signed order (`signedOfferOf`) and the mandate ref (`mandateRefOf`) with the tx.
- The default factory check is kept (no `accountFactory` override).

## `verifyMandatePayment`

- The Dispute desk calls it per disputed sale with the sale's `tx`, the stored signed order as `checkoutMandate`, and
  the x402 `requirements` the seller served; the factory is the one metal-pay names. This is the intended seller-side
  use ("for a payee that holds no credential").
- **Fixed:** "signed order" was read by matching step 4's English detail (`/checkout mandate is this payment's signed
  order/`). A reworded detail in a later SDK would have turned every order into "not signed", and so into refunds. It
  now reads the outcome: an order was given and step 4 passed (the SDK fails step 4 for an order of another payment).
  Test: `test/metal-review-fixes.test.ts`.

## Mandate replace

- `mandate replace --credential <new> --replaces <old>` runs after the CFO approves; it revokes the old mandate and
  carries its spend, as Metal intends. Purser re-reads the spend on chain first (`readMandateState`) and refuses the
  replace if it moved since the proposal; it orders the steps so the total never passes 20.00.
- **Deviation 1 (kept):** in the main run, Face ID approves the replace in Purser; the account's single owner key, held
  by Purser's runner, signs it on chain. Passkeys as on-chain owners ran in a separate world (1 November,
  `docs/runs/passkey-owners.json`, with Metal's `authorizeMandateCall`). Not changed before the deadline: moving the
  main account to passkey owners is a new world and a new live run. `/metal` says this in words.
- **Deviation 2 (kept):** the phone path (`src/metal/ownersExecute.ts`, `src/metal/fourEyes.ts`) computes the
  account's Execute digest itself instead of calling `authorizeMandateCall`. The digest must sit in the terms the
  phone signs, minutes before the relay sends it; `authorizeMandateCall` signs and sends in one call.
  `test/four-eyes-onchain.test.ts` checks our bytes equal what `authorizeMandateCall` builds. That path allows bind and
  revoke only, not replace.
- Resume after a pause binds a fresh credential with the budget left: `mandate replace` refuses a revoked mandate
  ("already revoked; bind the new credential with mandate bind"), so this follows the CLI's own advice.

## Refunds as pulls

- Refunds (support mandate, payee: the customer only) and sweeps (treasury mandate) are `mandate pull --payment-id
  refund-<sale>` / `sweep-<day>-<n>`. Exit codes 0/1/3/4 are paid/refused/pending/held; an `error:` line is an error
  whatever the code. `HOME` points into the keys directory so `~/.metal-agent/pulls` survives restarts.
- **Fixed:** metal-agent knows a payment id only under the mandate it was sent under: "a retry ... under a credential
  that renewed or replaced it, signs a new payout" (`metal-agent help`, `mandate pull`). A refund left PENDING, then
  retried after a replace, would have been signed again under the new mandate: two payouts if the first one landed.
  `livePull` now looks for that payment id under the agent's other credentials first and runs the same command under
  the old one, which reads how it ended. Only a refused pull (a replaced mandate is revoked) is sent again under the
  new mandate; paid, held or pending is reported, never paid twice. Test: `test/metal-pull-after-replace.test.ts`,
  including a check that the keep-file path matches the pinned CLI's source.

## Sweep after finality

- The sweep is a `mandate pull` under the treasury mandate. Before anything is booked at Airwallex,
  `awaitFinalTransfer` checks the receipt succeeded, finds the *USDZ `Transfer` of exactly that amount from the
  business account to the sweep wallet, waits until `consensus_status.finalized` passes its block, and checks the block
  hash is still canonical. The credit is keyed once by `chainId:tx:logIndex`.
- A pull the sweep wallet's receive policy holds (exit 4) is never bridged.

## Clearing

- Payer: `openClearingWallet` + `createClearingClient` with `maxAmount`, `depositToClearing`, `clearingSpendable`.
  Seller: `ClearingServerScheme` beside `exact`, the deployment read from the facilitator's `/supported`, earnings out
  with `withdrawFromClearing`. `npm run verify` checks every receipt with `verifyClearingPayment`. Clearing is not in
  the main run; it ran separately (29 and 30 October).
- **Fixed:** "A wallet's record is for one Clearing deployment: open a new wallet for a replacement." Purser kept one
  wallet directory per party whatever the deployment. It now writes the deployment beside the wallet on first use and
  refuses to open it for another (`walletDirFor`); the seller then offers no clearing rather than reuse it.
- **Fixed:** a lost answer was recognised by matching message text (`/outcome is unknown|no receipt/`). metal-pay 0.3.4
  throws `ClearingRefusal` with `reason` `answer_lost` or `payment_held`; `outcomeUnknown` now reads the reason first.
- Not changed: the customer still waits a fixed 3 s on `between_epochs` instead of `retry.ms`. It works, and the
  clearing path is not part of the main run.

## Tests added

`test/metal-pull-after-replace.test.ts` (6), `test/metal-review-fixes.test.ts` (7).

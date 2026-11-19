# Hardening, 19 November 2026

Four changes after the Airwallex soak of 19 November and the open risks in [zero-trust.md](../zero-trust.md). Each was
written test first: the test failed on the code before the change and passes after it. No live call was made; every
rail, key and signature below is a stand-in in the test harness. The threat model is [security.md](../security.md).

## 1. Executors check the signed hash before any outside call

**What changed.** The soak found the invoice payment executor reading `GET /balances/current` before it refused a
proposal whose stored terms had been changed after signing. No money moved, but a changed proposal still reached
Airwallex. Every executor that checks a signed terms hash before moving money now calls `hashFirst`
(`src/policy/hashFirst.ts`) before anything outside Purser: the proposal must be approved (or a failed or resumed run of
an approved one), an approval must be on record, and the stored terms must hash to the stored hash and to the hash the
approval records. The execution guard (`beginExecution`) still checks all of it again inside its write lock.

| Executor | Its first outside call before | Now |
|---|---|---|
| Invoice payment (`src/executors/invoicePayment.ts`) | `GET /balances/current` (the floor check) | after the hash check |
| Supplier payment (`src/executors/supplierPayment.ts`) | `GET /balances/current` | after the hash check |
| One Airwallex batch (`src/executors/airwallexBatch.ts`) | `GET /balances/current` | after the batch's hash and each line's own hash, against its approval and the hash the batch signed for it |
| Mandate change (`src/executors/mandateReplace.ts`) | chain reads (the bound mandate, its spend) | after the hash check |

The other executors (refund, policy change, payment batch, owners' execute, Airi, ICC) already ran the guard before
their first outside call. Airi and ICC call out before the guard only on a restart's resume of an action that began
after the guard, to look up or cancel it.

**Tests.** `test/executor-hash-first.test.ts`: one cent added to signed terms; the real Airwallex REST client runs on a
stand-in fetch that records every request, the global fetch is replaced by the same recorder, and the in-memory rails
record every method call. The invoice executor, the supplier executor and the batch executor (batch terms changed, or
one line's own terms changed) each refuse with the signed hash, and every recorder is empty. An unapproved proposal is
refused the same way. `test/executors-mandate.test.ts`: the tampered mandate change makes no chain read.

**Still open.** `hashFirst` is Purser's own code: if Purser's decision code is in an attacker's hands, it can skip this
check like any other (the zero-trust matrix forces it to pass in that case).

## 2. A card's limit goes up only on a verified passkey signature

**What changed.** The card sync used to push whatever the policy table said, with Purser's own Airwallex key. Whoever
controlled Purser's decision code (an unsigned policy change applied) or wrote the database file (a policy row) raised
a card's limit at Airwallex with nobody's signature; only the card's merchant categories still held. Now
(`src/policy/cardRaise.ts`, called from `syncOne`, `setupCards` and `syncCardsIfChanged` in `src/policy/cards.ts`), a
limit goes up only when:

- the last change of that limit on record (`policy.changed`) names a `policy_change` proposal that sets it to exactly
  the new value;
- that proposal's stored terms hash to their hash and to the hash on its approval; and
- a stored passkey signature over that hash verifies, now, against an enrolled passkey's public key (the check
  `npm run verify` makes), not merely an approval row that says "passkey".

Without any change on record, one of our own agents' cards may go up to the limit in the code, no higher; an outside
agent's or a task card's not at all. A limit the policy would raise without that is kept as the card has it, and the
refusal is logged once as `card.raise_refused` (the runner's check every few seconds makes no Airwallex call for it).
Lowering is free, and one limit can be lowered while a raise of the other is refused. A raise signed earlier does not
count once a later change has set another value (no replay). A new card is issued at no more than the signed limits.

**Tests.** `test/card-raise-signed.test.ts`: a signed raise is pushed exactly as signed; a policy row written alone, a
policy change applied with no approval, an approval row marked "passkey" with no stored signature or with a signature
over other terms, and a replayed earlier raise are each refused with the card's limit unchanged at the issuing
stand-in, which still declines a charge over it; lowering, a mixed lower-and-raise, and bringing a card lowered at
Airwallex back to the coded limit work unsigned. In `test/zero-trust.test.ts` the attack
`decision-code-over-card-limit` now ends with the raise refused and a EUR 500.00 charge inside the card's categories
declined for the limit, and the model no longer counts Purser's decision code as voiding the card's limit.

**Still open** (the open risk `card-limit-set-by-purser` in [zero-trust.md](../zero-trust.md)):

- whoever writes the database file can enrol a passkey of their own in it and sign a raise with it; the test shows
  this still raises the card;
- before any passkey is enrolled (local development, approvals by typed hash prefix), the approval on record is all
  that is checked, so whoever can write one can raise a limit;
- anyone with access to the company's Airwallex web app, or an API key with Issuing write access, can change a card's
  limit at Airwallex directly. Purser brings it back down to the policy only when it reads the card from Airwallex
  (`npm run cards -- sync` or `setup`); the runner's routine check compares its own rows and does not see it. Section 4 keeps
  the Issuing write scope off the keys that do not need it;
- a runner host taken over with its keys stays out of scope.

## 3. Cloudflare Turnstile before a public /try start

**What changed.** `POST /v1/try/start` on the hands-on deployment can ask Cloudflare Turnstile's siteverify about the
widget's token before any company or Durable Object exists (`cloud/src/try/turnstile.ts`, wired in
`cloud/src/try/routes.ts`), next to the existing proof of work. It is behind a new switch, `turnstile`, off while its
row is missing, and needs the Worker secret `TURNSTILE_SECRET`, which the owner sets with
`wrangler secret put TURNSTILE_SECRET -c cloud/wrangler.try.jsonc`; the site key is public and the secret is in no file.
It fails closed: switched on with no secret, starts are paused; a missing, wrong, expired or reused token is refused
(403 `turnstile`); a siteverify that cannot be reached, errs or answers anything but `success: true` pauses the start.
A reported action other than `try_start` is refused. The owner's steps are in
[cloud.md](../cloud.md#cloudflare-turnstile-before-a-start-19-nov-off-by-default).

**Tests.** `test/try-turnstile.test.ts`, with a stand-in siteverify that records what it is sent: off, starts run and
siteverify is never called; on, no token and a wrong token are refused with no company made, a good token starts one
and sends the secret, the token, the address and an idempotency key, and the same token again is refused; on with no
secret, starts are paused and nothing is sent; a network error, a 500, a body that is not JSON, `success: "true"` and
an empty answer each refuse the start.

**Still open.** The /try page does not render the Turnstile widget yet (its script and frame from
`challenges.cloudflare.com` must also be allowed in the page's Content-Security-Policy). Until it does, switching
`turnstile` on refuses every start from the page; this was left for a change of its own because it touches the
console's shared CSP. A token proves a browser passed Cloudflare's check, not that it is a person with good intent; the
per-address, per-pool and per-day start limits still apply either way.

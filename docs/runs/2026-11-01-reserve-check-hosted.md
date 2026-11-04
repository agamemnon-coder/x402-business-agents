# Reserve-run check: eff08b4 against the real hosted relay (1 November, evening)

Max asked to make sure tomorrow's reserve run (Monday 2 November 10:00, runner at tag `reserve-run-2026-11-02` =
eff08b4, agents off) meets exactly the relay that is deployed. Two checks, both green. No deploy was made, and none will
be until the reserve run is over.

## 1. The hosted relay is the eff08b4 build

The pages were built from eff08b4 (a separate worktree) and from today's head, and compared byte for byte with what the
hosted relay serves (`/approve/<id>`, `/enrol`, `/policy`, the phone's script `/assets/approve.js`, its stylesheet,
and the guest pages `/`, `/try`, `/metal`, `/live`):

| Page | Hosted = eff08b4 | Hosted = today's head |
|---|---|---|
| approve, enrol, policy, stylesheet | same | same |
| the phone's script | same | different (MFA and D22 text, not deployed) |
| /, /try, /metal, /live | same | different (not deployed) |

So the phone pages tomorrow are the ones the eff08b4 runner was tested with. `/health` answered 503 because no runner
was connected at that moment (expected).

## 2. A full dry run: the eff08b4 runner against the hosted relay

World dry-104 (a fresh test world: Metal testnet, Airwallex sandbox, test passkeys `test-cfo` and `test-controller`,
agents off as tomorrow). The runner ran from an eff08b4 checkout, connected to the deployed relay (not `--local`); the
only difference from the committed dry-run check is that it points at the hosted address (a scratch change, not
committed). Result: **dry run passes, 43 checks, 0 failed, 25 minutes**; `npm run verify`: all checks pass, one
transfer per invoice, one decision per proposal, no page errors.

Steps run:
- 0 Health
- Runner (local relay, real executors)
- Enrol: test-cfo and test-controller, each on their own phone
- S0 Bootstrap
- 1 Sales per query (0.05, upstream 0.02): stock checks 1-40
- 2-4 Price rise, refusal on chain, two options with Opus's advice
- 5 Four eyes on chain (2-of-2 account in this world)
- Mis-tap: A tapped by mistake, then Back; nothing signed
- 6 Mandates replaced: option B, test-cfo then test-controller
- 1b Sales resume (41-50)
- 7 Dispute on signed orders; 'refund all 12' rejected (Opus advises it)
- 8 Receive policy, then the sweep once final
- 9 Bergtex EUR 1,850.00 proposed (sweep first)
- Expiry: the countdown on both phones, then the proposal runs out and a fresh quote needs a new approval
- 9b Bergtex paid: test-cfo and test-controller (four eyes above EUR 1,000)
- 10 Licence EUR 240.00 (FX + SWIFT); the runner is killed right after the approval and restarted
- 11 Cards: EUR 19.99 approved, EUR 45.00 declined, raise EUR 30 → 50
- 12 Emergency stop on, a card charge declined, stop off
- 13 Bank change for Bergtex in three steps (test identities)
- 14 Agent recognition (dev test)
- Links: a private tab twice, and a phone that pinned another runner
- Verify: chain, ledger, audit log; nothing paid twice

The licence payment, for example: conversion EUR 253.48 for USD 286.80 SETTLED, transfer EUR 240.00 to Stockline Data
GmbH PAID with the approval hash in its metadata, fee EUR 13.48 under the EUR 20.00 ceiling.

What tomorrow adds that this could not: Max's and his father's real iPhones and Face ID, and the fresh reserve world.

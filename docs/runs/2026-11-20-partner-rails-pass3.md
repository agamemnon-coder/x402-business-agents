# T:0 at every payment, and each agent's credential as a token: the run of 2026-11-20

**Live, test money only.** Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID). Alta (formerly Metal) testnet, chain id 63825: test USD (*USDZ). T:0's shared sandbox entity ("T:0 Sandbox", USD), through its customer API: other teams' entries are in it too.

**What the token is.** A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run.

Made by `npm run partner-rails -- live` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code `c184c474c819` with this run's own code not yet committed (the commit that adds this record holds it), from 2026-11-20T20:11:02.749Z to 2026-11-20T20:11:24.267Z. This page is written from [2026-11-20-partner-rails.json](2026-11-20-partner-rails.json) by `npm run partner-rails -- --md`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.

**Result:** 2 payments on three rails, each booked in T:0 the moment it settled; 0 of 0 misuses refused as expected; the reconcile check did not run. Every check passed.

## The agents' tokens

| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |
|---|---|---|---|---|---|
| sourcing | `tok_4af76b4bf7e23ea5` (…c35f) | ••6051 (INACTIVE at Airwallex when adopted) | EUR 30.00 a purchase, 100.00 a month, MCC 5734, until 2026-12-20 | `7019c1ec78d9dfb8…7fc3` | active |
| support | `tok_94e5a1c2f4636f23` (…8e64) | ••2361 (INACTIVE at Airwallex when adopted) | EUR 60.00 a purchase, 150.00 a month, MCC 7372, until 2026-12-20 | `4130d7e7094be4ee…b7f5` | active |

## Every payment, booked in T:0 at once

| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |
|---|---|---|---|---|---|---|---|---|---|
| a | the sourcing agent's token pays Packwise EUR 1.00 (warehouse software, MCC 5734) | Visa card, Airwallex Issuing (sandbox) | `7b740b76-ecc1-4000-97b8-3e46c4ce3a31` | EUR 1.00 (T:0: USD 1.09 at 1.085653) | 6100 → T:0 63410 · CC100 | sourcing | `7019c1ec78d9dfb8…7fc3` | `je_prod_5mdfU6jvatSJ4pc8` (`PURPAY-ae1c6a836ccaebf07c0e4ba4`, booked) | 0.9 s |
| b | the support agent's token pays Replyhub EUR 1.25 (helpdesk software, MCC 7372) | Visa card, Airwallex Issuing (sandbox) | `e70fc97a-5945-47a6-98cc-e8361d094820` | EUR 1.25 (T:0: USD 1.36 at 1.085653) | 6100 → T:0 63410 · CC200 | support | `4130d7e7094be4ee…b7f5` | `je_prod_cNtHvaCfpabiiis3` (`PURPAY-6c3747ac114fb81eadb61380`, booked) | 1.4 s |

- **a** terms hash: the token's mandate (SHA-256).
- **b** terms hash: the token's mandate (SHA-256).

## Misuse: refused

| | What | Refused by | Expected | Got | Airwallex calls | |
|---|---|---|---|---|---|---|

## The reconcile check: T:0 against the rails

Not run.

## Checks

| Check | | Detail |
|---|---|---|
| a_card_refrozen | ok | the sourcing agent's card after the purchase: INACTIVE |
| b_card_refrozen | ok | the support agent's card after the purchase: INACTIVE |

**Calls:** Airwallex 17 (login included), T:0 8, Alta transactions 0.

## Notes

- Two earlier passes the same evening, each with its own record beside this one. Pass 1 (20:09 UTC, 2026-11-20-partner-rails-pass1.json) made the same four payments, booked each in T:0 (je_prod_7fKlf0yRwDEyD5Pa, je_prod_hHZTsSOo4zZa31Y0, je_prod_ooFq5BjpOst2hAOj, je_prod_1UL89I7V9TyCb1IT), refused the same misuses and reconciled, but timed each booking from before the T:0 call instead of after T:0's answer. Pass 2 (2026-11-20-partner-rails-pass2.json) booked its two card payments (je_prod_1UvG58AZh2tl28ob, je_prod_pY5WM9wYSztUs4YR) and stopped when Airwallex refused the transfer as a duplicate request_id (the same terms as pass 1, so nothing was paid twice); the terms now carry the run's start. All their T:0 entries are in T:0.
- EUR to USD for T:0's functional currency: 1.085653 (the Airwallex sandbox's client rate, GET /fx/rates/current, 2026-11-20T20:11:04+0000); each entry keeps the EUR amount beside it.
- STOPPED: Airwallex /simulation/transfers/7cbc1f80-1930-4771-a6f2-67d24b87d78e/transition: no answer; outcome unknown

## What this run does not show

- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.
- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.
- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.

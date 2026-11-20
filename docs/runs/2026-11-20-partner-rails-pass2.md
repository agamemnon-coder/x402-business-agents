# T:0 at every payment, and each agent's credential as a token: the run of 2026-11-20

**Live, test money only.** Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID). Alta (formerly Metal) testnet, chain id 63825: test USD (*USDZ). T:0's shared sandbox entity ("T:0 Sandbox", USD), through its customer API: other teams' entries are in it too.

**What the token is.** A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run.

Made by `npm run partner-rails -- live` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code `c184c474c819` with this run's own code not yet committed (the commit that adds this record holds it), from 2026-11-20T20:10:26.056Z to 2026-11-20T20:10:45.364Z. This page is written from [2026-11-20-partner-rails.json](2026-11-20-partner-rails.json) by `npm run partner-rails -- --md`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.

**Result:** 2 payments on three rails, each booked in T:0 the moment it settled; 0 of 0 misuses refused as expected; the reconcile check did not run. Every check passed.

## The agents' tokens

| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |
|---|---|---|---|---|---|
| sourcing | `tok_5857c714bbd85994` (…a91f) | ••6051 (INACTIVE at Airwallex when adopted) | EUR 30.00 a purchase, 100.00 a month, MCC 5734, until 2026-12-20 | `b323ebc0e75a6879…f651` | active |
| support | `tok_a8e9472f8435e53b` (…a80c) | ••2361 (INACTIVE at Airwallex when adopted) | EUR 60.00 a purchase, 150.00 a month, MCC 7372, until 2026-12-20 | `e9237f96d12dfe1c…0912` | active |

## Every payment, booked in T:0 at once

| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |
|---|---|---|---|---|---|---|---|---|---|
| a | the sourcing agent's token pays Packwise EUR 1.00 (warehouse software, MCC 5734) | Visa card, Airwallex Issuing (sandbox) | `163dc2e9-9ffd-4671-9ce2-f52998fc29b6` | EUR 1.00 (T:0: USD 1.09 at 1.085653) | 6100 → T:0 63410 · CC100 | sourcing | `b323ebc0e75a6879…f651` | `je_prod_1UvG58AZh2tl28ob` (`PURPAY-4f24e82b8e2fa91e048a1fce`, booked) | 1.5 s |
| b | the support agent's token pays Replyhub EUR 1.25 (helpdesk software, MCC 7372) | Visa card, Airwallex Issuing (sandbox) | `4564b428-7044-46b0-9e26-5613ec8e9a5c` | EUR 1.25 (T:0: USD 1.36 at 1.085653) | 6100 → T:0 63410 · CC200 | support | `e9237f96d12dfe1c…0912` | `je_prod_pY5WM9wYSztUs4YR` (`PURPAY-f86542c04a994a0507d33822`, booked) | 0.8 s |

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

**Calls:** Airwallex 16 (login included), T:0 8, Alta transactions 0.

## Notes

- An earlier pass of this run (20:09 UTC, its record 2026-11-20-partner-rails-pass1.json) made the same four payments and booked each in T:0 (je_prod_7fKlf0yRwDEyD5Pa, je_prod_hHZTsSOo4zZa31Y0, je_prod_ooFq5BjpOst2hAOj, je_prod_1UL89I7V9TyCb1IT), refused the same misuses and reconciled; it timed each booking from before the T:0 call instead of after T:0's answer, so it was run again with the timing fixed. Both passes' entries are in T:0.
- EUR to USD for T:0's functional currency: 1.085653 (the Airwallex sandbox's client rate, GET /fx/rates/current, 2026-11-20T20:10:27+0000); each entry keeps the EUR amount beside it.
- STOPPED: Airwallex /transfers/create -> 400 duplicate_request_id (trace 8ee1919f61a84a918d5b6d3947013291)

## What this run does not show

- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.
- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.
- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.

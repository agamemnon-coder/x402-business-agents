# T:0 at every payment, and each agent's credential as a token: the run of 2026-11-20

**Live, test money only.** Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID). Alta (formerly Metal) testnet, chain id 63825: test USD (*USDZ). T:0's shared sandbox entity ("T:0 Sandbox", USD), through its customer API: other teams' entries are in it too.

**What the token is.** A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run.

Made by `npm run partner-rails -- live` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code `c184c474c819` with this run's own code not yet committed (the commit that adds this record holds it), from 2026-11-20T20:12:05.373Z to 2026-11-20T20:12:57.091Z. This page is written from [2026-11-20-partner-rails.json](2026-11-20-partner-rails.json) by `npm run partner-rails -- --md`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.

**Result:** 4 payments on three rails, each booked in T:0 the moment it settled; 4 of 4 misuses refused as expected; the reconcile check agrees on every payment. **1 check(s) failed:** d_payee_received.

## The agents' tokens

| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |
|---|---|---|---|---|---|
| sourcing | `tok_2ea528d4d1a0b1c6` (…a5f4) | ••6051 (INACTIVE at Airwallex when adopted) | EUR 30.00 a purchase, 100.00 a month, MCC 5734, until 2026-12-20 | `a8123cfef4d1ad84…92ca` | active |
| support | `tok_8942ca90401117ac` (…09cd) | ••2361 (INACTIVE at Airwallex when adopted) | EUR 60.00 a purchase, 150.00 a month, MCC 7372, until 2026-12-20 | `3260fef1886fd53d…ce21` | revoked |

## Every payment, booked in T:0 at once

| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |
|---|---|---|---|---|---|---|---|---|---|
| a | the sourcing agent's token pays Packwise EUR 1.00 (warehouse software, MCC 5734) | Visa card, Airwallex Issuing (sandbox) | `4e159958-ce89-4679-9932-cb4fc7d81317` | EUR 1.00 (T:0: USD 1.09 at 1.085655) | 6100 → T:0 63410 · CC100 | sourcing | `a8123cfef4d1ad84…92ca` | `je_prod_rjZtbnBZeIeNu2R7` (`PURPAY-74866f6c523bbefcedfad99b`, booked) | 1.3 s |
| b | the support agent's token pays Replyhub EUR 1.25 (helpdesk software, MCC 7372) | Visa card, Airwallex Issuing (sandbox) | `bb9e8654-36a0-408d-bd2c-a7d80dc870ab` | EUR 1.25 (T:0: USD 1.36 at 1.085655) | 6100 → T:0 63410 · CC200 | support | `3260fef1886fd53d…ce21` | `je_prod_WnY9zvYGzQqzzQ4G` (`PURPAY-5be0c382ec9206da444fad9c`, booked) | 0.9 s |
| c | the Payer agent pays Stockline Data GmbH EUR 1.00 by Airwallex transfer, within the CFO's limit to pay alone | Airwallex transfer (sandbox) | `0ac5b1df-b5b7-4e96-a071-5d656b231735` | EUR 1.00 (T:0: USD 1.09 at 1.085655) | 5000 → T:0 51200 · CC300 | payer | `0cd7e0506a73438d…5466` | `je_prod_LOW977v7AqUH9SbB` (`PURPAY-1c67b211698d7626f1c12ea0`, booked) | 1.0 s |
| d | the sourcing agent pays Stockline 0.05 test USD on Alta testnet under its own mandate | Alta testnet | [`0x66cd1f42…3966`](https://testnet.metalntwx.com/tx/0x66cd1f4249d4055343e168535db969d3eedcee1a8ab734a00ec2b5d006473966) | USDZ 0.05 (T:0: USD 0.05) | 5000 → T:0 51200 · CC100 | sourcing | `bbb9b43e10ee9544…9a92` | `je_prod_1UL89I7V9TyCb1IT` (`PURPAY-b72a855d598a1dce230a1d61`, found in T:0) | 0.9 s |

- **a** terms hash: the token's mandate (SHA-256).
- **b** terms hash: the token's mandate (SHA-256).
- **c** terms hash: the payment's terms (SHA-256 of their canonical JSON), also in the transfer's metadata.approval_sha256.
- **d** terms hash: SHA-256 of the signed mandate credential (its terms); Alta's own mandate reference beside it. Alta mandate reference `0x6c372cb4ae4bae8e8951db9fa3408c237da85f6682a235dea6ff8a763a27aac2`.

## Misuse: refused

| | What | Refused by | Expected | Got | Airwallex calls | |
|---|---|---|---|---|---|---|
| e | the support agent's token, EUR 60.01: over its EUR 60.00 a purchase | Purser (the token's mandate, before any call) | OVER_PER_PURCHASE | OVER_PER_PURCHASE: EUR 60.01: at most EUR 60.00 a purchase | 0 | ok |
| f | the support agent's token at a warehouse-software merchant (MCC 5734): not its category | Purser (the token's mandate, before any call) | MCC_NOT_ALLOWED | MCC_NOT_ALLOWED: merchant category 5734: the mandate allows 7372 | 0 | ok |
| g | the support agent's token after the agent was revoked, EUR 1.25 within the old mandate | Purser (the token's mandate, before any call) | TOKEN_REVOKED | TOKEN_REVOKED: revoked at 2026-11-20T20:12:47.662Z: the agent was revoked: partner-rails run: the agent's machine reported lost | 0 | ok |
| h | the support agent's card number charged directly, without the token (EUR 1.25): the card is frozen at Airwallex | Airwallex (the card is frozen) | CARD_INACTIVE | CARD_INACTIVE: Airwallex FAILED CARD_INACTIVE (3895f72a-cdfe-4ad9-921a-2b833f6a7ada) | 1 | ok |

**Revoke.** The support agent was revoked at 2026-11-20T20:12:47.662Z (revokePrincipal (src/policy/principals.ts): the agent's identity revoked, and its tokens with it in the same call). Its token `tok_8942ca90401117ac` is revoked (at 2026-11-20T20:12:47.662Z); its card at Airwallex is INACTIVE.

## The reconcile check: T:0 against the rails

Read back at 2026-11-20T20:12:57.089Z: each T:0 entry from T:0 (GET /v1/journal-entries/{id}) and each payment from its rail (Airwallex's card transactions and transfer, Alta's receipt and MandatePayment event).

| Payment | T:0 holds | The rail holds | Checks | |
|---|---|---|---|---|
| `partner-rails-a-4e159958…1317` | EUR 1.00 (`je_prod_rjZtbnBZeIeNu2R7`) | EUR 1.00, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-b-bb9e8654…70ab` | EUR 1.25 (`je_prod_WnY9zvYGzQqzzQ4G`) | EUR 1.25, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-c-0ac5b1df…1735` | EUR 1.00 (`je_prod_LOW977v7AqUH9SbB`) | EUR 1.00, PAID | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-d-0x66cd1f…0553` | USD 0.05 (`je_prod_1UL89I7V9TyCb1IT`) | USDZ 0.05, success, block 37329302 | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |

## Checks

| Check | | Detail |
|---|---|---|
| a_card_refrozen | ok | the sourcing agent's card after the purchase: INACTIVE |
| b_card_refrozen | ok | the support agent's card after the purchase: INACTIVE |
| d_payee_received | **FAIL** | the test payee's balance moved by 0.00 |
| c_metadata_terms_hash | ok | the transfer's metadata.approval_sha256 at Airwallex is the terms hash T:0 holds |
| every_payment_booked_in_t0 | ok | 4 of 4 payments booked in T:0 |
| refused_outside_mandate_0_calls | ok | over the limit, another category, and after the revoke: refused by Purser with 0 Airwallex calls |
| leaked_card_declined | ok | the card number without the token: CARD_INACTIVE |
| revoke_revoked_token | ok | the support agent's token is revoked after the agent was revoked |
| reconcile_ok | ok | T:0 against the rails: 4 of 4 agree |

**Calls:** Airwallex 23 (login included), T:0 15, Alta transactions 2.

## Notes

- Three earlier passes the same evening, each with its own record beside this one (2026-11-20-partner-rails-pass1/2/3.json). Pass 1 (20:09 UTC) made the same four payments, booked each in T:0 (je_prod_7fKlf0yRwDEyD5Pa, je_prod_hHZTsSOo4zZa31Y0, je_prod_ooFq5BjpOst2hAOj, je_prod_1UL89I7V9TyCb1IT), refused the same misuses and reconciled, but timed each booking from before the T:0 call, not after T:0's answer. Pass 2 booked its two card payments (je_prod_1UvG58AZh2tl28ob, je_prod_pY5WM9wYSztUs4YR) and stopped when Airwallex refused the transfer as a duplicate request_id (the same terms as pass 1: nothing paid twice). Pass 3 booked its two card payments (je_prod_5mdfU6jvatSJ4pc8, je_prod_cNtHvaCfpabiiis3) and stopped when the sandbox did not answer the simulation's move of transfer 7cbc1f80-193
- EUR to USD for T:0's functional currency: 1.085655 (the Airwallex sandbox's client rate, GET /fx/rates/current, 2026-11-20T20:12:07+0000); each entry keeps the EUR amount beside it.
- Test money for this world's owner: 0.60 *USDZ from the 20 Nov refusals world's owner (https://testnet.metalntwx.com/tx/0x487ec5bb9a1a9a1981bde206b77562991481aec112ab86cd2c2c772d2df94dc6).

## What this run does not show

- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.
- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.
- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.

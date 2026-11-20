# T:0 at every payment, and each agent's credential as a token: the run of 2026-11-20

**Live, test money only.** Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID). Alta (formerly Metal) testnet, chain id 63825: test USD (*USDZ). T:0's shared sandbox entity ("T:0 Sandbox", USD), through its customer API: other teams' entries are in it too.

**What the token is.** A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run.

Made by `npm run partner-rails -- live` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code `c184c474c819` with this run's own code not yet committed (the commit that adds this record holds it), from 2026-11-20T20:13:25.035Z to 2026-11-20T20:14:17.315Z. This page is written from [2026-11-20-partner-rails.json](2026-11-20-partner-rails.json) by `npm run partner-rails -- --md`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.

**Result:** 4 payments on three rails, each booked in T:0 the moment it settled; 4 of 4 misuses refused as expected; the reconcile check agrees on every payment. Every check passed.

## The agents' tokens

| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |
|---|---|---|---|---|---|
| sourcing | `tok_475845497d51b8e3` (…9cc8) | ••6051 (INACTIVE at Airwallex when adopted) | EUR 30.00 a purchase, 100.00 a month, MCC 5734, until 2026-12-20 | `a4c578f1d85e21ee…6e17` | active |
| support | `tok_42983d88d4542323` (…db6a) | ••2361 (INACTIVE at Airwallex when adopted) | EUR 60.00 a purchase, 150.00 a month, MCC 7372, until 2026-12-20 | `b3316e03ba704742…d94d` | revoked |

## Every payment, booked in T:0 at once

| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |
|---|---|---|---|---|---|---|---|---|---|
| a | the sourcing agent's token pays Packwise EUR 1.00 (warehouse software, MCC 5734) | Visa card, Airwallex Issuing (sandbox) | `9af2d7df-0e32-443f-bc94-2e55f90e5799` | EUR 1.00 (T:0: USD 1.09 at 1.085719) | 6100 → T:0 63410 · CC100 | sourcing | `a4c578f1d85e21ee…6e17` | `je_prod_kejDA5HnFgnVO30p` (`PURPAY-5bcb2f360ccf96bdf4f9f77c`, booked) | 1.4 s |
| b | the support agent's token pays Replyhub EUR 1.25 (helpdesk software, MCC 7372) | Visa card, Airwallex Issuing (sandbox) | `1b6318b0-2753-4e4d-afdf-c1b723fc7232` | EUR 1.25 (T:0: USD 1.36 at 1.085719) | 6100 → T:0 63410 · CC200 | support | `b3316e03ba704742…d94d` | `je_prod_NulecLEtbU6o8SIt` (`PURPAY-5bca69c536041bc1436a8a03`, booked) | 1.8 s |
| c | the Payer agent pays Stockline Data GmbH EUR 1.00 by Airwallex transfer, within the CFO's limit to pay alone | Airwallex transfer (sandbox) | `75d39925-21a5-463c-ace7-4aec0d171ca3` | EUR 1.00 (T:0: USD 1.09 at 1.085719) | 5000 → T:0 51200 · CC300 | payer | `00c2aff8067e5e48…859d` | `je_prod_aGB8ehWRlYN8W6t1` (`PURPAY-fc8d8c79924caea0a2348697`, booked) | 0.8 s |
| d | the sourcing agent pays Stockline 0.05 test USD on Alta testnet under its own mandate | Alta testnet | [`0x2e8d323d…6c0c`](https://testnet.metalntwx.com/tx/0x2e8d323d59e6c9265d8b775f6086181131729acd714755d462905722e8006c0c) | USDZ 0.05 (T:0: USD 0.05) | 5000 → T:0 51200 · CC100 | sourcing | `bbb9b43e10ee9544…9a92` | `je_prod_ePqNVSNCjAUPRi4v` (`PURPAY-26d9dd1d698f7417ee90c304`, booked) | 1.1 s |

- **a** terms hash: the token's mandate (SHA-256).
- **b** terms hash: the token's mandate (SHA-256).
- **c** terms hash: the payment's terms (SHA-256 of their canonical JSON), also in the transfer's metadata.approval_sha256.
- **d** terms hash: SHA-256 of the signed mandate credential (its terms); Alta's own mandate reference beside it. Alta mandate reference `0x6c372cb4ae4bae8e8951db9fa3408c237da85f6682a235dea6ff8a763a27aac2`.

## Misuse: refused

| | What | Refused by | Expected | Got | Airwallex calls | |
|---|---|---|---|---|---|---|
| e | the support agent's token, EUR 60.01: over its EUR 60.00 a purchase | Purser (the token's mandate, before any call) | OVER_PER_PURCHASE | OVER_PER_PURCHASE: EUR 60.01: at most EUR 60.00 a purchase | 0 | ok |
| f | the support agent's token at a warehouse-software merchant (MCC 5734): not its category | Purser (the token's mandate, before any call) | MCC_NOT_ALLOWED | MCC_NOT_ALLOWED: merchant category 5734: the mandate allows 7372 | 0 | ok |
| g | the support agent's token after the agent was revoked, EUR 1.25 within the old mandate | Purser (the token's mandate, before any call) | TOKEN_REVOKED | TOKEN_REVOKED: revoked at 2026-11-20T20:14:07.481Z: the agent was revoked: partner-rails run: the agent's machine reported lost | 0 | ok |
| h | the support agent's card number charged directly, without the token (EUR 1.25): the card is frozen at Airwallex | Airwallex (the card is frozen) | CARD_INACTIVE | CARD_INACTIVE: Airwallex FAILED CARD_INACTIVE (be1d2bd5-8380-4fea-8526-fe22c9ad6633) | 1 | ok |

**Revoke.** The support agent was revoked at 2026-11-20T20:14:07.481Z (revokePrincipal (src/policy/principals.ts): the agent's identity revoked, and its tokens with it in the same call). Its token `tok_42983d88d4542323` is revoked (at 2026-11-20T20:14:07.481Z); its card at Airwallex is INACTIVE.

## The reconcile check: T:0 against the rails

Read back at 2026-11-20T20:14:17.312Z: each T:0 entry from T:0 (GET /v1/journal-entries/{id}) and each payment from its rail (Airwallex's card transactions and transfer, Alta's receipt and MandatePayment event).

| Payment | T:0 holds | The rail holds | Checks | |
|---|---|---|---|---|
| `partner-rails-a-9af2d7df…5799` | EUR 1.00 (`je_prod_kejDA5HnFgnVO30p`) | EUR 1.00, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-b-1b6318b0…7232` | EUR 1.25 (`je_prod_NulecLEtbU6o8SIt`) | EUR 1.25, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-c-75d39925…1ca3` | EUR 1.00 (`je_prod_aGB8ehWRlYN8W6t1`) | EUR 1.00, PAID | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-d-0x2e8d32…c926` | USD 0.05 (`je_prod_ePqNVSNCjAUPRi4v`) | USDZ 0.05, success, block 37333648 | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |

## Checks

| Check | | Detail |
|---|---|---|
| a_card_refrozen | ok | the sourcing agent's card after the purchase: INACTIVE |
| b_card_refrozen | ok | the support agent's card after the purchase: INACTIVE |
| d_payee_received | ok | the test payee's balance moved by 0.05 |
| c_metadata_terms_hash | ok | the transfer's metadata.approval_sha256 at Airwallex is the terms hash T:0 holds |
| every_payment_booked_in_t0 | ok | 4 of 4 payments booked in T:0 |
| refused_outside_mandate_0_calls | ok | over the limit, another category, and after the revoke: refused by Purser with 0 Airwallex calls |
| leaked_card_declined | ok | the card number without the token: CARD_INACTIVE |
| revoke_revoked_token | ok | the support agent's token is revoked after the agent was revoked |
| reconcile_ok | ok | T:0 against the rails: 4 of 4 agree |

**Calls:** Airwallex 23 (login included), T:0 16, Alta transactions 1.

## Notes

- Four earlier passes the same evening (20:09 to 20:13 UTC), each with its own record beside this one (2026-11-20-partner-rails-pass1 to pass4.json); their T:0 entries are all in T:0. Pass 1 booked all four payments (je_prod_7fKlf0yRwDEyD5Pa, je_prod_hHZTsSOo4zZa31Y0, je_prod_ooFq5BjpOst2hAOj, je_prod_1UL89I7V9TyCb1IT) but timed each booking from before the T:0 call. Pass 2 stopped at a duplicate transfer request_id (pass 1's terms: nothing paid twice). Pass 3 stopped when the sandbox did not answer a simulated move of transfer 7cbc1f80-1930-4771-a6f2-67d24b87d78e, which never reached PAID and was not booked (moved to SENT once more by hand to see the simulation answer; nothing else). Pass 4 got pass 1's Alta payment back from the CLI (the same payment id) and found its entry in T:0 instead 
- EUR to USD for T:0's functional currency: 1.085719 (the Airwallex sandbox's client rate, GET /fx/rates/current, 2026-11-20T20:13:26+0000); each entry keeps the EUR amount beside it.

## What this run does not show

- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.
- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.
- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.

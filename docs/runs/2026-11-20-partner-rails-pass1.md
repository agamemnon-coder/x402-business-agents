# T:0 at every payment, and each agent's credential as a token: the run of 2026-11-20

**Live, test money only.** Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID). Alta (formerly Metal) testnet, chain id 63825: test USD (*USDZ). T:0's shared sandbox entity ("T:0 Sandbox", USD), through its customer API: other teams' entries are in it too.

**What the token is.** A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run.

Made by `npm run partner-rails -- live` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code `c184c474c819` with this run's own code not yet committed (the commit that adds this record holds it), from 2026-11-20T20:08:28.257Z to 2026-11-20T20:09:41.049Z. This page is written from [2026-11-20-partner-rails.json](2026-11-20-partner-rails.json) by `npm run partner-rails -- --md`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.

**Result:** 4 payments on three rails, each booked in T:0 the moment it settled; 4 of 4 misuses refused as expected; the reconcile check agrees on every payment. Every check passed.

## The agents' tokens

| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |
|---|---|---|---|---|---|
| sourcing | `tok_602975e6744214ab` (…9125) | ••6051 (INACTIVE at Airwallex when adopted) | EUR 30.00 a purchase, 100.00 a month, MCC 5734, until 2026-12-20 | `25c2d978fd3d7e83…01c7` | active |
| support | `tok_b05a21d524fd4d79` (…25ca) | ••2361 (INACTIVE at Airwallex when adopted) | EUR 60.00 a purchase, 150.00 a month, MCC 7372, until 2026-12-20 | `d6048fbf23386de8…d0cb` | revoked |

## Every payment, booked in T:0 at once

| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |
|---|---|---|---|---|---|---|---|---|---|
| a | the sourcing agent's token pays Packwise EUR 1.00 (warehouse software, MCC 5734) | Visa card, Airwallex Issuing (sandbox) | `b4aba83f-38b1-4535-9d8f-54a256dfeff5` | EUR 1.00 (T:0: USD 1.09 at 1.085717) | 6100 → T:0 63410 · CC100 | sourcing | `25c2d978fd3d7e83…01c7` | `je_prod_7fKlf0yRwDEyD5Pa` (`PURPAY-21b7c5661db53cf77e57ac9c`, booked) | 0.0 s |
| b | the support agent's token pays Replyhub EUR 1.25 (helpdesk software, MCC 7372) | Visa card, Airwallex Issuing (sandbox) | `094b7dd3-11bd-4996-a64f-5b5b113f9107` | EUR 1.25 (T:0: USD 1.36 at 1.085717) | 6100 → T:0 63410 · CC200 | support | `d6048fbf23386de8…d0cb` | `je_prod_hHZTsSOo4zZa31Y0` (`PURPAY-a85a167da3f400bb27863891`, booked) | 0.0 s |
| c | the Payer agent pays Stockline Data GmbH EUR 1.00 by Airwallex transfer, within the CFO's limit to pay alone | Airwallex transfer (sandbox) | `d49c8d9c-de76-4488-bd97-254bc4fa706f` | EUR 1.00 (T:0: USD 1.09 at 1.085717) | 5000 → T:0 51200 · CC300 | payer | `715a3b11e53e6b1e…f35c` | `je_prod_ooFq5BjpOst2hAOj` (`PURPAY-9dc3e6440bf2a00be05a7260`, booked) | 0.0 s |
| d | the sourcing agent pays Stockline 0.05 test USD on Alta testnet under its own mandate | Alta testnet | [`0x66cd1f42…3966`](https://testnet.metalntwx.com/tx/0x66cd1f4249d4055343e168535db969d3eedcee1a8ab734a00ec2b5d006473966) | USDZ 0.05 (T:0: USD 0.05) | 5000 → T:0 51200 · CC100 | sourcing | `bbb9b43e10ee9544…9a92` | `je_prod_1UL89I7V9TyCb1IT` (`PURPAY-b72a855d598a1dce230a1d61`, booked) | 1.1 s |

- **a** terms hash: the token's mandate (SHA-256).
- **b** terms hash: the token's mandate (SHA-256).
- **c** terms hash: the payment's terms (SHA-256 of their canonical JSON), also in the transfer's metadata.approval_sha256.
- **d** terms hash: SHA-256 of the signed mandate credential (its terms); Alta's own mandate reference beside it. Alta mandate reference `0x6c372cb4ae4bae8e8951db9fa3408c237da85f6682a235dea6ff8a763a27aac2`.

## Misuse: refused

| | What | Refused by | Expected | Got | Airwallex calls | |
|---|---|---|---|---|---|---|
| e | the support agent's token, EUR 60.01: over its EUR 60.00 a purchase | Purser (the token's mandate, before any call) | OVER_PER_PURCHASE | OVER_PER_PURCHASE: EUR 60.01: at most EUR 60.00 a purchase | 0 | ok |
| f | the support agent's token at a warehouse-software merchant (MCC 5734): not its category | Purser (the token's mandate, before any call) | MCC_NOT_ALLOWED | MCC_NOT_ALLOWED: merchant category 5734: the mandate allows 7372 | 0 | ok |
| g | the support agent's token after the agent was revoked, EUR 1.25 within the old mandate | Purser (the token's mandate, before any call) | TOKEN_REVOKED | TOKEN_REVOKED: revoked at 2026-11-20T20:09:31.544Z: the agent was revoked: partner-rails run: the agent's machine reported lost | 0 | ok |
| h | the support agent's card number charged directly, without the token (EUR 1.25): the card is frozen at Airwallex | Airwallex (the card is frozen) | CARD_INACTIVE | CARD_INACTIVE: Airwallex FAILED CARD_INACTIVE (3394781b-2782-4fb1-b446-af1de31a9b72) | 1 | ok |

**Revoke.** The support agent was revoked at 2026-11-20T20:09:31.544Z (revokePrincipal (src/policy/principals.ts): the agent's identity revoked, and its tokens with it in the same call). Its token `tok_b05a21d524fd4d79` is revoked (at 2026-11-20T20:09:31.544Z); its card at Airwallex is INACTIVE.

## The reconcile check: T:0 against the rails

Read back at 2026-11-20T20:09:41.045Z: each T:0 entry from T:0 (GET /v1/journal-entries/{id}) and each payment from its rail (Airwallex's card transactions and transfer, Alta's receipt and MandatePayment event).

| Payment | T:0 holds | The rail holds | Checks | |
|---|---|---|---|---|
| `partner-rails-a-b4aba83f…eff5` | EUR 1.00 (`je_prod_7fKlf0yRwDEyD5Pa`) | EUR 1.00, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-b-094b7dd3…9107` | EUR 1.25 (`je_prod_hHZTsSOo4zZa31Y0`) | EUR 1.25, PENDING | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-c-d49c8d9c…706f` | EUR 1.00 (`je_prod_ooFq5BjpOst2hAOj`) | EUR 1.00, PAID | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |
| `partner-rails-d-0x66cd1f…0553` | USD 0.05 (`je_prod_1UL89I7V9TyCb1IT`) | USDZ 0.05, success, block 37329302 | ✓ t0_entry_read_back, ✓ t0_balanced, ✓ t0_amount_is_payment, ✓ t0_memo_names_payment, ✓ rail_read_back, ✓ rail_settled, ✓ rail_amount_is_t0 | agrees |

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

**Calls:** Airwallex 23 (login included), T:0 16, Alta transactions 5.

## Notes

- EUR to USD for T:0's functional currency: 1.085717 (the Airwallex sandbox's client rate, GET /fx/rates/current, 2026-11-20T20:08:29+0000); each entry keeps the EUR amount beside it.
- Test money for this world's owner: 0.60 *USDZ from the 20 Nov refusals world's owner (https://testnet.metalntwx.com/tx/0xfe41d707dde43a311483c109167eb274a44517d9a59c7c176ad0c8de84f8205a).
- The owner's Alta account 0xEeb5dECaEc54D37154236F215abe99470E8A6dF7 was created (https://testnet.metalntwx.com/tx/0xd1cfec27ace8e4fb17f66aa9ba6a4a5df84ff4bc81825b0ec4af25b39936b44b).
- The account was funded with 0.30 *USDZ (https://testnet.metalntwx.com/tx/0x34a15bc5459b47ccd0887998b21f8e0b4738e5bd585456c157fb458e22dbc9e6).
- The sourcing agent's mandate 0x6c372cb4ae4bae8e8951db9fa3408c237da85f6682a235dea6ff8a763a27aac2 (cap 0.10 a payment, budget 0.20, one payee, 2 days) was bound on chain by the owner (https://testnet.metalntwx.com/tx/0x9fdcebc5475826192c5f914761744f27c344e015e2ce0fc06f233d0e18717898).

## What this run does not show

- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.
- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.
- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.

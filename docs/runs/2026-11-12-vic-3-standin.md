# vic-3: STAND-IN dry run, not live

**STAND-IN dry run, not live: stand-ins for airi-cli, the checkout and Claude; stand-in approvals, not the CFO's Face ID; no Airi, no Airwallex, no Anthropic call, no card.**

STAND-IN: every row below comes from the stand-ins (src/airi/standIn.ts) and a stand-in model that is not Claude. No Airi, Airwallex or Anthropic call was made, no card was used, and no approval is the CFO's Face ID. It is not the run's evidence: the live run is the owner's.

Run 2026-11-12T13:29:03.163Z to 2026-11-12T13:29:03.228Z. Mode: dry.

## Purchases

| | Step | Amount | Rail chosen (by, request id) | Mandate | PaymentIntent | Terms hash | Mandate read-back | PaymentIntent read-back | Outcome | Calls (Anthropic / Airwallex / airi-cli) |
|---|---|---|---|---|---|---|---|---|---|---|
| STAND-IN A | within the CFO's limit: the agent alone, one tap in Airi | 12.00 EUR | airi_vic (stand-in, standin-req-1; 3 rails offered) | standin-mdt-1 | standin-order-1 | 35e64be1fc5a64a7… | equal, before the credential | — | succeeded, STAND_IN | 1 / 2 / 4 |
| STAND-IN B | above the CFO's limit: Face ID, then the terms hash in Airi's mandate and in Airwallex's PaymentIntent record, both read back | 45.00 EUR | airi_vic (stand-in, standin-req-2; 3 rails offered) | standin-mdt-2 | standin-order-2 | 277f5de497a41eff… | equal, before the credential | equal | succeeded, STAND_IN | 1 / 3 / 4 |
| STAND-IN C | over the hard cap: refused by Purser | 250.00 EUR | — | — | — | — | — | — | refused, PURSER_ABOVE_HARD_CAP, by purser | 0 / 0 / 0 |
| STAND-IN D | a merchant not on the CFO's allowlist: refused by Purser | 5.00 EUR | — | — | — | — | — | — | refused, PURSER_MERCHANT_NOT_ALLOWED, by purser | 0 / 0 / 0 |
| STAND-IN E | terms changed after the Face ID (our own planted change): refused by the executor's hash check | 30.00 EUR | — | — | — | d4259c907fbbc6a1… | — | — | refused, by purser (the executor's hash check, before any Airi call) | 0 / 0 / 0 |
| STAND-IN F1 | negative test: a 10.00 EUR mandate's credential tried on a 40.00 EUR PaymentIntent | 10.00 EUR | airi_vic (stand-in, standin-req-3; 3 rails offered) | standin-mdt-3 | standin-order-3 | 45b34094c87264a8… | equal, before the credential | — | SUCCEEDED, STAND_IN | 1 / 2 / 4 |
| STAND-IN F2 | negative test: B's credential, already used once, tried on a new PaymentIntent | 45.00 EUR | — | — | standin-order-4 | — | — | — | SUCCEEDED, STAND_IN | 0 / 2 / 0 |

## Negative test (F1, F2)

- STAND-IN **F1**: our own planted misuse: the vic-3 conductor, not Purser's executor (which never does this), tried the credential of a 10.00 EUR mandate on a 40.00 EUR PaymentIntent. The stand-in checkout answered `{"outcome":"SUCCEEDED","reference":"standin-order-3","code":"STAND_IN","amount":"40.00"}`; the stand-in for Airi: `{"purser_route_for_10_00":"alone","mandate_create":{"mandate_id":"standin-mdt-3","amount":"10.00"},"mandate_read_back":{"status":"CREATED","equal":true},"credential":{"status":"STAND_IN","token_type":"STAND_IN"},"result_reported":"SUCCEEDED"}`. Result: PASS, finding: STAND-IN (the stand-in checkout's answer, not the Airwallex sandbox's): not refused by Airi/Airwallex sandbox; only Purser enforces the binding here.
- STAND-IN **F2**: our own planted misuse: the vic-3 conductor, not Purser's executor (which never does this), tried B's credential, already used once, on a new PaymentIntent. The stand-in checkout answered `{"outcome":"SUCCEEDED","reference":"standin-order-4","code":"STAND_IN"}`; the stand-in for Airi: `{"credential":"B's, issued once for B's mandate","mandate_id":"standin-mdt-2","used_first_on":"standin-order-2"}`. Result: PASS, finding: STAND-IN (the stand-in checkout's answer, not the Airwallex sandbox's): not refused by Airi/Airwallex sandbox; only Purser enforces the binding here.

## Checks

| Check | | Detail |
|---|---|---|
| STAND-IN a_rail_chosen_by_the_agent | ok | A: rail airi_vic chosen by stand-in from 3 |
| STAND-IN a_paid | ok | A: succeeded |
| STAND-IN b_rail_chosen_by_the_agent | ok | B: rail airi_vic chosen by stand-in |
| STAND-IN b_mandate_read_back_equal_before_credential | ok | B: equal, before the credential |
| STAND-IN b_payment_intent_read_back_equal | ok | B: equal |
| STAND-IN b_paid | ok | B: succeeded |
| STAND-IN c_refused_by_purser_0_calls | ok | C: refused PURSER_ABOVE_HARD_CAP; calls {"anthropic":0,"airwallex":0,"airi":0} |
| STAND-IN d_refused_by_purser_0_calls | ok | D: refused PURSER_MERCHANT_NOT_ALLOWED; calls {"anthropic":0,"airwallex":0,"airi":0} |
| STAND-IN e_refused_by_hash_check_0_calls | ok | E: refused; calls {"anthropic":0,"airwallex":0,"airi":0} |
| STAND-IN f1_rail_chosen_by_the_agent | ok | F1: rail airi_vic chosen by stand-in |
| STAND-IN f1_answer_recorded | ok | F1: STAND-IN (the stand-in checkout's answer, not the Airwallex sandbox's): not refused by Airi/Airwallex sandbox; only Purser enforces the binding here |
| STAND-IN f2_answer_recorded | ok | F2: STAND-IN (the stand-in checkout's answer, not the Airwallex sandbox's): not refused by Airi/Airwallex sandbox; only Purser enforces the binding here |
| STAND-IN credential_deleted | ok | B's kept credential and its directory are deleted |
| STAND-IN within_budgets | ok | Anthropic 3/6, Airwallex 9/20, airi-cli 15/24 |

## Calls

STAND-IN Anthropic 3 of 6; Airwallex 9 of 20; airi-cli 15 of 24. Each of these was a call to a stand-in, not to the service.

Failed attempts kept: 0. B's credential deleted: yes.

# Card governance, live: 2026-11-26

`npm run airwallex:governance-live -- live card-hours`. Per-agent card governance in Airwallex Issuing: one agent card issued through Purser's Issuing adapter and read back (metadata, merchant categories, currencies, limits, end date); the card's hours, Purser's own control, set so that the run's moment is outside them; a purchase window opened inside the hours, then the hours ended, with Purser's clock injected; the card sync freezing the card at Airwallex; a charge on the frozen card. The **Airwallex sandbox** only (https://api.sandbox.airwallex.com/api/v1), test money only. Code when this record was written: `86d7f6b93376`. The machine-readable record, with every request's HTTP status and Airwallex's own request and trace ids, is docs/runs/2026-11-26-card-governance-live.json.

**10 of 10 steps passed, 0 failed, 0 not judged** (measurements, or not supported by the sandbox). 17 Airwallex calls of a budget of 40 (the drill's hard limit: 80; logins included), one at a time, at least 200 ms apart; 0 answered 429; 0 unexpected non-2xx.

## In short

- pass, `card.issue`: issued b4f2cb96-e9d8-4530-8d05-ce5aa050d38f ••8788; status INACTIVE; policy v1
- pass, `card.readback`: INACTIVE; metadata {"agent_id":"sourcing","policy_version":"v1"}; MCC 5734; EUR; EUR 30.00 per purchase / 100.00 a month; active_to 2027-02-24T11:27:43.270Z; all as the policy says
- pass, `hours.refused_now`: refused: outside_card_hours: the sourcing agent's card pays Mon-Fri 18:00-20:00 Europe/Amsterdam only (enforced by Purser); now Thu 12:27 Europe/Amsterdam; 0 Airwallex calls; a purchase window: none opened, 0 calls; now Thu 12:27 Europe/Amsterdam
- pass, `hours.thaw_inside`: window until 2026-11-26T19:01:30.000Z; read back ACTIVE; metadata {"agent_id":"sourcing","policy_version":"v2","task_id":"governance run: an approved purchase inside the hours"}
- pass, `hours.purchase_auth`: approved (PENDING)
- pass, `hours.end_sync`: policy wants ACTIVE inside, INACTIVE after; sync changed sourcing; read back INACTIVE; window closed: "the card's hours ended (Mon-Fri 18:00-20:00 Europe/Amsterdam, enforced by Purser)"; frozen: "outside its hours (Mon-Fri 18:00-20:00 Europe/Amsterdam, enforced by Purser)"
- pass, `hours.charge_frozen`: declined CARD_INACTIVE
- Shown: Airwallex holds the card with `metadata` `agent_id` and `policy_version` as Purser wrote them at issue, and its authorization controls (merchant category 5734, EUR only, EUR 30.00 per purchase and EUR 100.00 a month, an end date 90 days after issue) as the CFO policy says.
- Shown: Outside the card's hours a purchase Purser would start is refused before any Airwallex call, audited (`card.purchase_refused`), and no purchase window opens.
- Shown: Purser's thaw for one purchase writes the agent, the task and the policy version into the card's metadata at Airwallex, and Airwallex approved the purchase's authorisation on the thawed card.
- Shown: When the hours end with a purchase window still open, the card sync closes the window and freezes the card at Airwallex: `card_status` INACTIVE read back; a charge on it is declined `CARD_INACTIVE` by Airwallex.

## Simulated, and how

- The approver is a labelled virtual test passkey ("governance-live virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.
- The CFO's phone is played by the run: the hours are set with the phone's own path (a signed policy change, processPolicyRequest; setting hours is a tightening, which the phone may sign). The runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the run once, in order, not by a running `npm run relay` and its every-few-seconds loop.
- Purser's clock is injected for the end of the hours (as test/card-governance.test.ts does): Purser judged the window and the hours at 19:59:30 and 20:00:30 Amsterdam, while the thaw, the authorisation, the freeze and the read-backs reached Airwallex at 11:27 UTC. Nothing waited for real hours.
- Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`); the approve or decline is Airwallex's own.

## The cards

| Agent | Card id | Last 4 | Nickname at Airwallex |
|---|---|---|---|
| sourcing | `b4f2cb96-e9d8-4530-8d05-ce5aa050d38f` | 8788 | sourcing agent: warehouse and data software (governance-1126) |

## Steps (11:27:43.243–11:27:57.948 UTC)

A fresh ledger of its own (no card drill card adopted: a new card was issued, nickname suffix `governance-1126`). The hours are `Mon-Fri 18:00-20:00 Europe/Amsterdam`; the run ran at 12:27 in Amsterdam, outside them. For `hours.thaw_inside` Purser's clock was set to 26 Nov 19:59:30 Amsterdam (18:59:30 UTC) and for `hours.end_sync` and `hours.no_window_after` to 20:00:30 (19:00:30 UTC); every Airwallex call happened at the run's real time (the table's times). Before the runs, 14 read-only calls checked the sandbox (10 in three probes: the platform's and the connected account's balances, GET /account, which answered `acct_op0_QItiOyWKsYb5pwQihA`, and the connected account's beneficiaries; 4 in the entities run's two stopped attempts, described in docs/runs/2026-11-26-entities-live.md). None moved money or changed anything; they are not in this record's call table. The runs (11:27 to 11:32 UTC) ran on the code committed right after them as `86d7f6b93`; between the runs and that commit only the records' wording, the stand-in's call counter and two unused imports changed.

| # | Step | Agent | Expected | What happened | Result | Calls | ms |
|---|---|---|---|---|---|---|---|
| 1 | `setup.passkey` Enrol the virtual test passkey (labelled) as this ledger's only approver *(simulated: a virtual test passkey, no person's Face ID)* | – | enrolled and confirmed | pending; confirmed: governance-live virtual test passkey (no person's Face ID) | **pass** | 0 | 15 |
| 2 | `card.issue` Issue the sourcing agent's card through Purser's Issuing adapter (setupCards; a new card, nickname suffix governance-1126) | sourcing | issued, with the policy's limits and controls, then frozen by default (INACTIVE) | issued b4f2cb96-e9d8-4530-8d05-ce5aa050d38f ••8788; status INACTIVE; policy v1 | **pass** | 1, 2, 3, 4, 5, 6, 7 | 3718 |
| 3 | `card.readback` Read the card back from Airwallex (GET /issuing/cards/{id}) | sourcing | metadata agent_id and policy_version; merchant categories, currencies, limits and end date as the CFO policy says | INACTIVE; metadata {"agent_id":"sourcing","policy_version":"v1"}; MCC 5734; EUR; EUR 30.00 per purchase / 100.00 a month; active_to 2027-02-24T11:27:43.270Z; all as the policy says | **pass** | 8 | 337 |
| 4 | `hours.set` The CFO sets the card's hours to "Mon-Fri 18:00-20:00 Europe/Amsterdam" (a tightening, signed with the passkey on the phone path); the runner applies it and syncs the cards *(simulated: signed by the virtual test passkey)* | sourcing | the hours Purser enforces on the card are the new hours; no Airwallex call (the hours are Purser's own control) | C-fc5d9225 approved by the passkey and applied; the card's hours Mon-Fri 18:00-20:00 Europe/Amsterdam; policy v2; 0 Airwallex calls | **pass** | 0 | 68 |
| 5 | `hours.refused_now` Now (outside the hours) the agent buys on its card (buyPlan packwise-starter, EUR 19.99): Purser starts the purchase | sourcing | refused outside_card_hours by Purser, before any Airwallex call; the refusal audited | refused: outside_card_hours: the sourcing agent's card pays Mon-Fri 18:00-20:00 Europe/Amsterdam only (enforced by Purser); now Thu 12:27 Europe/Amsterdam; 0 Airwallex calls; a purchase window: none opened, 0 calls; now Thu 12:27 Europe/Amsterdam | **pass** | 0 | 5 |
| 6 | `hours.thaw_inside` Purser's clock set inside the hours (Thu 19:59 Europe/Amsterdam): Purser opens a purchase window for one approved purchase (openCardWindow, EUR 1.00 at Packwise), then the card is read back *(simulated: Purser's clock injected (inside the hours); the Airwallex calls are real and happen now)* | sourcing | thawed: ACTIVE at Airwallex, its metadata naming the agent, the task and the policy version | window until 2026-11-26T19:01:30.000Z; read back ACTIVE; metadata {"agent_id":"sourcing","policy_version":"v2","task_id":"governance run: an approved purchase inside the hours"} | **pass** | 9, 10, 11 | 1080 |
| 7 | `hours.purchase_auth` The approved purchase's authorisation on the thawed card (EUR 1.00, Packwise, MCC 5734) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | approved by Airwallex | approved (PENDING) | **pass** | 12 | 3976 |
| 8 | `hours.end_sync` Purser's clock set just after the hours end (Thu 20:00 Europe/Amsterdam), the purchase window still open: the runner's card sync (syncCardsIfChanged), then the card read back *(simulated: Purser's clock injected (just after the hours); the Airwallex calls are real and happen now)* | sourcing | the window closed (the hours ended), the card frozen at Airwallex: card_status INACTIVE read back | policy wants ACTIVE inside, INACTIVE after; sync changed sourcing; read back INACTIVE; window closed: "the card's hours ended (Mon-Fri 18:00-20:00 Europe/Amsterdam, enforced by Purser)"; frozen: "outside its hours (Mon-Fri 18:00-20:00 Europe/Amsterdam, enforced by Purser)" | **pass** | 13, 14, 15, 16 | 1390 |
| 9 | `hours.charge_frozen` A merchant charges the frozen card by itself (EUR 1.00, MCC 5734) *(simulated: the merchant's charge is the sandbox's simulation endpoint)* | sourcing | declined CARD_INACTIVE by Airwallex | declined CARD_INACTIVE | **pass** | 17 | 4093 |
| 10 | `hours.no_window_after` After the hours, Purser tries to open a purchase window (clock still after the hours) | sourcing | no window, no Airwallex call | no window; 0 calls; outside_card_hours: the sourcing agent's card pays Mon-Fri 18:00-20:00 Europe/Amsterdam only (enforced by Purser); now Thu 20:00 Europe/Amsterdam | **pass** | 0 | 3 |

Timings: hours_end_freeze_ms 1387 ms.

## Every request (UTC; no body, header, token, key or card number)

The Calls column above lists these line numbers.

| # | Sent | Answered | ms | Call | HTTP | Airwallex request id | Trace id | Card status read | Step |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 11:27:43.271 | 11:27:43.986 | 715 | `POST /authentication/login` | 201 | – | `4f45dd97a7c04d5e85e1d82c4b25704d` | – | card.issue (sourcing) |
| 2 | 11:27:43.989 | 11:27:44.485 | 496 | `GET /issuing/cardholders` | 200 | – | `65b8908ab3bc4e1f8e5f9b0599d366cb` | – | card.issue (sourcing) |
| 3 | 11:27:44.487 | 11:27:44.892 | 405 | `GET /issuing/cards` | 200 | – | `d6e6452a558647f7a38a819e4ae88cf7` | – | card.issue (sourcing) |
| 4 | 11:27:45.127 | 11:27:45.460 | 333 | `GET /issuing/cards` | 200 | – | `edb23521daf24fc18a7a403ab5f19461` | – | card.issue (sourcing) |
| 5 | 11:27:45.492 | 11:27:46.241 | 749 | `POST /issuing/cards/create` | 202 | – | `bbba07ea6d9143fc8dd4f7864fc692d9` | – | card.issue (sourcing) |
| 6 | 11:27:46.247 | 11:27:46.649 | 402 | `POST /issuing/cards/{id}/update` | 200 | – | `62ea122019134c0fb304201db4feaf20` | – | card.issue (sourcing) |
| 7 | 11:27:46.650 | 11:27:46.972 | 322 | `GET /issuing/cards/{id}` | 200 | – | `29e3bb8f5c214d8b90b840df5dac05eb` | INACTIVE | card.issue (sourcing) |
| 8 | 11:27:46.988 | 11:27:47.314 | 326 | `GET /issuing/cards/{id}` | 200 | – | `fe6bf39d2aaf4e73a3b04b01daeb6062` | INACTIVE | card.readback (sourcing) |
| 9 | 11:27:47.410 | 11:27:47.839 | 429 | `POST /issuing/cards/{id}/update` | 200 | – | `e78dd5e6d9b84124a7aee120e2fac609` | – | hours.thaw_inside (sourcing) |
| 10 | 11:27:47.840 | 11:27:48.163 | 323 | `GET /issuing/cards/{id}` | 200 | – | `78444304b2ca48fba927a8c34a8f7118` | ACTIVE | hours.thaw_inside (sourcing) |
| 11 | 11:27:48.164 | 11:27:48.480 | 316 | `GET /issuing/cards/{id}` | 200 | – | `6bc277a893844a4386c9ccfe32ce46bc` | ACTIVE | hours.thaw_inside (sourcing) |
| 12 | 11:27:48.482 | 11:27:52.456 | 3974 | `POST /simulation/issuing/create` | 201 | – | `f1ec7842edb741c89e218c34505e9d43` | auth PENDING | hours.purchase_auth (sourcing) |
| 13 | 11:27:52.469 | 11:27:52.776 | 307 | `GET /issuing/cards/{id}` | 200 | – | `5cecff0a1c58444bb347813d72544574` | ACTIVE | hours.end_sync (sourcing) |
| 14 | 11:27:52.778 | 11:27:53.163 | 385 | `POST /issuing/cards/{id}/update` | 200 | – | `fec782ebd8714d4880fa22b22e2d5e44` | – | hours.end_sync (sourcing) |
| 15 | 11:27:53.164 | 11:27:53.450 | 286 | `GET /issuing/cards/{id}` | 200 | – | `8ca7fed4a97a4fcda799ded47e7ddff9` | INACTIVE | hours.end_sync (sourcing) |
| 16 | 11:27:53.456 | 11:27:53.848 | 392 | `GET /issuing/cards/{id}` | 200 | – | `43b7a0bafddf4947b6ef64bce6ee5e54` | INACTIVE | hours.end_sync (sourcing) |
| 17 | 11:27:53.851 | 11:27:57.942 | 4091 | `POST /simulation/issuing/create` | 201 | – | `5930081e7243448fb93d66682738a636` | auth FAILED CARD_INACTIVE | hours.charge_frozen (sourcing) |

Calls by endpoint: `POST /authentication/login` 1, `GET /issuing/cardholders` 1, `GET /issuing/cards` 2, `POST /issuing/cards/create` 1, `POST /issuing/cards/{id}/update` 3, `GET /issuing/cards/{id}` 7, `POST /simulation/issuing/create` 2.

## What this does not show

- Airwallex still has no recurring time window: the hours are Purser's control. Airwallex declines on the card's status, limits, merchant categories and currencies; inside a window Purser opened, a second charge within those is approved (the card drill's finding of 20 Nov stands).
- Real time passing: the end of the hours is Purser's injected clock, not a wait until 20:00; the runner's every-few-seconds loop did not run (the sync was called once).
- The authorisation approved inside the window was not written to this run's ledger: the window was opened under the injected clock and Airwallex dates the authorisation at the real time, so the ledger's window match would not have applied. Its answer is in the step's facts and the call table.
- Whether Airwallex copies a card's metadata onto its transactions: not looked at (Purser ties each transaction to agent, task and policy in its own ledger).
- A person's Face ID on a real phone; Purser Cloud's screens. One run: the times are single measurements.

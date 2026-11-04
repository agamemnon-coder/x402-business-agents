# Red team, three runs in a row (31 October)

`npm run redteam` three times, against stand-ins for Airwallex and Metal in a throwaway world. Logs are kept as
they ran (secrets redacted). An inconclusive attack is counted on its own, never as blocked.

| Run | Attacks | Blocked | Of those, found afterwards (not prevented) | Inconclusive | Not blocked |
|---|---|---|---|---|---|
| 1 | 39 | 39 | 2 | 0 | 0 |
| 2 | 41 | 40 | 2 | 1 | 0 |
| 3 | 40 | 39 | 2 | 1 | 0 |

The two inconclusive ones were bank-change notices written by Claude that the classifier read as a data
correction: nothing was paid or changed, but the check that should have caught them was not the one hit, so they
are not counted as blocked. The attack set varies a little per run because the attacker drafts some messages itself.

# Single-use task cards, live in the Airwallex sandbox (2026-10-30, after the Friday runs)

On a backup of the `friday-2` ledger (so the run itself was not changed), with the build/next code. Three task
cards, each asked for by the CFO at the runner and issued within the CFO policy (under 300.00 EUR).

| Card | What was tried | Airwallex's answer |
|---|---|---|
| Flight •••• 8653, at most 150.00, until 12 Nov | read back after issue | `allowed_transaction_count: SINGLE`, limits 150.00/150.00, MCC 4511, EUR, end 2026-11-12T23:59:59Z: as asked |
| | Skyline Air 120.00 | approved |
| | a second charge, 20.00 | **declined, `CARD_CLOSED`**: Airwallex closed the card itself after its one purchase |
| | a hotel, 60.00 | declined, `CARD_CLOSED` |
| | Purser setting the card INACTIVE | **refused, 400 `invalid_argument`** ("Invalid status update"): a closed card cannot change status |
| Train •••• 9799, at most 90.00 | a hotel charge (MCC 7011) first | declined, `MERCHANT_CATEGORY_NOT_ALLOWED` |
| | 95.00, over the limit | declined, `LIMIT_EXCEEDED` |
| | Eurorail 74.50 | approved; right after, the card still read ACTIVE and the status update was refused; a moment later it read CLOSED |
| Hotel •••• 7020, at most 120.00 (after the fix) | a flight charge first | declined, `MERCHANT_CATEGORY_NOT_ALLOWED` |
| | 125.00, over the limit | declined, `LIMIT_EXCEEDED` |
| | Hotel Bayern 98.00 | approved; Purser set the card INACTIVE before Airwallex closed it |
| | a second charge, 10.00 | declined, `CARD_INACTIVE` |

Two findings, both fixed with tests:

1. The decline reason for a second use is `CARD_CLOSED`. The test double used a placeholder (`SINGLE_USE_SPENT`); it
   now closes a single-use card after its one approved charge, as the sandbox does, and refuses a status change on a
   closed card.
2. Closing the card after its purchase could fail: Airwallex closes the card a moment after the charge, and refuses a
   status update in between. `bookOnTaskCard` now freezes the card only while it is still open, and if Airwallex
   refuses, reads it again until it is closed. The card sync leaves a closed card alone.

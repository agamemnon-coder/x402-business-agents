# Ask Purser: a card for one task, from one sentence

The CFO types on the phone (CFO policy page, "Ask Purser"), or on the runner:

```bash
npm run ask -- "Book a flight to Berlin for the trade fair on 12 November, at most €250"
```

Up to the CFO policy's threshold for task cards (`approval.task_card_eur`, 300.00 to start; raising it needs Face ID)
Purser issues the card at once: *"Done, within your policy: a single-use flight card •••• 4821, at most 250.00 EUR,
until 2026-11-12."* Above it, Purser proposes it: *"I proposed P-0011: … Approve it with Face ID and I book it."*,
and Opus writes a short risk review beside the proposal. Either way Airwallex issues a virtual card that can pay
**one** airline charge, up to the amount, until the end of the day named. After that one charge Purser closes the card
at Airwallex. Then:

```bash
npm run ask -- book P-0011 189.00     # the agent books (T-0001 for a card issued within the policy); the
                                      # airline's charge is a sandbox simulation; the card is closed after it
npm run ask -- show P-0011            # a second charge and a hotel charge: Airwallex declines both
```

## What decides what

| Step | Who | What |
|---|---|---|
| Screen the message | code (`src/policy/injection.ts`) | Instructions aimed at the AI ("ignore your rules", "pre-approved") or hidden characters: refused whole, before any model reads it |
| Read the message | Claude Sonnet 5.5, or the plain parser without a key | Kind, amount as written, purpose, date |
| Decide | code (`planTask`, `src/agents/askPurser.ts`) | Only flights (merchant category 4511, at most 1,500.00), hotels (7011, 1,000.00) and trains (4112, 500.00); the amount must be in the CFO's own words; the date at most 30 days ahead (7 days when none is named) |
| Approve | the CFO policy up to its threshold; above it the CFO, Face ID (two people above the four-eyes threshold), with Opus's review beside the terms | The exact card: kind, categories, amount, end, single use, and the hash of the message |
| Issue | Airwallex Issuing | `allowed_transaction_count: SINGLE`, the categories, euros only, `active_to`; read back, and frozen if it differs from what was approved |
| Pay | the merchant, through Airwallex | One successful charge; anything else is declined by Airwallex |

An agent can ask too: outside agents through the MCP tool `ask_for_task_card`. An agent's request is always a proposal
for the CFO, never a card at once.

The card shows in the dashboard's cards grid and its charges in the feed; the conversation is in the "Ask Purser"
panel. Card spend on task cards goes to account 6300 (travel), cost centre CC500, in the GL export. A task card is
not counted against an agent's velocity limits: its own limit, one purchase, is stricter. The emergency stop freezes it
like any card.

## What is simulated

The airline's charge is Airwallex's sandbox simulation (`POST /simulation/issuing/create`); no real flight is booked.
Single-use cards are documented by Airwallex ("only 1 successful debit transaction"); the live check in the sandbox,
and the decline reason it gives for a second charge, is on the list after the Friday runs. Until then the fake used in
the tests calls that reason `SINGLE_USE_SPENT`.

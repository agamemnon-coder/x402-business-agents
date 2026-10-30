# Ask Purser: a task card from a chat message (plan)

**Goal:** the CFO types "Book a flight to Berlin for the trade fair on 12 November, at most €250" and gets a virtual
card that can pay one airline once, up to €250, until that day, after Face ID. An agent then books on it (a sandbox
simulation), a second charge or a hotel charge on it is declined by Airwallex, and words that try to raise the
limit change nothing.

**Architecture:** the message is screened for planted instructions, read by Sonnet into typed fields (with a plain
parser as fallback), and checked by code against `TASK_KINDS` in `src/config/policy.ts`. The result is a
`task_card` proposal. Its executor issues a single-use card (`allowed_transaction_count: SINGLE`) with the task's
merchant categories, a limit equal to the amount and an end date, reads it back from Airwallex and stores it in
`cards` under the id `task:P-xxxx`, so the cards grid, the emergency stop, the poll and the webhooks cover it
unchanged. Its limits come from a `task_cards` table through `rules()`, as outside agents' do.

## Rules (code, not prompt)

- Kinds and their merchant categories and caps: flight (4511, at most €1,500), hotel (7011, €1,000), train (4112,
  €500). Anything else is refused with a reply.
- The amount must be written in the message itself and be at most the kind's cap; no amount, no card.
- The end date is the day named in the message (end of that day, UTC), at most 30 days ahead; none named means 7 days.
- Always a proposal with Face ID: a new card is new. The proposer is Purser; the CFO approves.
- A message with planted instructions ("ignore the limit", "pre-approved", hidden characters) is refused whole.
- The purpose text is kept to 120 plain characters and shown on the approval.

## Tasks

1. `src/config/policy.ts` `TASK_KINDS`; `src/agents/askPurser.ts`: `readTask(text, now)` (fallback parser) and
   `planTask(db, reading, text, now)` returning terms or a refusal. Tests: amounts not in the text, over the cap,
   other kinds, dates, injection, the model inventing a higher amount.
2. Schema: `task_cards` table; `rules()` adds `card.task:…` limits and `stop.task:…`; `cardControls` for `task:`
   ids. `IssuingRail.createCard` takes `singleUse`; `Card.controls.singleUse` read back. `FakeIssuing` declines a
   second approved charge on a single-use card. Tests.
3. `task_card` proposal: terms, `summarize`, the approval page's terms view; executor `executeTaskCard`. Tests:
   approved → card with exactly those controls; Airwallex answering with other controls → FAILED, nothing stored.
4. `bookOnTaskCard(db, sim, taskId, merchant, amount)` and `npm run ask -- "<message>"` / `npm run ask -- book
   P-xxxx`. Tests: the booking is recorded once; a second charge and a hotel charge are declined.
5. Chat: relay route `/api/ask` (viewer key, same origin, rate-limited, one at a time, at most 500 characters),
   runner inbox kind `ask` replying with Purser's answer; a chat box on the phone's policy page; an "Ask Purser"
   panel on the dashboard (conversation and task cards). Tests for the relay route and the runner.
6. Red team: three attacks (raise the limit in words, hidden characters, a second purchase on the card) must fail.
   Docs and the demo story.

To verify live after the Friday runs (the sandbox is shared with them): `SINGLE` is accepted, the card reads back as
single-use, and the decline reason Airwallex gives for a second charge (the fake uses a placeholder until then).

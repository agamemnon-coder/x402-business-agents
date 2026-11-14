# Purser · Demo Day cheat sheet

Alta (formerly Metal): the chain partner renamed itself on 14 November 2026; the award keeps the hackathon's name, the Metal Award.

19 November 2026. One A4 page beside the laptop: [cheat-sheet.pdf](cheat-sheet.pdf), printed from this page. Words:
[pitch.md](pitch.md). Every step's fallback: [demo-day.md](demo-day.md). Questions: [qa.md](qa.md).

## The three sentences

1. An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in a minute.
2. One CFO policy, a lock per rail: Airwallex card controls, Alta's mandate, the CFO's signature on invoices. A prompt is not a control.
3. Real agents: Claude made all 24 decisions (routine payments are code); no key reaches Claude.

## The five numbers

- **All 24** decisions by Claude, 0 fallbacks (main run, 3 November).
- **86** Alta payments, each its own transaction: 41 sales, 41 purchases, 3 refunds, 1 sweep.
- **16** stops, nothing paid over a limit: buy rule 12, Alta 2, the CFO 1, planted instruction 1.
- **All 3** agent cards carry the CFO policy as Airwallex's own controls (read back 6 November).
- **6 s** from Face ID to PAID (the sandbox simulates the settlement).

## The three proofs

1. **The hash in Airwallex.** I signed P-0005 with Face ID; Airwallex's own record of the EUR 240.00 SWIFT transfer
   `03360bfa…3985` carries that hash, `797d4483…abcd`. Show: `/proof`.
2. **The refusal on Alta.** Our own check off once; Alta refused purchase #24 anyway, `mandate_cap_exceeded`, tx
   `0x2e92f9cb…1871`. Show: `/metal`.
3. **Claude, all 24.** Every decision by Claude, 0 fallbacks; no key reaches Claude. Show: `/proof`.

## The timing

0:00 the problem, why now · 0:20 live `/try`: Claude reads an invoice, the CFO approves the exact terms · 1:30 the three proofs · 2:20 the business
and the ask: "we're looking for design partners on Airwallex."

## The fallbacks

- **Network down:** the `/watch` replay offline, `npm run judge` → `localhost:4311/watch`; then clips `11-turn`,
  `12-tamper`.
- **Face ID fails:** once more; then the second device (laptop, tab 4); or clip `11-turn`: "Same moment, recorded."
- **The quote expires:** tap **Get a new quote**: "New quote, new terms: I sign again." A feature, not a bug.
- **`/try` busy:** the second device, its test company started before.
- **`/proof` or `/metal` down:** `localhost:4311/proof`, `/metal`; else deck slides 6 and 7.
- **Screen sharing drops:** the deck PDF in the chat; talk over it.
- **QR fails:** read out kit11.max-31b.workers.dev/try.

## Say plainly, when asked

Test money: Airwallex sandbox, Alta testnet. The second approver was a labelled test passkey. The sandbox simulates
the SWIFT settlement. The server checks no attestation (it is "none"). The business case is a hypothesis: no
customer has seen a price. T:0: 95 journal entries posted to its shared sandbox on 10 Nov, 0 differences with our books;
a second push posted none; T:0's own balance sheet balances. Two locks (10 and 12 Nov): a labelled test passkey
signed, Airwallex held the payout `IN_APPROVAL` until the owner approved it in Airwallex's web app; then PAID (sandbox,
settlement simulated).

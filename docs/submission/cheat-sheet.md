# Purser · Demo Day cheat sheet

19 November 2026. One A4 page beside the laptop: [cheat-sheet.pdf](cheat-sheet.pdf), printed from this page. Words:
[pitch.md](pitch.md). Every step's fallback: [demo-day.md](demo-day.md). Questions: [qa.md](qa.md).

## The three sentences

1. An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless. Try it in a minute.
2. One CFO policy becomes three locks: Purser's code, Airwallex's card controls, Metal's mandate on chain. A prompt is not a control.
3. Real agents, not scripts: Claude made all 24 decisions, and no key reaches Claude.

## The five numbers

- **24 of 24** decisions by Claude, 0 fallbacks (main run, 3 November).
- **86** Metal payments, each its own transaction: 41 sales, 41 purchases, 3 refunds, 1 sweep.
- **16** stops, nothing paid over a limit: buy rule 12, Metal 2, the CFO 1, planted instruction 1.
- **3 of 3** agent cards carry the CFO policy as Airwallex's own controls (read back 6 November).
- **6 s** from Face ID to PAID (the sandbox simulates the settlement).

## The three proofs

1. **The hash in Airwallex.** I signed P-0005 with Face ID; Airwallex's own record of the EUR 240.00 SWIFT transfer
   `03360bfa…3985` carries that hash, `797d4483…abcd`. Show: `/proof`.
2. **The refusal on Metal.** Our own check off once; Metal refused purchase #24 anyway, `mandate_cap_exceeded`, tx
   `0x2e92f9cb…1871`. Show: `/metal`.
3. **Claude, 24 of 24.** Every decision by Claude, 0 fallbacks; no key reaches Claude. Show: `/proof`.

## The timing

0:00 the problem, why now · 0:20 live `/try/sign`: sign, then tamper · 1:30 the three proofs · 2:20 the business
and the ask: "we're looking for design partners on Airwallex."

## The fallbacks

- **Network down:** the `/watch` replay offline, `npm run judge` → `localhost:4311/watch`; then clips `11-turn`,
  `12-tamper`.
- **Face ID fails:** once more; then the second device (laptop, tab 4); or clip `11-turn`: "Same moment, recorded."
- **The quote expires:** tap **Get a new quote**: "New quote, new terms: I sign again." A feature, not a bug.
- **`/try/sign` busy:** the second device, its world started before.
- **`/proof` or `/metal` down:** `localhost:4311/proof`, `/metal`; else deck slides 6 and 7.
- **Screen sharing drops:** the deck PDF in the chat; talk over it.
- **QR fails:** read out kit11.max-31b.workers.dev/try/sign.

## Say plainly, when asked

Test money: Airwallex sandbox, Metal testnet. The second approver was a labelled test passkey. The sandbox simulates
the SWIFT settlement. The server checks no attestation (it is "none"). The business case is a hypothesis: no
customer has seen a price. T:0: 95 journal entries posted to its shared sandbox on 10 Nov, matching our books.

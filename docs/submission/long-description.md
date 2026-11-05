# Purser: the long description

The form's Description as it stood on 5 November (about 15,000 characters), before Max asked for a short one. The form
now uses the short Description in [README.md](README.md#description), which links here. Every run figure comes from the
main run of 3 November (`docs/demo/main-run.json`, log `docs/runs/2026-11-03-main-run.md`) and the reports in this repo
(`src/submission/facts.ts`); `test/submission.test.ts` checks this page against them, as it checks the short one.

**Starter Kit 11 (x402 Business Agents), entered for the Metal Award and the Visa Award (see the note under Visa).**

**A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros.** Three Claude agents run a
small data business on 20 test dollars through Metal and Airwallex; the CFO signed 5 times with Face ID. One live run,
every id below.

Purser is for the CFO or controller of a small company that runs AI agents and wants them to spend company money only
within limits the CFO sets. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code
holds the rest; the CFO approves anything beyond them. The example company is Northwind Outdoor, an outdoor wholesaler
that sells live stock data to retailers per query (here one simulated customer, Summit Outfitters, whose agent we run)
and pays its suppliers. It has Kit 11's three agents, the Sourcing, Support and Treasury agent, each with its own
Airwallex card and its own Metal mandate. The CFO in this demo is Max, the builder, on his own phone.

**In one line:** Claude explains and proposes, the rules in code hold every limit, and a person signs before money
moves beyond them. Sign one yourself: https://kit11.max-31b.workers.dev/try/sign

### The main run (3 November)

One live run, 11:16–11:33 UTC, on the Airwallex sandbox and Metal testnet with test money, real Claude decisions and
Max's passkey (Face ID on his phone); Max plays the CFO. The second approval (four eyes, 2 of 2) came from a labelled virtual test passkey on the runner
machine, pressed by our build tool, Claude Code, on Max's go; in production the second approver is a second person. The
three runtime agents hold no owner key and no passkey. Log: `docs/runs/2026-11-03-main-run.md`.

- **The price rise.** Stockline, the supplier, went from 0.02 to 0.04 a stock check, over the Sourcing mandate's 0.03
  cap. Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved.
  The refusal is recorded on chain (`mandate_cap_exceeded`, tx `0x2e92f9cb…1871`). Treasury's options 40 s after the
  refusal, within the same 20.00: option A raises Sourcing's cap to 0.04 and keeps our price at 0.05; option B takes the
  same cap and raises our price to 0.07. The CFO signed A with Face ID (1 of 2), then the second approver, the labelled test passkey (2 of 2), and both mandates
  were replaced on chain.
- **The dispute.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID.
- **The euro bill.** The Treasury agent planned the EUR 240.00 licence itself (P-0005). After the CFO's Face ID,
  EUR 110.00 bought by FX for the shortfall (USD 124.29, conversion `3ca88196-05da-4d88-9caa-796f03704636`), then
  SWIFT: transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, PAID 6 s after Face ID (settlement simulated in the
  sandbox), fee EUR 13.42 (ceiling EUR 20.00).

Each agent's budget, when bound → after the CFO's Face ID (test USD): Sourcing 10.00 → 14.00 (cap 0.03 → 0.04 a
purchase); Support 4.00 (cap 0.10); Treasury 6.00 → 2.00. 20.00 between them before and after, held in code.

### From idea to build

Our idea (submitted 24 October) promised three agents on one Metal account, each under its own on-chain mandate, and
three moments: a price rise, a dispute and a euro bill. Built as promised, each with its proof in
[docs/idea-vs-build.md](../idea-vs-build.md): the three mandates (10, 4 and 6 test USD, at most 3 cents a purchase for
sourcing), the 20 held in code and no agent with the owner key; x402 queries at 5 cents with a signed order, upstream
data at 2 cents; and the three moments above, in one live run.

What got better than the idea: the agents decide for themselves, as Claude agents with their own tools, inside the
same limits; the approval is Face ID on the CFO's phone instead of a typed hash; every agent also has an Airwallex
company card whose limits Airwallex enforces.

### How we use Airwallex

- **A company card per agent (Issuing).** Each agent has a DELEGATE cardholder and a virtual Visa card. The CFO policy
  sets its limits; its merchant categories, currency and end date are fixed per agent. Purser writes them all to the
  card and reads them back. Airwallex enforces them. In the main run the Sourcing agent asked for a card raise first
  (P-0006, EUR 30.00 → 46.00), the CFO approved it with Face ID, Purser synced it to the card, and Airwallex approved
  the TAP-signed EUR 45.00 purchase (authorization `01a1a12f-4113-7000-b76d-014677710007`).
- **FX and SWIFT for the €240 licence.** EUR 110.00 bought by FX for USD 124.29 on a locked quote (conversion
  `3ca88196-05da-4d88-9caa-796f03704636`), only the shortfall above the EUR reserve; then SWIFT, transfer
  `03360bfa-afce-457b-89d1-e1097fbe3985`, fee EUR 13.42, PAID 6 s after Face ID: in the sandbox Purser itself moves the
  transfer to SENT and then PAID through Airwallex's simulation API, so that settlement is simulated. One Face ID covers
  the rate, the payee and the most the fee may be (EUR 20.00). The transfer carries the approval's hash in its metadata.
- **Earnings booked once final.** The 0.69 test USD swept on Metal after finality is booked at Airwallex exactly once,
  as a simulated sandbox deposit (`b3812e05-2afa-4698-8f64-429f9608e0a0`) whose reference is the testnet transaction.
- **Webhooks, through our relay.** Airwallex posts each event to the relay's `/hooks/airwallex`, which checks
  `x-signature` (HMAC-SHA256 over `x-timestamp` plus the raw body, before anything parses it; a timestamp more than five
  minutes off is refused), keeps each event once by its id and answers without waiting for the runner
  (`worker/src/core.ts`); the runner checks the HMAC again with its own copy of the secret and records each event id
  once (`src/policy/cardHooks.ts`). Subscribed to 23 event types since 30 October; none arrived during the main run,
  so the live proof is the 30 October run below (`docs/runs/2026-10-30-webhooks.md`).

### How we use Metal

- **A mandate per agent.** Each agent that pays per request does it under its own on-chain mandate: a cap per payment,
  a total budget, one payee and an end date.
- **A price rise refused against the mandate.** Metal refused the purchase over the cap itself (tx `0x2e92f9cb…1871`);
  after the CFO's Face ID and the second signature (the labelled test passkey), Purser replaced the Sourcing and
  Treasury mandates on chain; a payment under the old mandate is refused (`mandate_revoked`).
- **x402 with signed orders** for per-request sales, and **mandate pulls** for refunds and the earnings sweep.
- **The Dispute desk.** A simulated customer disputes 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects it with Face ID.
  Any seller on Metal can reuse it: `examples/metal-dispute-desk`.

### Visa

Visa: each agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.

*Visa Award: Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa).*

### Where Claude is used

In the main run the three agents (Sourcing on Haiku, Support on Sonnet, Treasury on Opus) made 24 decisions, all by
Claude, 0 fallbacks, in 50 calls each with a request id, for USD 0.3170 at list prices. No key reaches their Claude
models, and no agent can approve. Purser's code checks every payment against the policy, and nothing moves money
beyond the agents' limits without the CFO's Face ID.

### Controls

- **The agent may:** pay inside its card limits and its mandate, alone.
- **Needs the CFO:** anything above a limit, a new payee, a bank-detail change, a refund batch above the threshold, a
  looser policy. The CFO signs the exact terms on the phone with Face ID; the runner checks the signature and
  the terms' hash before it moves money.
- **Exceptions:** a price rise is refused on chain and becomes options; a suspected fake invoice or a planted
  instruction is held for a person; an agent that pays too often is stopped; a payment the ledger cannot explain is
  found by the hourly reconciliation.
- **Audit:** every decision goes into an append-only, hash-chained log that `npm run verify` re-checks.

### Proof from the main run (3 November)

The CFO on his own phone with Face ID; the agents decided with Claude; test money only (Metal testnet, Airwallex
sandbox). Second approver: a labelled test passkey in this demo. In production this is a second person.
- 55 queries, 55 upstream purchases (the cache was off): 41 paid. 14 queries got an error and were not charged (1
  refused by Metal at the cap, #24; 12 the Sourcing agent chose not to buy at the higher price, #25–#36, until the new
  mandate was in place; 1 refused `mandate_revoked` while the mandate was being replaced, #37);
- 87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy, with no approval at the
  time; 86 of them on Metal (all but the card buy);
- on Metal testnet, checked against the chain on 5 November: the 4 mandates bound at setup and the 2 replacements,
  86 payments each with its own transaction, and 1 refusal on chain (#24,
  [tx](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871)); no emulator
  and no clearing in this run. The EUR licence and the card buy ran on the Airwallex sandbox; the other 13 refused
  purchases (12 skipped by the agent's buy policy; #37, refused by Metal against its just-revoked mandate, with no
  transaction of its own) are in the ledger, not as transactions on chain;
- 24 of 24 decisions by Claude, 0 fallbacks; 5 decisions signed with Face ID by the CFO (P-0001, P-0002, P-0004,
  P-0005, P-0006);
- the books match the chain and Airwallex: `verify` passes; `reconcile` checked 88 (the 86 Metal payments, the SWIFT
  transfer and the card buy), 0 differences; `data-qa` 217 of 217 checks; 110 money movements, 0 without an origin;
- 16 stops, nothing paid over a limit: Claude skipped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.
  Claude's 12: stock checks #25–#36, which the Sourcing agent chose not to buy over its cap; Metal's 2: 1 over the
  mandate's cap (#24), 1 on a mandate that had just been replaced (#37, `mandate_revoked`); the CFO's 1: P-0004, with
  Face ID; the planted instruction: a line aimed at the AI in the dispute document, treated as data;
- Separate run, not counted: Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November.

### What is real and what is simulated

All money is test money: the Airwallex sandbox and Metal testnet. The cards, limits, conversion, transfer and mandates
are real API and chain results. Built, not yet live: T:0 bookkeeping is built; posting failed (shared key 403 CAPI71 on 3 Nov, new key 401 CAPI11 on 5 Nov), so nothing is posted. Simulated by the sandbox: the merchants' charges, the deposit that stands in for Metal
earnings and the transfer's last steps (SENT, PAID), which Purser triggers through the sandbox's simulation API. Run
by us: the customer Summit Outfitters and its agent, and Stockline, the
warehouse API.

### Other live tests (separate worlds, dated)

Not part of the main run; each ran live on the Airwallex sandbox or Metal testnet (test money), in its own test world,
with its own date.

- **Visa TAP run (2 November).** Visa's reference registry self-hosted with a test key, and our own TAP merchant;
  Airwallex approved one card buy and declined EUR 45.00 over the card limit (LIMIT_EXCEEDED).
- **Single-use task cards (30 October).** One sentence (a flight, a hotel or a train, with an amount) becomes one card
  for that task, locked to its merchant category, the amount and a date. Within the CFO's policy it is issued at once;
  otherwise after Face ID.
- **Global Accounts and webhooks (30 October).** Retailers pay Northwind's EUR and GBP accounts (sandbox simulations); a
  receivables agent matches each payment to its invoice by reference and sends anything short or unknown to the CFO.
  Each webhook delivery is signature-checked at the relay and again on the runner. Shown live: two retailer deposits,
  one matched and one sent to the CFO as short, by the webhook alone, and a card transaction. Payout and conversion
  events are subscribed but were not caused live.
- **For a bigger company, more control on chain (separate test worlds, Metal testnet, 30 October):**
  - **Four eyes on chain.** A 2-of-2 Metal account: the CFO and a controller. A payment signed by the CFO alone, the
    same payment co-signed by a stranger's key, and a mandate revoke by the CFO alone each reverted on chain; with both
    owners signing, they went through.
  - **Compliance before a payout.** Our send-policy contract pays only with Purser's signed screening decision for
    that payee, amount and moment. Eleven attacks reverted on chain, among them a replay, a redirect to the attacker
    and a self-made decision for a sanctioned stand-in. Agents' mandate payments do not pass through it (Metal's
    design).
  - **Clearing under load.** 2,000 of 2,000 pay-per-call payments in 471.8 s (4.24 a second, p50 1.4 s, p95 8.1 s), at
    about $0.0007 of RPC calls per payment (an estimate from Metal's published rates, not a bill). A first run paid
    1,879 before one wallet was held by a lost answer; resending the same request fixed it.
  - **Receive policy (30 October, its own test world):** the sweep wallet accepts money only from the business
    account; a stranger's 0.02 was held in quarantine by Metal, recorded by Purser and returned only after the CFO's
    Face ID.

### Tested on stand-ins (not live)

These ran against stand-ins for Airwallex, Metal, the phone or Claude, not on the live rails.

- **Emergency stop.** One Face ID freezes every agent card at Airwallex and stops every agent payment (tested against
  stand-ins, not yet run live).
- **Red team (30 October, in-memory stand-ins for Airwallex, Metal and the phone).** 35 scripted attacks plus 4
  documents written by Claude Opus as the attacker: 37 of 39 stopped, 2 detected afterwards, not prevented (a hidden
  card charge by the reconciliation, a rewritten log row by `npm run verify`), 0 inconclusive. Three more runs on 31
  October (120 attacks): 112 stopped, 6 detected afterwards (the same two kinds in each run), 2 inconclusive (nothing
  was paid or changed). On 2 November Claude Opus wrote 119 more tests: code judged 111 stopped, 5 got through and 3
  inconclusive; all 5 were checked by hand and none is a breach (two reading bugs on Try were filed).
- Scenario Lab: 18 of 18 stories as expected (stand-ins for Airwallex, Metal and Claude).

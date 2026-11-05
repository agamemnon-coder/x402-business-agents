# Purser

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)

**A supplier doubles its price. A customer disputes 12 orders. A €240 bill is due in euros.** Three Claude agents run a
small data business on 20 test dollars through Metal and Airwallex; the CFO signed 5 times with Face ID. One live run,
every id below.

**Try it yourself: [sign with your own Face ID](https://kit11.max-31b.workers.dev/try/sign).** In a test world of your
own, an agent proposes two payments: a rule blocks one, and you sign the other's exact terms with a passkey your phone
or laptop makes (Face ID, Touch ID or a PIN). The server checks the signature; change one cent and the same signature is
refused. Nothing real moves. Live since 4 November 2026.

Purser gives each AI agent of a small company its own Airwallex card and its own Metal on-chain mandate. Metal holds
each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything
beyond them, with Face ID on the exact terms.

**Also:** [the site](https://kit11.max-31b.workers.dev/) replays the main run; [`/try`](https://kit11.max-31b.workers.dev/try)
gives an agent a task of yours: Claude reads it, code applies the CFO's limits, no money moves.

Starter Kit 11 · x402 Business Agents · entered for the Metal Award + Visa Award ([note](docs/submission/README.md#visa)). Northwind Outdoor,
the example company, is an outdoor wholesaler that sells live stock data to retailers per query: the kit's data business.

## The main run (3 November)

World `main-1`, 11:16–11:33 UTC, on the Airwallex sandbox and Metal testnet with test money, frozen commit `35e1cac`.
24 of 24 decisions by Claude (Sourcing on Haiku, Support on Sonnet, Treasury on Opus), 0 fallbacks. The CFO (Max, the
builder) signed on his own phone with Face ID. The second approval (four eyes on P-0002, 2 of 2) came from a labelled
virtual test passkey on the runner machine, pressed by our build tool, Claude Code, on Max's go; in production the
second approver is a second person. The three runtime agents hold no owner key and no passkey, and no key reaches their
Claude models. Log: [docs/runs/2026-11-03-main-run.md](docs/runs/2026-11-03-main-run.md); record:
[docs/demo/main-run.json](docs/demo/main-run.json); replayed on [/watch](https://kit11.max-31b.workers.dev/watch).

**1. The price rise** ([watch](https://kit11.max-31b.workers.dev/watch?scene=1)). Stockline went from 0.02 to 0.04 a
stock check, over the Sourcing mandate's 0.03 cap. Metal refused purchase #24 itself at 11:23:27, `mandate_cap_exceeded`
(let through on purpose; Purser normally refuses first), recorded on chain in tx
`0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871` (11:23:33). Treasury's options came at 11:24:07,
40 s after Metal's refusal and 34 s after that tx, within the same 20.00; after four eyes, both mandates were replaced on
chain: Treasury `0x789abb249896e01cee8e3641d7794676b6f2ce5d05f45093f6cc64101c9aebbc` (11:26:54), Sourcing
`0x2a91ac97fc2a459da2b0c73f2b8020edec1901d051c7ef03bb088d36067fe790` (11:26:59).

**2. The dispute** ([watch](https://kit11.max-31b.workers.dev/watch?scene=2)). A simulated customer disputes 12 orders,
saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had
wrong data; the Support agent refunds those 3 (0.15 test USD) itself. "Refund the other 9" goes to the CFO, who rejects
it with Face ID. The refunds, #7, #10 and #13:
`0xe4bf79623f9cb9212a49ea7c0ced60d241041051f322d199e319989d6548c89d`,
`0xe44a3460faf6cb2050067bf22791df61803f8646adeb5fcc2a205d1f1afa75e5`,
`0x5099fe44b03d83f4dd3963fc59a40e2a506bee533e5a41e8f1b00a12bee14510`; P-0004 ("refund the other 9") rejected by Max
with Face ID at 11:29:37.

**3. Earnings and euros** ([watch](https://kit11.max-31b.workers.dev/watch?scene=3)). 0.69 swept after finality, tx
`0x86936a5b29f9550857676fa710231af9e20882ebe6eee16f75a90af29767ccb4`, booked at Airwallex as deposit
`b3812e05-2afa-4698-8f64-429f9608e0a0`. The Treasury agent planned the EUR 240.00 licence itself; after the CFO's
Face ID, EUR 110.00 bought by FX for USD 124.29 (conversion `3ca88196-05da-4d88-9caa-796f03704636`), then SWIFT:
transfer `03360bfa-afce-457b-89d1-e1097fbe3985`, fee EUR 13.42, PAID 11:31:24, 6 s after Face ID (settlement simulated
in the sandbox: Purser itself moves the transfer to SENT and PAID through Airwallex's simulation API). The Sourcing agent
asked for a card raise first (P-0006, EUR 30.00 → 46.00), the CFO approved it with Face ID, and Airwallex approved the
TAP-signed EUR 45.00 purchase (authorization `01a1a12f-4113-7000-b76d-014677710007`).

**2 stopped at a limit:** Metal refused purchase #24 over the mandate cap, and the CFO rejected P-0004 with Face ID.
Not counted: query #37, refused `mandate_revoked` while the mandate was being replaced.\
*Separate run, not counted:* Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November

**Payments:** 87 inside the limits = 41 sales + 41 supplier purchases + 3 refunds + 1 sweep + 1 card buy, with no
approval at the time; 86 of them on Metal. 14 of the 55 queries got an error and were not charged. `verify` passes,
`reconcile` checked 88 with 0 differences, and every one of the 110 money movements has an origin.

| Kit 11 agent | Its job in the brief | Budget (test USD) when bound → after the CFO's Face ID |
|---|---|---|
| Sourcing agent | buys the upstream data per query; its card pays warehouse and data software | 10.00 → 14.00, cap 0.03 → 0.04 a purchase |
| Support agent | refunds customers when a dispute holds; its card pays helpdesk software | 4.00, cap 0.10 a refund |
| Treasury agent | rebalances the budgets after the price rise, sweeps earnings to Airwallex, plans the EUR licence (Airwallex FX and SWIFT, after Face ID) | 6.00 → 2.00 |

20.00 test USD between them, before and after, held in code (`TOTAL_BUDGET_CENTS`). The limits in code, each with its test:
[docs/controls.md](docs/controls.md#guards-in-code).

**Visa:** each agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which
agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the
merchant is ours.

## What is real, what is mock

- **Live, in the main run:** the Airwallex sandbox calls and Metal testnet transactions above, the Claude decisions and
  the CFO's Face ID. Test money only. The sandbox simulates a SWIFT transfer's last steps (SENT, PAID), the merchant's
  card charge and the deposit that stands in for Metal earnings at Airwallex.
- **On Metal testnet, checked against the chain on 5 November:** the 4 mandates bound at setup that morning and the
  2 replacements; 86 test-USD payments, each its own transaction (41 sales, 41 supplier purchases, 3 refunds, 1 sweep);
  1 refusal recorded on chain (#24, [tx](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871)).
  No emulator and no clearing in this run. Not on Metal: the EUR licence (FX, SWIFT) and the card buy, on the Airwallex
  sandbox; the other 13 refusals (12 by the Sourcing agent's buy policy, #37 by Metal during the replace) are in the
  ledger, not on chain.
- **Run by us:** Summit Outfitters (the customer) and its agent, Stockline (the supplier), the TAP merchant.
- **Replayed:** Home, Watch and Proof on the hosted site, and `npm run judge` offline, play the main run's record.
- **Stand-ins:** the automated tests and the Scenario Lab (`/lab`) run on stand-ins for Airwallex, Metal and Anthropic.
- **Your own test world:** `/try/sign` (live since 4 November 2026) runs each visitor's world on stand-in executors with
  fixed proposals; your passkey's signature and the server's check of it are real.
- **Built, not yet live:** the Cardputer hub push and gate (a fake hub in the tests);
  the T:0 books sink (nothing posted: the shared sandbox key could not post, `403 CAPI71`; on 5 November T:0 refused
  its new read-write key, `401 CAPI11`, [record](docs/runs/2026-11-05-t0-live.md)); the emergency stop and `npm run smoke:sandbox`
  (on stand-ins).

**Other live tests (separate worlds, dated):** the TAP run (2 November), four eyes on chain, the compliance contract
and clearing under load (30 October): [docs/runs/](docs/runs/) and [docs/metal-award.md](docs/metal-award.md).

## Run it in 3 commands

Needs Node.js 22.13 or later (`engines` in [package.json](package.json)) and git; no keys, no network after `npm ci`.

```sh
npm ci            # install
npm test          # the full suite, on stand-ins
npm run judge     # the main run's replay, the CFO dashboard and the Scenario Lab, offline
```

**2299 tests in 245 files, all passing** (`npx vitest run`, 5 November); CI runs the same suite on
every push. Running it live (sandbox keys, a Metal RPC): [docs/run-it.md](docs/run-it.md).

## Words

- **Mandate:** an agent's on-chain spending permission on Metal: a cap per payment, a total budget, one payee, an end date.
- **x402:** HTTP 402 "Payment Required" as a protocol: each data query is paid on Metal before it is answered.
- **Terms hash:** the SHA-256 of a proposal's exact terms; the CFO's Face ID signs that hash, and nothing else runs.
- **Four eyes:** above the CFO's threshold, two approvers must each sign with their own passkey (in production two
  different people; in the main run the second was the labelled test passkey above); the proposer never approves.

## Links

- [docs/controls.md](docs/controls.md): every guard in code, its test, and what needs a person
- [docs/claims.md](docs/claims.md): every claim in this repo and its source
- [docs/metal-award.md](docs/metal-award.md) and [docs/airwallex.md](docs/airwallex.md): what Purser uses from each
- [docs/security.md](docs/security.md): threat model, attacks and what stops each one
- [docs/submission/README.md](docs/submission/README.md): the submission text
- [The Visa Award note](docs/submission/README.md#visa): what the organisers confirmed about our entry, and what is open

All money here is test money: the Airwallex sandbox and Metal testnet. Built with Claude (Anthropic) as the developer,
directed and reviewed by Max Geurtsen. Licence: MIT.

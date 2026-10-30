# Roadmap: from company cards for agents to the agent finance department

**Today:** every AI agent gets its own company card and on-chain mandate, with limits the CFO sets.
**Tomorrow:** a finance department of agents (payables, receivables, returns, payouts, treasury) that runs on its
own inside the CFO's policy, and asks for Face ID only for what is new, large or odd.

Nothing below is built unless it says so. What is built is in the README and `docs/requirements-matrix.md`.

## What stays the same at every step

- **The CFO keeps the pen.** Agents propose; code checks; only the CFO's passkey approves what is over a limit.
- **Limits live in the rails, not in a prompt.** The card issuer, the payout rail or the chain refuses what the
  policy does not allow, whatever an agent says.
- **Every movement of money has a proof and an approval** in a hash-chained audit log, coded to a GL account and a
  cost centre, and reconciled daily against Airwallex and the chain.

## Built today (hackathon, Northwind Outdoor)

| Agent | What it does | Rail |
|---|---|---|
| Operations agent | Buys live stock checks per request; pays the warehouse software on its card | Metal mandate (x402); Airwallex card |
| Sales agent | Pays for ads on its card (ads only); settles a retailer's claim with refunds | Airwallex card (MCC 7311); Metal mandate pull |
| Finance agent | Pays the manufacturer's euro invoice: buys only the euros missing, checks the market rate, pays by SWIFT | Airwallex FX and transfers |
| Outside agents | Any AI agent connects over MCP, asks for a card, pays within its limits, asks for more | Airwallex card |

## E-commerce: the next agents

| Use case | What the agent does | Controls the CFO sets | Rails |
|---|---|---|---|
| Advertising | Shifts ad budget between channels by return on ad spend | Card per channel, merchant category, monthly cap, stop when ROAS drops | Airwallex Issuing |
| Suppliers in many currencies | Pays approved suppliers in their own currency on the due date, at a checked rate | Allowlisted beneficiaries, rate markup ceiling, four eyes above a threshold | Airwallex FX, local and SWIFT payouts |
| Customer returns | Refunds a customer once the return is received and checked | Per-refund and per-day limits, refund only to the original payment, odd patterns escalate | Payment acceptance refunds (or a payout) |
| Influencer payouts | Pays creators per campaign, in their currency, after the post is live | Per-creator cap, contract on file, one payout per deliverable | Airwallex payouts to individuals |
| Logistics and customs | Pays freight forwarders and import duties to clear a shipment | Payee allowlist, amount within the quote, proof (bill of lading) attached | Airwallex payouts; card for small fees |
| SaaS and tools | Buys, upgrades and cancels software seats | Card per tool category, renewal alerts, unused seats flagged | Airwallex Issuing |
| Receivables | Chases unpaid invoices and matches incoming payments | Read-only on money in; write-offs need Face ID | Global accounts, deposits |

## Other sectors, same pattern

| Sector | First agents |
|---|---|
| Travel | Booking agent with a card per trip; per-diem limits; hotel and flight categories only |
| Procurement | Purchasing agent within approved catalogues and budgets; three quotes above a threshold |
| Agencies | A card per client campaign; spend re-billed to the client with the proof attached |
| Marketplaces | Seller payouts and refunds by agents, per connected account, with platform-level limits |

## Phases (after the hackathon)

1. **Finance view:** double-entry journal (debit equals credit), a Books screen with cash per currency, trial
   balance and spend per agent, one-click export. Planned right after the freeze.
2. **Returns and payouts:** the returns agent and creator payouts, on Airwallex products that fit (see below).
3. **More rails, one policy:** local payout rails, receiving in more currencies, and more chains through the same
   mandate model.
4. **Many companies:** connected accounts, so an accountant or a platform runs Purser for many small businesses.

## Airwallex products that fit next

Read-only research of Airwallex's official docs on 30 October 2026; nothing here is built. Paths are under
`https://www.airwallex.com/docs/`. The sandbox covers all products in the web app and API except the Connected
Account APIs (`developer-tools/sandbox-environment`). Estimates assume Purser's existing Airwallex client, port and
adapter layer, CFO policy, Face ID approvals, audit log and tests with fakes.

| Product | What it is | Agent use case for Northwind | Sandbox | Estimate |
|---|---|---|---|---|
| Global Accounts | Local or SWIFT receiving accounts in 20+ currencies, paying into the multi-currency wallet (`accounts/get-started/global-accounts`) | A receivables agent opens EUR and GBP accounts for retailers, matches deposits to invoices, flags short payments | Yes, `POST /simulation/deposit/create` | half a day (USD already done) |
| Payouts beyond SWIFT | `transfer_method: LOCAL` on local clearing, payouts to individuals, batch transfers of up to 1,000 items (`payouts/transfers/create-a-transfer`, `payouts/batch-transfers/create-a-batch-transfer`) | A creator agent pays influencers in their currency as one batch, one Face ID for the batch; a logistics agent pays a freight forwarder over SEPA or ACH | Yes, `POST /simulation/transfers/{id}/transition` | LOCAL and individuals 2 to 4 hours; batch with one approval 1 to 1.5 days |
| Payment acceptance and Payment Links | PaymentIntents track a payment from checkout to settlement; Payment Links are hosted links or QR codes, with cards and 30+ local methods (`payments/get-started/using-payments-intent-api`, `payments/integration-options/invoices-and-payment-links/payment-links`) | A sales agent sends a retailer a GBP Payment Link for a wholesale order; the CFO policy caps the discount it may give | Yes: hosted page and test cards; `POST /simulation/pa/shopper_actions/{pay,reject}` | Links about 1 day; intents with a checkout 1.5 to 2 days |
| Refunds | Back to the original payment only, partial refunds allowed up to the captured amount, blocked while a dispute is open (`payments/payment-operations/manage-payments/refunds`) | The returns agent refunds a customer within policy (for example up to EUR 150 and 30 days); larger or odd ones wait for Face ID | Yes; refund success and failure are listed test cases | half a day, once payment acceptance exists (a refund needs a paid payment) |
| Connected accounts | Sub-accounts under a platform, each with its own wallet and identity; calls on their behalf with `x-on-behalf-of` (`connected-accounts/about/about-connected-accounts`) | Purser as a platform: one sub-account per brand or client, the CFO approves moves between them | No by default ("contact Sales") | 2 to 3 days, plus getting access |
| Spend (bills and AP) | Vendors, purchase orders, bills and expenses through the API, with ERP sync (`spend/accounts-payable/bills-via-api`) | An AP agent turns a supplier invoice into a bill that Purser routes to approval | Not stated beyond the general sandbox line | about 1 day |

Also relevant: Airwallex's own AgentOS (`developer-tools/ai/agentos`) tells users to "require manual approval for
tool calls" by agents on a production account. That is the gap Purser fills: the approval is the CFO's passkey on
the exact terms, and the limits sit in the rails.

**Customer returns before the freeze?** No. A card refund needs a paid card payment first, so returns need payment
acceptance (about 1 day) plus refunds (half a day): more than half a day, and new money-moving code. The demo already
shows the same control on Metal: in S2 the three wrong stock checks are refunded within policy and the "refund
everything" request escalates to the CFO. The returns agent on Airwallex is the first item after the freeze, with
creator payouts over LOCAL rails.

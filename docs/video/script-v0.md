Superseded: the final film (2:42) uses an AI voice and AI music from ElevenLabs; see docs/video/README.md.

# Purser: video v0 (about 2:40), the three scenes from the idea

Version 0, 1 November. It follows the idea Max submitted before the shortlist (`entries/airwallex/idea.md` in
`rewardssystem`): **price rise → dispute → euro bill**, in that order. Everything else (Ask Purser, the Lab, Visa,
the month) stays out of the video and lives under "More" on the site.

What changed since the idea, and what the video shows: the three agents now **decide for themselves**, as Claude
agents with their own tools, inside the same limits; Metal and Airwallex enforce those limits, and the CFO signs only
what goes beyond them. The footage comes from Thursday's main run (5 November, test money, labelled). Until then, every
figure below is from the autonomous dry run **dry-103** (1 November) or the recorded run of 30 October, and each
**[number]** is replaced by Thursday's measured value before the cut.

At about 140 words a minute. Max speaks the opening and the close himself, on camera; the rest is voice-over.

## 0:00 Opening: Max (20 s, on camera)

> Hi, I'm Max Geurtsen, from the Netherlands. AI agents are starting to spend company money. So I built Purser:
> three Claude agents that run a small data business on their own, while Metal and Airwallex enforce the limits I
> set as the CFO. Here are three moments from one working day.

(51 words.)

## 0:20 The business in one breath (12 s; screen: the control tower)

Northwind Outdoor sells live stock data to retailers' agents, per query, over x402 on Metal. Three agents run it:
Sourcing buys the data, Support handles customers, Treasury manages the money.

## 0:32 Scene 1: the price rise (40 s; screen: the agents' chat, the refusal on chain, the phone)

Stockline raises its price from three cents to **[0.04]**. The Sourcing agent's next purchase is refused against its
mandate on chain: nothing moves, the customer is not charged. The agent decides on its own: it switches to Ridgeline
Data, which is inside its cap, and tells the Treasury agent. Treasury weighs the margin and **[keeps the mandates as
they are]**. If an agent wants more than its mandate, only the CFO can give it: two priced options, one Face ID, and
the mandates are replaced on chain.

## 1:12 Scene 2: the dispute (35 s; screen: the Dispute desk, the agent's trace)

Summit Outfitters disputes **[12]** orders: our agent never ordered this, refund everything. The Support agent checks
the evidence itself: every order signed by Summit's agent, every payment verified against its mandate on chain. Three
orders, **[#7, #10 and #13]**, had wrong stock data from the supplier, so it refunds those, **[0.15]** test USD, inside
its own mandate. "Refund everything" goes to the CFO, who rejects it with Face ID.

## 1:47 Scene 3: the euro bill (35 s; screen: the invoice, the plan, Airwallex)

Stockline's licence invoice arrives in euros: **[EUR 240.00]**. The Treasury agent plans it: there are euros enough at
Airwallex, so no conversion, SWIFT, and at most **[EUR 20.00]** in fees. One Face ID covers the amount, the payee and
the fee ceiling; Airwallex pays it. On the same day Packwise charges its renewal to the Sourcing agent's card: Airwallex
declines it over the card's limit, its webhook tells the agent, and the agent asks the CFO for a raise.

## 2:22 Why it holds (8 s; screen: the "Enforced by" panel)

The agents decide. Metal enforces the mandates on chain, Airwallex enforces the cards, and every decision has its proof.

## 2:30 Close: Max (15 s, on camera)

> That was one day: a price rise, a dispute and a euro bill. The agents decided; the rails held the limits; I only
> signed what went beyond them. Purser. Starter Kit 11, for the Metal Award.

(37 words.)

## Notes for the cut

- Every scene ends on its proof for two seconds: the Metal transaction, the Airwallex id, the Face ID verdict.
- Labels on screen: "Test money · Metal testnet · Airwallex sandbox"; for the dry-run footage also "dry run".
- The words "decided by Claude" appear only on decisions an agent made itself (the dashboard's label); a fallback
  decision by code is shown as such.
- The old video (2:53, `script.md`) stays as the recorded run's film until Thursday's cut replaces it.

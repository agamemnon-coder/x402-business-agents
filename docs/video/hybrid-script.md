# Purser: the hybrid video (3:55, and a 60-second cut)

The jury asks for a video walkthrough of a working demo, so this cut mixes four kinds of footage:
- **Max**: his own voice and face;
- **the animation**: `/live`, on rails;
- **the real product**, captured from the hosted pages;
- **the real proof**: Metal's explorer, the Airwallex sandbox web app and a real Face ID approval.

Every number below is from a recorded run or a cited source. Max reads every line in his own voice; nothing is a synthetic voice.

Footage legend: **[MAX]** Max on camera or voice only; **[LIVE]** `/live?present`; **[PAGE]** a product page captured in a browser at 1920×1080; **[PROOF]** an outside source on screen; **[PHONE]** Max's iPhone screen recording.

| Time | Footage | Words (Max) |
|---|---|---|
| 0:00 | [MAX] | I'm Max. *(One sentence on who you are.)* Last year, victims reported over three billion dollars in losses to the FBI from business email compromise: fake invoices and changed bank details. *(On screen: "FBI IC3, 2025 Internet Crime Report: $3,046,598,558".)* |
| 0:15 | [MAX] | Now AI agents read those emails, and pay those invoices. So who holds the pen? |
| 0:22 | [LIVE] title | Purser. Your AI agents spend through Airwallex and Metal. The CFO stays in control. |
| 0:30 | [LIVE] card | On Airwallex, each agent has its own company card. Over its limit, Airwallex itself declines it. The CFO raises the limit with Face ID, and the same purchase goes through. |
| 0:45 | [LIVE] refuse | On Metal, agents pay per request under mandates that live on chain. The supplier doubles its price: the payment bounces off the mandate. Nothing moves. |
| 0:58 | [LIVE] fx | A euro bill: only the missing euros are converted, one Face ID covers rate, payee and fee, and Airwallex pays it by SWIFT. |
| 1:10 | [PAGE] `/try` | You can try it yourself. Type a task: "Book a flight to Berlin, max 250 euros". Claude reads it, code checks it against the CFO's policy, and you see which rail it takes and why. |
| 1:30 | [PAGE] `/?recorded` rails section | This is the CFO dashboard from our recorded live run. Every line has its proof: an Airwallex id, or a Metal transaction. |
| 1:42 | [PAGE] `/metal` inspector | This is how Purser uses Metal. Each agent's mandate, as the chain enforces it: the cap, the budget, the one payee, and what the chain refused. |
| 1:57 | [PROOF] explorer: mandate replaced `0xbc70858f…b5d7` | And the proof is public: here is the mandate the CFO approved, replaced on Metal testnet. |
| 2:05 | [PAGE] `/metal#dispute` | A customer said: "our agent never ordered this". Northwind's Dispute desk checked each of the twelve orders: signed by their agent, inside their mandate on chain, data delivered. Twelve of twelve. Not refunded. |
| 2:22 | [PROOF] Airwallex sandbox web app (Max's recording) | In Airwallex's own app you see the same: the agents' cards, the decline, the conversion and the SWIFT transfer. |
| 2:37 | [PHONE] Face ID (Max's recording) | And this is the one thing an agent can never do: approve. The phone shows the exact terms. Face ID signs them. |
| 2:52 | [PAGE] `/?recorded&books` | Every payment lands in the books, debit and credit, ready for the bookkeeper. |
| 3:02 | [PAGE] `/lab`, then the landing's trust figures | Code decides; Claude only reads and advises. Our red team, with Claude Opus as the attacker, tried thirty-nine attacks: all blocked. Two people above a threshold, one Face ID freezes everything, and Claude costs about nine cents per thousand euros paid. |
| 3:28 | [MAX] | Agents will move money at machine speed. Purser lets them, on Airwallex and Metal, and keeps the CFO in control. |
| 3:42 | [PAGE] `/try` | Try it yourself. *(On screen: the link to /try.)* |
| 3:55 | end | |

About 470 words in 3:55, so about 120 words a minute: calm, with room to breathe.

Where each figure comes from:
- **$3,046,598,558:** FBI IC3, 2025 Internet Crime Report, published April 2026 (https://www.ic3.gov/AnnualReport/Reports/2025_ic3report.pdf), business email compromise losses.
- **The run:** the card, the price rise, the bill, twelve of twelve: the recorded run of 30 October (`docs/demo/`).
- **39 of 39:** `docs/redteam/report.json`.
- **About nine cents per thousand euros:** the recorded dashboard's Claude cost, $0.093 per €1,000.

What is simulated, said on screen where it shows:
- the merchants' charges and the SWIFT transfer's last steps are sandbox simulations;
- all money is test money.

## The 60-second cut

| Time | Footage | Words |
|---|---|---|
| 0:00 | [MAX] | Last year, victims reported three billion dollars in losses to the FBI from fake invoices and changed bank details. Now AI agents pay invoices. |
| 0:07 | [LIVE] title | Purser: your AI agents spend through Airwallex and Metal; the CFO stays in control. |
| 0:14 | [LIVE] card | Over its limit, Airwallex itself declines the agent's card. |
| 0:21 | [LIVE] refuse | On Metal, an overpriced payment bounces off the agent's mandate on chain. |
| 0:28 | [PHONE] Face ID | Only the CFO approves: exact terms, Face ID. |
| 0:36 | [PAGE] `/metal#dispute` | And every payment can be proven: twelve of twelve disputed orders, verified on chain. |
| 0:46 | [PAGE] `/try` | Try it yourself. |
| 0:52 | [MAX] | Purser. Agents move fast; the CFO keeps the pen. |

## Before it goes out

- A fresh jury review scores the cut against the hackathon's judging criteria and the patterns of winning demo videos, and we fix what it finds. `docs/video/winning-patterns.md` (named in the awards plan) is not in the repo yet; it is written before that review.
- 1080p, royalty-free music under the voice (quiet), English subtitles.
- Max uploads it unlisted.

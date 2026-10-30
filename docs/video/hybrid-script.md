# Purser: the hybrid video (4:10, and a 60-second cut)

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
| 0:15 | [MAX] | Now AI agents are starting to read those emails and pay those invoices. So who holds the pen? |
| 0:22 | [LIVE] title | Purser. Your AI agents spend through Airwallex and Metal. The CFO stays in control. |
| 0:30 | [LIVE] card | On Airwallex, each agent has its own company card. Over its limit, Airwallex itself declines it. The CFO raises the limit with Face ID, and the same purchase goes through. |
| 0:45 | [LIVE] refuse | On Metal, agents pay per request under mandates that live on chain. The supplier doubles its price: the payment bounces off the mandate. Nothing moves. |
| 0:58 | [LIVE] fx | A euro bill: only the euro shortfall is converted, one Face ID covers the rate, the payee and the most the fee may be, and Airwallex sends it by SWIFT; in the sandbox it is marked paid. |
| 1:10 | [PAGE] `/try` | You can try it yourself. Type a task: "Book a flight to Berlin, max 250 euros". Claude reads it, code checks it against the CFO's policy, and you see which rail it takes and why. |
| 1:30 | [PAGE] `/?recorded` rails section | This is the CFO dashboard from our recorded live run. Each payment line has its proof: an Airwallex id, or a Metal transaction. |
| 1:42 | [PAGE] `/metal` inspector | This is how Purser uses Metal. Each agent's mandate, as the chain enforces it: the cap, the budget, the one payee, and what the chain refused. |
| 1:57 | [PROOF] explorer: mandate replaced `0xbc70858f…b5d7` | And the proof is public: here is the mandate the CFO approved, replaced on Metal testnet. |
| 2:05 | [PAGE] `/metal#dispute` | A customer said: "our agent never ordered this". Northwind's Dispute desk checked each of the twelve orders: signed by their agent, inside their mandate on chain. Twelve of twelve. The claim is rejected; three of those orders had already been refunded that morning for wrong data, and nothing is refunded twice. |
| 2:22 | [PROOF] Airwallex sandbox web app (Max's recording) | In Airwallex's own app you see the same: the agents' cards, the decline, the conversion and the SWIFT transfer. *(Keep this line only if the recording shows the Friday run's cards •••• 8120, 6882, 7786 and transfer 4d508b0b.)* |
| 2:37 | [PHONE] Face ID (Max's recording) | And this is the one thing an agent can never do: approve. The phone shows the exact terms. Face ID signs them. |
| 2:52 | [PAGE] `/?recorded&books` | Every payment lands in the books, debit and credit, ready for the bookkeeper. |
| 3:02 | [PAGE] `/metal`, the four-eyes, compliance, certificate and clearing cards | For a bigger company, more control moves on chain. In a test run, one signature was not enough: the CFO and the controller both had to sign. A compliance contract paid only screened payees; eleven attacks failed. Each new payment keeps the finality certificate Metal reported. And in a second load test, after one fix, two thousand clearing payments all went through. |
| 3:26 | [PAGE] `/lab`, then the landing's trust figures | Code decides; Claude only reads and advises. Our red team ran thirty-nine attacks in a test world, thirty-five scripted and four written by Claude Opus as the attacker: all failed; two of them were found afterwards rather than stopped. One Face ID to freeze every card and stop every agent (tested on stand-ins), and Claude costs about nine cents per thousand euros paid. |
| 3:52 | [MAX] | Agents will move money at machine speed. Purser lets them, on Airwallex and Metal, and keeps the CFO in control. |
| 4:04 | [PAGE] `/try` | Try it yourself. *(On screen: the link to /try.)* |
| 4:10 | end | |

About 500 words in 4:10, so about 120 words a minute: calm, with room to breathe. The two busiest lines (3:02 and 3:26) run near 145 a minute.

Where each figure comes from:
- **$3,046,598,558:** FBI IC3, 2025 Internet Crime Report, published April 2026 (https://www.ic3.gov/AnnualReport/Reports/2025_ic3report.pdf), business email compromise losses.
- **The run:** the card, the price rise, the bill, twelve of twelve: the recorded run of 30 October (`docs/demo/`).
- **39 of 39 failed:** `docs/redteam/report.json` (37 stopped before anything moved, 2 found afterwards).
- **About nine cents per thousand euros:** the recorded dashboard's Claude cost, $0.093 per €1,000.

What is simulated, said on screen where it shows:
- the merchants' charges, the SWIFT transfer's last steps (SENT, PAID) and the deposit that books Metal earnings at Airwallex are sandbox simulations;
- the red team and the Scenario Lab run in throwaway test worlds;
- all money is test money.

## The 60-second cut

| Time | Footage | Words |
|---|---|---|
| 0:00 | [MAX] | Business email compromise cost victims over three billion dollars last year. Now AI agents pay invoices. |
| 0:07 | [LIVE] title | Purser: your AI agents spend through Airwallex and Metal; the CFO stays in control. |
| 0:14 | [LIVE] card | Over its limit, Airwallex itself declines the agent's card. |
| 0:21 | [LIVE] refuse | On Metal, an overpriced payment bounces off the agent's mandate on chain. |
| 0:28 | [PHONE] Face ID | Only the CFO approves: exact terms, Face ID. |
| 0:36 | [PAGE] `/metal#dispute` | And every order can be proven: twelve of twelve disputed orders, verified on chain. |
| 0:46 | [PAGE] `/try` | Try it yourself. |
| 0:52 | [MAX] | Purser. Agents move fast; the CFO keeps the pen. |

## Before it goes out

- A fresh jury review scores the cut against the hackathon's judging criteria and the patterns of winning demo videos, and we fix what it finds.
- 1080p, royalty-free music under the voice (quiet), English subtitles.
- Max uploads it unlisted.

# Purser: the hand-in film (4:38)

Made by `npm run cut -- handin-5` from src/film/cuts.ts. Spoken words: 501 at 150 a minute.

| Time | Shot | Narration | Caption | Claims |
|---|---|---|---|---|
| 0:00–0:20 | **M1** (placeholder: Max on camera: the opening (20 s, landscape)) | MAX-CAM: Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. A limit in a prompt is only a request. Here the agent proposes, the CFO signs, and the payment rails enforce it. | Max · Purser; Agents pay only within limits the CFO signs | C01 |
| 0:20–0:40 | D1a / T14 → T3 | VO: In the main run on 3 November, three Claude agents made 24 decisions. Past a limit, an agent only proposes. The CFO signs the exact terms. Airwallex and Metal each hold the limit again, on their own side. | Main run · 3 Nov · 24 decisions · USD 0.3170 | C22, C02, C19 |
| 0:40–1:22 | **P2a** (placeholder: Phone recording: /try, start a test company; Claude reads the invoice and the agents check it) → **P2b** (placeholder: Phone recording: /try, sign the exact terms with Face ID, paid on the simulated bank) → **P2c** (placeholder: Phone recording: /try, change one cent, refused) | VO: This is the hands-on demo, live: your own test company, gone after 24 hours, with test money on a simulated bank. An invoice for 1,850 euros comes in. Claude reads it, and Claude agents check it, code it and plan the payment. Purser's code holds every limit. The CFO signs the exact terms. Change one cent, and it is refused. | Claude reads; code holds the limits → The CFO signs the exact terms → One cent changed → refused + badge Simulated bank · test money | C44, C44c, C05 |
| 1:22–1:46 | F0 → F1 | VO: On Metal, the agent's limit now lives in a passkey account. The account checks the signatures itself, on chain: the CFO's passkey, on an iPhone with Face ID, and a second approver, here a labelled test passkey. | Two passkeys · checked on chain · 12 Nov → Second approver: a labelled test passkey + badge Metal testnet · test USD | C40 |
| 1:46–2:04 | F2 → F1b | VO: The agent paid 5 cents inside its mandate. Then 6 cents, over the cap: refused on chain. Both owners signed a higher cap, and the same 6 cents went through. | 0.06 over the 0.05 cap · refused on chain → Both owners signed · cap 0.10 · paid + badge Metal testnet · test USD | C40r |
| 2:04–2:16 | T9a | VO: On Airwallex, each agent has its own card. Airwallex itself declined a simulated 45 euro charge, over the limit. | LIMIT_EXCEEDED · card ····2441 · 7 Nov + badge Airwallex sandbox · test money | C12 |
| 2:16–2:42 | V4 → V4n | VO: Through Visa Intelligent Commerce and Airwallex's Airi, Claude chose the rail. A 12 euro purchase within the limit took one tap. A 45 euro purchase above it waited for Face ID, and the signed terms' hash sits in Airi's mandate and in Airwallex's payment record. A credential reused, or shown for another amount, was refused by Purser. | Visa via Airi · 13 Nov · hash read back → Reused credential → refused by Purser + badge Airi test card · test money | C48 |
| 2:42–3:09 | AF1 → D3 → T5f | VO: Two locks on one payout. On 13 November, Face ID on Max's own iPhone opened Purser's lock, and Airwallex's own approval workflow held the payout for a person. On 12 November, a payout signed with a test passkey waited there until the owner approved it in Airwallex. Then it was paid, with simulated settlement. | Max's own Face ID · held at Airwallex → Two locks · PAID 12 Nov · settlement simulated → Approved in Airwallex's web app · 12 Nov + badge Airwallex sandbox · test money | C47, C26, C41, C10 |
| 3:09–3:29 | B1 | VO: The books keep themselves. In a month of a test company's 20 invoices, Claude read each one live and chose its account, VAT code and cost centre. Code checked every choice before it was booked, and the books balance. | Coded by Claude · checked by code + badge Test company · test money | C43 |
| 3:29–3:49 | **S1** (placeholder: Screen recording: the test company's console (Overview, Invoices, Transactions, Books)) | VO: This is Purser Cloud's console for a test company: the overview, invoices, transactions and books. It reads and manages, and it never pays. Payments are approved on the CFO's phone with Face ID. | Purser Cloud · a test company + badge Test company · test money | C45 |
| 3:49–4:04 | PR1 | VO: Every line of this film has its record. The proof page lists what Purser guarantees, who enforces it, and the evidence. | — | C46 |
| 4:04–4:20 | AF1b | VO: What is not done: the payout Max approved with Face ID on 13 November still waits at Airwallex. The path to PAID ran on 12 November, with a test passkey. Settlement in the sandbox is simulated. | Held at Airwallex · not yet PAID + badge Airwallex sandbox · test money | C47, C41, C10 |
| 4:20–4:35 | **M2** (placeholder: Max on camera: the close (15 s, landscape)) | MAX-CAM: Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself. | — | C19, C34 |
| 4:35–4:38 | end card | —: — | — | — |

## Chapters (for the YouTube description)

0:00 The problem
0:20 Kit 11's core
0:40 Try it: your own test company
1:22 Face ID, checked on chain
1:46 Refused on chain
2:04 Airwallex: the card limit
2:16 Visa via Airi
2:42 Two locks on one payout
3:09 The books, coded by Claude
3:29 Purser Cloud
3:49 The proof
4:04 What is not done
4:20 Close

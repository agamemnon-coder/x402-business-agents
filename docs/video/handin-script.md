# Purser: the hand-in film (4:38)

Made by `npm run cut -- handin-5` from src/film/cuts.ts. Spoken words: 436 at 150 a minute.

| Time | Shot | Narration | Caption | Claims |
|---|---|---|---|---|
| 0:00–0:20 | **M1** (placeholder: Max on camera: the opening (20 s, landscape)) | MAX-CAM: Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. A limit in a prompt is only a request. Here the agent proposes, the CFO signs, and the payment rails enforce it. | Max · Purser; Agents pay only within limits the CFO signs | C01 |
| 0:20–0:42 | D1a / T14 → T3 | VO: In the main run on 3 November, three Claude agents made 24 decisions. Past a limit, an agent only proposes. The CFO signs the exact terms. Airwallex and Metal each hold the limit again, on their own side. | Main run · 3 Nov · 24 decisions · USD 0.3170 | C22, C02, C19 |
| 0:42–1:28 | **P2a** (placeholder: Phone recording: /try on purser-try, start a test company, the invoice is read and checked) → **P2b** (placeholder: Phone recording: /try, sign the exact terms with Face ID, paid on the simulated bank) → **P2c** (placeholder: Phone recording: /try, change one cent, refused) | VO: This is the hands-on demo: your own test company, gone after 24 hours, with test money on a simulated bank. An invoice for 1,850 euros comes in. The screen says who read it and what the checks found. The CFO signs the exact terms with Face ID. Change one cent, and it is refused. | Your own test company · 24 hours → The CFO signs the exact terms → One cent changed → refused + badge Simulated bank · test money | C44, C05 |
| 1:28–1:52 | F0 → F1 | VO: On Metal, the agent's limit now lives in a passkey account. The account checks the signatures itself, on chain: the CFO's passkey, on an iPhone with Face ID, and a second approver, here a labelled test passkey. | Two passkeys · checked on chain · 12 Nov → Second approver: a labelled test passkey + badge Metal testnet · test USD | C40 |
| 1:52–2:12 | F2 → F1b | VO: The agent paid 5 cents inside its mandate. Then 6 cents, over the cap: refused on chain. Both owners signed a higher cap, and the same 6 cents went through. | 0.06 over the 0.05 cap · refused on chain → Both owners signed · cap 0.10 · paid + badge Metal testnet · test USD | C40r |
| 2:12–2:24 | T9a | VO: On Airwallex, each agent has its own card. Airwallex itself declined a simulated 45 euro charge, over the limit. | LIMIT_EXCEEDED · card ····2441 · 7 Nov + badge Airwallex sandbox · test money | C12 |
| 2:24–2:42 | V3 | VO: Through Visa Intelligent Commerce and Airwallex's Airi, Claude chose the rail. A 45 euro purchase above the limit waited for Face ID. The signed terms' hash sits in Airi's mandate and in Airwallex's payment record. | Visa via Airi · 12 Nov · hash read back + badge Airi test card · test money | C42 |
| 2:42–3:03 | D3 → T5f | VO: Two locks on one payout. Purser's, signed with a test passkey, and Airwallex's own approval. The payout waited at Airwallex until the owner approved it there. Then it was paid, with simulated settlement. | Two locks · PAID 12 Nov · settlement simulated → Approved in Airwallex's web app · 12 Nov + badge Airwallex sandbox · test money | C26, C41, C10 |
| 3:03–3:26 | B1 | VO: The books keep themselves. For each test invoice, Claude's Coder agent chose the account, the VAT code and the cost centre, and wrote why. Code checks every choice before it is booked. | Coded by Claude · checked by code + badge Test company · test money | C43 |
| 3:26–3:48 | **S1** (placeholder: Screen recording: the test company's console (Overview, Invoices, Transactions, Books)) | VO: This is Purser Cloud's console for a test company: the overview, invoices, transactions and books. It reads and manages, and it never pays. Payments are approved on the CFO's phone with Face ID. | Purser Cloud · a test company + badge Test company · test money | C45 |
| 3:48–4:06 | PR1 | VO: Every line of this film has its record. The proof page lists what Purser guarantees, who enforces it, and the evidence. | — | C46 |
| 4:06–4:20 | V3n | VO: What is not done: in the Visa sandbox, a credential reused on a bigger payment was not refused. There, only Purser holds the limit. Settlement is simulated. | Sandbox did not refuse · only Purser held + badge Airi test card · test money | C42n, C10 |
| 4:20–4:35 | **M2** (placeholder: Max on camera: the close (15 s, landscape)) | MAX-CAM: Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself. | — | C19, C34 |
| 4:35–4:38 | end card | —: — | — | — |

## Chapters (for the YouTube description)

0:00 The problem
0:20 Kit 11's core
0:42 Try it: your own test company
1:28 Face ID, checked on chain
1:52 Refused on chain
2:12 Airwallex: the card limit
2:24 Visa via Airi
2:42 Two locks, then PAID
3:03 The books, coded by Claude
3:26 Purser Cloud
3:48 The proof
4:06 What is not done
4:20 Close

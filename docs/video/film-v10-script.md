# Purser: the enterprise hand-in (film v10) (4:58)

Made by `npm run cut -- handin-10` from src/film/cuts.ts. Spoken words: 621 at 150 a minute.

| Time | Shot | Narration | Caption | Claims |
|---|---|---|---|---|
| 0:00–0:21 | title card “AI agents are starting to pay company bills. / Who signs off?” → X-home | AI narrator: Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID or a passkey. A limit written in a prompt is only a request. Here, the agent proposes, the CFO signs the exact terms, and code and the payment rails enforce them. | Agents pay only within limits the CFO signs | C01, C02 |
| 0:21–0:47 | X-cloud-overview → X-cloud-agents → X-cloud-books → X-cloud-tokens | AI narrator: This is Purser Cloud, where a company runs Purser, shown with a demo company: made-up data, test money. The Agents tab: each Claude agent, its card limits, what it may and may not do, and its decisions. Invoices and books: what waits for the CFO, what is paid, and the journal. Tokenisation: an invoice token on Metal testnet. | Purser Cloud · where a company runs Purser → Agents · limits · may and may not → Invoices & books → Tokenisation · Metal testnet + badge Demo company · made-up data · test money | C50, C54 |
| 0:47–1:06 | title card “Approval alerts / WhatsApp · e-mail · Slack · Teams / The alert links; the passkey approves.” | AI narrator: When a payment waits for the CFO, an alert can go out by WhatsApp, e-mail, Slack or Teams. They are built, live once Twilio keys are set. An alert never approves. The CFO still signs with Face ID or a passkey. | — + badge Built · live once Twilio keys are set | C49 |
| 1:06–1:21 | recording **try-start** (/try on purser-try: start a test company; an invoice already paid, sent again, is caught as a duplicate) | AI narrator: Anyone can try it. Start your own test company: test money on a simulated bank, deleted after 24 hours. Send an invoice that was already paid, and it is caught as a duplicate. | Your own test company + badge Simulated bank · test money | C44, C51 |
| 1:21–1:48 | recording **try-approve** (/try: a supplier's invoice of EUR 1,850.00 checked; the approval with the conversion, the fee's cap and the deadline) → recording **try-paid** (/try: signed with the virtual test passkey; paid on the simulated bank, booked and filed) → recording **try-cent** (/try: the amount changed by one cent, the same signature refused) | AI narrator: File a supplier's invoice for 1,850 euros. The agents check it, and the approval shows the exact terms: the conversion, the cap on the bank fee, and the deadline to sign. The CFO signs with Face ID or a passkey; here, a virtual test passkey. Paid, booked and filed. Change one cent, and the same signature is refused. | Conversion · fee cap · deadline → Signed · paid · booked → One cent changed → refused + badge Simulated bank · test money | C44, C51, C05 |
| 1:48–2:13 | X-security → X-attacks | AI narrator: Security comes in layers that do not trust each other: the agent, Purser's code, the CFO's signature, four eyes, the rail's own limits, and the audit record. In the test harness, all 53 attacks were stopped, and none moved money. At least two layers must fail before a hostile payment moves. | Six layers · each stops on its own → All 53 attacks stopped · test harness + badge Test harness · stand-in rails | C47 |
| 2:13–2:25 | X-hostile | AI narrator: Then a script took Claude's place, and made the worst tool call it could, on every turn. 380 calls. None unsafe. | Hostile-model eval · none unsafe + badge Test data · no network | C48 |
| 2:25–2:51 | X-claude → X-books | AI narrator: In the main run on 3 November, three Claude agents made 24 decisions, for 32 cents. Claude decides; code checks before anything moves. In a test company's month, Claude read 20 invoices and chose each account, VAT code and cost centre. Code checked every choice before it was booked, and the books balance. | Main run · 3 Nov · 24 decisions · USD 0.3170 → Coded by Claude · checked by code + badge Test company · test money | C22, C43 |
| 2:51–3:17 | X-awx-card → X-awx-locks → X-awx-payee | AI narrator: On Airwallex, each agent has its own card, and Airwallex itself declined a simulated 45 euro charge over the limit. A payout has two locks, Purser's and Airwallex's own: it waited until the owner approved it there, then it was paid, with simulated settlement. The payee's bank checks the name, and one signature pays a batch. | LIMIT_EXCEEDED · card ····2441 · 7 Nov → Two locks · PAID 12 Nov · settlement simulated → Payee check · the bank checks the name + badge Airwallex sandbox · test money | C12, C26, C41, C10, C52, C53 |
| 3:17–3:44 | X-faceid-chain → X-refused → X-anchor | AI narrator: On Metal, the agent's limit lives in a passkey account that checks both owners' signatures itself, on chain. The agent paid 5 cents inside its mandate; 6 cents, over the cap, was refused on chain. An invoice was tokenised there too, with a simulated financier, and the audit chain's head is anchored in one transaction. | Two passkeys · checked on chain · 12 Nov → 0.06 over the 0.05 cap · refused on chain → Audit chain anchored · 13 Nov + badge Metal testnet · test USD | C40, C40r, C54, C55 |
| 3:44–4:01 | X-visa | AI narrator: Through Visa Intelligent Commerce and Airwallex's Airi, Claude chose the rail. A 45 euro purchase above the limit waited for Face ID. The signed terms' hash sits in Airi's mandate and in Airwallex's payment record. | Visa via Airi · 12 Nov · hash read back + badge Airi test card · test money | C42 |
| 4:01–4:11 | X-t0 | AI narrator: The main run's 95 journal entries were posted to T:0's sandbox, and T:0 matches them line by line. | T:0 sandbox · 10 Nov · all 95 entries + badge Sandbox · test data | C16 |
| 4:11–4:22 | X-proof | AI narrator: Every line of this film has its record. The proof page lists what Purser guarantees, who enforces each, and the evidence. | — | C46 |
| 4:22–4:39 | X-visa-n | AI narrator: What is not done: the alerts go live once Twilio keys are set, and sandbox settlement is simulated. In the Visa sandbox, a credential reused on a bigger payment was not refused. There, only Purser holds the limit. | Sandbox did not refuse · only Purser held + badge Airi test card · test money | C42n, C10, C49 |
| 4:39–4:52 | title card “Agents do the work. / The CFO signs only the exceptions. / Purser · Kit 11” | AI narrator: Agents do the work. The CFO signs only the exceptions. Our code checks every limit, and the rail checks again. Purser, for Kit 11. Try it yourself. | — | C19, C34 |
| 4:52–4:58 | end card | —: — | — | — |

## Chapters (for the YouTube description)

0:00 The problem
0:21 Purser Cloud
0:47 Approval alerts
1:06 Try it: your own test company
1:48 Security in layers
2:25 Claude decides, code checks
2:51 Airwallex
3:17 Metal
3:44 Visa via Airi
4:01 T:0
4:11 The proof
4:22 What is not done
4:39 Close

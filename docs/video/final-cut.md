# Purser: the final cut (target 2:55)

The hybrid script ([hybrid-script.md](hybrid-script.md)) runs 4:10. This cut keeps its strongest beats and drops the
rest, so a juror sees one blocked payment, one approval and the real ids inside three minutes. Every figure is from the
recorded Friday run 1 ([run log](../runs/2026-10-30-friday-1.md)) or a cited source; Max reads every line in his own
voice.

Footage legend: **[MAX]** Max on camera or voice only; **[HOOK]** an AI-generated opening shot, labelled
"AI-generated" on screen, with no logos or brand marks; **[LIVE]** `/live?present`; **[PAGE]** a product page captured
at 1920×1080; **[PROOF]** an outside source on screen; **[PHONE]** Max's iPhone screen recording.

| Time | Footage | Words (Max) |
|---|---|---|
| 0:00 | [HOOK] money moving between cities at machine speed; corner label "AI-generated" | AI agents are starting to pay invoices. Last year, business email compromise cost victims over three billion dollars. *(On screen: "FBI IC3, 2025 Internet Crime Report".)* |
| 0:10 | [MAX] | So when an agent spends company money, who holds the pen? |
| 0:16 | [LIVE] title | Purser. Your AI agents spend through Airwallex and Metal. The CFO stays in control. |
| 0:24 | [LIVE] card | Each agent has its own Airwallex company card. Over its limit, Airwallex itself declines it. |
| 0:34 | [LIVE] refuse | On Metal, each agent pays under a mandate that lives on chain. The supplier doubles its price, and the payment bounces off the mandate. Nothing moves. |
| 0:48 | [PHONE] the approval page with the exact terms, then Face ID | Now the agent needs more. It cannot approve itself. The CFO sees the exact terms on the phone, and Face ID signs them. |
| 1:08 | [LIVE] fx | A euro invoice: only the shortfall is converted, three hundred and seventy euros, and Airwallex sends it by SWIFT after one Face ID. |
| 1:20 | [PAGE] the README's proof table | And this ran for real, in the Airwallex sandbox and on Metal testnet. The conversion id and the transfer id are in the README. |
| 1:32 | [PROOF] explorer: mandate replaced `0xbc70858f…b5d7` | Here is the mandate the CFO approved, replaced on Metal testnet. Public, for anyone to check. |
| 1:42 | [PAGE] `/metal#dispute` | A customer said: "our agent never ordered this". The Dispute desk checked each of the twelve orders against its signature and the mandate on chain. Twelve of twelve hold, and nothing is refunded twice. |
| 2:00 | [PAGE] `/try` | You can try it yourself. Type a task: "book a flight to Berlin, at most 250 euros". Claude reads it, and you see which rail it takes and why. |
| 2:16 | [PAGE] the terminal running `npm run verify-log` | Every step lands in a hash-chained audit log. A juror can recompute it with no keys. |
| 2:26 | [PAGE] `/lab`, then the landing's trust figures | Claude agents read, plan and advise; Metal and Airwallex enforce the limits. Thirty-nine attacks in a test world, all failed. |
| 2:38 | [PAGE] the README's "real and simulated" paragraph | What is real: the sandbox and testnet calls, with test money. What is simulated: the merchants, the last SWIFT steps, and our test customer. |
| 2:48 | [MAX], then [PAGE] `/try` | Agents will move money at machine speed. Purser keeps the CFO in control. |
| 2:55 | end | |

About 330 words in 2:55, so about 115 words a minute: calm, with room to breathe.

Where each figure comes from:
- **Over three billion dollars:** FBI IC3, 2025 Internet Crime Report, business email compromise losses
  (https://www.ic3.gov/AnnualReport/Reports/2025_ic3report.pdf).
- **The card decline, the price rise, the euro invoice, twelve of twelve:** Friday run 1, 30 October 2026.
- **Conversion and transfer ids:** `08736b6e-0f62-41f8-9e4c-6f5a8cbff3c7` and `4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4`,
  read back read-only in [docs/data-qa.md](../data-qa.md).
- **Thirty-nine attacks:** `docs/redteam/report.json` (37 stopped before anything moved, 2 found afterwards).

## Recording checklist

- Laptop: 1920×1080, browser zoom 110 %, notifications off, a clean browser profile with no bookmarks or accounts.
- Phone: screen recording of one real Face ID approval; Do Not Disturb on.
- Nothing secret on screen: no API keys, e-mail addresses, account numbers or the Metal RPC endpoint.
- The AI-generated hook is labelled on screen and carries no logos; everything after it is the real product.
- English subtitles, quiet royalty-free music under the voice, under 3:00; uploaded to YouTube as unlisted.

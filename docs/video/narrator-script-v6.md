# Purser: the narrator script (film v6, 2:59)

**Current.** Film v6 is the submission film (7 November): v5 (2:42, [narrator-script.md](narrator-script.md)) trimmed,
the hook made accurate, the mock of /try/sign replaced by a recording of the live page, and two scenes for the live runs
of 7 November (awx-1 on Airwallex alone; the Airi run, Visa Intelligent Commerce via Airwallex's Airi).

The final film's voice-over: an AI-generated voice (ElevenLabs), the narrator, speaking in the third person. The music
is AI-generated too (ElevenLabs). The end card credits both: “Voice-over: an AI-generated voice (ElevenLabs) · Music:
AI-generated (ElevenLabs)”. Nobody records a voice for the film.

`src/film/premiere.ts` reads the lines below word for word (the "Line" column), checks every figure in them against
the records (`docs/demo/main-run.json`, `docs/demo/airwallex-run.json`, `docs/demo/airi-run.json`, and what the
recorded page showed, `docs/video/recording-trysign-v6.json`) and stops the build when one differs; it then times each
line in its scene and writes [script.md](script.md), [premiere-script.md](premiere-script.md), `subtitles-v6.srt` and
[elevenlabs-studio-prompt-v6.md](elevenlabs-studio-prompt-v6.md) (`npm run video -- --docs`). "…" marks a pause of
about half a second; it is timing, not a word ("… …" is the second of silence before “One cent. Worthless.”). "~Xs" is
the length at a calm pace, about 2.5 words a second.

| Scene | Picture (s) | Line | ~Length |
|---|---|---|---|
| 01-hook | Black, then "So who signs off?" (6) | AI agents are starting to spend money. … So who signs off? | 4.5 s |
| 02-purser | The Purser wordmark (4) | This is Purser, built by Max Geurtsen. | 3 s |
| 03-agents | The three agent cards (10) | Three Claude agents run a small company that sells live stock data. Each has its own Airwallex card, and its own Metal mandate. | 9 s |
| 04-how | How Purser works (8) | Inside its limits, an agent pays alone. Beyond them, nothing moves until the CFO signs the exact terms. | 7 s |
| 05-price | 0.02 → 0.04, "Metal refused it" (14) | Our data supplier doubles its price, from two to four cents a stock check, past the three-cent cap on the Sourcing agent's mandate. We let one purchase through on purpose. … Metal refused it, and the refusal is on chain. | 13 s |
| 05b-treasury | Treasury's two options, the CFO picks one (8) | Treasury proposes two ways to stay within the same twenty dollars. The CFO picks one, with Face ID. | 7 s |
| 06-metal | 86 payments on Metal (6) | Eighty-six Metal payments in this run, each its own transaction on testnet. No emulator. | 5.5 s |
| 07-dispute | The dispute, 12 orders (10) | Then a customer disputes twelve orders, all signed by its own agent. Only the three with wrong data are refunded. | 8 s |
| 08-faceid | The phone, Face ID (8) | Anything beyond the limits goes to the CFO's phone. The CFO reads the exact terms, and signs with Face ID. | 8 s |
| 09-six | "6 seconds from Face ID to PAID" (9) | Six seconds later, Airwallex pays the euro invoice by SWIFT, in its sandbox. Every I.D. is published. | 7 s |
| 11-turn | The live /try/sign page, recorded (13) | Now it's your turn, on the live page. Claude Sonnet reads the invoice, Claude Opus advises, and you sign with Face ID. Then try to cheat. | 10.5 s |
| 12-tamper | EUR 1,850.01 (6) | Change one cent, and the same signature is refused. … … One cent. Worthless. | 5 s + 1 s silence |
| 13-proof | 24/24, then the stops (12) | All twenty-four decisions by Claude. Sixteen stops, nothing paid over a limit: twelve skipped by Claude, two refused by Metal, one rejected by the CFO, and one planted instruction ignored. | 12 s |
| 13b-awx | Airwallex declines, awx-1 (12) | Airwallex itself declined two charges: one over the limit, one in the wrong category. The agent asked the CFO for a raise, not a retry. | 10 s |
| 13c-airi | Visa Intelligent Commerce via Airi (14) | With Airwallex's Airi, agents paid with a single-use Visa credential: alone within the limit, above it only after the CFO's Face ID. Terms changed after that Face ID were refused before Airi was asked. | 13 s |
| 13d-value | "The agents do the work. The CFO signs only the exceptions." (4) | The agents do the work. The CFO signs only the exceptions. | 4 s |
| 14-real | What's real, what's ours (11) | Real: the Airwallex sandbox, Metal testnet, Claude, Face ID, and Airi with a test card. Ours or simulated: the suppliers, the customer, the merchant, and a test second approver. | 10 s |
| 15-close | The ending, the wordmark (13) | A price shock, a dispute, a euro bill. … Claude decided, Airwallex and Metal held the limits, and the CFO signed only what went beyond them. … Purser. Starter Kit 11. | 11 s |

16-end has no voice. About two and a half minutes of speech in a film of 2:59: room to breathe, and music between the
lines.

## The figures it says

Each is its record's, checked by `src/film/premiere.ts` (`test/premiere.test.ts` changes one and expects the build to
stop): three agents (03); doubles, past the cap (05); twenty dollars (05b); eighty-six Metal payments (06); twelve
orders, three refunded (07); six seconds (09); twenty-four decisions, sixteen stops, twelve, two, one and one (13), all
the main run's; two charges declined by Airwallex, over the limit and in the wrong category, and the raise asked
instead of a retry (13b, awx-1's record); the single-use Visa credential, the purchase alone within the limit, the one
above it after Face ID and the merchant refused before Airi was asked (13c, the Airi run's record); Claude Sonnet reading
and Claude Opus advising (11), only because the recorded page labelled them live.

## What changed since v5, and why (7 November)

- **01-hook:** “AI agents are starting to spend money.” (was “AI agents can now spend money.”): accuracy.
- **11-turn:** the labelled mock of /try/sign is gone; the scene is a walk of the live page, recorded once in headless
  Chromium with a virtual authenticator, cut to its steps and labelled “Recorded from the live page · test world · test
  money”. The line says what the page showed: the reader (Claude Sonnet) and the advice (Claude Opus), both labelled
  live by the page; then “Then try to cheat.”, which 12-tamper answers.
- **13b-awx, 13c-airi (new):** the two live runs of 7 November, each from its own record. 13c is the Visa angle: a
  single-use Visa credential from Airwallex's Airi. On screen, Max's words: the heading “Visa Intelligent Commerce via
  Airwallex's Airi: a live run (7 Nov)” and its line; the rows also say that Airi asked for one passkey tap on each
  purchase, as the record has it.
- **13-proof:** the main run is named on screen, since other runs follow.
- **Trimmed to 2:59:** 05 (11 s), 06 (6 s, the line shorter), 07 (9 s), 09 (9 s), 10 (8 s, the line shorter), 12 (6 s),
  13 (12 s), 14 (8 s, “Test money only.” left to the labels), 16 (11 s). 13b-value is now 13d-value.

## Sources

The main run of 3 November (`docs/runs/2026-11-03-main-run.md`, `docs/demo/main-run.json`); awx-1 of 7 November
(`docs/demo/airwallex-run.json`); the Airi run of 7 November (`docs/runs/2026-11-07-vic-1.md`,
`docs/demo/airi-run.json`); the recorded walk of /try/sign (`docs/video/recording-trysign-v6.json`,
`src/cli/recordTrySign.ts`); `docs/claims.md` (the second approver; Face ID and the passkey; the end card).

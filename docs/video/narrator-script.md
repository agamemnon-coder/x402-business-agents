# Purser: the narrator script (film v5, 2:42)

The final film's voice-over: an AI-generated voice (ElevenLabs), the narrator, speaking in the third person. The music
is AI-generated too (ElevenLabs). The end card credits both: “Voice-over: an AI-generated voice (ElevenLabs) · Music:
AI-generated (ElevenLabs)”. Nobody records a voice for the film.

`src/film/premiere.ts` reads the lines below word for word (the "Line" column), checks every figure in them against
the run's record (`docs/demo/main-run.json`) and stops the build when one differs; it then times each line in its
scene and writes [script.md](script.md), [premiere-script.md](premiere-script.md) and `subtitles-v5.srt`
(`npm run video -- --docs`). "…" marks a pause of about half a second; it is timing, not a word ("… …" is the second
of silence before “One cent. Worthless.”). "~Xs" is the length at a calm pace, about 2.5 words a second.

| Scene | Picture (s) | Line | ~Length |
|---|---|---|---|
| 01-hook | Black, then "So who signs off?" (6) | AI agents can now spend money. … So who signs off? | 4 s |
| 02-purser | The Purser wordmark (4) | This is Purser, built by Max Geurtsen. | 3 s |
| 03-agents | The three agent cards (10) | Three Claude agents run a small company that sells live stock data. Each has its own Airwallex card, and its own Metal mandate. | 9 s |
| 04-how | How Purser works (8) | Inside its limits, an agent pays alone. Beyond them, nothing moves until the CFO signs the exact terms. | 7 s |
| 05-price | 0.02 → 0.04, "Metal refused it" (12) | Our supplier doubles its price, past the Sourcing agent's cap. We let one purchase through on purpose. … Metal refused it, and the refusal is on chain. | 10 s |
| 05b-treasury | Treasury's two options, the CFO picks one (8) | Treasury proposes two ways to stay within the same twenty dollars. The CFO picks one, with Face ID. | 7 s |
| 06-metal | 86 payments on Metal (8) | Every Metal payment in this run is its own transaction on testnet. Eighty-six of them. No emulator. | 6 s |
| 07-dispute | The dispute, 12 orders (10) | Then a customer disputes twelve orders, all signed by its own agent. Only the three with wrong data are refunded. | 8 s |
| 08-faceid | The phone, Face ID (8) | Anything beyond the limits goes to the CFO's phone. The CFO reads the exact terms, and signs with Face ID. | 8 s |
| 09-six | "6 seconds from Face ID to PAID" (10) | Six seconds later, Airwallex pays the euro invoice by SWIFT, in its sandbox. Every I.D. is published. | 7 s |
| 10-why | "Why Face ID, not a password?" (10) | Why Face ID, and not a password? A password is the same for every payment. The passkey signs the hash of these exact terms. | 10 s |
| 11-turn | "Your turn" (7) | Now it's your turn. Open your own test world, make a passkey, and sign. | 5 s |
| 12-tamper | EUR 1,850.01 (8) | Change one cent, and the same signature is refused. … … One cent. Worthless. | 5 s + 1 s silence |
| 13-proof | 24/24, then the stops (13) | All twenty-four decisions by Claude. Sixteen stops, nothing paid over a limit: twelve skipped by Claude, two refused by Metal, one rejected by the CFO, and one planted instruction ignored. | 12 s |
| 13b-value | "The agents do the work. The CFO signs only the exceptions." (4) | The agents do the work. The CFO signs only the exceptions. | 4 s |
| 14-real | What's real, what's ours (10) | Real: the Airwallex sandbox, Metal testnet, Claude and Face ID. Ours: the customer, the supplier, and a test second approver. Test money only. | 9 s |
| 15-close | The ending, the wordmark (13) | A price shock, a dispute, a euro bill. … Claude decided, Airwallex and Metal held the limits, and the CFO signed only what went beyond them. … Purser. Starter Kit 11. | 11 s |

16-end has no voice. About two minutes of speech in a film of 2:42: room to breathe, and music between the lines.

## The figures it says

Each is the record's, checked by `src/film/premiere.ts` (`test/premiere.test.ts` changes one and expects the build to
stop): three agents (03); doubles, past the cap (05); twenty dollars (05b); eighty-six Metal payments (06); twelve
orders, three refunded (07); six seconds (09); twenty-four decisions, sixteen stops, twelve, two, one and one (13).

## What changed, and why

- **5 November, the final film:** the voice-over is an AI-generated voice (ElevenLabs), with AI-generated music
  (ElevenLabs). The narrator speaks in the third person: “This is Purser, built by Max Geurtsen.” (was “I'm Max
  Geurtsen, and this is Purser.”); “the CFO signs”, “the CFO picks one”, “goes to the CFO's phone. The CFO reads”, “The
  passkey signs”, “The CFO signs only the exceptions” (each was “I” or “my”). 03-agents gains a comma.
- **06-metal:** “Every Metal payment”, not “every payment”: the euro FX, the SWIFT payment and the card buys ran on
  Airwallex. The 86 are the Metal payments, each with its own transaction.
- **09-six:** “Airwallex pays the euro invoice by SWIFT, in its sandbox”: who pays, said; “I.D.” so the voice says the
  letters. The screen keeps its label “In the sandbox, the settlement is simulated.”
- **10-why:** the passkey signs; Face ID unlocks it (what /try/sign and the claims say).
- **13-proof:** all the run's stops, as every page says them (`snapshot.counts.blocked` and its refusal rows;
  `proof.over_limit_eur`).
- **14-real:** “a test second approver”: the second approver in the run was a labelled test passkey.
- **15-close:** “Airwallex and Metal held the limits, and the CFO signed”: the partners hold the limits.

## Sources

The main run of 3 November (`docs/runs/2026-11-03-main-run.md`, `docs/demo/main-run.json`); the Metal check in PR #23
(86 payments, each its own tx; 6 mandate tx; the refusal of #24); `docs/claims.md` (the second approver; Face ID and
the passkey; the end card).

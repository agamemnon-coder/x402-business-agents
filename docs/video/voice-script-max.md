# Purser: voice-over script for Max (film v5)

Record each line as its own file, with the file name shown (01-hook.m4a, 02-purser.m4a, …).
iPhone Voice Memos, a quiet room with soft furniture, phone 15–20 cm from your mouth, slightly below your chin.
Speak calm and a little slower than normal. Leave one second of silence before and after each line.
A slip of the tongue? Just say that line again in the same file; we cut out the best take.
"~Xs" is the target length at a calm pace (about 2.5 words a second). Short is fine; too long is not.
"…" is a short pause (about half a second).

| File | Scene (s) | Line (say exactly this) | ~Length |
|---|---|---|---|
| 01-hook | Black, then "So who signs off?" (6) | AI agents can now spend money. … So who signs off? | 4 s |
| 02-purser | The Purser wordmark (4) | I'm Max Geurtsen, and this is Purser. | 3 s |
| 03-agents | The three agent cards (10) | Three Claude agents run a small company that sells live stock data. Each has its own Airwallex card and its own Metal mandate. | 8 s |
| 04-how | How Purser works (8) | Inside its limits, an agent pays alone. Beyond them, nothing moves until I sign the exact terms. | 6 s |
| 05-price | 0.02 → 0.04, "Metal refused it" (12) | Our supplier doubles its price, past the Sourcing agent's cap. We let one purchase through on purpose. … Metal refused it, and the refusal is on chain. | 10 s |
| 05b-treasury | Treasury's two options, Max picks one (8) | Treasury proposes two ways to stay within the same twenty dollars. I pick one, with Face ID. | 6 s |
| 06-metal | 86 payments on Metal (8) | Every Metal payment in this run is its own transaction on testnet. Eighty-six of them. No emulator. | 6 s |
| 07-dispute | The dispute, 12 orders (10) | Then a customer disputes twelve orders, all signed by its own agent. Only the three with wrong data are refunded. | 7 s |
| 08-faceid | The phone, Face ID (8) | Anything beyond the limits comes to my phone. I read the exact terms, and sign with Face ID. | 6 s |
| 09-six | "6 seconds from Face ID to PAID" (10) | Six seconds later, the euro invoice is paid by SWIFT, in the Airwallex sandbox. Every id is published. | 7 s |
| 10-why | "Why Face ID, not a password?" (10) | Why Face ID, and not a password? A password is the same for every payment. My passkey signs the hash of these exact terms. | 8 s |
| 11-turn | "Your turn" (7) | Now it's your turn. Open your own test world, make a passkey, and sign. | 5 s |
| 12-tamper | EUR 1,850.01 (8) | Change one cent, and the same signature is refused. … … One cent. Worthless. | 5 s + 1 s silence |
| 13-proof | 24/24, the stops, the tests (13) | Twenty-four of twenty-four decisions by Claude. Metal refused one purchase over its cap, and I rejected one proposal. Every test passes, and every step sits in a hash-chained audit log. | 11 s |
| 13b-value | "The agents do the work. The CFO signs only the exceptions." (4) | The agents do the work. I sign only the exceptions. | 3 s |
| 14-real | What's real, what's ours (10) | Real: the Airwallex sandbox, Metal testnet, Claude and Face ID. Ours: the customer, the supplier, and a test second approver. Test money only. | 8 s |
| 15-close | Max on camera (13) | A price shock, a dispute, a euro bill. … Claude decided, the rails and the code held the limits, and I signed only what went beyond them. … Purser. Starter Kit 11. | 11 s |

About 2:00 of speech in a film of about 2:50: room to breathe, and music between the lines.

## What changed from the draft, and why

- **04-how:** "a person signs" → "I sign": Max plays the CFO, and it is shorter.
- **06-metal:** "Every payment in this run" → "Every Metal payment in this run". The euro FX and SWIFT and the card buy ran on
  Airwallex, not Metal, so "every payment" would be wrong. The 86 are the Metal payments, each with its own tx.
- **07-dispute:** two sentences into one ("…twelve orders, all signed by its own agent"): two seconds shorter, the same
  facts.
- **09-six:** "a euro invoice" → "the euro invoice", "on our proof page" dropped (the screen shows /proof). The screen
  keeps its label "In the sandbox, the settlement is simulated."
- **10-why:** "Face ID signs the hash" → "My passkey signs the hash": the passkey signs; Face ID unlocks it (what
  /try/sign and the claims say).
- **11-turn:** "make your own passkey" → "make a passkey": shorter.
- **12-tamper:** the "…" before "One cent. Worthless." is the one second of silence the scene keeps.
- **13-proof:** "Every step is tested" → "Every test passes, and every step sits in a hash-chained audit log": no claim
  that every step is tested, and the audit log's real property (hash-chained, `npm run verify`).
- **14-real:** adds "a test second approver". The second approver in the run was a labelled test passkey, and the
  honesty rule says so wherever "what is ours" is listed. "What's real / what's ours" → "Real / Ours": shorter.

- **05b-treasury (new):** the record's two options, P-0002 (A: Sourcing's cap to 0.04, our price stays 0.05) and P-0003
  (B: our price to 0.07), both within 20.00. Max signed P-0002 with Face ID; the screen also shows, small, that a
  labelled test passkey co-signed it (four eyes), because that is what the run did.
- **13b-value (new):** on screen Max's line "The agents do the work. The CFO signs only the exceptions."; spoken as "I sign
  only the exceptions", because Max plays the CFO and 4 s is short.

## 15-close on camera

Phone at eye height, about 1 m away, daylight from the front, a calm background (the white wall works), landscape,
1080p. Look into the lens, not at the screen.

## Sources

The main run of 3 November (`docs/runs/2026-11-03-main-run.md`, `docs/demo/main-run.json`); the Metal check in PR #23
(86 payments, each its own tx; 6 mandate tx; the refusal of #24); `docs/claims.md` (the second approver; Face ID and
the passkey); `docs/video-script.md`.

# Video script: Purser in 3:00 or less

One run only: the main run of 3 November 2026 (11:15–11:37 UTC, commit `35e1cac`). Every line below is something
that really happened in it, with its real id, or something the repository really does today. The source of each fact is
in [Facts and their sources](#facts-and-their-sources). Test money throughout: the Airwallex sandbox and Metal testnet.
The screen scenes are the hosted site's Watch tab (`/watch`), which replays the main run; never `/?recorded` (that is
the 30 October recording).

| Time | Picture | Voice-over (English, short) |
|---|---|---|
| 0:00–0:22 | **Max on camera** (the opening from [docs/video/max-opening-close.md](video/max-opening-close.md), adapted). Caption: "Max Geurtsen · Purser · Starter Kit 11". | "Hi, I'm Max Geurtsen. This is Purser, Starter Kit 11, entered for the Metal and Visa Awards. My agents run a business, and Claude handles the exceptions: a price shock, a dispute, a euro bill. Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; I approve anything beyond them." |
| 0:22–0:35 | `/watch`, at the start: the stage with the three agents (Sourcing on Haiku, Support on Sonnet, Treasury on Opus) and the label "Replay of the main run, 3 Nov 11:16–11:33 UTC · test money · real Claude decisions". | "One live run, on 3 November. Three Claude agents, each with its own Airwallex card and its own Metal mandate, 20 test dollars between them." |
| 0:35–1:05 | `/watch?scene=1`, the price rise: Stockline 0.02 → 0.04, "Metal refused it · on chain"; then the refusal's transaction on the Metal testnet explorer (tx `0x2e92f9cb…1871`, 11:23:33 UTC); then Treasury's two options. | "The supplier doubled its price, to 0.04. The Sourcing agent's mandate allows 0.03 a purchase. Purser normally refuses before it signs; in this run we let one purchase through on purpose, and Metal itself refused it, on chain. Forty seconds later the Treasury agent proposed new budgets, within the same 20." On screen at the end of the shot, the line "2 stopped at a limit" (Metal 1, the CFO 1), and directly below it, smaller and labelled: "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November". |
| 1:05–1:30 | The phone: the approval page with its summary card (option, amount, recipient, expiry, check, terms hash), "Confirm with Face ID", Face ID, then "Done". Recorded separately. Caption: "Re-recorded on a test world, test money; in the main run Max signed P-0002 at 11:26:28 UTC." Then `/watch` at "2 of 2 signatures" and the two mandates replaced on chain. | "Anything beyond the limits waits for the CFO. I see one card: what, how much, to whom, and the hash of the exact terms. Face ID signs that hash. Above my threshold a second approver signs too; in this demo that is a labelled test passkey. Both mandates were replaced on chain 31 seconds after my tap." |
| 1:30–1:52 | `/watch?scene=2`, the dispute: the 12 order chips (#5 to #16), the 3 with wrong data turning to "refunded" (#7, #10, #13, each with its tx), then "CFO rejects the rest". | "Then a customer disputed 12 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Three orders had wrong data: the Support agent refunded those three itself, 0.15 test dollars. 'Refund the other nine' came to me, and I rejected it with Face ID." |
| 1:52–2:20 | `/watch?scene=3`, earnings and euros: 0.69 swept after finality; EUR 110.00 bought by FX for the shortfall (conversion `3ca88196…4636`); the €240 licence PAID by SWIFT 6 s after Face ID (transfer `03360bfa…3985`); the €45 card buy signed with Visa TAP, approved by Airwallex after the CFO raised the card's limit. | "The Treasury agent planned the 240-euro licence itself. After my Face ID it bought only the missing euros, and Airwallex paid by SWIFT six seconds later. And when the Sourcing agent needed a 45-euro tool, it asked for a higher card limit first, I approved, and Airwallex approved the purchase." |
| 2:20–2:35 | A terminal: `npm run verify` on the main run's ledger, every check passing, the audit chain recomputed from its genesis hash. Then `/proof` scrolled once: every id from the run. | "Anyone can check it afterwards: npm run verify recomputes the hash-chained audit log and every passkey signature, offline. Every id is on the Proof page." |
| 2:35–2:50 | **After deploy only: `/try/sign`.** On a phone, `/try/sign` (label at the top: "Test world · test passkey · nothing real moves") creates a passkey of the viewer's own, signs the waiting test proposal with Face ID, shows "Verified by the server" and "Executed in your test world", then "Try to tamper" and the same signature refused. Caption: "Your own test world and test passkey; nothing real moves." Record it only once the relay is redeployed with `TRY_SIGN_ENABLED=on`; until then cut this scene, and the closing starts at 2:35. | "Try it yourself: create your own passkey and sign." |
| 2:50–3:00 | **Max on camera**, the closing (adapted). | "A price shock, a dispute, a euro bill. Claude decided, the rails and the code held the limits, and I signed only what went beyond them. Purser, Starter Kit 11." |

Without the `/try/sign` scene the video is 2:45.

## What stays out, and why

- **Anything from another run.** No `/?recorded` (30 October), no agent run 1, no GIFs from earlier runs. The only
  other run named is the separate TAP run's decline, on its own labelled line.
- **The README.** No scene of the README or its tables; the ids are on the Proof page.
- **The Cardputer hub.** Built and tested on a fake hub, not run live. Leave it out.
- **T:0.** The T:0 sink is built, but the shared T:0 sandbox key can read and not post (`403 CAPI71`); nothing has
  been posted. Do not show a T:0 booking.
- **Any claim the run does not support.** No absolute safety claims, no certification claims, no Visa logo. The agents
  do propose amounts (the Treasury agent's budget split); do not say they never pick amounts or limits.

## Recording

- Laptop: a screen recording at 1080p or higher, browser zoom 110%, notifications off.
- Phone: recorded separately, for Face ID. A test world only; never a real account.
- On screen: no keys, no e-mail addresses, no account numbers. The ids above are public sandbox and testnet ids and
  may be shown.

## Facts and their sources

| Fact | Source |
|---|---|
| Main run: 3 November 2026, 11:15–11:37 UTC (the agents 11:16–11:33), commit `35e1cac`, 24 of 24 decisions by Claude | [docs/runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md) |
| Price rise from 0.02 to 0.04 from query #24; that purchase let through once on purpose (`world let-one-through`); Metal refused it with `mandate_cap_exceeded`; Purser would have refused it (0.04 over the 0.03 cap) | the run log, acceptance row 5 |
| The refusal on chain: tx `0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871`, 11:23:33 UTC | the run log; `/proof` |
| Treasury's options P-0002 and P-0003, total 20.00, 40 s after the refusal | the run log, steps 11:24:07 |
| Four eyes on P-0002: Max at 11:26:28 (1 of 2), the labelled test passkey at 11:26:46 (2 of 2); the replace on chain by 11:26:59 (31 s after Max's tap) | the run log, timings |
| The dispute: 12 orders (#5 to #16) claimed never placed, all 12 signed; #7, #10 and #13 refunded by the Support agent, 0.05 each, 0.15 in total; P-0004 ("refund the other 9") rejected by Max with Face ID at 11:29:37 | the run log, flow row "dispute"; record `docs/demo/main-run.json` (`ledger.disputes`) |
| The licence: P-0005 planned by the Treasury agent; FX conversion `3ca88196-05da-4d88-9caa-796f03704636` (EUR 110.00 for USD 124.29); SWIFT transfer `03360bfa-afce-457b-89d1-e1097fbe3985` (EUR 240.00, fee EUR 13.42, PAID 11:31:24 UTC, 6 s after Face ID) | the run log, rows 17 and 18/25 |
| The card buy: card raise P-0006 (EUR 30.00 → 46.00) approved with Face ID; TAP-signed EUR 45.00 purchase approved by Airwallex (authorization `01a1a12f-4113-7000-b76d-014677710007`) | the run log, row 20 |
| 2 stopped at a limit: Metal refused purchase #24 over the mandate cap (tx above), and Max rejected P-0004 with Face ID. Airwallex declined nothing in the main run. Query #37 (`mandate_revoked` during the mandate swap) is not counted | [docs/claims.md](claims.md), "Stopped at a limit"; record `docs/demo/main-run.json` |
| The separate line: Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November. Not the main run, not counted | `docs/runs/visa-tap-live-2026-11-02.json` |
| `/try/sign` (the jury signing scene) is built behind `TRY_SIGN_ENABLED`; deploy pending | `worker/src/trySign.ts`, `src/try/sign.ts`, `test/try-sign.test.ts`, `test/browser/trysign.check.ts` |
| `npm run verify`: all checks pass on the main run's ledger | the run log, acceptance §2 |
| The second approver is a labelled test passkey in this demo; in production a second person | the run log, Approvals |

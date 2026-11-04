# Video script: Purser in 2:30 to 3:00

Every line below is something that really happened in the main run of 3 November 2026 (11:15–11:37 UTC, commit
`35e1cac`), with its real id, or something the repository really does today. The source of each fact is in the last
column or in [Facts and their sources](#facts-and-their-sources). Test money throughout: the Airwallex sandbox and
Metal testnet.

| Time | Picture | Voice-over (English, short) |
|---|---|---|
| 0:00–0:12 | Hook: AI-generated footage of money moving across borders (Gemini Veo). A small "AI-generated" label in a corner the whole time. No logos. | "AI agents can spend money. Who stops them when they're wrong?" |
| 0:12–0:35 | The recorded CFO dashboard (`npm run judge`, then `/?recorded`): the three agents, Sourcing, Support and Treasury, each with its Metal mandate and its Airwallex card; then the Treasury agent's two options, P-0002 and P-0003. | "Three agents, each with its own company card and its own on-chain mandate. Inside their limits they act; beyond them they propose. Here the Treasury agent proposes how to split the budgets, within the 20.00 total. Code checks every proposal against the CFO's limits." |
| 0:35–1:05 | The money flow on the dashboard: the purchase at 0.04 marked "Refused by Metal", with its reason `mandate_cap_exceeded`; then the refusal's transaction on the Metal testnet explorer (tx `0x2e92f9cb…1871`, 11:23:33 UTC). | "At 11:23 the supplier raised its price from 0.02 to 0.04. The Sourcing agent's mandate allows 0.03 a purchase. Purser refuses that before it signs. In this run we let one purchase through on purpose, and Metal itself refused it, on chain: mandate cap exceeded." On screen at the end of the shot, the line "2 stopped at a limit" (Metal 1, the CFO 1), and directly below it, smaller and labelled: "Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November". |
| 1:05–1:45 | The phone: the approval page with its summary card (option, amount, recipient, expiry, check, terms hash), "Confirm with Face ID", Face ID, then "Done". Screen recording of the phone, recorded separately. Caption: "Re-recorded on a test world, test money; in the main run Max signed P-0002 at 11:26:28 UTC." | "Anything beyond the limits waits for a person. The CFO sees one card: what it is, how much, to whom, and the hash of the exact terms. Face ID signs that hash. Above the CFO's threshold, a second person signs too. In this demo the second approver is a labelled test passkey." |
| 1:45–2:10 | The Airwallex page of the recording (`/airwallex`): conversion `3ca88196-05da-4d88-9caa-796f03704636` (EUR 110.00 bought) and transfer `03360bfa-afce-457b-89d1-e1097fbe3985` (EUR 240.00, PAID 11:31:24 UTC); then the same ids in the README's Sandbox proof. | "Then it moves, in the real Airwallex sandbox. These IDs are in the README." |
| 2:10–2:30 | A terminal: `npm run verify` on the main run's ledger, every check passing, the audit chain recomputed from its genesis hash. | "And anyone can check it afterwards. npm run verify recomputes the hash-chained audit log and every passkey signature, offline." |
| 2:30–2:45 | The README: the "What is real, what is mock" table, the test count and the CI badge. | "Test money, real systems: the Airwallex sandbox and Metal testnet. What is simulated, we say so. Claude explains and proposes, the rules in code hold every limit, and a person signs." |
| 2:45–3:00 | **/try/sign: built, deploy pending.** The jury signing scene (15 s): on a phone, `/try/sign` (label at the top: "Test world · test passkey · nothing real moves") creates a passkey of the viewer's own, signs the waiting test proposal with Face ID, shows "Verified by the server" and "Executed in your test world", then "Try to tamper" and the same signature refused. Caption: "Your own test world and test passkey; nothing real moves." Record it only once the relay is redeployed with `TRY_SIGN_ENABLED=on`; until then, cut this scene and end at 2:45. | "Try it yourself: create your own passkey and sign." |

## What stays out, and why

- **The Cardputer hub.** It is built and tested on a fake hub, but it has not run live. Leave it out. If it runs live
  before the recording, film it with the phone and caption it with the date it ran; otherwise do not show it.
- **T:0.** The T:0 sink is built, but the shared T:0 sandbox key can read and not post (`403 CAPI71`); nothing has
  been posted. Do not show a T:0 booking. If it comes up, say "built, waiting for a write key".
- **Any claim the run does not support.** No absolute safety claims, no certification claims, no Visa logo, no logos
  in the hook. The agents
  do propose amounts (the Treasury agent's budget split); do not say they never pick amounts or limits.

## Recording

- Laptop: a screen recording at 1080p or higher, browser zoom 110%, notifications off.
- Phone: recorded separately, for Face ID. A test world only; never a real account.
- On screen: no keys, no e-mail addresses, no account numbers. The ids above are public sandbox and testnet ids and
  may be shown.
- AI-generated footage only in the hook, and always labelled.

## Facts and their sources

| Fact | Source |
|---|---|
| Main run: 3 November 2026, 11:15–11:37 UTC, commit `35e1cac`, 24 of 24 decisions by Claude | [docs/runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md) |
| Price rise to 0.04 from query #24; that purchase let through once on purpose (`world let-one-through`); Metal refused it with `mandate_cap_exceeded`; Purser would have refused it (0.04 over the 0.03 cap) | the run log, acceptance row 5 |
| The refusal on chain: tx `0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871`, 11:23:33 UTC | [README, Sandbox proof](../README.md#sandbox-proof) |
| Treasury's options P-0002 (A: cap 0.04, price 0.05, recommended) and P-0003 (B: price 0.07), total 20.00, 40 s after the refusal | the run log, steps 11:24:07 |
| Four eyes on P-0002: Max at 11:26:28 (1 of 2), the labelled test passkey at 11:26:46 (2 of 2); the replace on chain by 11:26:59 | the run log; README, Sandbox proof |
| FX conversion `3ca88196-05da-4d88-9caa-796f03704636` (EUR 110.00) and SWIFT transfer `03360bfa-afce-457b-89d1-e1097fbe3985` (EUR 240.00, fee EUR 13.42, PAID 11:31:24 UTC, 6 s after Face ID) | README, Sandbox proof |
| 2 stopped at a limit: Metal refused purchase #24 over the mandate cap (tx above), and Max rejected P-0004 with Face ID. Airwallex declined nothing in the main run (Sourcing asked for the card raise P-0006 first, and the purchase was approved). Query #37 (`mandate_revoked` during the mandate swap) is not counted | [docs/claims.md](claims.md), the main run's "Stopped at a limit"; record `docs/demo/main-run.json` |
| The separate line: Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November. Not the main run, not counted | `docs/runs/visa-tap-live-2026-11-02.json` |
| `/try/sign` (the jury signing scene) is built behind `TRY_SIGN_ENABLED`; deploy pending | `worker/src/trySign.ts`, `src/try/sign.ts`, `test/try-sign.test.ts`, `test/try-sign-separation.test.ts`, `test/browser/trysign.check.ts`; the scene is recorded only once the hosted relay serves it |
| `npm run verify`: all checks pass on the main run's ledger | the run log, acceptance §2 |
| The second approver is a labelled test passkey in this demo; in production a second person | the run log, Approvals |
| The hub is not run live; T:0 has posted nothing (`403 CAPI71`) | [README, What is real, what is mock](../README.md#what-is-real-what-is-mock); [docs/runs/2026-11-03-t0-sandbox.md](runs/2026-11-03-t0-sandbox.md) |

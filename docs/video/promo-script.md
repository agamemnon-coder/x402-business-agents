# The promo film (13 Nov): script

1:12, 1920×1080 and 1080×1920, 60 fps. The code is `src/film/promo.ts`; the edit guide is the "Promo film (13 Nov)" section of [README.md](README.md).

| Time | Line | On screen, and its record |
|---|---|---|
| 0:00.5 | AI agents are starting to spend company money. | Problem: type on black |
| 0:04.0 | And a limit written in a prompt... is only a request. | A system prompt, struck through: ONLY A REQUEST. |
| 0:08.4 | So who holds the pen? | WHO HOLDS THE PEN? |
| 0:11.0 | Purser. | The mark and the name, on the music's hit |
| 0:13.0 | Agents propose. The CFO signs the exact terms, with Face ID or a passkey. | Live /try loop: reading, Face ID (test world, no money moves) |
| 0:20.3 | Then the payment rails enforce the limit, again. | Rails; card limits, payout approvals, on-chain mandates |
| 0:23.2 | Two locks. One signature. | Two rings: Purser checks, the rail checks |
| 0:26.2 | Don't take our word for it. | Real hashes scroll behind |
| 0:28.5 | Change one cent after signing. Refused. | Live /try loop: EUR 1,850.01, Refused (src/try/sign.ts, src/redesign/walk.ts) |
| 0:32.4 | A charge over the card limit? Airwallex declined it. | EUR 45.00 over the 30.00 limit, card ····2441, LIMIT_EXCEEDED, 7 Nov (docs/runs/2026-11-07-awx-1.md) |
| 0:36.5 | A payout, held in approval, until the owner said yes. | EUR 240.00, transfer 4074d684…, IN_APPROVAL 10 Nov → approved at Airwallex 12 Nov → PAID, settlement simulated (docs/runs/2026-11-10-airwallex-two-locks.md, 2026-11-12-airwallex-two-locks-paid.md) |
| 0:41.0 | Over the agent's cap? Metal refused it. On chain. | 0.06 test USD vs the 0.05 cap, refused on chain, mandate_cap_exceeded, tx 0xe6d9c7ea…585df4, 12 Nov (docs/runs/2026-11-12-faceid-onchain.md) |
| 0:46.6 | The audit chain, anchored on chain. | Anchor head aaaf56a1…, height 701, tx 0xaa93f270…, Metal testnet, 13 Nov (docs/runs/2026-11-13-anchor.md) |
| 0:49.7 | Fifty-two attacks. Money moved: zero. | 52 zero-trust attacks, money moved 0 (docs/zero-trust/report.json: attacks_run, attacks_where_money_moved) |
| 0:53.5 | A hostile model. Three hundred and eighty tool calls. Zero unsafe. | 380 hostile tool calls, 370 refused by code, 0 unsafe (docs/evals/ap-hostile.json) |
| 1:01.2 | Your agents do the work. Your CFO signs the exceptions. | Purser Cloud guest view (demo company, made-up data, test money) |
| 1:06.8 | Purser. Try it yourself. | End card: kit11.max-31b.workers.dev/try; test money · sandbox/testnet; partners in text only, No endorsement implied; voice and music AI-generated (ElevenLabs) |

127 words. Voice: "Lily", an ElevenLabs premade library voice, `eleven_multilingual_v2`, stability 0.5, similarity 0.8, style 0.3.

## Music prompt (ElevenLabs music API, 72 s, instrumental)

> Instrumental score for a premium, cinematic luxury car launch commercial. Dark, sleek, high-contrast, modern. 0-10s: near silence, deep sub-bass swells, a ticking clock-like pulse and tension. At 10.5s: a single powerful hit and the beat drops into a confident, driving hybrid-electronic groove around 100 BPM with tight cinematic percussion, pulsing synth bass and glossy string ostinato. 26s: lift in energy, faster pulses, punchy accents every two seconds. 46s-60s: peak energy, wide and triumphant but restrained. 60s: drops back to a warm, elegant pad. 65s: one final deep impact, then a long shimmering tail fading to silence by 72s. No vocals, no lyrics.

## YouTube

**Title:** Purser: AI agents spend. You sign off.

**Description:**

```
AI agents are starting to spend company money, and a limit in a prompt is only a request. With Purser, agents propose; the CFO signs the exact terms with Face ID or a passkey; and the payment rails enforce the limit again.

In this film, from the records: one cent changed after signing is refused; Airwallex declined a charge over the card limit (LIMIT_EXCEEDED); a payout was held IN_APPROVAL until the owner approved it; Metal refused an over-cap payment on chain; the audit chain is anchored on chain; 52 zero-trust attacks, no money moved; a hostile-model eval with 380 hostile tool calls and 0 unsafe.

Try it yourself: https://kit11.max-31b.workers.dev/try

Test money only: Airwallex sandbox, Metal testnet, a test world and a demo company. Airwallex, Metal and Claude are named in text only; no endorsement implied. Voice-over and music are AI-generated (ElevenLabs).
```

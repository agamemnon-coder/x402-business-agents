# The promo film (13 Nov): script

v2, 1:06.5, 1920×1080 and 1080×1920, 60 fps. The code is `src/film/promo.ts`; the edit guide is the "Promo film (13 Nov)" section of [README.md](README.md).

| Time | Line | On screen, and its record |
|---|---|---|
| 0:02.6 | A limit in a prompt is only a request. | Cold open: the live /try loop, EUR 1,850.00 → 1,850.01, REFUSED (src/try/sign.ts, src/redesign/walk.ts) |
| 0:05.6 | Purser. | The mark drawn on the music's drop; "AI agents spend. You sign off." |
| 0:08.4 | Agents propose. The CFO signs the exact terms, with Face ID or a passkey. | Home's live hero loop (light), then the /try loop on a phone: Face ID, Passkey, SIGNED (test world) |
| 0:15.8 | Then the payment rails enforce the limit, again. | Purser Cloud's Agents page, guest view (demo company, made-up data, test money) |
| 0:18.6 | Two locks. One signature. | Two rings close: Purser checks, the rail checks |
| 0:21.4 | Don't take our word for it. | A whip through the records' hashes |
| 0:23.6 | A charge over the card limit? Airwallex declined it. | Card swipe; EUR 45.00 vs the 30.00 limit, card ····2441; DECLINED, LIMIT_EXCEEDED, 7 Nov (docs/runs/2026-11-07-awx-1.md) |
| 0:27.5 | A payout, held in approval, until the owner said yes. | Ticker: IN_APPROVAL (10 Nov) → APPROVED at Airwallex (12 Nov) → PAID, settlement simulated; EUR 240.00, transfer 4074d684… (docs/runs/2026-11-10-airwallex-two-locks.md, 2026-11-12-airwallex-two-locks-paid.md) |
| 0:31.9 | Over the agent's cap? Metal refused it. On chain. | 0.06 test USD vs the 0.05 cap; chain; REFUSED ON CHAIN, mandate_cap_exceeded, tx 0xe6d9c7ea…585df4, 12 Nov (docs/runs/2026-11-12-faceid-onchain.md) |
| 0:37.3 | The audit chain, anchored on chain. | Blocks link; the anchor drops; head aaaf56a1…, height 701, tx 0xaa93f270…, 13 Nov (docs/runs/2026-11-13-anchor.md) |
| 0:40.2 | Fifty-three attacks. Money moved: zero. | 53 zero-trust attacks, money moved 0 (docs/zero-trust/report.json) |
| 0:44.3 | A hostile model. Three hundred and eighty tool calls. Zero unsafe. | 380 hostile tool calls: 318 refused, 52 made stricter, 10 allowed as they were (within the rules), 0 unsafe (docs/evals/ap-hostile.json); then the recap, one refusal per beat |
| 0:55.6 | Your agents do the work. Your CFO signs the exceptions. | Split screen: Cloud's pages racing | the phone, still |
| 1:01.1 | Purser. Try it yourself. | End card: kit11.max-31b.workers.dev/try; Full walkthrough: youtu.be/mp9fmOYfBWc; small type |

Scenes: cold 0:00.0 · logo 0:05.2 · propose 0:08.2 · phone 0:11.6 · agents 0:15.4 · locks 0:18.4 · word 0:21.3 · card 0:23.4 · payout 0:27.3 · metal 0:31.7 · anchor 0:37.1 · attacks 0:40.1 · hostile 0:44.2 · recap 0:50.4 · payoff 0:55.4 · end 1:01.0.

106 words. Voice: "Lily", an ElevenLabs premade library voice, `eleven_multilingual_v2`, stability 0.5, similarity 0.8, style 0.3.

## Music prompt (ElevenLabs music API, 72 s, instrumental)

> Instrumental score for a premium, cinematic luxury car launch commercial. Dark, sleek, high-contrast, modern. 0-10s: near silence, deep sub-bass swells, a ticking clock-like pulse and tension. At 10.5s: a single powerful hit and the beat drops into a confident, driving hybrid-electronic groove around 100 BPM with tight cinematic percussion, pulsing synth bass and glossy string ostinato. 26s: lift in energy, faster pulses, punchy accents every two seconds. 46s-60s: peak energy, wide and triumphant but restrained. 60s: drops back to a warm, elegant pad. 65s: one final deep impact, then a long shimmering tail fading to silence by 72s. No vocals, no lyrics.

The take is re-cut, not regenerated: the film starts 4.6 s into it.

## YouTube

**Title:** Purser: AI agents spend. You sign off.

**Description:**

```
AI agents are starting to spend company money, and a limit in a prompt is only a request. With Purser, agents propose; the CFO signs the exact terms with Face ID or a passkey; and the payment rails enforce the limit again.

In this film, from the records: one cent changed after signing is refused; Airwallex declined a charge over the card limit (LIMIT_EXCEEDED); a payout was held IN_APPROVAL until the owner approved it; Metal refused an over-cap payment on chain; the audit chain is anchored on chain; 53 zero-trust attacks, no money moved; a hostile-model eval with 380 hostile tool calls and 0 unsafe.

Try it yourself: https://kit11.max-31b.workers.dev/try
Full walkthrough (4:58): https://youtu.be/mp9fmOYfBWc

Test money only: Airwallex sandbox, Metal testnet, a test world and a demo company. Airwallex, Metal and Claude are named in text only; no endorsement implied. Voice-over and music are AI-generated (ElevenLabs); sound effects are made in code.
```

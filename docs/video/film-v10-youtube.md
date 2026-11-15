# Film v10.1 on YouTube: title, description, chapters

Upload `out/video/v10/purser-v10-1.mp4` (4:50; v10.1 of 15 Nov replaces v10 of 13 Nov), visibility **Unlisted**, and add
`out/video/v10/purser-v10-1.srt` (the same as [film-v10.srt](film-v10.srt)) as English captions. What changed from v10:
the captions name Alta (formerly Metal) where the voice says Metal (Metal renamed itself Alta on 14 November), and the
outdated sentences on the reused credential are cut (since 14 November Purser refuses a reused credential before any
Airwallex call, docs/runs/2026-11-14-vic-5.md).

**Title:** Purser: AI agents pay company bills, only within limits the CFO signs (Kit 11 hand-in)

**Description:**

```
Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID or a passkey. A limit written in a prompt is only a request: Purser's code checks every limit, and the payment rails check it again.

Built for the Airwallex Agentic Banking Hackathon, Starter Kit 11.

Try it yourself: https://kit11.max-31b.workers.dev/try (your own test company, test money, deleted after 24 hours)
The proof, every claim with its record: https://kit11.max-31b.workers.dev/proof
Security, the layers a payment must pass: https://kit11.max-31b.workers.dev/security

Test money only: the Airwallex sandbox, Alta (formerly Metal) testnet, Airi's test card and a simulated bank. Settlement in the Airwallex sandbox is simulated. Purser Cloud is shown with its demo company (made-up data). The approval alerts are built, live once Twilio keys are set. The walk of /try was recorded by code with a virtual test passkey.

Voice-over and music: AI-generated (ElevenLabs).

Chapters
0:00 The problem
0:21 Purser Cloud
0:47 Approval alerts
1:06 Try it: your own test company
1:48 Security in layers
2:25 Claude decides, code checks
2:51 Airwallex
3:17 Alta (formerly Metal)
3:44 Visa via Airi
4:01 T:0
4:11 The proof
4:22 What is not done
4:31 Close
```

The chapters are the cut's own (`npm run cut -- --docs handin-10` writes them into [film-v10-script.md](film-v10-script.md));
`test/film-v10.test.ts` checks that this list matches.

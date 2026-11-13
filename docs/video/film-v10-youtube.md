# Film v10 on YouTube: title, description, chapters

Upload `out/video/v10/purser-v10.mp4` (4:53), visibility **Unlisted**, and add `out/video/v10/purser-v10.srt` (the same
as [film-v10.srt](film-v10.srt)) as English captions.

**Title:** Purser: AI agents pay company bills, only within limits the CFO signs (Kit 11 hand-in)

**Description:**

```
Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID or a passkey. A limit written in a prompt is only a request: Purser's code checks every limit, and the payment rails check it again.

Built for the Airwallex Agentic Banking Hackathon, Starter Kit 11.

Try it yourself: https://kit11.max-31b.workers.dev/try (your own test company, test money, deleted after 24 hours)
The proof, every claim with its record: https://kit11.max-31b.workers.dev/proof
Security, the layers a payment must pass: https://kit11.max-31b.workers.dev/security

Test money only: the Airwallex sandbox, Metal testnet, Airi's test card and a simulated bank. Settlement in the Airwallex sandbox is simulated. Purser Cloud is shown with its demo company (made-up data). The approval alerts are built and tested, not live yet. The walk of /try was recorded by code with a virtual test passkey.

Voice-over and music: AI-generated (ElevenLabs).

Chapters
0:00 The problem
0:21 Purser Cloud
0:47 Approval alerts
1:04 Try it: your own test company
1:46 Security in layers
2:21 Claude decides, code checks
2:47 Airwallex
3:13 Metal
3:40 Visa via Airi
3:57 T:0
4:07 The proof
4:18 What is not done
4:34 Close
```

The chapters are the cut's own (`npm run cut -- --docs handin-10` writes them into [film-v10-script.md](film-v10-script.md));
`test/film-v10.test.ts` checks that this list matches.

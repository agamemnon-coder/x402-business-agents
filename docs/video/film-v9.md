# The new film (v9): how it is made

Two films come from cut lists in code, so every line, caption and number can be checked against its record before a
frame is drawn:

- **Purser in three minutes** (3:00): the submission, and Demo Day with the QR end card. `src/film/cuts.ts` `SUBMISSION`.
- **The walkthrough** (about 4:45, under five minutes as the rule asks): for the jury, and the film on /watch.
  `WALKTHROUGH`.

Each row names its claims (`src/film/claims.ts`); each claim names its record and the strings that must be found there.
A row whose record is still on another branch uses its timed fallback words, or is dropped, until the record is in this
repository: the film never says what its records do not hold.

## Commands

```sh
npm run cut -- --check                       # timing (150 words a minute), captions, badges, every number against its record
npm run capture -- --list                    # every shot, its address, gate and length, and which clips exist
npm run capture -- all --phone               # the page shots, 1440x900 and 390x844, dark, into out/video/v9/shots/
npm run cut -- submission-3                  # out/video/v9/purser-3min.mp4 (+ .srt, cut-3.json, script-3.md, missing-3.txt)
npm run cut -- walkthrough-5                 # out/video/v9/purser-5min.mp4
npm run cut -- submission-3 --demo-day       # the Demo Day close and the QR end card
npm run cut -- walkthrough-5 --vo out/video/vo/ --own M1=max-open.mov@2.0-22.0 --own M2=max-close.mov@1.5-16.5 \
  --own P1a=iphone.mp4@4-15 --own P1b=iphone.mp4@31-41 --own P1c=iphone.mp4@52-60 --own P1d=iphone.mp4@66-77
```

`capture` takes each frame from Chromium and pipes it straight into ffmpeg (no frame file on disk); a scroll is one
screenshot a frame, a hold repeats the last one. A shot is refused when its page lacks a line it must show, when its
stream is not live there (the preview, kit11-next, is tried next), or when it shows a defect after its actions. GETs of
public pages only. Renders stop below 3 GB of free disk. Nothing in `out/` goes into git.

Without a voice, the draft runs the narration as a small line at the bottom and draws a card wherever the owner's own
footage goes ("PLACEHOLDER · M1", "PHONE RECORDING goes here").

## What only Max can record

| Shot | What | Length | Notes |
|---|---|---|---|
| **M1** | On camera, the opening (landscape, 1080p) | 20 s | Word for word: "Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. That matters, because a limit in a prompt is only a request. Our code checks the limit, and the payment rails check it again." |
| **M2** | On camera, the close | 15 s | "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself." (Demo Day: "… Scan the code, and try it yourself.") |
| **P1a–d** | iPhone screen recording of /try/sign with his own Face ID, dark mode: the reading and advice, the terms and Face ID, "Try to cheat" (+ 1 cent), "Trick the agent" | 40 s used | Only takes whose labels say "Claude Sonnet · live" and "Claude Opus · live"; record before /go is deployed. A second camera for 2–3 s at the Face ID moment. |
| **VO** | The voice-over, one WAV per row (`s02.wav` … `w14.wav`), at about 150 words a minute | — | The lines are in `out/video/v9/script-3.md` and `script-5.md`; the row id is the file name. Without it, an AI voice can read the same lines and the end card says so. |

Each row fits its words with a second to spare; nothing is sped up.

## After the upload

Put the film's YouTube id in `src/config/film.ts` (`FILM_YOUTUBE_ID`). /watch then embeds it (youtube-nocookie.com,
allowed by that page's CSP only), each chapter jumps to its time, and Watch may return as a tab (`WATCH_IN_MENU`).
The chapters for the YouTube description are at the end of `script-5.md`.

## The hand-in film (13 Nov, draft)

The film for the hand-in, under 4:45 (`HANDIN` in `src/film/cuts.ts`, 4:38 as cut): the problem; Kit 11's core; the
hands-on demo on Max's phone; Face ID checked on chain and a payment refused on chain (Metal, 12 Nov); Airwallex's own
card limit; Visa via Airi (12 Nov); two locks, then PAID; the books Claude codes; Purser Cloud's console; the proof
page; what is not done; the close.

- [handin-script.md](handin-script.md): the script with its times, words, captions, badges and claims.
- [handin-shots.md](handin-shots.md): per scene, the shot, who records it (Max on his iPhone, Max on his laptop, or the
  capture tool), the exact address or screen, and what is done there.
- [handin.srt](handin.srt): the captions (narration) draft for YouTube.

All three are written by `npm run cut -- --docs handin-5` and a test holds them to the code. Updated on 13 November
from that day's records: the hands-on demo with Claude on (`2026-11-13-try-sample.json`), the books month read and
booked by Claude live (`2026-11-13-books-month.json`), vic-4 (Purser refuses a reused credential and one shown for
another amount) and the Airwallex payout approved with Face ID on Max's own iPhone (`2026-11-13-airwallex-faceid.md`).
That payout is still held at Airwallex, so PAID stays the 12 November run, signed with a test passkey, and "what is not
done" says so.
Finalise after today's site fixes: capture the page shots (`npm run capture -- D1a T3 F0 F1 F1b F2 T9a V4 V4n AF1 D3 T5f B1 PR1 AF1b`),
then `npm run cut -- handin-5 --vo <dir> --own M1=… --own P2a=… --own S1=…`.

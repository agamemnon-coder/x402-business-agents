# The premiere: edit guide

**Purser in 2:30**, a premiere-style film made from the main run of 3 November 2026 (world `main-1`,
[run log](../runs/2026-11-03-main-run.md)). Dark, large and slow, letterboxed to 2.39:1. Every figure on screen is read
from the run's record by code, and the render stops when one is missing. The script with every picture, line and
source is [premiere-script.md](premiere-script.md); the voice-over to read aloud is [script.md](script.md); what Max
records is in [opnames-max.md](opnames-max.md).

## The files

`npm run video` makes everything below in `out/video/` (not in git; about 25 minutes on the dev machine in three parallel runs: every frame is
drawn at 3840×2160 and scaled down with lanczos, then encoded with x264 at preset slow, CRF 14, so small text stays
crisp). The words are also in this folder.

| File | What it is |
|---|---|
| `clips/01-line.mp4` … `clips/16-end.mp4` | One clip per scene: 1920×1080, 60 frames a second, silent, the picture letterboxed to 2.39:1 (black bars of 138 px above and below). Each clip fades in and out over the background, which runs on the film's own clock, so in order the clips join seamlessly; the opening line is on black. There is no clip 02: the hook was cut, and the other clips keep their numbers; the agents' intro is `03b-agents.mp4`, right after the pen. |
| `clips/16-end-ai-voice.mp4` | A spare end card whose credits name an AI-generated voice. Not used: Max reads the whole voice-over himself. |
| `overlays/08-faceid.png`, `overlays/10-try-sign.png`, `overlays/15-close.png` | Transparent 1920×1080 PNGs: the letterbox bars with the corner credits, and the label for a recording laid over that scene. Put one on the track above the recording, for the scene's full length. |
| `master.mp4` | **The deliverable picture:** all sixteen clips in order (2:30), silent, no burned-in subtitles. Only Max's closing (15) is a stand-in: the card with his line, which also works under his voice alone. |
| `subtitles.srt` | The voice-over as English subtitles on the script's times, for YouTube's captions (a copy is in this folder). Nothing is burned in. |
| `script.md`, `premiere-script.md` | The read-aloud script and the script table (copies are in this folder). |

Again: `npm run video` for everything; `npm run video -- 13-specs` for one clip (the master is rebuilt when every clip
is there); `npm run video -- --stills` for three PNGs of each scene in `out/video/stills/`; `npm run video -- --docs`
for the three files in this folder; `VIDEO_PREVIEW=1 npm run video` for a quick preview (drawn at 1×, x264 veryfast,
CRF 18), not the deliverable. The spec cards read the README's test line when they are rendered: after that
line changes, render `13-specs` again.

## Which clip goes where

Every scene starts on an even second: the music (120 BPM, a bar every 2 s) is cut to these times.

| Time | Clip | What | Recording slot | Music |
|---|---|---|---|---|
| 0:00 | `01-line.mp4` | Black, a beat of silence, then “AI agents can now spend money.” slams in, large; a hard cut | | Silence |
| 0:02 | `03-pen.mp4` | “Who holds the pen?”, large, a pen stroke drawing itself under it; at 0:04 a straight cut to the wordmark Purser, a line drawn under it, and the core line in two lines | Max's voice: the opening | Silence under the question; **the music starts on the cut to the wordmark (0:04)** |
| 0:10 | `03b-agents.mp4` | Three Claude agents, their cards 0.7 s apart: Sourcing (Claude Haiku 5.5), Support (Claude Sonnet 5.5), Treasury (Claude Opus 5.5), each with its job, its own Airwallex card and its own Metal mandate (the limits as the run began); then “The rails and the code hold the limits.” (0:14) | | Low, a soft pulse under each card |
| 0:18 | `04-architecture.mp4` | The diagram: agent → rules → person → Airwallex or Metal → books; then a refused payment: the Airwallex or Metal box flashes red, “Refused at the limit” under it, both gone within a second | | Slowly building |
| 0:28 | `05-price-rise.mp4` | The price rise; let through on purpose; Metal refuses; the tx | | Building |
| 0:44 | `06-dispute.mp4` | Twelve orders, three refunded, “refund the other 9” rejected with Face ID | | Steady |
| 0:56 | `07-approval.mp4` | The approval card (P-0005's exact terms) | | Thins out |
| 1:02 | `08-faceid.mp4` | Face ID on the same sheet, then “Approved”, labelled as a reconstruction with the real Face ID's time (11:31:18 UTC) | | Almost silent: let the Face ID breathe |
| 1:08 | `09-six-seconds.mp4` | 6 seconds from Face ID to PAID, counting up from the cut; “In the sandbox, the settlement is simulated.”; the transfer id; “Every id is on /proof” | | **The first hit**, on “6 seconds”: the cut itself (1:08) |
| 1:18 | `10-try-sign.mp4` | A mock of the live /try/sign page | Optional: **Max on /try/sign** with `overlays/10-try-sign.png` (or keep the mock) | Building again |
| 1:28 | `11-one-cent.mp4` | +0.01, refused; “One cent. Worthless.” at 1:32 | | **Hard cut to silence**: no music, no voice |
| 1:34 | `12-why-face-id.mp4` | Why Face ID, not a password | | The music comes back, softly |
| 1:44 | `13-specs.mp4` | Four spec cards: the tests (1:44), the audit log (1:46), the stops (1:48, 6 s: “Stopped at a limit, in the main run”, a purchase refused by Metal and a proposal rejected by the CFO side by side, Max's sentence under them), decisions by Claude (1:54) | | One card on each beat: 1:44, 1:46, 1:48, 1:54 |
| 1:58 | `14-real.mp4` | What's real, what's ours | | Steady, lower |
| 2:08 | `15-close.mp4` | The ending mirrors the intro: “A price shock.” / “A dispute.” / “A euro bill.”, then the closing line in two lines, then the intro's wordmark with “Starter Kit 11” (2:19); Max's name lower left | **Max on camera** with `overlays/15-close.png`, or his voice over this card | Low, under Max's voice |
| 2:22 | `16-end.mp4` | “Try it yourself”, https://kit11.max-31b.workers.dev/try/sign; from about 2:25 the end credits (text only): thank you to Airwallex, Metal, Anthropic (Claude) and the hackathon organisers and mentors; built by Max Geurtsen; voice and music; test money only | | The last swell, resolving under the credits; fade out with the picture (1 s), the end at 2:30 |

## Max's recordings

Only his voice is needed: the Face ID (08) is rendered, a reconstruction of P-0005's approval sheet labelled as one
(“Reconstruction of the approval screen · the real Face ID was at 11:31:18 UTC (main run)”), and /try/sign (10) is a
mock of the live page drawn from its code.

1. **The voice-over** in his own voice, with the opening and the closing line in it: [script.md](script.md), each line
   with the second it starts ([opnames-max.md](opnames-max.md), 1). The opening is over `03-pen.mp4` (“So who holds
   the pen? I'm Max Geurtsen, and this is Purser.”); the closing (2:08) over `15-close.mp4`, which shows the same line
   as text, or with Max on camera and `overlays/15-close.png` (his name, lower left) above it.
2. **Optional: his own phone recordings.** `npm run video` still lays a portrait (9:16) recording into a rounded phone
   frame beside the scene's captions, with its honesty label, and rebuilds the master:

   ```sh
   npm run video -- 10-try-sign --slot 10-try-sign=<trysign.mov>
   npm run video -- 08-faceid --slot 08-faceid=<faceid.mov>@<start>-<end>
   ```

   `@<start>-<end>` (seconds) takes a window. A window longer than its scene plays faster to fit, and the scene says
   so (“shown at 1.25× speed”); a shorter one holds its last frame. Without a file the scene keeps its rendered
   picture. For /try/sign (1:18, 10 s): his visit to the live page, signing with Face ID and then pressing “Try to
   tamper” ([opnames-max.md](opnames-max.md), 2); the tamper and its refusal then play again, large, in
   `11-one-cent.mp4`. In an editor instead, put the recording above the clip and the scene's overlay PNG above it, for
   the scene's full length.

## Music

Royalty-free and slowly building, one track for the whole film, cut so it starts on the wordmark at 0:04, hits at 1:08
and stops dead at 1:28.

- **The track:** “Techno Fest Vibes” (Mixkit, track 124), under the Mixkit Stock Music Free License, stretched to
  120 BPM. The end card credits it: “Music: Techno Fest Vibes (Mixkit)”.
- **The cues, every one on an even second (one bar):** silence for the first line and the question; the music starts on
  the cut to the wordmark (0:04), low under the three agents (0:10); building through the diagram (0:18) and the price
  rise (0:28); steady under the dispute (0:44); thin under the approval card (0:56) and the Face ID (1:02);
  the first hit on “6 seconds” (1:08); building on /try/sign (1:18); **silence from 1:28 to 1:34** (“One cent.
  Worthless.” stands alone, on screen from 1:32); back, softly, for the password line (1:34); on the beat for the spec cards (1:44, 1:46,
  1:48, 1:54); lower under what's real (1:58); low under Max's closing (2:08); the last swell on the end card (2:22),
  resolving under the credits, out with the picture at 2:30.
- Under a voice, keep the music 18 to 22 dB lower.

## Cutting it

**DaVinci Resolve**

1. New project; in Project Settings set the timeline to 1920×1080 and 60 frames a second **before** importing.
2. Import `master.mp4` on V1 (or the sixteen clips in order).
3. Optional: Max on camera on V2 at 2:08 with `overlays/15-close.png` on V3, for the scene's full 14 s.
4. Voice-over on A1 at the times in [script.md](script.md); the music on A2, lowered under the voice; nothing at
   1:28–1:34.
5. No subtitles in the picture: give YouTube the `.srt` (below).
6. Deliver: the YouTube 1080p preset, H.264, 60 frames a second, at a high bitrate (the small text must stay crisp),
   and check the length: 2:30, under the hackathon's five minutes.

**CapCut** (desktop or phone): a 1080p, 60 fps project; `master.mp4` (or the clips in order) on the main track; a
recording and its overlay PNG as overlay layers, if any; voice and music as audio layers; export at 1080p, 60 fps.

**Upload:** YouTube, visibility **Unlisted**. Add `subtitles.srt` as English captions. In the description: “Test money
only: the Airwallex sandbox and Metal testnet” and “Music: Techno Fest Vibes (Mixkit), Mixkit Stock Music Free License”.

## Before you upload

- 2:30, under five minutes.
- Nothing private on screen: no keys, e-mail addresses, notifications, other tabs or bookmarks.
- The Face ID scene keeps its label (“Reconstruction of the approval screen …”), and a recording laid in keeps its own.
- No logos of others anywhere (the rendered clips have none; check the recordings).
- Max's own voice throughout, and `16-end.mp4` as the end card (not the spare).

## How the clips are made

`src/film/premiere.ts` reads every figure from `docs/demo/main-run.json` (and the test count from the README's test
line, and the /try/sign mock's figures from that page's code) and stops when one is missing; `src/film/premiere.html`
draws each scene from those strings and types in no figure of its own; `src/film/premiereScript.ts` holds the scenes'
times, the voice-over's times and the music cues. `npm run video` (`src/cli/video.ts`) plays the page on a virtual
clock, one frame every 1/60 s, so every clip is exactly its length at 60 frames a second. `test/premiere.test.ts`
counts the figures again from the record and fails on a difference, a missing figure, a figure typed into the page,
or a file in this folder that the code would write differently.

**The look.** Behind the text, calm and still: deep navy (#0a1020), a very faint static dot grid (a dot every 36 px,
white at 7%), a soft vignette, and a drift of half a pixel a second, hardly seen; in the picture only, never the bars.
It fades in from 0:02, so the opening line stays on black. In the top bar, 0:02 to 2:22, quiet: “Max Geurtsen ·
Purser” left and “Built on Airwallex · Metal · Claude” right (Inter Medium 20 px, grey: white at 46%, 64 px from the
edges), text only, no logos. Every text colour is WCAG AA over the brightest point of that background (a dot; the
test computes it), and the corner credits 4.6:1 on the black bar.

Earlier drafts (`hybrid-script.md`, `script-v0.md`, `review-2026-11-02.md`) are kept for the record; the premiere
replaces them. Max's own wording for the opening and the closing is in [max-opening-close.md](max-opening-close.md).
The earlier animated film of the 30 October recording still renders with `npm run video -- --film` (into
`out/video/film/`); it is not the submission video.

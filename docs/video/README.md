# The premiere: edit guide

**Purser in 2:49**, a premiere-style film made from the main run of 3 November 2026 (world `main-1`,
[run log](../runs/2026-11-03-main-run.md)). Dark, large and slow, letterboxed to 2.39:1. Every figure on screen is read
from the run's record by code, and the render stops when one is missing. The script with every picture, line and
source is [premiere-script.md](premiere-script.md); the voice-over to read aloud is [script.md](script.md); what Max
records is in [opnames-max.md](opnames-max.md).

## The files

`npm run video` makes everything below in `out/video/` (not in git; about 25 minutes on the dev machine). The words
are also in this folder.

| File | What it is |
|---|---|
| `clips/01-line.mp4` … `clips/16-end.mp4` | One clip per scene: 1920×1080, 60 frames a second, silent, the picture letterboxed to 2.39:1 (black bars of 138 px above and below). Each clip starts and ends on black, so you can cut between them anywhere. There is no clip 02: the hook was cut, and the other clips keep their numbers. |
| `clips/16-end-ai-voice.mp4` | A spare end card whose credits name an AI-generated voice. Not used: Max reads the whole voice-over himself. |
| `overlays/08-faceid.png`, `overlays/10-try-sign.png`, `overlays/15-close.png` | Transparent 1920×1080 PNGs: the letterbox bars and the label for each recording slot. Put one on the track above the recording, for the slot's full length. |
| `master.mp4` | All fifteen clips in order (2:49), silent, with stand-ins where the recordings go: the rough cut to edit against. |
| `master-subtitled.mp4` | The same, with the English subtitles burned into the lower bar. |
| `subtitles.srt` | The voice-over as English subtitles on the script's times (a copy is in this folder). |
| `script.md`, `premiere-script.md` | The read-aloud script and the script table (copies are in this folder). |

Again: `npm run video` for everything; `npm run video -- 13-specs` for one clip (the master is rebuilt when every clip
is there); `npm run video -- --stills` for three PNGs of each scene in `out/video/stills/`; `npm run video -- --docs`
for the three files in this folder. The spec cards read the README's test line when they are rendered: after that
line changes, render `13-specs` again.

## Which clip goes where

| Time | Clip | What | Recording slot | Music |
|---|---|---|---|---|
| 0:00 | `01-line.mp4` | “AI agents can now spend money.” on black | | Silence |
| 0:03 | `03-pen.mp4` | “So who holds the pen?”, then the title | Max's voice: the opening | The music starts, low and slow |
| 0:11 | `04-architecture.mp4` | The diagram: agent → rules → person → Airwallex or Metal → books (T:0: built, not yet live) | | Slowly building |
| 0:24 | `05-price-rise.mp4` | The price rise; let through on purpose; Metal refuses; the tx | | Building |
| 0:42 | `06-dispute.mp4` | Twelve orders, three refunded, “refund the other 9” rejected with Face ID | | Steady |
| 0:57 | `07-approval.mp4` | The approval card (P-0005's exact terms) | | Thins out |
| 1:04 | `08-faceid.mp4` | Stand-in for the Face ID | **Max's Face ID** with `overlays/08-faceid.png` | Almost silent: let the Face ID breathe |
| 1:12 | `09-six-seconds.mp4` | 6 seconds from Face ID to PAID; “In the sandbox, the settlement is simulated.”; the transfer id; “Every id is on /proof” | | **The first hit**, on “6 seconds” |
| 1:24 | `10-try-sign.mp4` | A mock of the live /try/sign page | **Max on /try/sign** with `overlays/10-try-sign.png` (or keep the mock) | Building again |
| 1:40 | `11-one-cent.mp4` | +0.01, refused: “One cent. Worthless.” | | **Hard cut to silence**: no music, no voice |
| 1:48 | `12-why-face-id.mp4` | Why Face ID, not a password | | The music comes back, softly |
| 2:00 | `13-specs.mp4` | Four spec cards, 4 s each | | One card on each beat |
| 2:16 | `14-real.mp4` | What's real, what's ours | | Steady, lower |
| 2:29 | `15-close.mp4` | The closing line as a card, Max's name | **Max on camera** with `overlays/15-close.png`, or his voice over this card | Low, under Max's voice |
| 2:43 | `16-end.mp4` | “Try it yourself”, https://kit11.max-31b.workers.dev/try/sign | | The last swell; fade out with the picture |

## Max's recordings

1. **Face ID (1:04, 8 s).** His iPhone approving a test proposal with Face ID, cut from his /try/sign recording
   (3 below; [opnames-max.md](opnames-max.md), 1): the Face ID sheet only, not the page's terms, which are not P-0005's.
   Put it on the track above `08-faceid.mp4`, scale it so the phone fills the picture between the bars, and put
   `overlays/08-faceid.png` above it: the label says it was filmed after the run, on a test proposal, with test money.
   Keep that label on screen the whole time.
2. **The opening and the closing line.** The opening is his voice over `03-pen.mp4` (“So who holds the pen? I'm Max
   Geurtsen, and this is Purser.”). The closing (2:29) is Max on camera, with `overlays/15-close.png` (his name, lower
   left) above it; or only his voice over `15-close.mp4`, which shows the same line as text.
3. **/try/sign (1:24, 16 s).** His own visit to the live page on his phone, signing with Face ID and then pressing
   “Try to tamper” ([opnames-max.md](opnames-max.md), 3). Use it with `overlays/10-try-sign.png`, or keep the rendered
   mock, or cut between the two. The tamper and its refusal then play again, large, in `11-one-cent.mp4`.
4. **The other lines** are in [script.md](script.md), each with the second it starts. Max reads them too, in his own
   voice ([opnames-max.md](opnames-max.md), 4); the end card is `16-end.mp4`.

## Music

Royalty-free and slowly building, one track for the whole film, cut so it hits at 1:12 and stops dead at 1:40.

- **Where to find it:** the YouTube Audio Library (YouTube Studio → Audio library; filter on “Attribution not
  required”, genre Cinematic or Ambient, mood Inspirational or Dramatic), or Pixabay Music (search “cinematic build”
  or “ambient build”; the Pixabay Content License). We name no track here: pick by ear, check the track's licence,
  and keep its name and licence for the video's description.
- **Where it hits and where it goes silent:** see the table above. In short: silence for the first line; low from the
  title; building through the diagram and the price rise; thin under the approval card and the Face ID; the first hit
  on “6 seconds”; building on /try/sign; **silence from 1:40 to 1:48** (“One cent. Worthless.” stands alone); back,
  softly, for the password line; on the beat for the spec cards; low under Max's closing; the last swell on the end card.
- Under a voice, keep the music 18 to 22 dB lower.

## Cutting it

**DaVinci Resolve**

1. New project; in Project Settings set the timeline to 1920×1080 and 60 frames a second **before** importing.
2. Import the fifteen clips and put them on V1 in order (or `master.mp4` as one piece, to cut against).
3. Recordings on V2 at their slot (table above), scaled into the picture between the bars; the overlay PNG on V3 for
   the slot's full length.
4. Voice-over on A1 at the times in [script.md](script.md); the music on A2, lowered under the voice; nothing at
   1:40–1:48.
5. Subtitles: File → Import → Subtitle, `subtitles.srt`; or leave them off and give YouTube the `.srt` (below).
6. Deliver: the YouTube 1080p preset, H.264, 60 frames a second (30 is fine if a phone recording is 30), and check
   the length: 3:00 or less.

**CapCut** (desktop or phone): a 1080p, 60 fps project; the clips in order on the main track; recordings and the
overlay PNGs as overlay layers; voice and music as audio layers; export at 1080p, 60 fps.

**Upload:** YouTube, visibility **Unlisted**. Add `subtitles.srt` as English captions. In the description: “Test money
only: the Airwallex sandbox and Metal testnet”, the music's name and licence.

## Before you upload

- 3:00 or less.
- Nothing private on screen: no keys, e-mail addresses, notifications, other tabs or bookmarks.
- Every recording slot keeps its label: the Face ID's “test proposal (test money)” and the /try/sign test world.
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

Earlier drafts (`hybrid-script.md`, `script-v0.md`, `review-2026-11-02.md`) are kept for the record; the premiere
replaces them. Max's own wording for the opening and the closing is in [max-opening-close.md](max-opening-close.md).
The earlier animated film of the 30 October recording still renders with `npm run video -- --film` (into
`out/video/film/`); it is not the submission video.

# The premiere: edit guide

**Film v10 (13 November), the enterprise hand-in, is the hand-in video now: [its section below](#film-v10-13-nov-enterprise-hand-in).**
**Purser in 3:58**, film v8 (7 November), the earlier submission video: the premiere-style film made
from the main run of 3 November 2026 (world `main-1`, [run log](../runs/2026-11-03-main-run.md)), with the two live runs
of 7 November (awx-1 on Airwallex alone, [run log](../runs/2026-11-07-awx-1.md); the Airi run, Visa Intelligent
Commerce via Airwallex's Airi, [run log](../runs/2026-11-07-vic-1.md)) and a recorded walk of the live /try/sign page.
Dark, large and slow, letterboxed to 2.39:1. Every figure on screen is read from its run's record by code, and the
render stops when one is missing. The voice-over is [narrator-script-v6.md](narrator-script-v6.md) read by an
AI-generated voice (ElevenLabs), a narrator in the third person, with AI-generated music (ElevenLabs); the film needs no
recording of Max. The end card credits both: “Voice-over: an AI-generated voice (ElevenLabs) · Music: AI-generated (ElevenLabs)”.
The render has **no music and no audio track**, and the mix (voice, music, loudness) is done afterwards to the scene
times in `scenes-v6.json`; [elevenlabs-studio-prompt-v6.md](elevenlabs-studio-prompt-v6.md) is the prompt for ElevenLabs
Studio, written from the same times. The script with every picture, line and source is
[premiere-script.md](premiere-script.md); the voice-over with its times is [script.md](script.md).

Film v5 (2:42, 5 November, the main run only) is kept as it was: [narrator-script.md](narrator-script.md),
[premiere-script-v5.md](premiere-script-v5.md), [script-v5.md](script-v5.md), `scenes-v5.json` and `subtitles-v5.srt`.

## Film v10 (13 Nov): enterprise hand-in

**Purser: the enterprise hand-in**, 4:58, **the hand-in video** for the Airwallex Agentic Banking Hackathon (Kit 11).
It shows what Purser is today, at a company's scale: Purser Cloud as the place where a company runs Purser (its demo
company: the Agents tab, Invoices & books, the Tokenisation tab), the approval alerts (WhatsApp, e-mail, Slack, Teams:
built, live once Twilio keys are set), the hands-on demo recorded from the live page, the layers of security with the zero-trust
report and the hostile-model eval, Claude's decisions checked by code, the partners' runs (Airwallex, Metal, Visa via
Airi, T:0), the proof page, and what is not done. Film v8's look: dark, large and slow, letterboxed to 2.39:1 (black
bars of 138 px), the captions in the bar below and the badges in the bar above.

Nobody is on camera and nobody recorded anything by hand. Every line is read by an **AI narrator** (ElevenLabs; the
voice is “Ian” from ElevenLabs' voice library, `src/film/narrator10.ts`: the repository does not record which stock voice
v6/v8 used, so this is a calm, warm, neutral English narrator), over **AI-generated music** (ElevenLabs), mixed with
`src/film/mix.ts` to -14 LUFS (two-pass loudnorm, then a limiter: measured -14.4 LUFS integrated, true peak -1.2 dB),
the music about 21 dB under the voice. The music is one 293 s ElevenLabs track; for 4:58 its own soft opening is
crossfaded onto its end (ffmpeg, 3 s), as a new take of that length was over the account's remaining credits. The end card
says so: “Voice-over and music: AI-generated (ElevenLabs)”, and “Test money only”.

The hand-in script's placeholders (`handin-script.md`: M1, M2, P2a–c, S1) are gone:

| Was | Now |
|---|---|
| M1, the owner on camera (the opening) | The AI narrator over a title card (“AI agents are starting to pay company bills. / Who signs off?”) and Home |
| P2a–c, the owner's phone recording of /try | `npm run record-try10`: the live hands-on demo (purser-try.max-31b.workers.dev/try, after #284), walked once in headless Chromium at phone size, the passkey a CDP **virtual test passkey**, one test company (test money on the simulated bank, deleted after 24 hours), no other write and no money rail. Cut into four windows at the walk's marks, nothing sped up; what the page said at each mark is in [recording-try-v10.json](recording-try-v10.json) |
| S1, the owner's screen recording of the console | Page shots of Purser Cloud's **demo company** (the sign-in page's “Try as guest”: read only, made-up data, test money), each badged “Demo company · made-up data · test money” |
| M2, the owner on camera (the close) | The AI narrator over a title card |

Every claim is a row of `src/film/claims.ts` (C47–C55 are new; the attack count of C47, of the narration and of the caption is read from
`docs/zero-trust/report.json` by `src/film/zeroTrust.ts`, so a new attack there changes the film's words: the zero-trust report, the hostile-model eval, the alerts,
Cloud's tabs, /try's approval card, the payee check, the batch, the invoice token, the anchor), and `npm run cut --
--check` checks every number said or shown against its record. The words: [film-v10-script.md](film-v10-script.md) (the
script table with claim ids), [film-v10-shots.md](film-v10-shots.md) (the shot list) and [film-v10.srt](film-v10.srt)
(the subtitles), written by `npm run cut -- --docs handin-10`; [film-v10-youtube.md](film-v10-youtube.md) has the
chapters and the description. Six stills are in [stills-v10/](stills-v10/).

**The file** (not in git, as every film before: `out/` is ignored): `out/video/v10/purser-v10.mp4`, 1920×1080, 60 fps,
H.264 (CRF 16) with AAC 320 kb/s, 4:58 (298.0 s), about 44 MB, and `out/video/v10/purser-v10.srt` next to it (the same as
[film-v10.srt](film-v10.srt)). Made again with:

```sh
npm ci
VIDEO_OUT=out/video/v10 npm run capture -- X-home X-cloud-overview X-cloud-agents X-cloud-books X-cloud-tokens \
  X-security X-attacks X-hostile X-claude X-books X-awx-card X-awx-locks X-awx-payee X-faceid-chain X-refused \
  X-anchor X-visa X-visa-n X-t0 X-proof                       # the page shots, 1600x669 at 2x, into out/video/v10/shots/
npm run record-try10                                          # ONE live walk of /try (one test company); --recut re-cuts it
npm run voice10 && npm run voice10 -- --music                 # the narration (one WAV a row) and the music (ElevenLabs)
VIDEO_OUT=out/video/v10 npm run cut -- handin-10 --vo out/video/v10/vo --music out/video/v10/music.mp3
```

`npm run voice10` needs ElevenLabs: `ELEVENLABS_API_KEY` in the environment, or a session whose proxy injects the key
for api.elevenlabs.io (it calls the API through curl). It stops when a line is longer than its row. Without a voice,
`npm run cut -- handin-10 --draft` burns the narration in as a line at the bottom, so the picture can be checked.

What is labelled on screen: “Simulated bank · test money” and “Recorded from the live page · virtual test passkey” on
/try; “Demo company · made-up data · test money” on Cloud; “Built · live once Twilio keys are set” on the alerts; “Test harness
· stand-in rails” on the attacks and “Test data · no network” on the hostile-model eval; “Airwallex sandbox · test
money”, “Metal testnet · test USD”, “Airi test card · test money” and “Sandbox · test data” on the partners' runs; the
narration says “simulated settlement” for every payout PAID in the Airwallex sandbox. No N/N fraction is said or shown
(`test/film-v10.test.ts`), and the shots were framed so none on the pages is in view.

## Film v8 (7 November, night): 3:58, every scene long enough to read

Max: the film may run up to five minutes, so it can be slower and better. Every scene is longer (the table below);
03-agents now names each agent as its card lights (the cards follow the voice, `litAt`), and 05b-treasury reads both
options. The voice is the same ElevenLabs voice and settings: v6's takes for the lines that did not change, new takes
for 03, 05-price, 05b, 13c and 14-real, each placed at its line's time in the script. New music (ElevenLabs) for 3:58.
Every scene was rendered again at full quality, except 11-turn: the walk of the live page is v6's clip (the recording
is not in this checkout), 13 s as before. Encoded at CRF 14 with 320 kb/s audio, -14 LUFS.

## Film v7 (7 November, evening): slower to read, the second Airi run, new music

Still 2:59. After Max's review (the slides went too fast to read; the voice did not read all of "what's real"; is the
price rise clear; better music):

- **10-why is out** (12-tamper shows the same point); its 8 seconds go to 05-price (+3), 14-real (+3), 07-dispute (+1)
  and 13b-awx (+1).
- **05-price** says what the price is: "Stockline, our data supplier, doubled its price", "test USD for each stock check
  the agent buys"; the voice: "from two to four cents a stock check, past the three-cent cap on the Sourcing agent's
  mandate". The full hash and the long footnote are off the screen (the short hash, the explorer and "let through on
  purpose" stay).
- **14-real**: the voice reads both columns as the screen has them.
- **13c-airi** shows the second live Airi run (vic-2, [run log](../runs/2026-11-07-vic-2.md)) as its third row:
  "✕ Changed after Face ID · EUR 30 → 190 · not what the CFO signed · Airi was never asked", and "5 of 5 and 7 of 7
  checks"; the disallowed merchant stays in Max's line above the rows.
- **New music** (ElevenLabs, AI-generated, on the new scene times), mixed about 13 dB under the voice and 6 dB under it
  between lines (v6: 18–22 dB under), silent for the second before "One cent. Worthless."
- The new voice lines (05-price, 13c, 14-real) are the same ElevenLabs voice and settings as v6's; every other line is
  v6's take, moved with its scene. Only the changed scenes were rendered again. The file names in this folder keep
  their v6 names.

## What changed since v5

- **The hook:** “AI agents are starting to spend money.” (was “can now”: accuracy).
- **11-turn:** the labelled mock of /try/sign is replaced by a recording of the live page, walked once in headless
  Chromium with a virtual authenticator (`src/cli/recordTrySign.ts`): Claude Sonnet reads the invoice, Claude Opus
  advises, Face ID signs, one cent changed is refused, a planted trick is blocked. It is labelled “Recorded from the live
  page · test world · test money”, and says that it is cut to its steps and that the passkey was Chromium's virtual
  authenticator. What the page showed is in [recording-trysign-v6.json](recording-trysign-v6.json); the film says only
  what the page labelled (the live models), and stops otherwise.
- **13b-awx (new):** awx-1: Airwallex itself declined a charge over the limit (`LIMIT_EXCEEDED`) and one in the wrong
  category (`MERCHANT_CATEGORY_NOT_ALLOWED`); the agent asked the CFO for a raise instead of retrying; the hash the CFO
  signed rides in Airwallex's SWIFT payout metadata. Figures from `docs/demo/airwallex-run.json`.
- **13c-airi (new):** Visa Intelligent Commerce via Airwallex's Airi: paid alone (EUR 12.00), paid after Face ID
  (EUR 45.00, P-0002), refused by Purser; 5 of 5 checks; “Airwallex sandbox · test card · test money”. Figures from
  `docs/demo/airi-run.json`.
- **Trimmed to 2:59:** 05, 06, 07, 09, 10, 12, 13, 14 and 16 are shorter; 13b-value is now `13d-value`; 13-proof names
  the main run on screen.

## The files

`npm run video` makes everything below in `out/video/` (not in git): every frame is drawn at 3840×2160 and scaled down
with lanczos, then encoded with x264 at preset slow, CRF 14, so small text stays crisp. On a 4-CPU machine in three
parallel runs (the clips split three ways) it took about half an hour. It needs the walk of the live page at
`out/video/recordings/trysign-live-1.mp4` (below); the words are also in this folder.

| File | What it is |
|---|---|
| `clips/01-hook.mp4` … `clips/16-end.mp4` | One clip per scene: 1920×1080, 60 frames a second, silent, the picture letterboxed to 2.39:1 (black bars of 138 px above and below). Each clip fades in and out over the background, which runs on the film's own clock, so in order the clips join seamlessly; the hook is on black. |
| `overlays/08-faceid.png`, `overlays/11-turn.png` | Transparent 1920×1080 PNGs: the letterbox bars with the corner credits, and the label for a recording laid over that scene, for an editor who lays a recording in by hand. |
| `master-v6.mp4` | **The deliverable picture:** all clips in order (3:58 in v8), no audio track, no burned-in subtitles, the walk of the live page laid into 11-turn. |
| `scenes-v6.json` | Each scene's `{id, start, end}` in seconds, for the mix (a copy is in this folder). |
| `subtitles-v6.srt` | The voice-over as English subtitles, each line about half a second into its scene, for YouTube's captions (a copy is in this folder). Nothing is burned in. |
| `elevenlabs-studio-prompt-v6.md` | The prompt for ElevenLabs Studio: the voice brief, every line at its time, the music brief on the cuts (a copy is in this folder). |
| `script.md`, `premiere-script.md` | The voice-over with its times, and the script table (copies are in this folder). |

Again: `npm run video` for everything; `npm run video -- 13c-airi` for one clip (the master is rebuilt when every clip
is there); `npm run video -- --stills` for three PNGs of each scene in `out/video/stills/`; `npm run video -- --docs`
for the files in this folder; `VIDEO_PREVIEW=1 npm run video` for a quick preview (drawn at 1×, x264 veryfast, CRF 18),
not the deliverable. The film still reads the README's test line and its tests badge, and renders nothing when they
disagree; the proof scene shows 24/24 and the run's stops, not the test count.

## Which clip goes where

The times are the scenes' (`scenes-v6.json`); the music is cut to them afterwards. **The drop goes on the cut to
`09-six.mp4` (1:49).**

| Time | Clip | What | Recording |
|---|---|---|---|
| 0:00 | `01-hook.mp4` | Black, a beat of silence, then “AI agents are starting to spend money.” slams in; at 3.6 s a hard cut to “So who signs off?”, a pen stroke drawn under it | |
| 0:07 | `02-purser.mp4` | The wordmark Purser, a line drawn under it, and the core line in two lines | |
| 0:13 | `03-agents.mp4` | Three Claude agents, their cards 0.7 s apart and each lit 3 s in turn: name, model, job, its own Airwallex card and its own Metal mandate (as the run began); “The rails and the code hold the limits.” | |
| 0:35 | `04-how.mp4` | The diagram: agent → rules → person → Airwallex or Metal → books; a refused payment: the Airwallex or Metal box flashes red, “Refused at the limit” under it, both gone within a second | |
| 0:46 | `05-price.mp4` | The price rise; let through on purpose; Metal refuses; the tx | |
| 1:02 | `05b-treasury.mp4` | Treasury's two options (P-0002 A: the Sourcing agent's cap to 0.04, our price stays 0.05; P-0003 B: our price to 0.07), both within the same 20.00; A signed with Face ID at 11:26:28 UTC; “four eyes · second approver: a labelled test passkey” | |
| 1:17 | `06-metal.mp4` | 86 payments, each its own transaction on Metal testnet, no emulator; + 6 mandate transactions, 1 refusal on chain | |
| 1:25 | `07-dispute.mp4` | Twelve orders, three refunded, “refund the other 9” rejected with Face ID | |
| 1:38 | `08-faceid.mp4` | P-0005's approval sheet, its exact terms; Face ID, then “Approved”, labelled as a reconstruction with the real Face ID's time (11:31:18 UTC) | |
| 1:49 | `09-six.mp4` | 6 seconds from Face ID to PAID, counting up from the cut; “In the sandbox, the settlement is simulated.”; the transfer id; “Every id is on /proof” | |
| 2:02 | `11-turn.mp4` | The walk of the live /try/sign page in a phone frame, cut to its steps; beside it each step as it comes; “Recorded from the live page · test world · test money” | `recordings/trysign-live-1.mp4`, laid in by `npm run video` |
| 2:15 | `12-tamper.mp4` | +0.01, refused; a second of silence; “One cent. Worthless.” at 2:20.1 | |
| 2:23 | `13-proof.mp4` | The main run named; 24/24 decisions by Claude; the run's stops (2:25.6): the figure with “nothing paid over a limit”, then who stopped what in four rows, each as the voice names it | |
| 2:38 | `13b-awx.mp4` | awx-1 (7 Nov): `LIMIT_EXCEEDED` and `MERCHANT_CATEGORY_NOT_ALLOWED`, each declined by Airwallex; the raise asked of the CFO (P-0001), approved with Face ID; the signed hash in the SWIFT payouts' metadata, both PAID; the run's own label | |
| 2:53 | `13c-airi.mp4` | “Visa Intelligent Commerce via Airwallex's Airi: a live run (7 Nov)”, Max's line; ✓ Within the limit (EUR 12.00) · ✓ Paid after Face ID (EUR 45.00, P-0002) · ✕ Changed after Face ID (EUR 30 → 190, the second run); “5 of 5 and 7 of 7 checks”; “Airwallex sandbox · test card · test money” | |
| 3:10 | `13d-value.mp4` | “The agents do the work. The CFO signs only the exceptions.” | |
| 3:16 | `14-real.mp4` | What's real, what's ours; the voice reads both columns | |
| 3:29 | `15-close.mp4` | The ending mirrors the intro: “A price shock.” / “A dispute.” / “A euro bill.”, the closing line in two lines, then the intro's wordmark with “Starter Kit 11” (3:40); Max's name lower left; under the narrator's closing line | |
| 3:44 | `16-end.mp4` | “Try it yourself”, https://kit11.max-31b.workers.dev/try/sign; from 3:47.5 the end credits (text only, no logos): who does what (built by Max Geurtsen; Airwallex, Metal and Claude by Anthropic, each with its role); thank you to Airwallex, Visa, Metal, Anthropic and the hackathon organisers and mentors; the AI-generated voice and music; test money only; the end at 3:58 | |

## Recordings

Nobody records a voice. One recording is in the film, made by code, not by hand:

1. **The walk of the live /try/sign page (11-turn).** `npx tsx src/cli/recordTrySign.ts --name trysign-live-1` (writes
   `out/video/recordings/`): headless Chromium at phone size (390×844, dark), the visitor's Face ID played by
   Chromium's virtual authenticator, the page's own test world only. Each walk spends real Claude calls on the live
   page (the reader, the advice, the trick's reader): v6 was made from one walk (7 November, 15:43 UTC). `npm run video`
   lays it into the phone frame, cut to the windows in `RECORDING` (`src/film/premiere.ts`), each inside one step of
   the walk as [recording-trysign-v6.json](recording-trysign-v6.json) times it. Copy that file's labels from the new
   walk's `.json` when the walk is recorded again; the film stops if the page did not label the reader and the advice
   as the live Claude models.
2. **The voice-over:** an AI-generated voice (ElevenLabs), the narrator, in the third person; the lines in
   [narrator-script-v6.md](narrator-script-v6.md), each placed about half a second into its scene ([script.md](script.md)
   has the times; [elevenlabs-studio-prompt-v6.md](elevenlabs-studio-prompt-v6.md) puts them on the timeline).
3. **Not used: a phone recording of Face ID.** `npm run video` can still lay a portrait (9:16) recording into 08's
   phone frame, with its honesty label, and rebuild the master:

   ```sh
   npm run video -- 08-faceid --slot 08-faceid=<faceid.mov>@<start>-<end>
   npm run video -- 11-turn --slot 11-turn=<walk.mp4>@<start>-<end>,<start>-<end>
   ```

   `@<start>-<end>` (seconds) takes a window, and several, comma-separated, are joined with hard cuts. Windows longer
   than their scene play faster to fit, and the scene says so (“shown at 1.25× speed”); shorter ones hold the last
   frame. In an editor instead, put the recording above the clip and the scene's overlay PNG above it.

## Music

Not in this render: the mix session adds it to `scenes-v6.json`.

- **The track:** AI-generated (ElevenLabs). The end card credits it with the voice: “Voice-over: an AI-generated voice
  (ElevenLabs) · Music: AI-generated (ElevenLabs)”.
- **The drop:** on the cut to `09-six` (1:49), where “6” counts up. Leave the second before “One cent. Worthless.”
  (1:43.75 to 1:44.75) silent.
- Under a voice, keep the music 18 to 22 dB lower.

## Cutting it

**ElevenLabs Studio** (as for v5): upload `master-v6.mp4` and paste [elevenlabs-studio-prompt-v6.md](elevenlabs-studio-prompt-v6.md).
To check the picture and the words first, `preview-v6-subtitled.mp4` (made next to the master, not in git) has the
subtitles burned in and no voice.

**DaVinci Resolve**

1. New project; in Project Settings set the timeline to 1920×1080 and 60 frames a second **before** importing.
2. Import `master-v6.mp4` on V1 (or the twenty clips in order).
3. The voice files (the narrator, ElevenLabs) on A1 at the times in [script.md](script.md); the music on A2, lowered under the voice.
4. No subtitles in the picture: give YouTube the `.srt` (below).
5. Deliver: the YouTube 1080p preset, H.264, 60 frames a second, at a high bitrate (the small text must stay crisp),
   and check the length: 3:58, under five minutes.

**CapCut** (desktop or phone): a 1080p, 60 fps project; `master-v6.mp4` (or the clips in order) on the main track;
voice and music as audio layers; export at 1080p, 60 fps.

**Upload:** YouTube, visibility **Unlisted**. Add `subtitles-v6.srt` as English captions. In the description: “Test
money only: the Airwallex sandbox, Metal testnet and a test card” and “Voice-over: an AI-generated voice (ElevenLabs) ·
Music: AI-generated (ElevenLabs)”.

## Before you upload

- 3:58, under five minutes.
- Nothing private on screen: no keys, e-mail addresses, notifications, other tabs or bookmarks; the walk of /try/sign
  shows only the page's public test world (no one-time Airi link, no viewer key).
- The Face ID scene keeps its label (“Reconstruction of the approval screen …”), and the walk of the live page its own.
- No logos of others anywhere (the rendered clips have none; the recorded page shows Purser's own mark only).
- The AI-generated voice and music, and `16-end.mp4` as the end card, which credits both.

## How the clips are made

`src/film/premiere.ts` reads every figure from `docs/demo/main-run.json`, `docs/demo/airwallex-run.json` and
`docs/demo/airi-run.json` (and the test count from the README's test line, the one-cent example's figures from the
/try/sign page's code, and what the recorded page showed from `recording-trysign-v6.json`) and stops when one is
missing; `src/film/premiere.html` draws each scene from those strings and types in no figure of its own;
`src/film/premiereScript.ts` holds the scenes' times; the voice-over is the narrator's script in
narrator-script-v6.md, read by premiere.ts and checked against the records. `npm run video` (`src/cli/video.ts`) plays
the page on a virtual clock, one frame every 1/60 s, so every clip is exactly its length at 60 frames a second.
`test/premiere.test.ts` counts the figures again from the records and fails on a difference, a missing figure, a figure
typed into the page, or a file in this folder that the code would write differently.

**The look.** Behind the text, calm and still: deep navy (#0a1020), a very faint static dot grid (a dot every 36 px,
white at 7%), a soft vignette, and a drift of half a pixel a second, hardly seen; in the picture only, never the bars.
It fades in from 0:07, so the hook stays on black. In the top bar, 0:07 to 3:44, quiet: “Max Geurtsen ·
Purser” left and “Built on Airwallex · Metal · Claude” right (Inter Medium 20 px, grey: white at 46%, 64 px from the
edges), text only, no logos. Every text colour is WCAG AA over the brightest point of that background (a dot; the
test computes it), and the corner credits 4.6:1 on the black bar.

The earlier drafts and their review left the tree on 12 November 2026 (git history keeps them); the premiere replaced
them. One draft stays, `hybrid-script.md`, because the requirements review of 1 November cites it as its source.
The earlier animated film of the 30 October recording still renders with `npm run video -- --film` (into
`out/video/film/`); it is not the submission video.

# The video

`npm run video` records the 4:30 video from the recorded pages, with no laptop and no screen recorder: the words, the
subtitles and every shot are in one file, `src/video/plan.ts`, so they cannot drift apart.

| File (in `out/video/`) | What it is |
|---|---|
| `master.mp4` | The silent master, 1920x1080, 60 frames a second, 4:30. |
| `master-subtitled.mp4` | The same with the English subtitles burned in. |
| `clips/b1-hook.mp4` … `clips/b8-vision.mp4` | One clip per beat, to cut and pace in an editor. |
| `subtitles.srt` | The English subtitles, timed to the master (a copy is in this folder). |
| `script.md` | The voice-over script with the time each beat starts (a copy is in this folder). |

## How it is made

- The pages are the recordings the relay and `npm run judge` serve: the landing page, the recorded CFO dashboard
  (Overview, Agents, Disputes, Books), the Scenario Lab, Purser live and the Dispute desk report. Nothing on screen is
  staged for the video; every number comes from a recorded run.
- The browser runs on a virtual clock. Each frame moves it by 1/60 s and is then captured, so animations play at
  exactly 60 frames a second and nothing loads or stutters on screen, however slow the machine.
- A camera does the zooms: each frame is a crop of the 1440x810 page, drawn by the browser at 1920 pixels wide, so
  text stays sharp when the camera moves in. Scrolls are eased by the same clock. The cursor is a highlighted dot
  that glides to what the voice talks about.
- `npm run video -- --check` checks the plan in seconds: every element a shot points at is on its page.
- `npm run video -- b5-metal` records one beat again.

## Putting it together (CapCut on a phone)

1. Read `script.md` aloud over `master.mp4`; each beat starts at the time shown. About 150 words a minute leaves room.
2. Import `master.mp4` (or the clips) and the voice recording; line up the beats.
3. Import `subtitles.srt` as captions, or use `master-subtitled.mp4`.

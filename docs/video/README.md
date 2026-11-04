# The video

**The submission video's script is [docs/video-script.md](../video-script.md)** (the main run of 3 November only,
filmed on `/watch`, with Max's opening and closing). The film below plays the 30 October recording and is not the
submission video.

`npm run video` records the film (2:53, one continuous animated piece) with no laptop and no screen recorder. The film
is a page, `/film` (`src/film/film.html`), whose ten scenes and words are in `src/film/script.ts` and whose every number
comes from the recorded runs (`src/film/film.ts` throws when a fact is missing); `src/video/plan.ts` turns the scenes
into shots, so words, subtitles and pictures cannot drift apart.

| File (in `out/video/`) | What it is |
|---|---|
| `master.mp4` | The silent master, 1920x1080, 60 frames a second, 2:53. |
| `master-subtitled.mp4` | The same with the English subtitles burned in. |
| `clips/01-open.mp4` … `clips/10-end.mp4` | One clip per scene, to cut and pace in an editor. |
| `subtitles.srt` | The English subtitles, timed to the master (a copy is in this folder). |
| `script.md` | The voice-over script with the time each beat starts (a copy is in this folder). |

## How it is made

- The film page draws every scene from what the relay and `npm run judge` serve: the recorded run, the Scenario Lab
  and red team reports, and the live runs. Nothing on screen is invented for the video; every number comes from a
  recorded run, and the film page refuses to draw when one is missing.
- The browser runs on a virtual clock. Each frame moves it by 1/60 s and is then captured, so animations play at
  exactly 60 frames a second and nothing loads or stutters on screen, however slow the machine.
- The film keeps its own clock: the recorder sets the film's time for every frame (`?manual`), so each scene plays
  at its exact length.
- `npm run video -- --check` checks the plan in seconds: every element a shot points at is on its page.
- `npm run video -- 06-metal` records one scene again; the master is rebuilt when every clip exists.

## Putting it together (CapCut on a phone)

1. Read `script.md` aloud over `master.mp4`; each scene starts at the time shown. About 115 words a minute leaves room.
2. Import `master.mp4` (or the clips) and the voice recording; line up the beats.
3. Import `subtitles.srt` as captions, or use `master-subtitled.mp4`.

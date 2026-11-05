# Video script

**The submission video is the premiere:** [docs/video/premiere-script.md](video/premiere-script.md) is its script, a
table with every picture, line on screen, voice-over line and the source of each figure. It tells one run only: the
main run of 3 November 2026 (world `main-1`, [run log](runs/2026-11-03-main-run.md)). Test money throughout.

- How to cut it, which clip goes where, and where the music hits and goes silent: [docs/video/README.md](video/README.md).
- What Max records (the voice-over with the opening and the closing line; optionally, signing on `/try/sign`): [docs/video/opnames-max.md](video/opnames-max.md).
- The voice-over with its times: [docs/video/script.md](video/script.md); the subtitles: `docs/video/subtitles.srt`.

The film is rendered by `npm run video` from `src/film/premiere.ts`, which reads every figure from the run's record
(`docs/demo/main-run.json`) and stops when one is missing; `test/premiere.test.ts` counts each figure again from the
record. This page names only the figure the other documents share. The spec card says **2 stopped at a limit**:
Metal refused the purchase let through on purpose over the mandate's cap, and Max rejected “refund the other 9” with
Face ID. The site shows one more line directly below that figure, which the film leaves out because it is another
run's, not counted: “Airwallex declined EUR 45.00 over the card limit (LIMIT_EXCEEDED), separate TAP run, 2 November”.

`/try/sign` is live on the hosted site: the film's scene shows a viewer signing in a test world of their own, then the
same signature refused for the amount plus 0.01. The Face ID scene is a rendered reconstruction of P-0005's approval
sheet, labelled as one, with the time of the real Face ID in the run.

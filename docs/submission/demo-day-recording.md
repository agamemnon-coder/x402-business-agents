# Demo Day video: the recording pack

For Max, to record the Demo Day video in Screen Studio or Tella. The words, beat by beat:
[demo-day-video.md](demo-day-video.md). The night itself: [demo-day.md](demo-day.md).

The video is under 3 minutes, Max is on camera throughout, one use case, no slides, and it ends on the QR code. It is
recorded, so a beat that goes wrong is simply recorded again (section 6).

## 1. The organiser's checklist

Tick each one on the final cut, before sending it.

- [ ] Under 4 minutes (the script runs 2:55).
- [ ] The product is on screen within 30–45 seconds (it is from 0:00: the inbox with the forged invoice).
- [ ] No slides (the "What's next" list is typed on screen or shown as plain text over Max's frame, not a slide).
- [ ] One use case: one company's invoices, from a forged one to paid, booked and filed.
- [ ] Legible: browser zoom 125 %, text at least as large as the page's own headings on a phone screen when played
  back at 1080p.
- [ ] Camera and light: the camera at eye height, light from the front (a window or a lamp behind the laptop), no
  bright window behind Max.
- [ ] Followable without context: someone who has never heard of Purser understands each beat (test it on one person).
- [ ] Says why it matters (beat 7, the outcome) and what's next (beat 8).
- [ ] Watched fully, start to end, with sound, before sending.

## 2. Practice checklist (the evening before)

- [ ] Read the script out loud twice, with a stopwatch. Mark every sentence you stumble on and shorten it (the test
  `test/demo-day-pack.test.ts` recounts the words).
- [ ] Do the whole click path once without recording: every beat's screen is reachable in one or two clicks.
- [ ] Start a fresh test company on the `/try` page and file the sample invoices once, so you know the order they
  appear in.
- [ ] iPhone mirroring set up and tested (section 5), Face ID prompted once while mirrored.
- [ ] The QR code scanned from the screen with an iPhone and an Android phone; both open `/try` through
  `<short URL from /go>`.
- [ ] One full practice take recorded and watched back: sound level, light, legibility.

## 3. Which tabs to open, with which URLs

One browser window, a private one (no old keys or sessions), zoom 125 %, bookmarks bar hidden, these tabs in order:

1. **The hands-on page:** `/try` on the `purser-try` deployment, through `<short URL from /go>`. Start a new test company
   in it within the hour before recording.
2. **The public demo world of Purser Cloud** (read-only, three test companies, labelled stand-in): the demo deployment
   of stream cloud-demo-1112 ("Demo mode" in [docs/cloud.md](../cloud.md) once merged; not public until deployed).
   Open the company `northwind-outdoor`.
3. **The Airwallex runs:** [/airwallex](https://kit11.max-31b.workers.dev/airwallex) (awx-1 and the two-locks payout).
4. **Metal:** [/metal](https://kit11.max-31b.workers.dev/metal), with #24's refusal and its transaction.
5. **The runs:** [/runs](https://kit11.max-31b.workers.dev/runs) (the T:0 sandbox run) and the Moneybird sandbox run's
   record, [docs/runs/2026-11-12-moneybird-sandbox.md](../runs/2026-11-12-moneybird-sandbox.md) (not on /runs).
6. **The proof:** [/proof](https://kit11.max-31b.workers.dev/proof).
7. **The QR code**, full screen: an image of the code for `<short URL from /go>`, with the short URL printed under it.

## 4. The fixed scenario

Use the cloud demo's fixed world, company **Northwind Outdoor (test company)**: its main supplier's four invoices,
one of them forged (the same supplier and amount, a different IBAN), and an invoice above the limit waiting for the
CFO's signature. The world is built by `npm run cloud:seed-demo` from `src/demoworld/companies.ts` (stream
cloud-demo-1112; use it once merged). Every row in it is a stand-in and says so; nobody can sign in to it, so the
Face ID and one-cent beats are recorded on the hands-on `/try` page with its own sample invoices.

## 5. iPhone mirroring: set-up

Two ways to put the phone on screen. Test both once; use the one where Face ID prompts reliably.

**A. QuickTime over the cable (the phone stays in your hand; Face ID works as usual).**
1. Connect the iPhone to the Mac with its cable; unlock it and tap "Trust" if asked.
2. On the Mac: QuickTime Player, File, New Movie Recording; in the menu next to the record button choose the iPhone as
   the camera. The phone's screen appears in a window.
3. In Screen Studio or Tella, record that window as a second source, or record the screen area it sits in.
4. On the iPhone: Do Not Disturb on, brightness up, battery above 80 %, the `/try` page open in Safari.

**B. iPhone Mirroring on the Mac (macOS 15 or later, iOS 18 or later, the same Apple Account on both).**
1. On the Mac, open iPhone Mirroring and follow its set-up; keep the iPhone locked and near the Mac, Wi-Fi and
   Bluetooth on.
2. Open Safari on the mirrored iPhone and the `/try` page in it.
3. Test the sign step once: if Face ID does not prompt for the passkey while mirrored, use way A for beat 3.

Either way: nothing private on the phone's screen (no notifications, no other tabs).

## 6. The recording order

Record beat by beat, not in one take; the script's beats are the cuts.

1. **Camera check:** 10 seconds of Max saying the first line; play it back for sound and light.
2. **Beats 1 and 2** (tab 2, the demo world; then tab 1, the next invoice): the forged invoice held, then the invoice
   over the limit with its terms.
3. **Beats 3 and 4** (the mirrored iPhone, tab 1): sign with Face ID; then change one cent and send it with the same
   signature: refused.
4. **Beat 5** (tab 1, then tab 3 and tab 5): the signed invoice paid on the page's simulated bank, booked and filed; then
   awx-1's EUR 240.00 payout on /airwallex (Face ID, `PAID`, simulated settlement), the T:0 run on /runs and the
   Moneybird record.
5. **Beat 6** (tab 3, awx-1's `LIMIT_EXCEEDED`; tab 4, #24's refusal on Metal).
6. **Beats 7 and 8** (Max full frame; tab 6 for the outcome; "What's next" as plain text over the frame, no slide).
7. **Beat 9** (tab 7, the QR code, held for the last seconds).
8. **Edit:** cut the beats together in order, Max's camera in a corner throughout, captions on, export 1080p.
9. **Watch it fully, with sound**, and tick section 1.

## 7. On a retake

- A stumble or a slow page: record that beat again from its first sentence; the beats are cut points, so nothing else
  is redone.
- A page shows something other than the script expects (an error, a model unavailable): stop, note it, and fix the
  cause or change the words; never record words that do not match the screen.
- The `/try` company runs out (it has a time limit): start a new one and file the samples again before the next take.
- Face ID fails twice: switch to the other mirroring way (section 5), then record beat 3 again.
- Keep every take's file until the final cut is sent.

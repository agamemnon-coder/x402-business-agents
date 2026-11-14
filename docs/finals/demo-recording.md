# Demo Day recording kit

Demo Day is a **pre-recorded screen walkthrough** (2 to 3 minutes is ideal, 4 at most), then live Q&A in a 10-minute
slot. The organisers ask for:

- an intro under 30 s, with the product on screen by 30 to 45 s;
- one clear end-to-end use case, with the before and the after;
- the real product, not slides;
- a face-camera bubble, 1080p or better, the product full-screen, and a phone demo mirrored next to the desktop.

This kit is built on **recording mode**, `/try?present=1`. It is the real `/try`: Purser's engine, test money on a
simulated bank. The flag only adds the following (code: `cloud/src/try/presentMode.ts`; browser check:
`test/browser/present.check.ts`):

- **A 1920×1080 frame.** The type is larger and the contrast higher. The page column sits on the left, a lane for the
  mirrored phone on the right, and the bottom-right 340×340 px stays empty for the camera bubble. No step scrolls at
  1080p: a tall step is drawn up to 20% smaller, and "Paid, booked, filed" is laid out in two columns.
- **An opener card** (5 s, or press →): Before and After on one screen.
- **The phone lane.** On the Approve and Pay steps, a framed phone outline with the caption "The CFO's phone, mirrored:
  Face ID signs the exact terms". The mirrored phone window goes on top of it.
- **An outcome card** at the end, with this run's own numbers. Each figure is read in the browser from the API's
  answers to the page, or says "not in this run":
  - time from start to paid;
  - the amount paid;
  - the steps the engine recorded, and how many were Claude's;
  - whether the changed cent was refused, and by which layers.

  It ends with "Try it yourself: kit11.max-31b.workers.dev/try".
- **The test-money label** on screen at every step.
- **The presenter's keys:**
  - **→** clicks the step's own main button, the same click a person makes. After paid, it opens the "change one
    cent" step; after the refusal, it shows the outcome.
  - **R** starts again in recording mode with a new test company, in the same pool.
  - **O** shows the outcome.
  - **Escape** closes a card.

  Nothing is skipped or faked.

## The script (2:45), as talking points

The clicks are in **bold**. Talk over the screen and keep your sentences short.

### 0:00 – 0:25 · The problem (face bubble, opener card on screen)

- Before you start recording, open `/try?present=1#j=<jury token>` (see the switches below). The opener card is on
  screen.
- The point: companies are letting AI agents pay suppliers. Today an agent's invoice lands in a queue, and an approve
  button anyone can click pays whatever arrives, even if something was changed on the way.
- Purser: the CFO signs the **exact terms** with Face ID, and the rails enforce the limits too (Airwallex card
  controls and approvals, an Alta mandate, Visa via Airwallex's Airi).
- Point at the card: "Before, After." **→** closes the card.

### 0:25 – 0:55 · The product on screen: an invoice comes in

- **→** "Start with a test company": a real company of your own on Purser's engine. Test money, simulated bank.
- **→** sends the first sample invoice. Claude reads it and Purser's code checks it: the supplier, the bank account,
  the amount, and a copy of an earlier invoice.
  - If the sample is held as a copy, say "Caught: a copy of a filed invoice", then **→** and send the second sample.
- On "ready to pay", say: "The agent decides within its limits; anything above them waits for the CFO."

### 0:55 – 1:35 · The approval on the phone (the phone lane)

- **→** "Approve": the amount, the payee, the account ending, the due date. A short hash of the exact terms.
- In Chrome's passkey dialog choose **Use a phone or tablet**, and **scan the QR code with the iPhone**. The mirrored
  phone sits in the lane. **Face ID** on the phone.
- Say: "The CFO is not pressing a button. They sign these exact terms."
- Paid on the simulated bank. Booked in the ledger, debits equal credits, and the original and receipt are filed.

### 1:35 – 2:20 · Try to cheat: one cent

- **→** opens "change the terms". Type **1850.01** in the amount. **→** pays.
- "Refused by Purser": the signature is over other terms, and the payment check refuses it too. Nothing moved.
- Say: "One cent. The same signature does not cover it, and the bank leg will not move."

### 2:20 – 2:35 · The outcome (outcome card)

- **→** shows the outcome card. Read two numbers from it: the time from start to paid, and "refused by both layers".
  Everything on it is from this run.

### 2:35 – 2:45 · What's next, and how to try

- What's next: a company connecting its own Airwallex account to Purser (built, switched off today), and first pilots.
  Say plainly that there are no customers yet.
- "Try it yourself: kit11.max-31b.workers.dev/try. Test money, deleted after 24 hours." End on the card.

Mapping to their structure (scaled to 2:45):

| Their slot | Ours |
| --- | --- |
| problem, 0:00 – 0:30 | 0:00 – 0:25 |
| demo, 0:30 – 3:00 | 0:25 – 2:20 |
| outcome/metric, 3:00 – 3:30 | 2:20 – 2:35 |
| what's next / how to try, 3:30 – 4:00 | 2:35 – 2:45 |

## Recording settings

**Screen Studio** (or **Tella**):

- Record the display at 1920×1080. On a Retina Mac, set the display to "looks like 1920×1080", or record a
  1920×1080 window. Export at 1080p or 4K, 30 or 60 fps.
- Put the camera bubble at the **bottom right**, at most 320×320 px on the 1080p frame: the page keeps 340×340 px
  free there.
- Turn auto-zoom off, or keep it gentle. The page is already large, and zooming can hide the phone lane.
- Chrome full-screen with no tabs, or a clean profile. Dark mode. Hide the bookmarks bar. Zoom 100%: the page
  scales itself.

**The phone, mirrored next to the desktop:**

- For the QR scan and Face ID, the phone must be in your hand, so use **QuickTime** over USB: File → New Movie
  Recording → camera source: your iPhone. Place that window over the phone lane. Check in the rehearsal that the
  Face ID sheet shows in the mirror.
- iPhone Mirroring (macOS) needs the phone locked, so it cannot scan the QR code. Use it only to show the phone,
  not for this step.
- Tella and Screen Studio can record the QuickTime window as part of the screen.

## Pre-flight checklist (theirs, with ours)

- [ ] 2:30 to 3:00 long, 4:00 at most. Intro under 30 s, product on screen by 0:30.
- [ ] One use case end to end: an invoice, the check, the CFO's signature, paid, one cent refused.
- [ ] Before and after: the opener card.
- [ ] The real product: `kit11.max-31b.workers.dev/try?present=1`, not slides.
- [ ] A face camera bubble at the bottom right; the page's corner is free.
- [ ] 1080p or higher; the product full-screen; no notifications (Do Not Disturb on the Mac and on the iPhone).
- [ ] The phone mirrored next to the desktop, in the lane, during Approve.
- [ ] Test money said once out loud; the label is on screen throughout.
- [ ] The outcome card at the end, with this run's numbers; "Try it yourself" with the address.
- [ ] One rehearsal end to end with **R** between takes.
- [ ] V1 to Dan Kim on Slack for feedback.

## Switches on the day of recording

The recording uses the hosted demo (purser-try, through kit11). The owner sets these with `POST /v1/try/admin` on purser-try, with the platform admin's token:

```sh
op() { curl -sS https://purser-try.max-31b.workers.dev/v1/try/admin -H "Authorization: Bearer $PURSER_TRY_ADMIN_TOKEN" -H 'content-type: application/json' -d "$1"; echo; }
```
 No cap or ceiling changes here.

| What | Why |
| --- | --- |
| `{"op":"token","pool":"jury","until":"<end of the recording day>"}` | A pool token for the takes. Open `/try?present=1#j=<token>`, and **R** keeps it. Without it, retakes count against the public pool's limit of 5 starts per address per hour. An event token (`#e=`) works the same. |
| `starts` on | Nobody can start without it. |
| `claude` on, with the owner's caps (`cap_all_micros`, `cap_day_micros_jury` or `_event`, `cap_company_micros`, `cap_addr_micros`, `cap_action_micros`, `max_inflight`) | So the screen says "Claude reads live" and the outcome counts Claude's steps. Without them, Purser's code reads, labelled as such. |
| `agents` on (optional) | The agents' decisions on the "At work" step. |

## The screens

From a local run (`npx tsx test/browser/present.check.ts <dir>`), 1920×1080. Claude does not run there, so the
outcome says 0 of the steps were Claude's.

- [The opener](present-01-opener.png)
- [The approval, with the phone lane](present-05-approve-phone.png)
- [The outcome](present-09-outcome.png)

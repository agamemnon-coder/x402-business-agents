# Demo Day: the runbook

For Max. Demo Day is **Thursday 19 November 2026, 17:00–19:00 PT, which is 02:00–04:00 in the Netherlands** (Friday
night). The organisers **play our recorded video**, then the jury asks questions. The video's script is
[demo-day-video.md](demo-day-video.md), how to record it is [demo-day-recording.md](demo-day-recording.md), the answers
are in [qa.md](qa.md) and the per-company sheets in [jury/](jury/), and the one page beside the laptop is
[cheat-sheet.pdf](cheat-sheet.pdf). Every figure is from a dated run record; nothing here moves money.

The one line to come back to: "Claude explains and proposes, the rules in code hold every limit, and a person signs
before money moves beyond them."

## 1. The night itself

| When (NL) | When (PT) | What |
|---|---|---|
| Thursday 23:00 | 14:00 | Laptop and phone on the charger. Alarm set for 01:15. Video file and backup link checked once (section 2). |
| Friday 01:15 | 16:15 | Up. Water, light on, camera checked. Open the tabs of section 3 in one private browser window. |
| 01:45 | 16:45 | In the call, camera on, microphone tested; notifications off (Do Not Disturb; Slack and mail closed). |
| 02:00–04:00 | 17:00–19:00 | Demo Day. When our slot comes, the organisers play the video; then the questions (section 4). |
| After | | Note every question asked, word for word, in `docs/submission/qa.md` under a new heading, answered within a day. |

**Where the QR goes:** the video ends on a QR code to the hands-on page `/try` on the `purser-try` deployment, through
the short URL `<short URL from /go>`. If someone asks for the link in the chat, paste the short URL, not a long one.

## 2. Backups: the video, the demo link, offline

| What fails | Do this |
|---|---|
| **The organisers cannot play our file** | Paste the backup video link in the chat (the same file, uploaded unlisted, link tested that evening): `<backup video link>`. Keep the file itself on the desktop: `purser-demo-day.mp4`, ready to share the screen and play it from there, sound on. |
| **They ask to see it live** | The 3-minute demo path (section 5), from the backup demo link: the `purser-try` page `/try`, a test company started the hour before. |
| **The network is down** | The phone's hotspot. Still down: `npm run judge` in the repository, already started in a second terminal; it serves the site on `http://localhost:4311/` with no network and no key. Say: "The network is down, so this is the same site served from my laptop." |
| **Face ID fails live** | Try once more; then the laptop's own browser (Touch ID). Say: "Same check, another passkey." |
| **Screen sharing drops** | Send the deck PDF in the chat and talk over it: "Let me walk you through the slides while the screen comes back." |

## 3. Tabs to have open (one private window, in this order)

1. The video file, paused at 0:00 (only for when they ask us to play it ourselves).
2. The hands-on page `/try` on `purser-try` (`<short URL from /go>`), a test company started within the hour.
3. The public demo world of Purser Cloud (read-only, three test companies; stream cloud-demo-1112, its "Demo mode" in
   [docs/cloud.md](../cloud.md) once merged and deployed; until then it is not public).
4. [/proof](https://kit11.max-31b.workers.dev/proof).
5. [/runs](https://kit11.max-31b.workers.dev/runs): the live runs, newest first (the Moneybird sandbox run is not on it:
   open [its record](../runs/2026-11-12-moneybird-sandbox.md)).
6. `http://localhost:4311/` from `npm run judge` (reserve).

Nothing private on screen: no `.env`, no key, no viewer link, no mail. The terminal shows only the repository.

## 4. Questions: the technique

1. **Repeat the question** in one short sentence, so the room hears it and you get three seconds.
2. **Answer in two sentences.** The answers are in [qa.md](qa.md) (questions 27 to 33 are the seven most likely) and
   in [jury/](jury/), one sheet per company on the jury.
3. **Say "not tested yet" when it is not.** Exact, a real second approver, invoice tokens live on Metal, paying
   customers: each is "next", never "done". If you do not know: "Good question. I'll check and send it to you."
4. **Point to the QR code:** "You can try that part yourself: scan the code, sign with your own Face ID, change one
   cent."

Never: a figure you cannot point to, a partner's name as an endorsement, a competitor's name, a quote from anyone.

## 5. The 3-minute demo path (if asked to show it live)

Only if the organisers ask for a live demo instead of, or after, the video. The click path, with times; each step names
its URL and what to do if it fails. Performing it is Max's job; rehearse it once on the evening before.

| Step | Time | URL | Show | If it fails |
|---|---|---|---|---|
| 1. The problem | 0:00–0:15 | [Home](https://kit11.max-31b.workers.dev/) | AI agents are starting to spend company money; who signs off? | Local: `http://localhost:4311/` |
| 2. The invoice | 0:15–0:35 | `/try` on `purser-try` | File the sample invoice; the agents read it, each Claude call labelled | A sample that will not file: the second sample. The page down: the demo world (tab 3), its waiting invoice |
| 3. Forged IBAN refused | 0:35–0:55 | `/try` (the forged sample), or the demo world's held invoice | Held as possible fraud: changed bank details, no proposal | Say it and show [docs/runs/2026-10-29-fraud.md](../runs/2026-10-29-fraud.md) |
| 4. Face ID, then Airwallex | 0:55–1:30 | `/try` on the mirrored iPhone; then [/airwallex](https://kit11.max-31b.workers.dev/airwallex) | Sign the exact terms with Face ID; change one cent: refused. On `/try` the bank is simulated and says so; the Airwallex sandbox payouts are on /airwallex | Face ID fails: the laptop (Touch ID). /airwallex down: [the two-locks record](../runs/2026-11-12-airwallex-two-locks-paid.md) |
| 5. T:0, Moneybird and the vault | 1:30–1:55 | [/runs](https://kit11.max-31b.workers.dev/runs) (T:0); [the Moneybird record](../runs/2026-11-12-moneybird-sandbox.md); the `/try` company's vault | The T:0 journal sandbox run, the Moneybird sandbox run, then the paid invoice filed in the vault | Records: [T:0](../runs/2026-11-10-t0-journal-sandbox.md), [Moneybird](../runs/2026-11-12-moneybird-sandbox.md) |
| 6. The token on Metal | 1:55–2:10 | [the run record](../runs/2026-11-12-tokenize.md) | Said by record status: **one prototype run on Metal testnet, 12 November** (mint, finance, settle; the financier simulated; test money) | Skip it: "next" |
| 7. The agent overview | 2:10–2:35 | [/airwallex#awx-1](https://kit11.max-31b.workers.dev/airwallex#awx-1); [/metal](https://kit11.max-31b.workers.dev/metal) | An agent's own card declined over its limit (`LIMIT_EXCEEDED`); Metal refused #24 on chain | Local: `http://localhost:4311/metal` |
| 8. The proof | 2:35–3:00 | [/proof](https://kit11.max-31b.workers.dev/proof) | Every id, the Metal ones on chain; then the QR | Local: `http://localhost:4311/proof` |

## 6. The jury's criteria, and where the submission pitch of 7 November met them (kept for questions)

The criteria word for word, from [docs/rules.md](../rules.md) (Dan Kim, 5 October; no weights published). The
microsite's FAQ adds the deliverables: "A working demo, a short video walkthrough under five minutes, and a link to
your repository with setup instructions."

| Criterion (verbatim) | Moment in the 3-minute pitch | Proof (link or id) |
|---|---|---|
| Finance and product value | 0:15 who and what (a small company that sells live stock data per query; the rule: inside its limits an agent pays alone, beyond them the CFO signs); 2:05 the core line | [/](https://kit11.max-31b.workers.dev/); deck slides 2–3 |
| Airwallex relevance and financial context | 0:40, beat 3: FX for only the shortfall, SWIFT accepted by Airwallex with the signed hash (settlement simulated) | conversion `3ca88196-05da-4d88-9caa-796f03704636`; transfer `03360bfa-afce-457b-89d1-e1097fbe3985`; authorization `01a1a12f-4113-7000-b76d-014677710007`; if asked about Airi: the separate Airi run, 7 Nov (Airwallex sandbox, test card, test money), [/airwallex#airi-run](https://kit11.max-31b.workers.dev/airwallex#airi-run), qa.md 18–19 |
| Agentic behaviour and controls | 0:40, beat 1: Metal refuses; Treasury proposes options 40 s later; four eyes (the second signature from a test passkey, not a second person) | tx `0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871`; P-0002 |
| Technical execution | 1:50: every id published on /proof, the Metal ones on chain and checkable; `npm run verify`; 6034 tests | [/proof](https://kit11.max-31b.workers.dev/proof); 412 audit rows, hash-chained |
| "(1) a working end-to-end workflow for a clear user" | The whole run: 0:40–1:50 | [/replay](https://kit11.max-31b.workers.dev/replay) |
| "(2) Airwallex used for a necessary financial action" | Beat 3: the euro licence paid by SWIFT, euros bought by FX | transfer `03360bfa…3985` |
| "(3) financial context influencing what the agent decides" | Beat 1: the price rise; Treasury's two options within the same 20.00: A, Sourcing's cap to 0.04 and our price stays 0.05; B, the same cap and our price up to 0.07 | P-0002 (option A, signed), P-0003 (option B, superseded) |
| "(4) clear controls: what the agent can do, what requires approval, how it handles an exception" | Beats 1 and 2: Metal's cap, the refunds by Support itself, "refund the other 9" rejected with Face ID; 1:50 the jury signs | P-0004; [/try/sign](https://kit11.max-31b.workers.dev/try/sign) |

## 7. Rehearsal: the video, three takes

How to record and the order: [demo-day-recording.md](demo-day-recording.md). After each take, write the times. Where a
beat runs over by more than 3 s, cut a sentence there and note it.

| Beat | Target | Take 1 | Take 2 | Take 3 | Cut |
|---|---|---|---|---|---|
| 1. Forged IBAN caught | 0:22 | | | | |
| 2. Over the limit | 0:18 | | | | |
| 3. Face ID | 0:15 | | | | |
| 4. One cent | 0:15 | | | | |
| 5. Paid, booked, archived | 0:28 | | | | |
| 6. The agent refused | 0:27 | | | | |
| 7. The outcome | 0:15 | | | | |
| 8. What's next | 0:22 | | | | |
| 9. Try it yourself | 0:13 | | | | |
| **Total** | **2:55** | | | | |

Also, once:

- [ ] **The QR code, four ways:** scan it from the screen and from paper, with an iPhone and an Android phone. Each
  must open the `/try` page through `<short URL from /go>`.
- [ ] **Plan B once:** turn Wi-Fi off and switch to the hotspot, then to `npm run judge`, so the switch is known.
- [ ] **The backup link once:** open it in a private window on another device; it plays with sound.

## 8. Three sentences that always work

- "Inside the limits the agent pays alone; beyond them, a person signs with Face ID."
- "Metal and Airwallex hold the limits in the rails, not in a prompt."
- "Everything simulated is labelled: the demo companies, the bank on the hands-on page, the sandbox settlement, and
  the testnet."

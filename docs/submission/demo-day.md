# Demo Day: the runbook

For Max. Demo Day is **19 November 2026 in San Francisco, remote participation optional**; finalists are selected on
**15 November** (microsite, read 5 November). The words come from [pitch.md](pitch.md) (3-minute version), the answers
from [qa.md](qa.md), the one page to keep beside the laptop is `docs/internal/spiekkaart-demo.pdf`. Every figure on
screen is the main run's (3 November 2026); nothing here is run live with money.

## 1. What we know, and what Max asks Dan Kim

Checked on 5 November: [airwallex.hackerearth.com](https://airwallex.hackerearth.com/) (timeline, FAQ) and the
[HackerEarth page](https://www.hackerearth.com/community/challenges/hackathon/agentic-banking-hackathon/) (build phase
until 15 November 2026, 1:29 PM America/New_York = 18:29 UTC). Neither says how the final is run. Slack `#announcements`
is not readable from here: Max checks it first.

| Topic | Known | Source |
|---|---|---|
| Finalists | Selected 15 November; "The eight strongest teams will advance to Demo Day." | microsite; Dan Kim, 5 Oct (`docs/rules.md`) |
| Demo Day | 19 November, San Francisco, "remote participation optional" | microsite |
| Judging | "a demo day in front of judges from fintech and venture"; "Mentors and judging are available to remote teams too." | microsite, About and FAQ |
| Format, minutes, platform, time zone | **Not published** | — |

**Questions for Dan Kim** (Slack DM or `#announcements`; send them once finalists are known, or now if he is open to it):

1. Is the final judged live, or do the judges watch our recorded video?
2. How many minutes for the demo, and how many for questions?
3. Remote: which platform (Zoom, Google Meet, StreamYard, other)? Do we share our own screen, or play a file you hold?
4. What time on 19 November, and in which time zone? (San Francisco is UTC−8 then; 9:00 there is 18:00 in the Netherlands.)
5. May the judges scan a QR code and try the product on their own phones during the demo?
6. Is there a tech check before, and when?
7. In person: is there a laptop and HDMI or USB-C, and Wi-Fi we can use?
8. Do you want the deck as a PDF beforehand, and by when?

Until he answers, prepare for the hardest case: **live, remote, 3 minutes, own screen shared**, with the 30-second
version ready if time is cut and the 5-minute version if there is more.

## 2. The jury's criteria, and where the pitch meets them

The criteria word for word, from [docs/rules.md](../rules.md) (Dan Kim, 5 October; no weights published). The
microsite's FAQ adds the deliverables: "A working demo, a short video walkthrough under five minutes, and a link to
your repository with setup instructions."

| Criterion (verbatim) | Moment in the 3-minute pitch | Proof (link or id) |
|---|---|---|
| Finance and product value | 0:15 who and what (a small company that sells live stock data per query; the rule: inside its limits an agent pays alone, beyond them the CFO signs); 2:05 the core line | [/](https://kit11.max-31b.workers.dev/); deck slides 2–3 |
| Airwallex relevance and financial context | 0:40, beat 3: FX for only the shortfall, SWIFT PAID 6 s after Face ID (simulated settlement) | conversion `3ca88196-05da-4d88-9caa-796f03704636`; transfer `03360bfa-afce-457b-89d1-e1097fbe3985`; authorization `01a1a12f-4113-7000-b76d-014677710007` |
| Agentic behaviour and controls | 0:40, beat 1: Metal refuses; Treasury proposes options 40 s later; four eyes | tx `0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871`; P-0002 |
| Technical execution | 1:50: every id published on /proof, the Metal ones on chain and checkable; `npm run verify`; 2432 tests | [/proof](https://kit11.max-31b.workers.dev/proof); 412 audit rows, hash-chained |
| "(1) a working end-to-end workflow for a clear user" | The whole run: 0:40–1:50 | [/watch](https://kit11.max-31b.workers.dev/watch) |
| "(2) Airwallex used for a necessary financial action" | Beat 3: the euro licence paid by SWIFT, euros bought by FX | transfer `03360bfa…3985` |
| "(3) financial context influencing what the agent decides" | Beat 1: the price rise; Treasury's two options within the same 20.00: A, Sourcing's cap to 0.04 and our price stays 0.05; B, the same cap and our price up to 0.07 | P-0002 (option A, signed), P-0003 (option B, superseded) |
| "(4) clear controls: what the agent can do, what requires approval, how it handles an exception" | Beats 1 and 2: Metal's cap, the refunds by Support itself, "refund the other 9" rejected with Face ID; 1:50 the jury signs | P-0004; [/try/sign](https://kit11.max-31b.workers.dev/try/sign) |

## 3. The runbook, minute by minute (3 minutes)

Screen shared: one browser window, the tabs below in this order, zoom 110 %. Max says the sentences from
[pitch.md](pitch.md); the first words of each step are here so he knows where he is.

| Time (length) | Max says | On screen (URL, scene) | Click | Plan B |
|---|---|---|---|---|
| 0:00 (15 s) | "AI agents can now spend money. So who signs off? I'm Max Geurtsen, and this is Purser." | Deck, slide 1 (the core line, the four figures) | — | Deck as PDF; the deck needs no network |
| 0:15 (25 s) | "Picture a small company that sells live stock data, per query. … Inside its limits an agent pays alone; beyond them, the CFO signs. In this demo, I play the CFO." | Deck, slide 2 (the rule), then slide 3 (agent → rules → person → Airwallex · Metal → books) | Next slide (twice) | Same |
| 0:40 (30 s) | "A replay of our main run, 3 November. The supplier doubles its price … Metal refused it; the refusal is recorded on chain. … Option A … Option B … I sign A with Face ID; a second approver co-signs." | Tab 2: [/watch?scene=1](https://kit11.max-31b.workers.dev/watch?scene=1), scene 1 "The price rise"; point at Metal's refusal and its tx, then the two options | Tab 2; it plays from scene 1 | Site slow or down: tab 7, `npm run judge` on `http://localhost:4311/watch?scene=1`. `/watch` stutters: clip `out/video/clips/05-price.mp4` |
| 1:10 (15 s) | "A customer then disputes 12 orders its own agent signed. Support refunds the 3 with wrong data itself. The rest I reject, with Face ID." | `/watch`, scene 2 "The dispute": 12 orders signed, #7, #10, #13 refunded, P-0004 rejected | Chip **2** | Clip `07-dispute.mp4`; Face ID moment: clip `08-faceid.mp4` |
| 1:25 (25 s) | "Last, a 240 euro licence is due. Treasury converts only the shortfall, 110 euros, and pays by SWIFT. PAID, 6 seconds after my Face ID." | `/watch`, scene 3 "Earnings and euros": EUR 110.00 by FX, then the EUR 240.00 licence "PAID by SWIFT · 6 s after Face ID · in the sandbox, where the settlement is simulated" | Chip **3** | Clip `09-six.mp4` |
| 1:50 (15 s) | "Said plainly: the second approver was a test passkey, and the sandbox simulates settlement. Every id is published on /proof; check it with npm run verify." | Deck, slide 7 (what is real, what is not); then tab 3, [/proof](https://kit11.max-31b.workers.dev/proof), and tab 6, the terminal with `npm run verify` already run | Deck slide 7; tab 3; tab 6 | `/proof` down: `http://localhost:4311/proof`; terminal fails: deck slide 6 (the ids) |
| 2:05 (45 s) | "Now you sign off: scan this, now or during the questions. … Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them. On mine, signed before, I change the amount by one cent. The same signature is refused. One cent. Worthless." | Deck, slide 5 (QR, `kit11.max-31b.workers.dev/try/sign`); at the core line, tab 4: [/try/sign](https://kit11.max-31b.workers.dev/try/sign), signed once by Max before the demo | Deck slide 5; tab 4: **Try to tamper: change the amount by 0.01**. Do not wait for the jury to finish signing. Then tab 1, slide 10 (the QR again), and leave it up for the Q&A | `/try/sign` fails for Max: clips `11-turn.mp4` and `12-tamper.mp4`. QR fails for the jury: they try it during the Q&A from slide 10, or watch Max's tab |

**Face ID live?** Not needed: the CFO's Face ID is in the record. Only `/try/sign` asks for a passkey live. Face ID
refuses on Max's phone: try once more, then clip `08-faceid.mp4`, and say "Same moment, recorded."

**Sound or screen sharing drops:** send the deck PDF in the chat (or hold it up in the room) and talk over it; every
figure is on the slides. Say: "Let me walk you through the slides while the screen comes back."

**If time is cut to 1 minute:** the 30-second pitch from [pitch.md](pitch.md), then the QR slide.

## 4. Start-up list (30 minutes before)

- [ ] Laptop on the charger; notifications off (Do Not Disturb, Slack and mail closed); browser zoom 110 %.
- [ ] One browser window, a private one (no old keys), these tabs in this order:
  1. the deck: `docs/submission/purser-deck.pdf` (full screen, slide 1);
  2. [/watch?scene=1](https://kit11.max-31b.workers.dev/watch?scene=1);
  3. [/proof](https://kit11.max-31b.workers.dev/proof);
  4. [/try/sign](https://kit11.max-31b.workers.dev/try/sign), with a test world started and one proposal signed (it
     lasts an hour: start it within the hour before);
  5. Home: [kit11.max-31b.workers.dev](https://kit11.max-31b.workers.dev/);
  6. the terminal, in the repo, `npm run verify` run once, its result on screen;
  7. `http://localhost:4311/watch` from `npm run judge` (already started in a second terminal, as reserve).
- [ ] The clips (`out/video/clips/`) open in a player, paused, in the order of the plan B column.
- [ ] Phone above 80 %, Do Not Disturb on, Face ID works (unlock once).
- [ ] The phone's hotspot ready as reserve internet (name and password known; tested once that day).
- [ ] The cheat sheet (`docs/internal/spiekkaart-demo.pdf`) printed, beside the laptop.
- [ ] Nothing private on screen: no `.env`, no relay token, no viewer link, no mail. The terminal shows only the repo.

## 5. Rehearsal: three times, with a stopwatch

Max rehearses three times, once with the screen shared to a friend or recorded (QuickTime or OBS). After each run, he
writes the times below. Where a step runs over by more than 5 s, cut a sentence there (the shortest one that still
leaves the figure in), and note it in the last column.

| Step | Target | Run 1 | Run 2 | Run 3 | Too long? What was cut |
|---|---|---|---|---|---|
| Hook | 0:15 | | | | |
| Who and what | 0:25 | | | | |
| Beat 1, the price rise | 0:30 | | | | |
| Beat 2, the dispute | 0:15 | | | | |
| Beat 3, the euros | 0:25 | | | | |
| Said plainly, the proof | 0:15 | | | | |
| The jury signs, the tamper | 0:45 | | | | |
| **Total** | **3:00** | | | | |

Also, once:

- [ ] **Read the pitch out loud** (3-minute version) before the first rehearsal. Mark every sentence you stumble on; it
  gets shorter (tell Claude which ones).
- [ ] **The QR code, four ways:** scan slide 5 from the laptop screen and from a print of
  `docs/media/try-sign-qr.png`, each with an iPhone and an Android phone. Each must open
  `https://kit11.max-31b.workers.dev/try/sign`. Write the result here:

| Phone | From the screen | From paper |
|---|---|---|
| iPhone | | |
| Android | | |

- [ ] **Plan B once:** turn Wi-Fi off mid-rehearsal and switch to `npm run judge` and the clips, so the switch is known.

## 6. Three sentences that always work

- "Inside the limits the agent pays alone; beyond them, a person signs with Face ID."
- "Metal and Airwallex hold the limits in the rails, not in a prompt."
- "Everything simulated is labelled: the supplier, the customer, the merchant, the second approver, and the SWIFT
  settlement in the sandbox."

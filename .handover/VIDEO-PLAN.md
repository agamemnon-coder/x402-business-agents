# Purser: the video plan (3:00 and 5:00)

Written 12 Nov 2026 for the video stream. Read-only survey of `main` (/home/user/ro/main), the open branches and the
live site. No live API calls were made. Every factual sentence in both scripts is in section G with its source.
Checked adversarially the same day (timing at 150 words a minute, every claim against its record, captions, the first
15 seconds, the shot list); every change is in the **Check log** at the end.

## 0. Before anything: open points for Max

1. **Which video is for Demo Day?** The task says: 3:00 = submission, 5:00 = the walkthrough for the jury and Demo Day.
   Dan's guidance in the master list (12 Nov) says the reverse for Demo Day: "under 3 min, Max on camera, only agentic
   banking, QR code at the end", with a checklist "under 4 min, product within 30–45 s, no slides, one use case".
   **Proposal:** the 3:00 cut serves both the form and Demo Day (product on screen at 0:20, real screens, one use case).
   It gets a second end card with the QR code for Demo Day. The 5:00 cut is the jury walkthrough, linked from the form,
   README and /proof. Max decides; V1 of the Demo Day cut goes to Dan by Monday.
2. **Entry wording.** The site says "Kit 11 · x402 Business Agents · entered for the Metal Award and the Visa Award"
   (docs/claims.md line 254). The close says "Purser, for Kit 11". Confirm before recording whether Max says the awards.
3. **Records not on main yet** (checked against origin/main 74e04df, 12 Nov 13:52): two-locks PAID
   (origin/runs-timeline-1112, docs/runs/2026-11-12-airwallex-two-locks-paid.md), Moneybird (origin/moneybird-live-1112,
   docs/runs/2026-11-12-moneybird-sandbox.md) and the zero-trust model (origin/zero-trust-1112, docs/zero-trust.md,
   test/zero-trust.test.ts). The lines that use them are marked **[needs merge]**; each has a fallback or a cut rule.
   The snapshot /home/user/ro/main is at 0ecab2a; origin/main has since merged `platform` (PR #113). No record cited
   here changed in that merge.
4. **Record P1 (Face ID on /try/sign) before the hands-on demo `/go` is deployed.** The /go design
   (plans/2026-11-12/jury-demo/design-final.md, "Try tab" and "/try, /try/sign" rows) builds /try/sign without a model
   key once /go ships: the page then shows recorded agent answers, and the line "Claude Sonnet reads it" would no
   longer be live. Use only a take where the page's labels say "Claude Sonnet · live" and "Claude Opus · live".
5. **The hands-on demo has two forms that need different words.** Form B (the cloud console's read-only demo of three
   seeded test companies) is all stand-in and no model is called: the 5:00 row 1:15 is written for it. Form A (`/go`)
   is a different thing by design: live Claude agents, a real Airwallex sandbox payout, a live Metal read, and the word
   "stand-in" is forbidden on it. No `/go` code is on any branch yet (checked 12 Nov), so **no /go narration is written**:
   if /go is the demo, its row is written after it ships, from its own records.
6. **Home's one-cent check is a labelled sample today.** On origin/home-story-1112 the hero checks
   docs/demo/hero-receipt.json, a sample signed with a software key (rp `hero-sample.purser.test`), not the owner's
   P-0002 signature. So the "owner's real signature" lines now use **/try/verify** (live today) with the real
   docs/runs/2026-11-07-awx-1/receipt-P-0002.json. If the hero file is swapped for the real receipt before the deploy
   (its code supports that: `heroReceipt` kind "recorded"), D1b can replace T8.
7. **Disk:** the build machine has **2.2 GB free** of 252 GB (95% used). The old render wrote 3840x2160 frames. The
   new tools must pipe frames into ffmpeg (no PNGs on disk) and old clips in out/ (129 MB) can go first.

---

## A. The story in one paragraph

Give an AI agent a company card or a payment API and it can spend anything; a limit written in a prompt is only a
request. Purser makes the limit real. Claude agents read invoices, check them, and propose payments. Anything past a
limit goes to the CFO, who signs the exact terms (amount, payee, IBAN, expiry) with a passkey and Face ID. Change one
cent after signing and the signature is worthless. The limit is then held again by layers that do not trust each
other: Purser's own deterministic code, the CFO's signature, Airwallex's card controls, payouts and transfer
approvals, an on-chain Metal mandate per agent, and Visa Intelligent Commerce through Airwallex's Airi. The proof is
real sandbox runs with test money: Airwallex declined an agent's simulated card charge on its own and paid a signed
SWIFT payout 6.3 s after Face ID (settlement simulated); Metal refused a purchase over an agent's mandate, on chain,
with our own check switched off on purpose; an Airi purchase over the limit waited for Face ID. Anyone can check the
owner's real signature on that Airwallex payout and watch it fail when one cent changes. The product for small
companies is Purser Cloud: invoices come in, agents check them, the CFO signs, Airwallex pays, a double-entry ledger
books it, a vault archives the PDF, and it syncs to the bookkeeping package (T:0 and Moneybird, both sandbox runs).
The close: agents do the work, the CFO signs only the exceptions, and card limits, payouts and mandates are checked by
code and then by the rail.

---

## How to read the scripts

- **Narration column:** `MAX-CAM` = Max on camera (his own recording). `VO` = voice-over over the screen. `—` = no
  voice. VO is read by **Max** (preferred: one audio session, see E) or, as the fallback, by the AI voice used in
  the old kit (ElevenLabs), credited on the end card. Same words and timings either way.
- **Timing rule (checked):** read at **150 words a minute**, numbers as spoken ("one thousand eight hundred fifty").
  A VO row needs its words plus 1.0 s (0.4 s lead, 0.6 s tail); a MAX-CAM row needs its words plus 0.4 s per
  sentence. Every row below passes; the words and seconds are in the Check log.
- **Caption** = text burned into the picture (lower third): **at most 8 words, one idea**, one caption per shot. The
  full words are in the .srt.
- **Badge** = a fixed corner badge on every shot where money moves or is shown: `Airwallex sandbox · test money`,
  `Metal testnet · test USD`, `Airi test card · test money`, `Test world · no money moves` (/try/sign),
  `Stand-in · no real account` (the demo world), `Stand-in rail · no money moved` (Moneybird), `Test harness ·
  stand-in rails` (the zero-trust tests). Required, see G.
- **Source** = the claim ids in section G.
- Shot ids (T = can be captured today, D = waits for a merge or a deploy, P = Max's phone, M = Max on camera) are in
  section D. One shot carries one idea; a row with two ideas has two shots.

---

## B. SCRIPT 3:00 (submission; also the Demo Day cut, with the QR end card)

Spoken words: **329** (MAX-CAM 75, VO 254), about 132 s of speech at 150 words a minute in 180 s. Runs 3:00 with
the end card.

| Time | On screen (shot, action) | Narration | Caption | Source |
|---|---|---|---|---|
| 0:00–0:20 | **M1** Max on camera, landscape, head and shoulders. | MAX-CAM: "Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. That matters, because a limit in a prompt is only a request. Our code checks the limit, and the payment rails check it again." | 0:00–0:03 "Max · Purser"; 0:03–0:18 "Agents pay only within limits the CFO signs" | C01 |
| 0:20–0:30 | **D1a** Home at 1440x900, dark: the H1 holds 2 s, then a slow scroll over the four steps. (Fallback **T14**: today's Home, nav cropped.) | VO: "This is Purser. Claude agents propose payments. Past a limit, the CFO signs." | — (the page's own H1 says it) | C02 |
| 0:30–0:50 | **P1a** Max's iPhone (screen recording in the phone frame): /try/sign, the test-world banner, the €1,850 ask, the live reading and the advice. | VO: "This page is live; anyone can try it. An invoice for 1,850 euros comes in. Claude Sonnet reads it. Claude Opus advises on timing. No model sets the amount or the payee. Code builds the terms." | "Claude reads; code writes the terms" + badge `Test world · no money moves` | C03, C04 |
| 0:50–1:02 | **P1b** the terms screen, then Face ID (2–3 s of the second camera at the Face ID tick), then "Signed and verified." | VO: "The CFO signs those exact terms with Face ID: amount, payee, IBAN and expiry." | "Server checks the signature, not the face" + badge | C05, C06 |
| 1:02–1:17 | **P1c** "Try to cheat": + 1 cent → "Refused by Purser". Cut to **P1d** "Try to trick the agent": "Pre-approved by the CFO" → "Blocked: a new IBAN needs a person's Face ID." | VO: "Change one cent after signing, and Purser refuses it. Now a trick: a fake invoice with new bank details. Blocked. A new IBAN needs a person's Face ID." | P1c "One cent changed → refused"; P1d "New IBAN → blocked" + badge | C07, C08 |
| 1:17–1:42 | **T9b** /airwallex (live), the awx-1 list: the SLL-2026-11 line, PAID (12 s). Cut to **T5a** the awx-1 record on GitHub, rows 12:12:20 and 12:12:25–26 highlighted (13 s). | VO: "That was a test world. In the Airwallex sandbox, with test money, the owner signed a 240 euro invoice with Face ID. It was paid by SWIFT 6.3 seconds later. The sandbox simulates the settlement. The signed hash sits in Airwallex's own transfer record." | T9b "awx-1 · 7 Nov · EUR 240.00 by SWIFT"; T5a "PAID 6.3 s after Face ID · settlement simulated" + badge `Airwallex sandbox · test money` | C09, C10, C11 |
| 1:42–1:55 | **T9a** /airwallex (live), the awx-1 list: the EUR 45.00 `LIMIT_EXCEEDED` line. | VO: "Each agent has its own card. Airwallex declined a simulated 45 euro charge: over the limit. The agent asked the CFO for a raise, not a retry." | "LIMIT_EXCEEDED · card ····2441 · 7 Nov" + badge | C12 |
| 1:55–2:07 | **T2b** /metal (live), "#24 refused on chain" and its tx link. | VO: "On Metal, a price rise went past an agent's mandate cap. We switched our own check off once, on purpose. Metal refused the purchase, on chain." | "#24 refused on chain · let through on purpose" + badge `Metal testnet · test USD` | C13 |
| 2:07–2:17 | **T10** /visa (live), the VIC via Airi tile: A paid, B paid after Face ID, C refused. | VO: "Through Airwallex's Airi, a Visa purchase over the limit waited for the CFO's Face ID." | "Visa Intelligent Commerce via Airi · 7 Nov" + badge `Airi test card · test money` | C15 |
| 2:17–2:29 | **T11** /runs (live), the 10 Nov row "The main run's books posted to T:0": 95 journal entries, 0 differences. | VO: "The main run's 95 journal entries went to T:0's sandbox, and match line by line." | "T:0 sandbox · 10 Nov · 95 of 95" + badge `Sandbox · test data` | C16 |
| 2:29–2:42 | **T8** /try/verify (live): pick the real receipt-P-0002.json, hold "valid" 2 s; click "Amount (+ 0.01)", hold the failed check 3 s. | VO: "Don't take our word for it. This is the owner's real signature on that payout. Your browser checks it. Change one cent, and it fails." | "Receipt P-0002 · checked in your browser" + badge `Airwallex sandbox · test money` | C18 |
| 2:42–2:57 | **M2** Max on camera. | MAX-CAM: "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself." | — | C19 |
| 2:57–3:00 | **E3** end card (Demo Day version: **E3-DD**, QR code + short url). | — | end card: "kit11.max-31b.workers.dev · Try it yourself" | — |

**Demo Day close (M2-DD, same 15 s):** "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and
mandates: our code checks them, and the rail checks again. Scan the code, and try it yourself." (31 words, 14.4 s
with pauses.) The QR card E3-DD then stays on screen after 3:00 while Max answers questions.

**Cut rules for 3:00:** if Home (home-story) is not deployed, use T14 (today's Home with the nav cropped out in post;
its H1 and four steps are live today). If no P1 take shows both "live" labels, use T1 (Chromium's virtual passkey;
caption "Virtual test passkey · not Face ID") and change "with Face ID" in the 0:50 row to "with a passkey". The row
2:17 may be dropped for the Demo Day cut ("only agentic banking"); its 12 s then go to 1:17 (a slower T5a hold).

---

## C. SCRIPT 5:00 (jury walkthrough)

Spoken words: **576** (MAX-CAM 75, VO 501), about 230 s of speech in 300 s. Runs 5:00 with the end card.
Rows marked **[needs merge]** or **[demo]** have a fallback in the cut rules; the fallback words are timed too.

The hands-on demo at 1:15 is written for **Form B** only (the cloud console's demo mode, `DEMO_PUBLIC=on`,
read-only, three seeded test companies: northwind-outdoor, bakery-de-test, fietslab-bike-workshop; docs/cloud.md on
origin/cloud-demo-1112: "No deployment runs in this mode today (12 November)"). There, no rail and no model is called,
every row says `provenance: "stand-in"`, and the companies' passkeys are software authenticators; the badge says so the
whole time. Form A (/go) needs its own words: see 0.5.

| Time | On screen (shot, action) | Narration | Caption | Source |
|---|---|---|---|---|
| 0:00–0:20 | **M1** Max on camera (same take as the 3:00). | MAX-CAM: (same opening, 44 words) "Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. That matters, because a limit in a prompt is only a request. Our code checks the limit, and the payment rails check it again." | 0:00–0:03 "Max · Purser"; 0:03–0:18 "Agents pay only within limits the CFO signs" | C01 |
| 0:20–0:32 | **D1a** Home, dark: H1, then the four steps. (Fallback **T14**.) | VO: "This is Purser. Claude agents propose payments. Past a limit, the CFO signs the exact terms with a passkey." | — | C02 |
| 0:32–1:15 | **P1a → P1b → P1c → P1d** Max's iPhone on /try/sign: reading and advice (12 s), Face ID (10 s), one cent (9 s), the trick (12 s). | VO: "This page is live. An invoice for 1,850 euros comes in. Claude Sonnet reads it, and Claude Opus advises on timing. Code builds the terms; no model sets the amount or the payee. The CFO signs with Face ID. The server checks the signature, not the face. Change one cent after that, and Purser refuses it. Plant new bank details, and the payment is blocked until a person signs." | P1a "Claude reads; code writes the terms" → P1b "Server checks the signature, not the face" → P1c "One cent changed → refused" → P1d "New IBAN → blocked" + badge `Test world · no money moves` | C03–C08 |
| 1:15–1:53 | **[demo] D5-B** the cloud demo, desktop, six shots of about 6 s: Northwind Outdoor (test company) inbox; the invoice held as possible fraud; the one waiting for the CFO; the one paid in a foreign currency (its FX line); its ledger entries; its PDF in the vault (by hash). **Fallback: T7 + T5d** (see the cut rules). | VO: "This is Purser Cloud, for small companies, in a demo world of test companies. Invoices arrive in an inbox. The checks hold one with changed bank details. Another waits for the CFO. A paid one shows its currency exchange, its double-entry booking, and its PDF, filed under its own hash. Everything here is a stand-in: no real account, no real money, no model called." | "Purser Cloud · test companies" → "Held: changed bank details" → "Waiting for the CFO" → "Paid in a foreign currency" → "Booked: debit and credit" → "PDF filed under its hash" + badge `Stand-in · no real account` | C20, C21 |
| 1:53–2:13 | **T3** /claude (live): H1, the three agents with their models, 24/24. | VO: "In the main run on 3 November, the agents made 24 decisions with Claude Haiku, Sonnet and Opus. None fell back to a script. Routine payments ran as plain code. Claude cost 32 cents for the whole run." | "Main run · 3 Nov · 24 decisions · USD 0.3170" | C22, C33 |
| 2:13–2:33 | **T9a** /airwallex (live), the awx-1 list: the EUR 45.00 decline, the agent's raise request, the same charge approved. | VO: "On Airwallex, each agent has its own card. Airwallex declined a simulated 45 euro charge: over the limit. The agent read the decline and asked the CFO for a raise, not a retry. After Face ID, the same charge went through." | "awx-1 · 7 Nov · declined, then approved" + badge `Airwallex sandbox · test money` | C12, C23 |
| 2:33–2:51 | **T5a** the awx-1 record, the P-0002 rows highlighted (9 s). Cut to **T9c** /airwallex (live), the BTX-2026-11 line with EUR 623.50 (9 s). | VO: "A 240 euro invoice was paid by SWIFT 6.3 seconds after Face ID, with simulated settlement. For an 1,850 euro invoice, Purser bought only the missing 623 euros 50." | T5a "PAID 6.3 s after Face ID · settlement simulated"; T9c "Bought only EUR 623.50 · quote 1605354b…" + badge | C09, C10, C25 |
| 2:51–3:05 | **[needs merge] D3** /runs, the two-locks row ("One payout, two locks", PAID). **Fallback: T13** today's /runs two-locks row (10 Nov, IN_APPROVAL). | VO: "With Airwallex's approval workflow on, a payout waited until the owner approved it in Airwallex. Then it was paid. Purser's own lock was a test passkey." | "Two locks · 10 and 12 Nov" + badge | C26 |
| 3:05–3:27 | **T2a** /metal (live): "86 Metal payments", the three mandates (10 s). Cut to **T2b** "#24 refused on chain" (8 s), then **T4** the explorer page of tx 0x2e92…1871 (4 s). | VO: "In the main run, 86 Metal payments stayed inside the limits. Each agent has a cap per payment. The supplier doubled its price, past the Sourcing agent's cap. We switched our own check off once, on purpose. Metal refused the purchase, on chain." | T2a "86 payments inside the limits · 3 Nov"; T2b/T4 "#24 refused on chain · let through on purpose" + badge `Metal testnet · test USD` | C13, C14, C28 |
| 3:27–3:47 | **T10** /visa (live), the VIC via Airi tile: A, B, C. (After visa-vic-first: **D4**, which also shows "fourth attempt".) | VO: "Visa Intelligent Commerce, through Airwallex's Airi. A 12 euro purchase needed no CFO. A 45 euro purchase, over the limit, waited for Face ID. A shop the CFO does not allow was refused before Airi was asked. It passed on the fourth try that day." | "Visa Intelligent Commerce via Airi · 7 Nov" + badge `Airi test card · test money` | C15, C29 |
| 3:47–4:05 | **T11** /runs (live), the T:0 row (9 s). Cut to **[needs merge] T5e** the Moneybird record on GitHub, its Result paragraph (9 s); or **P3** Max's Moneybird sandbox screen. | VO: "The main run's 95 journal entries were posted to T:0's sandbox, and T:0 matches our books line by line. In a Moneybird sandbox, a test company's purchase invoices read back with zero differences." | T11 "T:0 sandbox · 10 Nov · 95 of 95"; T5e "Moneybird sandbox · 12 Nov · test data" + badge `Stand-in rail · no money moved` | C16, C17 |
| 4:05–4:15 | **[needs merge] D6** terminal: `npx vitest run test/zero-trust.test.ts`, green summary held 3 s. | VO: "We attacked Purser in tests: 48 attacks, each with part of the system in hostile hands. Money moved in none." | "48 attacks · money moved in 0" + badge `Test harness · stand-in rails` | C30 |
| 4:15–4:28 | **T8** /try/verify (live) with the real receipt-P-0002.json: valid, then "Amount (+ 0.01)" → fails. | VO: "Check us yourself. This is the owner's real signature on the 240 euro payout. Your browser checks it. Change one cent, and it fails." | "Receipt P-0002 · checked in your browser" + badge | C18 |
| 4:28–4:42 | **T12** /runs (live), the 10 Nov row "Three test companies on their own Airwallex accounts": "3 invoices refused by Airwallex". | VO: "What is not done: Airwallex refused three payouts from two new test companies. It wants their registration number. Sandbox settlement is simulated." | "10 Nov · 3 payouts refused by Airwallex" + badge | C32, C10 |
| 4:42–4:57 | **M2** Max on camera (same close as 3:00). | MAX-CAM: (same close, 31 words) "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself." | — | C19 |
| 4:57–5:00 | **E5** end card with url and credits. | — | end card | — |

**Cut rules for 5:00** (all fallback words are timed in the Check log):
- **No demo deployment (1:15):** shots T7 (the three screenshots in docs/screenshots/after-kit/, about 7 s each) and
  T5d (the platform e2e record's Result paragraph, 12 s). VO: "This is Purser Cloud, for small companies, in
  screenshots of a test company. Invoices arrive in an inbox, with what is due, what is blocked, and why. The CFO can
  approve several at once. In a sandbox run, three test companies got Airwallex accounts through Purser. One payout
  was paid, with Purser's fee and simulated settlement." Captions: T7 "Screenshots · test company · test money"; T5d
  "Sandbox run · 10 Nov · 1 payout PAID". Badge `Stand-in · no real account` on T7, `Airwallex sandbox · test money`
  on T5d. Source C20b, C32.
- **Demo deployed but a screen missing:** say only what a shot shows. No vault screen → drop "and its PDF, filed under
  its own hash" and its shot. Not public → keep "in a demo world of test companies"; never "you can open yourself".
- **No two-locks merge (2:51):** T13 and VO: "With Airwallex's approval workflow on, a payout that Purser had signed with
  a test passkey stayed on hold at Airwallex, waiting for a person." Caption "Two locks · 10 Nov · held IN_APPROVAL".
- **No Moneybird merge (3:47):** T11 for the whole row (or P3 if Max filmed it) and VO: "The main run's 95 journal
  entries were posted to T:0's sandbox, and T:0 matches our books line by line. A second push posted nothing twice."
  (Source C16: "a second push posted 0".)
- **No zero-trust merge (4:05):** drop the row; its 10 s go to 1:53 (hold T3 longer) and 4:28 (hold T12).

---

## D. SHOT LIST

Defaults: desktop 1440x900 at deviceScaleFactor 2 (frames 2880x1800, scaled to fit 1920x1080 with a 2 px margin, dark
background behind). Phone 390x844 at DPR 3. Theme **dark** everywhere (Playwright `colorScheme: "dark"`; Max's iPhone in
dark mode) so the cuts match; GitHub and the explorer stay as they render. Scroll is eased (ease-in-out, about 300 px a
second). Every shot starts with 1 s of hold after the page is fully loaded (`networkidle` plus fonts ready). Every
"must be visible" text below was read on the live page on 12 Nov (GET only) or in the record named.

### D.1 Can be captured TODAY (current live site, public records, Max's own devices)

| Id | URL or command | Viewport | Actions in order | Dur. | Must be visible | Theme | Gate | Used |
|---|---|---|---|---|---|---|---|---|
| **T2a** | https://kit11.max-31b.workers.dev/metal | 1440x900 | load; hold H1 2 s; scroll to "3 mandates on chain" and "86 Metal payments"; hold 4 s | 10 s | H1 "A limit the agent cannot talk past"; "3 mandates on chain, one per agent"; "86 Metal payments, each its own transaction" | dark | none | 5:00 3:05 |
| **T2b** | same page | 1440x900 | scroll to "#24 refused on chain"; hold 5 s | 8–12 s | "#24 refused on chain"; "0.04 over the 0.03 cap: mandate_cap_exceeded; nothing moved"; "tx 0x2e92…1871" | dark | none | 3:00 1:55; 5:00 3:05 |
| **T3** | https://kit11.max-31b.workers.dev/claude | 1440x900 | load; hold H1; scroll to the three agents; hold 4 s | 20 s | "Claude decides the exceptions"; "Sourcing · Haiku 11", "Support · Sonnet 4", "Treasury · Opus 9"; "24/24"; "82 routine payments by code" | dark | none | 5:00 1:53 |
| **T4** | https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871 | 1440x900 | load; hold; zoom 1.0→1.2 on the hash and log #0 (in post) | 4 s | the tx hash; log #0 (Metal's MandateRefused event, undecoded there, as /metal says). The tx status reads as the record tx's own status: never caption it "failed" | as rendered | none | 5:00 3:05 |
| **T5a** | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-awx-1.md | 1440x900 | scroll to the timeline; highlight (post) the rows 12:12:20.250 and 12:12:25.487 / 26.568 | 9–13 s | "Max approves P-0002 with Face ID"; "PAID (6.3 s after Face ID)" | GitHub dark | none | 3:00 1:17; 5:00 2:33 |
| **T5c** | …/blob/main/docs/runs/2026-11-10-t0-journal-sandbox.md | 1440x900 | hold on the Result line | 5 s | "95 journal entries posted…", "T:0 matches our books line by line" | GitHub dark | none | spare (for T11) |
| **T5d** | …/blob/main/docs/runs/2026-11-10-platform-e2e.md | 1440x900 | hold on the "Result" paragraph | 12 s | "3 companies onboarded…", "1 payout PAID…", "3 payouts … refused by Airwallex" | GitHub dark | none | 5:00 1:15 fallback |
| **T6** | https://kit11.max-31b.workers.dev/proof | 1440x900 | scroll past the replay banner to the counters; keep the old "Watch the film" link out of frame | 8 s | 24 decisions, 86 Metal payments, 5 Face ID, 16 stops | dark | none | spare (not in either cut) |
| **T7** | docs/screenshots/after-kit/1-payables-inbox.png, 3-batch-face-id-phone.png, 4-airwallex-account.png (on main; described in docs/after-the-kit.md "Screenshots (test company, stand-ins, test money)") | stills | Ken Burns pan, about 7 s each | 21 s | the screenshots as they are (Dutch UI) | as made | none | 5:00 1:15 fallback |
| **T8** | https://kit11.max-31b.workers.dev/try/verify, file docs/runs/2026-11-07-awx-1/receipt-P-0002.json (from main) | 1440x900 | load; "Pick receipt.json" (Playwright `setInputFiles`); hold the valid result 2 s; click "Amount (+ 0.01)"; hold the failed check 3 s | 12–13 s | "Check the signature yourself"; the valid verdict for P-0002; then the failed terms-hash check. Checked offline on 12 Nov: `npm run verify-receipt` says VALID, and with amount 240.01 "NOT VALID (terms hash)" | dark | none | 3:00 2:29; 5:00 4:15 |
| **T9a** | https://kit11.max-31b.workers.dev/airwallex, section "7 November, awx-1" | 1440x900 | scroll to "7 of 7 checks pass"; hold on the EUR 45.00 line 5 s | 13–20 s | "EUR 45.00, over that limit: declined by Airwallex, LIMIT_EXCEEDED"; "asked the CFO for a raise, P-0001, instead of retrying"; "the same charge was approved" | dark | none | 3:00 1:42; 5:00 2:13 |
| **T9b** | same section | 1440x900 | hold on the SLL-2026-11 line | 12 s | "Invoice SLL-2026-11, EUR 240.00 … SWIFT transfer 738a4263-…: PAID" | dark | none | 3:00 1:17 |
| **T9c** | same section | 1440x900 | hold on the BTX-2026-11 line | 9 s | "only EUR 623.50 bought for USD 704.45 at 1.129833 (quote 1605354b-…)" | dark | none | 5:00 2:33 |
| **T10** | https://kit11.max-31b.workers.dev/visa | 1440x900 | load; scroll to "Visa Intelligent Commerce via Airwallex's Airi: a live run (7 Nov)"; hold on ✓ Within the limit, ✓ Paid after Face ID, ✕ Refused by Purser | 10–20 s | "EUR 12.00", "EUR 45.00, above the limit", "refused before Airi was asked (0 Airi calls)"; "Airwallex sandbox, test card, test money" | dark | none | 3:00 2:07; 5:00 3:27 |
| **T11** | https://kit11.max-31b.workers.dev/runs, the row "The main run's books posted to T:0" | 1440x900 | scroll to the row; hold 4 s | 9–12 s | "95 journal entries", "0 differences", "T:0 matches our books line by line" | dark | none | 3:00 2:17; 5:00 3:47 |
| **T12** | same page, the row "Three test companies on their own Airwallex accounts" | 1440x900 | scroll to the row; hold 4 s | 14 s | "3 invoices refused by Airwallex"; "the paying company's registration number is required" | dark | none | 5:00 4:28 |
| **T13** | same page, the row "Two locks on one payout" (10 Nov) | 1440x900 | scroll to the row; hold 4 s | 14 s | "IN_APPROVAL held by Airwallex"; "a labelled virtual test passkey"; "so it is not paid" | dark | none | 5:00 2:51 fallback |
| **T14** | https://kit11.max-31b.workers.dev/ (today's Home) | 1440x900 | as D1a; crop the nav bar in post | 10–12 s | H1 "AI agents spend. You sign off."; steps Ask, Face ID, Paid, Tamper refused | dark | none | fallback for D1a |
| **T1** | `npm run record-trysign` (src/cli/recordTrySign.ts) | 390x844 | the scripted walk with Chromium's virtual authenticator | 31 s | read, advice, sign, refused, trick blocked | dark | none; **spends 2 real Claude calls: needs Max's go** | fallback for P1 only, captioned "Virtual test passkey · not Face ID" |
| **P1a–d** | Max's iPhone, Safari, https://kit11.max-31b.workers.dev/try/sign | portrait iPhone | see E.4: the whole walk with his real Face ID; P1a reading and advice, P1b terms and Face ID, P1c try to cheat, P1d trick the agent | 43–47 s used | the banner "Test world · test passkey · nothing real moves"; "One of them wants €1,850"; the labels "Claude Sonnet · live" and "Claude Opus · live"; "Signed and verified."; "Refused by Purser"; "Blocked: a new IBAN needs a person's Face ID." | iPhone dark mode | **before /go is deployed** (0.4) | 3:00 0:30–1:17; 5:00 0:32 |
| **M1, M2** | Max on camera | landscape 1080p | opening and close, three takes each (plus M2-DD) | 20 s, 15 s | Max, plain background | — | none | both |

### D.2 Waits for a merge or a deploy (capture only after the stream named in "Gate" is merged and live)

| Id | URL or command | Viewport | Actions in order | Dur. | Must be visible | Theme | Gate | Used |
|---|---|---|---|---|---|---|---|---|
| **D1a** | https://kit11.max-31b.workers.dev/ | 1440x900 | load; hold H1 2 s; scroll slowly over the four steps (Ask, Face ID, Paid, +1 cent); stop before the footer | 10–12 s | H1 "AI agents spend. You sign off."; the four steps; no "Watch" in the nav | dark | **home-story** | 3:00 0:20; 5:00 0:20 |
| **D1b** | same page, step 4 | 1440x900 | hold on the receipt; click "+1 cent"; hold 3 s on "Hash no longer matches" | 12 s | the hero's provenance line must say it checks **the recorded approval** (not "a sample signed with a test key") | dark | **home-story** with docs/demo/hero-receipt.json swapped for the real P-0002 receipt (0.6) | replaces T8 only if that gate holds |
| **D2** | https://kit11.max-31b.workers.dev/airwallex | 1440x900 | as T9a–c | — | the same lines as T9a–c; no partner-pages page shows "6.3 s", so that figure always comes from T5a | dark | **partner-pages** | optional re-take of T9a–c |
| **D3** | https://kit11.max-31b.workers.dev/runs | 1440x900 | scroll to the row "One payout, two locks: signed in Purser, then approved in Airwallex's web app"; hold 4 s | 14 s | "Airwallex held EUR 240.00 until the owner approved, then PAID. A test passkey signed; settlement simulated." | dark | **runs-timeline** | 5:00 2:51 |
| **D4** | https://kit11.max-31b.workers.dev/visa | 1440x900 | as T10 | 20 s | as T10, plus the attempts line ("fourth") | dark | **visa-vic-first** | optional re-take of T10 |
| **D5-B** | the cloud demo deployment (url when deployed; `DEMO_PUBLIC=on`) | 1440x900 | open Northwind Outdoor (test company); inbox; the fraud-held invoice; the one waiting for the CFO; the paid foreign-currency invoice (its FX line); its ledger entries; its PDF in the vault | 38 s | "test company", "stand-in" labels on every screen; "read only" | dark | **cloud-demo** + a demo deployment | 5:00 1:15 |
| **D5-A** | https://kit11.max-31b.workers.dev/go | — | not scripted: written after /go ships (0.5) | — | — | — | the hands-on demo (form A) | none yet |
| **D6** | terminal: `npx vitest run test/zero-trust.test.ts` (in a clean checkout of main after the merge) | 1440x900 terminal, 18 px font | run; hold on the green summary 3 s | 10 s | the test names; "passed"; read the attack count from docs/zero-trust.md at capture (48 on the branch, 12 Nov) and change the line if it differs | dark | **zero-trust** merged | 5:00 4:05 |
| **T5e** | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-moneybird-sandbox.md | 1440x900 | hold on the Result paragraph and the Labels line | 9 s | "4 suppliers, 4 purchase invoices with their PDF…", "0 differences"; "The payment in this test world was made on a stand-in rail" | GitHub dark | **moneybird-live** merged | 5:00 3:47 |
| **P2** | Airwallex sandbox web app: Transfers → Pending your approval → approve | phone or 1440x900 | see E.5 | 10 s | a transfer IN_APPROVAL, then approved; the word "sandbox" | as rendered | **only if a new two-locks transfer is created** (about 5–7 Airwallex sandbox calls with Max's go). Without a new run: no shot, no re-enactment. | none (optional) |
| **P3** | Max's Moneybird sandbox administration, purchase invoices list | 1440x900 | hold on the purchase invoices | 9 s | the administration name "Purser", test data; no personal data, no tokens | as rendered | none (Max's own screen); the narration still needs C17's record | 5:00 3:47 (optional, instead of T5e) |

### D.3 Overlays made by the tools (no capture)

- **E3** end card 3:00 (url, "Try it yourself"), **E3-DD** Demo Day (QR code + short url, held after the video ends),
  **E5** end card 5:00 (url). Credits: "Airwallex sandbox · Metal testnet · test money · Claude by Anthropic"; if the AI
  voice is used: "Voice-over: an AI-generated voice (ElevenLabs)". No partner logos (text only, as the master list says).
- Badges and captions (section F, V3).

### D.4 Every row has its shot (checked)

3:00: M1, D1a/T14, P1a, P1b, P1c+P1d, T9b+T5a, T9a, T2b, T10, T11, T8, M2, E3/E3-DD. 5:00: M1, D1a/T14, P1a–d,
D5-B (fallback T7+T5d), T3, T9a, T5a+T9c, D3 (fallback T13), T2a+T2b+T4, T10, T11+T5e (fallback T11 or P3), D6 (or
cut), T8, T12, M2, E5. Spare: T5c, T6, D1b, D2, D4, P2.

---

## E. WHAT MAX RECORDS

### E.1 Opening (max 20 s, 44 words; what Purser does by 8 s, why it matters by 14 s)

> Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. That
> matters, because a limit in a prompt is only a request. Our code checks the limit, and the payment rails check it
> again.

### E.2 Close (max 15 s, 31 words)

> Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them,
> and the rail checks again. Purser, for Kit 11. Try it yourself.

Demo Day variant (M2-DD, same length): "… and the rail checks again. Scan the code, and try it yourself." ("Purser, for Kit
11" drops out, so it still fits 15 s.)

**Notities voor Max (opening en slot):**
- Zeg het in je eigen woorden als dat natuurlijker klinkt, maar houd vier dingen letterlijk: "Purser lets AI agents
  pay company bills" (de eerste zin na je naam: wat het doet, binnen 8 seconden), "limits the CFO signs with Face ID",
  "a limit in a prompt is only a request" en "the rail checks again". Geen bio tenzij je dat zelf wilt.
- Rustig tempo: ongeveer 150 woorden per minuut. Een korte pauze na "Face ID" en na "only a request".
- Kijk in de lens, niet naar het scherm. Glimlach bij "Hi". Eindig stil en blijf 1 seconde in de lens kijken na het
  laatste woord (dan kunnen we netjes knippen).
- Kit-woorden: zeg "for Kit 11". Wil je de awards noemen ("for the Metal Award and the Visa Award"), zeg het dan
  achter "Kit 11", maar check eerst of dat nog de inzending is (punt 0.2); dat kost ongeveer 3 seconden, dus laat dan
  "Try it yourself" weg.
- Opname: iPhone **horizontaal**, op ooghoogte, op statief of een stapel boeken; licht van voren (raam of lamp achter
  de telefoon); stille kamer; Niet storen aan; 1080p 30 fps (Instellingen → Camera → Neem video op). Drie takes van
  de opening, drie van het slot, en drie van het Demo Day-slot. Een klap in je handen voor elke take helpt bij het
  synchroniseren.
- Neem ook **10 s stilte in de kamer** op (room tone) voor de mix.
- Niets in beeld van schermen met sleutels, wachtwoorden of meldingen.

### E.3 The voice-over (preferred: Max reads it)

The VO lines of B and C (254 and 501 words) in one session, line by line, each line twice.

**Notities voor Max (voice-over):**
- Neem op met de iPhone-app Dictafoon of een losse microfoon, 20–30 cm van je mond, in een kamer met gordijnen of een
  kast vol kleren (minder galm). Telefoon op tafel, niet in de hand.
- Lees elke regel twee keer, met een pauze van 2 s ertussen. Bij een fout: pauze, en de hele zin opnieuw.
- Getallen zoals ze er staan: "six point three seconds", "two hundred forty euros", "one thousand eight hundred
  fifty", "six hundred twenty-three euros fifty", "T zero".
- Tempo ongeveer 150 woorden per minuut. Elke regel past in zijn rij met ruim een seconde over; te lang is beter dan
  te snel, wij knippen. Versnellen doen we niet.
- Lukt het niet vóór vrijdag 12:00, dan gebruiken we de AI-stem (zoals in de oude film) en staat dat op de eindkaart.

### E.4 Phone shot P1: Face ID on the live /try/sign page (today possible, and only until /go is deployed)

What it shows: Max, as the CFO, walks the live page on his own iPhone and signs with his own Face ID. It is a test
world: no money moves; the Claude calls are live (the page labels each one). The badge says so.

Two recordings at the same time:
1. **iOS screen recording** of the iPhone (Control Centre → Screen Recording). This is the crisp picture that goes in
   the phone frame.
2. **A second camera** (a second phone or laptop webcam) over Max's shoulder or at 45° to the side, so the viewer sees a
   real hand, a real phone and the Face ID moment. Only about 2–3 s of it is used, at the Face ID tick.

**Notities voor Max (P1):**
- **Neem dit op vóór /go live gaat.** Daarna toont /try/sign opgenomen antwoorden in plaats van live Claude, en dan
  klopt de voice-over niet meer.
- Controleer na elke take: staan er "Claude Sonnet · live" en "Claude Opus · live" in beeld? Staat er "recorded",
  gebruik die take dan niet.
- iPhone in **donkere modus**, helderheid op 80%, Niet storen aan, geen meldingen. Batterij- en klokbalk mogen
  zichtbaar zijn; geen privé-apps of foto's openen tijdens de opname.
- Begin de schermopname, wacht 2 s, open dan Safari met https://kit11.max-31b.workers.dev/try/sign. Doorloop de hele
  pagina rustig: lezen, advies, Face ID, "Try to cheat" (+ 1 cent), "Trick the agent" ("Pre-approved by the CFO").
  Laat elk resultaat 2 s staan.
- Tweede camera: statief, het scherm van de iPhone moet scherp zijn, je gezicht hoeft niet herkenbaar in beeld (een
  schouder en hand is genoeg). Geen tegenlicht op het iPhone-scherm (geen raam erachter).
- Klap één keer in beeld van beide camera's vóór je begint (synchronisatie).
- Drie keer doorlopen. Elke keer is een nieuwe testwereld en een paar echte Claude-calls (binnen het dagplafond van
  /try/sign).
- Zie je bij Face ID een systeemmelding met je naam of e-mail? Stuur de opname toch; wij blurren dat.

### E.5 Phone shot P2: approving a transfer at Airwallex (only with a new run)

The two-locks approval of 12 Nov was done in the Airwallex sandbox **web app** and was not filmed. A new film needs a
new transfer held IN_APPROVAL, which means new Airwallex sandbox calls (`npm run two-locks`; about 5–7 calls) and
Max's go. Without that run there is **no shot and no re-enactment**; the 5:00 uses the /runs row and the record.

**Notities voor Max (P2, alleen als er een nieuwe run komt):**
- Film het scherm (schermopname op de telefoon, of de laptop met de webapp) vanaf "Pending your approval" tot het
  goedgekeurd is. Het woord "sandbox" moet in beeld zijn.
- Geen accountnummers, e-mail of sleutels in beeld; alleen de transfer-regel en de knop.
- Lock 1 in de bestaande run was een gelabelde virtuele testpasskey, geen Face ID. Komt er een nieuwe run met jouw
  Face ID op lock 1, dan noemen we dat apart en met datum.

### E.6 Optional P3: your Moneybird sandbox

**Notitie voor Max:** alleen als je wilt: een schermopname van 9 s van de lijst inkoopfacturen in de sandbox-
administratie "Purser". Geen instellingen, tokens of je e-mail in beeld.

---

## F. PRODUCTION PLAN

### F.1 How the captures are made

| What | Tool | Why |
|---|---|---|
| Desktop pages (T2–T14, D1–D4, D6 terminal) | **New `npm run capture`** (V1): Playwright Chromium at 1440x900, DPR 2; JS clock paused with `page.clock` after load; each frame sets the scroll position (eased) and takes a screenshot; frames are **piped** to ffmpeg (image2pipe, no PNGs on disk); x264 preset slow CRF 16, 60 fps. Clicks and file picks (T8) happen between frames; the frames before and after a network wait are joined by a hard cut or a 6-frame hold, never a spinner. | The repo's frame-by-frame method gives crisp text; Playwright `recordVideo` gives soft 25 fps VP8 (tested in the survey) and is only for reference. |
| The hands-on demo (D5-B) | the same tool, with a click script per step | Same quality. |
| GitHub and explorer pages (T4, T5) | the same tool, with a highlight box drawn in post (V3) | Real pages, no edits to them. |
| Screenshots (T7) | the cut tool, a slow pan over the PNG | No capture needed. |
| Max's phone (P1) | iOS screen recording (primary) + second camera; laid into the phone frame by the cut tool (V4, from `src/film/slots.ts`) | Real Face ID, real hand. |
| Fallback phone walk (T1) | `npm run record-trysign` (recordTrySign.ts, 60 fps mp4 + step times) | Only if P1 fails; captioned "Virtual test passkey · not Face ID". |
| Max on camera (M1, M2, M2-DD) | his iPhone, landscape 1080p30 | Converted to 60 fps by frame doubling in the cut. |

### F.2 Captions, narration and mix

- Each cut is a **cut list** (data, in code): segments with shot id, in/out, caption lines, badge, the VO line ids and
  the claim ids they carry.
- Captions and badges are written as one ASS file per cut and burned in with ffmpeg's `ass` filter (libass is in
  ffmpeg 6.1.1 here). A plain .srt of all narration goes next to each master for YouTube.
- Narration: one WAV per VO line (Max's reads, or the AI voice), placed at its row's start + 0.4 s. Max's camera audio
  for M1/M2. Optional music (the old kit's ElevenLabs approach), 13 dB under the voice, silent under the one-cent
  moment. Two-pass `loudnorm` to −14 LUFS, true peak −1 dB. AAC 320 kb/s.

### F.3 Render commands (after V1–V5 exist)

```sh
npm run capture -- --list                          # shots, their gates, and which are ready
npm run capture -- T2a T2b T3 T4 T5a T5d T8 T9a T9b T9c T10 T11 T12 T13 T14   # today
npm run capture -- D1a D3 D5-B D6 T5e               # after the merges and deploys (refuses a shot whose gate is not live)
npm run cut -- submission-3 --preview               # 1x, veryfast CRF 20: drafts, minutes
npm run cut -- walkthrough-5 --preview
npm run cut -- submission-3 --vo out/video/vo/ --cam out/video/max/  # final: CRF 16, slow
npm run cut -- walkthrough-5 --vo out/video/vo/ --cam out/video/max/
npm run cut -- submission-3 --demo-day              # the QR end card variant (M2-DD)
npm run cut -- --check                              # words, times, sources, badges (also a test)
```

### F.4 Output files

All in `out/video/v9/` (the folder `out` is in .gitignore):

| File | What |
|---|---|
| `purser-3min.mp4`, `purser-3min-demoday.mp4` | 1920x1080, 60 fps, H.264 + AAC, captions burned in |
| `purser-5min.mp4` | the same, 5:00 |
| `purser-3min.srt`, `purser-5min.srt` | narration for YouTube captions |
| `cut-3.json`, `cut-5.json` | segment times, for the mix and for review |
| `script-3.md`, `script-5.md` | the tables of B and C as rendered, with claim ids |
| `thumb.png` | 1280x720 thumbnail from a frame (D1a with the H1) |
| `purser-60s-9x16.mp4` | **only if cheap** (V6): 1080x1920, the phone walk + Max's two lines |

Where they go: **not in git** (expected 60–200 MB each). Max uploads to YouTube (unlisted first, public at submission).
A private copy goes to the keys folder (`/home/user/x402-business-agents-keys/video/2026-11-14/`, outside the public
repo; it is not a place for files over 50 MB if that folder is a git repo, then use Max's Drive). With Max's ok, also
as assets on the GitHub release `v1.0-submission` (not in the tree). After upload, the old link
`youtu.be/kCUsFHrxE-o` is replaced on /proof, /try/sign and /judge (V7).

### F.5 Build tasks for the video stream (sized to finish Friday 13 Nov evening)

| # | Task | Files | Tests | Done when | When |
|---|---|---|---|---|---|
| V1 | **Capture tool**: shot list as data (D of this plan), frame-by-frame capture piped to ffmpeg, file picks (T8), gate check (a shot whose stream is not live is refused, by a fetched marker per page: e.g. Home has no "Watch" in the nav; /runs shows the two-locks PAID row). | `src/film/shots.ts`, `src/cli/capture.ts`, `package.json` (`capture`) | `test/capture-shots.test.ts`: every shot has url/viewport/actions/duration/theme/gate; a dry run against a local fixture page writes a 1 s mp4 that ffprobe reads as 1920x1080 at 60 fps; no frame file left on disk | `npm run capture -- T2a` makes `out/video/v9/shots/T2a.mp4` | Thu night |
| V2 | **Cut assembler** with the two cut lists (B and C, with their fallbacks), the honesty check and the timing check. | `src/film/cuts.ts`, `src/cli/cut.ts`, `package.json` (`cut`) | `test/cuts.test.ts`: totals 180 ± 1 s and 300 ± 1 s; **at 150 words a minute, numbers spoken, every VO row's words + 1.0 s and every MAX-CAM row's words + 0.4 s a sentence fit the row**; MAX-CAM rows ≤ 20 s and ≤ 15 s; the opening says what Purser does within 15 s; **every VO or caption line with a number names a claim id; every claim id names a source path that exists in the repo (or a named branch file), and the claim's key strings (amounts, ids, hashes) are found in that file** | `npm run cut -- submission-3 --preview` gives a 3:00 mp4 with placeholder grey for missing shots and a list of what is missing | Fri 12:00 |
| V3 | **Captions, badges, highlight boxes** as ASS; badge required on money segments. | `src/film/captions.ts` | `test/captions.test.ts`: every segment flagged `money` carries a badge; **a caption is at most 8 words and 48 characters, one per shot**; no line on screen shorter than 1.5 s per 10 words | badges visible in the preview at 0:30–2:42 | Fri 12:00 |
| V4 | **Phone footage in a frame**: lay a portrait recording (P1/T1) into the rounded phone frame, and the second-camera insert full screen; reuse the slot math. | `src/film/slots.ts` (generalise `SLOT_SCENES` to cut segments), `src/film/cuts.ts` | extend `test/premiere.test.ts` or new `test/slots-cut.test.ts`: windows, aspect check, box | P1 sits in the frame in the preview, synced by the clap | Fri 15:00 |
| V5 | **Audio mix**: VO WAVs by line id, Max's cam audio, room tone, optional music, two-pass loudnorm. | `src/film/mix.ts`, `src/cli/cut.ts` | `test/mix.test.ts` with generated tones: placement within 20 ms; output −14 ± 0.5 LUFS | the final masters play with voice | Fri 18:00 |
| V6 | 9:16 cut (optional, only if V1–V5 are done by Fri 18:00) | `src/film/cuts.ts` (a third list) | the cut test covers it | 60 s vertical file | Fri 21:00 or skip |
| V7 | **Link swap** after Max's upload: new links on /proof, /try/sign, /judge, README; "Watch" stays out of the nav. | the pages' sources (after home-story) | the site's link test; a test that `kCUsFHrxE-o` appears nowhere | deployed; curl shows the new id | Sat, after upload |
| V8 | **Disk and clean-up**: no frame files; delete old `out/video/clips` after Max's ok; check free space before a render (stop below 3 GB). | `src/cli/cut.ts`, `src/cli/capture.ts` | a unit test for the free-space guard | renders run on 2.2 GB free | Thu night |
| V9 | **Review pass**: a fresh reviewer reads both masters against G (every number on screen is in its record; every badge there); fixes. | none | `npm run cut -- --check` green | review note with 0 open points | Fri 21:00 |

Time line: Thu 12 Nov night: V1, V8, captures T2–T14; Max records M1/M2 and **P1 (before /go deploys)**. Fri 13 Nov:
merges and deploys land by 14:00 → captures D1a, D3, D5-B, D6, T5e; V2–V5; previews at 18:00 to Max; finals at 21:00.
Sat 14 Nov morning: Max watches both, uploads; V7; submission in the evening. Mon 16 Nov: Demo Day V1 to Dan.

---

## G. CLAIMS AND WORDING RULES

### G.1 Every claim in both scripts

Paths are in the repository (main unless a branch is named). "Code" means the behaviour is in the code named. Each
row was opened and checked on 12 Nov (number, date, id, status).

| Id | Claim as said or shown | Source | Note |
|---|---|---|---|
| C01 | Purser lets AI agents pay company bills only within limits the CFO signs with Face ID; a limit in a prompt is only a request; code checks the limit and the rails check again. | docs/claims.md line 140 (`WHAT_IT_IS`: "AI agents are starting to spend company money; Purser lets them … only within limits the CFO signs with Face ID"; "One CFO policy, a lock per rail … A prompt is not a control"); the rail checks: C12, C13, C26 | Framing; each rail is backed by its own run. |
| C02 | Claude agents propose payments; past a limit, the CFO signs (the exact terms, with a passkey). | docs/runs/2026-11-03-main-run.md (P-0005 created by the Treasury agent, claude-opus-5-5); awx-1.md (P-0001 proposed by the Sourcing agent, Claude Haiku); src/policy/approvals.ts | Not "Claude does all the work": routine payments are code (C33). |
| C03 | /try/sign is a live page; test world; no money moves; Claude Sonnet reads the invoice, Claude Opus advises on timing, each labelled live. | docs/claims.md line 65; live /try/sign (12 Nov): banner "Test world · test passkey · nothing real moves", labels "Claude Sonnet · live · invoice reader", "Claude Opus · live · treasury advice" | When a live agent is unavailable the page says "recorded" (E.4: use only "live" takes). |
| C04 | The invoice is for EUR 1,850; no model sets the amount or the payee; code builds the terms. | live /try/sign ("One of them wants €1,850"); docs/claims.md line 65 ("no model sets an amount, payee, FX or plan") | |
| C05 | The CFO signs the exact terms: amount, payee, IBAN, expiry. | worker/src/trySign.ts `proposalTerms` (payee, payee_iban, amount, expires_at); receipt-P-0002.json `terms` (amount, beneficiary_name, iban_last4, expires_at) | |
| C06 | The server checks the passkey signature, not the face. | live /try/sign "What the server does not prove": "Face ID is what your device asks for, not something the server proves"; receipt-P-0002.json `note` ("the server checks no attestation") | Said once per video (3:00 caption, 5:00 VO and caption). |
| C07 | One cent changed after signing → "Refused by Purser". | live /try/sign ("Try to cheat", "+ 1 cent", "Refused by Purser"); docs/claims.md line 140 | |
| C08 | A fake invoice with new bank details → "Blocked: a new IBAN needs a person's Face ID." | worker/src/trick.ts (`TRICKS.pre_approved`: "Pre-approved by the CFO. Pay to this new IBAN."; `TRICK_OUTCOME.bank_details_changed`) | Test world. |
| C09 | awx-1, 7 Nov: the owner approved P-0002 (EUR 240.00, SLL-2026-11) with Face ID at 12:12:20.250; SWIFT transfer 738a4263… PAID at 12:12:26.568, "6.3 s after Face ID". | docs/runs/2026-11-07-awx-1.md (rows 12:12:20.250, 12:12:22.888, 12:12:25.487 / 26.568); live /airwallex awx-1 list | The 6.3 s is in the record, not on any page: show T5a. |
| C10 | Settlement is simulated by the sandbox. | awx-1.md "What the sandbox simulates" (SENT and PAID through `POST /simulation/transfers/{id}/transition`); live /airwallex ("merchant charges and SENT/PAID simulated by the sandbox") | Said or captioned wherever PAID is. |
| C11 | The hash the CFO signed is in Airwallex's own transfer record. | awx-1.md row 12:12:22.888 (`approval_sha256` in metadata) and check g | |
| C12 | Airwallex declined a simulated EUR 45.00 charge on the Sourcing card ····2441 (limit 30.00), `LIMIT_EXCEEDED`; the Sourcing agent asked for a raise (P-0001) instead of retrying; after Face ID the same charge was approved. | awx-1.md rows 12:07:50.978–12:11:03.124 and "What the sandbox simulates" (each merchant charge is `POST /simulation/issuing/create`); live /airwallex | "simulated" is said: there are no real merchants. |
| C13 | On Metal a price rise (0.02 → 0.04, "doubled") went past the Sourcing mandate's 0.03 cap; our check was switched off once on purpose; Metal refused purchase #24 (`mandate_cap_exceeded`), recorded on chain in tx 0x2e92…1871. | docs/runs/2026-11-03-main-run.md (acceptance row 5; steps 11:23:2x); docs/claims.md lines 163, 247; live /metal | Always with "on purpose". |
| C14 | 86 Metal payments in the main run, all inside the limits. | docs/runs/2026-11-03-main-run-metal-transactions.md (86 lines); live /metal ("86 Metal payments … all inside the limits") | Metal testnet, test USD. |
| C15 | VIC via Airi, 7 Nov: EUR 12.00 paid without the CFO; EUR 45.00 (over the EUR 20.00 limit) paid only after the CFO's Face ID; a disallowed shop refused by Purser with 0 Airi calls. | docs/runs/2026-11-07-vic-1.md (first paragraph, timeline); docs/demo/airi-run.json; live /visa | Airwallex sandbox, Airi's test card ····1111, test money. Not "on its own": Airi asked the cardholder to confirm each purchase (live /visa). |
| C16 | 95 of 95 main-run journal entries posted to T:0's sandbox on 10 Nov; T:0 matches our books line by line; a second push posted 0. | docs/runs/2026-11-10-t0-journal-sandbox.md (Result, Posted); live /runs | The 5 Nov attempt failed (401); do not say "first try". |
| C17 | Moneybird sandbox (12 Nov): a test company's purchase invoices read back with 0 differences; the payment ran on a stand-in rail. | origin/moneybird-live-1112: docs/runs/2026-11-12-moneybird-sandbox.md (Result: "all 6 purchase invoices … 0 differences"; Labels) | **[needs merge]**. Not on any site page: show the record (T5e) or P3. |
| C18 | The owner's real signature on P-0002 (SLL-2026-11, EUR 240.00, terms hash b0f075d9…f7bb, ES256), checked in the browser; one cent changed → the check fails. | docs/runs/2026-11-07-awx-1/receipt-P-0002.json; /try/verify (src/try/verify.ts, WebCrypto in the browser); `npm run verify-receipt` on 12 Nov: VALID, and with 240.01 "NOT VALID (terms hash)" | Not Home's hero (a labelled sample today, see 0.6). |
| C19 | Card limits, payouts and mandates are checked by code and again by the rail. | C12 (cards), C26 (payouts: Airwallex's approval workflow), C13 (mandates) | Not "every limit": refund and FX thresholds are code only. |
| C20 | Purser Cloud demo world: three seeded test companies; invoices via the inbox; one held as possible fraud (changed bank details), one waiting for the CFO's signature, one paid in a foreign currency with its FX, booked, PDFs in the vault under their SHA-256. | origin/cloud-demo-1112: docs/cloud.md "The demo world: three seeded test companies" | **[demo]** Form B only. |
| C20b | Fallback: screenshots of a test company (inbox, several approved at once, an Airwallex account opened through Purser). | docs/after-the-kit.md "Screenshots (test company, stand-ins, test money)" | |
| C21 | Everything in the demo world is a stand-in: no rail and no model called, no real account. | origin/cloud-demo-1112: docs/cloud.md ("Stand-in, and labelled so"; "No rail and no model is called") | On screen the whole time (badge). |
| C22 | Main run, 3 Nov: 24 Claude decisions (Haiku 11, Sonnet 4, Opus 9), 0 fallbacks, USD 0.3170 ("32 cents"). | docs/runs/2026-11-03-main-run.md line 3 and "Fallbacks under 10%" row; live /claude | |
| C23 | The agent read the decline and asked for a raise (`read_decline`, `propose_raise`). | awx-1.md rows 12:07:57.153, 12:08:00.512 | |
| C25 | For the EUR 1,850.00 invoice Purser bought only the missing EUR 623.50 (for USD 704.45) on quote 1605354b…; PAID. | awx-1.md rows 12:12:31.711–12:13:23.039; live /airwallex | |
| C26 | Two locks: Purser's lock was a labelled virtual test passkey; Airwallex's approval workflow held the API payout (4074d684…, EUR 240.00) IN_APPROVAL (10 Nov) until the owner approved it in the sandbox web app (12 Nov); then PAID, settlement simulated. | docs/runs/2026-11-10-airwallex-two-locks.md; origin/runs-timeline-1112: docs/runs/2026-11-12-airwallex-two-locks-paid.md | **[needs merge]** for PAID; fallback says only "held". |
| C28 | Three mandates on /metal, one per agent. | live /metal ("3 mandates on chain, one per agent"); main-run.md acceptance "Flow" row | Shown, not said. |
| C29 | The Airi run passed on the fourth attempt that day. | docs/runs/2026-11-07-vic-1.md first paragraph | Said with C15 in the 5:00. |
| C30 | 48 attacks in the test harness, each starting with part of the system in the attacker's hands; money moved in 0. | origin/zero-trust-1112: docs/zero-trust.md ("48 attacks run, 48 stopped; money moved in 0"; "Airwallex, Metal, the model and the phones are stand-ins"), test/zero-trust.test.ts | **[needs merge]**. The model has **six** layers (L1 the agent … L6 the record and the stop), not five; the script names none. |
| C32 | Platform run, 10 Nov: Airwallex refused 3 payouts from the two newly opened test companies (it wants the paying company's registration number); 1 payout PAID with Purser's fee (settlement simulated). | docs/runs/2026-11-10-platform-e2e.md ("Result", "Not done"); live /runs | Approvals there were a test passkey, not Face ID. |
| C33 | Routine payments ran as plain code. | live /claude ("82 routine payments by code"; "Claude decides the exceptions; routine buying and selling per query is code") | |

Removed claims (see the Check log): C24 (Support's `no_raise`), C27 (mandate change signed by the CFO), C31 (connected
account "stopped at verification").

### G.2 Wording rules

1. **Money on screen = a badge.** Whenever money moves or a payment is shown: the badges listed under "How to read".
2. **PAID always with "settlement simulated"** (spoken or in the caption on the same shot).
3. **Face ID in a real run:** "Face ID on the owner's iPhone" with, at least once per video, "the server checks the
   passkey signature, not the face" (receipt note: "as stated by the owner; the server checks no attestation"). Where a
   virtual or test passkey signed (two-locks lock 1, platform e2e, the demo world, T1, the main run's second
   approver), say so; never call it Face ID.
4. **The Metal refusal** is always "on purpose" (our check switched off once).
5. **Airi run:** "the fourth try" in the 5:00; "test card, test money"; never "on its own" (Airi asks the cardholder).
6. **Not done is said as not done:** 3 payouts refused; the Metal hold capture was never sent (do not mention a capture
   or a refusal there); tokenization and Face ID on chain have no live record yet (do not show them as real).
7. **No partner claims:** never "certified", "endorsed", "approved by", "partnered with"; partner names as text only,
   no logos. Never name competitors. No invented customers, savings, time saved or traction.
8. **The one-cent check:** "your browser checks it" only on /try/verify (WebCrypto, src/try/verify.ts) or on Home's
   hero once it checks the recorded receipt; the signature is "the owner's real signature" only with receipt-P-0002.
9. **"The CFO"**, never he or she, for the anonymous role; "the owner" or "Max" for the person in the real runs.
10. **Numbers exactly as the record:** 6.3 s (awx-1 P-0002), not "6 s" (that is the main run's P-0005); EUR 623.50,
    not "about 620"; "32 cents" only next to "USD 0.3170" on screen.
11. **Kit and awards:** "for Kit 11"; the awards only as entry wording ("entered for…"), never as an outcome.
12. **Plain English, short sentences.** No "revolutionary", no "seamless", no "guaranteed".
13. **Simulated is said:** the card charges (simulated merchants), SENT/PAID, the stand-in rails of the tests and the
    demo world.

---

## Check log

Adversarial check of 12 Nov 2026. Sources opened: /home/user/ro/main (0ecab2a) and origin/main (74e04df),
origin/runs-timeline-1112, origin/moneybird-live-1112, origin/zero-trust-1112, origin/cloud-demo-1112,
origin/home-story-1112, origin/partner-pages-1112, origin/visa-vic-first-1112, plans/2026-11-12/jury-demo/
design-final.md; the live site read with 10 GETs (/, /try/sign, /try/verify, /proof, /runs, /airwallex, /metal,
/visa, /claude, /go = 404). One offline command run: `npm run verify-receipt` on receipt-P-0002.json (and on a scratch
copy with 240.01, deleted). No live API call.

### Timing (150 words a minute, numbers as spoken)

Before: 3:00 had 344 spoken words (the plan said 332), 5:00 had 606 (the plan said 582). Four rows did not fit (the
opening counts in both scripts), and one more fitted but carried two ideas:

| Script, row | Words | Needed | Row | Fix |
|---|---|---|---|---|
| both, 0:00 opening | 46 | 20.4 s | 20 s | rewritten to 44 words (19.2 s with pauses) |
| 5:00, 2:05 /claude | 61 | 25.4 s | 25 s | the awx-1 sentences moved to the Airwallex row; now 40 words in 20 s |
| 5:00, 2:30 Airwallex | 96 | 39.4 s | 35 s | split into three rows (cards 42 words / 20 s; payouts 40 / 18 s; two locks 26 / 14 s) |
| 5:00, 3:50 books | 49 | 20.6 s | 20 s | Moneybird sentence cut to its result; 36 words in 18 s |
| 5:00, 4:10 layers + check | 44 | 18.6 s | 20 s | fitted, but two ideas: split into zero-trust (21 / 10 s) and the check (26 / 13 s) |

After (words / seconds needed / row length): 3:00: 44/19.2/20, 13/6.2/10, 40/17.0/20, 14/6.6/12, 28/12.2/15,
48/20.2/25, 28/12.2/13, 26/11.4/12, 15/7.0/10, 17/7.8/12, 25/11.0/13, 31/14.8/15, end card 3 s: **329 words, 3:00**.
Demo Day close 31/14.4/15. 5:00: 44/19.2/20, 19/8.6/12, 73/30.2/43, 66/27.4/38, 40/17.0/20, 42/17.8/20, 40/17.0/18,
26/11.4/14, 44/18.6/22, 46/19.4/20, 36/15.4/18, 21/9.4/10, 26/11.4/13, 22/9.8/14, 31/14.8/15, end card 3 s:
**576 words, 5:00**. Fallbacks: demo 56/23.4/38, two locks 24/10.6/14, books 28/12.2/18. All fit; nothing was sped up.
The 3-s end cards are now rows of their own (before, the end card sat on top of Max's last 3 s of speech).

### The first 15 seconds

- **Opening rewritten.** Before, what Purser does ("Purser makes the limit real…") came only at 12.8–18.4 s, after the
  15-s mark. Now the first sentence after "Hi, I'm Max" says what it does (done by 8.4 s) and the second why it
  matters (done by about 14 s). A caption from 0:03 says it for a viewer with the sound off: "Agents pay only within
  limits the CFO signs". Max's notes now keep that first sentence word for word.

### Honesty (each claim opened in its record)

- **C31 was false.** "A connected account stopped at verification": the same record's second run (05:30–05:32 UTC,
  10 Nov) took it to ACTIVE, and /runs shows it ACTIVE with a EUR 5.00 payout PAID. Removed; "what is not done" now
  says the three refused payouts (C32) and simulated settlement.
- **Simulated card charges.** awx-1's merchant charges are `POST /simulation/issuing/create`; the 45 euro charge is now
  "a simulated 45 euro charge" in both scripts (C12), as Home already says ("simulated charge").
- **"The owner's real signature" on Home was not real.** home-story's hero checks a labelled sample (rp
  `hero-sample.purser.test`, hash 9cfc78e3…), not P-0002. The check rows now use /try/verify (live) with the real
  receipt-P-0002.json, verified offline today; D1b is kept only if the hero file is swapped (0.6).
- **"6.3 s" is on no page.** Not on /airwallex live, nor on partner-pages. D2's "must be visible: PAID 6.3 s after
  Face ID" removed; the figure is shown from the record (T5a).
- **Moneybird is on no page.** No branch shows it on /runs. D3's "12 Nov Moneybird row" removed; the shot is the record
  (T5e) or Max's own screen (P3).
- **"Fourth attempt" is not on /visa today** (only after visa-vic-first). D4's must-visible line moved to the optional
  re-take; the narration keeps it from the record (C29).
- **The two-locks PAID row is not on /runs today**: today's row says IN_APPROVAL, "not paid". D2's two-locks tile
  dropped (no partner-pages tile says PAID); the shot is D3 (runs-timeline) with T13 as the fallback, and its own
  fallback words.
- **Five layers → six.** The zero-trust model names six (L1 the agent … L6 the record and the stop) and does not list
  Airi. The 5:00 no longer lists layers; it says what docs/zero-trust.md says (48 attacks, money moved in 0) with the
  badge "Test harness · stand-in rails", because the tests run against stand-in rails.
- **C27 dropped.** "The CFO signed the change" (the mandate replace): the second signature was a labelled test
  passkey pressed by the build tool (main-run.md "Second approver"; /metal "Face ID in Purser + a build-tool test
  passkey"). Too long to say honestly in the time; the sentence is gone.
- **C24 dropped and the awx-1 sentences moved.** In the 5:00 they sat under the caption "Main run · 3 Nov", but they
  are from awx-1 (7 Nov). Now in the Airwallex row with "awx-1 · 7 Nov".
- **Airi "ran on its own" → "needed no CFO".** /visa: "Airi itself asks the cardholder to confirm each purchase with a
  passkey."
- **"Claude agents do the work" (0:20 rows) → "Claude agents propose payments".** /claude: "Claude decides the
  exceptions; routine buying and selling per query is code." The 5:00 now also says "Routine payments ran as plain
  code" (C33).
- **"Every payment is booked in a double-entry ledger" (3:00, books row) removed:** a universal claim with no record;
  the row now says only what the T:0 record says.
- **"Treasury proposed two new budgets"** gone with C27 (the record says two options, P-0002 and P-0003).
- **"Metal … tx status"**: T4 note added; the explorer shows the record tx and an undecoded MandateRefused log, so the
  caption never says "failed".
- **Form A (/go) is not stand-in.** design-final.md: /go runs live agents, a real sandbox payout and a live Metal read,
  and forbids "stand-in". The plan's D5-A shared the stand-in narration; now no /go words are written until it ships
  (0.5). "A demo world you can open yourself" became "a demo world of test companies" (no public deployment exists).
- **P1 timing risk added (0.4, E.4):** once /go deploys, /try/sign loses its model key and shows recorded answers.
- **Checked and kept** (each number found in its record): EUR 240.00, P-0002, 738a4263…, 12:12:20.250 → 12:12:26.568
  (6.3 s), `approval_sha256`, ····2441, limit 30.00, `LIMIT_EXCEEDED`, EUR 623.50 / USD 704.45 / quote 1605354b…,
  #24, 0.04 over 0.03, tx 0x2e92…1871, 86 Metal payments, 24 decisions / 0 fallbacks / USD 0.3170 (Haiku 11,
  Sonnet 4, Opus 9), 82 routine payments by code, EUR 12.00 / 45.00 / limit 20.00 / 0 Airi calls / fourth attempt,
  95 of 95 / 0 differences / 10 Nov, two locks 4074d684… IN_APPROVAL 10 Nov → PAID 12 Nov with a test passkey,
  Moneybird 0 differences / stand-in rail, 3 payouts refused / registration number, terms hash b0f075d9…f7bb / ES256,
  /try/sign €1,850, "Refused by Purser", "Blocked: a new IBAN needs a person's Face ID.", terms fields (payee, IBAN,
  amount, expiry).

### Calm

- **Captions cut to at most 8 words, one per shot** (all 38 captions and badges counted). Before, eight were longer,
  e.g. "Live page · test world · no money moves · Claude calls are live" (11), "Face ID on the owner's iPhone · the
  server checks the passkey signature, not the face" (15), "awx-1 · 7 Nov · P-0002 · EUR 240.00 · transfer 738a4263…
  · settlement simulated" (10), "Metal testnet · 3 Nov · 86 payments on chain · #24 refused · tx 0x2e92…1871 · let
  through on purpose" (16). What the badge already says is no longer repeated in the caption. V3's test now says 8
  words and 48 characters (four captions are 43–47 characters, over the old 42).
- **One idea per shot.** 3:00 1:45 (Airwallex card + Metal + a caption-only Visa line in one 25-s row) split into three
  rows: card (13 s), Metal (12 s), Visa (10 s, now spoken). 5:00 2:05 (/claude + /proof) lost the /proof shot (T6 is
  spare). 5:00 2:30 and 4:10 split as above. 3:00 0:20 and 5:00 0:20 carry no caption (the page's H1 says the same).
- **Nothing on screen the site does not show:** the removed must-visible lines above (6.3 s on /airwallex, Moneybird
  on /runs, "fourth attempt" on /visa, two locks PAID on /airwallex, the real receipt on Home).
- **Moneybird left the 3:00.** It is not on the site and its record is not merged; the 3:00 books row keeps T:0 only,
  which is live on /runs today. The 3:00 now has no [needs merge] line.

### Shot list

- New shots for lines that had none or used gated pages that do not show them: T2a/T2b (split /metal), T8
  (/try/verify), T9a–c (/airwallex, live today), T10 (/visa, live today), T11–T13 (/runs, live today), T14 (today's
  Home), T5e (Moneybird record), E3/E3-DD/E5 (end cards), M2-DD. P1 split into P1a–d, one per idea.
- D2 and D4 became optional re-takes; D3 now shows only the two-locks row; D5-A has no script; D6 gets a fallback
  (cut) and a "read the count at capture" rule.
- T5c and T6 are spare. D.4 lists the shot of every row of both scripts.

### Other fixes

- Header word counts and the "140 words a minute" pace corrected to 150 (B, C, E.1, E.3, Max's notes).
- V2's test now checks the per-row timing at 150 words a minute and the 15-s opening, instead of a total word limit.
- G.2 rule 5 and 13 added or sharpened (Airi not "on its own"; simulated is said); rule 8 points at /try/verify.
- Section 0 gained points 3 (zero-trust, origin/main moved), 4 (P1 before /go), 5 (Form A vs B) and 6 (Home's sample
  receipt).

# Purser: strict jury review and technical QA (6 November 2026)

Reviewed as a judge who had never seen Purser. I only read things: nothing was fixed, committed, pushed or deployed. Repo: `origin/main` = `26d96e7`.
Evidence (transcript, frame sheets, screenshots, Lighthouse reports, logs) was kept outside the repo, in the review session's working folder; paths below are relative to it (`jury-run/`, `qa/`).

## 0. Fix these before anything else

1. **Every `v1.0-submission` link in the form is a 404 today.** `git ls-remote --tags origin` lists 0 tags. These links all return 404: `tree/v1.0-submission`, `blob/v1.0-submission/docs/run-it.md` (the Instructions field), all 8 screenshot URLs and the deck URL. The files themselves are on `main`. Push the tag before you submit, then check every link in the form. (5 min)
2. **There are two deadlines.** The microsite says "Nov 13: Project submissions due" (https://airwallex.hackerearth.com/). The HackerEarth page says the build phase ends Nov 15 at 18:29 UTC. `docs/rules.md` also says Nov 13. Submit before **13 Nov 18:29 UTC**.

## 1. Scores (strict, out of 10)

| Area | Score | Why | What's missing for a 10 |
|---|---|---|---|
| 1 Finance and product value | **5.5** | The user is clear: the CFO of a small company whose agents spend money. Agent spend control is a real problem now. But the business is contrived: an outdoor wholesaler sells 5-cent stock checks to a simulated retailer's agent, with a 20-dollar budget, a €240 bill and 0.15 in refunds. Nothing shows anyone wants this. There is no price, no buyer and no "why now" anywhere in the README, the form or the long description (a grep for pricing or business model finds nothing). A finance judge sees a careful demo, not a product. | One quantified pain (what a CFO does today without Purser: shared cards and after-the-fact expense review). A named buyer and a price (for example, per agent per month on top of Airwallex). One real CFO quote, if one exists. Amounts a CFO recognises (the €1,850 invoice in /try/sign does this better than €240). |
| 2 Airwallex relevance and financial context | **5.5** | The good parts: a card per agent (Issuing, with limits, merchant category codes (MCC), currency and end date written by policy), FX for only the shortfall on a locked quote, a SWIFT payout with `approval_sha256` in its metadata, and floors and quotes that shape the amount. The weak part is how little Airwallex does in the main run: 4 movements, and 2 of them simulated (the €45 card charge and the 0.69 deposit). `airwallex_events.total = 0`, so no webhooks fired in the main run. The card decline comes from a separate TAP run and is "not counted". Airwallex first shows up at 1:06 in the film. /try/sign makes no Airwallex call at all. | Put Airwallex at the centre of a scene: an agent's card spend checked against the card controls, a balance or floor that changes what the agent decides, and the `approval_sha256` in the transfer metadata shown as an API response. Show the Airwallex sandbox web app in the film. |
| 3 Agentic behaviour and controls | **8** | This is Purser's strongest area. Each agent has a mandate on chain. Metal refused 2 purchases. The approval is a WebAuthn signature over the hash of the exact terms, and /try/sign shows a tampered amount being refused. Also: four eyes, an injection that was ignored, a hash-chained audit log (412 rows, intact), and Claude proposing options A and B. Points lost: the refusal was staged ("let through on purpose"). The "12 skipped by Claude" were done by code under a rule Claude set (§3, #6). The second approver was a test passkey pressed by Claude Code. The world was scripted ("Ridgeline is offline in this world", /watch). | One exception the agent handles that was not set up for it. A real second human approver. Saying plainly that Claude made the decision and code repeated it. |
| 4 Technical execution | **8** | A fresh clone works first time. `npm ci` took 27 s with 0 vulnerabilities. `npm test` ran **2365/2365 tests in 248 files** in 236 s. `npm run judge -- --check` passed 17 of 17 routes in 3 s. Clone to green took **4 min 31 s** (`jury-run/summary.log`). The live site loads in about 0.6 s per page. With a virtual authenticator, /try/sign takes 4 clicks and every step works: the world opens, the passkey is made, the payment is signed and verified, and the tamper is refused (`jury-run/sign/d-sign-05-*.png`). Points lost: judges can only replay the run. They cannot start a live run themselves. Settlement is simulated, T:0 posting failed, and the system is spread over many runs (recorded run of 30 Oct, agent run of 2 Nov, main run of 3 Nov, TAP run). | Something a judge can start that touches the sandbox or testnet (Rokit12 has this, §5). Or at least one link from each /try/sign step to the matching real artefact in the main run. |

### The prizes, realistically

| Prize | Realistic? | Reasoning |
|---|---|---|
| **Metal Award, $15k** | **Possible; a contender, not a lock.** | Purser uses Metal deeply: 86 payments on testnet, a mandate per agent, refusals recorded on chain, mandates replaced after approval, refunds as mandate pulls, a sweep after finality, and a 2-of-2 account plus clearing in separate runs. But many teams entered Kit 11, and several entries tell the **same story**, because the story is the kit brief (§5). Rokit12 claims "400+ payments" per live run. Purser wins only if judges remember Face ID on the exact terms and real Claude agents. The current materials do not lead with those. |
| Founder's Choice, $30k / Judges' Choice, $20k (open) | **Unlikely (low).** | Open prizes go to entries where a founder sees a company. Purser presents as an exhaustive proof of a kit scenario. Its claims are heavily qualified, it has no business model, and its amounts are toy-sized. The video has no real product footage. |
| Visa Award, $15k | **No.** | Visa said on 5 Nov that TAP is not eligible. TAP still uses up attention on Home, /proof and screenshot 6 (§3, #7). |
| Final 8 / Demo Day | Possible. | The engineering quality is clearly top-tier. Whether Purser is picked depends on the first 30 seconds of the video and the form. |

## 2. What the judge experienced (timed)

- **Form (about 2.5 min to read).** The synopsis opens with three events, which is good. Then the reader meets "Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest". That is three clauses about mechanism before any statement of value. The description has 3,953 characters, and about a quarter of them are caveats. They include T:0 error codes ("403 CAPI71", "401 CAPI11"), "settlement simulated", "second approver a labelled test passkey", "Visa TAP… not eligible", and "Not counted: Airwallex declined EUR 45.00… separate TAP run". A judge cannot say in 10 s **what is new here** compared with the kit. The jargon a non-crypto finance judge will not know: mandate, x402, on chain, tx, `mandate_cap_exceeded`, four eyes, passkey, hash.
- **Video, 2:42.** Transcript: `jury-run/transcript.txt`. Frame sheets: `jury-run/sheets/sh01–sh06.png`.
  - 0:00–0:07: "AI agents can now spend money, so who signs off?" This is a question, not a problem with a cost. 0:07: "This is Purser, built by Max Geurtsen." The CFO is not named until 0:24, and the first concrete scene starts at 0:27.
  - **Every frame is motion graphics.** The approval screen is labelled "Reconstruction of the approval screen" (1:06–1:14). The /try/sign phone is "A mock of the live page, drawn from its code" (1:33–1:41). There is no real screen recording, no Airwallex web app, no Metal explorer, and no real Face ID prompt.
  - The numbers match the record: 86 payments, 41+41+3+1 (`main-run.json` rails). Refusals 12/2/1/1 (`snapshot.refusals`). 24 decisions = 11+4+9. 6 s, 11:31:18 to 11:31:24. EUR 110.00 for USD 124.29, fee EUR 13.42 against a cap of EUR 20.00, EUR 240. 12 orders with #7, #10 and #13 refunded, 0.15 total. 5 Face ID decisions. Mandates 10+4+6 = 20.
  - The 24/24 frame is a count-up (13/24 at 1:49) that stays on screen only about 2.5 s (1:49–1:51). Paused there, it reads as "13/24".
  - Voice and picture line up within about 1 s everywhere I checked (0:28 price, 0:48 86 payments, 0:57 dispute, 1:06 phone, 1:15 "6 seconds").
  - Audio problems: see #9.
  - Pacing: 0:27–1:21 is dense and good. 1:24–1:48 (why Face ID, try it) works. 1:48–2:15 is a stats wall. 2:15–2:42 is a recap and credits, about 27 s with no new information.
- **README first screen (lines 1–24, about 60 s).** Line 3 is an abstract tagline. Line 5 is 5 badges. Line 8 is the hook. The sentence that says **what Purser is** ("Purser gives each AI agent… its own Airwallex card and its own Metal on-chain mandate") sits on **line 17**, after the /try/sign paragraph. Line 24 brings up Visa TAP. In 30 s I knew the scenario but not the product.
- **Live site.**
  - Home is clean (`jury-run/live/d_-fold.png`). It has 4 equal-weight buttons (Watch, Try it, Sign with your own Face ID, Proof). On a 390 px phone, which is where Face ID actually works, none of them is above the fold (`m_-fold.png`).
  - /try/sign works (4 clicks, about 15 s). But step 1 says "Stand-in executors only… no Airwallex, Metal or Claude call". The agent text is "fixed text, no model call". Under the button sits a 130-word disclaimer. Hands-on, a judge sees a WebAuthn demo, not a banking agent.
  - /proof gives three different payment counts on one screen: "82 routine payments by code", "87 inside the limits" and "86 on Metal". Visa TAP has a card as large as Metal's and Airwallex's.
  - /watch auto-plays and is clear. It shows "Decided by code, the default buy policy" on the hero refusal.
  - The site logged one console 404 on the first desktop load and none on a re-check.
- **Repo:** see area 4 in the scores table.

## 3. TOP 10 problems, ranked by impact on winning

| # | Problem | Evidence | Proposed fix | Time |
|---|---|---|---|---|
| 1 | **Not differentiated from the kit brief or other Kit 11 entries.** Purser's "three moments" are the Kit 11 scenario itself: the price rises past the 3-cent cap, the purchase is refused on chain, Treasury re-plans within 20 USDZ, a batch is disputed and the bad-data orders refunded, earnings are swept, and a EUR licence is paid by FX and SWIFT. Quartermaster's tagline, "The model proposes and explains. Code and the chain decide.", is nearly the same as Purser's line 3. | Rokit12 `kits/11-x402-business-agents/README.md` steps 3–6; https://github.com/big14way/quartermaster README; Purser README:3 | Open every surface (form synopsis, README line 1, home hero, video 0:00–0:10) with **what only Purser has**: (a) the CFO signs the hash of the exact terms with Face ID, and one cent changed makes the signature worthless (try it); (b) one CFO policy becomes both an Airwallex card limit and a Metal mandate per agent; (c) real Claude agents, 24/24 decisions and 0 fallbacks, holding no keys. Introduce the three moments in one line: "the Kit 11 scenario, run live". | 2–3 h (copy) |
| 2 | **The video shows no real product.** Every frame is animation. The approval screen and /try/sign are labelled reconstructions or mocks. Fintech and VC judges want to see it run. Rokit12's video shows the Airwallex dashboard after each kit. | `jury-run/sheets/sh03.png` (1:06–1:14 "Reconstruction…"), `sh04.png` (1:33–1:41 "A mock of the live page") | Replace 20–30 s with real captures: a phone screen recording of /try/sign with the real Face ID sheet; the Metal explorer page for `0x2e92f9cb…1871`; the Airwallex sandbox web app showing transfer `03360bfa…` PAID, with metadata if the UI shows it. Keep the animations around them. | 3–5 h |
| 3 | **No company story** for the open prizes, which carry 3× the money of the Metal Award: no buyer, price, market or "why now". | No pricing or business-model text in the README, form, or `docs/submission/long-description.md` (grep) | Add 3 lines to the form and one slide or card: who buys (SMB finance teams on Airwallex giving agents cards), what they pay (per agent per month, or bps on governed spend), why now (agent cards, x402, every bank shipping agent rails, while controls stay prompt-deep). No invented traction. | 1–2 h |
| 4 | **Airwallex is thin in the main run**, even though Airwallex runs the hackathon (judging area 2). It does 4 movements and 2 are simulated. 0 webhooks fired. The card decline comes from a separate run. Airwallex appears at 1:06 of the film, and /try/sign does not touch it. | `main-run.json`: `rails.airwallex` (simulated flags), `airwallex_events.total=0`, `card_spend.rows` = 1 simulated charge; /proof "4 movements at Airwallex" | Without a new run: lead the Airwallex story with the controls Airwallex itself enforces (card limit, MCC, currency and end date written from the CFO policy) and with `approval_sha256` in the SWIFT transfer metadata. Show that metadata as a real API response on /proof and in the film. That detail is unique and checkable. | 2 h |
| 5 | **Numbers that look different on different surfaces.** Payments: 82 / 86 / 87. Approvals: "5 Face ID" vs "6 signatures". "16 stops" includes 12 repeats of one rule and 1 staged refusal. A skimming judge loses trust. | /proof headline (`jury-run/live/d_proof-full.png`); Home "87"; film 0:48 "86" | Pick one canonical set: "86 Metal payments + 1 card charge"; "5 decisions signed with Face ID (+1 co-signature)". Show stops by kind: "4 kinds of stop: rule skip ×12, Metal ×2, CFO ×1, injection ×1". | 1 h |
| 6 | **Overclaim: "Claude skipped 12 overpriced checks".** The record says the skips were "code: the Sourcing agent's buy policy, as the Sourcing agent (Claude Haiku) set it" (17 occurrences). Only 6 Sourcing wakes fall in the #25–#36 window. In an entry whose brand is honesty, a judge who finds this will discount everything else. | `main-run.json` refusal reasons and traces (`run_seq` 133–210); film 1:54–2:00 and voice at 1:54; form "16 stops" line | Change the wording to "Claude set a buy rule; code applied it to 12 overpriced checks". Fix the form, README, home and /proof now. Fix the film if you re-cut it anyway. | 30 min (text), +1 h (film) |
| 7 | **Too many caveats, and Visa TAP still on show.** About a quarter of the form description is caveats, including T:0 error codes. Home scene 3 says "€45 card buy, signed with Visa TAP". /proof gives TAP a full partner card. Screenshot 6 of 8 is /visa. This reads as off-target and defensive. | `formulier-v1.0.md` "What is real…" paragraph; `jury-run/live/d_.txt`, scene 3; /proof grid; form screenshot list #6 | Keep honesty to one line plus a link ("Test money. Simulated: customer, supplier, settlement, second approver. Details →"). Drop the T:0 error codes from the form. Move TAP to a footer link. Replace screenshot 6 with /try/sign signed and tampered. | 1 h |
| 8 | **The hero refusal is staged.** "Let through on purpose. Purser normally refuses first" (film 0:33, Home, form). /watch says "Decided by code, the default buy policy". Judges will ask whether Metal's refusal ever happens in normal operation. | `sh02.png` 0:33–0:36; /watch step 1 | Frame it as a test that proves the layer underneath: "We switched off our own check to prove the chain holds the line." Show both layers side by side (Purser refuses first; Metal refuses anyway). | 30 min copy |
| 9 | **The voice-over is ambiguous in key places, with no captions.** "an agent pays **alone**" at 0:21 is heard as "pays **a loan**" by two ASR models (small.en and medium.en; p=0.31 even when primed). "Ours" at 2:11 → "Hours". "Purser" → "Perser" or "Persa". "Metal refused it" (~0:36) is not picked up at all. YouTube auto-captions will repeat these errors. | `jury-run/transcript.txt` [20.9–23.6], [131.6], [6.7], [32.8–40.6] | Upload a corrected SRT to YouTube now (it does not change the video). If you re-cut, say "pays on its own" and "Simulated:" instead of "Ours". | 15 min (SRT), 1 h (re-cut) |
| 10 | **The first 10 seconds and the first screen don't sell.** The video opens with a question and the builder's name. The CFO comes at 0:24. In the README, "what it is" is on line 17, after the badges. On mobile, the "Sign with your own Face ID" button is not above the fold. | Transcript 0:00–0:11; README:3–17; `jury-run/live/m_-fold.png` | Video: open with the problem and the user ("Your agents have cards. Today a prompt is the only thing between them and your bank account."). README line 1: what Purser is in one sentence plus the three unique things. Mobile: put the /try/sign button above the animation. | 30 min README/home, 1–2 h video |

Also noted, lower impact:
- The 24/24 count-up is on screen for only about 2.5 s.
- The deck and the 8 screenshots are hosted only behind the missing tag (§0).
- Treasury's EUR balance in the sandbox (`treasury.airwallex.eur`: available 9,969,362.52, committed 9,944,355.94, free 6.58) looks engineered if a judge opens the dashboard. It is not explained on the public pages.

## 4. Do not do

- **No new live main run** before submission. The current record is consistent and checked. A new run risks new inconsistencies across about 200 claims, and Visa and T:0 are out of scope anyway.
- **Do not build a judge-runnable live console** that moves sandbox money (as Rokit12 did). It is tempting, but with one builder and about 7 days it risks shared-key abuse, rate limits and a broken demo while judges watch. Instead, link /try/sign steps to the real P-0005 hash and transfer.
- **No more features** (T:0 retry, TAP polish, more kits, more red-team counts). Breadth is not where Purser loses. Focus and storytelling are.
- **Do not add more caveats or more numbers.** Every new number needs reconciling across about 6 surfaces.
- **Do not make the film longer.** 2:42 is right. Swap animation for real footage at the same length.
- **Do not claim Face ID is proven by the server.** The current wording is correct (attestation "none"); keep it.
- **Do not pursue Visa further** or re-enter TAP.
- **Do not name competitors on any public surface** (form, README, site, film). Use the differentiators below without the comparison.
- **Do not chase "more payments than Rokit12"** (400+). Volume on testnet is not Purser's story. Signed exact terms and real agents are.

## 5. Competitor: Rokit12 (and Kit 11 peers), facts only

**Rokit12 / "Airwallex Agent Desk"** (Robinson Muiru), https://github.com/Rokit12/airwallex
- 15 agents, one for each of kits 1–12 plus 3 more, for "Trailhead Outfitters LLC" on the Airwallex sandbox. 32 commits; the last is 5 Nov ("Retry evidence uploads…").
- **Hosted console** on AWS CloudFront (https://d1zoxhgak5pvwd.cloudfront.net/, HTTP 200 on 6 Nov) with a **shared judge login** (Cognito; the credentials are in its README). A judge presses "Run agent" and then "Approve these terms", and the run **moves money in the Airwallex sandbox**.
- Video under 5 min on Google Drive. Per the README, it shows "the same activity in the Airwallex dashboard and inbox" after each kit.
- Kit 11: "Metal: live on testnet… Every sale is two x402 payments… **over 400 in a run**". It uses `requireSignedOffer`, `createMandatePaymentClient` and `verifyMandatePayment`. Its flow is the same as Purser's: price to 4c, refusal on chain, re-plan within 20 USDZ, a disputed batch of 18 with 4 refunded, sweep, a deposit credited by tx hash, FX and SWIFT to PAID. The "200+" in your brief may be an older figure; the current README says 400+.
- Decisions are **deterministic code** (`policy.ts`: `proposeReallocation()`, `resolveDisputedBatch()`). Claude is optional ("rules only" without a key); it "reads the incoming emails… and explains decisions" (`src/core/llm.ts`). The approval is a button under the login, with no cryptographic binding to the terms. The only terms hash is in kit 9's credential provider (`src/commerce/credentials.ts`).
- Airwallex breadth: transfers, FX, Issuing, payment intents, disputes, files, connected accounts, Global Accounts.

**Other Kit 11 entries telling the same story:**
- Quartermaster: https://github.com/big14way/quartermaster. Its pitch: "The model proposes and explains. Code and the chain decide." The README has a 4-min YouTube video of a live run, a human approval "bound to the exact mandate change", and books reconciled to the cent.
- Tripwire: https://github.com/Cubiczan/tripwire. Metal Kit 11 + 12 clearing, a Claude verifier, Slack approvals, a hash-chained audit log, and **T:0 books live** (which Purser could not post to).

**Where Rokit12 is stronger:** a judge can run it live and move sandbox money; it covers far more Airwallex surface (15 kits); it does more Metal payments per run (400+ vs 86); and its video shows the real Airwallex dashboard.

**Where Purser is stronger:**
- (1) Real Claude agents make the decisions (24/24, 0 fallbacks, each with a request id). Rokit12's decisions are code.
- (2) The approval is cryptographic: a WebAuthn passkey signs the SHA-256 of the exact terms, the server verifies it, a one-cent tamper is refused, and anyone can try it at /try/sign. Rokit12 uses a button behind a shared password.
- (3) A per-agent Airwallex card and Metal mandate, both written from one CFO policy.
- (4) `approval_sha256` travels in the Airwallex transfer metadata. There is a hash-chained audit log (412 rows, intact).
- (5) Depth of verification: 2365 tests, `npm run judge` with no keys, a claims ledger.

**How to make the difference clear (one line each, use everywhere):**
1. "An approval is usually a button. Purser's approval is a signature over the exact terms: change one cent and it's worthless. **Try it in 30 seconds.**"
2. "The rule is enforced three times: in Purser's code, by Airwallex on the card, by Metal on chain. A prompt is not a control." (This echoes Dan Kim's governance article.)
3. "Real agents, not scripts: Claude Haiku, Sonnet and Opus made all 24 decisions and hold no keys."
4. "Every payment carries its approval: the hash the CFO signed sits in the Airwallex transfer's metadata and in the hash-chained audit log."
5. Make /try/sign the first button everywhere, and show it in the video with a real phone recording.

## 6. Technical QA (live site from main `26d96e7`, same day)

All three engines (Chromium, WebKit 26.6, Firefox), 24 pages, at 360, 390, 768 and 1440 px, light and dark: 576 loads.
No page errors, failed requests, broken images or "null/undefined/NaN" on screen; the 404 page returns 404.

| Width | Chromium | WebKit | Firefox |
|---|---|---|---|
| 360 | FAIL `/try` (scrolls sideways) | FAIL `/try` | FAIL `/try` + favicon CSP errors |
| 390 | PASS | PASS | favicon CSP errors only |
| 768 | FAIL `/?autonomy` (table too wide) | FAIL `/?autonomy` | FAIL `/?autonomy` + favicon CSP errors |
| 1440 | PASS | PASS | favicon CSP errors only |

`/try/sign` with a virtual authenticator (Chromium; 360, 390, 768, 1440): every step passes, and the +0.01 tamper is
refused.

Lighthouse 12 (mobile = desktop), performance / accessibility / best practices / SEO: `/` 100 / 95 / 100 / 66;
`/proof` 100 / 100 / 100 / 58; `/try/sign` 100 / 100 / 100 / 63. SEO is low only because the site sends
`x-robots-tag: noindex, nofollow` (on purpose); `/proof` also fails link-text (four "More" links); Home's 95 is colour
contrast on dimmed animation items (1.73–2.22:1).

Links: README and docs/submission, 103 links, all resolve (the Actions badge returns 403 to unauthenticated requests
only). Live site: 108 unique links, all 200; the 58 Metal tx links show "finalized".

Facts against `docs/demo/main-run.json`: 16 stops (12 + 2 + 1 + 1), over-limit 0.00, 24/24 (11 + 4 + 9), 86 Metal
payments (41 + 41 + 3 + 1), 6 s (6.07 s), 5 Face ID decisions, 2365 tests: all confirmed. The honesty grep found no
stale claim on the site or in the judge-facing docs.

| # | QA finding | Evidence | Fix | Time |
|---|---|---|---|---|
| Q1 | `/try` scrolls sideways at 320–375 px (header nav 386 px; "Proof" cut off). `pages.check` tests only 390 and 1440. | `qa/evidence/try-360-top.png` | Let the nav wrap or hide the "what's real?" pill below 390 px; add 360 to `pages.check`. | 30 min |
| Q2 | `/?autonomy` scrolls sideways at 768–820 px (model table 864 px; Cost cut off). | `qa/evidence/autonomy-768-table.png` | Scroll the table inside its box, or stack it below 900 px. | 30 min |
| Q3 | `/film` is the 30 October film (Bergtex €1,850, "Who is holding the pen?", "39 of 39"), linked from /proof as "The film". No page links the 2:42 YouTube film. | `qa/text/film-timeline.txt`, `qa/text/_proof.txt:154` | Label `/film` as the earlier 30 October animation; link the YouTube film from Home and /proof. | 30 min |
| Q4 | The YouTube description says "inside limits they cannot break" (banned by `docs/claims.md:211`) and "a euro invoice is paid by SWIFT" without "settlement simulated". Auto-captions garble names. | YouTube page | Edit the description in YouTube Studio; upload `docs/video/subtitles-v5.srt` as captions. | 15 min |
| Q5 | `og:image` is relative ("assets/og.png"): a 404 on `/try/sign`; share cards may not render. Six pages have no description, og or favicon tags. | meta crawl | Absolute `og:image`; shared meta on every page. | 30 min |
| Q6 | `docs/submission/README.md:90` says the deck has twelve slides; it has 10. | `purser-deck.pdf` | Correct the count. | 5 min |
| Q7 | `docs/claims.md` keeps a site section about agent run 1 (38/38, 1.97 swept, P-0007) and "Last checked on 4 November". | `docs/claims.md:209–220` | Bring that section to the main run's figures. | 30 min |
| Q8 | Three taglines: "AI agents spend. You sign off." (Home, YouTube), `og:title` "Agents spend. Limits hold.", `/film` "Agents move at machine speed. The CFO signs off."; the README, form and deck use none. | meta crawl | One tagline everywhere. | 30 min |
| Q9 | Firefox logs a CSP error for `/favicon.ico` on `/policy`, `/approve`, `/metal/report`; `/favicon.ico` is a 404. | `qa/site/firefox/` | Serve `/favicon.ico` or add `<link rel=icon>` there. | 15 min |
| Q10 | Small: no Permissions-Policy on the 404; HSTS without includeSubDomains; four "More" links on /proof; "Claude cost, last hour" on a replay of 3 Nov. | Lighthouse, headers | Copy and header fixes. | 30 min |

Not checked: real iOS Safari and real Face ID; WebAuthn in WebKit and Firefox (Playwright's virtual authenticator is
Chromium-only); the private CFO `/approve` and `/policy` flows; Airwallex ids (no keys used).

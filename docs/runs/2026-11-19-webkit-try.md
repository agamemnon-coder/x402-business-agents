# The public /try in WebKit (Safari's engine), walked 2 times as a visitor, 19 November 2026

The judge's journey on the public demo, https://kit11.max-31b.workers.dev/try, run end to end in **WebKit**, the engine
of Safari, with every answer the page got kept: once at 1440 px in light mode, once at 390 px (a phone) in dark mode.
Each walk is a fresh /try test company. **Test money only**: the company's bank is the simulated bank, and its payouts go
to the **Airwallex sandbox**, where PAID is reached through the sandbox's own simulation endpoint, not by any real
settlement. Nothing was deployed, no admin route was called and no key of ours was used: the walks are what any
visitor's browser does.

**Result: 2 of 2 walks passed every step.** 4 Airwallex sandbox transfers, each SCHEDULED then PAID; 2 approvals whose
hash is the one the 1,850.00 transfer carries; 2 one-cent changes refused with no transfer; 2 EUR 480.00 invoices held
by code with no payout; 4 proof files, each valid on /verify and with the repository's verifier. 30 Claude entries (46
requests to the API) cost USD 0.010642, all by `claude-haiku-5-5`, none fell back to the parser. 0 console errors, 0
requests to another host.

Why only 2: the deployment allows 100 Airwallex sandbox payouts a day for /try, shared with every visitor, and about 60
were already used on 19 Nov before these walks. Each walk makes 2; at most 3 walks were allowed for this record, and 2
were enough to cover both a desktop and a phone profile. One more payout went to the README's animation (below).

## How WebKit signs without a phone

Playwright has no virtual authenticator in WebKit (Chromium's is a DevTools Protocol feature). So the walk uses the
repository's **software passkey**, [`test/browser/support/softPasskey.ts`](../../test/browser/support/softPasskey.ts),
injected before the page's own script: `navigator.credentials.create` and `get` answered in the page by a real ES256
key (WebCrypto P-256), with real authenticator data and a real signature over it and the SHA-256 of the client data,
its counter moving forward. The server verifies these exactly as it verifies a phone's. Its credentials also answer
`getClientExtensionResults()` (`{}`), which /try reads for every passkey it sends (the fix of the mega run's first
Firefox walk, branch `mega-run`, commit `d74cf041`, brought here unchanged). **TEST ONLY**: no biometric is involved, and
it proves nothing about Face ID or Touch ID; it proves the page, the server's WebAuthn checks and the rest of the flow
work in Safari's engine. The page, seeing a Mac's WebKit user agent, named the button "Approve & sign EUR 1,850.00 with
Touch ID"; no Touch ID was used.

## What each walk did

Recorded by [`scripts/try-live-record.ts`](../../scripts/try-live-record.ts) (from branch `mega-run`, commit `d74cf041`,
unchanged): `BROWSER=webkit npx tsx scripts/try-live-record.ts <run> <desktop|phone> docs/runs/2026-11-19-webkit-try`,
then summed by [`scripts/try-live-summary.ts`](../../scripts/try-live-summary.ts) (`npx tsx scripts/try-live-summary.ts
docs/runs/2026-11-19-webkit-try`, which writes `summary.json`). The walk of `test/browser/judge-try.check.ts --live`:

1. **Launch**: "Launch the live transfer demo" makes a test company (`POST /v1/try/start`, 201).
2. **EUR 120.00, paid by the agent alone**: Claude reads the invoice, the checker, coder and payer agents run, the
   policy approves it inside the agent's EUR 500.00 limit, "See the agent pay it" pays it (proposal EXECUTED) and the
   page asks the Airwallex sandbox to simulate the transfer to PAID.
3. **EUR 1,850.00, signed with a passkey, then paid**: sent to the CFO; the page enrols the software passkey ("Create
   your approval passkey"), then "Approve & sign EUR 1,850.00" signs the exact terms with it; the signed pay is verified
   and paid; the transfer is simulated to PAID.
4. **The one-cent change**: the page's tamper test sends 1,850.01 with the earlier signature: refused.
5. **The proof**: "Download the proof (JSON)" on the result screen, then that file picked on
   https://kit11.max-31b.workers.dev/verify (WebKit's file input); the paid proof (from the pay answer) pasted there
   too. Both also checked with the repository's verifier (`src/proof/bundle.ts`).
6. **EUR 480.00, held**: in a second tab (a test company of its own), the sample "Inside the limit — but cash says
   wait": read and checked by the agents, held by code's cash check, no payout.

## When, and where from

| | |
|---|---|
| Walks | 2: 09:12:45 to 09:14:11 and 09:14:20 to 09:15:47 UTC, 19 Nov 2026 (95 s between starts) |
| Site | https://kit11.max-31b.workers.dev as deployed that morning; the /try page served had SHA-256 `9f9d7350b5579350…` (nonces taken out) in both walks |
| Money | Test money only: the /try simulated bank; payouts to the Airwallex sandbox (transfers simulated to PAID by the sandbox) |
| Browser | WebKit 26.6, headless, from Playwright 1.63.0 (`/opt/pw-browsers/webkit-2359`); Node 22.22.0; a cloud sandbox, Linux, outbound HTTPS through its proxy |
| Passkey | The repository's software passkey (ES256, in the page; TEST ONLY), see above |
| Viewports | Walk 1: 1440 × 900, light. Walk 2: 390 × 844, dark, mobile, touch, deviceScaleFactor 3 |
| Repository | main at `5025b4c6` |

## Per walk

All times UTC. Steps in seconds, measured on this machine's clock around the clicks: Start (the launch click to the
samples), Auto-pay (the click to the 120.00's pay answer), Sign (the sign click to the approve answer), Pay (the signed
pay request's own time), Paid (the sign click to "Now try to change it" on screen), Refusal (the click to the refusal
on screen), Hold (the click to the cash panel).

| Walk | Viewport | Started | Result | Claude | Airwallex sandbox transfers | approval_sha256 | Proof on /verify (downloaded / paid) | Start | Auto-pay | Sign | Pay | Paid | Refusal | Hold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1440 light | 09:12:45 | all ok (21 of 21 steps) | 15 entries, 23 requests (16 with a request id), USD 0.005757; 0 fallbacks | EUR 120.00 `b922d598-ddd5-4ffb-bb96-3f37f63762a3`: SCHEDULED 09:13:16.754 → PAID 09:13:20.168<br>EUR 1,850.00 `4e19b64a-a99e-4391-8a6f-cdbbc60c443e`: SCHEDULED 09:13:43.656 → PAID 09:13:46.863 | `b6b8c61ef8e0d0406a4be8487e592349e574a85a704bdb1b32c30ebe907d40b6` | Proof valid · payment refused (11 of 11) / VALID (10 of 10) | 7.6 | 9.1 | 0.8 | 4.2 | 7.3 | 0.8 | 7.4 |
| 2 | 390 dark | 09:14:20 | all ok (21 of 21 steps) | 15 entries, 23 requests (16 with a request id), USD 0.004885; 0 fallbacks | EUR 120.00 `c85a09db-99bc-43bd-a6a5-3d12a7f53038`: SCHEDULED 09:14:44.394 → PAID 09:14:47.183<br>EUR 1,850.00 `f8e52a5f-fe83-4fb0-91fb-00eb6801a4f3`: SCHEDULED 09:15:12.702 → PAID 09:15:15.660 | `4e75ec3cd50ab86f236320019219042eeaf7f5068a8350933dcdec880905894f` | Proof valid · payment refused (11 of 11) / VALID (10 of 10) | 3.0 | 7.4 | 0.9 | 4.1 | 6.7 | 1.6 | 7.9 |

The same in both walks:

- **Approval.** The hash the passkey signed equals the `terms_sha256` of the 1,850.00 transfer's payout note, and the
  Airwallex request id is made from it (`b6b8c61e-f8e0-d040-…`, `4e75ec3c-d50a-b86f-…`).
- **Refusal (1,850.01).** The pay answer: outcome `refused`; the signature layer: "This signature is over other terms
  than the ones on screen. Nothing was paid."; the executor layer: "P-0002 is EXECUTED, not approved"; changed:
  `amount`; transfers before 2, after 2. On screen: "Blocked: nothing was paid." The downloaded proof is this refusal
  (outcome `refused`), and /verify says "Proof valid · payment refused, every check passes (11 of 11)".
- **Hold (EUR 480.00, invoice BTX-2026-24).** The sample answer's cash check: outcome `hold`, rule `below_floor`,
  decided by `code`: "paying EUR 500.00 (the invoice plus a fee reserve of EUR 20.00) from the EUR balance would leave
  EUR 24950.00, below the EUR 25000.00 floor" (short by EUR 50.00). On screen: "Decided by Purser's code, not the
  agent" and "No transfer was sent to Airwallex". The invoice stayed `ready`; the company's events hold no transfer.
- **Claude.** Per walk, 11 entries for the main company and 4 for the cash sample's; every entry `claude-haiku-5-5`,
  source `claude`. The page's own figure: "This run: 17 calls, $0.0045" (walk 1) and "$0.0036" (walk 2); the main
  company's events sum to USD 0.004463 and 0.003599. The page counts 17 calls where the events name 11 entries: an
  agent entry is 2 API requests, and 11 entries make 17 requests (5 reader calls + 6 agent runs × 2).
  As in the Chromium walks of the same morning, the reader's calls carry no request id in the engine's events (7 a walk).
- **The page's own time.** The result screen said "19 s from upload to paid" in both walks.

## Aggregates

| | |
|---|---|
| Walks passed, every step | **2 of 2** (1 at 1440 light, 1 at 390 dark), WebKit 26.6 |
| Airwallex sandbox transfers | **4**, all **PAID** (2 × EUR 120.00 by the agent alone, 2 × EUR 1,850.00 after the passkey); SCHEDULED → PAID 2.789 s to 3.414 s (p50 2.958 s; engine event times) |
| Approvals | 2 passkey approvals; in 2 of 2 the signed hash is the one the 1,850.00 transfer's payout note carries |
| Refusals | 2 of 2 one-cent changes refused, transfers before = after |
| Holds | 2 of 2 EUR 480.00 invoices held by code (`below_floor`), no payout |
| Proofs | 4 of 4 valid on /verify (2 downloaded: 11 of 11 checks; 2 paid, pasted: 10 of 10) and 4 of 4 VALID with the repository's verifier |
| Claude | 30 entries, 46 requests to the API, 32 distinct request ids (`req_011…`), **USD 0.010642** in all, model `claude-haiku-5-5` only, 0 fallbacks |
| /v1 calls | 160 (156 × 200, 4 × 201); no 4xx or 5xx |
| Console errors, requests to another host | 0, 0 |

Claude latency by call, from the engine's events (n, p50, max): reader classify 6, 1.294 s, 1.785 s; reader read 6,
1.953 s, 2.145 s; reader review 2, 1.786 s, 2.071 s; checker agent 6, 3.239 s, 3.634 s; coder agent 6, 3.610 s, 3.905 s;
payer agent 4, 3.610 s, 3.744 s.

## The day's /try budget

This record used **4** of the deployment's 100 Airwallex sandbox payouts of 19 Nov; the README's animation
(`docs/assets/readme/refusal.webp`, made by `scripts/readme-refusal-webp.ts` at 09:18 UTC in Chromium with a CDP virtual
authenticator: one test company, the EUR 1,850.00 signed, paid and then changed by a cent) used **1** more. 5 in all,
in 3 visits, each at least 90 s after the one before.

## Left out of the /proof band

The raw files in [`2026-11-19-webkit-try/`](2026-11-19-webkit-try/) (`run-<n>.json`, both proofs per walk,
`summary.json`) hold /try test companies' Claude request ids, refusals and sandbox transfers. They are counted here and
not in the site's band of figures: `NOT_IN_BAND` in [`src/redesign/scale.ts`](../../src/redesign/scale.ts) skips the
folder, and `src/cli/verifyAll.ts` recounts the band with the same exclusion, so the deployed pages and the repository
agree. `test/quality-proof.test.ts` checks that the folder holds no session or credential, that the summary
is computed from the walks, and that none of its request ids is counted.

## What this does not show

- Not Safari itself: WebKit as Playwright builds it, on Linux, headless. Safari on macOS and iOS adds its own WebAuthn
  user interface and platform authenticator, which a test passkey stands in for here.
- Not a person's Face ID or Touch ID: the software passkey has no biometric. The 13 Nov run with the owner's own
  iPhone is that (`docs/runs/2026-11-13-airwallex-faceid.md`).
- 2 walks, 1 per profile: enough to say the flow works in WebKit at both sizes, not to give WebKit timings any weight.

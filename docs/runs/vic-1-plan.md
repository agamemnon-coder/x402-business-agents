# vic-1: the Airi rail run, plan and runbook

**Status: run once live as vic-1b (7 November); the next run goes in a fresh world (vic-1c), only on Max's go.**
In vic-1b, A was refused at the API confirm and B's tap link never reached Max (see below). Both are fixed on branch
`airi-camelcase`, which has the hosted-page checkout and the conductor's tap watch. The dry run
(`npm run airi:vic-1 -- --dry`, 0 network) only shows the code path. It is never the run's evidence.

Before vic-1b: to prepare it, no airi-cli command that talks to Airi was run (only `version` and `--help`), and no
Airwallex call was made. The coordinator made two Airwallex calls himself, with Max's ok (7 Nov, 2 calls): login, then
`POST /pa/payment_intents/create`. They answered 201 and REQUIRES_PAYMENT_METHOD, so our sandbox takes PaymentIntents.
Max approves the call budget below before anything runs live.

**7 November, vic-1b (live), what it taught:**
- **The API confirm is not open to our sandbox.** Purchase A ran alone, Max tapped in Airi, and Airi issued a
  single-use credential (`token_type` DPAN; the file was read fine). The confirm (`POST
  /pa/payment_intents/{id}/confirm` with the card's fields) was refused with `validation_error`. A probe with
  Airwallex's own test card gave the reason: "This account is not enabled for native API access". Our sandbox may
  create PaymentIntents, but may not confirm them with raw card data over the API.
- **So the checkout is now the Hosted Payment Page** (`src/airi/hostedCheckout.ts`, the default; `AIRI_CHECKOUT=api`
  keeps the old confirm). The PaymentIntent is created server-side as before. Then headless Chromium loads Airwallex.js
  and calls `redirectToCheckout` (env `sandbox`, the intent's id and `client_secret`), as Airwallex's HPP guide and
  JS reference describe. The agent types the card from Airi's credential into Airwallex's own page, like a shopper,
  and presses Pay. One `GET /pa/payment_intents/{id}` then reads the real outcome. Airi's credential is meant to be
  used this way. The card is typed only on `https://checkout.sandbox.airwallex.com`. No screenshot, trace or video is
  taken, and the browser is closed in `finally`. 3DS that does not finish by itself is a decline, `THREE_DS_REQUIRED`
  (frictionless 3DS completes on the page; a challenge is the cardholder's to answer, not the agent's).
- **The hosted page can be driven headless** (probe, 7 Nov, 1 PaymentIntent of the 2 allowed, Airwallex's test
  card 4035501000000008, not an Airi credential). The page loaded on `checkout.sandbox.airwallex.com` with the card
  fields in the top document (`autocomplete` cc-number, cc-exp, cc-csc, cc-name; a Pay button). After Pay the page
  said "Payment completed", and the GET answered `SUCCEEDED` (attempt `CAPTURE_REQUESTED`, 1.00 EUR). The page embeds
  reCAPTCHA Enterprise and a slider-captcha frame; neither stopped the probe. The probe's API calls: 1 PaymentIntent
  create, 4 GETs of it, and 4 logins (one per probe process); 3 loads of its hosted page (two to read the page's
  structure, one to pay). If a captcha ever stops the page, the card is not submitted, and the GET shows no payment
  attempt: `HPP_NOT_SUBMITTED`, mandate cancelled.
- **B's tap link did not reach Max.** The runner wrote it to `airi-tap-link.json` as designed. The conductor did
  print it on its console, but as an unlabelled line without a time, and not in the run log. Nobody watching the run
  saw it come, and after 5 minutes Purser cancelled the mandate (`PURSER_NO_TAP`, correctly). Now the conductor
  prints a labelled `AIRI TAP B  hh:mm:ss UTC  P-…` line with the link the moment the runner writes the file (polled
  every 0.5 s), and then deletes the file. It writes a notice without the link to the run log (`AIRI TAP B  … the
  one-time Airi link is on the console now`) and repeats it every minute while the tap waits. It does not end its run
  until B has an outcome, or the 5-minute tap window plus 60 s has run out. A's line has the same shape (`AIRI TAP A`).

Design and sources: [docs/plans/vic-airi.md](../plans/vic-airi.md). Wording: "a single-use card credential from
Airwallex's Airi wallet". "Visa Intelligent Commerce" appears nowhere until Airwallex confirms it in writing.

## What the run must show

| | Shown by | Code |
|---|---|---|
| **a** A purchase within the CFO's limit runs without the CFO; Airi gives a single-use credential after Max's tap; the checkout answers; the result is reported to Airi | Purchase A: 12.00 EUR at the test shop | `requestAiriPurchase` (`src/airi/purchase.ts`); airi-cli 0.1.0-beta.4 (`src/airi/cli.ts`); Airwallex sandbox PaymentIntent, paid on Airwallex's Hosted Payment Page (`src/airi/hostedCheckout.ts`) |
| **b** Above the limit nothing runs until the CFO's Face ID over agent, amount, currency, merchant and items. The executor checks the approved hash before the mandate and again before the credential | Purchase B: 45.00 EUR at the test shop, run by the runner after Face ID | proposal `airi_purchase`; `executeAiriPurchase`; phone page "Airi purchase" (`src/approve/client.ts`) |
| **c** A purchase Purser refuses shows its real code and never reaches Airi | Purchase C: 5.00 EUR at `https://shop.example/`, not allowed | `PURSER_MERCHANT_NOT_ALLOWED`; the call counter shows 0 Airi calls for C |
| **d** Safe references only | The record and the run log: action ids, order hashes, mandate ids, PaymentIntent ids, codes | `assertNoSecrets` refuses any Airi link or card-like number; the one-time link goes to the console only |

**Either outcome is recorded as it is.** Nobody knows yet whether Airwallex's hosted page accepts Airi's credential (a
tokenized PAN from a test card). If it declines, the run records `mandate result DECLINED` with Airwallex's own code,
and check a still passes on "the checkout answered". If it accepts, the PaymentIntent is SUCCEEDED (test money).

**What the sandbox cannot show:** the test card yields "a fake credential" (airi-cli README), and the merchant is our
own sandbox account, not a real shop.

## Who does what

- **Max: 4 moments, about 30 minutes.**
  0. Enrol his passkey for this world on the relay (as for awx-1), then say "Bevestig passkey <fingerprint>".
  1. Purchase A: open the one-time Airi link that Claude Code passes on, and confirm with his passkey in Airi (within
     5 minutes).
  2. Purchase B: Face ID on the phone approval page ("Airi purchase", EUR 45.00, 30 minutes).
  3. Purchase B: the second one-time Airi link, his passkey in Airi (within 5 minutes).
- **Before the run, if needed: log in to Airi again.** The session lasts about an hour, and each command renews it
  when it is near its end. If the preflight says "Max must log in again", the coordinator runs `airi-cli auth login`
  and `auth poll` and Max approves on app.airi.com.
- **Claude Code** runs every command and passes the one-time links to Max in chat (never into a file, a commit or a
  log). It stops on any abort criterion and approves nothing.

## Environment (names only)

```bash
export KIT11_DB=data/vic-1.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/vic-1
export KIT11_AIRI_RAIL=on KIT11_CARD_POLL_MS=off
export AIRI_CHECKOUT=hosted             # the default; "api" is the REST confirm our sandbox refuses
unset METAL_RPC_URL METAL_ENDPOINT_SECRET T0_API_KEY T0_ENABLED KIT11_AUTONOMY HUB_PUSH_ENABLED HUB_DECISIONS_ENABLED
export AIRWALLEX_CALL_BUDGET=14 AIRWALLEX_CALL_LOG=$KIT11_KEYS_DIR/airwallex-calls.jsonl
export VIC1_AIRI_CALL_BUDGET=8          # the conductor's airi-cli calls (the runner's 3 for B come on top)
# optional: AIRI_PAYMENT_METHOD_ID=<the test card's id from the preflight>  (not a secret)
```

The runner (`npm run relay -- --enrol`) runs with the same variables, so it executes B with the rail on. Its log
line for B's tap only names the file the link sits in: `airi-tap-link.json`, mode 0600, in the keys folder. The
conductor prints the link from that file on its own console and deletes the file.

`airi-cli` is `/opt/node22/bin/airi-cli`. The client runs the Go binary behind it
(`…/@airwallex/airi-cli/vendor/airi-cli`) only if its SHA-256 is `c1bc11e4…` (linux-x64, as installed on 7 Nov) and
`version` says 0.1.0-beta.4. Every call carries `-o json --no-telemetry`, and the child environment holds only `PATH`,
`HOME`, `TZ=UTC`, `LANG` and `AIRI_TELEMETRY_DISABLED=1`.

## Steps

| # | What | Command (Claude Code) | Max | Calls |
|---|---|---|---|---|
| 0 | Fresh world; dry run once more | `mkdir -m 700 $KIT11_KEYS_DIR`; `npm run airi:vic-1 -- --dry` | — | 0 |
| 1 | Preflight: CLI pinned, session alive, an agent-enabled card | `npm run airi:vic-1 -- preflight` | (log in again only if told) | Airi 2 |
| 2 | Runner with Max's enrolment | `npm run relay -- --enrol` (own process group) | Face ID (enrol), then "Bevestig passkey &lt;fp&gt;" | Airwallex: the runner's login (1) |
| 3 | The run | `VIC1_GO=yes npm run airi:vic-1 -- live` | tap A in Airi; Face ID B; tap B in Airi | see the budget |
| 4 | Only after a crash or an unknown outcome | `npm run airi:vic-1 -- recover` | — | ≤ 1 Airwallex + ≤ 2 Airi per open purchase |
| 5 | The record | `data/vic-1-record.json` and `data/vic-1.log` (both 0600, outside git); then `docs/runs/2026-11-0x-vic-1.md` from them | — | 0 |
| 6 | Stop | `npm run stop -- vic-1` | — | 0 |

The live run calls the preflight again (2 Airi calls), writes this world's first Airi policy (20.00 alone, 3 a day,
the test shop allowed; audited as `airi.policy_initial`), and then runs A, B and C.

## Abort criteria (stop, record, tell Max)

- The preflight says "Max must log in again", or finds no agent-enabled card.
- The binary's SHA-256 or version is not the pinned one.
- Any `AIRI_OUTPUT_UNRECOGNISED`: an answer in a shape the client does not know. The client does not repeat it; Claude
  Code reports which fields differed.
- `CREDENTIAL_UNREADABLE` on A. The credential file's field names are not documented; the error names the file's keys
  (never values), the mandate is cancelled, and nothing is charged. Fix the field mapping, then rerun in a fresh world
  (vic-1b) only on Max's go.
- An outcome stays `unconfirmed`: nothing is retried; `recover` looks it up once.
- Purchase C reaches Airi (more than 0 Airi calls): the policy did not hold.
- A call budget is reached: the guards refuse the next call themselves.
- Max rejects B, or B's approval expires (30 minutes).
- A tap does not come within 5 minutes: Purser cancels that mandate (`PURSER_NO_TAP`). Retry only on Max's go.
- The hosted page cannot be used: `HPP_UNAVAILABLE`, `HPP_FIELDS_NOT_FOUND`, `HPP_WRONG_ORIGIN` or `HPP_NOT_SUBMITTED`
  (e.g. a captcha). Nothing was charged; the mandate is cancelled. Claude Code reports the code; no retry without
  Max's go.

## Call budget

**airi-cli: 10 commands expected, at most 12.** Each command makes one or more HTTPS requests inside the CLI.
`get-credential` polls Airi every 2 s while it waits for the tap, so one command means about 5 to 150 requests.
`version` makes no network call.

| Step | Process | Command | Expected | At most | Why |
|---|---|---|---|---|---|
| 1 | preflight | `auth whoami` | 1 | 1 | Max's session, and when it ends |
| 1 | preflight | `payment-methods list` | 1 | 1 | the agent-enabled card (id and type kept; of the card only brand and last four) |
| 3 | conductor | `auth whoami`, `payment-methods list` | 2 | 2 | the run's own preflight |
| A | conductor | `mandate create` | 1 | 1 | merchant, total, currency, items, from the terms |
| A | conductor | `mandate get-credential --file` | 1 | 1 | waits up to 300 s for Max's tap; the credential goes to a 0600 file in a fresh 0700 directory |
| A | conductor | `mandate result` or `mandate cancel` | 1 | 2 | the checkout's outcome; cancel if Purser stops before the checkout |
| B | runner | `mandate create`, `get-credential`, `result`/`cancel` | 3 | 4 | as A, after the CFO's Face ID |
| C | — | — | 0 | 0 | refused by Purser before any call |

**Airwallex sandbox API: 8 calls expected, at most 14** (`AIRWALLEX_CALL_BUDGET=14`, one log for both processes).
With the hosted page the confirm call is gone, and each purchase adds 1 GET of its PaymentIntent, so the total does
not change. The browser's own requests to Airwallex's hosted page (`checkout.sandbox.airwallex.com`,
`static.airwallex.com` and the page's assets) are page loads, not API calls. They are not in the call log: one page
load per purchase.

| Step | Process | Endpoint | Expected | At most | Why |
|---|---|---|---|---|---|
| 2 | runner | `POST /authentication/login` | 1 | 3 | the runner's token (renewed every 25 minutes) |
| 2 | runner | reconciliation reads (an empty world) | 0 | 2 | the runner's light reconciliation, a minute after start |
| 3 | conductor | `POST /authentication/login` | 1 | 1 | the conductor's token |
| A | conductor | `POST /pa/payment_intents/create` | 1 | 1 | the order, without the card |
| A | conductor | hosted page (browser) | 1 load | 1 load | the card from Airi's credential, typed into Airwallex's page, in memory only; not an API call |
| A | conductor | `GET /pa/payment_intents/{id}` | 1 | 1 | the real outcome after the hosted page |
| B | runner | `POST /pa/payment_intents/create` | 1 | 1 | as A |
| B | runner | hosted page (browser) | 1 load | 1 load | as A |
| B | runner | `GET /pa/payment_intents/{id}` | 1 | 1 | as A |
| 4 | recover | `GET /pa/payment_intents/{id}` | 0 | 2 | only for an unknown outcome |
| 4 | recover | `POST /authentication/login` | 0 | 1 | only if recover runs |
| C | — | — | 0 | 0 | — |

Max's taps: 1 enrolment, 2 Airi passkeys, 1 Face ID.

## How a failure is recorded

The audit log holds one row per step:
- `airi.purchase_requested`;
- `airi.checkout_prepared`;
- `airi.mandate_created`;
- `airi.waiting_for_tap`;
- `airi.credential_received` (the receipt only);
- `airi.checkout_result` or `airi.checkout_unconfirmed`;
- `airi.result_reported`;
- `airi.mandate_cancelled`;
- `airi.purchase_refused` (with `by`: purser, airi or checkout, and the code as given).

`airi_purchases` holds each purchase's hold and state; `money_steps` holds each outside call, STARTED and DONE. A
failed attempt stays in the record with its cause. A second attempt goes in a fresh world (vic-1b), never as a
rewrite.

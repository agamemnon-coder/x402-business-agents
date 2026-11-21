# /try with 10 to 20 judges at once: every limit, its margin, and 10 visitors at once on the live site (21 November 2026)

Judging starts Monday 23 November, and several judges may use `/try` and `/proof` at the same time. This record reads
every limit a judge can reach, in the code and in the deployed configuration, works out its margin for 20 judges in one
hour (and for the harder case of 20 judges starting in the same minute), and then puts **10 visitors on the public /try
at the same moment**. **Test money only**: each visitor's company is a /try test company on the simulated bank, its
payouts go to the **Airwallex sandbox** (PAID by the sandbox's own simulation), and Claude is the deployed /try's own,
inside its own caps.

**Result.** For 20 judges in one hour every limit has room, most of them more than 10 times over (the table below).
At once, 10 visitors on the live site got no 429 and no 5xx, Claude read every invoice and was never refused a
reservation, and every route answered within its one-at-a-time times but one: **the Airwallex sandbox payout, which
was made one after another for all visitors, so 6 of the 10 payouts asked in the same 6 seconds passed the engine's 8 s
wait** and were paid on the simulated bank alone, labelled on the page. That was our bug, and it is fixed in code
(below, not deployed). The rest of what 20 judges need is in the owner's switches, which this record could not read:
they are listed at the end, and `npm run smoke:judge` prints them with the admin token.

## Where the figures come from

| | |
|---|---|
| Code | This repository at `ca0b9bf4f`. The live purser-try and kit11 Workers were last changed on 20 Nov at 18:04 and 18:05 UTC (the account's script list); every limit below is named by its file and constant. |
| Cloudflare | The account's Workers analytics (GraphQL, read only), the 24 hours to 20 Nov 18:50 UTC: requests, errors, CPU and wall time per Worker and per Durable Object. Nothing was changed or deployed. |
| Switches | The owner's caps on purser-try (`try_switches`, set with `POST /v1/try/admin`) cannot be read without the platform admin token, which this run did not have. Their ceilings in code are below; `npm run smoke:judge` prints the live values when `PURSER_ADMIN_TOKEN` is set. One live value is bounded by a record: 37 public starts from one address in one hour were all answered 201 on 19 Nov (docs/runs/2026-11-19-mega-run.md), so `starts_per_address_hour` is at least 37. |
| Anthropic | One Messages call with `max_tokens: 1` to `claude-haiku-5-5` with the kit11 Worker's key (20 Nov 18:50 UTC), for the rate-limit headers of its answer only. Whether purser-try's engine key belongs to the same organization was not checked. |
| Airwallex | The sandbox account's balances, read once (`GET /api/v1/balances/current`, read only), and its answer time from this machine (8 reads). |
| Per walk | 50 recorded walks of the mega run (docs/runs/2026-11-19-mega-run/), each a judge's whole journey with two test companies. |

## What one judge's walk uses

From the mega run's 50 walks: about **80 calls to `/v1`** (two test companies: the main one and the cash sample's),
**15 Claude entries and 23 API requests** to `claude-haiku-5-5`, **USD 0.0049** of Claude at list price (p50; max
0.0057), **2 Airwallex sandbox payouts** and **1 sandbox FX quote**. Its Claude actions (a sample read with the
checker and the coder, a pay with the payer, and the payer early in the background) hold a reservation for **40 s in
all** (p50; p95 45 s, max 49 s), the time of `POST /v1/engine/samples/{name}` and `POST /v1/engine/invoices/{id}/pay`
added up with the early payer's runs. A scripted walk takes 67 s (p50); a person reading the screens takes several
minutes.

So 20 judges walking once in an hour use about 1,600 `/v1` calls, 460 Claude API requests, USD 0.10 of Claude and 40
sandbox payouts. 20 judges who all press Launch in the same minute and walk at the script's speed hold
20 x 40 s / 67 s = **about 12 Claude actions at once** on average; people at their own speed about 3.

## Every limit a judge can reach

| Limit | Where | Value | For 20 judges in an hour | Margin |
|---|---|---|---|---|
| Worker CPU time per request | Cloudflare (the account is on a paid plan: purser-try's p90 CPU is 29.6 ms, past the free plan's 10 ms, with 0 errors) | 30 s by default | purser-try: p50 4.6 ms, p99 68 ms, max 257 ms; kit11: p99 8.0 ms, max 38.8 ms (24 h, 3,960 and 4,461 requests) | over 100 x |
| Subrequests per request | Cloudflare | 1,000 on a paid plan | purser-try made 2,924 in 24 h for 3,960 requests (0.7 a request) | over 100 x |
| Errors, 24 h | Cloudflare analytics | | purser-try 0 of 3,960 requests and 0 of 2,891 Durable Object calls; kit11 0 of 4,461 requests; its Durable Objects 186 `clientDisconnected` on short-lived objects, all between 03:00 and 05:00 UTC on 20 Nov, none on the /try path | |
| One company's engine reads | `cloud/src/engine/api.ts` `EVENTS_PER_SECOND` | 2 a second per company (429 `slow_down` with `retry_ms`) | per company, so judges never share it; the page polls under it | no contention |
| Session renewals | `cloud/src/try/start.ts` `SESSIONS_PER_MINUTE` | 30 a minute per company | per company | no contention |
| Pays, exports per company | `cloud/src/try/engineRoutes.ts` `PAYS_PER_COMPANY`, `EXPORTS_PER_COMPANY` | 30, 5 | a walk pays 3 times | 10 x |
| Calls per session | `cloud/src/app.ts` (the cloud's `rate.perMinute`) | 600 a minute per company session (the engine's event polls not counted) | a walk makes about 80 in all | no contention |
| Public starts per network, an hour | switch `starts_per_address_hour` (`cloud/src/try/switches.ts`) | default 5, ceiling 50; live at least 37 | judges on their own networks: 2 to 6 each. **20 judges behind one Wi-Fi: 40** (2 a scripted walk; a person staying in one tab, 1) | tight only in one room |
| Public starts per IPv6 /48, an hour | switch `starts_per_48_hour` | default 20, ceiling 200 | as above | |
| Public starts a day | switch `starts_per_day_public` | default 300, ceiling 2,000 | 40 to 120 | 2.5 x or more |
| Jury link starts | switches `starts_per_address_hour_pooled`, `starts_per_day_jury` | 60 an hour per network (ceiling 500), 100 a day (ceiling 500) | a `#j=` link (POST /v1/try/admin `{op: token, pool: jury}`) takes the judges off the public limits | |
| Claude per action, held until settled | switch `cap_action_micros` | ceiling USD 0.50 | an action costs under USD 0.002 | see below |
| Claude per company, per network a day, per pool a day, all time | switches `cap_company_micros`, `cap_addr_micros`, `cap_day_micros_public` (`_jury`, `_event`), `cap_all_micros` | ceilings USD 1, 3, 30, 100 | USD 0.10 for 20 walks; USD 0.30 for 60 | depends on the live values and the all-time spend so far |
| Claude actions in flight, all visitors | switch `max_inflight` (`cloud/src/engine/spend.ts`) | ceiling 20 | about 12 at once in the worst case, about 3 for people | 1.7 x at the ceiling |
| Claude actions at once a cap allows | `cloud/src/engine/spend.ts` `reserve()`: each action holds its whole `cap_action_micros` against every cap until it settles | (cap left) / `cap_action_micros` | about 12 at once | at `cap_action_micros` USD 0.50 and `cap_addr_micros` USD 3, only 6 at once from one network |
| Anthropic rate limits | the key's organization, `claude-haiku-5-5` | 10,000 requests, 5,000,000 input tokens and 1,000,000 output tokens a minute | 460 requests in the worst minute | over 20 x |
| Airwallex sandbox payouts a UTC day | `worker/src/awxPayout.ts` `AWX_PAYOUT_DAY` | 100 for all visitors, 2 a walk | 40 | 2.5 x for one walk each; 50 walks a day in all |
| Airwallex sandbox payouts per company, amount | `AWX_PAYOUT_PER_COMPANY`, `AWX_PAYOUT_MAX_CENTS` | 2, EUR 5,000 | 2, EUR 1,850 | |
| Payouts at once | `worker/src/awxPayout.ts` `AwxPayoutDesk.payout`: one instance, one payout at a time (a balance read, then the create); the engine waits `PAYOUT_WAIT_MS` 8 s (`cloud/src/engine/livePayout.ts`), then pays on the simulated bank alone, labelled | about 1.2 s a payout (the sandbox's balance read takes 340 to 550 ms from here) | 40 payouts an hour keep it busy 1.3 % of the time | only payouts asked within the same few seconds wait; see the run below |
| Airwallex sandbox balance | the sandbox account | EUR 9,708,613.67 available | EUR 1,970 a walk | about 4,900 walks |
| Airwallex FX quotes | `worker/src/awxFx.ts` `AWX_FX_DAY`, `AWX_FX_COMPANY_DAY` | 300 a UTC day, 6 per company | 1 a walk | 15 x |
| Airwallex gateway | `worker/wrangler.jsonc` `AWX_GATEWAY_LIMIT` | 120 calls a minute, everyone together | the /try walk makes none (its events show only the payout and FX entrypoints); `/mcp/airwallex` and Purser Cloud's Airwallex actions use it | |
| /airwallex page's live reads | `worker/src/awxRead.ts` | one answer per view serves everyone for 45 s; 40 Airwallex calls a minute, 1,500 a day | one read every 45 s whatever the number of judges | no contention |

## 10 visitors at once on the live /try (21 Nov, 00:01 UTC)

`npm run try:concurrent -- docs/runs/2026-11-21-try-concurrent <log dir> 10 0`
([`scripts/try-concurrent.ts`](../../scripts/try-concurrent.ts)): 10 copies of the repository's walk recorder,
[`scripts/try-live-record.ts`](../../scripts/try-live-record.ts), each in its own process and its own Chromium,
alternating 1440 px light and 390 px dark, all started within 446 ms of each other on the deployed site. Each did the
judge's main walk once. The raw records (`run-1.json` to `run-10.json`, the proofs of the walks that got that far) and
the figures (`concurrency.json`) are in [`2026-11-21-try-concurrent/`](2026-11-21-try-concurrent/), as written; its
file is `concurrency.json`, not `summary.json`, so this capacity check is not added up with the walks of record on
/proof. The 10 browsers ran on one machine with 4 cores (load average up to 14.4), so the times seen in the page are
slower than a judge's own; the route times are the browser's own measure of each answer.

**Result: no 429, no 5xx, Claude never refused; 6 of the 10 walks lost their Airwallex sandbox payout to a timeout.**

| | |
|---|---|
| Walks | 10 started, 2 minutes 21 s from the first start to the last finish. **4 passed every step**; **6 stopped** after the EUR 120.00 payment, where the recorder waits for the sandbox transfer's "move to PAID" (below). |
| HTTP | 436 calls to `/v1`: 422 answered 200 and 14 answered 201 (the starts). **0 answered 429, 0 a 5xx.** |
| Claude | 28 invoice reads, **all 28 by Claude** (`claude-haiku-5-5`), none by the parser; 32 agent runs, all 32 done; **0 actions refused a reservation** (`claude.capped`: none). USD 0.0213 in all at list price. |
| Airwallex | 14 payouts asked: **8 made at the sandbox and PAID** by its simulation; **6 not sent in time** (`timeout`): the 10 EUR 120.00 payouts were asked within 6 s (answers 00:01:32.3 to 00:01:39.0), and the payout desk made them one after another. The 4 EUR 1,850.00 payouts later in the walks, asked seconds apart, were all made and PAID. |
| What a judge saw | The page went on: "Simulated bank only: not sent to Airwallex. Airwallex took too long." The payment was made on the simulated bank, labelled, and the walk could continue; only that payment's sandbox transfer was missing. |

Route times, 10 at once against the 33 walks of 20 Nov one at a time (the mega run):

| Route | 10 at once: n, p50, p95 | One at a time: p50, p95 |
|---|---|---|
| `POST /v1/try/start` | 14, 1.73 s, 3.33 s | 1.41 s, 1.77 s |
| `POST /v1/engine/samples/{name}` (Claude reads, checker, coder) | 18, 5.67 s, 8.27 s | 6.13 s, 8.18 s |
| `POST /v1/engine/invoices/{id}/pay` (payer, payout) | 14, **10.94 s, 14.29 s** | 6.50 s, 8.13 s |
| `POST /v1/engine/proposals/{id}/pay` (signed) | 8, 0.64 s, 3.90 s | 0.91 s, 3.83 s |
| `POST /v1/engine/proposals/{id}/payout/simulate` | 8, 2.55 s, 2.84 s | 2.71 s, 3.64 s |
| `GET /v1/engine/events` | 160, 0.40 s, 0.79 s | 0.34 s, 0.61 s |

Claude, the engine and the network held: every route but the one with the payout answered within its one-at-a-time
times. The payout did not, and it was our bug.

### The bug, and the fix

kit11's payout desk (`worker/src/awxPayout.ts`, one Durable Object for every visitor) made each payout inside one
queue: the counts, the sandbox balance read (340 to 550 ms), the row and the create, one payout after the other, about
1.2 s each. The queue was added on 16 Nov (security review) so that payouts asked at the same moment could not all pass
the caps before any wrote its row. purser-try waits 8 s for the answer (`PAYOUT_WAIT_MS`) and then pays on the
simulated bank alone. 10 payouts in 6 s queued for up to about 12 s: the last 6 passed the 8 s.

The fix (commit "/try payouts: decide one at a time, call Airwallex side by side") keeps the queue for the decision
only: the checks, the company and day counts, the balance and the row are still decided one ask at a time, each row
written before the next ask is looked at. The create, and a stored transfer's read-back, run after the queue, side by
side. The same terms asked again while their create runs get that create's answer (one transfer, never two). One balance
read serves the decisions of 30 s (`BALANCE_READ_MS`), each payout taken off it, so no payout is ever more than the
balance as read less every payout since (and Airwallex refuses what it cannot cover). **No cap changed**:
`AWX_PAYOUT_DAY` 100, `AWX_PAYOUT_PER_COMPANY` 2, `AWX_PAYOUT_MAX_CENTS` EUR 5,000, EUR only, the switch and the key
as before. `test/try-awx-payout.test.ts` has 4 new tests (all 4 fail on the old desk): 10 companies at once answer in
about one create's time, the day cap and the balance still hold under concurrent asks, the same terms at once make one
transfer, and the balance is read again after 30 s or a failed read. **Not deployed**: until kit11 is deployed with it,
payouts asked in the same few seconds still queue.

## The judge's smoke test, run once (21 Nov, 01:17 UTC)

`npm run smoke:judge` ([`scripts/smoke-judge.ts`](../../scripts/smoke-judge.ts)), for Sunday evening: the 13 key pages
answered 200, `/health` raised no alert, `POST /mcp/airwallex` and `POST /mcp` on purser-try answered 401 with no
token; one walk at 1440 px in Chromium and one as an iPhone 15 in WebKit each passed every step, with 7 of 7 invoice
reads by Claude, 8 of 8 agent runs done, 2 of 2 sandbox transfers PAID, the refusal and both proofs valid; `/proof`
in Chromium at 1440 px and in WebKit as an iPhone drew the evidence wall with no console error and no sideways scroll.
**PASS: all 32 checks passed in 139 s.** It ran without the admin token, so it printed the payouts a day from the code
and not the Claude caps. Its walks are not kept (a temp folder, deleted).

## What to set before Monday, and what was changed

**Changed in code (to deploy with kit11):** the payout desk above. Nothing else: no ceiling, cap or guard was raised.
The CFO's limit, the passkey, the payout caps (`AWX_PAYOUT_DAY`, `AWX_PAYOUT_PER_COMPANY`, `AWX_PAYOUT_MAX_CENTS`) and
the Claude ceilings are as they were.

**The owner's switches to confirm on Sunday** (`POST /v1/try/admin`; `npm run smoke:judge` with `PURSER_ADMIN_TOKEN`
prints them and warns on each):

| Switch | For 20 judges | Why |
|---|---|---|
| `max_inflight` | 20 (its ceiling) | about 12 Claude actions at once if 20 judges press Launch in the same minute; past it, an action is read by Purser's code instead, labelled |
| `cap_action_micros` | USD 0.05 to 0.25 | each action holds this whole amount against every cap until it settles; at USD 0.50 and `cap_addr_micros` USD 3, a network can run only 6 actions at once; an action costs under USD 0.002 |
| `cap_addr_micros` | USD 3 (its ceiling) if judges may share one network | a day's Claude for one network: about 600 walks at USD 0.005 |
| `cap_day_micros_public` (and `_jury` if a jury link is given) | USD 5 or more | 20 judges x 3 walks is USD 0.30; the room matters only for the reservations held at once |
| `cap_all_micros` | USD 100 (its ceiling); check what is left | the all-time spend so far was not readable here; at USD 0.005 a walk, USD 1 left is 200 walks |
| `starts_per_address_hour` | 50 (its ceiling) | at least 37 now; 20 judges on one network make up to 40 starts in their first walk |
| a jury link (`{op: token, pool: jury}`, opened as `/try#j=<token>`) | if judges sit in one room | its own per-network limit (60, ceiling 500) and its own day of Claude |

**Not changed, and why:**

- `AWX_PAYOUT_DAY` (100 sandbox payouts a UTC day, 2 a walk: 50 walks a day for every visitor together) is a payout
  cap, so it stays as the owner set it. It is enough for 20 judges who walk once or twice each in a day (40 to 80
  payouts); a day of 20 judges walking 3 times each (120) would pass it, and the walks after the 100th would pay on the
  simulated bank alone, labelled. The sandbox balance (EUR 9.7 million) would allow about 4,900 walks; raising it to
  200 or 300 for judging week is the owner's call. This night's checks used 34 of Saturday's 100.
- `starts_per_address_hour`'s ceiling (50), `max_inflight`'s (20) and the Claude ceilings: enough for 20 judges in an
  hour at their ceilings; the live values are the owner's to set within them.
- The engine's wait for a payout (`PAYOUT_WAIT_MS`, 8 s): with the desk fixed, a payout takes about one balance read
  and one create (about 1.2 s), so 8 s is enough; a longer wait would only hold a judge's screen longer when the
  sandbox is slow.

**Also seen in these checks, not a capacity limit:** in the phone series of the same night
(docs/runs/2026-11-21-phone-try.md), one walk of 9 (Chromium) had its EUR 120.00 invoice sent to the CFO instead of
paid by the agent alone; code's own checks said pay, so one of the two agents did not. Purser leaves a payment to the
CFO whenever the agents and code do not all say pay, so a judge sees the passkey screen there instead of the agent
paying. The recorder now reads the engine's events when a walk stops, so the next one will say which agent and why.

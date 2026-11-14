# Stage mode: the room signs live (finals, 19 Nov)

The jury and the audience take part on their own phones while the presenter's screen shows what the room does. Test
money only, on a simulated bank; nothing real is paid, and the screen says so at all times.

- **The presenter's screen:** `https://kit11.max-31b.workers.dev/try/stage#e=<event token>` (built for a projector at
  1920×1080; it also reads on a phone). A huge QR code to `/try`, the headline "Take out your phone. Sign a real
  invoice with your own Face ID.", five live counts and a ticker of anonymous steps.
- **The phones:** the QR code opens `/try?pool=event#e=<event token>`: the visitor's own test company in the **event
  pool**, on Purser's real engine (cloud/, the purser-try Worker). Claude reads a sample invoice, Purser's code checks
  it, the visitor signs with their own passkey, it is paid on the simulated bank and booked. Change one cent and the
  signature is refused.
- **The counts:** `GET /v1/try/stage/stats?since=…`, every 2 seconds. Counts only, for the event pool only, from the
  engine's own answers: test companies started · invoices read by Claude · signed with a passkey · paid on the
  simulated bank · changed after signing: refused. The ticker says "Someone paid EUR 1,850.00 in 1 min 12 s, signed
  with their passkey" or "Someone changed the amount after signing: refused". No names, no company, no ids, no
  addresses (code: `cloud/src/try/stage.ts`; tests: `test/try-stage.test.ts`).

## Which switches, and when

Stage mode adds **no switch and changes no cap or ceiling.** It reads the switches of `cloud/src/try/switches.ts`.
The owner sets them on the day with the admin route on purser-try (the platform admin's token; the site does not pass
`/v1/try/admin` on):

```sh
ADMIN="Authorization: Bearer $PURSER_TRY_ADMIN_TOKEN"
TRY=https://purser-try.max-31b.workers.dev/v1/try/admin
op() { curl -sS "$TRY" -H "$ADMIN" -H 'content-type: application/json' -d "$1"; echo; }
```

| When | What | Why |
| --- | --- | --- |
| The day before | `op '{"op":"token","pool":"event","until":"2026-11-19T23:00:00Z"}'` | The event token, **shown once**: keep it for the presenter's link. Its hash only is stored. At most 8 live tokens. |
| The morning of 19 Nov | `op '{"op":"set","key":"starts","value":"on"}'` | Without it nobody can start, and the wall shows 0 ("The event pool is closed"). |
| The morning of 19 Nov | `claude` on and the caps the owner chooses: `cap_all_micros`, `cap_day_micros_event`, `cap_company_micros`, `cap_addr_micros`, `cap_action_micros`, `max_inflight` | So Claude reads the invoices. The owner sets the event pool's budget (`cap_day_micros_event`, ceiling USD 30 a day). Without them Purser's code reads, labelled, and "invoices read by Claude" stays 0. |
| Optional | `agents` on | The agents' decisions on the phones (inside the same caps). |
| Leave as is | `starts_per_day_event` (300 when unset, ceiling 2,000) | Starts per day for the event pool; event starts skip the per-address limit, so one venue Wi-Fi does not lock the room out. |
| Choose | `bot_check` | The proof of work before a start takes a moment on a phone; the owner decides for the room. |
| After the finals | `op '{"op":"set","key":"tokens","value":"[]"}'` or let the token run out | Closes the event pool; the wall goes back to 0. |

Check with `op '{"op":"get"}'`: `starts` is `on` and `tokens` lists one `event` token with a future `until`.

The wall answers zeros (`live: false`) whenever the event pool is off: `starts` off, or no live event token. A public
visitor's steps are never counted on the wall.

## The day, step by step

1. **T-60 min.** Set the switches above. On the presenter's laptop open
   `https://kit11.max-31b.workers.dev/try/stage#e=<event token>`. The page takes the token off the address bar at once
   and keeps it in the tab only. Under the QR code it says "Event pool · until …". If it says "This link's event token
   is not live", make a new token (step 1 of the table) and open the link again.
2. **T-30 min.** Scan the QR code with your own phone and play once: start, sign, change one cent, pay. Watch the wall
   count it and the ticker say it. Then press **Count from now** so the room starts at 0.
3. **T-5 min.** Press **Full screen**. Leave the page open; it reads the counts every 2 seconds.
4. **On stage.** Say the 3 lines (below), give the room 2 to 3 minutes, talk over the ticker.
5. **After.** Press **Recorded run** if there is time left and someone asks "what did they just do?".

## The 3 lines

1. "Take out your phone and scan this: you get your own test company on Purser's real engine. Test money only."
2. "Claude reads the invoice, Purser's code checks it, and you sign the exact terms with your own Face ID."
3. "Then try to cheat: change one cent after signing. Watch the wall: the signature is refused."

## Plan B

- **The counts fail** (the stats route errors or times out): the wall says **"Live counts paused: the QR code still
  works"** and tries again, slower, until it answers. The QR code is drawn into the page by the server, so the phones
  still reach `/try`.
- **The venue Wi-Fi fails** (the laptop is offline): press **Recorded run** (or the key `R`). It plays a real run of
  `/try` recorded on 13 Nov 2026 (`docs/video/recording-try-v10.json`) from data inside the page, at the pace it was
  recorded (64 s): start, Claude reads, checked, approve, signed and paid, changed: refused. It says on screen that it
  is recorded, with a virtual test passkey, on test money. `Escape` goes back to the live wall.
- **The laptop is offline but phones have 4G/5G:** the QR code still works on the phones; the wall shows "Live counts
  paused". Say "the counts are on the server; the room's phones are not".
- **Everything fails:** `npm run judge` on the laptop (docs/submission/demo-day.md, Plan B).

## The 60-second stage script

> **(0:00)** "Everyone take out your phone. Scan the code on the screen."
>
> **(0:08)** "You now have your own company on Purser, the engine we run in production. Test money, a simulated bank,
> deleted after a day."
>
> **(0:15)** "Tap a sample invoice. Claude reads it. Purser's code checks it: the supplier, the bank account, the
> amount, a copy of an earlier invoice."
>
> **(0:25)** *(point at the counts)* "There: invoices read by Claude, going up."
>
> **(0:30)** "Now approve it. Your phone asks for your Face ID. You are signing the exact terms, the amount and the
> account, not a button."
>
> **(0:40)** *(point at the ticker)* "Someone just paid EUR 1,850 in about a minute, signed with their own passkey."
>
> **(0:45)** "Now cheat. Change the amount by one cent and press pay."
>
> **(0:52)** *(point at "changed after signing: refused")* "Refused. The signature is over other terms. Nothing moved."
>
> **(0:57)** "That is what an AI agent paying your suppliers needs: limits the CFO signs, enforced by the rails."

## What the page does and does not do

- It sets nothing on the server. Its buttons change this screen only: **Recorded run**, **Count from now** (the counts
  start at that moment; kept in this browser), **Full screen**. The switches stay with `POST /v1/try/admin`.
- No presenter key in a URL: the admin token never goes into a link. The event token travels only in the link's
  fragment (`#e=`), which the browser never sends to a server; the page sends it once in a POST body to draw the QR
  code (`POST /v1/try/stage/qr`), which checks its SHA-256 against the stored tokens and keeps nothing.
- The counts are about 2 seconds old (cached per Worker instance), `since` is read to the minute and at most 24 hours
  back, and each address may read them 120 times a minute (counted in memory under a hash that changes every minute).
- Calm motion only, and none with "reduce motion" on: a count that changes flashes once, a new ticker line slides in.

## Routes and files

| Path | Who | What |
| --- | --- | --- |
| `GET /try/stage` | anyone | The presenter's page (purser-try only; the site passes it on). |
| `GET /v1/try/stage/stats?since=` | anyone | `{ live, test_money, since, counted_at, counts: { started, read_by_claude, signed, paid, refused }, ticker: [{ at, kind, text }] }`. |
| `POST /v1/try/stage/qr` | anyone (this site's own page) | `{ token }` → `{ url_shown, size, d, until }`, the QR code of `/try?pool=event#e=<token>`; 400 `not_event_token`. |

Code: `cloud/src/try/stage.ts` (the rows and the counts), `cloud/src/try/stageRoutes.ts` (the two routes),
`cloud/src/try/stagePage.ts` (the page), `cloud/migrations/0005_try_stage.sql` (the table, also made on first use).
The hooks: the sample, compose and scenario routes note a reading by Claude, the approve route notes an accepted
passkey signature (through the engine block's `approved` hook, `cloud/src/app.ts`), the pay route notes a payment or
a refused change; each only for a company in the event pool, and none can fail a visitor's request.

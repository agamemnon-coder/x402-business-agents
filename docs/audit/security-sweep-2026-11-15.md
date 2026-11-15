# Security and bug sweep, 15 November 2026

This sweep covers main at `c431a468`, before the hand-in. Fixes are on branch `security-1115` (#360, S1–S3) and `security-2-1115` (sweep 2: N1, and the decisions on N2 and N3).

- **Hosts probed live:** purser-try.max-31b.workers.dev and kit11.max-31b.workers.dev. Probing was gentle: about 30 requests in total, and 4 /try test companies.
- **Money and keys:** test money only. No card, account or key was used. No secret appears in code, logs or here.

## Severity first: what was found

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | Medium | A payout could leave the daily Airwallex caps uncounted. | Fixed |
| S2 | Low (fails closed) | The card gate refused valid limits such as EUR 19.99. | Fixed |
| S3 | Low (UI) | /try's money-flow strip stopped at "Your passkey" after "paid once". | Fixed |
| S4 | Low (hardening) | purser-try's JSON answers, redirects and plain text carried only HSTS and nosniff. | Fixed (sweep 3) |
| N1 | Low–medium (availability) | /try starts could rotate through the /64s of one IPv6 /48. | Fixed (sweep 2) |
| N2 | Low (by design) | Event-pool starts skip the per-address limits. | Not fixed: by design |
| N3 | Low | Wrong platform-admin tokens are not counted or rate-limited. | Not changed, on purpose; owner action |
| N4 | Low (latent) | `awx_act_spend` does not compare the amount on a repeat request_id. | Not fixed: no path reaches it |
| N5 | Low | `normaliseAmount("1.500")` reads 1500.00, not 1.50. | Not fixed: documented |
| N6 | Low | A lost answer on "issue card" can orphan a sandbox card. | Not fixed: capped |
| N7 | Low | Two side pages miss HSTS, XFO and Permissions-Policy. | Not fixed: covered by CSP |

### S1: payout cap reservation freed on `duplicate_request_id` (medium, fixed)

**Where:** `src/airwallex/routedRail.ts` (`refusedOutright`, used by `money()` and batch `addItems`).

`money()` frees a payout's reservation under `awx_act_company_cents_day` and `awx_act_global_cents_day` whenever Airwallex answers 4xx. A 4xx was taken to mean "refused, nothing moved". Airwallex's 400 `duplicate_request_id` means the opposite: the first send went through.

**Reproduction** (`test/security-sweep-2026-11-15.test.ts`, S1):

1. The first `createTransfer` loses its answer (`AirwallexAmbiguous`). The reservation is kept.
2. The executor resends under the same request_id (`createOrAdopt`, `src/executors/invoicePayment.ts`).
3. The resend is answered 400 `duplicate_request_id`, and the reservation is deleted.
4. The executor adopts the transfer. Result: EUR 9,000.00 moved at the sandbox, and the spend table was empty.

**Fix:** `duplicate_request_id`, `request_id_duplicate` and `duplicate_request` no longer count as outright refusals, so the amount stays spoken for. Other 4xx answers still free it.

**Live impact:** none today. Airwallex actions are off by default (`awx_act`), and money is test money.

### S2: card limits with float error refused (low, fixed)

**Where:** `src/airwallex/cardGate.ts` `amountOk`.

The check was `Math.round(v * 100) === v * 100`. Because of float error it refused 19.99, 0.29 and 1.15, so a CFO limit like EUR 19.99 could never be issued, set or tested. It failed closed.

**Fix:** a tolerance of 1e-6 cents. A third decimal, zero, negatives, NaN and amounts over the ceilings are still refused, and a test covers each.

### S3: the /try money-flow strip after "paid once" (low, UI, fixed)

**Found in the browser pass** at 390 px, light. The visitor approves, presses "Now change one cent", leaves the terms unchanged and presses Pay. The page says "They were paid once" and the top stepper says Paid. The money-flow strip still showed "Your passkey" as the current step, with "Test bank" and "Booked" not done.

**Fix:**
- The paid-once line now carries `paidonce`.
- `flowOf` (`cloud/src/try/visuals.ts`) marks every step done when it sees that line, on both the approve and the pay screen.
- The test runs `flowOf` from the page's own script.

### N1: /try starts rotating through one IPv6 /48 (low–medium, fixed in sweep 2)

**Where:** `cloud/src/try/start.ts` `startCompany`.

The per-address start limit (`starts_per_address_hour`) already keyed an IPv6 address by its /64 and an IPv4 address whole. A /48, the usual allocation to one site, holds 65,536 /64s. Someone holding one could rotate through them, each start passing its own /64's limit, until `starts_per_day_public` was used up. Real visitors would then get 429 for the rest of the UTC day.

**Fix:**
- A /48's public starts in an hour now also count together, under a new switch `starts_per_48_hour` (default 20, ceiling 200).
- The /48 is kept only as a salted hash with the day's salt, like the /64; the address itself is never stored.
- IPv4 is counted whole, as before.
- A visitor's first start from another /48 or from IPv4 is unaffected.
- `test/security-sweep-2-2026-11-15.test.ts` covers the address keys, the limit, the next hour and the hashed bucket. It failed before the fix.

**Still per /64:** the per-address Claude cap (`cap_addr_micros`). Claude spend stays inside the pool's daily and all-time caps (at most USD 30 a day, USD 78 in all).

**Not reproduced live:** that would mean a flood of starts.

### S4: baseline headers on the cloud's non-page answers (low, hardening, fixed in sweep 3)

**Found live:** `/v1/engine` (401 JSON), `/v1/try/admin` (405 JSON) and `/console` (302) on purser-try carried only `strict-transport-security`, `x-content-type-options` and `cache-control`. The pages had the full set.

**Fix:** `cloud/src/baseHeaders.ts` `withBaseline`, applied once in `handle()` (`cloud/src/app.ts`), adds to every answer the headers it does not set itself:
- HSTS;
- nosniff;
- `x-frame-options: DENY`;
- `referrer-policy: no-referrer`;
- `cross-origin-opener-policy: same-origin`;
- the pages' Permissions-Policy;
- for JSON, plain text and answers without a body (redirects): `content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.

**Kept as they were:**
- A page's own headers win: the console's nonce CSP, and the PDF frame's `x-frame-options: SAMEORIGIN` and sandbox CSP.
- CORS is untouched: the one `access-control-allow-origin` (pdf.js) and the cross-origin refusals.
- Scripts, fonts and images get no CSP, so their loading does not change.
- An HTML answer without its own CSP gets none: one that allows nothing would blank it.

**Test:** `test/security-sweep-3-2026-11-15.test.ts`. The two integration tests failed before the fix.

### Not fixed: written down for the owner

**N2. Event-pool token visible on the stage QR (by design).**
- Event-pool starts skip the per-address limits on purpose: one room shares one network, and per-address limits would turn the room away.
- The token is in the stage QR's URL fragment, so anyone who sees the screen, in the room or on a stream or photo, can start companies in the event pool until the token's `until`.
- **What bounds it:**
  - `starts_per_day_event` (default 300, ceiling 2,000);
  - the event pool's Claude day cap (`cap_day_micros_event`, at most USD 30);
  - the all-time cap.
  - The public and jury pools are unaffected.
- **Owner action:**
  - Issue the event token (`/v1/try/admin {op: "token", pool: "event", until}`) with `until` at the end of the event; there is no revoke, a token ends at its `until`.
  - Set `starts_per_day_event` to about the room's size.
  - If it is abused, set `starts_per_day_event` to 0 or `starts` off.

**N3. Wrong platform-admin tokens are not counted or rate-limited (on purpose).**
- A wrong token on `/v1/try/admin` and `/v1/try/ops` gets 401 and is not counted.
- **Why no lockout:**
  - These routes are the kill switch (`starts`, `claude`, `awx_act` off).
  - A lockout per address or for everyone would give an attacker a way to block the kill switch: 200 junk tokens every 15 minutes would keep the owner out.
  - A limit that still lets the right token through does not slow guessing, since 200 vs 429 tells a guesser which token is right.
  - Two existing red-team tests pin this: `test/cloud-try.test.ts` ("a flood of 100 wrong tokens never locks out the right one") and `test/try-redteam.test.ts` ("answers the right token after a parallel flood of 100 wrong ones from one address").
  - A lockout was written and tested in sweep 2 and left out by decision (option A).
- **What makes guessing infeasible:** a long random token. The Worker keeps only its SHA-256 (`adminTokenSha256`) and compares in constant time.
- **Owner action (Max):** the admin token must be at least 32 random bytes (or a v4 UUID at minimum), set as a Worker secret with `wrangler secret`. Its entropy cannot be checked from here, since only its hash is deployed.

**N4. Repeat request_id with another amount.**
- `cloudGuard.spend()` lets a repeat request_id through without comparing amount or currency.
- Not reachable today: request ids are server-made and sit inside the signed terms.
- The deposit key `dep:PURSER-IN-<ms>` is the weakest, but it is money in, capped at 500.00.

**N5. A dot before three digits is read as thousands.**
- `normaliseAmount` reads a dot before exactly three digits as a thousands separator, so "1.500" becomes 1500.00. This is documented.
- The visitor signs the shown amount, so nothing is paid that was not signed.

**N6. Orphan sandbox card.**
- A lost gateway answer on "issue card" leaves the action failed with no row. A new action makes a second card.
- Bounded by 3 cards and 20 writes a day per company.

**N7. Side pages without the full header set.**
- `cloud/src/claude/connectPage.ts` and `cloud/src/claude/oauth.ts` lack HSTS, X-Frame-Options and Permissions-Policy. `frame-ancestors 'none'` covers framing.
- `connectPage` reuses its CSP nonce for its 5-minute cache. The page has no script.

## What was checked and held

### Airwallex actions behind the passkey (#332)

`awxGuard.ts`, `routedRail.ts` and `awxGateway.ts`:
- **Fail-closed:** switches, caps and the gateway-side `AWX_GATEWAY_WRITE` all fail closed.
- **Caps:** both caps are checked in one atomic INSERT…SELECT.
- **Allow-list:** paths with `?#%`, whitespace or `..` are refused. Every path is checked against an anchored regex with fixed-charset ids. `new URL(BASE + path)` cannot change the host. Query values go through `searchParams`. No SSRF was found.

### Cards

`agentCards.ts`, `worker/src/awxCards.ts`, `cardGate.ts`:
- The action is bound to the hash of its stored canonical JSON. `card_id` comes from the stored row, never the caller.
- Expiry is enforced.
- The writes-per-day cap, the global cap and the cards cap are taken in one atomic UPDATE.
- Every query is scoped to the tenant.
- Answers are cut to the last four digits: no PAN, no CVV, no cardholder.

### Events webhook (`worker/src/awxEvents.ts`, `core.ts` hook)

Signature:
- HMAC-SHA256 over the timestamp plus the raw body, checked before parsing.
- Compared in constant time.
- Timestamp tolerance enforced.
- Failures counted per address.

Replay and storage:
- The same event id is kept once.
- Only four sanitised fields reach the public feed.
- Store and feed are bounded.

Live:
- An unsigned POST gets 401.
- A 300 KB body gets 413 (the limit is 64 KiB).
- The feed is empty and `receiving: true`.

### /try FX quote and payout (`liveFx.ts`, `livePayout.ts`, `worker/src/awxPayout.ts`)

- Quotes are validated (currency, amount, rate, valid-to, markup) and fall back to the recorded rate.
- The payout request_id comes from the signed hash.
- There is one payout row per company.
- Live, a second Pay on the same signed terms answered "paid once".
- The approval sheet's figures were checked by hand: EUR 370.00 × 1.117256 = USD 413.38.

### Passkey assertion binding

Checks in `worker/src/webauthn.ts`, `src/passkey/*`:
- type `webauthn.get`;
- the exact challenge;
- origin and `crossOrigin`;
- rpIdHash against the configured RP id, so another RP id is refused;
- UP and UV flags;
- ES256;
- a counter that must move forward.

Challenges are always server-side:
- The terms hash is recomputed from the stored terms.
- Sign-in and step-up challenges are one-time rows, taken atomically.
- The credential must belong to the tenant and the principal.

### Authz and tenancy

- A /try company comes only from an HMAC-signed bearer session, never from a request parameter.
- There is one engine Durable Object per tenant. Read models add `tenant_id = ?`.
- Tenant ids carry 64 random bits. Visitor tokens are 256-bit and stored hashed.

Live:
- `/v1/engine` without a session gets 401.
- A forged `pcs.` session gets 401.
- A cross-origin preflight to `/v1/try/start` gets 403.

### Idempotency (double pay)

- The host's serial `act()` queue.
- EXECUTED answers `paid_once`.
- The sandbox payout row and Airwallex's request_id stop a second transfer.
- Duplicate-request answers are adopted only when they are exactly this payout.

### Money rounding

- `src/lib/money.ts` is strict: two decimals, safe integers, no negatives.
- The deposit route's regex makes its float-to-cents conversion exact.

### Prompt injection

Approvals come only from WebAuthn `processAssertion`. `paySigned` pays from the stored, signed terms. Changed bank details and new suppliers end in holds. Invoice text can at most change what the CFO is shown and signs. The red-team suites hold: 41 of 41 and 12 of 12.

### Admin

- `/v1/try/admin` is POST-only, and GET gets 405.
- Without the token it answers 401 "platform admin only", checked live.
- The token is compared in constant time.
- Switch values are checked against ceilings.
- The token is sent as a bearer header, not a cookie, so CSRF does not apply.

### Rate limits and Claude cost

- The address comes from `cf-connecting-ip` only; X-Forwarded-For is never trusted.
- Claude spend is reserved atomically under per-company, per-address, per-pool-day and all-time caps.
- Each call's worst case is checked first.
- N1 (fixed) and N2 (by design) were the availability gaps.

### XSS

- Pages build the DOM with text nodes (`el()`, `h()`/`s()` in visuals).
- The only `innerHTML` is fixed server SVG.
- Script-embedded JSON escapes `<`.
- Config sits in a meta attribute through `escAttr`.
- `href`s are constants or encoded hash routes.
- Downloads are `attachment` with `nosniff`.

No echoed value reaches HTML unescaped: invoice text, payee names and Airwallex fields included.

### Headers and CSP (live)

/try has a nonce CSP with no `unsafe-inline` or `unsafe-eval`, plus:
- `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`;
- HSTS;
- XFO DENY;
- COOP;
- Permissions-Policy;
- no-referrer and nosniff.

kit11 `/` uses hash CSPs with the same set. The events JSON has `default-src 'none'`.

### Browser pass (Playwright and Chromium)

Covered:
- /try and /console at 390 and 1440 px, light and dark: no console errors, no failed requests, no horizontal scroll.
- One /try flow at 1440 px, dark, through to the approval sheet.
- Two full /try flows at 390 px, light: start, sample, file, Claude reads, checks, passkey enrolment (virtual authenticator), approve, pay, paid once.
- /console redirects to `/#/sign-in`, which renders correctly.

The one wrong state found is S3.

## The repo's own suites

| Suite | Before | After |
|-------|--------|-------|
| `npm test` (vitest) | 6932 passed, 4 skipped | 6938 passed, 4 skipped (6 new tests) |
| `npm run redteam` | 41 of 41 blocked | n/a (unchanged code paths) |
| `npm run autonomy-redteam` | 12 of 12 held | n/a |
| `npm audit --omit=dev` | 0 vulnerabilities | n/a |

The red-team runs rewrite their report files with new timestamps. Those changes were not committed.

## What was not checked

- **gitleaks:** not run in this environment (downloading the binary was refused). CI's `secrets` job runs it on every pull request and push to main, over the commit's whole history, and it passed on #360's head (`12cda92`). To repeat it locally from the repo root, with Docker (the same pinned image and flags as CI):

  ```bash
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.24.3@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055 git /repo --redact --verbose --no-banner --gitleaks-ignore-path /repo/.gitleaksignore --log-opts=HEAD
  ```

  With gitleaks installed instead (v8.19 or later): `gitleaks git . --redact --verbose --gitleaks-ignore-path .gitleaksignore --log-opts=HEAD`. Exit code 0 and "no leaks found" means clean.
- **try-evals:** there is no `try-evals` script in package.json. The /try behaviour is covered by vitest.
- **Real Airwallex actions:** the sandbox actions with `awx_act` on, and the card writes with `AWX_CARDS_WRITE` on. Both are off live and need the owner's switch and keys. Covered by code review and the in-memory tests only.
- **N1 live:** not reproduced, because that needs a flood of starts.
- **Cross-tenant live:** not tested with two real sessions. Covered by code trace, and live 401s on missing or forged sessions.
- **Live one-cent tamper:** not exercised in the browser pass. Covered by the red-team suite and vitest.
- **Out of scope:** the local loopback approvals server (`src/servers/approvals.ts`, `unsafe-inline` CSP, loopback-pinned).

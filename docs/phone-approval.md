# Dashboard and phone approval

Moved from the project README. Back to the [README](../README.md).

## Dashboard

`npm run dashboard` serves a live view of the ledger at http://127.0.0.1:4300 (set `KIT11_DB` to pick a world).
It polls every 2 seconds, shows Live or Stale, and fits one screen on a laptop and one column on a phone.

| Panel | What it shows |
|---|---|
| Waiting for approval | Every proposal that waits for a person: plain-language summary, countdown to expiry, hash prefix, Opus's advisory verdict, and a link to the approval page. Below it, the latest closed proposals. |
| Agent budgets | Each agent's Metal mandate: spent of budget, what is left, the cap per payment, the payee, how often it was replaced (spend carries over), and the 20.00 split across agents. |
| Treasury | Free EUR above the reserve floor and committed bills, USD above its floor (Airwallex, from the last balance read), and the Metal earnings swept to Airwallex. |
| Refusals and escalations | Every refused purchase, escalated invoice, late approval, expired or rejected proposal, with its reason in plain words. |
| Agent activity | The audit log as sentences, newest first, with the agent, the Claude model where one was used, explorer links for chain transactions and Airwallex ids. |

The dashboard opens the ledger read-only and holds no key, so it cannot approve or move money; "Review and approve"
opens the approval page (`npm run approvals`). Every ledger text is rendered as text (agents read hostile documents),
and the page runs under a CSP that allows only its own script and style. The page uses relative URLs only, so the
same file can be served from a phone-reachable host later.

![Dashboard](dashboard-desktop.png)

## Approving on a phone with a passkey

The dashboard and the approvals also run on one fixed address, `https://kit11.<subdomain>.workers.dev`, so the CFO
can approve from a phone with Face ID. The passkey signs the SHA-256 of the exact terms: the challenge is the hash's
32 bytes, so a signature is worth something for those terms only, and any change after signing makes it worthless.

```text
phone (pages, WebCrypto, passkey)  ⇄  relay Worker on Cloudflare  ⇄  runner (this repo, holds the ledger)
 checks the hash itself,             stores the last state,          verifies every signature itself,
 signs it with Face ID               queues what the phone sends     then decides and executes
```

- **The relay cannot approve anything.** It is a Cloudflare Worker with one SQLite Durable Object (`worker/`): it
  serves the pages, keeps the state the runner last pushed and queues what the phone submits. It holds no key. The
  runner (`npm run relay`) pulls each submission and verifies it with `@simplewebauthn/server` against the pinned
  public key: the challenge must be the proposal's terms hash, the origin and rpId the relay's host, user
  verification on, the counter not going back. Only then does it record the approval (method `passkey`, approver
  `max (passkey <id>)`) and run the executor. The relay's own checks (same-origin posts, the exact hash, expiry,
  queue and per-address limits) only refuse early.
- **The phone checks the hash too.** The page canonicalises the terms and hashes them itself (WebCrypto), and will
  not offer anything that does not hash to the hash it would sign. Every line of the confirm screen is built from
  those hashed terms, never from text the relay sends.
- **Mis-tap prevention.** Price options sit side by side. A tap opens a full-screen summary of that one option: one
  card with what it is, the amount, margin, recipient, the countdown, the page's own check (pass or fail) and the hash
  prefix; then what it does in one sentence and the options it is *not*. Advice (Opus, the Treasury agent) is marked
  advisory, and every term is folded under "All terms (exactly what is hashed)". Only "Confirm with Face ID" there
  starts the passkey (it arms after 0.8 s, so a double tap cannot reach it); Back signs nothing. Terms that check out
  but cannot be signed show a red notice naming the rule instead of the button. Once one option is approved, the
  runner refuses the others. `test/browser/approve-layout.check.ts` holds the layout at 360 to 1280 px.
- **Rejecting with Face ID.** Every proposal has a Reject button beside it (marked when Opus advises it). The same
  summary opens, saying "You are rejecting", and the passkey signs a rejection hash derived from the terms hash
  (`sha256("kit11 reject v1 " + terms hash)`), so a rejection signature can never be replayed as an approval, nor an
  approval as a rejection. The runner verifies it the same way and records the rejection; nothing runs.
- **Enrolment:** `npm run relay -- --enrol` prints a one-time code (ten minutes, five tries); the approver opens
  `/enrol` on the phone, types it and creates the passkey with Face ID. The runner checks the code and the new
  passkey itself and pins it in the ledger; the dashboard shows which passkey approvals need.
- **Verifiable later:** every signature is stored, and `npm run verify` checks each passkey approval and rejection
  again offline.
- **Late or offline:** a signature that arrives after the proposal expired approves nothing and is recorded as too
  late; one sent while the runner is offline waits on the relay (up to 30 minutes) and the phone says so.

| Command | What it does |
|---|---|
| `npm run relay:deploy` | Bundles the pages and deploys the Worker with the pinned wrangler (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) |
| `npm run relay` | Connects this ledger (`KIT11_DB`) to the relay and keeps it in sync; add `-- --enrol` for a one-time enrolment code |
| `npm run relay -- --local` | The same relay on http://localhost:4400 without Cloudflare (passkeys work on localhost) |

The runner's token for the relay is `KIT11_RELAY_TOKEN`, or else derived from the Cloudflare token (whoever holds
that can redeploy the Worker anyway). **The relay's data is not public.** Every `/api/` route needs a viewer key,
derived from the relay token, so the Worker needs no new secret. `npm run relay` prints a viewer link with the key in
the `#fragment`, which browsers never send to a server. Open it once on each device: the page keeps the key there,
removes it from the address bar and sends it with each request. Without it the pages load but show no data, and the
relay takes no submission. The key unlocks viewing and sending signatures; it approves nothing. The same link pins
the runner's public key. The runner signs the terms, names and policy it sends, and the phone shows nothing to sign
unless that signature checks out. A new passkey counts only after `npm run passkey -- confirm <fingerprint>` on the
runner, with the fingerprint the phone shows. Limits: a page served by a compromised Cloudflare account could show one thing and sign
another hash, but the runner still executes nothing that is not a waiting proposal's exact terms.

| Choose an option | Confirm what it does | Done | Or reject |
|---|---|---|---|
| ![Options](approve-options.png) | ![Confirm](approve-confirm.png) | ![Done](approve-done.png) | ![Reject](approve-reject.png) |


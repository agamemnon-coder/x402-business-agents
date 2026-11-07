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
- **The approval view.** The first screen, at 390 × 844, holds what the CFO decides on: what (the amount, the payee,
  the agent), why it needs him in one line (the rule that sends it to him, with the policy's own numbers), and two
  buttons, "Approve with Face ID" and Reject. Everything else (the sentence, the exact terms, the hash, the options it
  is *not*, the agents' advice and Opus's review) is behind one fold, "Details". Warnings (a planted line code
  ignored, an account holder who is not the vendor) stay in the first screen. The buttons stay on screen as he scrolls.
- **Mis-tap prevention.** Price options sit side by side above the view; choosing one only changes what the view shows,
  and the button names it ("Approve option B with Face ID"). The buttons arm 0.8 s after the view opens or the choice
  changes, so a double tap cannot reach them; the passkey's challenge is that one option's hash. When Opus advises
  rejecting, Reject comes first and "Approve anyway with Face ID" arms only after 3 s, under a loud line. Once one
  option is approved, the runner refuses the others.
- **Rejecting with Face ID.** Reject signs a rejection hash derived from the terms hash
  (`sha256("kit11 reject v1 " + terms hash)`), so a rejection signature can never be replayed as an approval, nor an
  approval as a rejection. The runner verifies it the same way and records the rejection; nothing runs.
- **A new run's key.** The viewer link pins the runner's key on the phone, and each run has its own key. A link with
  another key never replaces the pin by itself: the page shows both keys' fingerprints (the runner prints its own as
  `key` beside the viewer link) and one button, "This is a new run: use the new key". Only the person's press switches,
  and only to a key a link brought and that signed what the relay sends now; anything signed by another key, or by
  none, is refused. Switching signs nothing.
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

| The approval view | Against Opus's advice | Done | A new run's key |
|---|---|---|---|
| ![The approval view](approve-view.png) | ![Against advice](approve-against-advice.png) | ![Done](approve-done.png) | ![A new run's key](approve-keychange.png) |


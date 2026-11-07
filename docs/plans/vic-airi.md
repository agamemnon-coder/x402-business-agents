# Airi single-use credentials (the route Airwallex calls VIC): step 0 findings and the step 1 plan

Status, 7 November 2026: step 0 researched; **step 1 built** on branch `vic` (Max's go), run live once as vic-1b
(the API confirm refused, B's tap link unseen; both fixed on `airi-camelcase`, see the run plan). The run
plan is [docs/runs/vic-1-plan.md](../runs/vic-1-plan.md). Since step 0: airi-cli 0.1.0-beta.4 is installed in the
container (skills and telemetry off), Max's allowlist is active, and agent use is on. Our Airwallex sandbox takes
PaymentIntents (the coordinator's probe, with Max's ok: create answered 201, REQUIRES_PAYMENT_METHOD).

**Step 1 as built** (all behind `KIT11_AIRI_RAIL=on`; tests on stand-ins only):
- `src/airi/cli.ts`: the real client. It runs the Go binary itself with execFile (no shell), checks its SHA-256 and
  `version` 0.1.0-beta.4, and passes `-o json --no-telemetry` with a child environment that holds no Purser key. Each
  command has a time limit; get-credential waits 300 s. Every answer is parsed with zod, using the shapes seen on
  7 Nov: whoami `{authenticated, session_expires}`; payment-methods an array of
  `{asDefault, card, createdAt, nickName, paymentMethodId, type}`, of whose `card` only a plain brand and last four
  are read. CLI error text is scrubbed of links, long digit runs and e-mails.
- `src/airi/credential.ts`: the credential file is read only by the checkout, in memory, from a 0600 regular file
  (no symlink). Its field names are not documented: the reader matches the documented words, and a file it does not
  recognise is refused, naming its keys and never its values.
- `src/airi/checkout.ts`: the Airwallex sandbox checkout. It creates a PaymentIntent, then confirms it with the card
  (docs URLs in the file). Airwallex's state and its own code decide: accepted, declined, or not known (then it is
  looked up by the intent's id, never resent). Errors never carry the card. Since vic-1b (7 Nov) this is
  `AIRI_CHECKOUT=api` only: our sandbox refuses the confirm ("not enabled for native API access").
- `src/airi/hostedCheckout.ts` (since vic-1b, the default): the same PaymentIntent, paid on Airwallex's Hosted Payment
  Page in headless Chromium. Airwallex.js `redirectToCheckout`, the card typed in like a shopper, Pay, then one GET
  for the outcome. 3DS that does not finish by itself is `THREE_DS_REQUIRED`. Findings and the probe:
  [docs/runs/vic-1-plan.md](../runs/vic-1-plan.md).
- `src/airi/purchase.ts`: reservation (`airi_purchases`, the hold, the day's count under the write lock), steps in
  `money_steps`, the hash re-checked before the mandate and before the credential. `mandate result` after every
  submitted checkout, `mandate cancel` whenever Purser stops before it. Crash recovery (`recoverAiriPurchases`, at the
  runner's start). Audit rows with safe references only.
- `src/airi/policy.ts`, `src/policy/rules.ts`, `src/policy/loosens.ts`: three new CFO policy settings.
  `approval.airi_alone` is the amount a purchase may reach without Face ID (20.00 EUR). `approval.airi_alone_per_day`
  is how many such purchases a day (3). `airi.merchant.<id>` allows a merchant; it is blocked until the CFO allows it.
  The hard cap is 200.00 EUR.
- The runner: `airi_purchase` in `src/executors/index.ts`, recovery in `src/cli/relay.ts`, and the phone page
  "Airi purchase" in `src/approve/client.ts`. That page reaches the phone only after the relay Worker is deployed
  again, which is Max's call.
- `npm run airi:vic-1` (`src/airi/vic1.ts`, `src/cli/airiVic1.ts`): preflight, A, B and C, a record and a run log
  without secrets, and `--dry` on the stand-ins.

The rest of this page is the step 0 research as written then.

Trigger: Terry Yin (Airwallex, 7 November) says Visa Intelligent Commerce (VIC) is available inside Airi, along
Kit 9's route: an account on app.airi.com, an allowlist for airi-cli, a card with agent use on, and then a credential
per purchase from the CLI. Max reports that the allowlist is done (7 November).

## Sources (read 7 November 2026)

| What | URL | Official? |
|---|---|---|
| airi-cli README (commands, flags, install, test card) | https://github.com/airwallex/airi-cli#readme | Yes: Airwallex's GitHub org |
| Getting started guide | https://github.com/airwallex/airi-cli/blob/master/docs/airi-get-started.md | Yes |
| airi-get-credential skill (the checkout workflow, security rules) | https://github.com/airwallex/airi-cli/blob/master/skills/airi-get-credential/SKILL.md | Yes |
| Releases (v0.1.0-beta.1 to beta.4, assets, per-file .sha256) | https://github.com/airwallex/airi-cli/releases | Yes (published by DevOps-Airwallex) |
| npm package metadata (`@airwallex/airi-cli`) | https://registry.npmjs.org/@airwallex%2fairi-cli | Airwallex's npm scope |
| Airi product page ("Airi for Agents: coming soon") | https://www.airwallex.com/en-us/payments/airi | Yes |
| Airi in the payments docs (consumer one-click checkout; no agent content) | https://www.airwallex.com/docs/payments/payment-methods/global/airi | Yes |
| Kit 9 text (Approval-Bound Shopping Agent) | https://airwallexdev.com/guide and https://airwallexdev.com/agentic-banking-builder-guide.md | **No**: its footer says "Not official Airwallex documentation" (the hackathon builder guide) |
| Visa on Airwallex and Airi | https://www.fool.com/earnings/call-transcripts/2026/10/28/visa-v-q4-2026-earnings-call-transcript/ | A transcript of Visa's earnings call, not a Visa or Airwallex doc |
| VIC itself | https://developer.visa.com/docs/visa-intelligent-commerce.md | Yes (Visa) |

app.airi.com and airi.com render nothing without a login, so the portal's own screens (the "agent use" switch) could not be read.

## What the sources say

**Where Kit 9 lives.** In the hackathon builder guide, section "9. Approval-Bound Shopping Agent", which is not
official Airwallex documentation by its own footer. It says Airi CLI is in public beta with allowlisted access: create
the account at app.airi.com, then email devhelp@airwallex.com with that account's email. It also says "Participants
receive an Airwallex-issued card. You place real orders at merchants of your choice." The official documentation is
the airi-cli repository above.

**The CLI.** `@airwallex/airi-cli`, a single binary for macOS and Linux (x86-64, ARM64). It is installed with
`npm install -g @airwallex/airi-cli@beta`, which downloads the binary and verifies its SHA256, or with a fallback
`curl | sh` script. Version 0.1.0-beta.4 (README badge; npm `beta` tag, published 2026-11-06). Releases carry a
`.sha256` per tarball and no signature or attestation. The npm metadata shows a `postinstall` script, licence
`UNLICENSED` and a repository field pointing to an internal Airwallex GitLab. By default the install also writes Airi's
agent skills into `~/.agents/skills` and into every detected agent's directory, `~/.claude/skills` included
(`AIRI_CLI_SKIP_SKILLS=1` stops that). Telemetry is on by default (`AIRI_TELEMETRY_DISABLED=1` or `--no-telemetry`).

**Login.** OAuth device flow: `airi-cli auth login [--client-name <agent>]` shows https://app.airi.com/device and a
code valid for 10 minutes. Non-interactive callers get JSON `{status, verification_uri, user_code, expires_in,
interval}` and then run `airi-cli auth poll`. Tokens refresh by themselves; the README's example session lasts 29 days.
`auth whoami -o json` reports `authenticated` and `session_expires`. Where the session is stored on disk: not in the
docs.

**Getting a credential (the documented flow).**
1. `airi-cli payment-methods list`: the cards available for agentic checkout. An empty list means no card is enabled
   for agents ("edit an existing card to make it available to agents ('agentic')", skill).
2. `airi-cli mandate create --source --payment-method-id --merchant-name --merchant-url --merchant-country
   --total-amount --currency --item name:<p>,unit_price:<x>,quantity:<n> --description` (all required). It returns
   `mandate_id` and a `passkey_url`. "This passkey confirmation is the user's approval of the payment" (skill).
3. `airi-cli mandate get-credential --mandate-id <id> --file <path>` polls (every 2 s, up to 300 s) until the wallet
   owner has approved. It writes the credential to a 0600 file, refuses to overwrite or to write through a symlink,
   and prints only a receipt: `status`, `tokenType`, `tokenExpiration`.
4. The agent fills the merchant's checkout "like a normal card" from the file, then deletes the file.
5. `airi-cli mandate result --mandate-id <id> --result SUCCEEDED|CANCELLED|DECLINED [--reason]` is mandatory after
   every submitted checkout. `mandate cancel` before a charge sets the status to `DENIED`. `mandate list` filters on
   `CREATED, AUTHENTICATED, READY, COMPLETED, FAILED, DENIED`.

**What the credential holds.** "A tokenized PAN, expiry, and CVV for one checkout", single use, a single charge (not
recurring). No cryptogram or ECI is mentioned. Visa's VIC docs describe a VIC credential as a network token, a
cryptogram and an ECI (copy of developer.visa.com read 30 October; the page as fetched on 7 November no longer
shows that row). How Airi's PAN/expiry/CVV relates to a VIC token is not documented.

**VIC.** No Airwallex or Airi source names Visa Intelligent Commerce. The only public link is Visa's earnings call:
"Airwallex is testing Visa Intelligent Commerce-enabled credentials and integrating them into their native wallet,
Airi." Terry's message is the only statement that it is available now.

**Test environment.** With the test card 4111 1111 1111 1111 (any valid expiry and CVV) the flow returns "a fake
credential" (README). No source names a merchant or test checkout that accepts that credential. Kit 9 itself assumes
real merchants and a real Airwallex-issued card.

**Airi's own controls.** The airi-cli docs describe none: no per-agent limit, no merchant restriction, no spend cap.
Each mandate is bound to one merchant, amount, currency and item list, and approved by the wallet owner's passkey.
The product page lists "Airi for Agents" as "coming soon". Airwallex's agentic-wallet pages describe spend limits and
permission controls in general terms, not as Airi features one can set today.

## How Airi maps onto the CFO policy

| Control | Airi (documented) | Purser |
|---|---|---|
| Per-purchase limit | none | `autoMaxCents`: at or below it the agent's purchase runs alone; above, the CFO's Face ID over the terms |
| Hard cap | none | `hardCapCents`: refused even with Face ID |
| Merchant restriction | the mandate names one merchant | an allowlist of https origins; the mandate is built from the approved terms only |
| Currency | per mandate | allowed currencies |
| Exact terms | the mandate (merchant, total, items) and the owner's Airi passkey | the CFO signs the SHA-256 of the JCS terms; the executor re-checks it before the mandate and again before the credential |
| Stop, pause | not documented | emergency stop, paused and stopped agents refuse before any call |
| Totals over time | not documented | step 1: a hold per purchase in `src/policy/holds.ts`, as for card and Metal payments |

So Purser holds every limit. Airi adds the wallet owner's passkey per mandate, on top of whatever Purser decided. That
means "within the limit, the agent runs alone" holds for Purser only: Airi still waits for its owner's approval. Unless
Airwallex confirms a way to skip that, every vic-1 purchase needs Max's tap on Airi's page.

## Feasibility

**Yes for the executor; conditional for a live run "vic-1".** Everything Purser needs from Airi is documented as CLI
commands with JSON output, and the groundwork shows the decision logic against a stand-in. A live run still depends on
three things we do not control:

1. a checkout that accepts the test card's fake credential (not documented anywhere; question for Airwallex);
2. Max approving each Airi mandate on app.airi.com (by design, per the skill);
3. a written confirmation from Airwallex before any text says "Visa Intelligent Commerce".

**Risks.**
- **Naming:** the official docs never say VIC and mention no cryptogram. Until Airwallex confirms it in writing, the
  product says "a single-use card credential from Airwallex's Airi wallet", never "VIC" or "Visa".
- **No test merchant:** with the test card, a real merchant would decline a fake credential. Kit 9's real-merchant
  route means real money.
- **Card data in our process:** the checkout must read a PAN, expiry and CVV from a file. That has to stay out of
  models, logs, the relay and the audit log, with the file deleted after use. That is PCI scope, which a test card
  keeps theoretical.
- **The install changes the machine:** a postinstall script, a downloaded binary, skills written into Claude Code's
  directory, telemetry. Mitigation: pin 0.1.0-beta.4, `AIRI_CLI_SKIP_SKILLS=1`, `AIRI_TELEMETRY_DISABLED=1`, check
  `which -a airi-cli`.
- **Beta:** 0.1.0-beta, four releases in three weeks. Flags can change, so the adapter refuses any version but the one
  it was read against.
- **Session on disk:** the login session lives somewhere the docs do not name, refreshes itself and lasts about a
  month. Anyone with the runner machine can create mandates; each one still needs the owner's passkey.
- **Double charge:** a timeout or unknown checkout outcome must never be retried blind (Kit 9 guide, skill). The
  groundwork leaves it "unconfirmed" for a person.
- **Consumer wallet:** Airi is a shopper's wallet. Using it for a company's agents is a demo shortcut, not the product
  story.
- **Time:** the hackathon's build phase ends 15 November (HackerEarth).

## What Max does himself (exact steps; sources above)

1. Account at https://app.airi.com/ (done) and allowlist (done, 7 November).
2. Install, pinned, without skills or telemetry:
   `AIRI_CLI_SKIP_SKILLS=1 AIRI_TELEMETRY_DISABLED=1 npm install -g @airwallex/airi-cli@0.1.0-beta.4`
   (the `@<version>` form is standard npm; the README shows `@beta`). Then `which -a airi-cli` (one entry) and
   `airi-cli version` (0.1.0-beta.4). Never set `AIRI_CLI_SKIP_CHECKSUM`.
3. Log in: `airi-cli auth login --client-name "Purser"`, then open https://app.airi.com/device, enter the code and
   approve. The session never goes into a chat, a file in the repo, or an environment variable we log.
4. In https://app.airi.com/ add the card 4111 1111 1111 1111 with any valid expiry and CVV, and make it available to
   agents. The exact switch label is not in the docs; Terry calls it "agent use".
5. Read-only check: `airi-cli auth whoami -o json` (`authenticated: true`) and `airi-cli payment-methods list -o json`
   (the test card appears; tell us its `paymentMethodId`, which is not a secret). No `mandate create`, no
   `get-credential`.
6. Ask Airwallex (devhelp@airwallex.com or Terry) the open questions below, above all: which checkout accepts the
   test credential.
7. During vic-1: approve each Airi passkey page, and give the CFO's Face ID for the purchase above the limit.

## External calls for vic-1 (estimate)

The scenario: one purchase within the limit, one above it after the CFO's Face ID, one refused.

| Step | airi-cli invocations | Other calls |
|---|---|---|
| Preflight: `version`, `auth whoami`, `payment-methods list` | 3 (`version --check` adds 1 to GitHub) | none |
| A, within the limit: create, get-credential, result | 3 | checkout 1 to 3 (depends on the test checkout); Max's Airi passkey (1 tap) |
| B, above the limit | 3 | Purser relay: about 3 (proposal out, phone approval, runner pulls it); Max's Face ID (Purser) and Airi passkey; checkout 1 to 3 |
| C, refused by Purser (merchant not allowed, or above the hard cap) | 0 | none |
| Total | about 9 to 10 CLI invocations | 2 to 6 checkout calls, about 3 relay calls; 3 taps by Max |

`get-credential` polls Airi every 2 s while it waits for the owner's tap, so one invocation is about 5 to 150 HTTP
requests inside the CLI. A login, if the session has expired, adds 2 invocations (`login`, `poll`).

## Step 1 plan

The groundwork already on this branch:
- `src/airi/client.ts`: the `AiriClient` and `AiriCheckout` interfaces, `AiriRefusal` (who refused, their code), and
  `mandateCreateArgs` (the documented argv, refusing values the CLI's `name:…,unit_price:…` item syntax or a terminal
  could misread). It is built, never run.
- `src/airi/standIn.ts`: `StandInAiriClient` and `StandInCheckout`, labelled "Stand-in for airi-cli: no call made, no
  card credential issued (not Airi, not Visa)". No network, no program, no card data: the "credential" file is a
  marker.
- `src/airi/purchase.ts`: `decideAiriPurchase` (pure), `requestAiriPurchase` and `executeAiriPurchase`, the run with
  the hash re-checks, and the audit rows.
- `test/airi-purchase.test.ts`: 15 cases. They cover: auto, CFO, hard cap; each refusal code; the argv; the order of
  calls; the file deleted; nothing secret in the log; not yet approved; terms changed after approval; terms changed
  between mandate and credential (cancelled, no credential); policy tightened (closed for re-approval); Airi refuses;
  the checkout declines; an unknown outcome is left unconfirmed.

The executor's rules, as built:
1. Purser's checks come first and call nothing outside: stop, pause, velocity stop, amount, items adding up to the
   total, currency, merchant origin, hard cap. A refusal returns `{status: "refused", by: "purser", code}` with codes
   like `PURSER_MERCHANT_NOT_ALLOWED`, plus an `airi.purchase_refused` row.
2. At or below `autoMaxCents` it runs at once. The same terms object is hashed, and the hash is checked again before
   the credential is requested.
3. Above the limit it creates a proposal of kind `airi_purchase`. Its terms are agent, amount, currency, merchant
   (name, URL, country), items, description and payment method: what the CFO's passkey signs. When it runs, the policy
   is checked again (a refusal closes the proposal), then `beginExecution` checks the stored terms against the
   approved hash. After `mandate create` and before `get-credential` the hash is checked again (stored terms = approved
   hash = the hash the mandate was built from); on a mismatch the mandate is cancelled and no credential requested.
4. The credential goes to `mkdtemp(purser-airi-)/credential.json` and only the checkout reads it. The directory is
   removed in `finally`.
5. Audit rows: `airi.purchase_requested`, `airi.mandate_created` (mandate id, order hash), `airi.credential_received`
   (receipt only), `airi.checkout_result` (outcome, merchant reference, code), `airi.purchase_refused` (`by` and the
   code as given), `airi.checkout_unconfirmed`. Never the passkey URL, the file, or anything in it.
6. Refusals carry the real code from whoever refused: Purser's `PURSER_*`, Airi's error or status, the merchant's
   decline code.

Still to build in step 1 (after Max's go and the answers below):
1. **A real `AiriCliClient`.** It runs the pinned binary with `execFile` (no shell) and fixed argv from
   `mandateCreateArgs`, with `-o json --no-telemetry`, `AIRI_CLI_SKIP_SKILLS=1` and `AIRI_TELEMETRY_DISABLED=1`. It
   refuses any version but 0.1.0-beta.4, parses only the documented fields, and maps CLI errors to
   `AiriRefusal("airi", <the CLI's own error code or text>)`. Timeouts: get-credential at least 300 s. A CLI timeout
   means "not yet approved", never a refusal.
2. **The checkout adapter** for whichever test checkout Airwallex names. It reads the file, submits, and returns the
   merchant's reference and code. Without a named checkout, vic-1 stops at the receipt and reports `CANCELLED` to
   Airi, and is shown as "credential received, no checkout".
3. **CFO policy keys** in `src/policy/rules.ts`: `airi.auto_max`, `airi.hard_cap`, `airi.merchants`, `airi.currencies`.
   They change only through an approved `policy_change`, like every limit.
4. **A hold per purchase** (`src/policy/holds.ts`), so purchases within the limit cannot together pass a daily or
   monthly total. Steps go in `money_steps` with the mandate id as the lookup key. After a crash, `mandate list` finds
   the mandate, and the purchase is never sent twice.
5. **Wiring:** an `airi_purchase` case in `src/executors/index.ts` behind `KIT11_AIRI_RAIL=on` (off by default). The
   events are added to `MONEY_EVENTS` with their origin (D24). The phone page shows merchant, amount and currency
   for this kind.
6. **The refusal on screen:** the dashboard and the phone show `by` and the exact code, as the TAP rail does for its
   refusals.
7. **`npm run airi:vic-1`:** a script for the live run with preflight checks (CLI version, `whoami`,
   `payment-methods list`, the rail flag, a run record that does not exist yet), the three purchases, and a run log
   with the audit rows.
8. **Wording:** "single-use card credential from Airwallex's Airi wallet". "Visa Intelligent Commerce" only after
   Airwallex confirms it in writing, quoted with its date, in `src/config/brand.ts`, as the TAP status is.

## Open questions for Airwallex

1. Which merchant or test checkout accepts the credential that the test card 4111 1111 1111 1111 produces? Is it the
   Airwallex sandbox (a Payment Link or Hosted Checkout on our own sandbox account)?
2. Is the Airi credential a VIC credential, and can we say so? It is documented as PAN, expiry and CVV; is there a
   cryptogram?
3. Can a mandate within a limit the wallet owner sets skip the passkey, or is the owner's passkey always required?
4. Does Airi enforce the mandate's amount and merchant at authorisation, or only record them?
5. Are there Airi-side limits or merchant restrictions per agent or per payment method that an API or the CLI can set?
6. Where does airi-cli store its session, and can it be bound to one machine or revoked from the portal?
7. Can a company (not a consumer) hold the Airi wallet for its agents?

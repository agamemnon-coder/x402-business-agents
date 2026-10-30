# Security and threat model

The system lets AI agents buy, sell, refund and pay bills on their own, within limits, and asks a person for
everything else. This page lists what we protect, who might attack it and how, what stops each attack, and what is
out of scope. It covers our own system only. Every claim below points to code or to a test.

## What we protect

| Asset | Where it lives |
|---|---|
| Treasury: *USDZ on Metal testnet, EUR and USD in the Airwallex sandbox | on chain; Airwallex |
| Agent mandate keys and credentials, the owner key | the private keys repo (`x402-business-agents-keys`), never in this repo or a model |
| API credentials: Airwallex key, Metal RPC URL, Anthropic key, Cloudflare token, relay token | environment secrets only |
| The CFO's passkey | his iPhone (iCloud Keychain); the ledger pins its public key |
| The ledger: proposals, approvals, the hash-chained audit log, the beneficiary allowlist, the CFO policy | SQLite on the runner |

## Trust boundaries

```text
outside documents (invoices, emails, notices)  ─┐
supplier / customer x402 servers               ─┤──>  agents (code)  ──> Claude (reads, advises; no keys, no tools)
                                                │         │
phone (passkey) ──> relay Worker (Cloudflare) ──┼──> runner (verifies, decides) ──> executor ──> Metal / Airwallex
                                                │         │
                                                └── ledger + audit log (append-only, hash-chained)
```

Everything left of the runner is untrusted input. That includes every document, every model answer, and the
relay with whatever it queues. Only the runner holds keys and writes the ledger.

## Attackers and attacks

| # | Attacker | Attack | What stops it | Proof |
|---|---|---|---|---|
| 1 | Fake supplier (BEC) | Invoice with new bank details | Code compares IBAN/BIC with the allowlisted beneficiary and blocks before Airwallex is called; Opus only explains; agents cannot change the allowlist | `src/policy/fraud.ts`, `test/fraud.test.ts`, `npm run fraud` |
| 2 | Fake supplier | Lookalike vendor name (one letter, a swap, Cyrillic letters) | Edit distance and a homoglyph skeleton against the allowlist; blocked | `test/fraud.test.ts` |
| 3 | Anyone who sends a document | Prompt injection ("SYSTEM: ignore your rules", "pre-approved", hidden characters) | Documents are wrapped as data; code flags planted lines; readings have no payee or approval field; Sonnet's invoice reading must match the document's own lines; payees come from the allowlist and the ledger | `src/policy/injection.ts`, `test/injection.test.ts`, `npm run inject` |
| 4 | A model gone wrong | Wrong amount, wrong payee, "approve" | Every reading passes a code check or falls back to a parser; reviews are advice stored beside the proposal, outside its hash | `test/claude.test.ts`, `test/adversarial.test.ts` |
| 5 | Customer | False dispute ("refund everything") | Each order is re-verified on chain; only verified wrong ticks are refunded automatically; refund-all goes to a person | S2 run log, `test/disputes.test.ts` |
| 6 | An agent (bug or misuse) | Overspend | On-chain mandates (cap, budget, payee, expiry) are the outer wall; the CFO policy refuses before signing | F2 run log (`mandate_cap_exceeded`), `test/policy-rules.test.ts` |
| 7 | Anyone | Forged, replayed or reused approval | An approval binds the SHA-256 of the exact terms (typed prefix or passkey signature); a second approval, another proposal's signature, or a rejection signature used as approval are all refused | `test/passkey.test.ts`, `test/adversarial.test.ts` |
| 8 | Anyone | Terms changed after approval | The executor recomputes the hash and refuses on mismatch | `test/adversarial.test.ts` |
| 9 | Time | Expired quote, late approval | Expiry is part of the terms; a late approval approves nothing; re-quoting changes the hash | F1 run log, `test/adversarial.test.ts` |
| 10 | Anyone | Double payment | Idempotency keys everywhere (below); an executed proposal cannot run again; a lost answer is looked up, never resent | `test/euroBill.test.ts`, `test/adversarial.test.ts` |
| 11 | Old credential | Pull under a replaced mandate | The chain refuses (`mandate_revoked`) | S1 run log |
| 12 | Internet visitor | Abuse of the relay | Same-origin POSTs, size caps, per-address (IPv6 /64) and per-queue limits, five tries per enrolment code; 20 failed viewer-key or webhook-signature attempts per address in ten minutes, then refused (HF1); HSTS on every answer; the relay cannot approve | `test/relay-worker.test.ts` |
| 13 | Relay or Cloudflare account that changes *data* | Change what the phone shows (terms, names, policy) or replay an older state | The runner signs those plus the ledger counter (ES256); the phone checks them against the runner key it pinned from the viewer link (out of band; a later link cannot replace it) and refuses an older counter. **This does not hold against a relay that serves a different *script*: see below** | `test/relay-sign.test.ts`, `test/approve-client.test.ts`, browser check |
| 13b | Someone who saw the enrolment code, or a relay at enrolment time | Enrol their own passkey | A new passkey counts only after the person on the runner confirms its 64-bit fingerprint; the first passkey in a window wins and a second closes the window with an alarm; a replaced passkey stays active until then; the relay gets only an HMAC of the code. **Enrolment trusts the page at that moment**: a relay serving a malicious script could show its own key's fingerprint. What limits it: enrol right after a deploy from this repo, with two-factor login on the Cloudflare account; a passkey is bound to the relay's address, so it cannot be enrolled anywhere safer for this address | `test/passkey.test.ts` |
| 14 | Stolen phone | Approve as the CFO | The passkey needs Face ID (user verification is required and checked); revocation means re-enrolment | `src/passkey/webauthn.ts` |
| 15 | Insider with database access | Edit or truncate the log | The database refuses updates and deletes; the hash chain detects edits; an anchor printed in the audit report detects truncation or a full rehash | `test/audit.test.ts`, `test/audit-report.test.ts`, `npm run verify-log` |
| 16 | Leaked secret | A key in git or in a model's context | No key ever goes to a model (tested); every commit is scanned for the real values; gitleaks scans the pushed commits and the whole history in CI | `test/adversarial.test.ts`, `.github/workflows/ci.yml` |
| 17 | An agent (or a model steering it) that overspends on its card | Buy past the CFO's limit | The limit is set on the card at Airwallex (synced from the policy and read back), so Airwallex itself declines; a raise is a policy change approved with Face ID; the phone can only lower a card limit; the agent never sees the card number or CVV | `src/policy/cards.ts`, `test/cards.test.ts` |
| 18 | Anyone who can reach the webhook URL, or a relay that forges events | Fake a card transaction on the dashboard | The relay accepts an event only with Airwallex's HMAC-SHA256 over `x-timestamp` + raw body and a timestamp within 5 minutes; the runner checks the signature again with its own copy of the secret; an event only records what Airwallex decided and moves no money; each transaction is recorded once by its Airwallex id, and the poll reads the same transactions from Airwallex directly | `worker/src/core.ts`, `src/policy/cardHooks.ts`, `test/relay-hooks.test.ts` |
| 19 | Anyone who sees an agent misbehave, or a breach in progress | Keep spending while people investigate | The emergency stop: one Face ID refuses every agent payment before signing and freezes every card at Airwallex; lifting it needs a proposal and Face ID | `src/policy/rules.ts` (`frozen`), `src/policy/cards.ts`, `test/freeze.test.ts` |
| 20 | A fraudster who changes a supplier's bank details (email, invoice, a planted document) | Divert the next payment | The fraud check blocks a changed IBAN; a change counts only after a request, a person's out-of-band verification (agents cannot record it) and the CFO's approval, which shows the full new IBAN | `src/policy/payeeChange.ts`, `test/payee-change.test.ts` |
| 21 | A model that misreads (or is steered by) the CFO's plain-words policy, or someone with only the viewer link who types words on the phone | Loosen a limit, or invent an amount the CFO never wrote | Opus's draft is never applied: code keeps a rule only if its setting exists, its quote is the CFO's own words, its amount is written as a whole number in that quote and in the CFO's text, and the value passes the setting's limits; the survivors become one proposal that needs Face ID. Words from the phone may only tighten (as with the policy editor). One text at a time on the relay, at most 2,000 characters | `test/policy-from-text.test.ts`, `test/relay-policy-text.test.ts`, `test/relay-worker.test.ts`, `test/browser/approve.check.ts` |
| 22 | An outside AI agent connected through the agent API (MCP), or a model steering it | Get a card or spend without the CFO; raise its own limit; reach another agent's money | Its tools only ask, pay and read: a card exists only after the CFO approves its request with Face ID, and the executor issues exactly the approved limits and checks what Airwallex reports back; Airwallex declines charges over the card's limits; a raise is a policy change approved with Face ID; the emergency stop freezes its card too. Its name is fixed by whoever sets up the server, not by the agent; names are checked (`ext:` plus lower-case letters, digits and dashes, never one of ours). Inputs are schema-checked before any code runs | `test/external-agents.test.ts`, `test/mcp-server.test.ts` |
| 23 | One person (a CFO acting alone, a stolen phone, or the agent's own proposer) | Approve a large payment or a bank-detail change alone | Four eyes (E1): above the CFO's threshold, approval needs two different people's passkeys; the first signature only counts toward it; the same person twice does not count; the proposer can never approve; one rejection stops it; a typed prefix never counts; each person has one active passkey; `npm run verify` re-checks both signatures | `test/four-eyes.test.ts`, `test/relay-e2e.test.ts` |
| 24 | A runaway or hijacked agent, or a loop in our own code | Pay many times, or a lot, inside each single limit | Velocity limits per agent (payments a minute, amount an hour, per rail), checked before signing on Metal and on card events; a breach turns on the policy rule `stop.<agent>`, which freezes its card at Airwallex; only an approved policy change with Face ID lifts it; declines and refunds do not count (D7) | `test/velocity.test.ts` |
| 25 | An agent (or whoever controls it) with a card | Use the card for something it is not for, or after its time | Airwallex `authorization_controls` on every card: allowed merchant categories (the sales card pays only ads), EUR only, valid 90 days; the issuer itself declines (`MERCHANT_CATEGORY_NOT_ALLOWED`, seen live in rehearsal 6) | `test/cards.test.ts`, [rehearsal 6](runs/2026-10-29-rehearsal-6.md) |
| 26 | A supplier or a mistake that sends the same invoice twice | Get paid twice | A copy of an invoice already paid, with a payout, or waiting for approval escalates with options; if two proposals were approved anyway, the second stops before any currency is converted; one live payout per invoice is also a database rule | `test/euroBill.test.ts`, `test/evals.test.ts` |
| 27 | A model that answers in a shape it was not asked for | Slip a field past the schema | The reader checks every answer against its schema itself and falls back to the deterministic parser otherwise (found by our red team) | `test/claude.test.ts`, `docs/redteam/report.json` |
| 28 | Anything that makes the ledger and the outside world disagree (a lost webhook, a bug, tampering) | Hide a payment, or record one that did not happen | Daily reconciliation: each Airwallex transfer and card transaction (both ways) and each Metal payment's receipt is checked by id and amount; a difference is an audit row and a red band on the dashboard; nothing is fixed automatically | `test/reconcile.test.ts` |
| 29 | Anyone with the viewer link who types on the phone, an outside agent, or a model steered by the message (Ask Purser) | Get a card without Face ID, a bigger or reusable card than the CFO wrote, a card for something else, or flood the phone with requests | A message with planted instructions or hidden characters is refused before any model reads it; the amount must be written in the message and be under the kind's cap (flight, hotel, train); through the relay or from an agent the result is only a proposal for Face ID, with who asked in the signed terms; only the CFO at the runner gets a card within the policy (at most the threshold and the four-eyes threshold, 3 a day, amount next to €); one waiting request per agent, three from the dashboard link, at most 50 proposals sent to the phone, policy changes first; the card Airwallex issues is single-use, for the task's merchant categories, until the task's date, and is read back and frozen if it differs | `test/ask-purser*.test.ts`, `test/relay-ask.test.ts`, red team `ask-*` and `task-card-second-use`, `test/review-oct30.test.ts` |
| 30 | A customer (or its agent) disputing purchases, or a planted line in the dispute (Dispute desk) | Get refunds for orders its agent signed, refunds sent to another address, or the same sale refunded twice | The desk decides from evidence in code: the signed order, `verifyMandatePayment` against the bound mandate, the delivery hash; the claim text is data; a refund goes only to the payer, never above what was paid and never twice; above the CFO's limits it is a proposal for Face ID | `test/dispute-desk.test.ts`, `test/dispute-case.test.ts`, red team `dispute-refund-elsewhere` |

## Limits on every external call

| Call | Timeout | Retries | When the answer is lost |
|---|---|---|---|
| Airwallex API | 30 s | up to 4 with backoff on 429 (nothing was done); GET also on a network error; one call per 200 ms (half the sandbox limit) | a POST without an answer is never resent: it becomes "ambiguous" and is resolved by its `request_id` |
| Metal RPC | 15 s | none | the step fails and is re-run from the ledger |
| x402 paid request | 60 s | none | if signed, "in doubt": looked up by its nonce on the facilitator, never paid twice |
| Facilitator settlements, x402 offers | 15 s | none | the step fails safely |
| Claude (all three models) | 180 s | 2 (SDK) | the deterministic parser decides |
| Relay sync | 20 s | the next sync | verdicts are kept and sent with the next sync |
| metal-agent CLI | 180 s | none | an `error:` line is an error, never a refusal |

**Idempotency keys:**
- x402 settlement ids;
- refund payment ids (`refund-<sale>`);
- sweep ids;
- Airwallex `request_id` for every conversion and transfer;
- a single-use FX quote;
- one live payout per invoice;
- one credit per on-chain transfer.

## Least privilege

- **Agents:** each agent has its own on-chain mandate, with a per-payment cap, a total budget, a single payee and an
  expiry, and holds only its own mandate key. The CFO policy can only be stricter.
- **Models:** no key, URL, credential or tool. They read text and return typed data that code checks (the test sends
  fake secrets through the environment and asserts that none reaches a request).
- **Airwallex:** use a *scoped* API key, not an admin key. Airwallex lets each key have Read or Write per resource;
  Read covers GET endpoints, and Write covers GET and POST
  ([Airwallex: manage API keys](https://www.airwallex.com/docs/developer-tools/api/manage-api-keys)). This build
  calls only these endpoints:

  | Resource | Endpoints used | Permission |
  |---|---|---|
  | Balances | `GET /balances/current` | Read |
  | Global accounts | `GET /global_accounts`, `POST /global_accounts/create` (once, at setup) | Write at setup, then Read |
  | Deposits | `GET /deposits` | Read |
  | Beneficiaries | `GET /beneficiaries`, `POST /beneficiaries/validate`, `POST /beneficiaries/create` (setup only) | Write at setup, then Read |
  | FX quotes and conversions | `POST /fx/quotes/create`, `POST /fx/conversions/create`, `GET /fx/conversions` | Write |
  | Transfers | `POST /transfers/create`, `GET /transfers`, `GET /transfers/{id}` | Write |
  | Simulation (sandbox only) | `POST /simulation/deposit/create`, `POST /simulation/transfers/{id}/transition`, `POST /simulation/issuing/create` | Write |
  | Issuing (cards) | `GET /issuing/cardholders`, `GET /issuing/cards`, `GET /issuing/cards/{id}`, `GET /issuing/transactions`, `POST /issuing/cardholders/create` and `POST /issuing/cards/create` (setup only), `POST /issuing/cards/{id}/update` (limits) | Write |
  | Webhooks | `GET /webhooks`, `POST /webhooks/create` (setup only) | Write at setup, then none |

  The client refuses any base URL other than the sandbox (`src/airwallex/client.ts`). In production, an IP
  allowlist would be added as well, as Airwallex recommends
  ([API key best practices](https://www.airwallex.com/docs/developer-tools/api/api-key-best-practices)).

## Accepted risks and what is out of scope

- **zod advisory (fixed 2026-10-29).** `@x402/*` is at 2.29.0, which uses fixed zod 4, and an override gives
  `@metalntwx/metal-agent` zod 4.6.7 as well. `npm audit` reports 0 vulnerabilities. A live `npm run verify` (21 checks,
  through metal-agent) and an x402 sale refused by policy behaved as before.
- **The relay serves the phone's script.** A compromised Worker or Cloudflare account can serve a script that
  shows one thing and asks Face ID to sign another waiting proposal's hash. The runner key and its signatures cannot
  stop a lying script; only a page not served by the relay could (a native app).
  What still holds:
  - the runner executes only waiting proposals' exact terms, so payees come from the allowlist and amounts are
    built by code;
  - the phone can only tighten the CFO policy, and the runner enforces that (any loosening is proposed on the
    runner);
  - every approval is in the audit report.
- **Audit anchors are not signed.** Someone who can write the SQLite file can append forged rows after the last
  anchor, including a passkey row, and `verify` still passes. Anchors in committed run records and audit reports
  limit this to rows after the last published anchor.
- **No limit per invoice beyond the reserve floors.** An invoice to the allowlisted payee with a larger amount is
  stopped only by the person who reads the amount on the confirm screen before Face ID.
- **metal-agent runs with zod 4 by override** (it asks for zod 3). The unit tests use fakes. A live `npm run verify`,
  which goes through the metal-agent mandate commands, passed after the change, and each rehearsal runs it again.
- **The viewer key is a bearer key.** Whoever has the viewer link sees the dashboard and can send signatures,
  which still need Max's passkey to count. It is derived from the relay token; rotating that rotates the key.
- **The *USDZ to Airwallex bridge is simulated:** a sandbox deposit references the sweep's transaction hash. The
  sandbox cannot receive stablecoins.
- **Out of scope:**
  - Airwallex's and Metal's own security;
  - the phone's operating system;
  - a compromised runner host. It holds the keys, which is why they live in a separate private repo and nowhere
    else.

## Checks

- `npm test`: the full suite, including `test/adversarial.test.ts`. CI runs it on every push, with type checks,
  gitleaks on the pushed commits and the whole history, and `npm audit` for the root and `worker/`.
- `npm run redteam`: 14 attacks, each in a fresh throwaway world, through the code the runner runs; all must be
  blocked (report in `docs/redteam/report.json`, shown on the landing).
- `npm run evals`: the agents' eval set (normal, too expensive, fraud, injection, double payment, price notice)
  with the real models; CI runs the same cases with the parsers.
- `npm run reconcile`: the ledger against Airwallex and Metal; the runner does it a minute after start, then daily.
- `npm run verify`: re-checks the chain, the mandates, the Airwallex records and every passkey signature, offline
  where it can.
- `npm run verify-log -- --anchor <seq>:<hash>`: proves the log still contains a row printed earlier.
- Before each commit, the real secret values are searched for in the diff. On 2026-10-29 the full history of the
  code, plan and keys repos was searched for every secret value. Nothing was found.

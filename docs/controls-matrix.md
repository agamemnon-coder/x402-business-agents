# Controls matrix: risk, control, test, evidence

Each row is a risk to a business whose AI agents spend money, the control Purser puts against it, where that control
is enforced, the automated test, and the live evidence. This is also the test plan: every control has a test that
runs in CI (`npm test`). The evidence column says where it ran on the real rails (Airwallex sandbox, Metal testnet); "red team" means the
red team's run against in-memory stand-ins, not the real rails.

**Who enforces:**
- **Airwallex:** the card or payout is declined by Airwallex itself.
- **Chain:** Metal's contracts or facilitator refuse it.
- **Code:** Purser's own code refuses before anything is signed.
- **Person:** the CFO decides with Face ID.

What to do when a control fires: [runbook.md](runbook.md). Claims and their sources: [claims.md](claims.md).

## Spending limits

| Risk | Control | Enforced by | Test | Evidence (live run, or red team on stand-ins) |
|---|---|---|---|---|
| An agent overspends on its card | Per-purchase and monthly limits from the CFO policy, written to the card and read back | Airwallex | `test/cards.test.ts`, `test/issuing-adapter.test.ts` | Recorded run: €45.00 declined `LIMIT_EXCEEDED` |
| An agent buys the wrong kind of thing | Merchant categories, currency and end date per card | Airwallex | `test/cards.test.ts` | Recorded run: €19.99 declined `MERCHANT_CATEGORY_NOT_ALLOWED` |
| An agent overspends on chain | A mandate per agent: cap per payment, total budget, one payee, end date | Chain | `test/executors-mandate.test.ts`, `test/metal-pay.test.ts` | Recorded run: price rise refused `mandate_cap_exceeded`; four-eyes run step 6 |
| Agents together exceed the business's budget | Atomic holds against the shared 20.00 and each limit before signing | Code | `test/holds.test.ts`, `test/holds-concurrency.test.ts` (128 holds from 8 processes) | Recorded run (no limit crossed) |
| An agent pays too often | Speed limits per agent and rail; a breach stops the agent and freezes its card | Code, Airwallex | `test/velocity.test.ts` | Red team on stand-ins `velocity-burst`: stopped after 30 allowed payments |
| A loop of small payments drains a budget | The same holds and speed limits; clearing payer capped per payment (`maxAmount`) | Code, chain | `test/clearing.test.ts` | Clearing load test ([run](runs/2026-10-30-clearing-load.md)): 2,000 of 2,000 paid, 4.24 a second, about $0.0007 RPC per payment |

## Approvals

| Risk | Control | Enforced by | Test | Evidence (live run, or red team on stand-ins) |
|---|---|---|---|---|
| Money moves without the CFO beyond the limits | Proposals; the CFO signs the exact terms' hash with a passkey (Face ID); the runner verifies the signature and the hash before executing | Code, person | `test/approvals.test.ts`, `test/passkey.test.ts`, `test/property-terms.test.ts` | Every live run: approvals by Max's passkey |
| An approval is replayed or reused for other terms | Hash-bound, single-use approvals; expiry | Code | `test/approvals.test.ts`, `test/adversarial.test.ts` | Red team on stand-ins: replayed and swapped approvals refused |
| One person alone approves a large payment | Four eyes off chain: above a threshold, two different people's passkeys; the proposer never approves | Code, two people | `test/four-eyes.test.ts` | Optional; off in the recorded run |
| One person alone changes a mandate or moves the account's money | Four eyes on chain: a 2-of-2 Metal account (CFO + controller) | Chain | `test/four-eyes-onchain.test.ts` | [Four-eyes run](runs/2026-10-30-four-eyes.md): one signature reverted three times on chain; two passed |
| A compromised relay forges or alters an approval | The runner trusts no relay: runner-signed terms on the phone, passkey checked on the runner, origin and fingerprint pinned | Code | `test/relay-sign.test.ts`, `test/relay-e2e.test.ts`, `test/relay-worker.test.ts` | Security review fixes ([hardening.md](hardening.md)) |
| The policy is loosened quietly | Only tightening from the phone; loosening is a proposal with Face ID; policy versions hashed and recorded with each decision | Code, person | `test/policy.test.ts`, `test/policy-versions.test.ts` | Red team on stand-ins: a taken-over phone page could only tighten |

## Fraud and payees

| Risk | Control | Enforced by | Test | Evidence (live run, or red team on stand-ins) |
|---|---|---|---|---|
| A fake invoice with changed bank details (business email compromise) | IBAN checked against the supplier's account on file; lookalike names and non-Latin letters caught | Code | `test/fraud.test.ts` | Recorded run: two fake invoices blocked (€3,700) |
| The same invoice paid twice | Invoice numbers normalised (case, dashes, spaces); one live payout per invoice | Code, ledger | `test/invoice-duplicate-key.test.ts` | Red team on stand-ins: "btx-dup" refused |
| A supplier's bank details changed by an attacker | Three steps: request, out-of-band confirmation by a person, CFO approval | Code, person | `test/payee-change.test.ts` | |
| A payout to a sanctioned or unapproved payee | Compliance send policy: the contract pays only with Purser's signed decision, after screening | Chain, code | `test/compliance-screening.test.ts`, `test/compliance-contract.test.ts` | [Compliance run](runs/2026-10-30-compliance-policy.md): 11 attacks reverted on chain; the sanctioned stand-in got no decision |
| A planted instruction in a document or a chat | Documents screened by code; a reading cannot carry a payee or approve | Code | `test/injection.test.ts`, `test/adversarial.test.ts` | Recorded run: two planted instructions flagged |
| Money from a stranger mixed into the business's funds | Metal receive policy on the sweep wallet; quarantine until the CFO decides | Chain, person | `test/quarantine.test.ts` | Separate world, 30 October ([metal-award.md](metal-award.md) section 5) |
| A customer disputes payments falsely | Dispute desk: each order checked against the chain with the signed order kept; code decides | Code, chain | `test/dispute-desk.test.ts`, `test/dispute-case.test.ts` | Recorded dispute case: 12 orders verified |

## Detection and evidence

| Risk | Control | Enforced by | Test | Evidence (live run, or red team on stand-ins) |
|---|---|---|---|---|
| A payment the ledger does not know about | Hourly reconciliation with Airwallex and the chain; alarm on a difference or a stale round | Code | `test/reconcile.test.ts`, `test/health.test.ts` | Red team on stand-ins `hidden-payment`: found afterwards, not prevented |
| An Airwallex event the ledger cannot explain | Webhooks for cards, payouts, conversions and deposits, HMAC-checked twice, compared with the ledger; alarm | Code | `test/airwallex-events.test.ts`, `test/relay-hooks.test.ts` | [Webhooks run](runs/2026-10-30-webhooks.md): deposits matched by webhook alone |
| A forged webhook | HMAC over timestamp and body at the relay and again on the runner; five-minute window | Code | `test/relay-hooks.test.ts`, `test/property-webhooks.test.ts` | Red team on stand-ins: forged webhook ignored |
| The audit log is edited afterwards | Append-only, hash-chained log; `npm run verify`, anchors | Code | `test/audit.test.ts` | Red team on stand-ins `rewrite-history`: found afterwards by verify |
| A payment's finality is disputed later | Metal's finality certificate stored per transaction; header, number and quorum checked; in the dispute pack, the audit PDF and verify | Code | `test/finality.test.ts` | Four-eyes and compliance runs: 26 transactions with reported certificates. The BLS signature is not verified (no published validator keys) |
| A bank or auditor cannot read what happened | ISO 20022 pacs.008 export linking the SWIFT transfer and the Metal transaction; GL journal export | Code | `test/iso20022.test.ts` (valid against the official XSD), `test/gl-export.test.ts` | [Example export](iso20022/pacs008-BTX-2026-11.xml) from the recorded run |

## Keys and operations

| Risk | Control | Enforced by | Test | Evidence (live run, or red team on stand-ins) |
|---|---|---|---|---|
| An agent's key leaks | Principals: revoke, expire, rotate; a revoked agent's card freezes | Code, Airwallex | `test/principals.test.ts` | Red team on stand-ins: a revoked agent and an old key refused |
| A secret ends up in git, a log or a model | Redaction of the RPC credential, a secret scan before each commit, gitleaks on all history, no key ever sent to a model | Code, CI | `test/redact.test.ts`, `test/adversarial.test.ts` | CI on every push |
| Something is badly wrong and it is not clear what | Emergency stop: every agent payment refused, every card frozen at Airwallex | Code, Airwallex, person | `test/freeze.test.ts` | Tested on stand-ins; `CARD_INACTIVE` checked live on one card |
| The runner crashes in the middle of a payment | Step log per action; resume from the last finished step; lookups by request id | Code | `test/chaos-kill.test.ts` (16 kill points), `test/chaos.test.ts` | |
| Load: many small payments | Metal clearing: one receipt per payment, no transaction per payment | Chain | `test/clearing.test.ts` | Clearing load test ([run](runs/2026-10-30-clearing-load.md)): 2,000 of 2,000 paid, 4.24 a second, about $0.0007 RPC per payment |

## Not covered (known)

- **No pager is connected to `/health`.**
- **The emergency stop has not been pulled live end to end.**
- **The BLS signature in finality certificates is not verified:** Metal has not published testnet's validator keys.
- **The compliance key is fixed per contract:** rotating it means a new contract.
- **Northwind's own account in the recorded run is one-owner.** The 2-of-2 ran in a test world.
- **Mandate payments bypass the compliance send policy** (Metal's design). Agents' mandates keep their own on-chain
  limits.

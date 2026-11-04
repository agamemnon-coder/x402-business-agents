# Controls (SOC 2 style)

What Purser has in place, written the way an auditor reads controls: each control, how it works, and its evidence (a
file, a test, a run log). Only what is true on 2 November 2026 (`build/next`). Anything not in place, or only partly, is
marked 🟠 with what is missing. This is not a SOC 2 report: no auditor has tested these controls, and the build runs
on the Airwallex sandbox and Metal testnet only.

The risks behind the controls: [controls-matrix.md](controls-matrix.md). The threat model: [security.md](security.md).
What to do when a control fires: [runbook.md](runbook.md).

Marks: ✅ in place, with evidence. 🟠 not in place, or only partly.

## CC6 Logical access

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| A1 | Money moves beyond the limits only with the CFO's passkey | A proposal binds the SHA-256 of its exact terms; the CFO signs that hash with a passkey on the phone; user verification (Face ID) is required and checked; the runner verifies the signature and the hash before executing; an approval is single use and expires | `src/passkey/webauthn.ts` (`requireUserVerification: true`), `src/policy/approvals.ts`, `test/passkey.test.ts`, `test/approvals.test.ts`, `test/adversarial.test.ts`; every live run log in `docs/runs/` | ✅ |
| A2 | Four eyes above a threshold | Above the CFO's threshold, two different people's passkeys; the proposer never approves; one rejection stops it; `npm run verify` re-checks both signatures. On chain, a 2-of-2 Metal account for mandate changes | `test/four-eyes.test.ts`, `test/four-eyes-onchain.test.ts`, [four-eyes run](runs/2026-10-30-four-eyes.md) | 🟠 Off in the recorded run; Northwind's own account in the recorded run has one owner (D18: not before Thursday) |
| A3 | MFA for the CFO's dashboard actions | D20: the viewer link only reads and its key changes every ISO week; policy changes, policy in words and Ask Purser need a passkey session (WebAuthn verified by the Worker, a hashed 12-hour `HttpOnly; Secure; SameSite=Strict` cookie) | `worker/src/webauthn.ts`, `test/relay-mfa.test.ts`, `test/worker-webauthn.test.ts`, [decisions.md D20](decisions.md) | 🟠 Behind `MFA_SESSIONS=on` / `KIT11_MFA=on`; per [security.md](security.md) row 31 not yet on the hosted relay (needs Max's redeploy) |
| A4 | Passkey enrolment needs a person on the runner | A new passkey counts only after the person on the runner confirms its 64-bit fingerprint; five tries per enrolment code | `test/passkey.test.ts`, `test/passkey-ledger.test.ts`, `test/relay-worker.test.ts` | ✅ (enrolment trusts the page served at that moment: [security.md](security.md) row 13b) |
| A5 | Each agent has its own identity and least privilege | Per-agent mandate on chain (cap, budget, payee, expiry), per-agent card limits at Airwallex; agents never hold an owner key; principals can be revoked, expired or rotated, which freezes the agent's card | `test/principals.test.ts`, `test/no-owner-key.test.ts`, `test/cards.test.ts`, `test/executors-mandate.test.ts` | ✅ |
| A6 | Models hold no credential | Claude gets text only: no key, URL or tool that moves money; every prompt and tool result is redacted | `test/adversarial.test.ts`, `test/redact.test.ts`, `src/lib/redact.ts` | ✅ |
| A7 | Local servers answer this machine only | The dashboard and approvals servers refuse any Host but loopback (DNS rebinding) and any cross-origin post | `test/security-headers.test.ts`, `test/approvals-page.test.ts` | ✅ |
| A8 | Least-privilege Airwallex key | A scoped key with Read or Write per resource, listed per endpoint | [airwallex.md, the scoped key](airwallex.md#the-scoped-key) | 🟠 The table is ready; whether the running key is that scoped key is not recorded in the repo. No IP allowlist (sandbox) |
| A9 | A fixed Airwallex API version | — | `src/airwallex/client.ts` sends no `x-api-version`; the kit asks to leave it off FX calls ([requirements-matrix.md](requirements-matrix.md) K8-api) and the account's default version is not exposed ([s3 run](runs/2026-10-29-s3.md), item 6) | 🟠 Not pinned: a change of the account's default version could change response shapes; the contract tests would not see it (they replay documented shapes). Webhooks are pinned (2025-11-11) |

## CC7 System operations: audit trail and monitoring

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| L1 | Append-only, hash-chained audit log | `row_hash = SHA-256(prev_hash ‖ JCS(row))`; the database refuses UPDATE and DELETE (triggers); `npm run verify` and `npm run verify-log -- --anchor` detect edits and truncation after a published anchor | `src/audit/log.ts`, `src/db/schema.sql`, `test/audit.test.ts`, `test/audit-report.test.ts`, [audit report](audit-report-rehearsal-3.pdf) | ✅ 🟠 Anchors are not signed: whoever can write the SQLite file can append rows after the last published anchor ([security.md](security.md), accepted risks) |
| L2 | Who decided each money movement (D24) | Every money event records its origin when the action starts; a missing origin is an error; a run with one is blocked | `src/provenance/origin.ts`, `src/provenance/check.ts`, `test/origin-doors.test.ts`, `test/origin-check.test.ts`, [dry-118](runs/2026-11-01-dry-118-origins.md) | ✅ |
| L3 | Reconciliation with the outside services | Hourly: each Airwallex transfer and card transaction and each Metal payment's receipt by id and amount; each payout row without a transfer id (never answered, or closed as refused at create) looked up by its `request_id` (since 2 November); a difference is an alarm | `src/finance/reconcile.ts`, `test/reconcile.test.ts` | ✅ |
| L4 | Monitoring and alarms | `/health/live` (relay) and `/health` (local) answer 503 while any alarm stands (emergency stop, velocity stop, reconciliation difference or stale, stuck action, stale hold, Airwallex disagreement, pause not revoked) or the runner stopped syncing; the relay's public `/health` is the same during a live run and says "Recorded demo · the live runner runs during live runs" (200) between live runs; `/metrics` for a scraper | `src/ops/health.ts`, `src/ops/publicHealth.ts`, `test/health.test.ts` | ✅ 🟠 No pager or uptime monitor is connected to `/health/live` |
| L5 | Service levels | System health (`/system-health`, local): 99% of decisions under 10 s, 0 double payments, 0 missing origin, fallbacks under 10%, audit chain and finality certificates intact; per run and per agent with a trace per decision | `src/dashboard/health.ts`, `test/system-health.test.ts` | ✅ 🟠 Computed on request only: nothing alerts when an objective is missed |
| L6 | Finality evidence per transaction | Metal's finality certificate stored per transaction; header, number and quorum checked | `src/metal/finality.ts`, `test/finality.test.ts` | ✅ 🟠 The BLS signature is not verified (Metal has not published testnet's validator keys) |
| L7 | Contract tests against the providers | Every Airwallex and Metal call against its documented request, response and error codes | `test/contract/*.test.ts` | ✅ (offline; they do not detect a provider changing its API without changing its docs) |

## CC8 Change management

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| C1 | Every push is built and tested | CI: type check, lint, the full suite with coverage floors of 90% per area (money, policy, passkey, executors, relay, clearing), the relay Worker's type check, the juror's first run (`npm run judge -- --check`), browser checks | `.github/workflows/ci.yml`, `test/coverage-areas.ts`, [hardening.md](hardening.md) | ✅ |
| C2 | Supply chain | Every dependency pinned to an exact version; `npm audit` for the root and the Worker in CI; an SBOM (CycloneDX) regenerated in CI | `package.json`, `worker/package.json`, [security/README.md](security/README.md), `.github/workflows/ci.yml` (Semgrep pinned, blocking since 2 November: any finding, or no rules loaded, fails CI) | ✅ |
| C3 | Independent review of risky changes | Security reviews of 30 October and later; a fresh review of each block; money code is not changed before a live run | [hardening.md](hardening.md) (HF1 to HF13, R1 to R6), [decisions.md](decisions.md); the payout executor change of 2 November was reviewed by a fresh Opus review, which found a blocker, fixed with its probe as a test (`test/contract/airwallex.test.ts`) | 🟠 Reviews are recorded per block, not enforced per change: no CODEOWNERS, no branch protection or required review recorded in the repo |
| C4 | Code that moves money is frozen before a run | "Code that moves money is not changed before the Friday runs"; the reserve run used a pinned commit (eff08b4) | [hardening.md](hardening.md), [herstelplan](internal/herstelplan-herstart.md) | 🟠 A procedure, not a technical gate. Money code **was changed on 2 November, before the 5 November run**: the SWIFT payout executor (`src/executors/invoicePayment.ts`: a payout refused at create is closed, `duplicate_request_id` is adopted only for exactly this payout) and FX planning (`src/agents/euroBill.ts`), from the contract tests, with a review and its fixes; it goes into Thursday's code only if Max takes it |

## A1 Availability: backup, restore and recovery

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| B1 | Crash recovery without double payment | Each money action is a step log; on start the runner resumes every interrupted action from its last finished step and looks a started step up by its key; an approval given while the runner was down waits on the relay and runs once | `src/policy/saga.ts`, `test/chaos-kill.test.ts` (16 kill points), `test/resume-approved.test.ts`; dry-6 and dry-12 in the [herstelplan](internal/herstelplan-herstart.md) | 🟠 The 2 November review found a path where a resent payout could be closed as refused while Airwallex had paid it (blocker 1). Fixed and tested in 78a761b (a resend never closes a payout; the reconciliation looks id-less rows up by `request_id`); not in the reserve run's code, and ✅ only once the fix is reviewed and taken |
| B2 | Restart plan for a container restart mid-run | Written plan: check ledger, keys and code; restart the runner; `npm run verify`; tell Max the last step; re-propose anything that expired, never force | [herstelplan-herstart.md](internal/herstelplan-herstart.md) | ✅ 🟠 Written after the container restart of the night of 1 to 2 November; not yet run as a drill during a run |
| B3 | Ledger backups | After each step a consistent copy of the ledger (SQLite online backup) to `data/snapshots/<world>/<step>.sqlite` | [herstelplan-herstart.md](internal/herstelplan-herstart.md) | 🟠 Local to the container only (Max's choice, 2 November): a new container loses the ledger and stops the run. Not automated in the runner; no restore drill recorded; no point-in-time recovery ([architecture.md](architecture.md): Postgres with PITR in production) |
| B4 | Keys survive the container | Mandate and owner keys live in a private keys repo, outside the code repo (the code refuses a keys dir inside it) | `src/metal/agentCli.ts` (`keysDir`) | ✅ 🟠 No KMS or HSM: a person with the runner machine has the agents' keys |

## Incident response

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| I1 | Written incident procedures | The emergency stop, a fake invoice, an agent misbehaving, a leaked key (per key: who rotates, how), a runaway agent, an Airwallex or Metal outage | [runbook.md](runbook.md) | ✅ |
| I2 | Emergency stop | One Face ID refuses every agent payment before signing and freezes every card at Airwallex; lifting it is a proposal and Face ID | `src/policy/rules.ts`, `src/policy/cards.ts`, `test/freeze.test.ts` | 🟠 Tested on stand-ins; `CARD_INACTIVE` checked live on one card; never pulled live end to end |
| I3 | Automatic stop of a runaway agent | Velocity limits per agent and rail; a breach stops the agent and freezes its card; a Claude cost cap per agent | `test/velocity.test.ts`, `test/claude-cost.test.ts` | ✅ 🟠 Not yet triggered live |
| I4 | Pause one agent | `npm run pause`: Purser refuses it at once and revokes its mandate on chain; the alarm stands until the chain agrees | `src/policy/pause.ts`, `src/metal/pauseChain.ts`, `test/agent-pause.test.ts` | ✅ |

## Secrets management

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| S1 | Secrets live outside the code | The Airwallex key, Metal RPC URL, Anthropic key, Cloudflare token and relay token in the environment; keys in the private keys repo; webhook secrets in the keys dir and the Worker's secrets | [security.md](security.md) (what we protect), `.env.example` | ✅ |
| S2 | No secret in git, a log or a model | Redaction of every logged line and audit row; gitleaks on the pushed commits and the whole history in CI; no key ever sent to a model | `src/lib/redact.ts`, `test/redact.test.ts`, `test/adversarial.test.ts`, `.github/workflows/ci.yml` | ✅ 🟠 The value scan before each commit is a procedure, not a hook in the repo |
| S3 | Rotation per secret | A table per key: where it lives, how to rotate, who | [runbook.md](runbook.md) (a leaked key) | 🟠 Exercised live: the webhook secret, mandate revoke (test world). Not yet exercised: the Airwallex API key, the relay token, the Metal RPC credential, the owner key, the compliance key |

## Data retention

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| D1 | The ledger keeps everything | One SQLite file per world; the audit log is append-only and never deleted; card numbers and CVVs are never requested, so never stored | `src/db/schema.sql`, [airwallex.md](airwallex.md) | ✅ |
| D2 | The relay keeps little, briefly | Webhook events 24 hours (at most 500), answered tickets 1 hour, queued items 30 minutes, rate-limit hits 10 minutes, passkey sessions 12 hours; no amounts or names on the public `/health` | `worker/src/core.ts` (`HOOK_KEEP_MS`, `ANSWERED_KEEP_MS`, `QUEUED_KEEP_MS`, `RATE_WINDOW_MS`), `test/relay-worker.test.ts` | ✅ |
| D3 | A retention period and deletion procedure for the ledger | — | — | 🟠 None written. The ledger holds cardholder emails and names (fictional in this build), supplier bank details as read from invoices and every approval; there is no period after which they are deleted or archived, and no procedure for a deletion request |

## Not in place (summary)

🟠 A2 four eyes off on the business account · A3 MFA sessions not on the hosted relay · A8 scoped key not recorded, no
IP allowlist · L1 anchors unsigned · L4 no pager · L5 no alerting on missed SLOs · L6 BLS signature not verified ·
A9 API version not pinned · B1 the resent-payout fix awaits review · C3 no enforced review per change · C4 money code changed on 2 November, before Thursday · B2 restart plan not drilled · B3 backups local only, no restore drill · B4 no KMS/HSM · I2
emergency stop never pulled live · I3 velocity stop not triggered live · S2 pre-commit scan by procedure · S3 most
rotations not exercised · D3 no retention period or deletion procedure. Also open from the headers check: the local
approvals page's CSP allows `'unsafe-inline'` ([security.md](security.md#security-headers-and-rate-limits-checked-2-november)).

## Guards in code

*Moved here from the README (4 November).*

The limits that hold money back, where each lives and which test asserts it. Numbers are in
[src/config/policy.ts](../src/config/policy.ts); Claude never sets one. "No test" means no test asserts that rule
(searched, not assumed). Tests run on stand-ins for Airwallex and Metal; where the real service enforces the rule,
the row says so, and the live proof is the [sandbox run](../README.md#the-main-run-3-november).

| Rule | Where in code | Test |
|---|---|---|
| **EUR reserve floor, at plan.** No plan when free EUR (available minus floor, commitments and payouts under way) is below zero | [`planInvoice`](../src/policy/treasury.ts) (`underfunded`); [`proposeInvoicePayment`](../src/agents/euroBill.ts) escalates | [policy.test.ts](../test/policy.test.ts) ("makes no plan when EUR is already below its floor plus commitments"); [euroBill.test.ts](../test/euroBill.test.ts) ("escalates, and quotes nothing, when committed EUR has already been spent") |
| **EUR reserve floor, at execution.** Checked again on a fresh balance before the conversion and the payout, on a resume, and after each retry wait | [`executeInvoicePayment`](../src/executors/invoicePayment.ts) (precondition, resume check, `floorReason`) | Only the check after a retry wait is tested: [contract/airwallex.test.ts](../test/contract/airwallex.test.ts) ("after each wait the EUR floor is checked again"). The check before the conversion and the resume check: **no test** |
| **USD reserve floor, at plan.** A locked FX quote is used only if selling its USD keeps USD at or above the floor | [`checkQuoteAgainstFloor`](../src/policy/treasury.ts), called in [`proposeInvoicePayment`](../src/agents/euroBill.ts) | [policy.test.ts](../test/policy.test.ts) ("escalates when the USD side would break its floor"); [euroBill.test.ts](../test/euroBill.test.ts) (F4b: no conversion, no proposal) |
| **USD reserve floor, at execution.** Checked again before the conversion | [`executeInvoicePayment`](../src/executors/invoicePayment.ts) ("USD would now drop under its floor") | **No test** |
| **Metal mandate cap per payment.** Metal refuses a payment over the mandate's cap on chain; Purser refuses it first | On chain: Metal (live proof: the refusal tx in [Sandbox proof](../README.md#the-main-run-3-november)). Purser's pre-check: [`purserRefusal`](../src/policy/holds.ts) (via `mandateCapRefusal`), run first by `reserveSpend` | [holds.test.ts](../test/holds.test.ts) ("refuses a payment over the mandate's cap per payment", Purser's side); [let-through.test.ts](../test/let-through.test.ts) (a Metal refusal `mandate_cap_exceeded` is recorded and nothing settles; Metal is a stand-in there) |
| **CFO policy cap per payment** (`cap.<agent>`, none until the CFO sets one) | [`capRefusal`](../src/policy/rules.ts) | [executors-refunds.test.ts](../test/executors-refunds.test.ts) ("checks the CFO policy's per-refund limit before signing"); [policy-rules.test.ts](../test/policy-rules.test.ts) |
| **Airwallex card limit per purchase** (default EUR 30.00 for Sourcing). Set on the card from the CFO policy; Airwallex itself declines the rest | [`cardLimits`](../src/policy/rules.ts); [`syncOne` / `syncCards`](../src/policy/cards.ts) | [cards.test.ts](../test/cards.test.ts) ("syncs every card on demand": the card's limits follow the policy; the 45.00 purchase over a 30.00 limit is declined `LIMIT_EXCEEDED` by the Airwallex stand-in). The real decline is in the live record, not in a test |
| **Refunds: at most 0.10 each and 0.20 per dispute on their own**; above either, a proposal for Face ID | [`routeRefundBatch`](../src/policy/refunds.ts) (shared rule in [examples/metal-dispute-desk/src/refunds.ts](../examples/metal-dispute-desk/src/refunds.ts)); limits `REFUND_AUTO_*` in config, `approval.refund_each` / `approval.refund_per_dispute` in [rules.ts](../src/policy/rules.ts); used by [`openDisputeCase`](../src/seller/desk.ts) | [refunds.test.ts](../examples/metal-dispute-desk/test/refunds.test.ts) (one refund of 0.11 and a 0.25 batch go to a person); [dispute-case.test.ts](../test/dispute-case.test.ts) ("proposes a refund above the limits for Face ID": nothing paid); [policy-rules.test.ts](../test/policy-rules.test.ts) |
| **Licence payout fee: EUR 20.00 ceiling.** The plan reserves it before converting; a fee above it is flagged. Airwallex does not quote the fee in advance, so a higher fee is recorded as `transfer.fee_over_ceiling`, not blocked | `SWIFT_FEE_MAX_EUR_CENTS` in config; [`planInvoice`](../src/policy/treasury.ts); [`feeWithinCeiling`](../src/executors/invoicePayment.ts) | [swift-fee-reserve.test.ts](../test/swift-fee-reserve.test.ts) (reserve and flag); [euroBill.test.ts](../test/euroBill.test.ts) ("converts only the 370.00 shortfall (fee ceiling 20.00)") |
| **Licence amount: exactly EUR 240.00.** Any other amount from the licensor waits for a person | `CONTRACTED_EUR_CENTS` in config; [`checkInvoice`](../src/agents/invoice.ts) | [licence-fee.test.ts](../test/licence-fee.test.ts) ("stops any other amount from the licensor for a person") |
| **Velocity, per minute and per hour.** One payment over a limit stops that agent and is not made; only Face ID lifts the stop. There is **no per-day** payment limit | [`velocityGate`](../src/policy/velocity.ts) (Metal, before signing); `velocityObserve` (card, as Airwallex reports it); limits `VELOCITY` in config | [velocity.test.ts](../test/velocity.test.ts) |
| **Per day: only Ask Purser's task cards.** Issued at once only if fewer than 3 in 24 hours (and within the EUR 300 threshold) | [`withinPolicy`](../src/agents/askPurser.ts) | [review-oct30.test.ts](../test/review-oct30.test.ts) ("issues at most 3 cards a day within the policy") |
| **Card limit per month** (default EUR 100.00 for Sourcing). Set on the card; Airwallex enforces it | [`cardLimits`](../src/policy/rules.ts); [`syncOne`](../src/policy/cards.ts) | [cards.test.ts](../test/cards.test.ts) (a monthly change is synced to the card). That Airwallex declines over the month: not tested here, only in the live service |
| **Mandate budget (total per mandate) and the agents' shared total of 20.00** | [`budgetAndVelocity`](../src/policy/holds.ts) (`budget_exceeded`, `total_budget_exceeded`); on chain, the mandate's budget | [holds.test.ts](../test/holds.test.ts) ("refuses what would go over it", "keeps all agents together under the shared total") |
| **Duplicate invoice.** Refused at plan (also for a cosmetically different number), and again inside the filing transaction and before any conversion | [`invoiceAlreadyHandled`](../src/agents/euroBill.ts) and `invoiceKey`; the same check as the `guard` of [`createProposal`](../src/policy/approvals.ts); [`executeInvoicePayment`](../src/executors/invoicePayment.ts) (another payout for the invoice) | [invoice-duplicate-key.test.ts](../test/invoice-duplicate-key.test.ts); [euroBill.test.ts](../test/euroBill.test.ts) (second copy, one already waiting, another payout at execution); [treasury-paid-review.test.ts](../test/treasury-paid-review.test.ts) ("createProposal's guard runs inside the write", with a stub guard) |
| **Spending hold while a mandate replace is open.** No payment under a mandate that an open replace names | [`replaceHoldRefusal`](../src/policy/replaceHold.ts), run by [`purserRefusal`](../src/policy/holds.ts) and `holdBeyondCap` | [dry179-replace-hold.test.ts](../test/dry179-replace-hold.test.ts) |
| **Four eyes.** Above the CFO's threshold (`approval.four_eyes_eur`), an invoice payment, a supplier's new bank details and a mandate replace need two different people, never the proposer. Off until the CFO sets a threshold | [`fourEyes`](../src/policy/fourEyes.ts); [`decide`](../src/policy/approvals.ts) | [four-eyes.test.ts](../test/four-eyes.test.ts) |
| **Passkey only.** Once a passkey is enrolled, a typed hash prefix can only reject | [`decide`](../src/policy/approvals.ts) | [passkey-ledger.test.ts](../test/passkey-ledger.test.ts) (H1); [approvals-page.test.ts](../test/approvals-page.test.ts) |
| **The hash on the terms.** A person approves the hash of the exact terms; a wrong prefix or changed terms run nothing | [`decide`](../src/policy/approvals.ts); [`beginExecution`](../src/policy/approvals.ts) | [approvals.test.ts](../test/approvals.test.ts) ("refuses a wrong prefix", "refuses terms changed after approval") |
| **Approval expiry.** A late decision approves nothing; an approval void once the proposal expires | [`decide`](../src/policy/approvals.ts), `beginExecution`, `expireDue` | [approvals.test.ts](../test/approvals.test.ts) ("voids an approval once the proposal expires", F1, "expires stale proposals in one sweep") |
| **Block 6: spend moved since the proposal.** A mandate replace is refused if the agent's spend changed after it was proposed | [`executeMandateReplace`](../src/executors/mandateReplace.ts) ("spent moved … a new one is needed") | [executors-mandate.test.ts](../test/executors-mandate.test.ts); [dry179-sequence.test.ts](../test/dry179-sequence.test.ts) |
| **No owner keys for agents.** No agent, autonomy, Claude or /try module names an owner key; the owner's on-chain act runs only from the executor after an approved proposal | [`ownerSigner`](../src/executors/ownerSigner.ts); [`executeMandateReplace`](../src/executors/mandateReplace.ts) | [no-owner-key.test.ts](../test/no-owner-key.test.ts) |
| **Hub gate (optional, `HUB_DECISIONS_ENABLED`).** An extra gate on top of the approval, never instead of it: an approved proposal runs only when the hub says `approve` for its exact run id and Purser's check is `pass`; a run whose check is `fail` never runs; a hub `reject` closes it; an unreachable hub falls back to the Face ID approval alone, and that is recorded | [`hubGateRefusal`](../src/hub/gate.ts), called in [`beginExecution`](../src/policy/approvals.ts), which every executor calls; the hub is asked in [`consultHub`](../src/hub/consult.ts) from [`execute`](../src/executors/index.ts) | [hub-gate.test.ts](../test/hub-gate.test.ts) (check fail plus approve never runs; unreachable falls back; another world's run id is ignored; flag off unchanged); [hub-push.test.ts](../test/hub-push.test.ts) (no secret, IBAN, account number, address or personal data in the push) |
| **No threshold or amount in a prompt.** No agent prompt or tool description types in a number the policy holds; code passes such facts in | [src/config/policy.ts](../src/config/policy.ts), [src/policy/rules.ts](../src/policy/rules.ts); the prompts in src/agents, src/autonomy, src/claude | [prompt-no-thresholds.test.ts](../test/prompt-no-thresholds.test.ts) (checks the static prompt text; a value interpolated from code is a code fact) |

### What needs a person (Face ID)

 Anything beyond the limits above becomes a proposal; nothing moves until it is
approved, and the hash, expiry and passkey rules apply to every one of them:

- **Refund batches** over 0.10 a refund or 0.20 a dispute ([`refund_batch`](../src/seller/desk.ts)).
- **Mandate replacements**, which rebalance the agents' budgets within the 20.00 total
  ([`mandate_replace`](../src/agents/treasury.ts)); two people once four eyes is on.
- **Invoice payouts**, including the licence ([`invoice_payment`](../src/agents/euroBill.ts)); two people above the
  four-eyes threshold.
- **Card limit raises** ([`proposeCardRaise`](../src/agents/cardBuyer.ts), a `policy_change`; tested in
  [cards.test.ts](../test/cards.test.ts): nothing changes until it is approved and synced).
- **Policy loosening** (a higher or removed limit, a lower floor, an unblocked payee, lifting a stop). The phone can
  only tighten; a loosening is proposed on the runner and approved with Face ID
  ([`loosens`](../src/policy/rules.ts); [passkey.test.ts](../test/passkey.test.ts), N2). Also:
  [`task_card`](../src/agents/askPurser.ts) above the threshold, [`payee_change`](../src/policy/payeeChange.ts) and
  [`owners_execute`](../src/metal/ownersExecute.ts) (always two owners).

### Safety

- **Idempotent money calls.** Every Airwallex write carries a request id that is stored before the call. After a timeout
  or a lost answer, Purser looks the request id up first and adopts what it finds; it never sends blind a second time
  ([src/executors/invoicePayment.ts](../src/executors/invoicePayment.ts), the `transfers` table;
  [contract/airwallex.test.ts](../test/contract/airwallex.test.ts): "a lost answer, then duplicate_request_id on the resend:
  the existing transfer is adopted, paid exactly once").
- **Audit chain.** The audit log is append-only (the database refuses updates and deletes) and hash-chained: each row
  holds the hash of the one before. `npm run verify` recomputes the chain from the genesis hash and re-checks every
  passkey approval, credential and pull; `npm run verify-log` checks an exported log
  ([src/audit/log.ts](../src/audit/log.ts), [src/cli/verify.ts](../src/cli/verify.ts); [audit.test.ts](../test/audit.test.ts)).
- **Reconciliation.** Each Airwallex transfer and card transaction and each Metal payment is checked against the ledger
  by id and amount, every hour while the runner runs; a difference is an audit row and an alarm, and nothing is fixed
  automatically (`npm run reconcile`; [reconcile.test.ts](../test/reconcile.test.ts)).
- **No secrets in the repository.** Keys come from environment variables only (Airwallex, Metal, Anthropic, T:0, the
  hub); error text is passed through [`redactSecrets`](../src/lib/redact.ts) before it is stored, and the hub's address
  and token are never logged.
- **Sandbox and testnet only.** The Airwallex client refuses any base URL but the sandbox; Metal runs on testnet. All
  money here is test money.
- **A person signs.** Face ID on the exact terms hash; a typed hash prefix can only reject once a passkey is enrolled;
  four eyes above the CFO's threshold. Second approver: a labelled test passkey in this demo. In production this is a
  second person.
- **Outside services never decide alone.** The hub can only add a "no": unreachable, it falls back to Face ID alone,
  recorded. T:0 gets the books after a payment, in the background: a failure is logged and the payment is not affected.

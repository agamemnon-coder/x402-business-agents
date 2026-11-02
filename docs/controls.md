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

## CC7 System operations: audit trail and monitoring

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| L1 | Append-only, hash-chained audit log | `row_hash = SHA-256(prev_hash ‖ JCS(row))`; the database refuses UPDATE and DELETE (triggers); `npm run verify` and `npm run verify-log -- --anchor` detect edits and truncation after a published anchor | `src/audit/log.ts`, `src/db/schema.sql`, `test/audit.test.ts`, `test/audit-report.test.ts`, [audit report](audit-report-rehearsal-3.pdf) | ✅ 🟠 Anchors are not signed: whoever can write the SQLite file can append rows after the last published anchor ([security.md](security.md), accepted risks) |
| L2 | Who decided each money movement (D24) | Every money event records its origin when the action starts; a missing origin is an error; a run with one is blocked | `src/provenance/origin.ts`, `src/provenance/check.ts`, `test/origin-doors.test.ts`, `test/origin-check.test.ts`, [dry-118](runs/2026-11-01-dry-118-origins.md) | ✅ |
| L3 | Reconciliation with the outside services | Hourly: each Airwallex transfer and card transaction and each Metal payment's receipt by id and amount; a difference is an alarm | `src/finance/reconcile.ts`, `test/reconcile.test.ts` | ✅ |
| L4 | Monitoring and alarms | `/health` answers 503 while any alarm stands (emergency stop, velocity stop, reconciliation difference or stale, stuck action, stale hold, Airwallex disagreement, pause not revoked); `/metrics` for a scraper | `src/ops/health.ts`, `test/health.test.ts` | ✅ 🟠 No pager or uptime monitor is connected to `/health` |
| L5 | Service levels | System health (`/system-health`, local): 99% of decisions under 10 s, 0 double payments, 0 missing origin, fallbacks under 10%, audit chain and finality certificates intact; per run and per agent with a trace per decision | `src/dashboard/health.ts`, `test/system-health.test.ts` | ✅ 🟠 Computed on request only: nothing alerts when an objective is missed |
| L6 | Finality evidence per transaction | Metal's finality certificate stored per transaction; header, number and quorum checked | `src/metal/finality.ts`, `test/finality.test.ts` | ✅ 🟠 The BLS signature is not verified (Metal has not published testnet's validator keys) |
| L7 | Contract tests against the providers | Every Airwallex and Metal call against its documented request, response and error codes | `test/contract/*.test.ts` | ✅ (offline; they do not detect a provider changing its API without changing its docs) |

## CC8 Change management

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| C1 | Every push is built and tested | CI: type check, lint, the full suite with coverage floors of 90% per area (money, policy, passkey, executors, relay, clearing), the relay Worker's type check, the juror's first run (`npm run judge -- --check`), browser checks | `.github/workflows/ci.yml`, `test/coverage-areas.ts`, [hardening.md](hardening.md) | ✅ |
| C2 | Supply chain | Every dependency pinned to an exact version; `npm audit` for the root and the Worker in CI; an SBOM (CycloneDX) regenerated in CI | `package.json`, `worker/package.json`, [security/README.md](security/README.md) | ✅ 🟠 Semgrep runs non-blocking until its first findings are triaged |
| C3 | Independent review of risky changes | Security reviews of 30 October and later; a fresh review of each block; money code is not changed before a live run | [hardening.md](hardening.md) (HF1 to HF13, R1 to R6), [decisions.md](decisions.md) | 🟠 Reviews are recorded per block, not enforced per change: no CODEOWNERS, no branch protection or required review recorded in the repo |
| C4 | Code that moves money is frozen before a run | "Code that moves money is not changed before the Friday runs"; the reserve run used a pinned commit (eff08b4) | [hardening.md](hardening.md), [herstelplan](runs/herstelplan-herstart.md) | ✅ (a procedure, not a technical gate) |

## A1 Availability: backup, restore and recovery

| # | Control | How it works | Evidence | Status |
|---|---|---|---|---|
| B1 | Crash recovery without double payment | Each money action is a step log; on start the runner resumes every interrupted action from its last finished step and looks a started step up by its key; an approval given while the runner was down waits on the relay and runs once | `src/policy/saga.ts`, `test/chaos-kill.test.ts` (16 kill points), `test/resume-approved.test.ts`; dry-6 and dry-12 in the [herstelplan](runs/herstelplan-herstart.md) | ✅ |
| B2 | Restart plan for a container restart mid-run | Written plan: check ledger, keys and code; restart the runner; `npm run verify`; tell Max the last step; re-propose anything that expired, never force | [herstelplan-herstart.md](runs/herstelplan-herstart.md) | ✅ 🟠 Written after the container restart of the night of 1 to 2 November; not yet run as a drill during a run |
| B3 | Ledger backups | After each step a consistent copy of the ledger (SQLite online backup) to `data/snapshots/<world>/<step>.sqlite` | [herstelplan-herstart.md](runs/herstelplan-herstart.md) | 🟠 Local to the container only (Max's choice, 2 November): a new container loses the ledger and stops the run. Not automated in the runner; no restore drill recorded; no point-in-time recovery ([architecture.md](architecture.md): Postgres with PITR in production) |
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
IP allowlist · L1 anchors unsigned · L4 no pager · L5 no alerting on missed SLOs · L6 BLS signature not verified · C2
Semgrep non-blocking · C3 no enforced review per change · B2 restart plan not drilled · B3 backups local only, no restore drill · B4 no KMS/HSM · I2
emergency stop never pulled live · I3 velocity stop not triggered live · S2 pre-commit scan by procedure · S3 most
rotations not exercised · D3 no retention period or deletion procedure. Also open from the headers check: the local
approvals page's CSP allows `'unsafe-inline'` ([security.md](security.md#security-headers-and-rate-limits-checked-2-november)).

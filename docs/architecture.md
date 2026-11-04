# Architecture, tooling and credits

Moved from the project README. Back to the [README](../README.md).

## Security

The threat model, the attacks and what stops each one, the limits on every external call, the least-privilege
Airwallex key and the accepted risks are in [docs/security.md](security.md). `test/adversarial.test.ts` names
each attack (overspend, forged, replayed or late approval, changed terms, double payment, tampered log, invoice
fraud, injection, a key reaching a model) and proves it fails safely; CI runs it on every push, with gitleaks on
every pushed and pull-request commit.

## Agentic banking backend: what it is now, and the road to production

Purser moves money for AI agents, so its backend is held to a bank's questions: can two agents overspend a budget
together, what happens when the process dies halfway through a payment, which rule held when something was approved,
who exactly is acting, and who notices when something is wrong. This section says, per question, what the hackathon
build does today (with the code and the test that prove it), what it does not do, and what production would need.
Nothing here is a plan presented as done: "now" is in the code on this branch.

### The shape today

One **runner** process (`npm run up`) holds the ledger (one SQLite file), the agents, the executors (the only code that
moves money) and the keys. A **relay** on Cloudflare (a Worker with a SQLite Durable Object) is the runner's public
face: the dashboard, the CFO's phone pages and Airwallex's webhooks reach it; it stores what the runner pushes and
queues what the phone submits, and it can refuse but never approve or pay. Money moves on two rails: Metal testnet
(agent mandates, `mandate pull`, x402) and the Airwallex sandbox (FX, SWIFT payouts, Issuing cards). Every decision is a
row in a hash-chained audit log; `npm run verify` re-checks it against the chain and Airwallex.

| Question | Now (hackathon) | Not now | Production path |
|---|---|---|---|
| **Concurrency: can agents together pass a limit?** | No. Every Metal payment reserves its amount first, in one exclusive SQLite transaction that checks the CFO policy cap, the mandate cap and budget, the agents' shared 20.00 total and the speed limits together (`src/policy/holds.ts`). Card limits are enforced by Airwallex itself, atomically; a card hold records the authorisation under way. `test/holds-concurrency.test.ts`: 128 reservations from 8 processes at once, no limit crossed. | One database file, so one machine. | The same reserve-then-settle logic on Postgres: a budget row per agent and per tenant locked with `SELECT … FOR UPDATE` (or SERIALIZABLE with retry), holds as rows with a partial unique index. |
| **Available money** | One definition everywhere: limit or balance − paid − pending − held (`src/policy/available.ts`): the dashboard, the sweep, the euro bill, the invoice executor (which also counts other euro payouts written but not yet at Airwallex) and the agent API. Property test over random sequences (`test/property-available.test.ts`). | Pending card clearing (authorised but not yet settled at Airwallex) is not modelled separately from approved spend. | Ledger balances per account in double entry with available/pending/held buckets, closed daily against the bank. |
| **Crash in the middle of a payment** | Each money action is a state machine (proposed → approved → executing (step n) → settled / failed / cancelled). Every outside call is a step in `money_steps`, written STARTED with its idempotency key before the call and DONE after (an outbox). On start the runner releases or settles holds and resumes every action left executing; a started step is looked up by its key (an Airwallex conversion or transfer by request_id, a Metal pull by payment id), never resent blind (`src/policy/saga.ts`). `test/chaos-kill.test.ts` SIGKILLs a worker after the quote, around the conversion, the transfer and its settlement, inside a refund batch and inside a sweep: each time a fresh process finishes the action, Airwallex and the chain saw every payment once, and the ledger reconciles. | No separate queue or worker pool: the runner executes in-process, one action at a time per proposal. No backoff schedule or dead-letter queue: a step that keeps failing leaves the action executing, and the `action_stuck` alarm fires. | Transactional outbox table → a queue (SQS, Pub/Sub or Kafka) → stateless idempotent workers; per-step retry with backoff; dead-letter queue with an alarm and a person to resolve it. |
| **Which rule held?** | Every distinct CFO policy is a numbered version stored whole with its hash (`src/policy/versions.ts`). Each proposal, approval and hold records the version it was made under; the audit log records what changed between versions; `npm run verify` shows the version behind every approval and fails if a stored version no longer hashes to itself. | Only the CFO policy is versioned; the code's own constants (`src/config/policy.ts`) are versioned by git, not in the ledger. | The same, with policies as signed documents (the CFO's passkey signs each version) and the code release recorded with each decision. |
| **Who is acting?** | Each agent is a principal with scoped capabilities: tools, rails, currencies and kinds of payee (`src/policy/principals.ts`). Every payment path asks it first; the agent API checks the tool and the agent's current key. A principal can be revoked at once (its card freezes at the next sync; the others carry on), can expire (only sooner without the CFO), and an outside agent's key can be rotated (0600 key file, hash only in the ledger). `test/principals.test.ts`, red team attack `revoked-agent`. `npm run principals`. | The internal agents share the runner's process and keys directory: their identity separates what they may do, not where their keys live. Reinstating a revoked agent is not built (it would be a loosening, for the CFO's Face ID). | Workload identity per agent (SPIFFE, or OAuth 2 client credentials with short-lived tokens) and a signing key per agent in a KMS whose policy only that identity can use. |
| **Keys** | The Metal account and mandate keys are files in a private keys repository, read by the `metal-agent` CLI; the Airwallex key and the relay token are environment variables; nothing secret reaches git, a log or a model (secret scan before every commit, redaction of every logged line, `docs/security.md`). The CFO's approval key is a passkey on the phone: the private key never leaves its secure element. | No KMS or HSM. A person with the runner machine has the agents' keys. | Agent signing keys in a KMS or HSM (AWS KMS / CloudHSM, Google Cloud KMS), never on disk; or MPC wallets; key use logged by the KMS; rotation on a schedule. The passkey approval stays as it is. |
| **Ledger and audit** | SQLite with exclusive write transactions; an append-only, hash-chained audit log (`src/audit/log.ts`); verify re-derives the chain and checks it against anchors (a row's number and hash printed earlier in audit reports and run logs). | One file, backed up by copying. | Postgres with point-in-time recovery; the audit log in append-only (WORM) storage, its head anchored somewhere outside (on chain, or a timestamping service) on a schedule. |
| **High availability** | The relay is on Cloudflare's network. The runner is one process; `npm run up` restarts it after a crash, and it resumes from the step log. While it is down nothing executes; the phone's submissions wait at the relay. | No second runner; the runner is a single point of failure (honestly: by design for a demo on one laptop). | Two or more runners in different zones with one leader (a Postgres advisory lock), or stateless queue consumers; multi-zone database. |
| **Multi-tenant** | One company per ledger (Northwind Outdoor); a fresh world is a fresh ledger file and its own keys folder. | No tenant id, no isolation between companies inside one database. | A tenant id on every row with row-level security, per-tenant KMS keys, per-tenant policy versions, and isolation tests. |
| **Monitoring and alarms** | `src/ops/health.ts`: alarms for the emergency stop, a speed-limit stop, a reconciliation difference or a reconciliation that stopped, an action executing over ten minutes, and a hold open over an hour; metrics (approvals waiting, actions executing, holds, stops, policy version, revoked principals). The runner logs each alarm when raised and cleared. The relay's public `/health` answers 503 while any alarm stands, or when the runner has not synced for two minutes (`runner_down`), with codes only, no amounts or names. Locally `/health` and Prometheus `/metrics`. `test/health.test.ts`. | No pager is connected: an uptime monitor still has to be pointed at `/health`, and nothing posts to Slack or sends a message (that needs Max's go). No tracing. | Prometheus and Alertmanager (or a hosted equivalent) paging on-call; SLOs on approval and payment latency; OpenTelemetry traces across runner, relay and the outside calls; logs shipped with the same redaction. |
| **Approvals: delegation and escalation** | One CFO with a passkey; above a set amount, four eyes (a second person's passkey, E1). Each proposal has a time limit and expires (nothing is paid); Opus advises, code checks, the person decides. When Opus advises rejecting, approving needs a deliberate second step. | No delegation (a deputy while the CFO is away), no escalation chain on timeout, no out-of-office. An expired proposal is made again, not escalated. | Approval rules per amount and kind with roles; time-bound delegation signed by the delegator's passkey; escalation to the next approver before a deadline; all of it versioned with the policy. |
| **Reconciliation** | A light reconciliation, run by the runner, checks every money movement against the system that moved it, by id and amount: Airwallex transfers, card transactions both ways, and each Metal sale, purchase, refund and sweep against its on-chain receipt. Every difference is an alarm (`src/finance/reconcile.ts`). | Not continuous; no formal period close. | Continuous three-way reconciliation (ledger, bank, chain) with a daily close and sign-off. |

What stays test money: Metal testnet and the Airwallex sandbox (deposits from the sweep are simulated, labelled so).
The compliance view is in [docs/compliance.md](compliance.md), the threat model in [docs/security.md](security.md).

## Code map

| Part | Where |
|---|---|
| Money and approval hash | `src/lib/money.ts`, `src/lib/terms.ts` |
| Policy and approvals (CFO policy: `src/policy/rules.ts`, `src/executors/policyChange.ts`) | `src/config/policy.ts`, `src/policy/` |
| Ledger and audit log | `src/db/schema.sql`, `src/audit/log.ts` |
| x402 seller and supplier | `src/servers/seller.ts`, `src/servers/supplier.ts` |
| Agents | `src/agents/` (sourcing, customer, treasury, disputes, sweep, invoice, euro bill) |
| Executors (the only code that moves money) | `src/executors/` |
| Metal | `src/metal/` (metal-agent CLI wrapper, mandate loading, x402 payments, chain reads, clearing) |
| Airwallex | `src/airwallex/` (client, port, REST adapter, Issuing, webhooks); fakes for tests in `test/fakes/` |
| Company cards | `src/policy/cards.ts` (issue, sync, record), `src/agents/cardBuyer.ts`, `src/policy/cardHooks.ts`, `src/cli/cards.ts` |
| Claude | `src/claude/` |
| Approval page (laptop, typed hash prefix) | `src/servers/approvals.ts` |
| Passkeys (enrolment, verification, offline re-check) | `src/passkey/` |
| Phone pages (approve, enrol) | `src/approve/` |
| Relay: runner side, Worker | `src/relay/`, `worker/` |
| Dashboard (read-only) | `src/dashboard/snapshot.ts`, `src/dashboard/page.html`, `src/servers/dashboard.ts` |
| Month simulation and replay | `src/sim/month.ts`, `src/dashboard/month.html` |
| Holds, availability, step log, policy versions, principals | `src/policy/holds.ts`, `src/policy/available.ts`, `src/policy/saga.ts`, `src/policy/versions.ts`, `src/policy/principals.ts` |
| Monitoring | `src/ops/health.ts`, `src/ops/publicHealth.ts` |

## Tooling used

- **Metal:** `@metalntwx/metal-agent` 0.3.3 (account create, mandate credential create, bind, replace, pull,
  status, verify), `@metalntwx/metal-pay` 0.3.4 (mandate payment client, `requireSignedOffer`, `signedOfferOf`,
  `verifyMandatePayment`, `jcs`, `hashCredential`), `@metalntwx/metal-ts` 0.3.2, x402 `exact` through Metal's
  facilitator, `/settlements`, `consensus_status` for finality.
- **Airwallex sandbox REST:** login, balances, global accounts, deposit simulation, deposits, FX quotes and
  conversions, beneficiaries (validate, create), transfers (create, list by request_id, retrieve), transfer
  simulation.
- **Anthropic:** `@anthropic-ai/sdk` 1.3.0, structured outputs, server-side fallbacks.
- **Passkeys and hosting:** `@simplewebauthn/server` 14.0.3 (runner side), WebAuthn in the browser, Cloudflare
  Workers with a SQLite Durable Object, `wrangler` 4.151.0 (in `worker/`).

## Built with Claude

This project is written with Claude (Anthropic) as the developer, directed and reviewed by Max Geurtsen.

## Licence

MIT

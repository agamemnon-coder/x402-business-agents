# Architecture, tooling and credits

Moved from the project README. Back to the [README](../README.md).

## Security

The threat model, the attacks and what stops each one, the limits on every external call, the least-privilege
Airwallex key and the accepted risks are in [docs/security.md](security.md). `test/adversarial.test.ts` names
each attack (overspend, forged, replayed or late approval, changed terms, double payment, tampered log, invoice
fraud, injection, a key reaching a model) and proves it fails safely; CI runs it on every push, with gitleaks on
every pushed and pull-request commit.

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

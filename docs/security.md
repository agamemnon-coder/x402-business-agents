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
| 12 | Internet visitor | Abuse of the relay | Same-origin POSTs, size caps, per-address (IPv6 /64) and per-queue limits, five tries per enrolment code; the relay cannot approve | `test/relay-worker.test.ts` |
| 13 | Compromised Cloudflare account | Serve a page that signs other terms | The runner still executes only a waiting proposal's exact hash, verified against the pinned passkey; the worst outcome is a refused signature | README, passkey section |
| 14 | Stolen phone | Approve as the CFO | The passkey needs Face ID (user verification is required and checked); revocation means re-enrolment | `src/passkey/webauthn.ts` |
| 15 | Insider with database access | Edit or truncate the log | The database refuses updates and deletes; the hash chain detects edits; an anchor printed in the audit report detects truncation or a full rehash | `test/audit.test.ts`, `test/audit-report.test.ts`, `npm run verify-log` |
| 16 | Leaked secret | A key in git or in a model's context | No key ever goes to a model (tested); every commit is scanned for the real values; gitleaks scans the whole history in CI | `test/adversarial.test.ts`, `.github/workflows/ci.yml` |

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
  | Simulation (sandbox only) | `POST /simulation/deposit/create`, `POST /simulation/transfers/{id}/transition` | Write |

  The client refuses any base URL other than the sandbox (`src/airwallex/client.ts`). In production, an IP
  allowlist would be added as well, as Airwallex recommends
  ([API key best practices](https://www.airwallex.com/docs/developer-tools/api/api-key-best-practices)).

## Accepted risks and what is out of scope

- **zod advisory (high, memory exhaustion on oversized collections).** It sits in the zod 3 copy that the
  `@x402/*` and `@metalntwx/*` packages bring along. The fixed `@x402/*` 2.29.0 was released on 2026-10-28; we pin
  only releases at least two weeks old, so it is due on 2026-11-11. The inputs that reach that zod come from our own
  supplier, seller and facilitator. CI fails on anything critical.
- **The relay's dashboard is readable by anyone with the address.** It shows only testnet and sandbox data.
- **The *USDZ to Airwallex bridge is simulated:** a sandbox deposit references the sweep's transaction hash. The
  sandbox cannot receive stablecoins.
- **Out of scope:**
  - Airwallex's and Metal's own security;
  - the phone's operating system;
  - a compromised runner host. It holds the keys, which is why they live in a separate private repo and nowhere
    else.

## Checks

- `npm test`: the full suite, including `test/adversarial.test.ts`. CI runs it on every push, with type checks, a
  gitleaks scan of the whole history and `npm audit`.
- `npm run verify`: re-checks the chain, the mandates, the Airwallex records and every passkey signature, offline
  where it can.
- `npm run verify-log -- --anchor <seq>:<hash>`: proves the log still contains a row printed earlier.
- Before each commit, the real secret values are searched for in the diff. On 2026-10-29 the full history of the
  code, plan and keys repos was searched for every secret value. Nothing was found.

# Security requirements, design principles, hardening, input validation and cryptography

What a user can and cannot expect from Purser in terms of security, the assumptions those expectations rest on, the
secure design principles and how the code applies them, the common weaknesses and what counters each, the hardening,
the input validation and the cryptography. Written on 19 November 2026 for the OpenSSF Best Practices silver level
([openssf-silver.md](openssf-silver.md)); it points to the code and the tests rather than repeating them. The threat
model, the trust boundaries and every attack with what stops it are in [docs/security.md](../security.md); the
assurance case, invariant by invariant, is [docs/assurance.md](../assurance.md). Test money only throughout: the
Airwallex sandbox and Alta (formerly Metal) testnet.

## What you can expect (the security requirements)

| # | Requirement | Where it is enforced and tested |
|---|---|---|
| SR1 | **No payment above the CFO's limits without the CFO's passkey signature over the exact terms.** The signature is over the SHA-256 of the canonical terms (RFC 8785), and the hash is recomputed before anything runs. | [assurance.md](../assurance.md), row 1; `src/policy/approvals.ts`, `src/passkey/webauthn.ts`, `src/lib/terms.ts`; `test/approvals.test.ts`, `test/passkey.test.ts`, `test/property-terms.test.ts` |
| SR2 | **One changed cent after the signature is refused**, at payment, at booking and at tokenizing. | [assurance.md](../assurance.md), row 2; `test/one-cent-three-locks.test.ts` |
| SR3 | **No AI model can approve or pay, and no key reaches a model.** Models read text and return typed data that code checks; their tools can ask, read or propose. | [assurance.md](../assurance.md), row 5; `test/adversarial.test.ts`, `test/injection.test.ts`, `test/no-owner-key.test.ts` |
| SR4 | **The limits hold in layers that do not trust each other** (Purser's checks in code, the passkey, the rail's own limits). | [assurance.md](../assurance.md), row 3; [zero-trust.md](../zero-trust.md); `test/zero-trust.test.ts` |
| SR5 | **No double payment**: every money call carries an idempotency key, and a lost answer is resolved by that key, never by sending again. | [security.md](../security.md#limits-on-every-external-call); `test/contract/airwallex.test.ts` |
| SR6 | **A tamper-evident record**: every decision and money event is in an append-only, hash-chained audit log with its origin, anchored on chain, and can be checked offline (`npm run verify`, `npm run verify-log`). | `src/audit`, `src/anchor`, `src/provenance`; `test/origin-check.test.ts`; [security.md](../security.md), row 34 |
| SR7 | **No secret in the repository, the logs or a model's input**: gitleaks on every push and the whole history; credentials are redacted from errors and logs. | `.gitleaksignore`, CI job `secrets`; `src/lib/redact.ts`, `test/redact.test.ts` |
| SR8 | **The hosted pages resist the common web attacks**: a strict CSP on every page, HSTS, framing refused, same-origin checks on every state-changing request, rate limits. | [Hardening](#hardening) below; `test/security-headers.test.ts`, `test/cloud-security.test.ts` |

## What you cannot expect

- **Production use with real money.** Purser has run on the Airwallex sandbox and Alta testnet only. What is open
  before real money is listed in [go-live.md](../go-live.md) and in the accepted risks of
  [security.md](../security.md#accepted-risks-and-what-is-out-of-scope) (for example: the relay serves the phone's
  script, audit anchors are not signed, whoever can write the ledger file gets past Purser's own layers).
- **An outside audit.** No third-party penetration test or audit has been done; every check is the project's own.
- **Protection from a compromised runner host, phone operating system, Cloudflare account or partner.** These are
  assumptions (below), not things Purser defends against.
- **Long-term support of old versions.** Only `main` and the latest release are supported ([SECURITY.md](../../SECURITY.md),
  [releasing.md](../releasing.md)).
- **A second human reviewer.** The project has one maintainer ([GOVERNANCE.md](../../GOVERNANCE.md)); CI is the second check.

## Assumptions

1. The runner host (the machine that holds the payment keys and writes the ledger) is not compromised. Its keys live in
   a directory outside the repository (`KIT11_KEYS_DIR`) or in environment secrets.
2. The CFO's phone and its passkey store (Face ID, iCloud Keychain or an equivalent) are not compromised.
3. Node.js's and the Workers runtime's TLS and WebCrypto, `@simplewebauthn/server`, viem and the other pinned
   dependencies are correct; their versions are pinned in the lockfiles and watched by Dependabot and `npm audit`.
4. The partners (Airwallex, Alta, Anthropic, Cloudflare) enforce their own controls: Airwallex's card limits and
   transfer approvals, Alta's on-chain mandates.
5. Everything left of the runner in the trust-boundary diagram ([security.md](../security.md#trust-boundaries)) is
   untrusted: documents, model answers, visitors, outside agents, and the relay with whatever it queues.

## Secure design principles, applied

The principles of Saltzer and Schroeder, as the OpenSSF criteria name them.

| Principle | How Purser applies it |
|---|---|
| Economy of mechanism | One approval scheme for every kind of payment: the SHA-256 of canonical terms, signed by a passkey (`src/lib/terms.ts`). Money is integer cents in code and a two-decimal string in terms, never a float (`src/lib/money.ts`); terms with a JSON number are refused outright. |
| Fail-safe defaults | A payment above the limits waits for the signature and expires unsigned (`src/policy/approvals.ts`). New rails and risky features are behind switches that are off by default (`KIT11_TAP_RAIL`, `KIT11_RECYCLE`, `TRY_SIGN_ENABLED`, step-up in Cloud). The Airwallex client refuses any base URL but the sandbox's (`src/airwallex/client.ts`). Every answer that may have moved money is "in doubt", never "refused" ([security.md](../security.md), row 37). |
| Complete mediation | The executor recomputes the terms' hash and checks the stored signature before every payment, not once at approval (`beginExecution` in `src/policy/approvals.ts`); every tool call a model makes is checked by code (`src/claude/tools.ts`). |
| Open design | The code, the threat model and the verifier are public; anyone can verify a signed approval or a proof bundle offline (`npm run verify-receipt`, `npm run verify-bundle`), and nothing depends on a hidden algorithm. |
| Separation of privilege | Three layers that do not trust each other can each stop a payment (code, passkey, rail); four eyes needs two enrolled passkeys under two names (`src/policy/fourEyes.ts`). |
| Least privilege | Each agent holds only its own on-chain mandate (cap, budget, single payee, expiry); no agent can use the owner key (`test/no-owner-key.test.ts`); the Airwallex key is scoped to the endpoints the build calls; the MCP connector reads and proposes only. Details: [security.md](../security.md#least-privilege). |
| Least common mechanism | Each `/try/sign` visitor's world is its own Durable Object instance with its own tables; it never reads the relay's state, enrolled passkeys or sessions ([security.md](../security.md), row 39). |
| Psychological acceptability | Approving is one Face ID on the phone over terms shown in words; the refusal of a changed cent is shown on the same screen. |
| Defence in depth, input as data | Documents and model answers are data, never instructions ([fraud-and-injection.md](../fraud-and-injection.md), `test/injection.test.ts`). |

## Common weaknesses, and what counters each

Mapped to the OWASP Top Ten (2021); Semgrep runs the OWASP Top Ten rule set on every push, blocking (CI job
`security`, [security/README.md](README.md)), and CodeQL runs through GitHub code scanning.

| Weakness | Countered by |
|---|---|
| A01 Broken access control | Every route of Cloud's API states its auth requirement and the router enforces it; a route called with no credential is refused before it runs (`cloud/src/auth.ts`, `test/cloud-route-auth.test.ts`, `test/cloud-security.test.ts`); POSTs are same-origin only (`cloud/src/hostOrigin.ts`, `test/cloud-host-origin.test.ts`); the relay's viewer key and webhook signatures are throttled after 20 failures. |
| A02 Cryptographic failures | SHA-256, ECDSA P-256, AES-256-GCM, HMAC-SHA256; no MD5, SHA-1 or CBC ([Cryptography](#cryptography) below). |
| A03 Injection | SQL through prepared statements with every value bound as a parameter (better-sqlite3, D1, the Durable Object's SQL; what is interpolated into a statement is a column list, a table name or a run of `?` placeholders from the code itself); HTML through escaping functions (for example `esc` in `src/redesign/ui.ts`) and a CSP without `'unsafe-inline'` on the hosted pages; no shell command built from a string (`.semgrep/purser.yml`); prompt injection treated as data (`test/injection.test.ts`). |
| A04 Insecure design | The threat model with STRIDE per attack ([security.md](../security.md)), the zero-trust matrix ([zero-trust.md](../zero-trust.md)) and the red team ([redteam/report.json](../redteam/report.json)). |
| A05 Security misconfiguration | Security headers set in one place per server and asserted in tests ([Hardening](#hardening)); Actions pinned to commit SHAs with no default token permission. |
| A06 Vulnerable and outdated components | `npm audit` in CI (root and `worker/`) fails on any advisory not accepted with an expiry; Dependabot weekly; a CycloneDX bill of materials per release. |
| A07 Identification and authentication failures | Passkeys only (WebAuthn with user verification, origin, RP id and signature-counter checks); one assertion gives one session; failed sign-ins throttled (`test/cloud-security.test.ts`); step-up for sensitive settings (`cloud/src/stepUp.ts`). |
| A08 Software and data integrity failures | Hash-chained audit log anchored on chain; signed terms; release artefacts attested through Sigstore ([releasing.md](../releasing.md)); `npm ci` from the lockfile with integrity hashes. |
| A09 Logging and monitoring failures | Every money event has a recorded origin (D24, `src/provenance`); System health shows fallbacks, refusals and missing origins; credentials are redacted from logs (`test/redact.test.ts`). |
| A10 Server-side request forgery | The runner calls only configured partner hosts; the Worker's Airwallex reader allows a fixed list of methods and paths (`readAllowedUrl` in `worker/src/awxRead.ts`); no URL from a document or a model is fetched. |

## Input validation

The rule (also in [CONTRIBUTING.md](../../CONTRIBUTING.md#coding-style)): every input from outside the runner is parsed
against what is allowed before it is used, and anything else is refused with a 4xx answer or an error, never guessed at.

- **Purser Cloud's HTTP API** reads every JSON body through one function that caps its size and parses it with a zod
  schema (`body()` in `cloud/src/app.ts`); an e-mail address, a date or an id that does not fit is refused.
- **Model output and agent tool calls** are parsed with zod schemas (`src/agents/toolSchema.ts`, `src/claude/tools.ts`,
  `src/ap/*Core.ts`); an answer that does not fit is replaced by the deterministic parser's, and the event is counted.
- **The MCP server** declares each tool's input schema and parses the arguments with zod before the tool runs;
  arguments that do not fit are refused (`cloud/src/claude/mcp.ts`, `src/platform/mcpServer.ts`).
- **The relay Worker** has no zod in its bundle; it reads bodies with a byte limit (`readText`, `readJson` in
  `worker/src/core.ts`), checks each field's type, and accepts only known values where there is a list (a world change
  must be one of five ids; an Airwallex read must be one of the allowed paths).
- **Money** must be a two-decimal string (`toCents` in `src/lib/money.ts` rejects anything else, and amounts that are
  not safe integers); terms must contain no JSON number (`src/lib/terms.ts`).
- **Payees** come from an allowlist; a new IBAN is blocked until a person records the supplier's out-of-band
  confirmation and the CFO approves the change (`src/policy/payeeChange.ts`).
- **Webhooks** must carry a valid HMAC-SHA256 signature within a five-minute window.
- **Partner answers** (Airwallex, Alta, the x402 facilitator) are checked field by field against their documented
  shapes and error codes, in contract tests (`test/contract/*.test.ts`); an unknown answer that may have moved money is
  "in doubt", not success.

## Hardening

Mechanisms that make a defect less likely to become a vulnerability:

- **HTTP security headers** on every answer, set in one place per server and asserted in tests:
  - the relay Worker's pages: a per-page CSP with `default-src 'none'`, scripts and styles by hash or `'self'` (never
    `'unsafe-inline'`), `frame-ancestors 'none'` and `base-uri 'none'`; HSTS (`max-age=31536000; includeSubDomains`);
    `x-frame-options: DENY`; `x-content-type-options: nosniff`; `referrer-policy: no-referrer`; `cache-control:
    no-store`; `cross-origin-opener-policy: same-origin`; a permissions policy that allows passkeys for this site only
    and no camera, microphone, location, payment sheet or USB (`src/relay/assets.ts`, `worker/src/core.ts`);
  - its JSON answers, redirects and assets: the same, with a CSP that loads nothing;
  - Purser Cloud: the same baseline on every answer that does not set its own (`cloud/src/baseHeaders.ts`), each page
    with its own nonce CSP;
  - the runner's local pages: loopback `Host` only (against DNS rebinding), a strict CSP, `nosniff`, `no-referrer`,
    `no-store`. One known gap: the local approvals page's CSP still allows `'unsafe-inline'`
    ([security.md](../security.md#security-headers-and-rate-limits-checked-2-november)).
  Tests: `test/security-headers.test.ts`, `test/cloud-security.test.ts`, `test/security-sweep-3-2026-11-15.test.ts`; on
  a running relay, `npx tsx test/browser/headers.check.ts`.
- **Rate limits and size limits** on every public endpoint ([security.md](../security.md#security-headers-and-rate-limits-checked-2-november)).
- **Type safety as hardening:** TypeScript `strict` with `noUncheckedIndexedAccess`, no `any` (ESLint), so an
  unchecked index or a missing field is a compile error.
- **Timeouts and bounded retries** on every external call, and idempotency keys on every money call
  ([security.md](../security.md#limits-on-every-external-call)).
- **Least privilege in CI:** no default token permission; each job gets only what it needs; Actions and container
  images pinned by commit SHA and digest.

## Cryptography

| Use | Algorithm | Where |
|---|---|---|
| The approval hash over the terms | SHA-256 over RFC 8785 canonical JSON; the terms carry a schema id (`kit11.approval-terms/v1`) | `src/lib/terms.ts` |
| Passkey signatures (the CFO's approval, sign-in) | WebAuthn: ES256 (ECDSA P-256) or RS256 (RSA PKCS#1 v1.5 with SHA-256), with user verification | `src/passkey/webauthn.ts` (`ALGORITHMS = [-7, -257]`), `worker/src/webauthn.ts` |
| The runner's signature on what the relay shows the phone | ES256 | `src/relay/sign.ts` |
| Partner webhooks; Cloud's signed payloads | HMAC-SHA256, compared in constant time | `cloud/src/crypto.ts` (`hmacValid`, `sameString`) |
| OAuth tokens at rest in Cloud | AES-256-GCM, a fresh 96-bit IV per value, bound to the company, provider and field as additional data; versioned (`v1.`) | `cloud/src/sealed.ts` |
| The audit chain and its anchor | SHA-256 chain; the anchor is an Alta transaction | `src/audit`, `src/anchor` |
| On-chain keys and mandates | secp256k1 and Keccak-256, as Ethereum-compatible chains require (viem); on-chain passkey checks with the P-256 verifier | `contracts/`, `src/metal` |
| Randomness | `crypto.getRandomValues`, `crypto.randomUUID`, `randomBytes`; `Math.random` never for keys, nonces or challenges | throughout |

**No algorithm with a known serious weakness** is used by default or offered as an option: no MD5, no SHA-1, no CBC,
no key shorter than 256 bits for symmetric keys or P-256 for elliptic curves (a 19 November search found no `md5` or
`sha1` passed to `createHash`).

**Algorithm agility.** Passkey verification accepts two signature algorithms (ES256 and RS256), so an authenticator of
either kind works and one can be dropped without a format change. The terms carry a schema id and sealed tokens a
version prefix, so the hash or the cipher can be replaced by a new version beside the old one (old approvals stay
verifiable under the scheme they were signed with). What is not agile: the approval hash is SHA-256 only and the sealed
tokens AES-256-GCM only; switching either is a code change and a new schema version, not a setting. The on-chain
algorithms are fixed by the chain.

**Credentials and keys are stored apart from code, configuration, data and logs, and can be replaced without
rebuilding:**

- the runner's owner key, mandate keys and agent credentials are files in `KIT11_KEYS_DIR`, a directory that must lie
  outside the repository ([run-it.md](../run-it.md));
- API credentials (Airwallex, Alta RPC, Anthropic, Cloudflare, T:0) are environment variables (`.env` is never committed;
  `.env.example` lists names only) or Worker secrets (`wrangler secret put`), separate from `wrangler.jsonc`;
- Cloud's token-sealing key is a Worker secret (`OAUTH_TOKEN_KEY`), never in the database that holds the sealed values;
- API keys issued by Cloud are stored as SHA-256 hashes only, and their secrets never leave, not even hashed;
- every credential has a rotation procedure that needs no recompilation ([runbook.md](../runbook.md), key rotation);
  `npm run principals -- rotate <agent>` issues a new agent key into a key file and refuses the old one.

**Network communication.** Every call to a partner (Airwallex, Alta RPC, Anthropic, the x402 facilitator, T:0,
Moneybird) is HTTPS through Node's or the Workers runtime's `fetch`, which verifies the server's certificate and host
name by default, before any request header (an API key or a bearer token) is sent; no code turns verification off
(no `rejectUnauthorized: false`, no `NODE_TLS_REJECT_UNAUTHORIZED`). Node's TLS client offers TLS 1.2 and 1.3 only by
default. The hosted pages are served by Cloudflare over HTTPS with HSTS. The only plain-HTTP servers are the runner's
local pages (dashboard, approvals), which answer loopback addresses only.

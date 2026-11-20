# OWASP ASVS 4.0.3, Level 2: a self-assessment of Purser

**A self-assessment, not a certification and not an audit.** Nobody independent has verified Purser against the ASVS. It was written on 19 November 2026 by Claude (an AI model) for the maintainer, by reading this repository's code, configuration, tests and records at commit `b8fdfa1b6114` (branch `data-asvs`), with no penetration test, no TLS scan and no test against the deployed sites made for it. Updated the same day, by Claude again, on branch `asvs-fix` after the first fixes: each row that changed to Pass names where it is enforced and the test that holds it; the code is not deployed by this update. Updated again on 20 November 2026, by Claude, on branch `asvs2`: twelve more rows changed to Pass in two rounds, each with the code and the test that fails without it (listed under "Fixed since"); not deployed either. Each verdict cites where it can be checked. It is strict: where a requirement is met only in part, or only by the platform without a check recorded here, it is a **Fail**, with a fix plan. Purser moves test money only (the Airwallex sandbox, Alta testnet).

Standard: [OWASP Application Security Verification Standard 4.0.3](https://github.com/OWASP/ASVS/tree/v4.0.3/4.0) (October 2021), every requirement marked for Level 2 in its official CSV (`4.0/docs_en/OWASP Application Security Verification Standard 4.0.3-en.csv`): 259 requirements, V1 to V14. Requirement texts are OWASP's (CC BY-SA 3.0) and are not copied here: each row gives the id and a short name in our words; read the full text in the standard.

Scope: the two deployed Cloudflare Workers (the site, `kit11`, in `worker/`, and Purser Cloud's test-money deployment, `purser-try`, in `cloud/`) and the runner (`src/`) where it takes input or holds data. Pass: met, with the evidence named. Fail: not met, or not shown to be met. N/A: the feature the requirement is about does not exist in Purser (said why).

## Summary

| Chapter | Pass | Fail | N/A | Level 2 requirements |
|---|---|---|---|---|
| V1 Architecture, design and threat modelling | 32 | 4 | 2 | 38 |
| V2 Authentication | 15 | 3 | 35 | 53 |
| V3 Session management | 17 | 0 | 1 | 18 |
| V4 Access control | 8 | 1 | 0 | 9 |
| V5 Validation, sanitization and encoding | 27 | 0 | 3 | 30 |
| V6 Stored cryptography | 7 | 5 | 1 | 13 |
| V7 Error handling and logging | 12 | 0 | 0 | 12 |
| V8 Data protection | 13 | 2 | 0 | 15 |
| V9 Communication | 4 | 3 | 0 | 7 |
| V10 Malicious code | 4 | 0 | 1 | 5 |
| V11 Business logic | 7 | 1 | 0 | 8 |
| V12 Files and resources | 14 | 1 | 0 | 15 |
| V13 API and web service | 9 | 1 | 3 | 13 |
| V14 Configuration | 21 | 1 | 1 | 23 |
| **Total** | **190** | **22** | **47** | **259** |

Of the 212 requirements that apply, 190 pass and 22 fail (163 and 49 at the first assessment; the 27 closed since are listed under "Fixed since"). Most N/A are authentication mechanisms Purser does not have (passwords, one-time passwords, out-of-band codes, lookup secrets), plus GraphQL, SOAP and LDAP.

## The failures and the plan

Grouped by what would fix them, most important first for a deployment with real customer data. Each group names the requirements it closes.

- **Security event logging and alerting** (V2.5.5): tell the person whose passkey changed, not only the owners.
- **Platform admin and authentication strength** (V1.2.3, V1.2.4, V2.5.4, V4.3.1, V2.10.1): Delete the legacy shared admin token once `ADMIN_KEYS` is set (owner action), then put the platform admin behind passkeys; step-up on by default and required for admin-scope keys' sensitive routes; verify WebAuthn with a maintained library or get the verifier reviewed; short-lived, runner-bound credentials for services.
- **Edge protection and TLS** (V9.1.2, V9.1.3, V9.2.4, V11.1.4): A custom domain with minimum TLS 1.2, a recorded TLS scan (testssl.sh) and OCSP stapling checked; Cloudflare rate-limiting rules (a WAF) and Turnstile on public starts.
- **Data at rest and secrets** (V6.1.1, V6.1.3, V1.6.2, V6.4.1, V6.4.2, V6.2.4): Encrypt the runner's SQLite ledger (SQLCipher or an encrypted volume) and record a check of D1 and R2 encryption; keep the runner's keys in the OS keychain or a secret manager; a KMS for the platform signing key; an algorithm field in signed records.
- **API hygiene** (V13.3.1, V12.4.2): XSD validation for incoming XML (in the Access Point, or a vetted validator: none runs in a Worker without a large dependency); antivirus scanning of uploads.
- **Process and deployment** (V1.10.1, V14.2.2, V8.3.3): A branch ruleset with linked issues (and the threat-model check among its required checks); remove the demo's samples from a production deployment; a privacy notice and terms before real data.
- **Accepted risk** (V8.3.6): Overwriting secrets in memory is not reliably possible in a garbage-collected JavaScript runtime; secrets stay in isolates that are not shared.

### Fixed since the first assessment

Fifteen requirements closed on branch `asvs-fix` (not deployed by this change), each with its test:

- **Security event log and alarms** (V7.1.3, V7.1.4, V7.2.1, V7.2.2, V2.2.3, V8.1.4, V11.1.8): an append-only security log in each Worker (`cloud/src/securityLog.ts`, `cloud/src/securityAudit.ts`; `worker/src/core.ts`), passkey and key changes told to the owners, configurable alarms counted on `/v1/health` and `/health`. `test/cloud-security-log.test.ts`, `test/relay-security-log.test.ts`.
- **API hygiene** (V13.1.5, V13.2.5, V14.4.2, V8.3.1, V13.1.3): 415 unless JSON, JSON answers as attachments (`test/cloud-content-type.test.ts`, `test/relay-security-log.test.ts`); staged-export links good once, their signature in a header for programs (`cloud/src/exports.ts`, `test/cloud-export-links.test.ts`).
- **Browser storage and cookies** (V8.2.2, V8.2.3, V3.4.4): the Airwallex overview in sessionStorage, removed at sign-out (`test/cloud-console-storage.test.ts`); the relay's cookie `__Host-kit11_session` with `Path=/` (`test/relay-security-log.test.ts`).

Six more closed on branch `asvs2` (not deployed by this change), each with its test:

- **Logging and auditing** (V1.7.2, V8.3.5): Workers Logs on for the three Workers (`test/workers-observability.test.ts`); each read of personal or financial data a `data.access` event in the security log (`test/cloud-asvs-controls.test.ts`).
- **Keys and files** (V2.3.3, V12.1.3): a key's renewal instructions on each call in its last 14 days and to the owners 14 and 3 days before (`cloud/src/keyExpiry.ts`); a storage quota per company for uploads (`cloud/src/storageQuota.ts`). `test/cloud-asvs-controls.test.ts`.
- **Process** (V1.1.2, V1.1.3): a threat model required in every pull request and checked by a workflow; security constraints a required field of the feature request form (`test/threat-model-gate.test.ts`).

Six more closed later on branch `asvs2`, each with its test:

- **Keys and data** (V1.6.1, V1.8.2): a key-management policy after NIST SP 800-57 listing every secret the code reads (`docs/security/key-management.md`, `test/key-management-policy.test.ts`); a data classification with protection levels for all 185 tables (`docs/security/data-classification.md`, `test/data-classification.test.ts`).
- **Sessions** (V3.3.4): see and end one's sessions, in the API and in Settings (`cloud/src/sessions.ts`, `test/cloud-sessions.test.ts`).
- **Outbound** (V12.6.1): one allow rule for every address a company or client sets, checked when set and before each call (`cloud/src/egress.ts`, `test/egress-allow.test.ts`).
- **Deployment** (V1.14.4, V14.1.1): `npm run deploy` refuses unmerged or uncommitted code, stamps each Worker with its commit and checks the live health reports it (`scripts/deploy.ts`, `test/deploy-traceable.test.ts`).

Also done, without closing a requirement on its own: the platform admin as named, scoped, expiring keys (`ADMIN_KEYS`, `cloud/src/adminKeys.ts`, `test/cloud-admin-keys.test.ts`; towards V2.5.4 and V4.3.1).

**Owner actions** (never done by an agent; no value goes in a file, a chat or a commit), in `docs/runbook.md`:

1. Make a platform admin key per person and allow it: `npm run cloud:admin-key -- --id <holder>-<quarter> --scopes tenants,recovery,read,try --days 30`, then `npx wrangler secret put ADMIN_KEYS -c cloud/wrangler.try.jsonc` (and `-c cloud/wrangler.jsonc` for the product cloud).
2. Then retire the shared token: `npx wrangler secret delete ADMIN_TOKEN_SHA256 -c cloud/wrangler.try.jsonc` (and `-c cloud/wrangler.jsonc`).
3. Apply the new D1 migrations before or with the deploy (the Worker also makes the tables on first use): `npx wrangler d1 migrations apply purser-try --remote -c cloud/wrangler.try.jsonc` (and `purser-cloud -c cloud/wrangler.jsonc`), which adds `0006_security_log.sql`, `0007_export_links.sql`, `0008_storage_quota.sql` and `0009_sessions.sql`.
4. Point an uptime monitor at `GET /v1/health` and the site's `/health`, alerting when `security.alarms_24h` is above 0 (V8.1.4, V11.1.8 rely on someone being told).

## V1 Architecture, design and threat modelling

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V1.1.1 | Secure development lifecycle | Pass | SSDF map with gaps named: `docs/security/SECURITY-MAPPING.md`; CI gates (Semgrep, gitleaks, OSV, CodeQL, formal model): `.github/workflows/ci.yml`; red-team rounds recorded in `docs/redteam/`. |
| V1.1.2 | Threat modelling for every design change | Pass | Every pull request's description has a `## Threat model` section (`.github/pull_request_template.md`), and `.github/workflows/threat-model.yml` fails a pull request whose section is missing or empty, or says "None" while it changes security-sensitive code (`scripts/pr-threat-model.ts` `SENSITIVE_PATHS`: `cloud/src/auth.ts`, `src/policy/`, `worker/src/`, the wrangler configs, the workflows, ...); the script runs from the base branch and reads the description only through the environment. `test/threat-model-gate.test.ts`. The STRIDE model stays in `docs/security.md`, `docs/zero-trust.md`. The check blocks a merge once it is in the `main` ruleset's required checks (owner action, as V1.10.1); until then a pull request without a threat model shows a failed check. |
| V1.1.3 | Security constraints in user stories | Pass | A feature request is an issue form (`.github/ISSUE_TEMPLATE/feature_request.yml`) written as a user story whose "Security constraints (who must not be able to do what)" field is required, beside "What must stay true"; blank issues are off (`.github/ISSUE_TEMPLATE/config.yml`), so no feature is filed without them. `test/threat-model-gate.test.ts`. Requirements stay in `docs/security/requirements.md`. |
| V1.1.4 | Trust boundaries, components, data flows documented | Pass | `docs/security.md` (trust boundaries), `docs/architecture.md`, `docs/zero-trust.md`. |
| V1.1.5 | High-level architecture and remote services analysed | Pass | `docs/architecture.md`, `docs/security.md` (limits on every external call: Airwallex, Alta RPC, Anthropic, Cloudflare). |
| V1.1.6 | Centralised, reusable security controls | Pass | One route table with a required scope per route and one auth function (`cloud/src/app.ts` ROUTES, `cloud/src/auth.ts` `callerOf`), one tenant-scoped data layer (`cloud/src/tenant.ts`), one baseline header function (`cloud/src/baseHeaders.ts`), one injection screen (`src/policy/injection.ts`). |
| V1.1.7 | Secure coding checklist available | Pass | `docs/security/requirements.md` (requirements, principles, common weaknesses, input validation, hardening, cryptography), `.semgrep/purser.yml`, `CONTRIBUTING.md`. |
| V1.2.1 | Low-privilege OS accounts per component | N/A | The deployed parts are Cloudflare Workers and Durable Objects (isolates, no OS account to set). The runner is a local CLI run by its owner. |
| V1.2.2 | Communication between components authenticated | Pass | Worker to Worker through service bindings and named entrypoints no HTTP request reaches (`worker/src/index.ts` AwxRead, AwxFx, AwxGateway; `cloud/wrangler.try.jsonc`); runner to relay by bearer token (`worker/src/core.ts`); runner to cloud by scoped expiring keys (`cloud/src/auth.ts`); webhooks by HMAC (`src/policy/cardHooks.ts`). |
| V1.2.3 | Single vetted authentication mechanism | **Fail** | People: WebAuthn passkeys, but verified by Purser's own code (`worker/src/webauthn.ts`), tested (`test/webauthn-soundness.test.ts`, `test/worker-webauthn.test.ts`) and not independently vetted. Fix: verify with a maintained library (`@simplewebauthn/server` is already a dependency of the runner) or have the verifier reviewed externally. |
| V1.2.4 | Consistent strength on every authentication pathway | **Fail** | An admin-scope API key can make the same sensitive changes a passkey session can, and step-up (`cloud/src/stepUp.ts`) applies to sessions only and is off by default. The platform admin is now named, scoped, expiring keys (`ADMIN_KEYS`, `cloud/src/adminKeys.ts`), but a key is still one factor. Fix: step-up on by default, admin-scope keys limited to programs' routes, platform admin behind a passkey. |
| V1.4.1 | Access control enforced at trusted points | Pass | Server side only: every route's `need` is checked in `handle()` before it runs (`cloud/src/app.ts`); `test/cloud-route-auth.test.ts`. |
| V1.4.4 | Single access control mechanism | Pass | Route scope plus role (`cloud/src/auth.ts` `need`) and the tenant-scoped data layer every query goes through (`cloud/src/tenant.ts` TenantDb); `test/cloud-tenancy.test.ts`. |
| V1.4.5 | Feature or data based access control | Pass | Scopes per route, roles per person, objects scoped to the caller's company (404 for another company's object): `cloud/src/app.ts`, `cloud/src/tenant.ts`, `test/cloud-tenancy.test.ts`. |
| V1.5.1 | Input and output requirements defined | Pass | `docs/cloud.md` (Conventions; Limits on what comes in), `docs/security/requirements.md` (Input validation), zod schemas on every body (`cloud/src/app.ts` `body()`). |
| V1.5.2 | No serialization with untrusted clients | Pass | JSON only, parsed with `JSON.parse` and checked with zod; no native object serialization. |
| V1.5.3 | Input validation on a trusted layer | Pass | In the Worker (`cloud/src/app.ts` `body()`, zod) and in the runner's checks (`src/ap/checkerCore.ts`). |
| V1.5.4 | Output encoding near the interpreter | Pass | HTML escaped where it is built (`src/redesign/ui.ts` `esc`, `cloud/src/console.ts`), scripts write `textContent` only (`test/saas-status-docs.test.ts`), JSON in pages escapes `<`. |
| V1.6.1 | Key management policy and lifecycle | Pass | A written policy following NIST SP 800-57 Part 1 through roles, generation, storage and distribution, use, rotation, compromise and destruction, with an inventory of every secret: purpose, where it lives, owner and crypto-period (`docs/security/key-management.md`). `test/key-management-policy.test.ts` scans `src/`, `cloud/src/`, `worker/src/` and `scripts/` for every secret name read from the environment or declared in a Worker's env, and fails on one the policy does not list. Where the runner's storage falls short of the policy (a keychain or secret manager), V1.6.2 and V6.4.1 stay Fail. |
| V1.6.2 | Key material in a vault or API | **Fail** | Cloud secrets are Worker secrets (`wrangler secret put`, `cloud/wrangler.try.jsonc` header), but the runner reads its Airwallex and relay keys from its environment or `.env` on the owner's computer. Fix: the OS keychain or a secret manager for the runner. |
| V1.6.3 | Keys replaceable, with a process | Pass | Every API key revocable and expiring (`DELETE /v1/keys/{id}`, `KEY_MAX_DAYS`, `cloud/src/auth.ts`); Worker secrets replaced with `wrangler secret put`; leaked key steps in `docs/runbook.md`. Sealed OAuth tokens carry a version for re-sealing (`cloud/src/sealed.ts`). |
| V1.6.4 | Client-side secrets not trusted | Pass | No secret in a page protects anything: sessions are server-checked HMAC tokens (`cloud/src/auth.ts`), the CFO's approval is a passkey signature over the terms hash checked server side (`src/policy/approvals.ts`). |
| V1.7.1 | Common logging format | Pass | Purser Cloud: one JSON object per line with `ts`, `level`, `event` (`cloud/src/log.ts`); the runner's audit log is one hash-chained table (`src/audit/log.ts`). |
| V1.7.2 | Logs sent to a remote system for analysis | Pass | Workers Logs is on for all three Workers, every request kept (`observability` with `head_sampling_rate: 1` and invocation logs: `cloud/wrangler.jsonc:42`, `cloud/wrangler.try.jsonc:73`, `worker/wrangler.jsonc:24`; `test/workers-observability.test.ts`): each log line, the request lines and the `security.*` events among them, leaves the isolate for Cloudflare's log store, where it is queried. Detection and alerting: the append-only security logs (`security_log` in D1, `cloud/src/securityLog.ts`; `sec_log` in the relay, `worker/src/core.ts`) raise alarms counted on `/v1/health` and `/health` for an uptime monitor (owner action 4). The runner's audit rows reach the cloud with its sync push (`POST /v1/sync`, `audit_rows`). Takes effect at the next deploy. |
| V1.8.1 | Sensitive data identified and classified | Pass | `docs/security.md` (What we protect), `docs/cloud.md` (Privacy and retention), `cloud/src/log.ts` (fields treated as secret or personal). |
| V1.8.2 | Protection requirements per level | Pass | Four levels (Secret, Restricted, Internal, Public), each with its encryption, integrity, retention, access, logging and export requirements and where the code applies them, and every one of the 185 tables the code creates classified, with its personal, financial or credential columns named (`docs/security/data-classification.md`). `test/data-classification.test.ts` reads each `CREATE TABLE` in the D1 migrations, the runner's schema and the Workers' and runner's code (`test/support/schemaTables.ts`), and fails on an unclassified table, an unnamed column of that kind, a credential column outside Secret, or a personal or financial column rated below Restricted. Requirements not met yet name their open rows (V6.1.1, V6.1.3). |
| V1.9.1 | Communications between components encrypted | Pass | HTTPS to every outside service; Worker to Worker over service bindings inside Cloudflare (`docs/security.md`, Limits on every external call). |
| V1.9.2 | Authenticity of each side verified | Pass | TLS with the runtime's certificate validation on every outbound call; inbound webhooks checked by HMAC (`src/policy/cardHooks.ts`, `src/policy/airwallexEvents.ts`). |
| V1.10.1 | Source control with change tickets and traceability | **Fail** | Git and GitHub with pull requests, DCO sign-off (`.github/workflows/dco.yml`) and CODEOWNERS, but most commits name no issue or change ticket, and `main` has no branch ruleset yet (`docs/security/owner-actions.md`). Fix: a ruleset requiring PRs and linked issues. |
| V1.11.1 | Components documented by function | Pass | `docs/architecture.md`, `docs/cloud.md` (How it fits), `docs/agents.md`. |
| V1.11.2 | High-value flows share no unsynchronised state | Pass | One Durable Object per company serialises its engine; D1 writes checked at commit; one live payout per invoice by a unique index (`src/db/schema.sql`); `test/cloud-concurrency.test.ts`, `docs/evidence/chaos-money.md`, `docs/evidence/formal-model.md`. |
| V1.12.2 | Uploaded files served as downloads or from another origin | Pass | Documents are served with `Content-Disposition: attachment`, `nosniff` and an inert CSP (`cloud/src/app.ts`, document download routes); a PDF is drawn by pdf.js in a sandboxed frame with eval off (`cloud/src/console.ts`). |
| V1.14.1 | Segregation of components by trust | Pass | The site (kit11) and the engine (purser-try) are separate Workers with separate stores; each partner gateway is its own Durable Object instance and named entrypoint (`worker/src/index.ts`, `cloud/wrangler.try.jsonc`). |
| V1.14.2 | Signed binaries to remote devices | N/A | Purser deploys no binaries to devices. |
| V1.14.3 | Build pipeline warns of outdated or insecure components | Pass | Dependabot (`.github/dependabot.yml`), OSV-Scanner daily (`.github/workflows/osv-scanner.yml`), `npm audit` and `scripts/audit-check.ts` in CI. |
| V1.14.4 | Automated build and verified secure deployment | Pass | One deploy command, `npm run deploy` (`scripts/deploy.ts`, `docs/runbook.md` "Deploy"): it refuses a dirty tree or a commit not on `origin/main` (`scripts/deploy.ts:26` `deployRefusal`), deploys purser-try and kit11 with the commit and build time stamped in (`scripts/deploy.ts:34` `stampArgs`), and then checks each live health answer reports that commit and serves the baseline security headers, exiting non-zero otherwise (`scripts/deploy.ts:39` `liveProblems`). Both health answers carry the stamp (`cloud/src/app.ts:259`, `worker/src/core.ts:702`). `test/deploy-traceable.test.ts`. CI builds and tests every change (`.github/workflows/ci.yml`); the deploy runs on the owner's computer with their wrangler login by design, so no Cloudflare secret sits in CI. Not yet run against the live sites: they report a commit from their next deploy. |
| V1.14.5 | Deployments isolated at the network level | Pass | Workers run in Cloudflare's isolates with no network access to anything but the public internet and their bindings; the engine is a separate Worker (`cloud/wrangler.try.jsonc`). |
| V1.14.6 | No deprecated client-side technology | Pass | HTML, CSS and JavaScript only; no plugins (pages' CSP starts from `default-src 'none'`, `src/servers/dashboard.ts`). |

## V2 Authentication

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V2.1.1 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.2 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.3 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.4 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.5 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.6 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.7 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.8 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.9 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.10 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.11 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.1.12 | Password Security | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.2.1 | Anti-automation against credential attacks | Pass | Passkeys cannot be guessed; keys are 32 random bytes; failed sign-ins and signatures are limited per address (20 a minute) and sign-ins to 30 a minute (`cloud/src/app.ts` `failedAuthBlocked`, `withinRate`); `test/cloud-err-429.test.ts`, `test/cloud-security.test.ts`. |
| V2.2.2 | Weak authenticators only as secondary | Pass | No SMS or e-mail sign-in exists; approval alerts by SMS or e-mail carry no authority, the CFO approves with the passkey on Purser's page (`cloud/src/alerts.ts`). |
| V2.2.3 | Secure notifications after authenticator changes | Pass | A passkey or key added or removed is a security event the owners read (`GET /v1/security/events`) and is sent to the company's alert webhook (`tellOwners`, `cloud/src/securityAudit.ts`); `test/cloud-security-log.test.ts` ("a key made and revoked", "a passkey enrolled"). |
| V2.3.1 | Initial activation codes random and short-lived | Pass | Enrolment and invite secrets are 32 random bytes, stored as SHA-256, single use, 30 minutes (`cloud/src/auth.ts` `ENROLMENT_TTL_MS`, `startEnrolment`); `test/cloud-console-invites.test.ts`. |
| V2.3.2 | User-provided authenticators (FIDO) supported | Pass | Sign-in is a passkey (FIDO2/WebAuthn); several per person (`cloud/src/auth.ts` `enrolPasskey`); `test/cloud-auth.test.ts`. |
| V2.3.3 | Renewal instructions before time-bound authenticators expire | Pass | Every call an API key makes in its last 14 days carries a `purser-key-renewal` header with its expiry, the days left and what to do (`cloud/src/keyExpiry.ts` `renewalNotice`, set in `cloud/src/app.ts:773`); and 14 and 3 days before, the company's owners are told once each, a `key.expiring` security event in the console and an event to the alert webhook (`warnExpiringKeys`, run by the scheduled job, `cloud/src/worker.ts:190`). `test/cloud-asvs-controls.test.ts` ("renewal instructions"). Sessions last 15 minutes and are renewed by signing in. |
| V2.4.1 | Credential Storage | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.4.2 | Credential Storage | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.4.3 | Credential Storage | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.4.4 | Credential Storage | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.4.5 | Credential Storage | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.5.1 | Recovery secrets not sent in clear text | Pass | An owner recovery key is returned once over TLS to the platform admin's call, valid a day, for one enrolment of the named owner (`RECOVERY_KEY_DAYS`, `cloud/src/app.ts`); never e-mailed. |
| V2.5.2 | No password hints or secret questions | Pass | Neither exists: there are no passwords, and recovery is a recovery key, not questions (`cloud/src/auth.ts`). |
| V2.5.3 | Credential Recovery | N/A | No passwords anywhere: people sign in with a passkey (WebAuthn), programs with scoped keys (`cloud/src/auth.ts`). |
| V2.5.4 | No shared or default accounts | **Fail** | The platform admin can now be named people, each with their own scoped key that ends within 90 days (`ADMIN_KEYS`, `cloud/src/adminKeys.ts`, `test/cloud-admin-keys.test.ts`), but the shared legacy token (`ADMIN_TOKEN_SHA256`) keeps working while it is set (each use logged as `admin.legacy_token_used`), and the keys are not passkeys. Fix: the owner sets `ADMIN_KEYS` and deletes `ADMIN_TOKEN_SHA256` (`docs/runbook.md`, Platform admin keys); then passkeys for the platform admin. (The demo company's public read-only token is shared on purpose, for made-up data.) |
| V2.5.5 | User notified when an authentication factor changes | **Fail** | A passkey or key change is told to the company's owners (security events and their alert webhook, as V2.2.3), but not to the person whose passkey it was when they are not an owner, and nobody is told when no webhook is set. Fix: tell the person too (e-mail to their address on file). |
| V2.5.6 | Secure recovery mechanism | Pass | Recovery is a one-day key for one enrolment of the named owner, issued by the platform with who checked recorded, ending the owner's other passkeys and sessions (`cloud/src/auth.ts`, `cloud/src/app.ts`); `test/cloud-recovery.test.ts`. |
| V2.5.7 | Identity proofing when factors are lost | Pass | The recovery records who checked the owner's identity (`checked_by`) as a security event; the new passkey is the owner's own (`test/cloud-recovery.test.ts`). The proofing itself is a person's, outside the code. |
| V2.6.1 | Look-up Secret Verifier | N/A | No lookup secrets (recovery codes) are offered. |
| V2.6.2 | Look-up Secret Verifier | N/A | No lookup secrets are offered. |
| V2.6.3 | Look-up Secret Verifier | N/A | No lookup secrets are offered. |
| V2.7.1 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.7.2 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.7.3 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.7.4 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.7.5 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.7.6 | Out of Band Verifier | N/A | No out-of-band authenticator is offered. |
| V2.8.1 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.2 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.3 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.4 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.5 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.6 | One Time Verifier | N/A | No one-time passwords are used. |
| V2.8.7 | Biometrics only with another factor | Pass | Face ID unlocks the passkey on the device (something you have plus the biometric); the server requires user verification (`worker/src/webauthn.ts`, flag UV). |
| V2.9.1 | Cryptographic authenticator keys protected | Pass | Passkey private keys stay in the authenticator (the platform's secure element or keychain); the server holds public keys only (`cloud/src/auth.ts`). |
| V2.9.2 | Challenge nonce at least 64 bits | Pass | 32 random bytes per challenge, single use, 5 minutes (`newChallenge`, `cloud/src/auth.ts`). |
| V2.9.3 | Approved algorithms | Pass | ES256 (ECDSA P-256, SHA-256) through Web Crypto (`worker/src/webauthn.ts`). |
| V2.10.1 | Service secrets not static credentials | **Fail** | The runner reaches the relay with a static bearer token (`RELAY_TOKEN`), and Airwallex with static client id and API key; cloud sync keys are bearer keys (90 days). Fix: short-lived tokens, and bind sync keys to the runner (mTLS), as `docs/cloud.md` (Before real customer data) already lists. |
| V2.10.2 | Service Authentication | N/A | No service uses a password. |
| V2.10.3 | Service Authentication | N/A | No service uses a password. |
| V2.10.4 | Secrets not in source code | Pass | Worker secrets and environment only; gitleaks on every push and the whole history (`.github/workflows/ci.yml`, job `secrets`); `.env` git-ignored. |

## V3 Session management

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V3.1.1 | No session tokens in URLs | Pass | Sessions travel in the Authorization header (cloud) or an HttpOnly cookie (kit11); invite secrets and the viewer key after `#`, never sent to a server. (A staged-export link's browser form carries a single-use, 15-minute signature in the query: see V8.3.1.) |
| V3.2.1 | New session token at authentication | Pass | Each sign-in issues a fresh signed token (`sessionToken`, `cloud/src/auth.ts`). |
| V3.2.2 | Session tokens with at least 64 bits of entropy | Pass | Cloud: HMAC-SHA256 signed tokens with the server's secret; kit11: random session ids (`worker/src/core.ts`). |
| V3.2.3 | Tokens stored securely in the browser | Pass | Console: sessionStorage, 15 minutes, no cookie (`cloud/src/console.ts`); kit11: HttpOnly, Secure, SameSite=Strict cookie (`worker/src/core.ts`). |
| V3.2.4 | Session tokens from approved algorithms | Pass | HMAC-SHA256 over the session's payload; `crypto.getRandomValues` (`cloud/src/crypto.ts`). |
| V3.3.1 | Logout and expiry invalidate the session | Pass | Sign-out increments the person's `session_gen`, so every token issued before is refused; tokens expire in 15 minutes (`cloud/src/auth.ts` `fromSession`, `endSessions`); `test/cloud-auth.test.ts`. |
| V3.3.2 | Periodic re-authentication | Pass | A console session lasts 15 minutes, then the passkey again (`SESSION_TTL_MS`); kit11 sessions 12 hours (`worker/src/core.ts`). |
| V3.3.3 | Session Termination | N/A | No passwords. (Removing a passkey ends that person's sessions: `test/cloud-passkey-remove-race.test.ts`.) |
| V3.3.4 | View and end active sessions | Pass | Each passkey sign-in is a recorded session (when, until when, the browser, the network; never the token) whose id rides in the signed token (`cloud/src/auth.ts:272`); `GET /v1/sessions` lists the person's live sessions and `DELETE /v1/sessions/{id}` ends one, which stops that token at once while the others keep working (`cloud/src/auth.ts:183`, `cloud/src/app.ts:492-500`, `cloud/src/sessions.ts`); Settings shows them with an End button each (`cloud/src/console.ts:1281`); sign-out ends them all. An end is an `access.change` security event. `test/cloud-sessions.test.ts`. Ending one asks for the passkey again only when the company has "Ask again before sensitive changes" on (V1.2.4); the demo's guest and visitor sessions are not listed. |
| V3.4.1 | Cookie Secure | Pass | `kit11_session`: `Secure` (`worker/src/core.ts`). Purser Cloud sets no cookie. |
| V3.4.2 | Cookie HttpOnly | Pass | `kit11_session`: `HttpOnly` (`worker/src/core.ts`). |
| V3.4.3 | Cookie SameSite | Pass | `kit11_session`: `SameSite=Strict` (`worker/src/core.ts`). |
| V3.4.4 | Cookie `__Host-` prefix | Pass | The relay's passkey session cookie is `__Host-kit11_session`: `Secure`, `Path=/`, no `Domain` (`worker/src/core.ts`); `test/relay-security-log.test.ts` ("the passkey session's cookie"). The cloud uses no cookie. |
| V3.4.5 | Cookie path scoped | Pass | `Path=/api`; `workers.dev` is on the public suffix list, so no other Worker's host shares the cookie. |
| V3.5.1 | Users can revoke OAuth tokens | Pass | A Claude connector is revoked with `DELETE /v1/claude/connectors/{id}` (tested: `test/cloud-claude.test.ts`, "ends when its token is revoked"); an OAuth access token issued for it is checked against its live key on every use (`fromAccessToken`, `cloud/src/auth.ts`), so it ends too (by code reading; no test of that path). |
| V3.5.2 | Session tokens, not static keys, for users | Pass | People use passkey sessions; only programs use scoped, expiring, revocable keys (`cloud/src/auth.ts`). |
| V3.5.3 | Stateless tokens protected against tampering and replay | Pass | HMAC-signed payload with expiry, checked against the person's role and session generation on every request (`fromSession`); `test/cloud-signed-payload.test.ts`. |
| V3.7.1 | Valid session or re-authentication for sensitive actions | Pass | Every request needs a live 15-minute session or key; a payment above the limit needs the CFO's passkey over the exact terms hash every time (`src/policy/approvals.ts`); optional step-up on settings (`cloud/src/stepUp.ts`, `test/cloud-step-up.test.ts`). |

## V4 Access control

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V4.1.1 | Access control on a trusted service layer | Pass | In the Worker before each route runs (`cloud/src/app.ts`), never in the console's script. |
| V4.1.2 | Access attributes not user-manipulable | Pass | Role and company come from the signed session and the database, scopes from the key's row (`cloud/src/auth.ts`). |
| V4.1.3 | Least privilege | Pass | Scopes read, sync, admin; roles owner, cfo, accountant, viewer; a key made by a key never has more scope or a later expiry (`newApiKey`, `cloud/src/auth.ts`); Airwallex keys scoped per role (`src/airwallex/keyScopes.ts`). |
| V4.1.5 | Access control fails securely | Pass | Every check throws `AuthError` (fail closed); an exception becomes a 500 with a reference, never a pass (`cloud/src/app.ts`); `test/cloud-route-auth.test.ts`. |
| V4.2.1 | IDOR protection | Pass | Every query is scoped to the caller's company; another company's object answers 404 (`cloud/src/tenant.ts`); `test/cloud-tenancy.test.ts`, `docs/evidence/redteam-api.md` (cross-company attacks). |
| V4.2.2 | Anti-CSRF | Pass | Cloud: bearer tokens, no cookie, and a browser write from another origin is refused (`cloud/src/app.ts`); kit11: SameSite=Strict cookie. |
| V4.3.1 | Administrative interfaces use MFA | **Fail** | Company owners sign in with a passkey, but the platform admin routes (`need: "platform"`, `cloud/src/app.ts`) take a bearer key: named and scoped now (`ADMIN_KEYS`), still one factor. Fix: as V2.5.4. |
| V4.3.2 | No directory browsing or metadata disclosure | Pass | Workers answer only their routes; no file listing; `.git` and source are never served (`worker/src/core.ts` `pageResponse`, `notFoundResponse`). |
| V4.3.3 | Step-up or segregation of duties for high value | Pass | Above the agent's limit only the CFO's passkey approves; high-risk payments need a second key, some kinds four eyes (`src/policy/approvals.ts`, `docs/cloud.md` A second key for high-risk payments); step-up for settings (`cloud/src/stepUp.ts`). |

## V5 Validation, sanitization and encoding

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V5.1.1 | HTTP parameter pollution | Pass | Bodies are JSON checked by zod; query values read once with `URLSearchParams.get` and validated (`cloud/src/app.ts`). |
| V5.1.2 | Mass assignment | Pass | Bodies are `.strict()` zod objects; rows are written from named fields only (`cloud/src/app.ts`, `cloud/src/tenant.ts`). |
| V5.1.3 | All input validated with allow lists | Pass | zod schemas with lengths and patterns on bodies, explicit checks on query and path parameters (`cloud/src/app.ts`); documents screened (`src/policy/injection.ts`); `test/fuzz.test.ts`. |
| V5.1.4 | Structured data typed and validated against a schema | Pass | zod on every API body; Peppol XML by its UBL fields and business rules (`src/ap/peppol.ts`). |
| V5.1.5 | Redirects to allow-listed destinations | Pass | `/go` goes to a fixed address (`worker/src/go.ts`); the trailing-dot redirect stays on the site (`worker/src/core.ts`); OAuth redirects only to a client's registered https URIs (`cloud/src/claude/oauth.ts`). |
| V5.2.1 | Sanitization and Sandboxing | N/A | No rich-text or HTML input is accepted. |
| V5.2.2 | Unstructured data sanitised | Pass | Invoice text is data: length-capped, screened for hidden characters and instructions, never followed (`src/policy/injection.ts`, `docs/fraud-and-injection.md`). |
| V5.2.3 | Mail injection | Pass | Outgoing alerts go through Resend's JSON API, not SMTP commands built from input (`cloud/src/alerts.ts`); inbound mail is parsed, never relayed (`src/ap/eml.ts`). |
| V5.2.4 | No eval or dynamic code execution | Pass | No `eval` or `new Function` on input; CSP without `unsafe-eval`; pdf.js with eval off; `test/saas-status-docs.test.ts` checks pages' scripts. |
| V5.2.5 | Template injection | Pass | No server template engine; HTML built with escaping functions (`src/redesign/ui.ts` `esc`). |
| V5.2.6 | SSRF | Pass | Outbound URLs from users are checked: the alert webhook must be https on port 443 to a public host name, no address literals, no local names, no credentials (`hookUrl`, `cloud/src/monitor.ts`); Workers cannot reach private networks. Not checked: DNS names that resolve to private addresses (the platform cannot reach them). |
| V5.2.7 | Sanitization and Sandboxing | N/A | No SVG or other scriptable image is accepted (PDF, JPEG, PNG, e-mail, UBL XML only: `src/ap/inbox.ts`). |
| V5.2.8 | Scriptable or template content from users | Pass | Invoice text and notes are shown as text only, never rendered as Markdown or templates (`cloud/src/console.ts`). |
| V5.3.1 | Context-specific output encoding | Pass | HTML escaping, `encodeURIComponent` for URLs, JSON with `<` escaped in scripts (`src/relay/assets.ts`). |
| V5.3.2 | Output encoding keeps the character set | Pass | UTF-8 throughout, `charset=utf-8` on every text answer (`cloud/src/app.ts` JSON_HEADERS). |
| V5.3.3 | Context-aware escaping against XSS | Pass | Escaped HTML, `textContent` in scripts, CSP with hashes or nonces (`src/servers/dashboard.ts` cspFor, `cloud/src/console.ts`); `test/security-headers.test.ts`. |
| V5.3.4 | Parameterised queries | Pass | Every SQL statement uses bound parameters (`cloud/src/tenant.ts`, `src/db/`); Semgrep rules in CI. |
| V5.3.5 | Encoding where parameterisation is absent | Pass | CSV cells go through `csvCell`, never a formula (`src/money/registerShape.ts`); filenames in headers are reduced to `[\w.-]` (`cloud/src/app.ts`). |
| V5.3.6 | JSON injection | Pass | `JSON.parse` only; JSON embedded in pages escapes `<` (`src/relay/assets.ts`). |
| V5.3.7 | LDAP injection | N/A | Purser uses no LDAP directory anywhere. |
| V5.3.8 | OS command injection | Pass | No shell strings: `execFileSync` with argument arrays; a Semgrep rule forbids shell strings (`.semgrep/purser.yml`). |
| V5.3.9 | LFI and RFI | Pass | No file path from input: documents are stored and read by their SHA-256 (`src/ap/inbox.ts`, `src/ap/docStore.ts`). |
| V5.3.10 | XPath and XML injection | Pass | No XPath; incoming XML is read by a strict parser with no DTD (`src/ap/xmlStrict.ts`, `test/peppol.test.ts`); the ISO 20022 XML Purser writes escapes its values and is validated against the official XSD (`test/iso20022.test.ts`). |
| V5.4.1 | Memory-safe code | Pass | TypeScript on V8; no native code of Purser's own. |
| V5.4.2 | Constant format strings | Pass | No printf-style formatting of hostile input; template literals only. |
| V5.4.3 | Integer overflow | Pass | Money in integer cents or BigInt with caps (amounts above 10^13 cents refused, `docs/cloud.md` Limits on what comes in; `src/ap/peppol.ts` decimals). |
| V5.5.1 | Serialized objects protected | Pass | No serialized objects cross a trust boundary except signed tokens and signed export links (HMAC, `cloud/src/crypto.ts` `signedPayload`). |
| V5.5.2 | XML parsers restricted | Pass | No DTD, no external entities, no entity expansion, caps on size and depth (`src/ap/xmlStrict.ts`); `test/peppol.test.ts` (XXE and billion-laughs fixtures refused). |
| V5.5.3 | Deserialization of untrusted data avoided | Pass | JSON parsed and validated by zod; no YAML, no native deserialization. |
| V5.5.4 | JSON.parse used, never eval | Pass | `JSON.parse` everywhere, in the Workers, the runner and the pages' scripts; no `eval`. |

## V6 Stored cryptography

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V6.1.1 | Private data encrypted at rest | **Fail** | Purser Cloud keeps data in D1 and R2, which Cloudflare encrypts at rest by default (stated in `docs/cloud.md`, not verified here); the runner's SQLite ledger is a plain file. Fix: an encrypted volume or SQLCipher for the runner, and a recorded check of the platform's encryption. |
| V6.1.2 | Health data encrypted at rest | N/A | Purser holds no health data of any kind. |
| V6.1.3 | Financial data encrypted at rest | **Fail** | As V6.1.1: invoices, IBANs and payments sit unencrypted in the runner's SQLite (`src/db/schema.sql`). Partner OAuth tokens in the cloud are sealed with AES-GCM (`cloud/src/sealed.ts`). |
| V6.2.1 | Crypto modules fail securely, no padding oracles | Pass | AES-GCM (authenticated) only; signatures and MACs compared in constant time (`cloud/src/crypto.ts` `sameString`). |
| V6.2.2 | Proven algorithms and libraries | Pass | Web Crypto and Node's crypto: SHA-256, HMAC-SHA256, AES-GCM, ECDSA P-256, Ed25519; no hand-written primitives (`cloud/src/crypto.ts`, `cloud/src/sealed.ts`). |
| V6.2.3 | IVs and modes configured securely | Pass | AES-GCM with a random 96-bit IV per value and associated data binding company, provider and field (`cloud/src/sealed.ts`). |
| V6.2.4 | Algorithms can be replaced | **Fail** | Sealed values carry a version (`cloud/src/sealed.ts`), but the signed payment terms, sessions and receipts fix SHA-256, HMAC-SHA256 and ES256 with no algorithm field. Fix: an algorithm identifier in each signed record and a documented migration. |
| V6.2.5 | No insecure modes, paddings or ciphers | Pass | No ECB, CBC, PKCS#1 v1.5, 3DES, MD5 or SHA-1 for security. |
| V6.2.6 | Nonces and IVs not reused | Pass | A fresh random IV for every sealed value (`seal`, `cloud/src/sealed.ts`); single-use WebAuthn challenges. |
| V6.3.1 | Random values from a CSPRNG | Pass | Tokens, ids that must not be guessed, challenges and IVs from `crypto.getRandomValues` or `randomBytes` (`cloud/src/crypto.ts`). `Math.random` appears only where nothing depends on it being unguessable (housekeeping sampling, retry jitter). |
| V6.3.2 | Random GUIDs v4 from a CSPRNG | Pass | Where UUIDs are made, `crypto.randomUUID`; other ids are random tokens (`cloud/src/crypto.ts`). |
| V6.4.1 | Secrets management solution | **Fail** | Cloud: Worker secrets (encrypted, write-only). Runner: environment variables or `.env`. No vault that creates, rotates and destroys secrets. Fix: as V1.6.2. |
| V6.4.2 | Key material isolated from the application | **Fail** | The session HMAC secret, the sealing key and the platform's Ed25519 signing key are in the Worker's memory; no HSM or KMS does the operations. Fix: a KMS for the signing key, or accept in writing. |

## V7 Error handling and logging

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V7.1.1 | No credentials or payment details in logs | Pass | `cloud/src/log.ts` redacts anything named like a secret, keeps account numbers' last four, cuts keys, session tokens, `whsec_` secrets and Bearer values; `test/cloud-golive.test.ts` scans a whole session's log. |
| V7.1.2 | No other sensitive data in logs | Pass | E-mail addresses keep their domain only (`cloud/src/log.ts`); `test/cloud-golive.test.ts`. |
| V7.1.3 | Security events logged | Pass | Sign-ins (passkey success and failure), refused keys, 403s, 429s, passkey and key changes, people and policy changes, exports, the platform admin's actions and tamper alarms are security events with the key or user id and the network (`cloud/src/securityAudit.ts`, `cloud/src/securityLog.ts`; the relay in `worker/src/core.ts`); `test/cloud-security-log.test.ts`, `test/relay-security-log.test.ts`. |
| V7.1.4 | Log events carry what an investigation needs | Pass | Each event and each request line carries time, route, status, the caller's key or user id and the address cut to its network (`cloud/src/app.ts`, `cloud/src/securityLog.ts`); `test/cloud-security-log.test.ts` ("the request line carries who and from where"). |
| V7.2.1 | Authentication decisions logged | Pass | Every 401 is an `auth.failure`, `passkey.failure`, `admin.auth_failure` or `webhook.signature_failure` event and every passkey sign-in a `passkey.success` (`securityKindOf`, `cloud/src/securityAudit.ts`); `test/cloud-security-log.test.ts` ("authentication decisions"), `test/relay-security-log.test.ts`. |
| V7.2.2 | Access control decisions logged | Pass | Every 403 is an `access.denied` event with the caller, the route and why (`cloud/src/securityAudit.ts`; the relay in `worker/src/core.ts`); `test/cloud-security-log.test.ts` ("access control decisions"), `test/relay-security-log.test.ts`. |
| V7.3.1 | Log injection prevented | Pass | Each line is one `JSON.stringify` object (`cloud/src/log.ts`); the runner's audit rows are JSON in SQLite (`src/audit/log.ts`). |
| V7.3.3 | Security logs protected | Pass | The runner's audit log is hash-chained and its head anchored on chain (`src/audit/log.ts`, `src/anchor/`, `npm run verify-log`); the cloud's security events are written by code only (`cloud/src/app.ts`). |
| V7.3.4 | Synchronised time in UTC | Pass | Cloudflare's clock; every timestamp ISO 8601 in UTC (`cloud/src/log.ts`). |
| V7.4.1 | Generic error message with an id | Pass | A 500 says "internal error (reference …)"; the log keeps the error under that reference (`cloud/src/app.ts`). |
| V7.4.2 | Exception handling across the codebase | Pass | Typed refusals (`AuthError`, `BadRequest`, `PeppolRefused`, …) mapped to status codes; `test/cloud-route-auth.test.ts`, `test/cloud-err-429.test.ts`. |
| V7.4.3 | Last-resort error handler | Pass | `handle()` in `cloud/src/app.ts` catches everything; the Express servers end in an error handler (`src/servers/`). |

## V8 Data protection

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V8.1.1 | Sensitive data not cached on the server side | Pass | `cache-control: no-store` on every API answer and page (`cloud/src/app.ts` JSON_HEADERS, `worker/src/core.ts` COMMON_HEADERS); no shared cache of personal data. |
| V8.1.2 | Server-side temporary copies protected or purged | Pass | Staged exports live a day under signed, 15-minute links, then are removed (`cloud/src/exports.ts`); spent challenges and old rate windows are cleared by the scheduled job (hourly on purser-try, daily on purser-cloud: `cloud/src/worker.ts`). |
| V8.1.3 | Minimal request parameters | Pass | No hidden fields or tokens in pages; requests carry the bearer and a JSON body (`docs/cloud.md` Conventions). |
| V8.1.4 | Detect and alert on abnormal request numbers | Pass | Rate limits per address and key, and alarm rules over all callers: 401 bursts, 403 bursts and 429 bursts per window raise one `alarm.raised` and an error log line, counted on `GET /v1/health` and the relay's `/health` (`security.alarms_24h`; `src/lib/securityEvents.ts`); `test/cloud-security-log.test.ts` ("alarms"), `test/relay-security-log.test.ts`. Someone must watch that count: owner action in `docs/runbook.md`. |
| V8.2.1 | Anti-caching headers | Pass | `cache-control: no-store` (`cloud/src/app.ts`, `worker/src/core.ts`); `test/security-headers.test.ts`. |
| V8.2.2 | No sensitive data in browser storage | Pass | The session token and the Overview's last live Airwallex read are in sessionStorage (this tab only; `cloud/src/console.ts`, `cloud/src/awxUi.ts`); localStorage holds only the language and the company's short name, and an older page's copy of the read is removed on load; `test/cloud-console-storage.test.ts`. |
| V8.2.3 | Client storage cleared after the session | Pass | Sign-out, a 401 and the 15 minutes all call `forget` (`cloud/src/console.ts`), which removes the session and the Airwallex read; `test/cloud-console-storage.test.ts`. The relay's session cookie is HttpOnly and ends with its session (`worker/src/core.ts`). |
| V8.3.1 | Sensitive data not in query strings | Pass | Bodies and headers carry data. A staged-export link gives a program a bare URL and the signature for the `x-purser-export-link` header; the query form, kept for a download a person clicks, carries only a nonce-bound signature that is good once and for 15 minutes for one part (like an authorization code), spent at the first download (`export_links_used`, `cloud/src/exports.ts`); `test/cloud-export-links.test.ts`. |
| V8.3.2 | Users can export and remove their data | Pass | `GET /v1/export`, staged export, `POST /v1/users/{id}/erase`, `POST /v1/close` (`cloud/src/privacy.ts`); `test/cloud-export-staging.test.ts`, `test/cloud-retention.test.ts`. |
| V8.3.3 | Clear privacy language and consent | **Fail** | No privacy notice or terms exist yet (`docs/go-live.md`: "Legal: terms, privacy notice, data processing agreement: Open"). Fix: draft them before real customer data. |
| V8.3.4 | Sensitive data identified with a policy | Pass | `docs/cloud.md` (Privacy and retention), `docs/security.md` (What we protect). |
| V8.3.5 | Access to sensitive data audited | Pass | Each successful read of personal or financial data (people, passkeys, suppliers, invoices and their documents, payments, transactions, the ledger, reports, the books, documents, mail, the engine's invoices, suppliers, archive and exports, and each Claude connector call at `/mcp`) is a `data.access` event in the append-only security log: who (key or person id), which route, the status, the address cut to its network; never what was read (`cloud/src/securityAudit.ts:70-77` `SECURITY_ROUTES`; kind in `src/lib/securityEvents.ts`). Exports stay `data.export`. `test/cloud-asvs-controls.test.ts` ("reads of personal and financial data"), which also holds every audited route to one the API serves. |
| V8.3.6 | Sensitive data overwritten in memory | **Fail** | Not done, and not reliably possible in a garbage-collected JavaScript runtime. Accepted risk; secrets stay in isolates that are not shared. |
| V8.3.7 | Encryption with confidentiality and integrity | Pass | What is encrypted by Purser (partner OAuth tokens) uses AES-GCM with associated data (`cloud/src/sealed.ts`). |
| V8.3.8 | Retention and deletion on schedule | Pass | A closed company is purged seven years after its last record, staged exports after a day, challenges and rate windows by the scheduled job (`cloud/src/privacy.ts` `purgeExpired`, `cloud/src/worker.ts`); `test/cloud-retention.test.ts`. |

## V9 Communication

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V9.1.1 | TLS for all client connectivity | Pass | Every address is https on `workers.dev`, which is on the HSTS preload list (`.dev`); HSTS on every answer (`cloud/src/baseHeaders.ts`, `worker/src/core.ts`). |
| V9.1.2 | Only strong cipher suites (tested) | **Fail** | Not tested with a TLS scanner; on `workers.dev` the TLS settings are Cloudflare's and cannot be set. Fix: a custom domain with minimum TLS 1.2 and a recorded testssl.sh run. |
| V9.1.3 | Only TLS 1.2 and 1.3 | **Fail** | Not verified with a TLS scanner, as V9.1.2; not settable on `workers.dev`. |
| V9.2.1 | Trusted certificates | Pass | Public CAs on Cloudflare's edge; outbound calls validated by the runtime. |
| V9.2.2 | TLS on every inbound and outbound connection | Pass | Every outside call is https (Airwallex, Anthropic, Alta RPC, Resend, Twilio); D1, R2 and Durable Objects are platform bindings. The runner's local servers listen on 127.0.0.1 only. |
| V9.2.3 | External connections authenticated | Pass | Airwallex by token over TLS (`src/airwallex/client.ts`); inbound webhooks by HMAC (`src/policy/cardHooks.ts`, `src/policy/airwallexEvents.ts`). |
| V9.2.4 | Certificate revocation (OCSP stapling) | **Fail** | Not verified, and not configurable on `workers.dev`. Fix: as V9.1.2. |

## V10 Malicious code

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V10.2.1 | No unauthorised phone-home or data collection | Pass | No analytics or trackers; pages' CSP allows the site's own origin only (`src/servers/dashboard.ts`); calls to Anthropic are the product's features, said on the pages. |
| V10.2.2 | No excessive permissions | Pass | `Permissions-Policy` denies camera, microphone, geolocation, payment, USB; only WebAuthn for the site (`cloud/src/baseHeaders.ts`, `worker/src/core.ts`). |
| V10.3.1 | Auto-update over secure channels | N/A | Purser has no client or server auto-update feature. |
| V10.3.2 | Integrity protections, no untrusted code | Pass | No third-party script or stylesheet is loaded; fonts and pdf.js are served by the Workers themselves; releases have signed provenance through Sigstore (`.github/workflows/release.yml`, not run yet). |
| V10.3.3 | No subdomain takeover | Pass | No custom DNS records: the addresses are `kit11.max-31b.workers.dev` and `purser-try.max-31b.workers.dev`, held by the Cloudflare account. |

## V11 Business logic

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V11.1.1 | Business flows in sequential order | Pass | The payment state machine (proposed, approved, executing, paid) cannot skip a step: execution needs an approval over the same terms hash (`src/policy/approvals.ts` `beginExecution`), model-checked (`docs/evidence/formal-model.md`). |
| V11.1.2 | Steps at realistic human speed | Pass | A CFO approval is a passkey assertion with user verification, which a script cannot make (`worker/src/webauthn.ts`); challenges expire in 5 minutes. |
| V11.1.3 | Business limits per user enforced | Pass | The agent's alone limit, per-payment and daily caps, cash floors, velocity stops (`src/policy/rules.ts`, `src/policy/velocity.ts`, `src/engine/budget.ts`); per-company mail quota (`docs/cloud.md`). |
| V11.1.4 | Anti-automation against excessive calls | **Fail** | Limits exist per address and per key, but they are per isolate (`docs/cloud.md`: the code's own limits are per isolate and per address), no WAF or platform rate rule is set, and Turnstile is off by default. Fix: Cloudflare rate-limiting rules and Turnstile on public starts. |
| V11.1.5 | Limits against identified business risks | Pass | Split-invoice, duplicate, lookalike-supplier, bank-change and injection checks from the threat model (`src/ap/checkerCore.ts`, `src/policy/fraudCore.ts`); measured on held-out sets (`docs/evals/adversarial-v5.md`). |
| V11.1.6 | No TOCTOU on sensitive operations | Pass | The terms hash is checked again before any outside call; one live payout per invoice by a unique index; D1 commits checked (`src/policy/hashFirst.ts`, `src/db/schema.sql`, `test/cloud-concurrency.test.ts`, `docs/evidence/chaos-money.md`). |
| V11.1.7 | Monitoring of unusual business events | Pass | The runner raises alerts (ledger mismatch, card drift, runner down) to `/health` and the alert webhook (`src/ops/publicHealth.ts`, `cloud/src/monitor.ts`); hourly reconciliation with Airwallex (`src/finance/reconcile.ts`). |
| V11.1.8 | Configurable alerting on automated attacks | Pass | Alarm thresholds and window are configurable (`SECURITY_ALARMS`, `alarmRules` in `src/lib/securityEvents.ts`) for failed sign-in, refusal, rate-limit and tamper bursts; an alarm is an `alarm.raised` row, an error log line and a count on `/v1/health`; `test/cloud-security-log.test.ts` ("alarms"). |

## V12 Files and resources

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V12.1.1 | Large files refused | Pass | 15 MB per document (`MAX_DOCUMENT_BYTES`, `src/ap/inbox.ts`), 8 MB per Peppol XML (`src/ap/peppol.ts`), push and mail caps (`docs/cloud.md`). |
| V12.1.2 | Compressed files checked against uncompressed size | Pass | A PDF's compressed streams are inflated against a 64 MB budget before the PDF library sees them (`src/ap/pdfText.ts`); no archive formats are accepted. |
| V12.1.3 | File quota per user | Pass | Files uploaded through the API count toward a storage quota per company, 2 GiB and 20,000 files by default (`cloud/src/storageQuota.ts`): the runner's pushed documents (`cloud/src/sync.ts:252`, `cloud/src/app.ts:584`) and uploads to the company's engine (`cloud/src/engine/routes.ts:125`) reserve their bytes and file in one statement that adds only within the quota; past it the upload is refused with 413 and stores nothing, and a duplicate or a refused file gives its room back (migration `cloud/migrations/0008_storage_quota.sql`). Inbound mail keeps its daily quota per company (500 messages, 500 MB). `test/cloud-asvs-controls.test.ts` ("a storage quota"). |
| V12.2.1 | File type from content | Pass | PDF by its header, images by their header, XML by its parse (`src/ap/pdfText.ts` `isPdf`, `src/ap/scan.ts` `imageInfo`, `src/ap/peppol.ts`). |
| V12.3.1 | Filenames not used by filesystems | Pass | Files are stored under their SHA-256; the given name is metadata only (`src/ap/inbox.ts`). |
| V12.3.2 | Filenames cannot touch local files | Pass | As V12.3.1: the stored name is the SHA-256, never the given name (`src/ap/inbox.ts`). |
| V12.3.3 | Filenames cannot fetch remote files | Pass | Filenames are never used as URLs. |
| V12.3.4 | Reflective file download | Pass | Download names reduced to `[\w.-]` with `Content-Disposition: attachment` (`cloud/src/app.ts`); no JSONP. |
| V12.3.5 | File metadata not passed to OS commands | Pass | No file metadata reaches a command. |
| V12.3.6 | No functionality from untrusted sources | Pass | Nothing is loaded from a CDN; pdf.js is served from the Worker (`cloud/src/console.ts`). |
| V12.4.1 | Untrusted files outside the web root | Pass | In R2 or D1 (cloud) or `<dir>/docs` read-only (runner), never under a served path (`src/ap/inbox.ts`, `cloud/src/blobsSql.ts`). |
| V12.4.2 | Antivirus scanning of untrusted files | **Fail** | No antivirus scan. PDFs are parsed in a memory- and time-limited worker thread and shown with pdf.js in a sandboxed frame, never opened by a desktop reader. Fix: a scanning step (for example a ClamAV service) before a file is stored. |
| V12.5.1 | Only intended file types served | Pass | The Workers answer explicit routes; the assets binding serves `/assets/pdfjs.mjs` only (`cloud/src/console.ts`, `run_worker_first`). |
| V12.5.2 | Uploaded files never executed as HTML or script | Pass | Served as attachments with `nosniff` and a CSP that allows nothing (`cloud/src/baseHeaders.ts`, `cloud/src/app.ts`). |
| V12.6.1 | Outbound requests to an allow list | Pass | Partner calls go to fixed hosts through allow-lists (Airwallex gateway `src/airwallex/gatewayRules.ts`, cards `src/airwallex/cardGate.ts`). Every address a company or client sets (the alert webhook, Slack and Teams targets, a Claude client's metadata document) passes one allow rule when set and again before each call (`cloud/src/egress.ts`; `cloud/src/monitor.ts:90`, `:135`; `cloud/src/alerts.ts:266`; `cloud/src/claude/oauth.ts:81`): https on 443 and a public host name, never an IP literal in any spelling, a private, loopback or link-local address, a local or reserved name, a cloud metadata host, or a name that spells an address (nip.io, sslip.io and the like). `test/egress-allow.test.ts`. A public name whose DNS points at a private address is the one case a name check cannot see; the Worker's fetch runs on Cloudflare's network and carries no credential of Purser's. |

## V13 API and web service

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V13.1.1 | Same encodings and parsers everywhere | Pass | One router per Worker using the URL API (`cloud/src/app.ts` `match`, `worker/src/core.ts`). |
| V13.1.3 | No secrets in API URLs | Pass | Keys and sessions travel in headers; a staged-export link's signature goes in a header for a program, and its browser form is single-use and 15 minutes, not a key (as V8.3.1); `test/cloud-export-links.test.ts`. |
| V13.1.4 | Authorisation at the URI and resource level | Pass | The route's scope, then the object's company (`cloud/src/app.ts`, `cloud/src/tenant.ts`). |
| V13.1.5 | Unexpected content types rejected | Pass | A request body without `Content-Type: application/json` is refused with 415 before it is read (`body()`, `cloud/src/app.ts`; the relay's posts in `worker/src/core.ts`); `test/cloud-content-type.test.ts`, `test/relay-security-log.test.ts`. |
| V13.2.1 | HTTP methods valid for the user and action | Pass | Each route has one method; another answers 405; scope per route (`cloud/src/app.ts`). |
| V13.2.2 | JSON schema validation | Pass | zod on every body (`cloud/src/app.ts`, `cloud/src/engine/routes.ts`). |
| V13.2.3 | CSRF on cookie-based REST | Pass | The cloud API uses no cookies; the kit11 API cookie is SameSite=Strict. |
| V13.2.5 | Content-Type checked | Pass | As V13.1.5: `body()` in `cloud/src/app.ts` checks `Content-Type` first (415); `test/cloud-content-type.test.ts`. |
| V13.2.6 | Headers and payload trustworthy in transit | Pass | TLS; webhooks HMAC-signed; payment terms signed by the CFO's passkey over their hash (`src/policy/approvals.ts`). |
| V13.3.1 | XSD validation of XML | **Fail** | Incoming Peppol XML is parsed strictly and its fields and business rules checked, but not validated against the UBL XSD (`src/ap/peppol.ts`; `docs/integrations/peppol.md`, What is not covered); no XSD validator runs in a Worker without a large native or WebAssembly dependency. Fix: XSD validation in the Access Point (they do) or a vetted validator. |
| V13.3.2 | WS-Security signed payloads | N/A | Purser offers and calls no SOAP service. |
| V13.4.1 | GraphQL query limits | N/A | Purser has no GraphQL or other query-language API. |
| V13.4.2 | GraphQL authorisation layer | N/A | Purser has no GraphQL or other query-language API. |

## V14 Configuration

| Requirement | Short name | Verdict | Evidence or reason |
|---|---|---|---|
| V14.1.1 | Secure, repeatable build and deployment | Pass | CI is automated and pinned (`.github/workflows/ci.yml`), and deployment is one script with its checks (`npm run deploy`, `scripts/deploy.ts`; `docs/runbook.md` "Deploy"): only a clean tree at a commit on `origin/main`, each Worker stamped with that commit, then a check of the live sites. `test/deploy-traceable.test.ts`. As V1.14.4. |
| V14.1.2 | Build and Deploy | N/A | No native code is compiled; TypeScript runs on V8 (`tsconfig.json` strict). |
| V14.1.3 | Server configuration hardened | Pass | Workers with no preview URLs, explicit placement, no unused bindings (`cloud/wrangler.try.jsonc`, `worker/wrangler.jsonc`); `test/cloud-try-config.test.ts`. |
| V14.1.4 | Redeployable from scripts, restorable from backups | Pass | `npm run relay:deploy`, `wrangler deploy` from the repository; backups and restore (`docs/cloud.md` Backups and restore, `cloud/src/restore.ts`, `test/cloud-restore.test.ts`). |
| V14.2.1 | Components up to date with a dependency checker | Pass | Dependabot, OSV-Scanner daily, `npm audit` in CI (`.github/workflows/`, `scripts/audit-check.ts`, `docs/security/vex/`). |
| V14.2.2 | Unneeded features and samples removed | **Fail** | The hosted deployment is a demo on purpose: recorded runs, test companies, a public demo token. A production deployment would need them removed (`docs/cloud.md`, Not done yet). |
| V14.2.3 | External assets with SRI | Pass | No external assets: fonts, scripts and pdf.js are served from the site's own origin. |
| V14.2.4 | Components from trusted repositories | Pass | npm with a lockfile and `npm ci`; Actions pinned by SHA (`.github/workflows/`). |
| V14.2.5 | SBOM maintained | Pass | CycloneDX: `docs/security/sbom.cdx.json` (`npm run sbom`). |
| V14.2.6 | Third-party libraries sandboxed | Pass | pdf.js runs in a worker thread with memory and time limits (runner) and in a sandboxed frame (console) (`src/ap/pdfText.ts`); partner SDK calls go through allow-listed gateways (`src/airwallex/gatewayRules.ts`). |
| V14.3.2 | Debug modes off | Pass | No debug mode; errors return a reference only (`cloud/src/app.ts`). |
| V14.3.3 | No version information in headers | Pass | No `x-powered-by` (`app.disable("x-powered-by")` in `src/servers/`); Workers add none. |
| V14.4.1 | Content-Type with charset on every answer | Pass | `charset=utf-8` on text answers; binary answers typed (`cloud/src/app.ts`); `test/security-headers.test.ts`. |
| V14.4.2 | Content-Disposition on API answers | Pass | Every JSON answer carries `Content-Disposition: attachment; filename="api.json"` (`cloud/src/baseHeaders.ts`; the relay's in `worker/src/core.ts`); files keep their own name; `test/cloud-content-type.test.ts`, `test/relay-security-log.test.ts`. |
| V14.4.3 | Content Security Policy | Pass | Every page has its own CSP (hashes or nonces, `frame-ancestors 'none'`); JSON and text get one that allows nothing (`cloud/src/baseHeaders.ts`, `src/servers/dashboard.ts`); `test/security-headers.test.ts`. |
| V14.4.4 | X-Content-Type-Options: nosniff | Pass | On every answer (`cloud/src/baseHeaders.ts`, `worker/src/core.ts`). |
| V14.4.5 | HSTS on all answers | Pass | `max-age=31536000; includeSubDomains` on every answer (same files). |
| V14.4.6 | Referrer-Policy | Pass | `no-referrer` (same files). |
| V14.4.7 | Not embeddable by third parties | Pass | `frame-ancestors 'none'` and `X-Frame-Options: DENY`; the PDF frame alone is `SAMEORIGIN` (same files). |
| V14.5.1 | Only the HTTP methods in use | Pass | 405 for other methods, each logged as a request line (`cloud/src/app.ts`). |
| V14.5.2 | Origin not used for authentication | Pass | The Origin header can only refuse a request (a browser write from another site), never grant access; authentication is the bearer token (`cloud/src/app.ts`). |
| V14.5.3 | CORS with a strict allow list | Pass | The API sends no `Access-Control-Allow-Origin`; browser writes from another origin are refused except `/mcp` from Claude's own origins (`CLAUDE_ORIGINS`, `cloud/src/app.ts`). The one `*` is on the public pdf.js file, which needs no credentials (`cloud/src/console.ts`). |
| V14.5.4 | Proxy-added headers authenticated | Pass | The only proxy header trusted is Cloudflare's `cf-connecting-ip`, which the edge overwrites (`cloud/src/app.ts`); no SSO header grants identity. |

## How this was made

The list of requirements is the official CSV of ASVS 4.0.3 (every row with a Level 2 mark: 259). Each verdict was decided by reading the files and tests it cites; `test/asvs-l2.test.ts` checks that this page lists exactly those 259 ids once each, that the summary adds up from the rows, and that every failure appears in the plan. Re-assess after the remaining fixes, and have it checked by someone independent before relying on it.

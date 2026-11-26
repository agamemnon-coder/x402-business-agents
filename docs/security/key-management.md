# Key management policy

How Purser makes, keeps, uses, rotates and destroys its cryptographic keys and other secrets. It follows the key life cycle of **NIST SP 800-57 Part 1** (Rev. 5, Recommendation for Key Management): pre-operational (generation, registration), operational (storage, distribution, use), post-operational (rotation, revocation) and destruction. ASVS 4.0.3 V1.6.1 (`docs/security/asvs-l2.md`). Written on 20 November 2026 by Claude (an AI model) for the maintainer; `test/key-management-policy.test.ts` fails when the code reads a secret this page does not list.

Purser moves test money only (the Airwallex sandbox, Alta testnet). This policy is written for that, and says where a deployment with real money must do more.

## Roles

- **Key owner: the maintainer** (the repository's owner, `.github/CODEOWNERS`). Makes, sets, rotates and deletes every Worker secret and every key of the runner. No agent ever sets, reads back or rotates a secret (`docs/security/owner-actions.md`).
- **Platform admins**: each holds their own named, scoped admin key (`ADMIN_KEYS`), at most 90 days long, and is its only holder (`docs/runbook.md`, Platform admin keys).
- **A company's owners**: hold their company's API keys and connector tokens, which they make and revoke in Purser Cloud (Settings, API keys). Purser stores only a key's SHA-256.
- **Each person**: their passkey's private key, which never leaves their device; Purser holds the public key only.

## Generation

- Random secrets come from a cryptographically secure generator only: `crypto.getRandomValues` (Workers, `cloud/src/crypto.ts` `randomToken`) or `openssl rand` / `node -e "crypto.randomBytes"` on the owner's computer. At least 256 bits for a symmetric key or a bearer secret.
- Asymmetric keys are made with WebCrypto or the platform's own tool: ECDSA P-256 (passkeys, made by the authenticator), Ed25519 (the platform's binding key), VAPID P-256 (web push).
- Partner credentials (Airwallex, Anthropic, Twilio, Resend, Cloudflare, ERPs) are made in the partner's own console, with the least scope the partner offers.

## Storage and distribution

- **Workers**: Worker secrets only (`npx wrangler secret put NAME -c <config>`), encrypted at rest by Cloudflare and write-only. Never in a `wrangler*.jsonc`, a `vars` entry, the repository, a log line or a chat (`cloud/wrangler.jsonc` header).
- **Runner**: the owner's environment or a `.env` file outside git (`.gitignore`), read once at start; key files under `KIT11_KEYS_DIR`, mode 0600. A deployment with real money moves them to the OS keychain or a secret manager (ASVS V1.6.2, V6.4.1: open).
- **In the database**: API keys, admin keys and enrolment secrets as SHA-256 only; partner OAuth tokens sealed with AES-256-GCM under `OAUTH_TOKEN_KEY`, bound to their company, provider and field (`cloud/src/sealed.ts`).
- A secret is handed over only through the tool that stores it (the wrangler prompt, the console's one-time display), never by e-mail or chat. gitleaks runs in CI (`.github/workflows/ci.yml`).

## Use

- One key, one purpose: the session key signs sessions, step-up proofs, access tokens and export links under distinct prefixes and labels (`pcs.`, `pca.`, `access:`), never data; the sealing key only seals; a webhook secret only checks its own webhook.
- Every check of a secret is constant time (`cloud/src/crypto.ts` `sameString`). No secret is logged: the log and the security log drop any field named like one (`src/lib/securityEvents.ts` `cleanDetail`).

## Rotation

Each key's crypto-period is in the inventory below. Rotating:

- **Worker secret**: `wrangler secret put` the new value; the Worker picks it up on its next request. The session key's rotation ends every session (people sign in again); the sealing key keeps the old key as a second version until every sealed value is sealed again (`cloud/src/sealed.ts` versions).
- **API key, admin key, connector token**: make the new one, switch to it, revoke the old. A key warns 14 and 3 days before it expires (`cloud/src/keyExpiry.ts`).
- **Partner credential**: make the new one at the partner, set it, then delete the old one there.

## Compromise

On a suspected leak, the key is revoked first and investigated after (`docs/runbook.md`, "A key leaked"): revoke or delete at the source, set a new value, check the security log for its use (`GET /v1/admin/security-log`), and tell the people affected. A leaked session key: rotate it (every session ends). A leaked sealing key: rotate it and reconnect the partner accounts.

## Destruction

- A revoked or expired key's row keeps its hash and dates for the audit trail; the secret itself was never stored.
- A deleted Worker secret is gone from Cloudflare (`wrangler secret delete`). A runner key is deleted from `.env` and the keychain, and a key file is overwritten and removed.
- A closed company's sealed tokens are deleted with its records at the end of its retention (`cloud/src/privacy.ts`).

## Algorithms

SHA-256 (hashes of keys, documents, chains), HMAC-SHA256 (sessions, webhooks, export links), ECDSA P-256 / ES256 (passkeys, web push), Ed25519 (the platform's binding signature), AES-256-GCM (sealed tokens). All from WebCrypto or Node's crypto; no algorithm of Purser's own. A change of algorithm is a new key version, never an in-place edit (ASVS V6.2.4 is open for the signed records).

## Inventory

Every secret the code reads. Crypto-period: the longest a value is used before it is replaced. "Public" marks the public half of a pair, listed so the pair is managed together.

### Purser Cloud (`purser-cloud`, `purser-try`; Worker secrets)

| Name | Purpose | Where it lives | Owner | Crypto-period |
|---|---|---|---|---|
| `SESSION_SECRET` | HMAC-SHA256 key for session tokens, step-up proofs, connector access tokens and export links | Worker secret | maintainer | 1 year; at once on suspicion (ends every session) |
| `ADMIN_KEYS` | The platform admin keys' ids, scopes, expiries and SHA-256 hashes (never a key) | Worker secret | maintainer; each key its holder | each key 90 days at most |
| `ADMIN_TOKEN_SHA256` | The legacy shared admin token's hash, to be deleted once `ADMIN_KEYS` is set | Worker secret | maintainer | retire now (owner action) |
| `OAUTH_TOKEN_KEY` | AES-256-GCM key sealing partner OAuth tokens | Worker secret | maintainer | 1 year, by a new version and re-sealing |
| `AIRWALLEX_OAUTH_CLIENT_SECRET` | Airwallex OAuth client secret (Connect Airwallex) | Worker secret | maintainer | 1 year, or as Airwallex requires |
| `MONEYBIRD_OAUTH_CLIENT_SECRET` | Moneybird OAuth client secret (Connect Moneybird) | Worker secret | maintainer | 1 year |
| `AIRWALLEX_PARTNER_WEBHOOK_SECRET` | Checks Airwallex platform webhooks' signatures | Worker secret | maintainer | 1 year, with Airwallex |
| `RESEND_API_KEY` | Sends approval alerts by e-mail | Worker secret | maintainer | 1 year |
| `TWILIO_AUTH_TOKEN` | Sends approval alerts by WhatsApp | Worker secret | maintainer | 1 year |
| `KIT11_ANTHROPIC_API_KEY` | Claude in the engine (capped spend), also the runner's | Worker secret; runner environment | maintainer | 90 days |
| `TRY_BOTCHECK_SECRET` | Signs the hands-on demo's bot-check answers | Worker secret | maintainer | 1 year |
| `TURNSTILE_SECRET` | Cloudflare Turnstile server secret for public starts | Worker secret | maintainer | 1 year |
| `XERO_OAUTH_CLIENT_SECRET` | Xero OAuth client secret (Connect Xero, per company) | Worker secret | maintainer | 1 year, or as Xero requires |
| `QUICKBOOKS_OAUTH_CLIENT_SECRET` | QuickBooks Online OAuth client secret | Worker secret | maintainer | 1 year, or as Intuit requires |
| `EXACT_OAUTH_CLIENT_SECRET` | Exact Online OAuth client secret | Worker secret | maintainer | 1 year |
| `OIDC_GOOGLE_CLIENT_SECRET` | Sign in with Google: the OAuth client secret | Worker secret | maintainer | 1 year |
| `OIDC_MICROSOFT_CLIENT_SECRET` | Sign in with Microsoft: the client secret | Worker secret | maintainer | at most 2 years (Microsoft's limit) |
| `OIDC_APPLE_PRIVATE_KEY` | Sign in with Apple: the private key (.p8) that signs the client-secret JWT | Worker secret | maintainer | 1 year, by a new key at Apple |
| `PASS_KEY_PEM` | Apple Wallet passes: the private key of the company's Pass Type ID certificate, which signs each agent card's pass (cloud/src/walletPass.ts); with `PASS_CERT_PEM`, `PASS_WWDR_PEM`, `PASS_TYPE_ID` and `TEAM_ID` (public) | Worker secret | maintainer | yearly, with the Pass Type ID certificate (Apple: one year) |
| `OIDC_APPLE_KEY_ID` | Public: the id of that Apple key, named in the JWT's header | Worker secret or var | maintainer | with its private key |
| `APPROVAL_KEY_COOLING_HOURS` | Not a secret: the cooling-off before a new approval key may approve (72 h by default) | Worker var | maintainer | not applicable |

### The site and relay (`kit11`; Worker secrets)

| Name | Purpose | Where it lives | Owner | Crypto-period |
|---|---|---|---|---|
| `RELAY_TOKEN` | The bearer the runner reaches the relay with (derived from the Cloudflare token unless set) | Worker secret; runner environment | maintainer | with `CLOUDFLARE_API_TOKEN`, 1 year |
| `AIRWALLEX_API_KEY` | Airwallex sandbox API key (the relay's and the runner's) | Worker secret; runner environment | maintainer | 90 days |
| `AIRWALLEX_PAYOUT_API_KEY` | Airwallex sandbox key for the payout demo | Worker secret | maintainer | 90 days |
| `AWX_ACT_API_KEY` | Airwallex sandbox key for the act tab | Worker secret | maintainer | 90 days |
| `AIRWALLEX_WEBHOOK_SECRET` | Checks Airwallex webhooks' signatures at the relay | Worker secret | maintainer | 1 year, with Airwallex |
| `ANTHROPIC_API_KEY` | Claude at the relay (capped) and in scripts | Worker secret; owner's environment | maintainer | 90 days |
| `VAPID_PRIVATE_KEY` | Signs web push messages (P-256) | Worker secret | maintainer | 2 years (rotating re-subscribes every device) |
| `VAPID_PUBLIC_KEY` | Public: the VAPID pair's public half | Worker secret | maintainer | with its private key |

### The runner and scripts (the owner's computer: environment, `.env`, key files)

| Name | Purpose | Where it lives | Owner | Crypto-period |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploys and reads the Workers; the relay token is derived from it | owner's environment | maintainer | 1 year |
| `PURSER_CLOUD_KEY` | The runner's sync key to Purser Cloud (scope sync) | runner environment | company owner | 90 days (expires) |
| `PURSER_ADMIN_TOKEN` | A platform admin key for the load script against purser-try | owner's environment, per run | its holder | 30 days |
| `PURSER_PLATFORM_PUBLIC_KEY` | Public: checks Purser Cloud's Ed25519 account bindings | runner environment | maintainer | with the platform binding key |
| `KIT11_RELAY_TOKEN` | The relay bearer as set by hand (else derived) | runner environment | maintainer | with `RELAY_TOKEN` |
| `KIT11_LOCAL_RELAY_TOKEN` | The bearer of a relay run on this computer | runner environment | maintainer | per run |
| `KIT11_RUN_TOKEN` | Ties one run's processes together | made per run | the run | one run |
| `KIT11_TASK_TOKEN` | A task token (`ptask_…`) the autopilot pays on, inside one passkey-signed task mandate; only its SHA-256 is stored (src/policy/taskTokens.ts) | runner environment | the CFO, by issuing it | at most 24 h, never past the mandate |
| `KIT11_AGENT_KEY` | The agent principal's key (MCP), from `npm run principals -- rotate` | runner environment | maintainer | 90 days, by rotate |
| `KIT11_KEYS_DIR` | Directory of the runner's key files (wallets on testnet, ICC keys), mode 0600 | owner's disk | maintainer | per key, 1 year |
| `KIT11_KEYS_ROOT` | Root of the key directories the CLI checks | owner's disk | maintainer | as `KIT11_KEYS_DIR` |
| `KIT11_SPIKE_KEYS_DIR` | Key files of a spike run | owner's disk | maintainer | deleted after the spike |
| `OWNERS_DONOR_KEY` | Key file of the testnet wallet that funds the gas sponsor | owner's disk | maintainer | 1 year; testnet only |
| `TOKENIZE_DONOR_KEY` | Key file of the testnet wallet that funds tokenisation | owner's disk | maintainer | 1 year; testnet only |
| `T0_API_KEY` | T:0 accounting API key | runner environment | maintainer | 90 days |
| `ELEVENLABS_API_KEY` | Voice for recorded demos | owner's environment | maintainer | 90 days |
| `HUB_PUSH_TOKEN` | Pushes run evidence to the hub | runner environment | maintainer | 90 days |
| `ICC_SHARED_SECRET` | Shared secret of the ICC integration | runner environment | maintainer | 1 year |
| `ICC_JWT_PRIVATE_KEY_PASSPHRASE` | Unlocks the ICC JWT signing key file | runner environment | maintainer | with its key, 1 year |
| `ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE` | Unlocks the ICC message-encryption key file | runner environment | maintainer | with its key, 1 year |
| `ERP_BC_CLIENT_SECRET` | Business Central OAuth client secret | runner environment | company owner | as the ERP sets, at most 1 year |
| `ERP_EXACT_CLIENT_SECRET` | Exact Online OAuth client secret | runner environment | company owner | at most 1 year |
| `ERP_EXACT_REFRESH_TOKEN` | Exact Online refresh token | runner environment | company owner | as Exact rotates it |
| `ERP_MONEYBIRD_TOKEN` | Moneybird API token | runner environment | company owner | 1 year |
| `ERP_ODOO_API_KEY` | Odoo API key | runner environment | company owner | 1 year |
| `ERP_XERO_CLIENT_SECRET` | Xero OAuth client secret | runner environment | company owner | at most 1 year |
| `ERP_XERO_REFRESH_TOKEN` | Xero refresh token | runner environment | company owner | as Xero rotates it (60 days) |
| `PURSER_GOOGLE_CLIENT_SECRET` | Google Workspace OAuth client secret | runner environment | company owner | 1 year |
| `PURSER_MS_CLIENT_SECRET` | Microsoft 365 OAuth client secret | runner environment | company owner | at most 2 years (Microsoft's limit) |
| `KIT11_GDRIVE_TOKEN` | Google Drive access for the archive export | runner environment | company owner | as Google sets |
| `KIT11_GRAPH_TOKEN` | Microsoft Graph access for mail | runner environment | company owner | as Microsoft sets |

### Not read from the environment

| Name | Purpose | Where it lives | Owner | Crypto-period |
|---|---|---|---|---|
| `PLATFORM_BINDING_KEY` | The platform's Ed25519 key signing each company's Airwallex binding (`cloud/src/awxPlatform.ts` `bindingKey`), once the platform is configured | Worker secret | maintainer | 1 year, published with its public half |
| `API_KEYS` | Companies' API keys and connector tokens: only their SHA-256 in `api_keys` | the holder; the cloud keeps the hash | company owner | 90 days by default, a year at most |
| `PASSKEYS` | People's passkeys: the private key on their device, the public key in `credentials` | the person's authenticator | the person | until removed or lost |

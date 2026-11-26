# Agent identity: know your agent

Since 26 November 2026. Every agent that can move money is a principal ([agent permissions](agent-permissions.md),
[`src/policy/principals.ts`](../../src/policy/principals.ts)). Each of them now also has its own Ed25519 signing key,
and a money-relevant request it makes carries a signature over that exact request. The agent API can then name the one
agent key a request came from, and it refuses a request sent a second time. Code:
[`src/policy/agentIdentity.ts`](../../src/policy/agentIdentity.ts). Tests:
[`test/agent-identity.test.ts`](../../test/agent-identity.test.ts). Test money only.

## Keys

- **Made with the principal, and again at each rotation.** A principal's key pair is made when the principal is
  created, and again by `npm run principals -- rotate <agent>`, which also replaces its bearer key. The new key becomes
  the current one and the old one is retired. A request signed with a retired key is refused.
- **The ledger keeps only the public key** (`principal_identity_keys`: key id, agent, public key, current or retired).
  The key id is `aik_` and the first 16 hex characters of the SHA-256 of the public key, so an agent that holds only its
  private key can work out its own key id.
- **The private key is kept where the agent's other credentials are.** The CLIs write it once to a key file, mode
  0600, under `KIT11_KEYS_DIR`, outside the repository (`principal-<agent>.ed25519.pem`, next to the bearer key file,
  [`src/cli/identityKeys.ts`](../../src/cli/identityKeys.ts)). An agent that runs inside the runner's own process keeps
  its key in that process. The private key never goes into the ledger, the audit log, git or a log line. The test checks
  the ledger and the audit log for it.

## The signature

The agent signs a canonical envelope. The bytes it signs are the envelope's JCS text (RFC 8785, the same `jcs` the
audit chain uses):

| Field | What |
|---|---|
| `v` | 1 |
| `agent` | the principal's id, e.g. `ext:acme-research` |
| `key_id` | the signing key's id |
| `method` | `tools/call` over MCP, or the HTTP method |
| `target` | the tool's name, or the HTTP path |
| `body_sha256` | SHA-256 of the body: the raw bytes of an HTTP body, or the JCS text of an MCP tool's arguments as the server read them |
| `ts` | the time it was signed (ISO 8601) |
| `nonce` | 16 to 200 random base64url characters |

The signature (`sig`, base64url) is sent with the envelope's fields. Over MCP it goes in the request's
`_meta["purser/agent-identity"]`. Over HTTP it goes in the `Purser-Agent-Identity` header, as base64url of its JSON
(`proofHeader` and `proofFromHeader`). The runner has no separate agent HTTP API today: the agent API is the MCP server
([`src/platform/mcpServer.ts`](../../src/platform/mcpServer.ts)). The header form is tested on its own so that any
HTTP surface can use the same check.

## The check

The agent API checks every tool call, before its bearer key and capabilities, in this order. A failed check refuses
the request, and the refusal is audited as `principal.identity_refused` with its reason code:

1. The proof is well formed: exactly these fields, each in its format (`identity_malformed`).
2. It is signed for this agent (`identity_wrong_agent`).
3. The principal is active, neither revoked nor expired (`identity_principal_inactive`).
4. The key is the principal's current key (`identity_no_key`, `identity_unknown_key`, `identity_key_rotated`).
5. The signature verifies against that public key (`identity_bad_signature`).
6. The envelope is this request's: the same method and tool or path (`identity_request_mismatch`), and the same body
   (`identity_body_mismatch`).
7. The time is within five minutes of the server's, either way (`identity_stale`).
8. The nonce has never been seen before for this key (`identity_nonce_reused`). This check comes last, so a refused
   request never uses up a nonce. Nonces are kept in `agent_identity_nonces` for ten minutes, twice the window, so no
   proof that carries an old nonce can still pass the time check.

A verified request is audited as `principal.identity_verified` with its key id. The money action records the same key
id in its own audit row as `agent_key_id`: `card.purchase_started` (pay with the card), `agent.card_requested` (ask for
a card) and `agent.limit_raise_requested` (ask for a higher limit).

## Rollout

`PURSER_AGENT_IDENTITY`. The runner's agent API (`npm run mcp`, the surface outside agents connect to) is `required`
when it is unset (`agentApiIdentityMode`, since 26 November); in-process harnesses (the lab, the red team, the tests)
choose their own mode.

- `optional`: a signature that is present is checked as above, and a bad one is refused. A request with
  no signature goes through, and its absence is audited (`principal.identity_absent`), so existing agents keep working
  and the log shows which ones do not sign yet.
- `required` (the agent API's default): a request with no signature is refused (`identity_missing`). Any value other than the three names counts
  as `required`, so a typo fails closed.
- `off`: no check and no identity audit rows.

The outside agent (`npm run outside-agent`) signs each call when its key file exists.

## Compared with Visa's Trusted Agent Protocol

Visa's Trusted Agent Protocol (TAP) has the same basic idea. An agent signs each request with its own Ed25519 key, the
signature carries a creation time, an expiry and a nonce, and the receiver verifies it against a registered public key,
so a known agent can be told apart from an anonymous bot and a replay is refused. This is not TAP, and it does not
interoperate with TAP. TAP signs HTTP message components (RFC 9421 `Signature-Input` and `Signature` over `@authority`
and `@path`). A merchant looks its keys up in a key directory and verifies them at checkout. Here the agent signs a
JCS JSON envelope that also covers the method, the tool and the body's hash. The key is registered in the company's own
ledger with its principal, and Purser's own agent API is the one that checks it. Revocation and rotation are tied to
the principal. Where Purser does speak TAP itself, as a merchant behind Visa's reference proxy, is a separate,
dev-only path ([`src/visa/tapSig.ts`](../../src/visa/tapSig.ts), [security.md](../security.md) row 35).

## Not done

- The internal agents (sourcing, support, treasury) run inside the runner and call its payment code directly. That is
  a function call, not a request, so nothing signs it. Their keys exist, and their private keys are held in the
  process, for when they reach Purser through a request.
- Purser Cloud's engine (its Durable Object) does not load the signing code, which keeps it out of the Worker's size
  budget. A principal made there has no signing key until one is rotated in on the runner. Keys are made by the
  runner's ledger opener (`src/db/open.ts`), the agent API and the CLIs.
- An agent made in a process that writes no key file holds its first private key in that process only. It gets a key
  file at its next rotation.
- An Ask Purser task card asked for over MCP is attributed by `principal.identity_verified`. Its proposal row does not
  carry the key id yet.

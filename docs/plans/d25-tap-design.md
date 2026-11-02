# D25 design: Visa TAP on the card rail (for review before building)

Status: design only, nothing built. Max's decisions (2 November): Visa's reference runs unchanged, at a fixed commit,
cloned in CI or a container for the test, never copied into this repo; body integrity is our own second signature;
claim text only after a green interop test.

## Parts

| Part | Whose | Where |
|---|---|---|
| Agent signer: TAP signature (signature 1) and body signature (signature 2) | ours, `src/visa/tap.ts` | this repo |
| Agent registry | Visa's reference `agent-registry` (FastAPI), unchanged | cloned at commit 16d59bd in CI |
| TAP verifier | Visa's reference `cdn-proxy/server.js`, unchanged | cloned at commit 16d59bd in CI |
| Merchant layer behind the proxy: signature 2, Content-Digest, nonce, then the card charge | ours, `src/visa/merchant.ts` | this repo |
| Card authorisation | Airwallex Issuing (sandbox), the agent's own card, inside the CFO's limit | Airwallex |

## Signature 1: TAP, exactly as the unmodified reference verifies it

- Headers `Signature-Input` and `Signature`, label `sig2`, one signature only (the proxy reads everything after
  `sig2=(…);` as its attributes, so nothing else may be in these two headers).
- Covered components: `"@authority" "@path"`. `@authority` is the `Host` the proxy sees (with the port in tests);
  `@path` is the proxy's `req.url`, which includes a query string, so checkout URLs carry no query string.
- Parameters: `created`, `expires` (at most 8 minutes later, as the spec says; the proxy itself only checks
  `created ≤ now + 60` and `expires ≥ now`), `keyId` (camelCase: the proxy reads `keyId`; RFC 9421's `keyid` fails
  there, open issue #27), `alg="ed25519"`, `nonce`, `tag="agent-payer-auth"`.
- The proxy rebuilds `@signature-params` from the header text it received, minus `sig2=`, so the signer must sign the
  exact serialisation it sends.
- Key: Ed25519; in the registry as the raw 32-byte public key in base64, `algorithm` `ed25519` (the proxy supports it;
  no RSA-PSS needed).

## Signature 2: body integrity, ours, on top of TAP

Label on every page: "body integrity: our second signature over Content-Digest, on top of TAP".

- Headers `Purser-Signature-Input` and `Purser-Signature` (RFC 9421 format; own header names, which the proxy
  ignores and passes on). Label `body`.
- `Content-Digest: sha-256=:<base64>:` (RFC 9530) over the exact body bytes.
- Covered components: `"@method" "@authority" "@path" "content-digest" "signature"` (covering TAP's `Signature`
  header binds signature 2 to that one TAP signature, so a body cannot be moved under another TAP request).
- Parameters: `created`, `expires` (8 minutes at most), `keyid`, `alg="ed25519"`, `nonce` (the same value as
  signature 1's nonce), `tag="purser-body"`.
- Same agent key as signature 1, looked up in the same registry.

## What our merchant layer checks (after the proxy passed the request)

1. `Content-Digest` equals the SHA-256 of the body it received.
2. Signature 2 verifies with the registry key named in it, and that key is the one signature 1 named.
3. Signature 2 covers TAP's `Signature` header as received, and both nonces are equal.
4. The tag is `agent-payer-auth` (the proxy does not check the tag value), the window is at most 8 minutes, and
   `@authority`/`@path` are this merchant's checkout.
5. The nonce was never accepted before; it is stored only after 1 to 4 pass (the proxy stores its nonce before it
   verifies; that difference is noted, not patched).
6. Only then the agent's own Airwallex card pays, inside the limit; over it, a raise needs the CFO's Face ID.

## The rail, behind `KIT11_TAP_RAIL=on`

The Sourcing agent picks the card rail for a card-only merchant (Packwise, a merchant we run, simulated). Its request
is signed (signatures 1 and 2), passes the unmodified proxy, then our merchant layer, then Airwallex authorises the
card. The purchase's origin (D24) carries: the TAP `keyId` and nonce, the proxy's verdict, our layer's verdict, and the
Airwallex authorisation id.

## Interop test in CI, both ways

A CI job clones `github.com/visa/trusted-agent-protocol` at commit 16d59bd outside the repo, installs the proxy and the
registry with their own pinned dependencies, starts both, registers the test agent's key, and runs:

- **Our agent → Visa's verifier:** a signed checkout passes the unmodified proxy (200). Refused by the proxy: unknown
  `keyId`, expired, other domain or path, a changed signature, replay. Passed by the proxy but refused by our layer:
  wrong tag (the proxy does not check it), changed body, recomputed digest, signature 2 moved to another request.
- **Visa's signer → our verifier:** signatures made by the reference's own signing code verify with our TAP check.
  To be read first: whether that code can sign headless with Ed25519 (the reference agent is a Streamlit app; its
  default key type is RSA). If it can only sign RSA-PSS, either our verifier adds RSA-PSS for this direction, or the
  test states that it covers Ed25519 one way only.

## Claim (only after a green interop test)

"Our agents sign requests per Visa's Trusted Agent Protocol; verified against Visa's open-source TAP reference."
Never "implements TAP in its entirety", "certified", "endorsed" or "Visa-approved"; no Visa logo; the registry is
self-hosted (the reference's), not Visa's directory; Visa Intelligent Commerce is not claimed. D25 records the TAP
Product Terms version (10 October 2025) and the reference commit (16d59bd).

## Questions for the review

1. Does covering TAP's `Signature` header in signature 2 bind the two correctly, and is the equal nonce needed on top?
2. Is anything in signature 1 or 2 replayable or splittable (body moved, path changed, headers reordered by a proxy)?
3. Does the proxy forward `Purser-*` headers and the body byte for byte? (`http-middleware-proxy` with
   `changeOrigin`; to be shown in the interop test.)
4. Is "verified against Visa's open-source TAP reference" true if only one direction passes?

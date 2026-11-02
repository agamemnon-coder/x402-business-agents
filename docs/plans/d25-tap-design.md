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

## Review, 2 November (fresh Opus review, read against the reference at 16d59bd): what changes

1. **The proxy checks only paths that start with `/product/`** (`server.js` 643–662); everything else, `/checkout`
   included, passes unchecked. The checkout moves under `/product/…`, and every negative case that the proxy should
   refuse asserts that the proxy itself answered 403.
2. **The merchant re-verifies signature 1 itself**, reading it the way TAP does (`keyId`, `@path` with the query),
   because the unchanged proxy adds no header and a request could bypass it. Signature 2 also covers
   `"signature-input"`, so tag, window, keyId and nonce are authenticated for our layer. The merchant listens on
   127.0.0.1 only. The D24 origin records "our check of signature 1" (and the proxy's 200), not a proxy verdict we
   cannot see.
3. **Keys:** Visa's registry has no authentication (register, add, change, delete). It runs on localhost only, and the
   merchant keeps its own pinned list (`tap_agents`: merchant domains, end date, revocation); the registry is used
   only so the proxy can verify. `keyId` (signature 1) and `keyid` (signature 2) must be identical.
4. **`Host`:** the proxy rewrites it (`changeOrigin`), so the merchant checks `@authority` against its configured public
   authority, not the incoming header.
5. **Serialisation:** `keyId` is not an RFC 8941 key, so `http-message-sig` can neither emit nor parse signature 1.
   Signature 1 and the snapshot for signature 2 are built by hand, with a fixed test vector both sides check byte for
   byte. A request with more than one field line of `Signature`, `Signature-Input`, `Content-Digest` or a `Purser-*`
   header is refused; `Content-Digest` holds exactly one `sha-256` entry.
6. **Query:** signature 2 covers `@query`; checkout URLs carry none.
7. **Time and nonces:** one skew value on both sides, at most 480 s for both signatures, nonces in the database per
   key for the window plus the skew (the proxy keeps them in memory for an hour and stores them before verifying;
   noted, not patched).

What the unmodified proxy checks is narrow: the key exists and is active, the timing loosely, the nonce, and an Ed25519
signature over `@authority` and `@path`. It does not check the tag, the window length, the merchant or the body; our
layer does. Signature 1 is not RFC 9421-conformant because of `keyId`, so no text says "signs per RFC 9421".

Claim wording for Max to choose, after the interop test: his text "Our agents sign requests per Visa's Trusted Agent
Protocol; verified against Visa's open-source TAP reference", or the reviewer's narrower one "Our agents' TAP
signatures are accepted by Visa's open-source reference verifier (commit 16d59bd); body integrity, tag and payment
checks are ours." The second is exact if only one direction passes.

## Built, 2 November (what changed against this design, and why)

Code: `src/visa/tapSig.ts` (both signatures, pure), `src/visa/tapMerchant.ts` (our layer), `src/visa/tapServer.ts`
(Packwise's checkout on :3000, loopback only), `src/visa/tapRail.ts` (the rail, `KIT11_TAP_RAIL=on`; through the
reference proxy with `KIT11_TAP_PROXY`), `src/visa/tapLiveRun.ts` and `npm run visa:tap-live` (the live run), the CI job
`.github/workflows/tap-interop.yml` with `test/interop/tap-interop.ts`. The earlier `src/visa/tap.ts` and
`src/visa/merchant.ts` (the RFC 9421 dev test behind `/visa`) are unchanged except that a revocation now sticks.

- **"Visa's signer → our verifier" runs headless, with Ed25519.** `tap-agent/agent_app.py` defines
  `create_ed25519_signature(private_key_pem, authority, path, keyid, nonce, created, expires, tag)` at module level and
  starts Streamlit only under `if __name__ == "__main__"`; the key comes from `ED25519_PRIVATE_KEY` (the raw 32-byte
  seed, base64). The interop test imports the module and calls that function with our test key and a UUID nonce (as the
  reference does), and our signature-1 check verifies the result. The module imports `streamlit` at the top and the
  function uses it only to show an error, so the test puts a do-nothing stand-in module in its place; the reference's
  file runs unchanged. No RSA-PSS is needed in our verifier. Only signature 1 exists in that direction (the reference
  has no body signature), and its request passes the proxy and is refused by our merchant for lacking signature 2.
- **Layout of signature 1:** `; ` between parameters, as the reference agent emits it (the proxy reads `;` with or
  without the space; our parser accepts both and nothing else: each parameter once, no unknown ones, the proxy's key-id
  rule, alg exactly `ed25519`).
- **Skew:** 30 s either way (`TAP_CLOCK_SKEW_S`), on both signatures; a nonce is kept for 480 s plus twice the
  merchant's skew, in a new table `tap_rail_nonces` (per key; `tap_nonces` of the dev test is untouched).
- **Signature 2 covers `@query`** and the request target carries none; a merchant refuses any `?`.
- **The proxy ships no lockfile.** CI installs its `package.json` as is, without dev dependencies or install scripts,
  with npm resolving its ranges as they stood on 19 October (`--before`). Python: not the reference's requirements files
  (unpinned, sdists allowed, a UI stack the test does not run) but only what the registry and the signing function
  import, at the reference's own pins, from a committed hashed file (`test/interop/tap-ref-requirements.txt`, wheels
  only, `--require-hashes`). Python 3.12, because pydantic 2.5.0 has no 3.13 wheels.
- **The rail in the product** checks in-process unless `KIT11_TAP_PROXY` names the reference proxy on this machine;
  then the checkout goes through the proxy to our merchant server. The D24 origin carries
  `tap {key_id, nonce, proxy_status, sig1, sig2, awx_transaction_id}`; the authorisation id is on the charge's origin
  only (it is known once Airwallex answers).
- **Run locally, 2 November,** against the reference files at 16d59bd (checked byte for byte against GitHub; codeload is
  blocked in this sandbox, so not a fresh clone): 21 of 21 interop cases, and the live-run script with Airwallex's
  stand-in and a scripted Claude, both steps. The CI job itself and the live run have not run yet.
- **After the second review (2 November):** the body is the order (plan, amount, currency), signed; our merchant
  checks it against what Packwise sells and the card is charged for the verified order, so "payment checks are our own
  layer" now has code behind it. The rail charges only after the proxy's 200, a verdict about this very request and our
  own nonce row for it. The live run issues the Sourcing agent's card fresh under its own nickname and stops before any
  charge if a card was adopted; a step holds only on Airwallex's `LIMIT_EXCEEDED` (for the over-limit step) and a GET
  at the planned amount; its checks before anything include the clone at 16d59bd with tracked files unchanged and a run
  record that does not exist yet. Our merchant server fails if a requested address is taken, and skips an address
  family the machine lacks (no `::1`). Locally, before the reserve run began: 22 of 22 interop cases.

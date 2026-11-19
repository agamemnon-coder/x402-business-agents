# Visa TAP interop, run again locally (19 November 2026)

Our agent's Trusted Agent Protocol (TAP) checkout against Visa's public TAP reference
([github.com/visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol)), run unchanged at the
pinned commit `16d59bdf3f8a542bc538d0962edbb80ea30a02af`, the same steps as the `tap-interop` CI workflow
(.github/workflows/tap-interop.yml), on this session's machine. Nothing was bought and no money moved, test or real:
the card rail in case e is Airwallex's stand-in in this repository (the live sandbox run is 2 Nov,
[visa-tap-live-2026-11-02.json](visa-tap-live-2026-11-02.json)). Nothing confidential is used: the TAP test key is made per run and
never printed.

**Result: 22 of 22 interop cases hold** (reference commit 16d59bd), finished at 09:29:56 UTC on merged main
(`5025b4c6`), in 4.3 s.

| | |
|---|---|
| Reference | Visa's agent registry (FastAPI, uvicorn) on 127.0.0.1:9002 with a fresh SQLite database, and its CDN proxy (Express) on 3001, both unchanged from the pinned commit, cloned outside this repository |
| Their dependencies | the proxy's `npm install --omit=dev --ignore-scripts --before=2026-10-19` (94 packages); the registry's and the reference signer's Python imports from `test/interop/tap-ref-requirements.txt` (`--require-hashes --only-binary :all:`, Python 3.12) |
| Ours | `npx tsx test/interop/tap-interop.ts`: our merchant (src/visa/tapServer.ts) on 3000 behind Visa's proxy, our TAP signer and verifier |
| Node | 22.22.0, as in CI |

## The cases, as printed

```
PASS  a our agent -> Visa's verifier  signed checkout: status 200, our merchant: accepted, sig1 and sig2 verified
PASS  a our agent -> Visa's verifier  headers and body byte for byte: signed headers identical, body identical, target /product/checkout, Host as received localhost:3000
PASS  b proxy refuses  unknown keyId: status 403 (🔑 Key Not Found), merchant saw 0
PASS  b proxy refuses  expired: status 403 (⏰ Signature Expired), merchant saw 0
PASS  b proxy refuses  other domain: status 403 (🔐 Signature Verification Failed), merchant saw 0
PASS  b proxy refuses  other path: status 403 (🔐 Signature Verification Failed), merchant saw 0
PASS  b proxy refuses  changed signature: status 403 (🔐 Signature Verification Failed), merchant saw 0
PASS  b proxy refuses  replay of the accepted checkout: status 403 (🚫 Replay Attack Detected), merchant saw 0
PASS  c merchant refuses  wrong tag: status 422, reason: wrong tag agent-browser-auth: this checkout needs agent-payer-auth
PASS  c merchant refuses  window over 8 minutes: status 422, reason: signature 1: a window of 600 s is over 480 s
PASS  c merchant refuses  query appended (signed): status 422, reason: a query string on the checkout: refused (the proxy's @path would carry it; checkout URLs carry none)
PASS  c merchant refuses  tampered body: status 422, reason: Content-Digest does not match the body received
PASS  c merchant refuses  an order at a price Packwise does not sell (signed): status 422, reason: payment check: the order's amount 1.00 is not 45.00, the price of packwise-pro
PASS  c merchant refuses  recomputed digest: status 422, reason: signature 2 does not verify (body, digest, method, target or TAP headers changed)
PASS  c merchant refuses  signature 2 moved under another TAP request (other nonce): status 422, reason: the nonces of signature 1 and signature 2 differ: signature 2 belongs to another request
PASS  c merchant refuses  signature 2 moved under another TAP request (same nonce): status 422, reason: signature 2 does not verify (body, digest, method, target or TAP headers changed)
PASS  c merchant refuses  replay of the accepted checkout, straight to our merchant (no proxy): status 422, reason: nonce already accepted for this key: a replay
PASS  d Visa's signer -> our verifier  our signature-1 check accepts the reference's signature: keyId purser-interop-2dc57480e7ad, nonce ab2d459b-ee76-4c23-a746-91cdc4d55885, tag agent-payer-auth
PASS  d Visa's signer -> our verifier  the same signature for another path is refused: refused
PASS  d Visa's signer -> our verifier  the reference's request passes the proxy; our merchant wants signature 2: status 422, missing header content-digest
PASS  e the rail through the proxy  Packwise Starter: proxy, our merchant, then the card: card approved, origin tap {"proxy_status":200,"sig1":"verified","sig2":"verified"}
PASS  e the rail through the proxy  a key only we pinned: the proxy refuses, nothing charged: Packwise's checkout refused the Sourcing agent's TAP request: Visa's reference proxy answered 403 (Key Not Found); nothing was charged

22 of 22 interop cases hold (reference commit 16d59bd)
```

What the groups show: (a) our signed checkout passes Visa's own verifier byte for byte; (b) Visa's proxy refuses an
unknown key, an expired signature, another domain or path, a changed signature and a replay, and our merchant sees
none of them; (c) our merchant refuses what Visa's proxy lets through but the checkout must not take (wrong tag, a
window over 8 minutes, a query, a tampered body, a wrong price, a recomputed digest, a moved second signature, a
replay sent straight to it); (d) the reference agent's own Ed25519 signer, called headless, is accepted by our
signature-1 check and refused for another path; (e) our card rail through the proxy: approved with both signatures
verified, and refused with nothing charged for a key only we pinned.

## What was not run

The Visa Intelligent Commerce purchases through Airwallex's Airi wallet (the VIC runs, last on 14 Nov,
[2026-11-14-vic-5.md](2026-11-14-vic-5.md)) were not run: each needs the owner's Face ID in Airi and the owner's test
card, so they cannot run without the owner's hands.

This record links no Alta transaction, Claude request or Airwallex call, so it changes no figure in the band on /proof
or Home; it is not a run in src/redesign/runs.ts.

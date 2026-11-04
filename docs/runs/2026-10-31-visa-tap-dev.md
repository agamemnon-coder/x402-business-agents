# Run log: agent recognition, then the Airwallex card (31 October 2026, dev test)

`npm run visa -- setup` then `npm run visa -- run`, on a copy of the Friday run 2 ledger (so its cards exist at
Airwallex) and the Airwallex sandbox. A dev test: the run itself was not changed, and this is not the recorded run.
The raw record is [`visa-tap-dev.json`](visa-tap-dev.json).

**What it is.** Our agents sign their requests to a merchant we run (Packwise, on 127.0.0.1) following the
agent-recognition profile of Visa's Trusted Agent Protocol specification: an RFC 9421 HTTP Message Signature over
`@authority` and `@path` with `created`, `expires`, `keyid`, `alg="ed25519"`, a nonce and a tag (`agent-payer-auth`
at checkout). The merchant checks it against our self-hosted registry, then the agent pays with its own Airwallex
card inside the CFO limit.

**What it is not.** Not Visa's directory or key store, not Visa-approved agents, no Visa ID token or payment container.
The registry is ours, the keys are test keys, and the card payments are Airwallex sandbox simulated authorisations.
The code is our own against RFC 9421 (`src/visa/tap.ts`, http-message-sig 0.3.0); Visa's reference code is not used.

| # | Request | Merchant | Airwallex |
|---|---|---|---|
| 1 | The Operations agent buys Packwise Starter (EUR 19.99), signed | recognised (200) | approved |
| 2 | The same signed request again | refused: nonce already used | not called |
| 3 | No signature | refused | not called |
| 4 | Signed for another merchant, sent here | refused: the signature covers the other host | not called |
| 5 | A browsing signature at checkout | refused: wrong tag | not called |
| 6 | A stranger's key | refused: unknown key | not called |
| 7 | Signed ten minutes ago | refused: expired | not called |
| 8 | Packwise Pro (EUR 45.00) | recognised (402) | **declined, `LIMIT_EXCEEDED`** |
| 9 | After the key is revoked | refused: revoked | not called |

Tests: `test/visa-tap.test.ts` (11, every refusal above and more: replay to another path, a window over 8 minutes,
tampered bytes, a non-RFC-8941 `keyId`), `test/visa-merchant.test.ts` (5: an agent cannot pay with another agent's
card; nothing is charged for an unrecognised request).

Open: whether this counts for the Visa Award is Max's question to the organisers. Until they say yes, it is a
feature, not a claim.

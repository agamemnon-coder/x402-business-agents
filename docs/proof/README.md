# Proof bundles

A proof bundle is the file /try hands over on Paid and on the one-cent refusal ("Download the proof (JSON)"). It lets
anyone check the payment's cryptography without trusting our server. Format `purser.proof-bundle/v1`
(`src/proof/bundle.ts`).

It holds:

- the signed terms, their canonical JSON (RFC 8785) and its SHA-256;
- the WebAuthn assertion (authenticatorData, clientDataJSON, signature) and the passkey's public key (COSE), with the rpId;
- the engine's decision (both layers' words);
- the payment's ledger entries and the ledger's head;
- for a refusal, the terms that were asked, and their hash.

There are no secrets and no personal data: a test company and test money only.

Check one:

- in a browser: drop it on [/verify](https://kit11.max-31b.workers.dev/verify) (no server call; WebCrypto on your device);
- offline: `npm run verify-bundle -- docs/proof/try-paid.json` (exit 0 when every check passes, 1 when one fails).

Both run the same code. The checks:

1. The SHA-256 of the canonical terms equals the file's hash.
2. `clientDataJSON.challenge` equals that hash.
3. The authenticator data's first 32 bytes are SHA-256 of the rpId, and its flags say "user present" and "user verified".
4. The ES256 or RS256 signature verifies over `authenticatorData ‖ SHA-256(clientDataJSON)` with the public key.
5. The decision names the signed hash.
6. A refusal's asked terms hash differently, so the signature cannot cover them.
7. Every ledger entry balances and hashes as posted.

## The two samples here

`try-paid.json` and `try-refused.json` come from a /try run in Chromium on this machine:

- the real /try page, the real engine and the real pay route;
- the passkey is Chromium's virtual authenticator (user verification on);
- the origin is `http://localhost`, so the rpId is `localhost`;
- the bank is the simulated stand-in bank (test money).

They are not from the deployed site. `npx tsx test/browser/proof.check.ts --write` makes them again. A bundle from
the deployed site names its own host as the rpId.

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

`try-paid.json` and `try-refused.json` come from the deployed site, on 15 November 2026:

- paid at 04:26:10 UTC and refused at 04:26:16 UTC (each file's `made_at`);
- one run of the live /try, https://purser-try.max-31b.workers.dev/try, so the rpId is `purser-try.max-31b.workers.dev`;
- a fresh test company, on the simulated bank (test money; ids such as `tr_5`), signed by Chromium's virtual passkey (user verification on);
- the clean sample invoice, EUR 1,850.00 to Bergtex Textil GmbH (a test supplier), paid; then the same signature sent with EUR 1,850.01, refused.

Both pass every line on the live [/verify](https://kit11.max-31b.workers.dev/verify) and with `npm run verify-bundle`.
`npx tsx test/browser/proof.check.ts --live --write` makes them again; without `--live` it runs the same walk on this
machine, on `localhost`.

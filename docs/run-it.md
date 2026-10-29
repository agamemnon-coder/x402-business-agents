# Run it

Moved from the project README. Back to the [README](../README.md).

## Run it

Requirements: Node 22.13+ (or 24), a Metal testnet RPC endpoint from the
[Metal console](https://console-testnet.metalntwx.com), Airwallex sandbox API keys, and optionally an Anthropic API key.

```sh
npm install
cp .env.example .env      # fill in; never commit it. Or export the variables in your shell.
npm test                  # unit and contract tests, no network
npm run health            # Metal RPC, finality, x402 facilitator, Airwallex sandbox, Claude key
npm run demo:all          # the whole story, live; pauses for each approval
```

`demo:all` pauses when a proposal waits for a person. Approve it on the approval page (`npm run approvals`,
http://127.0.0.1:4200) or with `npm run proposals` and `npm run approve -- <id> <first 8 hex>`.

Step by step: `npm run bootstrap`, `npm run trade -- 1 40`, `npm run s1:raise`, approve, `npm run s1:resume`,
`npm run s2`, `npm run s3`, approve, `npm run verify`, `npm run audit:export`. Each step is idempotent.

Keys (owner keys, mandate keys, credentials) are written to `KIT11_KEYS_DIR`, which must lie outside this repo.
For a fresh demo world, point `KIT11_KEYS_DIR` and `KIT11_DB` at new paths.


# Runbook: the live Alta (formerly Metal) testnet run, 15 November 2026

For Max, on his own machine, with his own keys. Alta testnet and test money only. Keys never go into the repository,
the cloud or a chat: only the run records below are committed.

## 0. Before anything

- A checkout of `main` (or of `alta-1115` until it is merged), `npm ci` done.
- A keys folder **outside** the repository, for example `~/purser-keys/alta-1115`. Every command below reads
  `KIT11_KEYS_DIR`; set it in the shell, never in a file inside the repository.
- `METAL_RPC_URL`: an Alta testnet RPC endpoint (chain id 63825).

```bash
export KIT11_KEYS_DIR=~/purser-keys/alta-1115     # outside the repository
export METAL_RPC_URL=...                          # Alta testnet RPC; not committed
```

Key files in `$KIT11_KEYS_DIR` (plain key files, as the earlier runs used them):

| File | What it is | Funding |
|---|---|---|
| `sponsor.key.json` | gas sponsor of `passkey-owners`: deploys the verifier, creates the account, funds it with 1.00 | **at least 20.00 test USDZ**. Below 20.00 the script asks the faucet itself; to keep the faucet out, fund it first |
| `payee.key.json` | Stockline, the test payee (any testnet key; it only receives) | none |
| `gas-sponsor.key.json` | the anchor's sender: a gas-only key that owns nothing | a little test USDZ for one transaction |

`passkey-owners` makes the rest in the same folder on its first run: three software passkeys (`cfo.passkey.pem`,
`controller.passkey.pem`, `stranger.passkey.pem`), the verifier's address, the agent's mandate credential and its key.

## Path A, one command: everything with software passkeys

```bash
RUN_OUT=2026-11-15-passkey-owners npm run passkey-owners
```

`RUN_OUT` matters: without it the script writes `docs/runs/passkey-owners.json`, which is the 1 November record that
/alta's "Two passkey owners" fact reads. With it, the record lands in `docs/runs/2026-11-15-passkey-owners.json`.

What it prints: one line per step, `<outcome> <step>  <explorer link>  <detail>`, and at the end
`<n> unexpected; docs/runs/2026-11-15-passkey-owners.json`. **The run is good only when it says `0 unexpected`.**
The steps, in order:

1. the verifier deployed and checked with `eth_call` (a good signature, then the same over another hash);
2. the account created: two passkey owners (CFO and controller), threshold 2; funded to 1.00;
3. a 0.10 payment from the account: the CFO's passkey alone, the CFO with a stranger's, both over another challenge,
   both with a deadline passed: each `reverted`; both passkeys: `done`; the same signed payment again: `reverted`;
4. **one owner refused:** the agent's mandate bound with the CFO's passkey alone: `reverted`;
   **both owners accepted:** bound with both passkeys: `done`;
5. **paid within the mandate:** the agent pays 0.05 under it with its mandate key alone: `done`;
6. **over the cap refused on chain:** the agent asks for 0.06 over the 0.05 cap: `refused on chain`, with its
   transaction (new on 15 Nov, `src/metal/overCap.ts`). A payment, or a refusal with no transaction, prints
   `UNEXPECTED`;
7. the mandate revoked with both passkeys: `done`.

## Path B, with the real iPhone passkey as one owner (as on 12 Nov)

`passkey-owners` cannot use a phone: its passkeys are software stand-ins. For the iPhone as the CFO's passkey, use the
12 Nov flow, `npm run owners`, step by step in [driver/faceid-onchain-runbook.md](driver/faceid-onchain-runbook.md)
(its own settings: `KIT11_DB`, `KIT11_PASSKEY_OWNERS=on`, `OWNERS_GO=yes`, the call budget and log, the relay). It
covers paid within the mandate, both owners accepted, and the over-cap refusal on chain (its `pay` step). It has no
one-owner-refused step: for that, also run Path A, or keep the 1 November record for it.

Its record: `npm run owners -- record` writes `docs/runs/2026-11-15-faceid-onchain.json` and `.md`.

## Then the anchor, live, and its check

```bash
export KIT11_KEYS_DIR=~/purser-keys/alta-1115     # holds gas-sponsor.key.json
npm run anchor -- --dry      # prints the parts, the head and the calldata; sends nothing
npm run anchor -- --live     # sends one transaction
npm run verify-anchor        # recomputes the head and reads the transaction: must print MATCH
```

`--live` prints `sent <tx> block <n> from <address>`, the explorer link, and `wrote docs/runs/2026-11-15-anchor.json`
and `.md`. `verify-anchor` takes the newest `docs/runs/<date>-anchor.json`, prints one `ok` line per check, and ends
`MATCH: docs/runs/2026-11-15-anchor.json, tx <tx>`. Anything but MATCH: stop and do not commit.

## What to commit, and only that

```bash
git add docs/runs/2026-11-15-passkey-owners.json   # Path A
git add docs/runs/2026-11-15-faceid-onchain.json docs/runs/2026-11-15-faceid-onchain.md   # Path B, if run
git add docs/runs/2026-11-15-anchor.json docs/runs/2026-11-15-anchor.md
git status --short                                  # nothing from $KIT11_KEYS_DIR, no .pem, no key file
```

Never commit a key, a `.pem`, a call log with an RPC address, or `METAL_RPC_URL`. The keys folder is outside the
repository so `git add -A` cannot pick it up; check `git status` anyway.

/alta's facts read fixed records (12 Nov, 1 Nov, 13 Nov, 15 Nov verification) in `src/redesign/altaFacts.ts`. Pointing
them at today's records is a separate, small change after the run, with its test.

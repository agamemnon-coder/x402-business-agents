# vic-3 plan: the Sourcing agent chooses the Airi rail, the signed hash read back twice, and a negative test

**Status: ready for the live run, not run live.** Only the STAND-IN dry run has run:
[2026-11-12-vic-3-standin.md](2026-11-12-vic-3-standin.md) (stand-ins, no Airi, Airwallex or Anthropic call, no
card). **Go or no-go: Friday 13 November, 12:00 UTC**, by Max. Without a go by then, nothing runs.

Code: `src/airi/vic3.ts` (the conductor), `src/cli/airiVic3.ts` (`npm run airi:vic-3`), `src/airi/termsMetadata.ts`
(the hash in the PaymentIntent and its read-back). Tests: `test/airi-vic3.test.ts`, `test/airi-terms-metadata.test.ts`.

## What it shows

1. **The Sourcing agent (Claude Haiku) chose the Airi rail from three** (x402 on Metal, the Airwallex company card,
   Airi), for A, B and F1. Each choice is recorded with the model and Anthropic's request id. If Claude does not
   answer, code's fallback pays nothing and the record says so.
2. **The terms hash the CFO signed is read back from two places**: from Airi's mandate (its description), before the
   credential is asked for, and from Airwallex's PaymentIntent record (its metadata, `purser_terms_sha256` and
   `purser_proposal`). Each read-back is marked equal or not equal.
3. **A negative test**: do Airi or the Airwallex sandbox refuse a credential used for another order? Whatever they
   answer is recorded as it came. If they accept it, the test still passes, with the finding "not refused by
   Airi/Airwallex sandbox; only Purser enforces the binding here".

Each Airi mandate is one signed purchase. The PaymentIntent is Airwallex's PaymentIntent record. Nothing here is a
decision by Visa.

## The purchases, in order

| Step | What | Amount (EUR) | Who decides | Calls (Anthropic / Airwallex / airi-cli), expected |
|---|---|---|---|---|
| A | within the CFO's limit; the agent chooses the rail; runs alone | 12.00 | Purser (within the limit); Max taps in Airi | 1 / 2 / 4 |
| B | above the limit; the agent chooses the rail; Face ID; hash in the mandate, read back before the credential; hash in the PaymentIntent, read back | 45.00 | the CFO's Face ID; Max taps in Airi | 1 / 3 / 4 |
| C | over the hard cap (200.00) | 250.00 | Purser refuses: `PURSER_ABOVE_HARD_CAP` | 0 / 0 / 0 |
| D | a merchant not on the CFO's allowlist | 5.00 | Purser refuses: `PURSER_MERCHANT_NOT_ALLOWED` | 0 / 0 / 0 |
| E | terms changed after the Face ID (our own planted change in the ledger, labelled) | 30.00 | the CFO's Face ID; then the executor's hash check refuses | 0 / 0 / 0 |
| F1 | a new 10.00 mandate; its credential tried on a 40.00 PaymentIntent (our own planted misuse, labelled) | 10.00 / 40.00 | the agent chooses the rail; Max taps in Airi; Airi and Airwallex answer | 1 / 2 / 4 |
| F2 | B's credential, already used once, tried on a new PaymentIntent, in the same process before it is deleted | 45.00 | Airwallex answers | 0 / 2 / 0 |

The expected calls per step are those of the STAND-IN dry run (`calls` per purchase in its record); a live run adds
the conductor's preflight (airi-cli 3, plus `version`), the Airwallex logins and any read-back retries. C, D and E make
0 calls of any kind: the tests assert it with counters, and the record counts them again.

B's credential is copied into the conductor's own 0700 directory when B pays, used once more by F2, and deleted right
after F2, and in every other case when the run ends. The test proves the deletion, also when the run fails midway.

## Call budgets to approve (hard, in code)

| Service | Expected | Budget | How it is held |
|---|---|---|---|
| Anthropic (Claude Haiku) | 3 (as in the dry run) | **6** | `BUDGETS.anthropic`: counted before each request; one wrong-rail answer or one retry per choice fits |
| Airwallex sandbox API | 9 (as in the dry run), plus 1 or 2 logins | **20** | `BUDGETS.airwallex` per checkout call, and `AIRWALLEX_CALL_BUDGET` (1 to 20, refused above) on every HTTP request, logins included |
| airi-cli | 15 (as in the dry run), plus `version` | **24** | `BUDGETS.airi`: preflight 4 (with `version`), 4 each for A, B and F1, up to 2 read-back retries each |

A call over budget is not sent: the run stops and the record says which budget and which call. The runner makes no
Airi, Airwallex or Anthropic call in vic-3 (it runs without the Airi rail and without Airwallex keys, and the preflight
checks that).

## What Max does

1. **Log in to Airi** if the preflight asks (`airi-cli auth login`, then `auth poll`; approve on app.airi.com).
2. **Enrol his passkey** on the relay for this world, then "Bevestig passkey &lt;fingerprint&gt;" (as in vic-2).
3. **Start the phone screen recording** before step 3 below, and stop it after F2. The clip must show no card digits
   and no one-time link: check it before it is shared.
4. **3 passkey taps in Airi**: A, B and F1. Each one-time link comes on the conductor's console as an `AIRI TAP A`,
   `AIRI TAP B` or `AIRI TAP F1` line; Claude Code passes it on in chat, never into a file, log or commit.
5. **2 Face IDs** on the phone: B (45.00) and E (30.00). After each, the phone may say "execution stopped: the Airi
   rail is off": expected, the conductor runs it, not the runner.

Airi's test card only. No real card, no real money: Airwallex sandbox, test money.

## Commands (names only, no values)

```bash
# 0. A fresh world, and the dry run once more
export KIT11_DB=data/vic-3.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/vic-3
export KIT11_CARD_POLL_MS=off AIRI_CHECKOUT=hosted
unset METAL_RPC_URL METAL_ENDPOINT_SECRET T0_API_KEY T0_ENABLED KIT11_AUTONOMY HUB_PUSH_ENABLED HUB_DECISIONS_ENABLED
mkdir -m 700 "$KIT11_KEYS_DIR"
npm run airi:vic-3 -- --dry

# 1. The runner, without the Airi rail and without Airwallex keys (own process group; the relay settings as in vic-2)
env -u KIT11_AIRI_RAIL -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY npm run relay -- --enrol

# 2. The conductor's environment (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY and KIT11_ANTHROPIC_API_KEY set, not printed)
export KIT11_AIRI_RAIL=on AIRWALLEX_CALL_BUDGET=20 AIRWALLEX_CALL_LOG="$KIT11_KEYS_DIR/airwallex-calls.jsonl"

# 3. Preflight (3 read-only Airi calls and version; nothing else), then the run
VIC3_GO=yes npm run airi:vic-3 -- preflight
VIC3_GO=yes npm run airi:vic-3 -- live --md data/vic-3.md

# 4. Only after a crash or an unknown outcome
VIC3_GO=yes npm run airi:vic-3 -- recover

# 5. Stop the runner
npm run stop -- vic-3
```

The record goes to `data/vic-3-record.json`, the log to `data/vic-3.log` and the page to `data/vic-3.md` (all
outside git). After a check that they hold no card data and no link, they become `docs/runs/2026-11-13-vic-3.md` and
its JSON.

Without `KIT11_AIRI_RAIL=on` and `VIC3_GO=yes`, every command but `--dry` refuses to start and calls nothing. It also
refuses another world's ledger or keys folder, `METAL_RPC_URL`, a missing Airwallex call budget or one above 20, and a
live run without the Anthropic key.

## Stop rules (stop, record, tell Max)

- The preflight says Max must log in to Airi again, or finds no agent-enabled card.
- The runner has the Airi rail or Airwallex keys, no passkey is enrolled, or proposals are open in the ledger.
- A call budget is reached: the next call is not sent, the run stops and the record says why.
- B's mandate does not read back with the signed hash: Purser cancels it and asks no credential
  (`PURSER_MANDATE_HASH_MISMATCH`); F2 then does not run.
- C, D or E reaches Airi or Airwallex (more than 0 calls): the check fails.
- An outcome stays unknown: nothing is retried; `recover` looks it up once.
- A tap does not come within 5 minutes (`PURSER_NO_TAP`), Max rejects a Face ID, or it expires (30 minutes).
- The hosted page cannot be used (`HPP_*` codes): nothing charged, the mandate cancelled, no retry without Max's go.

## What the sandbox cannot show

Airi's test card yields a test credential, and the merchant is our own Airwallex sandbox account. If the sandbox
accepts F1 or F2, that says what this sandbox does, not what a live card network would do.

# vic-2: what Purser adds around the Airi rail, plan and runbook

> **Spiekbriefje voor de CFO:** inschrijven (link + code, Face ID, vingerafdruk in de chat), daarna 3× Face ID:
> P-0001 (Airi-aankoop EUR 30,00; de telefoon meldt daarna "execution stopped": klopt), P-0002 (slot: testwinkel
> geblokkeerd voor Airi), P-0003 (slot eraf). Geen Airi-tik, geen Airi-link, niets betaald.

**Status: run live on 7 November 2026, all seven checks passed: [run log](2026-11-07-vic-2.md).** The dry run (`npm run airi:vic-2 -- --dry`, 0 network) shows the code path only and is never the run's evidence.

vic-1 (7 November, [record](2026-11-07-vic-1.md)) showed the rail itself: a purchase within the CFO's limit paid
alone, one above it paid only after the CFO's Face ID, one at a disallowed merchant refused with 0 Airi calls. vic-2
shows what only Purser adds around Airi, with as few phone actions as possible and **0 Airi calls and 0 Airwallex calls
in the whole run**: nothing is bought, no mandate is made, no Airi link exists, nothing is charged.

## What the run must show

| | Step | Check (the record's `checks`) | Code |
|---|---|---|---|
| **D** | Tampered after signing. The Sourcing agent asks EUR 30.00 at the test shop, above the CFO's EUR 20.00 limit: a proposal, P-0001. The CFO approves it with Face ID. Then a **labelled red-team step of the conductor** alters the stored terms in the ledger, as someone with write access to the database could: amount and item price EUR 30.00 → EUR 190.00 in `proposals.terms_json`, and the proposal row's own `terms_sha256` set to the altered terms' hash. The approval row (the hash the CFO's passkey signed) is left as it is. The conductor then hands P-0001 to the executor, as the runner would after a Face ID. | `d_cfo_signed`: P-0001 approved with the CFO's passkey over its original terms hash. `d_refused_hash_mismatch_0_airi_calls`: the executor refuses with "P-0001: terms do not match the approved hash", 0 Airi calls, no purchase row. P-0001 is then closed (`NEEDS_REAPPROVAL`): it can never run. | `executeAiriPurchase` → `beginExecution` (`src/airi/purchase.ts`, `src/policy/approvals.ts`); the same path as the test "terms changed after the CFO signed: the hash check stops it before Airi is called" (`test/airi-purchase.test.ts`) |
| **E** | The CFO locks the Airi rail. The conductor proposes a policy change, P-0002: `airi.merchant.northwind-sandbox` allowed → blocked (the rail's only merchant off its allowlist). The CFO approves it with Face ID; the runner applies it. The agent's next purchase, EUR 12.00 at the same shop, within the limit, is refused by Purser. | `e_lock_signed_with_face_id`: P-0002 EXECUTED, approved with the CFO's passkey, the setting now `blocked`. `e_refused_by_purser_0_airi_calls`: refused by Purser, `PURSER_MERCHANT_NOT_ALLOWED`, 0 Airi calls. The record also holds the agent's rail choice after the lock: Airi not offered, with the same code. | `policy_change` (`src/executors/policyChange.ts`), `requestAiriPurchase`, `airiRailOffer` (`src/agents/railChoice.ts`) |
| **F** | (Optional, `--no-f` leaves it out.) The CFO lifts the lock: P-0003, blocked → allowed, Face ID. The same EUR 12.00 purchase is offered again on the Airi rail, and Purser's route for it is "alone". **The run stops there**: no request, no mandate, no Airi tap, no charge. | `f_unlock_signed_with_face_id`, `f_offered_again_stopped_before_airi` | `airiRailOffer`, `decideAiriPurchase` (pure; calls nothing) |
| all | Nothing outside is called | `no_outside_calls`: 0 Airi and 0 checkout (Airwallex) calls tried in the whole run | the conductor's Airi client and checkout are zero-budget guards (`zeroRail`, `src/airi/vic2.ts`): any call is refused before it runs, recorded by name, and fails the run |

**Why EUR 190.00 and not EUR 300.00.** The executor re-checks the CFO's policy on the stored terms before the hash. EUR
300.00 is above the rail's hard cap (EUR 200.00), so the policy check would refuse it first (`PURSER_ABOVE_HARD_CAP`),
and a changed amount with an unchanged item price fails on `PURSER_ITEMS_TOTAL_MISMATCH`. The planted alteration keeps
the items adding up and stays below the hard cap, so the policy re-check alone lets it through, and only the hash the
CFO signed stops it. The record says so (`policy_alone_on_the_altered_terms`).

**The alteration is our own planted attack.** Before it changes anything, the conductor writes a ledger row
`vic2.redteam_alteration` (append-only, hash-chained) saying so, with the signed hash and the altered one. The record's
`planted_attack` field, the D step and the run log say it too: a red-team step of the vic-2 conductor, not an outside
attacker. Not covered by this check: an attacker who also rewrites the approval row. The CFO's signed hash is then still
in the hash-chained audit log (`proposal.approved`), which the database refuses to update or delete.

## Why the runner runs without the Airi rail

The runner (`npm run relay`) takes the CFO's Face IDs and executes approved proposals at once. In vic-1 it ran B at
Airi. In vic-2 it must not run D, or the alteration would come after the payment, and Airi would be called. So the
runner runs **without `KIT11_AIRI_RAIL` and without Airwallex keys**: its executor for an Airi purchase then refuses
before anything ("the Airi rail is off (KIT11_AIRI_RAIL); nothing was run"), and P-0001 stays approved and unexecuted
until the conductor's red-team step has altered it. Policy changes still run in the runner (the rail's policy keys
exist once the ledger holds them, `src/policy/rules.ts`), and a change to `airi.merchant.*` calls nothing outside.

The conductor checks this before anything is proposed (`preflight` and `live`): the runner holds this ledger's lock on
this host, and its environment (read from `/proc/<pid>/environ`, keeping only whether the rail is on and whether
Airwallex or Metal keys are set, never a value) has no `KIT11_AIRI_RAIL=on`, no `AIRWALLEX_CLIENT_ID` or
`AIRWALLEX_API_KEY`, and no `METAL_RPC_URL`. After the Face ID on D it checks again that nobody began P-0001.

Checked here, offline (7 November): a runner started with `KIT11_AIRI_RAIL=on` was detected and refused; one started
without it passed. A runner without the rail, restarted over a ledger with an approved Airi purchase and an approved
lock, left the purchase APPROVED with no purchase row ("the Airi rail is off; nothing was run") and executed the lock
(the setting `blocked`). Both on `npm run relay -- --local`, so the hosted relay was not involved.

**On the phone:** after the Face ID on P-0001 the approval page may say "P-0001 was approved, but execution stopped:
the Airi rail is off (KIT11_AIRI_RAIL); nothing was run". That is expected: the conductor runs D itself. The conductor
prints the same on its own console before the Face ID.

## What the CFO does on the phone

**Four moments, about 10 minutes, all on the phone; no Airi tap, no Airi link.**

0. **Enrol a passkey for this world** (a fresh ledger knows none). Claude Code passes the viewer link and the code
   from the runner's output (`npm run relay -- --enrol`) in chat, never into a file, a log or a commit. On the phone,
   in one private tab: open the link, go to `/enrol`, type the code (valid 10 minutes), confirm with Face ID. Then say
   in chat "Bevestig passkey `<fingerprint>`", only if the phone shows that fingerprint. Claude Code runs
   `npm run passkey -- confirm <fingerprint>`.
1. **D: Face ID on P-0001**, "Airi purchase", EUR 30.00 to "Northwind Outdoor test shop (Airwallex sandbox)", for
   "vic-2 D: above the CFO's limit; Purser stops before Airi, nothing is paid". Within 30 minutes. Afterwards the page
   may say "execution stopped: the Airi rail is off": expected (above).
2. **E: Face ID on P-0002**, "policy change": "Northwind Outdoor test shop (Airwallex sandbox): Airi purchases" from
   allowed to blocked. It appears on the phone a few seconds after D is done. Within 30 minutes.
3. **F: Face ID on P-0003**, "policy change": the same setting from blocked to allowed. Within 30 minutes. Leave out
   with `--no-f`; the world then stays locked, which is fine for a world of its own.

Rejecting any of them is a valid answer: the run records it and goes on (E does not depend on D).

### Message to the CFO (Claude Code fills in the placeholders from the runner's output and sends it as it stands)

> **vic-2 starts in 5 minutes (no Airi purchase, no Airwallex, nothing paid).** It takes about 10 minutes.
>
> 1. **Enrol (now).** On your phone, in one private tab, open `<VIEWER_LINK>`. Go to `/enrol`, type the code
>    `<CODE>` (valid for 10 minutes) and confirm with Face ID. Then send me: "Confirm passkey `<FINGERPRINT>`",
>    only if that fingerprint is also on your phone.
> 2. **P-0001, Airi purchase EUR 30.00:** Face ID. The phone may then say "execution stopped: the Airi rail is off";
>    that is right: Purser does not run D itself, we first forge the amount (our own planted attack).
> 3. **P-0002, policy change: test shop blocked for Airi:** Face ID.
> 4. **P-0003, policy change: test shop allowed again:** Face ID.
>
> No Airi tap and no Airi link this time. I approve nothing myself.

(Sent in Dutch on the day; English here.)

## Environment (names only)

```bash
# Both processes (one shell): this world's own ledger and keys, nothing outside reachable.
export KIT11_DB=data/vic-2.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/vic-2
export KIT11_CARD_POLL_MS=off
unset KIT11_AIRI_RAIL AIRWALLEX_CLIENT_ID AIRWALLEX_API_KEY AIRWALLEX_CALL_BUDGET AIRWALLEX_CALL_LOG \
      METAL_RPC_URL METAL_ENDPOINT_SECRET T0_API_KEY T0_ENABLED KIT11_AUTONOMY KIT11_AGENTS \
      HUB_PUSH_ENABLED HUB_DECISIONS_ENABLED
# The relay's own settings stay as in vic-1 (KIT11_RELAY_URL, and KIT11_RELAY_TOKEN or CLOUDFLARE_API_TOKEN).
# optional, not a secret: AIRI_PAYMENT_METHOD_ID (only written into the terms; no card is ever asked for)
```

The runner gets **no** `KIT11_AIRI_RAIL`; the conductor gets `KIT11_AIRI_RAIL=on` on its own command line only. The
conductor refuses to start (exit 2, nothing called) without `KIT11_AIRI_RAIL=on`, with a ledger or keys folder not named
`vic-2*`, with any of `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `METAL_RPC_URL`, `METAL_ENDPOINT_SECRET`,
`T0_API_KEY`, `HUB_DECISIONS_ENABLED` set, and (for `live`) without `VIC2_GO=yes`.

## Steps

| # | What | Command (Claude Code) | The CFO | Calls |
|---|---|---|---|---|
| 0 | Fresh world; dry run once more | `mkdir -m 700 $KIT11_KEYS_DIR`; `npm run airi:vic-2 -- --dry` | — | 0 |
| 1 | Runner on the hosted relay, without the Airi rail, with the enrolment | `npm run relay -- --enrol` (own process group; log to `$KIT11_KEYS_DIR/runner.log`) | enrol, Face ID, "Bevestig passkey &lt;fp&gt;" | relay only |
| 1b | Confirm the passkey | `npm run passkey -- confirm <fingerprint>` (within the 10-minute window) | — | 0 |
| 2 | Preflight | `KIT11_AIRI_RAIL=on npm run airi:vic-2 -- preflight` | — | 0 |
| 3 | The run | `KIT11_AIRI_RAIL=on VIC2_GO=yes npm run airi:vic-2 -- live --log $KIT11_KEYS_DIR/conductor.run.log` (add `--no-f` to leave out F) | Face ID ×3 (×2 with `--no-f`) when the conductor prints `FACE ID` | 0 Airi, 0 Airwallex |
| 4 | Only after a crash | `KIT11_AIRI_RAIL=on npm run airi:vic-2 -- recover` | — | 0 |
| 5 | The record | `data/vic-2-record.json` and the run log (both 0600, outside git); then `docs/runs/2026-11-0x-vic-2.md` from them | — | 0 |
| 6 | Stop | `npm run stop -- vic-2` | — | 0 |

The live run repeats the preflight's checks (passkey, runner, no open proposal), writes this world's Airi policy once
(EUR 20.00 alone, 3 a day, the test shop allowed; audited as `airi.policy_initial`, run `vic-2`), and then runs D, E
and F. It prints `FACE ID` with the proposal id each time it waits, and a notice every minute until the decision.

## Timings

- Enrolment: the code is valid 10 minutes; confirm the fingerprint within that window (vic-1's first attempt lost its
  passkey to a window that ran out).
- Each Face ID: 30 minutes (the proposals' own expiry); the conductor prints "still waiting … about N min left" every
  minute.
- After the Face ID on a policy change the runner applies it within seconds; the conductor waits at most 90 s for it.
- Expected in all: about 10 minutes, nearly all of it waiting for the CFO. The conductor's own steps take
  milliseconds.

## Stop rules (stop, record, tell the CFO)

- The preflight or the run refuses: no passkey, no runner, the runner with the Airi rail or Airwallex or Metal keys, an
  open proposal in the ledger. Nothing has been proposed yet.
- **Any outside call.** The guards refuse it before it runs and the run stops (`STOP … vic-2 allows 0 airi calls` or
  `0 checkout calls`); the attempted call is named in the run log. Nothing reached Airi or Airwallex. This would mean a
  check did not hold (for example the lock not in force when E's purchase ran).
- Someone began P-0001 before the red-team step (the runner with the rail on): the run stops before any alteration.
- The executor does **not** refuse D on the hash (`d_refused_hash_mismatch_0_airi_calls` fails): stop, nothing more.
- The CFO rejects or lets a proposal expire: recorded as it is; D's or E's or F's checks fail; no retry without the
  CFO's go. A rejected or expired lock means E's purchase is not tried (it would go alone and hit the guard).
- The runner does not apply a lock within 90 s of its Face ID: E's purchase is not tried; recorded.
- A crash: `recover` closes a P-0001 altered after signing and reports the rest; nothing is open at Airi or Airwallex,
  since nothing was called.

## Call budget

| Party | Expected | At most | Why |
|---|---|---|---|
| airi-cli | 0 | 0 | The client is attached but behind a zero-budget guard: the binary is never run. Any call fails the run. |
| Airwallex API | 0 | 0 | The conductor has no checkout (the guard refuses it too) and both processes run without Airwallex keys. No hosted page is loaded. |
| Claude | 0 | 0 | No Claude step. |
| Metal | 0 | 0 | `METAL_RPC_URL` unset in both processes. |
| The relay (Cloudflare Worker) | the runner's syncs | — | As in vic-1: the phone's approval pages and the runner's sync. Not a partner call. |

The CFO's actions: 1 enrolment (Face ID), 2 or 3 Face IDs. No Airi passkey tap.

## What the record will show

`data/vic-2-record.json` (written by the conductor, checked by `assertNoSecrets` before it is written):

- `run`, `mode` (`live` or `dry`), `label` (live: the CFO's Face ID on the relay, Airi and Airwallex at 0 calls; dry:
  "DRY RUN on stand-ins … not the run's evidence"), `started_at`, `ended_at`.
- `planted_attack`: the plain statement that D's alteration was our own red-team step.
- `steps.D`: the request, P-0001 and its signed terms hash, the approval (method `passkey`, time), the alteration (from,
  to, signed hash, altered hash, its label), the policy re-check on the altered terms ("passes (route cfo)"), the
  executor's refusal word for word, 0 Airi calls, no purchase row, the end state `NEEDS_REAPPROVAL`.
- `steps.E`: the lock (P-0002, allowed → blocked, approval, the setting after), the agent's rail choice after the lock
  (not offered, `PURSER_MERCHANT_NOT_ALLOWED`), the EUR 12.00 purchase refused by Purser with that code, 0 Airi calls.
- `steps.F`: the unlock (P-0003), the offer again ("offered", route "alone"), "stopped before any request to Airi", 0
  calls; `null` with `--no-f`.
- `checks`: `d_cfo_signed`, `d_refused_hash_mismatch_0_airi_calls`, `e_lock_signed_with_face_id`,
  `e_refused_by_purser_0_airi_calls`, `f_unlock_signed_with_face_id`, `f_offered_again_stopped_before_airi`,
  `no_outside_calls`. Live, a check of a Face ID passes only for an approval with method `passkey`; the dry run's
  stand-in approvals pass only as labelled stand-ins.
- `outside_calls`: `{ airi: 0, airwallex: 0, refused_attempts: [] }`.
- `audit`: the ledger's rows for the run: `airi.policy_initial`, `airi.purchase_requested`, `proposal.created` /
  `approved` / `needs_reapproval` for P-0001, `vic2.redteam_alteration`, `proposal.*` and `policy.changed` for P-0002
  and P-0003, `airi.purchase_refused` for E.

The dry run's output, for comparison (stand-ins, 0 network): all seven checks `ok`; D refused "P-0001: terms do not
match the approved hash"; E refused `PURSER_MERCHANT_NOT_ALLOWED`; F offered, route alone; 0 outside calls.

## What this run cannot show

The hash check stops an alteration made after signing; it does not stop someone who can also rewrite the approval row
(above). The lock is shown for the rail's one merchant in a sandbox world; the agent's request is made by the conductor
on the Sourcing agent's behalf, not by the model choosing a purchase. Nothing is paid, so vic-2 says nothing new about
Airi or Airwallex themselves: that is vic-1's.

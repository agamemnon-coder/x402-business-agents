# Runbook: incidents, the emergency stop, key rotation, recovery

What to do when something goes wrong with Purser: who acts, the commands, how to check it worked. Each procedure says
whether it was **exercised live** (Airwallex sandbox, Metal testnet), **tested** (automated tests against stand-ins)
or **not yet exercised**. The risks each control covers, and the evidence, are in
[controls-matrix.md](controls-matrix.md).

## Who and what

- **CFO.** Approves with Face ID (a passkey) on the phone. Only the CFO can loosen the policy or lift a stop.
- **Controller.** Has a second passkey when four eyes is on (`npm run passkey -- add <name>`). In the on-chain 2-of-2
  account, they hold the second owner key.
- **Operator.** Runs the runner (`npm run relay`) on a trusted machine. The runner holds the keys and the ledger; the
  relay Worker holds no keys and is not trusted by the runner.
- **Outside services.**
  - Airwallex (cards, FX, payouts, Global Accounts, webhooks).
  - Metal (mandates, x402, clearing, finality).
  - Anthropic (Claude: reading and advice only).

## Alarms

`/health` on the relay and the local dashboard server answers 503 while any alarm stands, or when the runner has not
synced for two minutes. An uptime monitor pointed at it pages a person; none is connected in this build. Codes
(`src/ops/health.ts`):

| Code | Means | First action | Clears when |
|---|---|---|---|
| `emergency_stop` | The CFO pulled the stop | Find out why (the dashboard's red band says who, when, why) | The CFO lifts it: a proposal and Face ID |
| `velocity_stop` | An agent paid too often or too much; it is stopped and its card frozen | Read the agent's recent payments on the dashboard; revoke it if it misbehaves (below) | The CFO lifts the stop: a proposal and Face ID |
| `reconciliation_difference` | The hourly reconciliation found a payment the ledger does not explain, or the reverse | Open the reconciliation's lines; check the payment at Airwallex or on the chain explorer; treat an unexplained outgoing payment as a compromise (below) | The next reconciliation is clean |
| `reconciliation_stale` | No reconciliation for three hours | Check the runner is running and the keys still work (`npm run health`) | A reconciliation runs |
| `action_stuck` | An action has been executing for over 10 minutes | Restart the runner: it resumes each action from its last finished step (B2) | The action finishes or fails |
| `hold_stale` | A spend hold older than an hour | Usually a crashed payment: restart the runner; it settles or releases the hold | The hold is settled or released |
| `airwallex_disagrees` | An Airwallex webhook the ledger cannot explain (a payout or conversion Purser did not make, a card live while frozen), in the last day | Treat as a possible compromise of the Airwallex account: check it in the Airwallex web app; pull the emergency stop if a payout is unknown | A day passes with no new disagreement |

Tested in the red team against stand-ins: `velocity_stop`; not yet triggered live. Tested: all codes (`test/health.test.ts`, `test/airwallex-events.test.ts`).

## The emergency stop

**When:** anything that might be a compromise (an unknown payout, an agent acting oddly, a leaked key) and you do not
yet know which part.

**How:**
1. Press **Emergency stop** on the dashboard.
2. It opens the CFO policy on the phone with `freeze` set; one Face ID approves.

**What it does:**
- Every agent payment is refused before anything is signed: supplier purchases, refunds, sweeps, invoice payments,
  prepaid clearing offers.
- Every agent card is set INACTIVE at Airwallex, so they decline with `CARD_INACTIVE`.
- Mandates stay bound on chain. A mandate key used outside Purser could still pull within its mandate's limits, so
  for a suspected mandate-key leak also revoke the mandate (below).

**Check:**
- `/health` shows `emergency_stop`.
- The dashboard shows the red band.
- `npm run cards` shows every card INACTIVE.

**Lifting it:** `npm run policy -- set freeze off --reason "…"`, then Face ID. Lifting loosens the policy, so it is
always a proposal.

Status: tested against stand-ins (`test/freeze.test.ts`, Lab scenario "Emergency stop"); `CARD_INACTIVE` checked live
on a single card. The full stop has not been pulled live end to end.

## Incidents

### A suspected fake invoice (business email compromise)

Purser blocks an invoice whose bank details differ from the supplier's on file, or whose supplier name is a lookalike
(`test/fraud.test.ts`).

1. Do not approve.
2. Call the supplier on a number already in your own records, not one from the invoice.
3. If the supplier really changed banks, use the three-step change: `npm run payee` (request, a person records the
   out-of-band confirmation, the CFO approves). The new account is paid only after that.

Exercised live: the recorded run blocked two fake invoices.

### An agent misbehaving

1. The speed limit stops it automatically (`velocity_stop`).
2. To take it out completely: `npm run principals -- revoke <agent> "<reason>"`.
   - It takes effect at once and freezes its card.
   - The other agents carry on.
   - Revoking is a restriction; only the CFO undoes it.

Tested: `test/principals.test.ts`, and in the red team against stand-ins (a revoked agent's key refused). Not yet
exercised live.

### A key leaked or lost

| Key | Where it lives | Rotate or replace | Status |
|---|---|---|---|
| An agent's API key (outside agents, MCP) | Keys dir | `npm run principals -- rotate <agent>` (the new key goes to a key file; the old one is refused) | Tested |
| An agent's mandate key | Keys dir | Revoke the mandate (owners' quorum), then bind a new one; with a 2-of-2 account both owners sign (`npm run four-eyes` shows the calls) | Revoke exercised live in the four-eyes test world |
| The CFO's passkey (lost phone) | The phone | `npm run relay -- --enrol --replace` prints a one-time code; the new phone enrols at `/enrol`; confirm its fingerprint with `npm run passkey -- confirm <fingerprint>`; the old passkey stops counting | Tested (`test/passkey-ledger.test.ts`); enrolment exercised live in every run |
| The runner's owner key for the Metal account | Keys dir | Move the account to new owners: `addSigners` and `setThreshold` by the current quorum (keeps address, funds, mandates) | Not yet exercised |
| The relay token (and the viewer link derived from it) | `.env`, the Worker's secrets | Set a new `KIT11_RELAY_TOKEN`, `npm run relay:deploy`, restart the runner, open the new viewer link once on each device | Not yet exercised |
| The Airwallex API key | `.env` | Make a new scoped key in Airwallex ([airwallex.md](airwallex.md#the-scoped-key)), put it in `.env`, `npm run health`, delete the old key in Airwallex | Not yet exercised |
| The Airwallex webhook signing secret | Keys dir, the Worker's secrets | `npm run cards -- webhook --replace` (new subscription first, secret to relay and runner, then the old one deleted) | Exercised live (30 October) |
| The compliance key (send policy) | Keys dir; in production a signer of its own | Cancel every unused decision (`cancel`, signed by the old key), then deploy a new contract with the new key and move the funds by policy | Cancel exercised live; rotation not yet exercised |
| The Metal RPC credential | `.env` | Make a new one in the Metal console, put it in `.env`, restart | Not yet exercised |

Never put a key in chat, a log, an issue or git. The secret scan runs before every commit, and gitleaks runs in CI on
the whole history.

### A leaked key: the first hour (added 2 November)

**Who rotates: Max.** Every secret above is held in an account in Max's name (Airwallex web app, Metal console,
Cloudflare, Anthropic console, the private keys repo), and only Max can make or delete it there. Claude (or the
operator) runs the commands in this repo, never sees a new secret in chat, and reports what each check said. Anything
that loosens the policy afterwards (lifting a stop, resuming an agent) is a proposal Max approves with Face ID.

1. **Name the key and what it can move.** Use the table above; the ones that can move money on their own are an
   agent's mandate key (up to its mandate's cap and budget), the runner's owner key (the account's whole balance) and
   the Airwallex API key (payouts, conversions, cards). The relay token and viewer link only read and queue; the
   webhook secret only lets someone fake events, which move no money; the Anthropic key costs money, moves none.
2. **If it can move money, stop first:** the emergency stop on the dashboard (one Face ID). For a mandate key also
   pause that agent (below), which revokes its mandate on chain; the stop alone does not, and a leaked mandate key could
   still pull within its mandate outside Purser.
3. **Max rotates it**, as the table says for that key, and deletes the old one at the provider. Claude puts nothing
   secret in chat; the new value goes into `.env` or the keys dir on the runner.
4. **Check:** `npm run health` (the new key works), `npm run reconcile` (no payment the ledger does not know, from
   the moment of the leak on), `npm run verify`, and `/health` shows no `reconciliation_difference` or
   `airwallex_disagrees`. Search the Airwallex web app and the chain explorer for anything after the leak.
5. **Record it** in a run log in `docs/runs/`: which key, when it leaked and how, when it was rotated, what the checks
   showed. Never the value.

Status: the steps are each tested or exercised as the table says; the sequence as a whole has not been drilled.

### A runaway agent (added 2 November)

An agent that pays too often, decides in a loop, or burns its Claude budget. In order, from the narrowest to the
widest:

1. **It stops itself.** The velocity limits stop it and freeze its card (`velocity_stop`); over its Claude cost cap it
   makes no call and code's labelled fallback decides (`agent.cost_warning` at 80%). System health
   (`/system-health` on the runner's dashboard) shows its runs, fallbacks and refused tool calls.
2. **Pause that agent.** `npm run policy -- set pause.<agent> on --reason "…"`, then Face ID. Purser refuses its
   payments at once, its next wake is idle, and its Metal mandate is revoked on chain. If the revoke failed (an RPC
   error, a restart), `/health` shows `pause_not_revoked`: run `npm run pause -- sync`. The other agents carry on.
   Resuming is `set pause.<agent> off` with Face ID. Tested: `test/agent-pause.test.ts`.
3. **The emergency stop** when it is not clear which agent, or a payment is unknown: every agent payment refused, every
   card frozen at Airwallex (above).
4. **The kill switch for the agents' own decisions:** restart the runner with `KIT11_AGENTS=off` (and
   `KIT11_AUTONOMY` off). No model decides anything; every flow runs code's fixed decisions, as in the recorded runs.
   It does not stop payments that code itself makes within the policy: for that, the emergency stop.
5. **Take it out:** `npm run principals -- revoke <agent> "<reason>"` (above).

Afterwards: read its trace for each run (System health links each run to it), `npm run origins` (each of its money
movements names the run and the request that caused it), and `npm run reconcile`.

Status: the pause and the velocity stop are tested; the kill switch is how every recorded run before D19 ran; none of
the steps has been pulled live against a runaway agent.

### Airwallex or Metal unavailable

- **Airwallex down.**
  - Card payments decline at Airwallex itself.
  - Proposals that need a payout wait; their quotes expire, and an expired one needs a new quote and approval.
  - A payout whose answer was lost is never resent blindly: it is looked up by its request id.
- **Metal RPC down.**
  - Payments fail closed; nothing is signed twice.
  - Finality certificates wait (`finality_pending`) and are fetched when it returns, as long as it is within about
    2 hours. After that they are marked NOT_KEPT.
- **Anthropic down.**
  - Documents fall back to code-only reading.
  - Advice is missing, and the phone says so.
  - No payment depends on Claude.

Tested: `test/chaos.test.ts`, `test/chaos-kill.test.ts` (a worker killed at 16 points; one conversion, one payout, one
pull each time).

#### An Airwallex outage: what to do (added 2 November)

How to tell: `npm run health` fails on Airwallex; calls answer 5xx or time out (a POST becomes "ambiguous", never
resent); `reconciliation_stale` after three hours.

1. **Do nothing to the payments in flight.** A payout or conversion whose answer was lost is looked up by its
   `request_id` when Airwallex is back; if Airwallex answers `duplicate_request_id`, that transfer is adopted, never a
   second one made (`test/contract/airwallex.test.ts`). An approved proposal waits; its quote may expire, and an expired
   one needs a new quote and Face ID (never force it).
2. **Do not approve new invoice payments** until `npm run health` passes: a quote cannot be had, and planning escalates
   with nothing moved.
3. **Cards:** while Airwallex is down, Airwallex itself declines; Purser records nothing it did not see. When it is
   back, the poll and the webhooks record what happened, once each.
4. **When it is back:** `npm run reconcile`, `npm run verify` (with keys), `/health` clean. A payout that Airwallex
   refused at create (`fee_unknown`, `balance_insufficient`, …) is closed in the ledger with its code; the invoice is
   proposed again, which needs Face ID.

Known Airwallex answers that are not an outage: `unconfigured_client_fee` on FX in the first minutes after an account
is activated (wait a few minutes); `401 Insufficient permissions` names a permission the scoped key lacks (Max adds
it in the web app).

#### A Metal outage: what to do (added 2 November)

How to tell: `npm run health` fails on the RPC or the facilitator; the facilitator's `/readyz` answers 503 with
`rpc_unreachable` or `clearing_unavailable`; supplier purchases come back `rpc_unreachable` or `rate_limited`
(refused: nothing moved).

1. **Payments fail closed.** A purchase answered `settlement_in_doubt`, `payment_in_flight` or with no settlement is
   recorded IN_DOUBT and looked up by its nonce on the facilitator's `/settlements` when Metal is back, never paid a
   second time (`test/contract/metal-facilitator.test.ts`). Refunds and sweeps keep their payment id: a retry is "already
   paid, nothing sent" or a fresh pull, never both.
2. **Clearing:** around an epoch close the service refuses with `between_epochs` (send again in a few seconds); a lost
   clearing answer is held and the same request sent again.
3. **Do not pause or revoke mandates during an outage** unless an agent is misbehaving: the revoke itself needs the
   chain. A pause approved meanwhile stands as `pause_not_revoked` until `npm run pause -- sync` succeeds.
4. **Finality certificates** wait in `finality_pending` and are fetched when the RPC returns, if within about two hours;
   after that they are `NOT_KEPT` (a note in verify, not a failure).
5. **When it is back:** `npm run reconcile`, `npm run verify`, `npm run origins`; System health shows no double payment.

## Recovery

1. **Restart the runner** (`npm run relay`).
   - It resumes every action from its last finished step, and looks a started step up by its key.
   - It settles or releases open holds.
2. **Check the ledger:**
   - `npm run verify` re-checks the audit chain, every credential, pull and receipt, passkey approvals, policy
     versions, finality certificates and, with keys, Airwallex.
   - `npm run verify-log -- --anchor <seq:hash>` checks nothing was cut off since an anchor printed earlier (the
     audit report prints one).
3. **Reconcile:** `npm run reconcile` compares the ledger with Airwallex and the chain now, instead of waiting for
   the hourly round.
4. **Report:** `npm run audit:report` makes the PDF for the auditor: decisions, refusals, finality, and the anchor.
5. **Backups:**
   - The ledger is one SQLite file per world (`data/*.sqlite`, with its `-wal`). Copy both while the runner is
     stopped.
   - Not automated in this build. Production would run Postgres with point-in-time recovery
     ([architecture.md](architecture.md)).

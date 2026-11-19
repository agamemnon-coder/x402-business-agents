# Formal model of the payment state machine (TLA+, TLC)

A model of how Purser pays an invoice over Airwallex, checked exhaustively by TLC for a stated bound. Run on
19 November 2026 on a Linux machine, offline after the download of the model checker. `npm run formal` runs it again.

**The model is an abstraction of the code, not the code.** TLC checks the model. It does not read TypeScript. A bug in
the code that the model leaves out is not found here. The table below names the function each action stands for, so a
reader can check the model against the code line by line. The chaos tests ([chaos-money.md](chaos-money.md)) run the
real executor against the same five invariants; the model covers every interleaving within its bound, the chaos tests
the real code on 317 sampled runs.

## Result

| | |
|---|---|
| Spec | [`formal/PurserPayment.tla`](../../formal/PurserPayment.tla), config [`formal/PurserPayment.cfg`](../../formal/PurserPayment.cfg) |
| Bound | 2 proposals, both for the same invoice; 2 crashes; 1 edit of the stored terms; 2 lost requests or answers; 2 executor runs per proposal; webhooks **unbounded** (any number, any order, duplicated, forged) |
| States | **1,102,845 distinct states**, 13,432,409 generated, graph depth 33, 0 left on the queue: the whole reachable state space |
| Time | 174 s for the bound, 2 TLC workers, on a shared and overloaded machine (load average about 12) |
| Result | **No error.** All four invariants and both temporal properties hold |
| Tool | TLC2 Version 2.19 of 08 August 2024 (rev: 5a47802), from `tla2tools.jar` of the tlaplus release v1.7.4, SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` (computed on download; pinned in `scripts/formal.sh`); OpenJDK 21.0.12 |
| Planted bugs | 3 of 3 caught (below) |

TLC's own estimate of the chance that two states shared a fingerprint (and one was skipped): 1.8E-7.

## The properties

| Property | Kind | In words |
|---|---|---|
| `NeverPaidTwice` | invariant | At most one transfer at Airwallex for the invoice, so also at most one per proposal |
| `OnlySignedTermsPaid` | invariant | Every transfer at Airwallex carries terms the CFO's passkey signed, for that proposal |
| `RecordedIsReal` | invariant | The ledger never records a payout Airwallex does not hold |
| `TypeOK` | invariant | Every variable stays in its domain |
| `WebhooksMoveNoMoney` | action property | A webhook step changes no proposal, payout row, Airwallex transfer, request, answer or executor |
| `EveryPaymentEndsKnownOrWithAPerson` | liveness, under fairness | Each proposal ends EXECUTED with its one transfer recorded, or EXPIRED with nothing at Airwallex and no open row, or with an alarm for a person |

Fairness: Purser's own steps, Airwallex's processing, expiry, the reconciliation and the CFO's close-unsent command
eventually happen when they stay possible. The CFO's approval, the attacker, crashes, losses and webhooks have no
fairness: they may happen or not.

## Each action and the code it models

| Action | Code |
|---|---|
| `Approve` | `decide` in `src/policy/approvals.ts`, method passkey: the passkey signs the stored terms hash; a signature over other terms records nothing (so a forged approval is not a step) |
| `Edit` | an attacker who can write `proposals.terms_json`, with or without `terms_sha256` (what the tamper matrix and the red team do) |
| `ExecStart` | `executeInvoicePayment` → `hashFirst` (`src/policy/hashFirst.ts`) → `beginExecution` (`src/policy/approvals.ts`), including "another payout for the same invoice"; for EXECUTING, `resumeInterrupted` (`src/policy/saga.ts`); a refused resume stays EXECUTING and raises `action_stuck` (`src/ops/health.ts`) |
| `Submit` | `submitTransfer` in `src/executors/invoicePayment.ts`, by the payout row: recorded, closed, SUBMITTING (look up first), or none (insert; the unique index `one_live_transfer_per_invoice` in `src/db/schema.sql`) |
| `SendFirst` | the first `createWithFeeRetry` → `createOrAdopt` → `AirwallexRest.createTransfer` (`src/airwallex/adapter.ts`), with `request_id` = the signed `transfer_request_id` |
| `Receive` | the answer: `recordTransfer` (a row that changed meanwhile is an alarm), `duplicate_request_id` adopted only if `sameTransfer`, a documented 400 closes the row only on the first send (`REFUSED_AT_CREATE`) |
| `Timeout` | `AirwallexAmbiguous` (`src/airwallex/client.ts`): no answer in time |
| `Lookup` | `findTransferByRequestId`, `sameTransfer`, then one resend under the same `request_id` (`createOrAdopt`) |
| `Done` | `finishStep` (saga, step DONE) and `finishExecution(…, "EXECUTED")`, merged into one step |
| `AirwallexStep` | Airwallex's `POST /transfers/create`: one transfer per `request_id` (a repeat is `duplicate_request_id`), or a refusal that makes nothing |
| `RequestLost`, `LoseAnswer` | the network |
| `Crash` | the process dies at any step: what is in memory is gone, the SQLite ledger stays, requests already sent may still land (stronger than the chaos stand-in, which refuses a dead process's calls) |
| `Expire` | `expireIfDue` and the expiry check in `beginExecution` |
| `Reconcile` | `reconcile` in `src/finance/reconcile.ts`: a row with no transfer id is looked up by `request_id`; a transfer there is a difference, an alarm |
| `CloseUnsent` | `closeUnsent` in `src/finance/closeUnsent.ts`, the CFO's command |
| `Webhook` | `handleAirwallexHook` (`src/policy/cardHooks.ts`, the HMAC check) and `checkEvent` / `recordEvent` (`src/policy/airwallexEvents.ts`) |

## What the model leaves out, and its assumptions

- **Only the payout.** The conversion step (FX, step 1 of the saga) follows the same pattern under its own `request_id` and is not modelled. Nor are fees, the fee retry's waits, balances and floors, the platform fee, Airwallex's own approval workflow, settlement, late failures after PAID, batches, cards or Alta.
- **Hashes are identities.** Terms are one of two values: as proposed, or edited. SHA-256 collisions are assumed not to happen.
- **The passkey is unforgeable, and the approvals table is written only by `decide`.** An attacker who can write that table directly is out of scope here; the offline re-verification of stored signatures (`reverifyPasskeyApprovals`) and the audit chain cover it.
- **A valid webhook HMAC needs the secret.** Forged events have no valid HMAC.
- **Timing assumption for close-unsent.** The CFO's command waits 30 minutes (`CLOSE_UNSENT_MIN_AGE_MINUTES`); the model assumes no request is still on the wire by then. Without that assumption a request delayed for longer could land after the close; the reconciliation keeps looking such rows up for 7 days, so it would still reach a person.
- **Requests on the wire are a set.** Two identical requests merge into one. With the idempotency key a second identical request changes nothing, so this hides nothing in the correct model.
- **Steps merged.** Step DONE and EXECUTED are one step; a crash between them resumes into the same end.
- **Small bound.** 2 proposals, 2 crashes, 1 edit, 2 losses, 2 runs. A bug that needs more is not excluded by this run.

## Planted bugs: the model can fail

Each planted bug is a constant in the spec (`Bug`), one config each (`formal/Bug_*.cfg`). `npm run formal` fails unless
TLC reports the named violation for each. Traces below are TLC's, shortened to the variables that change.

### 1. No idempotency key → TLC finds a double payment

`Bug = "no_idem_key"`: every create goes out under a fresh id, so Airwallex cannot match a resend to the first send.
TLC: `Invariant NeverPaidTwice is violated` after 2,458 distinct states (2 s).

```
1. Initial        both proposals PENDING, no row, nothing at Airwallex
2. Approve        p1 APPROVED; the CFO signed <<p1, terms as proposed>>
3. ExecStart      p1 EXECUTING
4. Submit         p1's payout row SUBMITTING (written before the call)
5. SendFirst      create request for p1 on the wire
6. Timeout        no answer in time: nobody waits for that answer any more
7. Lookup         look-up by id finds nothing (the first request has not landed); resend
8. AirwallexStep  the first request lands: transfer 1 for p1
9. AirwallexStep  the resend lands: transfer 2 for p1          <- paid twice
```

With the key (the real code), step 9 is answered `duplicate_request_id` naming transfer 1, which is adopted.

### 2. No hash check → TLC finds a payment of edited terms

`Bug = "no_hash_check"`: the executor checks that an approval exists, but not that the stored terms still hash to it.
TLC: `Invariant OnlySignedTermsPaid is violated` after 618 distinct states (1 s).

```
1. Initial        both PENDING
2. Approve        p1 APPROVED; signed <<p1, as proposed>>
3. Edit           p1's stored terms edited after the approval (hash column left as signed)
4. ExecStart      p1 EXECUTING, holding the edited terms
5. Submit         row SUBMITTING
6. SendFirst      create with the edited terms
7. AirwallexStep  transfer 1 for p1 with the edited terms     <- terms nobody signed
```

### 3. Webhook trusted → TLC finds a webhook that moves money

`Bug = "webhook_trusted"`: the handler believes a payout.transfer.failed body without the HMAC and closes the payout
row. TLC: `Action property WebhooksMoveNoMoney is violated` after 1,388 distinct states (2 s).

```
1-6.              p1 approved, executed, transfer 1 created at Airwallex
7. Receive        the answer: row RECORDED with transfer 1
8. WebhookStep    a forged "FAILED" event closes p1's row      <- a webhook changed a payout row
```

Left running, the closed row frees the invoice for p2, a duplicate proposal for the same invoice, which then pays it again.

### A check of the liveness property

By hand, not in `npm run formal`: with `CloseUnsent` switched off in a copy of the spec and a smaller bound (1 crash,
1 loss), TLC reported `Temporal properties were violated` (a proposal EXPIRED with a SUBMITTING row and nothing at
Airwallex, which nobody closes). So the liveness property is not vacuous.

## Run it

```sh
npm run formal              # the bound and the three planted bugs (about 3 to 4 minutes)
npm run formal -- --bugs    # the planted bugs only (seconds)
```

It downloads `tla2tools.jar` v1.7.4 from the official tlaplus GitHub release once, checks its SHA-256, and caches it
in `~/.cache/purser-tla` (or `TLA_CACHE`). The jar is never committed. CI job `formal` runs the same, with Java 21 and
the jar cached on its checksum.

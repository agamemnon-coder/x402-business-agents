------------------------------ MODULE PurserPayment ------------------------------
(***************************************************************************)
(* A model of how Purser pays one supplier invoice over Airwallex.         *)
(*                                                                         *)
(* This is an abstraction of the code, not the code. Each action below     *)
(* names the file and function it stands for (see also                     *)
(* docs/evidence/formal-model.md). Test money only.                        *)
(*                                                                         *)
(* What is in the model:                                                   *)
(*  - proposals, approved by the CFO's passkey over the terms hash;        *)
(*  - an attacker who edits the stored terms, before or after approval,    *)
(*    with or without rewriting the stored hash;                           *)
(*  - the executor: hash check, outbox row, create, lost answers,          *)
(*    timeouts, look-up by request_id, resend under the same request_id;   *)
(*  - crashes at any step (volatile state lost, the ledger kept, requests  *)
(*    already sent may still land at Airwallex);                           *)
(*  - Airwallex, idempotent on request_id, which may refuse a create and   *)
(*    whose list may lag behind a create;                                  *)
(*  - lost requests and lost answers;                                      *)
(*  - webhooks: duplicated, out of order, and forged (no valid HMAC);      *)
(*  - expiry, the hourly reconciliation, and the CFO's close-unsent.       *)
(*                                                                         *)
(* All proposals in P are for the same invoice: the hardest case for       *)
(* "never paid twice" (a duplicate proposal the CFO also approved).        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    P,            \* proposals, all for one invoice
    MaxCrashes,   \* process deaths
    MaxEdits,     \* edits of stored terms by an attacker with ledger write access to proposals
    MaxLosses,    \* lost requests or lost answers
    MaxRuns,      \* starts of an executor per proposal (first run plus re-runs of a FAILED one)
    Bug           \* "none", or one planted bug: "no_idem_key", "no_hash_check", "webhook_trusted"

ASSUME Bug \in {"none", "no_idem_key", "no_hash_check", "webhook_trusted"}

VARIABLES
    status,   \* proposals.status (src/policy/approvals.ts)
    tJson,    \* proposals.terms_json: 0 = as proposed, 1 = edited
    tSha,     \* proposals.terms_sha256: the hash column (hash is modelled as identity on terms)
    appr,     \* approvals.approved_sha256, NoSig when none
    signed,   \* ghost: the <<proposal, terms>> pairs the CFO's passkey really signed
    row,      \* transfers row (the outbox entry): "none", "SUBMITTING", "RECORDED", "CANCELLED"
    rowTr,    \* transfers.transfer_id, 0 when none
    alarm,    \* a person is asked to look (alarm row, reconciliation difference, stuck action)
    awx,      \* transfers that exist at Airwallex: [id, p, v]
    net,      \* create requests on the wire: [p, v, cur]; cur = FALSE once nobody waits for the answer
    resp,     \* the answer waiting for the executor of p: [k, id]
    pc,       \* the executor's place (volatile: lost on a crash)
    crashes, edits, losses,
    seen,     \* webhook events recorded once (airwallex_events, ON CONFLICT DO NOTHING)
    runs,
    tv        \* the terms the executor checked and holds in memory (beginExecution's return value)

vars == <<status, tJson, tSha, appr, signed, row, rowTr, alarm, awx, net, resp, pc,
          crashes, edits, losses, seen, runs, tv>>

NoSig == 9
NoResp == [k |-> "none", id |-> 0]
Waiting == {"wait_first", "wait_again", "wait_last"}

TypeOK ==
    /\ status \in [P -> {"PENDING", "APPROVED", "EXECUTING", "EXECUTED", "FAILED", "EXPIRED"}]
    /\ tJson \in [P -> {0, 1}] /\ tSha \in [P -> {0, 1}] /\ appr \in [P -> {0, 1, NoSig}]
    /\ signed \subseteq (P \X {0, 1})
    /\ row \in [P -> {"none", "SUBMITTING", "RECORDED", "CANCELLED"}]
    /\ rowTr \in [P -> Nat] /\ alarm \in [P -> BOOLEAN]
    /\ pc \in [P -> {"idle", "submit", "send", "lookup", "done"} \cup Waiting]
    /\ \A m \in net : m.p \in P /\ m.v \in {0, 1} /\ m.cur \in BOOLEAN
    /\ \A tr \in awx : tr.p \in P /\ tr.v \in {0, 1} /\ tr.id \in Nat
    /\ tv \in [P -> {0, 1}]

Init ==
    /\ status = [p \in P |-> "PENDING"]
    /\ tJson = [p \in P |-> 0] /\ tSha = [p \in P |-> 0] /\ appr = [p \in P |-> NoSig]
    /\ signed = {}
    /\ row = [p \in P |-> "none"] /\ rowTr = [p \in P |-> 0] /\ alarm = [p \in P |-> FALSE]
    /\ awx = {} /\ net = {} /\ resp = [p \in P |-> NoResp] /\ pc = [p \in P |-> "idle"]
    /\ crashes = 0 /\ edits = 0 /\ losses = 0 /\ seen = {}
    /\ runs = [p \in P |-> 0]
    /\ tv = [p \in P |-> 0]

-----------------------------------------------------------------------------
(* Helpers *)

\* hashFirst + beginExecution (src/policy/hashFirst.ts, src/policy/approvals.ts): an approval on record and the
\* stored terms hashing to the stored hash and to the approved hash.
HashOk(p) ==
    IF Bug = "no_hash_check" THEN appr[p] # NoSig
    ELSE appr[p] # NoSig /\ tJson[p] = tSha[p] /\ tJson[p] = appr[p]

\* Another live payout row for the same invoice (beginExecution precondition, and the unique index
\* one_live_transfer_per_invoice in src/db/schema.sql).
OtherLive(p) == \E q \in P \ {p} : row[q] \in {"SUBMITTING", "RECORDED"}

\* Airwallex keeps one transfer per request_id; the request_id is in the signed terms (transfer_request_id).
\* With the planted bug "no_idem_key" every attempt uses a fresh id, so Airwallex never matches one.
HeldFor(p) == IF Bug = "no_idem_key" THEN {} ELSE {tr \in awx : tr.p = p}

Fail(p) ==
    /\ status' = [status EXCEPT ![p] = "FAILED"]   \* finishExecution(..., "FAILED")
    /\ pc' = [pc EXCEPT ![p] = "idle"]

\* recordTransfer (src/executors/invoicePayment.ts): writes the id only into a SUBMITTING row with no id;
\* anything else is transfer.row_conflict: an alarm and a stop for a person.
Record(p, id) ==
    IF row[p] = "SUBMITTING" /\ rowTr[p] = 0
    THEN /\ row' = [row EXCEPT ![p] = "RECORDED"] /\ rowTr' = [rowTr EXCEPT ![p] = id]
         /\ pc' = [pc EXCEPT ![p] = "done"] /\ UNCHANGED <<alarm, status>>
    ELSE /\ alarm' = [alarm EXCEPT ![p] = TRUE] /\ Fail(p) /\ UNCHANGED <<row, rowTr>>

Send(p, next) ==
    /\ net' = net \cup {[p |-> p, v |-> tv[p], cur |-> TRUE]}
    /\ pc' = [pc EXCEPT ![p] = next]

\* A look-up by request_id (findTransferByRequestId), then sameTransfer: adopt this payout, alarm on another one,
\* or (nothing found, or Airwallex's list lags) resend under the same request_id.
LookupThen(p, next) ==
    \/ \E tr \in HeldFor(p) :
          IF tr.v = tv[p]
          THEN Record(p, tr.id) /\ UNCHANGED net
          ELSE /\ alarm' = [alarm EXCEPT ![p] = TRUE] /\ Fail(p) /\ UNCHANGED <<row, rowTr, net>>
    \/ Send(p, next) /\ UNCHANGED <<alarm, status, row, rowTr>>

-----------------------------------------------------------------------------
(* The CFO and the attacker *)

\* decide() with method passkey (src/policy/approvals.ts): the passkey signs the stored terms hash; a signature
\* over other terms records nothing, so a forged approval is not a step.
Approve(p) ==
    /\ status[p] = "PENDING"
    /\ status' = [status EXCEPT ![p] = "APPROVED"]
    /\ appr' = [appr EXCEPT ![p] = tSha[p]]
    /\ signed' = signed \cup {<<p, tSha[p]>>}
    /\ UNCHANGED <<tJson, tSha, row, rowTr, alarm, awx, net, resp, pc, crashes, edits, losses, seen, runs, tv>>

\* Terms edited at any time (the tamper matrix and red team do this to the ledger), with or without the hash column.
Edit(p) ==
    /\ edits < MaxEdits /\ tJson[p] = 0
    /\ edits' = edits + 1
    /\ tJson' = [tJson EXCEPT ![p] = 1]
    /\ \E withHash \in BOOLEAN : tSha' = IF withHash THEN [tSha EXCEPT ![p] = 1] ELSE tSha
    /\ UNCHANGED <<status, appr, signed, row, rowTr, alarm, awx, net, resp, pc, crashes, losses, seen, runs, tv>>

-----------------------------------------------------------------------------
(* The executor: executeInvoicePayment and submitTransfer, src/executors/invoicePayment.ts *)

\* executeInvoicePayment -> hashFirst -> beginExecution, or resumeInterrupted (src/policy/saga.ts) after a crash.
ExecStart(p) ==
    /\ pc[p] = "idle"
    /\ \/ /\ status[p] \in {"APPROVED", "FAILED"} /\ runs[p] < MaxRuns
          /\ runs' = [runs EXCEPT ![p] = @ + 1]
          /\ IF HashOk(p) /\ ~OtherLive(p)
             THEN /\ status' = [status EXCEPT ![p] = "EXECUTING"] /\ pc' = [pc EXCEPT ![p] = "submit"]
                  /\ tv' = [tv EXCEPT ![p] = tJson[p]]
             ELSE UNCHANGED <<status, pc, tv>>   \* refused before anything outside Purser is called
          /\ UNCHANGED alarm
       \/ /\ status[p] = "EXECUTING"          \* a restart resumes it (resumeInterrupted)
          /\ IF HashOk(p) /\ ~OtherLive(p)
             THEN pc' = [pc EXCEPT ![p] = "submit"] /\ tv' = [tv EXCEPT ![p] = tJson[p]] /\ UNCHANGED alarm
             ELSE alarm' = [alarm EXCEPT ![p] = TRUE] /\ UNCHANGED <<pc, tv>>   \* stays EXECUTING: action_stuck (src/ops/health.ts)
          /\ UNCHANGED <<runs, status>>
    /\ UNCHANGED <<tJson, tSha, appr, signed, row, rowTr, awx, net, resp, crashes, edits, losses, seen>>

\* submitTransfer: by the state of the payout row.
Submit(p) ==
    /\ pc[p] = "submit"
    /\ CASE row[p] = "RECORDED"  -> pc' = [pc EXCEPT ![p] = "done"] /\ UNCHANGED <<status, row, rowTr, alarm, net>>
         [] row[p] = "CANCELLED" -> Fail(p) /\ UNCHANGED <<row, rowTr, alarm, net>>
         [] row[p] = "SUBMITTING" -> LookupThen(p, "wait_again")     \* written before, never answered: look first
         [] row[p] = "none" ->
              IF OtherLive(p)
              THEN Fail(p) /\ UNCHANGED <<row, rowTr, alarm, net>>   \* the unique index refuses the insert
              ELSE /\ row' = [row EXCEPT ![p] = "SUBMITTING"]       \* written before the call
                   /\ pc' = [pc EXCEPT ![p] = "send"]
                   /\ UNCHANGED <<status, rowTr, alarm, net>>
    /\ UNCHANGED <<tJson, tSha, appr, signed, awx, resp, crashes, edits, losses, seen, runs, tv>>

\* The first create (checkpoint transfer:after-insert lies between Submit and this step).
SendFirst(p) ==
    /\ pc[p] = "send"
    /\ Send(p, "wait_first")
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, alarm, awx, resp, crashes, edits, losses, seen, runs, tv>>

\* The answer to the current call (createOrAdopt, the catch in submitTransfer).
Receive(p) ==
    /\ pc[p] \in Waiting /\ resp[p].k # "none"
    /\ resp' = [resp EXCEPT ![p] = NoResp]
    /\ LET r == resp[p] IN
       CASE r.k = "ok" -> Record(p, r.id)
         [] r.k = "dup" ->                                  \* duplicate_request_id: adopt only if it is this payout
              IF \E tr \in awx : tr.id = r.id /\ tr.v = tv[p]
              THEN Record(p, r.id)
              ELSE Fail(p) /\ UNCHANGED <<row, rowTr, alarm>>
         [] r.k = "refused" ->                              \* a documented 400: nothing was made
              IF pc[p] = "wait_first"
              THEN row' = [row EXCEPT ![p] = "CANCELLED"] /\ Fail(p) /\ UNCHANGED <<rowTr, alarm>>
              ELSE Fail(p) /\ UNCHANGED <<row, rowTr, alarm>>  \* a resend never closes the row
    /\ UNCHANGED <<tJson, tSha, appr, signed, awx, net, crashes, edits, losses, seen, runs, tv>>

\* No answer in time (AirwallexAmbiguous): nobody waits for the old answer any more, but the request may still land.
Timeout(p) ==
    /\ pc[p] \in Waiting
    /\ resp' = [resp EXCEPT ![p] = NoResp]
    /\ net' = {IF m.p = p THEN [m EXCEPT !.cur = FALSE] ELSE m : m \in net}
    /\ IF pc[p] = "wait_last"
       THEN Fail(p)                                         \* the resend after the look-up failed too: FAILED, row open
       ELSE pc' = [pc EXCEPT ![p] = "lookup"] /\ UNCHANGED status
    /\ UNCHANGED <<tJson, tSha, appr, signed, row, rowTr, alarm, awx, crashes, edits, losses, seen, runs, tv>>

\* After an ambiguous answer: look the request_id up, then adopt, alarm, or resend once (createOrAdopt).
Lookup(p) ==
    /\ pc[p] = "lookup"
    /\ LookupThen(p, "wait_last")
    /\ UNCHANGED <<tJson, tSha, appr, signed, awx, resp, crashes, edits, losses, seen, runs, tv>>

\* step DONE (src/policy/saga.ts) and finishExecution(..., "EXECUTED"), merged: a crash between them resumes into
\* Submit with the row RECORDED, which comes back here.
Done(p) ==
    /\ pc[p] = "done"
    /\ status' = [status EXCEPT ![p] = "EXECUTED"]
    /\ pc' = [pc EXCEPT ![p] = "idle"]
    /\ UNCHANGED <<tJson, tSha, appr, signed, row, rowTr, alarm, awx, net, resp, crashes, edits, losses, seen, runs, tv>>

-----------------------------------------------------------------------------
(* Airwallex and the network *)

\* POST /transfers/create (src/airwallex/adapter.ts createTransfer, request_id = transfer_request_id).
Process(m) ==
    /\ m \in net
    /\ net' = net \ {m}
    /\ LET held == HeldFor(m.p)
           answer(r) == IF m.cur THEN [resp EXCEPT ![m.p] = r] ELSE resp
       IN IF held # {}
          THEN /\ resp' = answer([k |-> "dup", id |-> (CHOOSE tr \in held : TRUE).id])
               /\ UNCHANGED awx
          ELSE \/ LET id == Cardinality(awx) + 1 IN
                    /\ awx' = awx \cup {[id |-> id, p |-> m.p, v |-> m.v]}
                    /\ resp' = answer([k |-> "ok", id |-> id])
               \/ /\ resp' = answer([k |-> "refused", id |-> 0])
                  /\ UNCHANGED awx
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, alarm, pc, crashes, edits, losses, seen, runs, tv>>

LoseRequest(m) ==
    /\ m \in net /\ losses < MaxLosses
    /\ net' = net \ {m} /\ losses' = losses + 1
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, alarm, awx, resp, pc, crashes, edits, seen, runs, tv>>

LoseAnswer(p) ==
    /\ resp[p].k # "none" /\ losses < MaxLosses
    /\ resp' = [resp EXCEPT ![p] = NoResp] /\ losses' = losses + 1
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, alarm, awx, net, pc, crashes, edits, seen, runs, tv>>

\* The process dies at any point: volatile state goes, the SQLite ledger stays, requests already sent may still land.
Crash ==
    /\ crashes < MaxCrashes
    /\ crashes' = crashes + 1
    /\ pc' = [p \in P |-> "idle"]
    /\ resp' = [p \in P |-> NoResp]
    /\ net' = {[m EXCEPT !.cur = FALSE] : m \in net}
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, alarm, awx, edits, losses, seen, runs, tv>>

-----------------------------------------------------------------------------
(* Time, the reconciliation, the CFO's command, webhooks *)

\* The terms' expiry (beginExecution / expireIfDue), only while no executor runs it.
Expire(p) ==
    /\ status[p] \in {"PENDING", "APPROVED", "FAILED"} /\ pc[p] = "idle"
    /\ status' = [status EXCEPT ![p] = "EXPIRED"]
    /\ UNCHANGED <<tJson, tSha, appr, signed, row, rowTr, alarm, awx, net, resp, pc, crashes, edits, losses, seen, runs, tv>>

\* src/finance/reconcile.ts: a row with no transfer id (SUBMITTING, or closed within 7 days) is looked up by
\* request_id; a transfer there is a difference, an alarm for a person. Modelled while no executor runs it.
Reconcile(p) ==
    /\ row[p] \in {"SUBMITTING", "CANCELLED"} /\ pc[p] = "idle" /\ ~alarm[p]
    /\ \E tr \in awx : tr.p = p
    /\ alarm' = [alarm EXCEPT ![p] = TRUE]
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, row, rowTr, awx, net, resp, pc, crashes, edits, losses, seen, runs, tv>>

\* src/finance/closeUnsent.ts: the CFO closes a SUBMITTING row of a proposal that can no longer run, when a strict
\* look-up finds nothing. Timing assumption: it waits CLOSE_UNSENT_MIN_AGE_MINUTES (30), longer than any request
\* stays on the wire, so no request for this payout is in flight.
CloseUnsent(p) ==
    /\ row[p] = "SUBMITTING" /\ status[p] = "EXPIRED" /\ pc[p] = "idle"
    /\ ~\E m \in net : m.p = p
    /\ ~\E tr \in awx : tr.p = p
    /\ row' = [row EXCEPT ![p] = "CANCELLED"]
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, rowTr, alarm, awx, net, resp, pc, crashes, edits, losses, seen, runs, tv>>

\* Webhook events: for any transfer Airwallex holds, or an id nobody made; valid (Airwallex's HMAC) or forged.
Events == [tid : {tr.id : tr \in awx} \cup {0}, valid : BOOLEAN, st : {"PAID", "FAILED"}]

\* src/policy/cardHooks.ts (HMAC check) and src/policy/airwallexEvents.ts (checkEvent, recordEvent): a valid event is
\* recorded once and compared with the ledger; a forged one is ignored. Nothing else changes.
\* Planted bug "webhook_trusted": the body is believed without the HMAC, and a FAILED event closes the payout row.
\* Deliveries are not bounded: any number, in any order, each event any number of times.
Webhook(e) ==
    /\ IF Bug = "webhook_trusted"
       THEN /\ IF e.st = "FAILED" /\ \E q \in P : rowTr[q] = e.tid /\ row[q] = "RECORDED"
               THEN row' = [q \in P |-> IF rowTr[q] = e.tid THEN "CANCELLED" ELSE row[q]]
               ELSE UNCHANGED row
            /\ UNCHANGED seen
       ELSE /\ seen' = IF e.valid /\ e.tid # 0 THEN seen \cup {<<e.tid, e.st>>} ELSE seen
            /\ UNCHANGED row
    /\ UNCHANGED <<status, tJson, tSha, appr, signed, rowTr, alarm, awx, net, resp, pc, crashes, edits, losses, runs, tv>>

WebhookStep == \E e \in Events : Webhook(e)
AirwallexStep == \E m \in net : Process(m)
RequestLost == \E m \in net : LoseRequest(m)

-----------------------------------------------------------------------------

Next ==
    \/ \E p \in P : Approve(p) \/ Edit(p) \/ ExecStart(p) \/ Submit(p) \/ SendFirst(p) \/ Receive(p)
                    \/ Timeout(p) \/ Lookup(p) \/ Done(p) \/ LoseAnswer(p) \/ Expire(p) \/ Reconcile(p) \/ CloseUnsent(p)
    \/ AirwallexStep
    \/ RequestLost
    \/ Crash
    \/ WebhookStep

\* Purser's own steps, Airwallex's processing, time and the reconciliation are fair; the CFO, the attacker, crashes,
\* losses and webhooks are not.
Fairness ==
    /\ \A p \in P : /\ WF_vars(ExecStart(p)) /\ WF_vars(Submit(p)) /\ WF_vars(SendFirst(p)) /\ WF_vars(Receive(p))
                    /\ WF_vars(Timeout(p)) /\ WF_vars(Lookup(p)) /\ WF_vars(Done(p)) /\ WF_vars(Expire(p))
                    /\ WF_vars(Reconcile(p)) /\ WF_vars(CloseUnsent(p))
    /\ WF_vars(AirwallexStep)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* The properties *)

\* I1. Never paid twice: at most one transfer at Airwallex for the invoice (so also per proposal).
NeverPaidTwice == Cardinality(awx) <= 1

\* I2. Never paid without a valid signature over the exact terms paid.
OnlySignedTermsPaid == \A tr \in awx : <<tr.p, tr.v>> \in signed

\* I3. Webhooks move no money: a webhook step changes no proposal, payout row, Airwallex transfer, request or executor.
WebhooksMoveNoMoney ==
    [][WebhookStep => UNCHANGED <<status, row, rowTr, awx, net, resp, pc, runs, alarm>>]_vars

\* I4. Every payment ends in a known state or goes to a person.
Known(p) ==
    /\ pc[p] = "idle" /\ ~\E m \in net : m.p = p
    /\ \/ /\ status[p] = "EXECUTED" /\ row[p] = "RECORDED"
          /\ \E tr \in awx : tr.id = rowTr[p] /\ tr.p = p
       \/ /\ status[p] = "EXPIRED" /\ row[p] \in {"none", "CANCELLED"}
          /\ ~\E tr \in awx : tr.p = p

EveryPaymentEndsKnownOrWithAPerson == \A p \in P : <>[](Known(p) \/ alarm[p])

\* The ledger never claims a payout Airwallex does not hold.
RecordedIsReal == \A p \in P : row[p] = "RECORDED" => \E tr \in awx : tr.id = rowTr[p] /\ tr.p = p
=============================================================================

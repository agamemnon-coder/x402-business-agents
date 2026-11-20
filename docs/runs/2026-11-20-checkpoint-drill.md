# Checkpoint drill: 2026-11-20

`npm run audit:checkpoint-drill -- record`. Signed audit checkpoints (outside audit 1.4, [security.md](../security.md#signed-audit-checkpoints-20-november-outside-audit-14)) switched on for a runner's ledger file, as the runbook says (PURSER_CHECKPOINT_KEY_FILE, PURSER_CHECKPOINT_FILE), and run through the runner's own code; then each attack the hash chain alone misses, on copies of that ledger and its checkpoint file. Code: `e240c74d4588`; Node v22.22.0 on linux x64; 2026-11-20T14:46:01.235Z to 2026-11-20T14:46:12.203Z. The machine-readable record is docs/runs/2026-11-20-checkpoint-drill.json.

**56 of 56 steps passed, 0 failed.** 6 of 6 attacks refused at every gate and found by `npm run verify-audit`.

## In short

- The runner's ledger: 53 audit rows (8 money rows), 23 signed checkpoints and 8 signed intents, key id `bd9a8a43eae9cf62`.
- The check before a payment (the ledger against its latest checkpoint): median 0.41 ms, max 2.13 ms (25 runs).
- A checkpoint written (checked, signed, appended with fsync): median 1.73 ms, max 1.96 ms (10 runs).
- An agent's whole spend reservation with the gate on (reserveSpend: the check, the hold and its audit row): median 13.17 ms, max 16.61 ms (10 runs).
- Attacks: truncate, rewrite, forged_money_row, checkpoint_file_cut, checkpoint_replayed, wrong_key. After each, the next payment, a loosening policy change (a higher card limit) and a key enrolment were tried; the emergency stop, which moves no money and tightens, was also tried.

## Simulated, and how

- The approver is a labelled virtual test passkey ("checkpoint-drill virtual test passkey (no person's Face ID)", src/redteam/authenticator.ts), enrolled on the drill's own ledger; its signatures go through the same WebAuthn verification as a phone's. No person's Face ID was used.
- The agents' card payments go through the runner's own path (buyPlan, payWithCard: chargeUnderHold, reserveSpend, ingestCardTransaction) against the in-memory Issuing double (src/redteam/issuing.ts), not Airwallex: nothing reached Airwallex, Alta or a phone, and no money, test money included, moved.
- The approved payment is a refund batch whose execution is begun (beginExecution, the gate before any rail call); no rail is called after it.
- The attacks are made on copies of the ledger file and its checkpoint file, by plain SQL and file writes past Purser's code (src/redteam/checkpointAttacks.ts), as someone with write access to both would.
- The checkpoint key is a fresh Ed25519 key made by npm run verify-audit -- keygen in a temporary directory outside the repository, deleted at the end with the drill's ledger files; only its key id is in this record.

## Every step

| Step | What | Result | Detail |
|---|---|---|---|
| `key.made` | an Ed25519 key made by npm run verify-audit -- keygen, outside the repository | pass | key id bd9a8a43eae9cf62, file mode 600 |
| `flow.enrolment` | the CFO's (virtual test) passkey enrolled and an outside agent onboarded, each checked against the latest checkpoint | pass | 3 checkpoint(s) written so far |
| `flow.card_payments` | four card payments by agents through chargeUnderHold and reserveSpend, each money row checkpointed | pass | packwise-starter approved; replyhub-starter approved; ledgerly-starter approved; outside agent approved |
| `flow.approved_payment` | an approved payment's execution begun (the gate before any rail call) | pass | P-9001 approved by the passkey; execution began |
| `flow.policy_change` | the emergency stop pulled and lifted (a loosening change, checked) | pass | stop on, then off, each approved by the passkey |
| `flow.key_enrolment` | an agent's key rotated (a key enrolment, checked) | pass | sourcing agent key rotated |
| `clean.verify_audit` | npm run verify-audit on the runner's ledger: every row's hash and every checkpoint's signature | pass | ok    53 audit rows, 23 checkpoint(s); latest 23 covers 53 rows at 2026-11-20T14:46:03.128Z, key bd9a8a43eae9cf62; pinned bd9a8a43eae9cf62 |
| `clean.health` | /health has no checkpoint alarm on the clean ledger | pass | no audit_checkpoint alarm |
| `attack.truncate.chain_alone` | the last two audit rows cut off the end: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.truncate.payment` | the last two audit rows cut off the end: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (the ledger has 51 rows; checkpoint 23 covers 53: rows were cut off the end (23.5 ms) |
| `attack.truncate.tightening` | the last two audit rows cut off the end: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.truncate.loosening` | the last two audit rows cut off the end: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (row 53 has hash 93213df8fdca…; checkpoint 12 signed 13247e131b34…: |
| `attack.truncate.key_enrolment` | the last two audit rows cut off the end: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (row 53 has hash 93213df8fdca…; checkpoint 12 signed 13247e131b34…: the his |
| `attack.truncate.recorded` | the last two audit rows cut off the end: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.truncate.health` | the last two audit rows cut off the end: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.truncate.verify_audit` | the last two audit rows cut off the end: npm run verify-audit | pass | exit 1; truncated |
| `attack.rewrite.chain_alone` | audit row 3 rewritten and every hash after it recomputed: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.rewrite.payment` | audit row 3 rewritten and every hash after it recomputed: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (row 13 has hash 59fdd59555a9…; checkpoint 3 signed 15e06a394bcf…: the hist (16.11 ms) |
| `attack.rewrite.tightening` | audit row 3 rewritten and every hash after it recomputed: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.rewrite.loosening` | audit row 3 rewritten and every hash after it recomputed: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (row 13 has hash 59fdd59555a9…; checkpoint 3 signed 15e06a394bcf…:  |
| `attack.rewrite.key_enrolment` | audit row 3 rewritten and every hash after it recomputed: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (row 13 has hash 59fdd59555a9…; checkpoint 3 signed 15e06a394bcf…: the hist |
| `attack.rewrite.recorded` | audit row 3 rewritten and every hash after it recomputed: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.rewrite.health` | audit row 3 rewritten and every hash after it recomputed: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.rewrite.verify_audit` | audit row 3 rewritten and every hash after it recomputed: npm run verify-audit | pass | exit 1; rewritten |
| `attack.forged_money_row.chain_alone` | a money row (refund.paid, 500.00) appended after the latest checkpoint: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.forged_money_row.payment` | a money row (refund.paid, 500.00) appended after the latest checkpoint: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (1 money row(s) after checkpoint 23 that no checkpoint covers and no signed (21.18 ms) |
| `attack.forged_money_row.tightening` | a money row (refund.paid, 500.00) appended after the latest checkpoint: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.forged_money_row.loosening` | a money row (refund.paid, 500.00) appended after the latest checkpoint: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (1 money row(s) after checkpoint 23 that no checkpoint covers and n |
| `attack.forged_money_row.key_enrolment` | a money row (refund.paid, 500.00) appended after the latest checkpoint: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (1 money row(s) after checkpoint 23 that no checkpoint covers and no signed |
| `attack.forged_money_row.recorded` | a money row (refund.paid, 500.00) appended after the latest checkpoint: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.forged_money_row.health` | a money row (refund.paid, 500.00) appended after the latest checkpoint: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.forged_money_row.verify_audit` | a money row (refund.paid, 500.00) appended after the latest checkpoint: npm run verify-audit | pass | exit 1; uncovered_money |
| `attack.checkpoint_file_cut.chain_alone` | the checkpoint file cut back to its first checkpoint: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.checkpoint_file_cut.payment` | the checkpoint file cut back to its first checkpoint: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (8 money row(s) after checkpoint 1 that no checkpoint covers and no signed  (5.81 ms) |
| `attack.checkpoint_file_cut.tightening` | the checkpoint file cut back to its first checkpoint: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.checkpoint_file_cut.loosening` | the checkpoint file cut back to its first checkpoint: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (8 money row(s) after checkpoint 1 that no checkpoint covers and no |
| `attack.checkpoint_file_cut.key_enrolment` | the checkpoint file cut back to its first checkpoint: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (8 money row(s) after checkpoint 1 that no checkpoint covers and no signed  |
| `attack.checkpoint_file_cut.recorded` | the checkpoint file cut back to its first checkpoint: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.checkpoint_file_cut.health` | the checkpoint file cut back to its first checkpoint: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.checkpoint_file_cut.verify_audit` | the checkpoint file cut back to its first checkpoint: npm run verify-audit | pass | exit 1; uncovered_money |
| `attack.checkpoint_replayed.chain_alone` | an old checkpoint appended again as the latest: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.checkpoint_replayed.payment` | an old checkpoint appended again as the latest: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 2 comes after checkpoint 23: an old checkpoint presented again  (15.83 ms) |
| `attack.checkpoint_replayed.tightening` | an old checkpoint appended again as the latest: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.checkpoint_replayed.loosening` | an old checkpoint appended again as the latest: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 2 comes after checkpoint 23: an old checkpoint presente |
| `attack.checkpoint_replayed.key_enrolment` | an old checkpoint appended again as the latest: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 2 comes after checkpoint 23: an old checkpoint presented again  |
| `attack.checkpoint_replayed.recorded` | an old checkpoint appended again as the latest: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.checkpoint_replayed.health` | an old checkpoint appended again as the latest: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.checkpoint_replayed.verify_audit` | an old checkpoint appended again as the latest: npm run verify-audit | pass | exit 1; replay |
| `attack.wrong_key.chain_alone` | a forged row covered by a checkpoint signed with a key the chain never introduced: the hash chain's own check | pass | the chain alone passes (the hole checkpoints close) |
| `attack.wrong_key.payment` | a forged row covered by a checkpoint signed with a key the chain never introduced: the next payment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 24 is signed by key 70a0de0cf756fc81, which no checkpoint intro (8.79 ms) |
| `attack.wrong_key.tightening` | a forged row covered by a checkpoint signed with a key the chain never introduced: the emergency stop (moves no money, tightens) still runs | pass | ran |
| `attack.wrong_key.loosening` | a forged row covered by a checkpoint signed with a key the chain never introduced: a higher card limit (a loosening policy change) | pass | P-0006: audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 24 is signed by key 70a0de0cf756fc81, which no checkpoi |
| `attack.wrong_key.key_enrolment` | a forged row covered by a checkpoint signed with a key the chain never introduced: an agent key enrolment | pass | audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (checkpoint 24 is signed by key 70a0de0cf756fc81, which no checkpoint intro |
| `attack.wrong_key.recorded` | a forged row covered by a checkpoint signed with a key the chain never introduced: audit.checkpoint_refused recorded for each | pass | refused ops recorded: payment, policy change, key enrolment |
| `attack.wrong_key.health` | a forged row covered by a checkpoint signed with a key the chain never introduced: /health raises the critical alarm | pass | audit_checkpoint_mismatch (critical), audit_checkpoint_refused (critical) |
| `attack.wrong_key.verify_audit` | a forged row covered by a checkpoint signed with a key the chain never introduced: npm run verify-audit | pass | exit 1; unknown_key |

## Not shown here

- Purser Cloud's hosted engine (Durable Objects, purser-try) does not run checkpoints: they are the self-hosted runner's (a ledger file and a checkpoint file on disk). See docs/security.md.
- A non-money row forged between two checkpoints, and a fresh process shown a checkpoint file cut back together with a ledger rewound to match, are the limits docs/security.md names; the second is found only against a copy of the file kept elsewhere (`npm run verify-audit -- --known <copy>`).

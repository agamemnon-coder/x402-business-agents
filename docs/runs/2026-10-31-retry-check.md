# Retry check, 31 October: did the RETRY bug ever pay a refund nobody approved?

**Answer: no.** The fresh review of the agents work (fixed in `eff08b4`) found that `s2`'s RETRY could start a refund
for a sale that had none yet, so a refund waiting for Face ID could be paid without it. This check looks at every
earlier run to see whether that ever happened.

## How

Every ledger in `data/*.sqlite` (this repo) and `entries/airwallex/*.sqlite` (the rewards repo), plus the recorded
run's audit log `docs/audit/friday-1-audit.jsonl`. Each ledger was copied first and the copy opened read-only, so no
original was touched. For every refund marked PAID (in the `refunds` table or as a `refund.paid` audit row) the check
looks for one of the three routes that allow it:

- **auto**: the sale is in a `refund.auto_approved` row (wrong data, inside the automatic limit);
- **batch**: the sale is in a `refund_batch` proposal that was approved and executed;
- **agent**: the Support agent's own `refund` call for that order, not blocked by code (agents-on runs only).

A paid refund with none of these would be the bug. On the chain side, `npm run verify` already checks every refund
pull against its mandate and the ledger in each recorded run (friday-1, friday-2, eind-1, eind-2: all checks pass,
see their run logs).

## Result

```text
ok         b1-world.sqlite                          paid 0, auto 0, batch 0
ok         compliance-policy.sqlite                 paid 0, auto 0, batch 0
ok         dry-1-four-eyes.sqlite                   paid 0, auto 0, batch 0
ok         dry-1.sqlite                             paid 3, auto 3, batch 0
ok         dry-10.sqlite                            paid 3, auto 3, batch 0
ok         dry-11.sqlite                            paid 3, auto 3, batch 0
ok         dry-12.sqlite                            paid 3, auto 3, batch 0
ok         dry-13.sqlite                            paid 0, auto 0, batch 0
ok         dry-14.sqlite                            paid 3, auto 0, batch 0, agent 7/10/13
ok         dry-15.sqlite                            paid 3, auto 0, batch 0, agent 7/10/13
ok         dry-16.sqlite                            paid 3, auto 3, batch 0
ok         dry-17.sqlite                            paid 3, auto 0, batch 0, agent 7/10/13
ok         dry-2.sqlite                             paid 0, auto 0, batch 0
ok         dry-6.sqlite                             paid 3, auto 3, batch 0
ok         dry-run-four-eyes.sqlite                 paid 0, auto 0, batch 0
ok         eind-1.sqlite                            paid 3, auto 3, batch 0
ok         eind-2.sqlite                            paid 12, auto 3, batch 9
ok         four-eyes.sqlite                         paid 0, auto 0, batch 0
ok         friday-1.sqlite                          paid 3, auto 3, batch 0
ok         friday-2.sqlite                          paid 12, auto 3, batch 9
ok         hooks-1.sqlite                           paid 3, auto 3, batch 0
ok         kit11.sqlite                             paid 3, auto 3, batch 0
ok         playground.sqlite                        paid 12, auto 3, batch 9
ok         rehearsal-3.sqlite                       paid 3, auto 3, batch 0
ok         rehearsal-4.sqlite                       paid 0, auto 0, batch 0
ok         rehearsal-5.sqlite                       paid 0, auto 0, batch 0
ok         rehearsal-6.sqlite                       paid 0, auto 0, batch 0
ok         dev-ledger-2026-10-29.sqlite             paid 3, auto 3, batch 0
ok         rehearsal-1-ledger.sqlite                paid 3, auto 3, batch 0
ok         rehearsal-2-ledger.sqlite                paid 3, auto 3, batch 0
ok         rehearsal-3-ledger.sqlite                paid 3, auto 3, batch 0
ok         friday-1-audit.jsonl (the recording)     paid 3, auto 3, batch 0
```

32 sources, 0 uncovered refunds. The agents-on dry runs (14, 15, 17) refunded exactly #7, #10 and #13, the three
orders with wrong data, each through the agent's own call.

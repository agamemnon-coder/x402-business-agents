# Purser for the finance team

> Supplier invoices in; checked, paid inside the CFO's limits, booked and ready for VAT and month-end. No payment leaves
> without a rule in code or the CFO's signature over its exact terms.

![Purser for the finance team, at a glance: 0 wrong payments against 35 for a payer with no rules (50 test cases); about USD 0.05 of Claude per invoice (a month of 20 test PDFs, USD 1.02 in all); 95 journal entries read back from T:0, 9 accounts, 0 differences; 6.3 s from the CFO's passkey to PAID (Airwallex sandbox, settlement simulated); one cent changed after signing: refused; SWIFT fee EUR 13.42 and EUR 13.50, EUR 20.00 reserved. Test money, sandbox.](assets/finance/at-a-glance.svg)

**Who:** the CFO or finance lead of a small company that banks with Airwallex and pays suppliers abroad. In the test
runs: Dutch books, a German supplier paid in EUR. The buyer is a hypothesis ([business/model.md](business/model.md)).
Test money only; every figure links its record.

## The job, step by step

| Step | What Purser does | Who decides | Code |
|---|---|---|---|
| Invoice in | Claude reads the PDF: supplier, amounts, VAT, due date, bank details | Agent | [src/ap/inbox.ts](../src/ap/inbox.ts) |
| Checked | Supplier and IBAN on file, totals, duplicates, due date, hidden instructions | The Checker agent proposes; code enforces | [src/ap/checkerCore.ts](../src/ap/checkerCore.ts) |
| Approved | Above the agent's limit, the CFO's passkey signs the SHA-256 of the exact terms (amount, payee, FX quote); one cent changed is refused | The CFO | [src/policy/approvals.ts](../src/policy/approvals.ts) |
| Paid | The Payer picks rail (local or SWIFT), day and currency; the Airwallex transfer carries the signed hash | Code enforces | [src/ap/payerCore.ts](../src/ap/payerCore.ts) |
| Booked | Double-entry, hash-chained: expense, VAT, creditors, fee | Code | [src/ap/books.ts](../src/ap/books.ts) |
| VAT, month-end | VAT overview by return rubric; the month locks only when an outside ledger agrees | A person closes; code checks | [src/ledger/close.ts](../src/ledger/close.ts) |

## Measured per invoice

| What | Figure | Record |
|---|---|---|
| Claude, /try's one sample invoice (read, check, code, plan the payment; all Claude Haiku 5.5) | USD 0.0025 (324 + 713 + 788 + 638 micro-USD) | [runs/2026-11-13-try-sample.json](runs/2026-11-13-try-sample.json) |
| Claude, a month of 20 test invoices as PDFs (16 paid, 4 sent to a person, books balanced): the figure to plan with | USD 1.02 in all, about USD 0.05 an invoice | [runs/2026-11-13-books-month.json](runs/2026-11-13-books-month.json) |
| Checker, Payer and Coder on Haiku, eval cases | USD 0.0006 an invoice each; Checker p50 3.9 s | [agent-evals.md](agent-evals.md) |
| Deployed /try (purser-try), start to PAID (bot speed, virtual passkey, simulated bank) | 17.9 to 25.7 s, 10 runs | [evidence/try-timed-2026-11-15.json](evidence/try-timed-2026-11-15.json) |
| Airwallex sandbox: CFO's Face ID to PAID (settlement simulated) | 6.3 s and 6.4 s | [runs/2026-11-07-awx-1.md](runs/2026-11-07-awx-1.md) |
| SWIFT fee, Airwallex sandbox | EUR 13.42 on EUR 240.00 (3 Nov); EUR 13.50 twice (7 Nov); known only after sending, so EUR 20.00 is reserved. /try's simulated bank: a flat EUR 13.40 | [runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md), [awx-1](runs/2026-11-07-awx-1.md) |
| FX: only the shortfall, on a quote inside the signed terms | EUR 623.50 for USD 704.45, 8 bps over market, signed within the quote's window | [awx-1](runs/2026-11-07-awx-1.md) |

## Controls a finance team already uses

- **Four eyes above a threshold:** `approval.four_eyes_eur`; two different people, never the proposer ([src/policy/fourEyes.ts](../src/policy/fourEyes.ts)). In the main run, the second signature from a test passkey, not a second person.
- **Segregation of duties:** agents propose, never approve; only a person clears a possible duplicate ([src/ap/inbox.ts](../src/ap/inbox.ts)).
- **Payee verification:** Airwallex's `verify_account` before a new supplier or bank change reaches the CFO; run in the sandbox on 12 Nov, behind a switch that is off by default ([record](runs/2026-11-12-airwallex-payee-check.md)).
- **Duplicates:** the same invoice is paid once ([test](../test/invoice-duplicate-key.test.ts)); the same supplier and total within 45 days waits for a person.
- **Cash floor:** available = balance − holds − payouts under way ([src/policy/available.ts](../src/policy/available.ts)); a payment below the floor is held.
- **Due dates:** the Payer may pay later, never past the due date unless the policy allows it; [/try/negotiate](https://kit11.max-31b.workers.dev/try/negotiate) agrees an early-payment discount (the supplier's agent simulated).
- **Returned payouts:** a payout that fails after PAID is booked back and its invoice goes to a person; tested ([test](../test/payout-returned.test.ts)), not run live.

## The books

- **VAT:** Dutch input VAT on 1510; VAT a supplier abroad charged (German 19%) on 1515, to reclaim through the EU refund ([src/ap/books.ts](../src/ap/books.ts)). A quarterly overview by return rubric, not a filing ([src/ledger/vat.ts](../src/ledger/vat.ts)).
- **Month-end with T:0:** the main run's 95 journal entries posted to T:0's sandbox ledger (10 Nov) and read back (14 Nov): 9 accounts, 0 differences ([record](runs/2026-11-14-t0-readback.md)).
- **Exports:** CSV ([src/ledger/export.ts](../src/ledger/export.ts)), the accountant's month ([src/ledger/accountantExport.ts](../src/ledger/accountantExport.ts)), ISO 20022 pacs.008, schema-checked ([example](iso20022/pacs008-BTX-2026-11.xml)).

## Worst case, before and after

Offline eval, test data, 50 cases ([worst-case-ai.md](worst-case-ai.md)):

| | A payer with no rules | Purser, a script that always says pay in the AI's place |
|---|---|---|
| Wrong payments | 35 | 0 |
| Wrong money | EUR 45,528.51, GBP 1,920.00, 306.00 with no currency read | none |
| Paid past the CFO | 12 | 0 |
| Sent to the CFO instead of held | 0 | 7 |

## What is not proven yet

Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous);
more in progress; no pilots, no revenue. Sandbox and simulated bank only, so no gross margin is computed
([business/model.md](business/model.md#no-margin-computed-pilot)). VAT coding is not yet reliable alone: on 35 test
invoices the Coder on Haiku chose the expected VAT code on 68.6%, Sonnet on 91.4% ([agent-evals.md](agent-evals.md)).

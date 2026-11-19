# Tamper matrix

Made by `npm run tamper-matrix` (src/cli/tamperMatrix.ts, the changes in src/proof/tamperMatrix.ts, tested in
test/tamper-matrix.test.ts). Offline: no network, no key of ours.

## How it is done

1. **What is tested.** Every signed receipt (`purser.try-sign-receipt/v1`, what `npm run verify-receipt` checks) and
   proof bundle (`purser.proof-bundle/v1`, what `npm run verify-bundle` and the /verify page check) committed in the
   repository: every JSON file git tracks is searched, at any depth. One found twice (a sample file and a record that
   embeds it) is tested once, and both places are named.
2. **The changes.** Every value inside the signed terms, at any depth, changed by the smallest step: money ±0.01; a
   rate one digit; a currency code another one; a time +1 second, a date +1 day; any other string (the payee's name,
   the IBAN's or account's digits, the beneficiary id, the FX quote id, a reference, an evidence hash) one character
   (its last digit, else its last letter); true/false flipped; null given a value. Then each top-level field removed,
   and one field added.
3. **Two tries per change.** *Hash kept*: the terms changed, `terms_sha256` left as signed. *Hash recomputed*: the
   terms changed and `terms_sha256` (and a bundle's `canonical` text) rewritten to match them, as a forger would; then
   only the passkey's challenge and signature stand in the way.
4. **The envelope.** Four changes outside the terms: one byte of the signature flipped, the authenticator's
   user-verified flag cleared, the RP id and the origin set to another site.
5. **The verifier.** Each copy goes through the function the command runs: `verifyReceipt` (src/try/receipt.ts) or
   `verifyProofBundle` (src/proof/bundle.ts, the same text the /verify page runs). Refused means at least one check
   failed; the checks that failed are listed. The command line itself is also run on each original (expected exit 0)
   and on its first changed copy (expected exit 1).

What this shows: a changed cent, digit, name, id or date in any of these files is caught by the verifier, and so is
a forger's recomputed hash. What it does not show: who holds the passkey, or anything about artifacts not committed here.

## Totals

| | |
|---|---|
| Signed artifacts tested | 6 (2 receipts, 4 proof bundles) |
| Originals that verify | 6 of 6 |
| Changed copies tried | 894 |
| Refused | 894 |
| **Accepted** | **0** |
| Command line, exit codes as expected | 12 of 12 |

No changed copy was accepted: 894 of 894 refused, and all 6 originals verify.

## The command line

| File | Run on | Exit | Expected |
|---|---|---|---|
| docs/film/under-the-hood/record.json ($.pays[1].answer.proof) | npm run verify-bundle on the original | 0 | 0 |
| docs/film/under-the-hood/record.json ($.pays[1].answer.proof) | npm run verify-bundle on terms.amount +0.01, hash recomputed | 1 | 1 |
| docs/film/under-the-hood/try-proof.json | npm run verify-bundle on the original | 0 | 0 |
| docs/film/under-the-hood/try-proof.json | npm run verify-bundle on terms.amount +0.01, hash recomputed | 1 | 1 |
| docs/proof/try-paid.json | npm run verify-bundle on the original | 0 | 0 |
| docs/proof/try-paid.json | npm run verify-bundle on terms.amount +0.01, hash recomputed | 1 | 1 |
| docs/proof/try-refused.json | npm run verify-bundle on the original | 0 | 0 |
| docs/proof/try-refused.json | npm run verify-bundle on terms.amount +0.01, hash recomputed | 1 | 1 |
| docs/runs/2026-11-07-awx-1/receipt-P-0002.json | npm run verify-receipt on the original | 0 | 0 |
| docs/runs/2026-11-07-awx-1/receipt-P-0002.json | npm run verify-receipt on terms.amount +0.01, hash recomputed | 1 | 1 |
| docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json | npm run verify-receipt on the original | 0 | 0 |
| docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json | npm run verify-receipt on terms.amount +0.01, hash recomputed | 1 | 1 |

## Proof bundle: docs/film/under-the-hood/record.json ($.pays[1].answer.proof)

Proposal P-0001, terms hash `58b8dd275759f5cfb02e02779a7e3c411746d09d824197913f99ef7d5c666ead`. Original: **verifies**. Changes: 158 tried, 158 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | one letter | "invoice_payment" → "invoice_paymenu" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | one digit | "P-0001" → "P-0002" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | +1 second | "2026-11-15T04:40:06Z" → "2026-11-15T04:40:07Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | +0.01 | "1850.00" → "1850.01" | refused (terms hash, challenge, decision, asked terms) | refused (challenge, decision, asked terms) |
| `terms.amount` | −0.01 | "1850.00" → "1849.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | +0.01 | "20.00" → "20.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | −0.01 | "20.00" → "19.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | one digit | "ben_2" → "ben_3" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | one digit | "3000" → "3001" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | one letter | "COBADEFFXXX" → "COBADEFFXXY" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | one letter | "SWIFT" → "SWIFU" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | one digit | "BTX-2026-21" → "BTX-2026-22" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | one letter | "goods_purchased" → "goods_purchasee" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | one digit | "a0868db8-58fb-4f5c-a73b-b3ce45d34121" → "a0868db8-58fb-4f5c-a73b-b3ce45d34122" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.request_id` | one digit | "d6fd0985-fe02-4e30-9b0b-b9a014bff6be" → "d6fd0985-fe02-4e30-9b0b-b9a014bff7be" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.quote_id` | one digit | "d7e941bc-da97-3e15-b07e-566136737840" → "d7e941bc-da97-3e15-b07e-566136737841" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.client_rate` | last digit | "1.117256" → "1.117257" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.valid_to` | +1 second | "2026-11-15T04:40:36.000Z" → "2026-11-15T04:40:37.000Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | +0.01 | "370.00" → "370.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | −0.01 | "370.00" → "369.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_currency` | currency USD → EUR | "USD" → "EUR" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | +0.01 | "413.38" → "413.39" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | −0.01 | "413.38" → "413.37" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | +0.01 | "35000.00" → "35000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | −0.01 | "35000.00" → "34999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | +0.01 | "8500.00" → "8500.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | −0.01 | "8500.00" → "8499.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | +0.01 | "20000.00" → "20000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | −0.01 | "20000.00" → "19999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | +0.01 | "0.00" → "0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | −0.01 | "0.00" → "-0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | +0.01 | "24586.62" → "24586.63" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | −0.01 | "24586.62" → "24586.61" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].ref` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].sha256` | one digit | "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" → "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | one digit | "Total due EUR 1,850.00" → "Total due EUR 1,850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | true → false | true → false | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | one letter | "payables_inbox" → "payables_inboy" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | field removed | "invoice_payment" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | field removed | "P-0001" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | field removed | "2026-11-15T04:40:06Z" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | field removed | "BTX-2026-21 · Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | field removed | "1850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | field removed | "20.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | field removed | "ben_2" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | field removed | "3000" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | field removed | "COBADEFFXXX" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | field removed | "SWIFT" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | field removed | "BTX-2026-21" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | field removed | "goods_purchased" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | field removed | "a0868db8-58fb-4f5c-a73b-b3ce45d34121" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion` | field removed | {"request_id":"d6fd0985-fe02-4e30-9b0b-b9a014…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before` | field removed | {"eur_available":"35000.00","usd_available":"…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors` | field removed | {"eur_floor":"25000.00","eur_obligations":"85…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after` | field removed | {"eur_free":"0.00","usd_available":"24586.62"} → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"BTX-2026-21 · Bergt…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | field removed | "Total due EUR 1,850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | field removed | true → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | field removed | "payables_inbox" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash, challenge, decision) | refused (challenge, decision) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (rp id) |
| `origin` | another site | refused (client data) |

## Proof bundle: docs/film/under-the-hood/try-proof.json

The same artifact is also at: docs/film/under-the-hood/record.json ($.pays[0].answer.proof).

Proposal P-0001, terms hash `58b8dd275759f5cfb02e02779a7e3c411746d09d824197913f99ef7d5c666ead`. Original: **verifies**. Changes: 158 tried, 158 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | one letter | "invoice_payment" → "invoice_paymenu" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | one digit | "P-0001" → "P-0002" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | +1 second | "2026-11-15T04:40:06Z" → "2026-11-15T04:40:07Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | +0.01 | "1850.00" → "1850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | −0.01 | "1850.00" → "1849.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | +0.01 | "20.00" → "20.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | −0.01 | "20.00" → "19.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | one digit | "ben_2" → "ben_3" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | one digit | "3000" → "3001" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | one letter | "COBADEFFXXX" → "COBADEFFXXY" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | one letter | "SWIFT" → "SWIFU" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | one digit | "BTX-2026-21" → "BTX-2026-22" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | one letter | "goods_purchased" → "goods_purchasee" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | one digit | "a0868db8-58fb-4f5c-a73b-b3ce45d34121" → "a0868db8-58fb-4f5c-a73b-b3ce45d34122" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.request_id` | one digit | "d6fd0985-fe02-4e30-9b0b-b9a014bff6be" → "d6fd0985-fe02-4e30-9b0b-b9a014bff7be" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.quote_id` | one digit | "d7e941bc-da97-3e15-b07e-566136737840" → "d7e941bc-da97-3e15-b07e-566136737841" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.client_rate` | last digit | "1.117256" → "1.117257" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.valid_to` | +1 second | "2026-11-15T04:40:36.000Z" → "2026-11-15T04:40:37.000Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | +0.01 | "370.00" → "370.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | −0.01 | "370.00" → "369.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_currency` | currency USD → EUR | "USD" → "EUR" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | +0.01 | "413.38" → "413.39" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | −0.01 | "413.38" → "413.37" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | +0.01 | "35000.00" → "35000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | −0.01 | "35000.00" → "34999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | +0.01 | "8500.00" → "8500.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | −0.01 | "8500.00" → "8499.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | +0.01 | "20000.00" → "20000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | −0.01 | "20000.00" → "19999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | +0.01 | "0.00" → "0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | −0.01 | "0.00" → "-0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | +0.01 | "24586.62" → "24586.63" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | −0.01 | "24586.62" → "24586.61" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].ref` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].sha256` | one digit | "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" → "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | one digit | "Total due EUR 1,850.00" → "Total due EUR 1,850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | true → false | true → false | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | one letter | "payables_inbox" → "payables_inboy" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | field removed | "invoice_payment" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | field removed | "P-0001" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | field removed | "2026-11-15T04:40:06Z" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | field removed | "BTX-2026-21 · Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | field removed | "1850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | field removed | "20.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | field removed | "ben_2" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | field removed | "3000" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | field removed | "COBADEFFXXX" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | field removed | "SWIFT" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | field removed | "BTX-2026-21" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | field removed | "goods_purchased" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | field removed | "a0868db8-58fb-4f5c-a73b-b3ce45d34121" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion` | field removed | {"request_id":"d6fd0985-fe02-4e30-9b0b-b9a014…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before` | field removed | {"eur_available":"35000.00","usd_available":"…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors` | field removed | {"eur_floor":"25000.00","eur_obligations":"85…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after` | field removed | {"eur_free":"0.00","usd_available":"24586.62"} → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"BTX-2026-21 · Bergt…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | field removed | "Total due EUR 1,850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | field removed | true → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | field removed | "payables_inbox" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash, challenge, decision) | refused (challenge, decision) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (rp id) |
| `origin` | another site | refused (client data) |

## Proof bundle: docs/proof/try-paid.json

Proposal P-0001, terms hash `f168e40f21bddcbb0d8228b927023abaf8702bb6071c5b709732b959d8aeec5d`. Original: **verifies**. Changes: 158 tried, 158 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | one letter | "invoice_payment" → "invoice_paymenu" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | one digit | "P-0001" → "P-0002" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | +1 second | "2026-11-15T04:40:32Z" → "2026-11-15T04:40:33Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | +0.01 | "1850.00" → "1850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | −0.01 | "1850.00" → "1849.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | +0.01 | "20.00" → "20.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | −0.01 | "20.00" → "19.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | one digit | "ben_2" → "ben_3" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | one digit | "3000" → "3001" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | one letter | "COBADEFFXXX" → "COBADEFFXXY" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | one letter | "SWIFT" → "SWIFU" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | one digit | "BTX-2026-21" → "BTX-2026-22" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | one letter | "goods_purchased" → "goods_purchasee" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | one digit | "af3a6c83-f895-4619-b340-9dfe5cad4c05" → "af3a6c83-f895-4619-b340-9dfe5cad4c06" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.request_id` | one digit | "ac8fda70-707c-4da8-9a94-68f3a47012e8" → "ac8fda70-707c-4da8-9a94-68f3a47012e9" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.quote_id` | one digit | "047b82a3-24ee-3ba6-83e7-88a9f3c0f561" → "047b82a3-24ee-3ba6-83e7-88a9f3c0f562" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.client_rate` | last digit | "1.117256" → "1.117257" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.valid_to` | +1 second | "2026-11-15T04:41:02.000Z" → "2026-11-15T04:41:03.000Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | +0.01 | "370.00" → "370.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | −0.01 | "370.00" → "369.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_currency` | currency USD → EUR | "USD" → "EUR" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | +0.01 | "413.38" → "413.39" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | −0.01 | "413.38" → "413.37" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | +0.01 | "35000.00" → "35000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | −0.01 | "35000.00" → "34999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | +0.01 | "8500.00" → "8500.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | −0.01 | "8500.00" → "8499.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | +0.01 | "20000.00" → "20000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | −0.01 | "20000.00" → "19999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | +0.01 | "0.00" → "0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | −0.01 | "0.00" → "-0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | +0.01 | "24586.62" → "24586.63" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | −0.01 | "24586.62" → "24586.61" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].ref` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].sha256` | one digit | "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" → "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | one digit | "Total due EUR 1,850.00" → "Total due EUR 1,850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | true → false | true → false | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | one letter | "payables_inbox" → "payables_inboy" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | field removed | "invoice_payment" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | field removed | "P-0001" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | field removed | "2026-11-15T04:40:32Z" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | field removed | "BTX-2026-21 · Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | field removed | "1850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | field removed | "20.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | field removed | "ben_2" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | field removed | "3000" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | field removed | "COBADEFFXXX" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | field removed | "SWIFT" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | field removed | "BTX-2026-21" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | field removed | "goods_purchased" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | field removed | "af3a6c83-f895-4619-b340-9dfe5cad4c05" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion` | field removed | {"request_id":"ac8fda70-707c-4da8-9a94-68f3a4…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before` | field removed | {"eur_available":"35000.00","usd_available":"…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors` | field removed | {"eur_floor":"25000.00","eur_obligations":"85…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after` | field removed | {"eur_free":"0.00","usd_available":"24586.62"} → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"BTX-2026-21 · Bergt…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | field removed | "Total due EUR 1,850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | field removed | true → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | field removed | "payables_inbox" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash, challenge, decision) | refused (challenge, decision) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (rp id) |
| `origin` | another site | refused (client data) |

## Proof bundle: docs/proof/try-refused.json

Proposal P-0001, terms hash `f168e40f21bddcbb0d8228b927023abaf8702bb6071c5b709732b959d8aeec5d`. Original: **verifies**. Changes: 158 tried, 158 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | one letter | "invoice_payment" → "invoice_paymenu" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | one digit | "P-0001" → "P-0002" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | +1 second | "2026-11-15T04:40:32Z" → "2026-11-15T04:40:33Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | +0.01 | "1850.00" → "1850.01" | refused (terms hash, challenge, decision, asked terms) | refused (challenge, decision, asked terms) |
| `terms.amount` | −0.01 | "1850.00" → "1849.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | +0.01 | "20.00" → "20.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | −0.01 | "20.00" → "19.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | one digit | "ben_2" → "ben_3" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | one letter | "Bergtex Textil GmbH" → "Bergtex Textil GmbI" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | one digit | "3000" → "3001" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | one letter | "COBADEFFXXX" → "COBADEFFXXY" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | one letter | "SWIFT" → "SWIFU" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | one digit | "BTX-2026-21" → "BTX-2026-22" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | one letter | "goods_purchased" → "goods_purchasee" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | one digit | "af3a6c83-f895-4619-b340-9dfe5cad4c05" → "af3a6c83-f895-4619-b340-9dfe5cad4c06" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.request_id` | one digit | "ac8fda70-707c-4da8-9a94-68f3a47012e8" → "ac8fda70-707c-4da8-9a94-68f3a47012e9" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.quote_id` | one digit | "047b82a3-24ee-3ba6-83e7-88a9f3c0f561" → "047b82a3-24ee-3ba6-83e7-88a9f3c0f562" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.client_rate` | last digit | "1.117256" → "1.117257" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.valid_to` | +1 second | "2026-11-15T04:41:02.000Z" → "2026-11-15T04:41:03.000Z" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | +0.01 | "370.00" → "370.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.buy_amount` | −0.01 | "370.00" → "369.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_currency` | currency USD → EUR | "USD" → "EUR" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | +0.01 | "413.38" → "413.39" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion.sell_amount` | −0.01 | "413.38" → "413.37" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | +0.01 | "35000.00" → "35000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.eur_available` | −0.01 | "35000.00" → "34999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before.usd_available` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | +0.01 | "25000.00" → "25000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_floor` | −0.01 | "25000.00" → "24999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | +0.01 | "8500.00" → "8500.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.eur_obligations` | −0.01 | "8500.00" → "8499.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | +0.01 | "20000.00" → "20000.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors.usd_floor` | −0.01 | "20000.00" → "19999.99" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | +0.01 | "0.00" → "0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.eur_free` | −0.01 | "0.00" → "-0.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | +0.01 | "24586.62" → "24586.63" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after.usd_available` | −0.01 | "24586.62" → "24586.61" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].ref` | one digit | "BTX-2026-21 · Bergtex Textil GmbH" → "BTX-2026-22 · Bergtex Textil GmbH" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence[0].sha256` | one digit | "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" → "71dc0539b893d3613328b164ef280f7d52c8eb5d87b1…" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | one digit | "Total due EUR 1,850.00" → "Total due EUR 1,850.01" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | true → false | true → false | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | one letter | "payables_inbox" → "payables_inboy" | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.kind` | field removed | "invoice_payment" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.proposal_id` | field removed | "P-0001" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.expires_at` | field removed | "2026-11-15T04:40:32Z" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.invoice_no` | field removed | "BTX-2026-21 · Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.vendor` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.amount` | field removed | "1850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.fee_max` | field removed | "20.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_id` | field removed | "ben_2" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.beneficiary_name` | field removed | "Bergtex Textil GmbH" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.iban_last4` | field removed | "3000" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.bic` | field removed | "COBADEFFXXX" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.method` | field removed | "SWIFT" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reference` | field removed | "BTX-2026-21" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.reason` | field removed | "goods_purchased" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.transfer_request_id` | field removed | "af3a6c83-f895-4619-b340-9dfe5cad4c05" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.conversion` | field removed | {"request_id":"ac8fda70-707c-4da8-9a94-68f3a4…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.balances_before` | field removed | {"eur_available":"35000.00","usd_available":"…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.floors` | field removed | {"eur_floor":"25000.00","eur_obligations":"85…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.after` | field removed | {"eur_free":"0.00","usd_available":"24586.62"} → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"BTX-2026-21 · Bergt…" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_total_line` | field removed | "Total due EUR 1,850.00" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.document_currency` | field removed | "EUR" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.test_money` | field removed | true → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.source` | field removed | "payables_inbox" → (absent) | refused (terms hash, challenge, decision) | refused (challenge, decision) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash, challenge, decision) | refused (challenge, decision) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (rp id) |
| `origin` | another site | refused (client data) |

## Receipt: docs/runs/2026-11-07-awx-1/receipt-P-0002.json

Proposal P-0002, terms hash `b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb`. Original: **verifies**. Changes: 124 tried, 124 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash) | refused (challenge) |
| `terms.kind` | one letter | "invoice_payment" → "invoice_paymenu" | refused (terms hash) | refused (challenge) |
| `terms.proposal_id` | one digit | "P-0002" → "P-0003" | refused (terms hash) | refused (challenge) |
| `terms.expires_at` | +1 second | "2026-11-07T12:31:13Z" → "2026-11-07T12:31:14Z" | refused (terms hash) | refused (challenge) |
| `terms.invoice_no` | one digit | "SLL-2026-11" → "SLL-2026-12" | refused (terms hash) | refused (challenge) |
| `terms.vendor` | one letter | "Stockline Data GmbH" → "Stockline Data GmbI" | refused (terms hash) | refused (challenge) |
| `terms.amount` | +0.01 | "240.00" → "240.01" | refused (terms hash) | refused (challenge) |
| `terms.amount` | −0.01 | "240.00" → "239.99" | refused (terms hash) | refused (challenge) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash) | refused (challenge) |
| `terms.fee_max` | +0.01 | "20.00" → "20.01" | refused (terms hash) | refused (challenge) |
| `terms.fee_max` | −0.01 | "20.00" → "19.99" | refused (terms hash) | refused (challenge) |
| `terms.beneficiary_id` | one digit | "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb" → "46c2bbca-8b37-4ac9-ad3e-ef975dd36eeb" | refused (terms hash) | refused (challenge) |
| `terms.beneficiary_name` | one letter | "Stockline Data GmbH" → "Stockline Data GmbI" | refused (terms hash) | refused (challenge) |
| `terms.iban_last4` | one digit | "2051" → "2052" | refused (terms hash) | refused (challenge) |
| `terms.bic` | one digit | "BYLADEM1001" → "BYLADEM1002" | refused (terms hash) | refused (challenge) |
| `terms.method` | one letter | "SWIFT" → "SWIFU" | refused (terms hash) | refused (challenge) |
| `terms.reference` | one digit | "SLL-2026-11" → "SLL-2026-12" | refused (terms hash) | refused (challenge) |
| `terms.reason` | one letter | "professional_business_services" → "professional_business_servicet" | refused (terms hash) | refused (challenge) |
| `terms.transfer_request_id` | one digit | "0439af88-a9c7-45f6-8d15-d15f66b70f0e" → "0439af88-a9c7-45f6-8d15-d15f66b70f1e" | refused (terms hash) | refused (challenge) |
| `terms.conversion` | null → a value | null → "1" | refused (terms hash) | refused (challenge) |
| `terms.balances_before.eur_available` | +0.01 | "9968920.73" → "9968920.74" | refused (terms hash) | refused (challenge) |
| `terms.balances_before.eur_available` | −0.01 | "9968920.73" → "9968920.72" | refused (terms hash) | refused (challenge) |
| `terms.balances_before.usd_available` | +0.01 | "9995334.64" → "9995334.65" | refused (terms hash) | refused (challenge) |
| `terms.balances_before.usd_available` | −0.01 | "9995334.64" → "9995334.63" | refused (terms hash) | refused (challenge) |
| `terms.floors.eur_floor` | +0.01 | "25000.00" → "25000.01" | refused (terms hash) | refused (challenge) |
| `terms.floors.eur_floor` | −0.01 | "25000.00" → "24999.99" | refused (terms hash) | refused (challenge) |
| `terms.floors.eur_obligations` | +0.01 | "9942420.73" → "9942420.74" | refused (terms hash) | refused (challenge) |
| `terms.floors.eur_obligations` | −0.01 | "9942420.73" → "9942420.72" | refused (terms hash) | refused (challenge) |
| `terms.floors.usd_floor` | +0.01 | "9990334.64" → "9990334.65" | refused (terms hash) | refused (challenge) |
| `terms.floors.usd_floor` | −0.01 | "9990334.64" → "9990334.63" | refused (terms hash) | refused (challenge) |
| `terms.after.eur_free` | +0.01 | "1240.00" → "1240.01" | refused (terms hash) | refused (challenge) |
| `terms.after.eur_free` | −0.01 | "1240.00" → "1239.99" | refused (terms hash) | refused (challenge) |
| `terms.after.usd_available` | +0.01 | "9995334.64" → "9995334.65" | refused (terms hash) | refused (challenge) |
| `terms.after.usd_available` | −0.01 | "9995334.64" → "9995334.63" | refused (terms hash) | refused (challenge) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash) | refused (challenge) |
| `terms.evidence[0].ref` | one digit | "SLL-2026-11" → "SLL-2026-12" | refused (terms hash) | refused (challenge) |
| `terms.evidence[0].sha256` | one digit | "004ee3b21920ab1cce16af31e383be6225310efb9f61…" → "004ee3b21920ab1cce16af31e383be6225310efb9f61…" | refused (terms hash) | refused (challenge) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.kind` | field removed | "invoice_payment" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.proposal_id` | field removed | "P-0002" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.expires_at` | field removed | "2026-11-07T12:31:13Z" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.invoice_no` | field removed | "SLL-2026-11" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.vendor` | field removed | "Stockline Data GmbH" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.amount` | field removed | "240.00" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.fee_max` | field removed | "20.00" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.beneficiary_id` | field removed | "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.beneficiary_name` | field removed | "Stockline Data GmbH" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.iban_last4` | field removed | "2051" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.bic` | field removed | "BYLADEM1001" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.method` | field removed | "SWIFT" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.reference` | field removed | "SLL-2026-11" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.reason` | field removed | "professional_business_services" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.transfer_request_id` | field removed | "0439af88-a9c7-45f6-8d15-d15f66b70f0e" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.conversion` | field removed | null → (absent) | refused (terms hash) | refused (challenge) |
| `terms.balances_before` | field removed | {"eur_available":"9968920.73","usd_available"…" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.floors` | field removed | {"eur_floor":"25000.00","eur_obligations":"99…" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.after` | field removed | {"eur_free":"1240.00","usd_available":"999533…" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"SLL-2026-11","sha25…" → (absent) | refused (terms hash) | refused (challenge) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash) | refused (challenge) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (RP id) |
| `origin` | another site | refused (origin) |

## Receipt: docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json

Proposal P-0002, terms hash `e3057c735d9b8381baa9c59315f204fe8c686d8c92214777cab6765d5e82a236`. Original: **verifies**. Changes: 138 tried, 138 refused, 0 accepted.

| Field | Change | Before → after | Hash kept | Hash recomputed |
|---|---|---|---|---|
| `terms.schema` | one digit | "kit11.approval-terms/v1" → "kit11.approval-terms/v2" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.kind` | one letter | "supplier_payment" → "supplier_paymenu" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.proposal_id` | one digit | "P-0002" → "P-0003" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.expires_at` | +1 second | "2026-11-10T07:26:14Z" → "2026-11-10T07:26:15Z" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.invoice_no` | one digit | "ZV-5001 · Zeeland Verpakkingen B.V." → "ZV-5002 · Zeeland Verpakkingen B.V." | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.vendor` | one letter | "Zeeland Verpakkingen B.V." → "Zeeland Verpakkingen B.W." | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.amount` | +0.01 | "4.84" → "4.85" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.amount` | −0.01 | "4.84" → "4.83" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.method` | one letter | "LOCAL" → "LOCAM" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.clearing` | null → a value | null → "1" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.beneficiary_id` | one digit | "e8599d32-5f16-42e6-842c-f7356d5de239" → "e8599d32-5f16-42e6-842c-f7356d5de230" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.beneficiary_name` | one letter | "Zeeland Verpakkingen B.V." → "Zeeland Verpakkingen B.W." | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.account` | one digit | "IBAN NL91…4300" → "IBAN NL91…4301" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.fee_reserve` | +0.01 | "0.00" → "0.01" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.fee_reserve` | −0.01 | "0.00" → "-0.01" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.reference` | one digit | "ZV-5001" → "ZV-5002" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.reason` | one letter | "professional_business_services" → "professional_business_servicet" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.transfer_request_id` | one digit | "d5d93d81-1b24-4b98-9bad-191dac1114c8" → "d5d93d81-1b24-4b98-9bad-191dac1114c9" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.conversion` | null → a value | null → "1" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.balances_before.EUR` | +0.01 | "61.59" → "61.60" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.balances_before.EUR` | −0.01 | "61.59" → "61.58" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.floors.EUR` | +0.01 | "0.00" → "0.01" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.floors.EUR` | −0.01 | "0.00" → "-0.01" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.evidence[0].type` | one letter | "invoice" → "invoicf" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.evidence[0].ref` | one digit | "ZV-5001 · Zeeland Verpakkingen B.V." → "ZV-5002 · Zeeland Verpakkingen B.V." | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.evidence[0].sha256` | one digit | "ab9d1ec98fbd0c7cec54d4714cd54d107e5fe9e49790…" → "ab9d1ec98fbd0c7cec54d4714cd54d107e5fe9e49790…" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.paying_account.id` | one digit | "acct_SC-QD89fOneAeqaRFgOymw" → "acct_SC-QD80fOneAeqaRFgOymw" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.paying_account.name` | one letter | "Purser Sandbox Test (fake sole trader)" → "Purser Sandbox Test (fake sole trades)" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.amount` | +0.01 | "0.02" → "0.03" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.amount` | −0.01 | "0.02" → "0.01" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.bps` | one digit | "50" → "51" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.to_account` | one digit | "acct_op0_QItiOyWKsYb5pwQihA" → "acct_op0_QItiOyWKsYb6pwQihA" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee.request_id` | one digit | "6a54f868-493b-4d91-b500-8002c4b94972" → "6a54f868-493b-4d91-b500-8002c4b94973" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.document_total_line` | one digit | "Totaal te betalen € 4,84" → "Totaal te betalen € 4,85" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.document_currency` | currency EUR → USD | "EUR" → "USD" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.test_money` | true → false | true → false | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.source` | one letter | "payables_inbox" → "payables_inboy" | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.schema` | field removed | "kit11.approval-terms/v1" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.kind` | field removed | "supplier_payment" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.proposal_id` | field removed | "P-0002" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.expires_at` | field removed | "2026-11-10T07:26:14Z" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.invoice_no` | field removed | "ZV-5001 · Zeeland Verpakkingen B.V." → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.vendor` | field removed | "Zeeland Verpakkingen B.V." → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.amount` | field removed | "4.84" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.currency` | field removed | "EUR" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.method` | field removed | "LOCAL" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.clearing` | field removed | null → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.beneficiary_id` | field removed | "e8599d32-5f16-42e6-842c-f7356d5de239" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.beneficiary_name` | field removed | "Zeeland Verpakkingen B.V." → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.account` | field removed | "IBAN NL91…4300" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.fee_reserve` | field removed | "0.00" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.reference` | field removed | "ZV-5001" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.reason` | field removed | "professional_business_services" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.transfer_request_id` | field removed | "d5d93d81-1b24-4b98-9bad-191dac1114c8" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.conversion` | field removed | null → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.balances_before` | field removed | {"EUR":"61.59"} → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.floors` | field removed | {"EUR":"0.00"} → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.evidence` | field removed | [{"type":"invoice","ref":"ZV-5001 · Zeeland V…" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.paying_account` | field removed | {"id":"acct_SC-QD89fOneAeqaRFgOymw","name":"P…" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.platform_fee` | field removed | {"amount":"0.02","currency":"EUR","bps":"50",…" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.document_total_line` | field removed | "Totaal te betalen € 4,84" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.document_currency` | field removed | "EUR" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.test_money` | field removed | true → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.source` | field removed | "payables_inbox" → (absent) | refused (terms hash) | refused (challenge, e2e signature) |
| `terms.tampered` | field added | (absent) → "1" | refused (terms hash) | refused (challenge, e2e signature) |

| Envelope field | Change | Result |
|---|---|---|
| `assertion.signature` | one byte flipped | refused (signature) |
| `assertion.authenticatorData` | user-verified flag cleared | refused (user verified, signature) |
| `rp_id` | another site | refused (RP id) |
| `origin` | another site | refused (origin) |


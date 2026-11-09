# Built after the kit

On [/try/sign](https://kit11.max-31b.workers.dev/try/sign) the Treasury agent asks to pay one invoice above its limit,
and the CFO signs the exact terms with Face ID. The payables inbox is built to do the same for every supplier invoice of
a small company: the same control, the CFO's Face ID over the exact terms, applied to accounts payable.

Where it stands: work in progress on a separate branch, built and tested against **stand-ins** for Airwallex and Claude
and on Cloudflare's local database. It is **not deployed**, no customer uses it, and it has made **no Airwallex sandbox
payout yet**. None of it is part of the Kit 11 runs described in the README. The Kit 11 build keeps Metal and x402 for
the agents' own payments; the inbox pays suppliers through Airwallex payouts.

## What exists

| Part | What it does | Status |
|---|---|---|
| Payables inbox | Supplier invoices arrive as PDF or e-mail (own inbox address per company), are read, checked and filed. Checks: duplicate number in any notation, changed bank details, totals that do not add up, unknown supplier, unusual amount, credit notes netted only after a person accepts them. | Built, tested against stand-ins |
| Scanned invoices | A PDF without text or a photo is read twice by Claude. Only when both readings agree on IBAN, total, currency and invoice number (and the IBAN checksum holds) can it be paid; otherwise a person checks each field next to the crop it came from. Text on the scan is data: it never changes who is paid. | Built, tested against a stand-in model; not yet run against the live model |
| One Face ID for a batch | The CFO signs one list of exact payment terms. One changed line refuses the whole batch; each payment then runs and is checked on its own, so a failed line never pays another twice. | Built, tested against a stand-in Airwallex |
| Payments in any currency | Through Airwallex payouts, with FX only for the shortfall and fees booked. | Built, tested against a stand-in Airwallex |
| Bookkeeping | Hash-chained ledger, period closing, Dutch VAT overview, a register of every money movement with its approval, booking and proof. | Built, tested |
| Cloud console | Passkey sign-in (no passwords), onboarding, invoices, transactions, books, people and API keys, GDPR export. It never pays: payments are approved on the phone. Dutch and English. | Built, tested locally on Cloudflare's local D1; not deployed |
| Security | Five red-team rounds on the payables and cloud code; every confirmed finding fixed and covered by a test. | Ongoing |

## Airwallex connected accounts: built, waiting for sandbox access

Purser as an Airwallex platform: each customer would open its own Airwallex account through Purser (a connected
account), Purser would pay that customer's suppliers from it, and every payout is still approved by the CFO's Face ID
over the exact terms. Purser keeps only the account id and status, never a key. Before every payout and every card call
(create, limits, controls, status, transactions), Purser checks a signed binding between the company and its Airwallex
account; a different, dormant, closed or expired account is refused and nothing reaches Airwallex.

This is built and tested against a stand-in for Airwallex. It has not run live: connected accounts are not enabled for
our sandbox yet (a test call on 9 November was refused), and we have asked Airwallex to enable them. How a platform fee
is taken through Airwallex is not confirmed yet.

**Pricing is not settled.** The platform build can take a per-payment fee, capped in the CFO's policy (0.50% in the
test world), next to the monthly plan in [docs/business/model.md](business/model.md#intended-pricing-hypothesis). Both
are hypotheses; no customer has seen a price.

## Screenshots (test company, stand-ins, test money)

The screens are in Dutch, the default for a Dutch company; English is one click away.

| | |
|---|---|
| ![Payables inbox](screenshots/after-kit/1-payables-inbox.png) | ![One Face ID for three invoices](screenshots/after-kit/3-batch-face-id-phone.png) |
| Payables inbox: what is open, due, blocked and why. | One Face ID for three invoices, with the account paid from and Purser's fee per line. Connected-account flow on a stand-in Airwallex; never run live. |
| ![Open an Airwallex account through Purser](screenshots/after-kit/4-airwallex-account.png) | |
| Opening the company's own Airwallex account through Purser (waiting for sandbox access). | |

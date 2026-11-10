# Built after the kit

On [/try/sign](https://kit11.max-31b.workers.dev/try/sign) the Treasury agent asks to pay one invoice above its limit,
and the CFO signs the exact terms with Face ID. The payables inbox is built to do the same for every supplier invoice of
a small company: the same control, the CFO's Face ID over the exact terms, applied to accounts payable.

Why small companies: a CFO we spoke to (1 conversation so far; more in progress) put it this way:

> "At our company invoices go through a full approval process in our ERP. I think Purser is something for SMEs." — CFO at a US company (anonymous)

Where it stands: work in progress on a separate branch, built and tested against **stand-ins** for Airwallex and Claude
and on Cloudflare's local database. It is **not deployed** and no customer uses it. Its connected-account payout path ran once in Airwallex's
sandbox on 10 November (below); the inbox itself has not yet paid an invoice in the sandbox. None of it is part of the Kit 11 runs described in the README. The Kit 11 build keeps Metal and x402 for
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

## Airwallex connected accounts: run in the sandbox on 10 November

Purser as an Airwallex platform: each customer opens its own Airwallex account through Purser (a connected account),
Purser pays that customer's suppliers from it, and every payout is still approved by the CFO's Face ID over the exact
terms. Purser keeps only the account id and status, never a key. Before every payout and every card call (create,
limits, controls, status, transactions), Purser checks a signed binding between the company and its Airwallex account;
a different, dormant, closed or expired account is refused and nothing reaches Airwallex.

Airwallex enabled connected accounts on our sandbox on 10 November. What ran there, with test data and test money
([run record](runs/2026-11-10-connected-accounts-sandbox.md), 17 calls):

| Step | Airwallex's answer |
|---|---|
| Purser opens a connected account for a fake Dutch test company | `acct_SC-QD89fOneAeqaRFgOymw`, `CREATED` |
| Verification details (fake, a non-registered sole trader), submitted | `SUBMITTED`; then `ACTIVE` through the sandbox's simulation (no real verification) |
| The platform funds it with EUR 20.00 | `tr_oZIJlT2oNQ2OX33f83UCag` |
| A EUR 5.00 payout on the company's behalf (`x-on-behalf-of`) through Purser's payout code, **Purser's fee sent as `application_fee_options`** | `a9460dba-f31b-4111-be58-6d9a9e71adb1`, `SCHEDULED`; **application fee accepted at exactly EUR 0.05** |
| Settlement | `SENT`, then `PAID` through the sandbox's simulation API (simulated) |

Not shown by this run: the CFO's Face ID on this payout (the run called Purser's payout code directly with a test
approval hash; the Face ID flow itself is the one on /try/sign), the live (non-simulated) settlement, and Airwallex's
web-app approval workflow, which can be switched on as a second lock (a payout then waits `IN_APPROVAL`).

**Pricing is not settled.** The platform build can take a per-payment fee, capped in the CFO's policy (0.50% in the
test world), next to the monthly plan in [docs/business/model.md](business/model.md#intended-pricing-hypothesis). Both
are hypotheses; no customer has seen a price.

## Screenshots (test company, stand-ins, test money)

The screens are in Dutch, the default for a Dutch company; English is one click away.

| | |
|---|---|
| ![Payables inbox](screenshots/after-kit/1-payables-inbox.png) | ![One Face ID for three invoices](screenshots/after-kit/3-batch-face-id-phone.png) |
| Payables inbox: what is open, due, blocked and why. | One Face ID for three invoices, with the account paid from and Purser's fee per line. On a stand-in Airwallex (the connected-account payout itself ran in the sandbox, above). |
| ![Open an Airwallex account through Purser](screenshots/after-kit/4-airwallex-account.png) | |
| Opening the company's own Airwallex account through Purser (test company). | |

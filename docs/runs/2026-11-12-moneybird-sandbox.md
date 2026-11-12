# Moneybird in a sandbox administration, 2026-11-12

**Result:** Purser sent a small test company's purchase books to a real Moneybird administration for the first time, and
read them back. 4 suppliers, 4 purchase invoices with their PDF, 1 payment, 1 journal entry and 1 correction (a credit
note and the new version) went in. Read back, all 6 purchase invoices in Moneybird equal Purser's ledger to the cent:
0 differences. The same sync run again made 0 requests. The run used 33 of the 44 approved requests.

**Labels: Moneybird sandbox administration; test data; no e-mail sent.** The payment in this test world was made on a
stand-in rail: no money moved anywhere, not even test money.

| | |
|---|---|
| Administration | "Purser" (EUR, the Netherlands), `503585935808530148`. A Moneybird sandbox administration the owner made on 12 Nov. Test data only. |
| Token | A personal API token with the `documents` scope, as the owner made it. The proxy on the run's machine adds it to each request to moneybird.com. It is not in code, git, logs, the environment or this page. |
| Guards | The sandbox guard was on (`ERP_MONEYBIRD_SANDBOX_ONLY=on`): no other administration can be called. The connector calls only its fixed list of 12 endpoints, and none of them sends an e-mail, an invoice or a reminder. |
| Calls | 33 of the 44 approved for the whole run. Each request is written to the call log before it is sent; `npm run erp -- calls` counts them. |
| Before the run | The coordinator of the run reported one earlier request, outside this count: `GET administrations.json`, to check that the token reaches this administration. |
| Code | Step 1: commit `da337e5`. Step 2: commit `b16281d`. Branch `moneybird-live-1112`. |
| Data | [2026-11-12-moneybird-sandbox.json](2026-11-12-moneybird-sandbox.json): the record of step 2, built by `npm run erp -- record` from the call log, the audit log and the read-back. |

## Step 1: read (10:28:41 to 10:28:43 UTC)

`npm run erp -- pull --connector moneybird --live`, as in [docs/moneybird.md](../moneybird.md), "Going live", step 4.
It used 3 of the 6 approved for this step.

| Request | Answer |
|---|---|
| `GET ledger_accounts.json` | 27 ledger accounts |
| `GET contacts.json` | 0 contacts |
| `GET tax_rates.json` | 5 tax rates |

All three answered 200. The answers are kept as they came in
[test/fixtures/moneybird/sandbox-2026-11-12.json](../../test/fixtures/moneybird/sandbox-2026-11-12.json), and the tests
replay them.

### What the real administration showed

- **The answers have the shape the connector expected.** Field names, ids and paging are as built from Moneybird's
  OpenAPI file. Nothing had to change to read them.
  - Ids are written as strings. They go past 2^53, so the connector never reads one as a number.
  - A list that pages carries `X-Total-Count` and a `Link` header, which is empty when there is no next page. The
    ledger accounts do not page.
- **The chart has Moneybird's own account codes** (such as `46801.01`), and none of Purser's. Matching by code finds
  nothing, so every account goes through the map below.
- **6 of the 27 accounts are allowed on a purchase invoice.** All 27 take a journal entry.
- **Purchase tax rates: 21% and 9%.** There is 0% for sales only, and no rate for "no VAT". The connector refuses a
  purchase line with such VAT until the administration has a purchase rate for it. So a test invoice for this
  administration carries 21% or 9% Dutch VAT.
- **Rate limit.** Each answer said 150 requests per window (`RateLimit-Limit`) and how many were left
  (`RateLimit-RequestsRemaining`: 149, 148, 147). `RateLimit-Remaining` matched the seconds left until
  `RateLimit-Reset`, not a number of requests. This is read from these three answers, not from documentation.

### What changed in the code

- **Before the call.** The pull asked for the tax rate map first, the map this very step lists the ids for. Step 4 could
  not run as written. A pull no longer needs it; sending still does.
- **After the call.** The pull now says for each account what kind it is and whether it may stand on a purchase invoice
  or a journal entry, so the map can be made from the listing alone. The listing of this run did not show that yet.

### The maps, by name

Made for this sandbox by the implementer of this step, for the test only. This chart has no account for purchased
goods, so goods and services both go to "Algemene kosten". A real company's bookkeeper makes this choice.

The ids are in the run's settings file outside the repository (`settings.env` in the run's folder). A script built it
from these two tables and the answers above; no id was typed by hand.

| Purser VAT treatment | Moneybird tax rate | Kind |
|---|---|---|
| `NL21` | 21% btw | purchase_invoice |
| `NL9` | 9% btw | purchase_invoice |

Not mapped, because this administration has no purchase rate for them: 0% (`NL0`), reverse charge (`EU_RC`,
`NONEU_RC`), exempt (`EXEMPT`) and no VAT (`NONE`).

| Purser account | Moneybird ledger account | Used on |
|---|---|---|
| `5000` Purchased stock data (warehouse API) | Algemene kosten | purchase invoices, journal entries |
| `6100` Software subscriptions (company cards) | Algemene kosten | purchase invoices, journal entries |
| `6150` Advertising (company cards) | Verkoopkosten | purchase invoices, journal entries |
| `6200` Goods from the manufacturer | Algemene kosten | purchase invoices, journal entries |
| `6300` Travel (task cards) | Vervoerskosten | purchase invoices, journal entries |
| `6350` Data licence (Stockline, monthly) | Algemene kosten | purchase invoices, journal entries |
| `6800` Bank and transfer fees | Algemene kosten | purchase invoices, journal entries |
| `6900` Other supplier invoices | Algemene kosten | purchase invoices, journal entries |
| `1200` Bank: Airwallex EUR (incl. company cards) | Financiële rekeningen | journal entries |
| `1590` Money in transit (between own accounts) | Kruisposten | journal entries |

Cost centres are left out (`ERP_MONEYBIRD_IGNORE_COST_CENTRES=on`): no project was looked up or mapped.

### Not done in step 1

- Nothing was written in step 1; step 2 below did that.
- Whether the administration has more tax rates that are switched off was not asked.

## Step 2: send, correct, read back (11:58 to 12:00 UTC)

### The test world

One fictional company, "Bakkerij De Test (fake)", built offline with Purser's real engine on stand-in rails
(`npm run erp -- world`, [src/erp/sandboxWorld.ts](../../src/erp/sandboxWorld.ts)). Its four invoices are the ones of
the platform test world ([src/e2e/world.ts](../../src/e2e/world.ts)): same suppliers, numbers, dates and net amounts.

| Invoice | Supplier | Net | VAT | Total | In Purser |
|---|---|---|---|---|---|
| `ZV-5001` | Zeeland Verpakkingen B.V. (test) | 4.00 | 0.84 (21%) | 4.84 | waiting for the CFO |
| `MM-2026-114` | Meelhandel Molenaar B.V. (test) | 3.00 | 0.27 (9%) | 3.27 | waiting for the CFO |
| `VE-889` | Verpakking Express B.V. (test) | 2.00 | 0.42 (21%) | 2.42 | paid (stand-in payout) |
| `OD-77` | Onderdelen Direct B.V. (test) | 5.00 | 1.05 (21%) | 6.05 | waiting for the CFO; later moved to another account |

The journal entry is a company card purchase: Packwise, Starter plan, EUR 19.99 (the plan from the policy's price list).

### What ran

Everything between the two markers is generated from the record (`npm run erp -- record --markdown`); a test holds this
page to it.

<!-- record:start -->
Labels: Moneybird sandbox administration; test data; no e-mail sent.

**Requests: 33 of the 44 approved.**

| Request | Times |
| --- | --- |
| `GET moneybird.com/api/v2/503585935808530148/ledger_accounts.json` | 4 |
| `GET moneybird.com/api/v2/503585935808530148/contacts.json` | 1 |
| `GET moneybird.com/api/v2/503585935808530148/tax_rates.json` | 4 |
| `POST moneybird.com/api/v2/503585935808530148/contacts.json` | 4 |
| `POST moneybird.com/api/v2/503585935808530148/documents/purchase_invoices.json` | 6 |
| `POST moneybird.com/api/v2/503585935808530148/documents/purchase_invoices/{id}/attachments.json` | 5 |
| `GET moneybird.com/api/v2/503585935808530148/documents/purchase_invoices.json` | 1 |
| `POST moneybird.com/api/v2/503585935808530148/documents/purchase_invoices/{id}/payments.json` | 1 |
| `POST moneybird.com/api/v2/503585935808530148/documents/general_journal_documents.json` | 1 |
| `GET moneybird.com/api/v2/503585935808530148/documents/purchase_invoices/{id}.json` | 6 |

| Step | Started (UTC) | Requests |
| --- | --- | --- |
| world-build | 11:58:06 | 0 |
| dry-run | 11:58:14 | 0 |
| sync-1 | 11:58:56 | 8 |
| sync-2 | 11:59:22 | 11 |
| world-recode | 11:59:49 | 0 |
| sync-3-after-change | 11:59:51 | 0 |
| correct | 12:00:00 | 5 |
| sync-again | 12:00:14 | 0 |
| read-back | 12:00:16 | 6 |

3 requests in the call log fall in no step listed here.

**What the ERP link did, from the audit log.**

| Time (UTC) | What | Object | Result | Moneybird id |
| --- | --- | --- | --- | --- |
| 11:58:59 | vendor | ben_1 | sent | `503594057045378916` |
| 11:59:00 | vendor | ben_2 | sent | `503594057381971864` |
| 11:59:00 | vendor | ben_3 | sent | `503594057744779194` |
| 11:59:00 | vendor | ben_4 | sent | `503594058012166094` |
| 11:59:02 | invoice | MM-2026-114 · Meelhandel Molenaar B.V. (test) | sent | `503594058847880244` |
| 11:59:02 | invoice | OD-77 · Onderdelen Direct B.V. (test) | failed: the approved ERP call budget of 11 is spent; POST moneybird.com/api/v2/503585935808530148/documents/purchase_invoices.json was not sent (ask the owner before any further call) | - |
| 11:59:27 | invoice | OD-77 · Onderdelen Direct B.V. (test) | sent | `503594084810622802` |
| 11:59:29 | invoice | VE-889 · Verpakking Express B.V. (test) | sent | `503594086720079846` |
| 11:59:30 | invoice | ZV-5001 · Zeeland Verpakkingen B.V. (test) | sent | `503594087902872689` |
| 11:59:30 | payment | c8e03780-6ddf-4e96-966c-240a28ebb515 | sent | `503594088956691668` |
| 11:59:30 | journal | card:tx_3 | sent | `503594089333130481` |
| 11:59:54 | invoice | OD-77 · Onderdelen Direct B.V. (test) | changed after it was sent | `503594084810622802` |
| 12:00:07 | invoice | OD-77 · Onderdelen Direct B.V. (test) | corrected: credit note, then the new version | `503594127086061457` (credit note `503594126226229000`, replaces `503594084810622802`) |

**Read back and reconciled: 0 differences in 6 documents.** Each row is one purchase invoice in Moneybird, read at 12:00:22 UTC. Amounts in EUR; "Purser" is the ledger, "Moneybird" is what the read-back answered.

| Document | Number | Moneybird id | Net (Purser / Moneybird) | VAT | Gross | Paid | State | PDF | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invoice | MM-2026-114 | `503594058847880244` | 3.00 / 3.00 | 0.27 / 0.27 | 3.27 / 3.27 | 0.00 / 0.00 | open / open | 1 | equal |
| invoice | OD-77 | `503594127086061457` | 5.00 / 5.00 | 1.05 / 1.05 | 6.05 / 6.05 | 0.00 / 0.00 | open / open | 1 | equal |
| replaced | OD-77 | `503594084810622802` | 5.00 / 5.00 | 1.05 / 1.05 | 6.05 / 6.05 | - / 0.00 | - / open | 1 | equal |
| credit note | OD-77 | `503594126226229000` | -5.00 / -5.00 | -1.05 / -1.05 | -6.05 / -6.05 | - / 0.00 | - / open | 0 | equal |
| invoice | VE-889 | `503594086720079846` | 2.00 / 2.00 | 0.42 / 0.42 | 2.42 / 2.42 | 2.42 / 2.42 | paid / paid | 1 | equal |
| invoice | ZV-5001 | `503594087902872689` | 4.00 / 4.00 | 0.84 / 0.84 | 4.84 / 4.84 | 0.00 / 0.00 | open / open | 1 | equal |

**The same sync run again (step "sync-again") made 0 requests.**
<!-- record:end -->

The 3 requests outside these steps are the pull of step 1.

How to read the steps:

- **sync-1 and sync-2 are one sync, sent in two parts.** The first part was capped at 8 requests, so that Moneybird's
  answer to the first invoice and its PDF could be read before the rest was sent. That is the "failed" line for
  `OD-77`: the request over the cap was not sent. The second part asked Moneybird first whether it already held that
  invoice (1 request, answer: no), then sent the rest.
- **world-recode** is the test world, not Moneybird: a person moves `OD-77` from "Other supplier invoices" to "Travel".
- **sync-3-after-change** sent nothing. Purser never overwrites what it sent: it asked for a correction.
- **correct** sent a credit note for the first version and then the new version with its PDF.
- **sync-again** is the idempotency check: the same sync once more.
- **read-back** asked Moneybird for each of the 6 purchase invoices, seconds after the last write.

### What the live API taught us

Found while preparing the run, and fixed before the first request (commit `b16281d`):

- **Invoices went without their PDF.** The feed from the inbox to the ERP link did not carry the stored document. It
  does now: each invoice takes the PDF the inbox stored.
- **A dry run stopped at the first real id.** It answered from an example chart. It now takes the ids in your own maps
  at their word and shows every request; the live run still checks each id against Moneybird first.
- **A correction did not record what it cancelled.** Its audit row now holds the totals of the version it replaced, so
  the replaced invoice and its credit note can be reconciled later.

Learned from the answers. None of these needed a code change: all 30 requests of step 2 were answered 200 or 201.

- **The request shapes were right.** Contacts, purchase invoices, PDF attachments, the payment and the journal entry
  were accepted as built from Moneybird's OpenAPI file. Moneybird computed the same VAT as the invoices, at 21% and 9%.
- **A token with the `documents` scope can create contacts.**
- **A new invoice is `open` at once, and `paid` once a payment covers it.** That is what the stand-in in the tests does.
- **A payment sent without a bank account lands on "Te rubriceren betalingen"** (payments to be categorised), an
  account Moneybird chose. Purser sends the payout's id as `transaction_identifier` so a bank line can be matched to
  it later. That matching was not tested: the sandbox has no bank feed.
- **Moneybird took a second invoice with the same number for the same supplier** (the new version of `OD-77`).
- **Moneybird does not know that a credit note cancels an invoice.** The first version of `OD-77` and its credit note
  are both `open` there. Together they are zero, but a person still has to set them against each other in Moneybird.
  Purser does not do that yet.
- **A contact without an e-mail address has delivery method "Email" and an empty address.** Purser sends no address,
  so Moneybird has nowhere to send anything.
- **The attachment endpoint answers `200` with the body `200`**, not a record.
- **The tax rates and the chart did not change** between step 1 and step 2: each of the 6 later lookups got the same
  list.

The answers are kept in
[test/fixtures/moneybird/sandbox-2026-11-12-sync.json](../../test/fixtures/moneybird/sandbox-2026-11-12-sync.json):
per request the fields Purser reads, as Moneybird wrote them. The rest is left out, because a contact's answer holds a
customer-portal link and several answers hold the user id of the token's owner. A test replays the read-back from it.

### Fixed after the run

A review of the run found three gaps, fixed offline in commit `7f30364`. No request was sent for them.

- **A moved PDF looked like a changed invoice.** The hash held whether the PDF's file was on this machine. It now holds
  only the document's own hash. A copy of this run's ledger, with its files and without them, syncs as unchanged.
- **A lost answer during a correction could post a second version.** Moneybird takes a second invoice with the same
  number, so a lookup cannot tell them apart. Such a part now goes to a person, who says what Moneybird holds.
- **The test world could be built in any ledger.** It now needs a ledger of its own, named with `KIT11_DB`.

### Deviations and limits

- **One invoice is not as in the fixtures.** The fixtures have no invoice at the low VAT rate. `MM-2026-114` keeps its
  net amount of 3.00 and carries 9% here (0.27, total 3.27) in place of 21% (0.63, total 3.63).
- **The payment is a stand-in.** The test world paid `VE-889` on the stand-in Airwallex of the test suite. No money
  moved. Moneybird received the payment as a record: date, amount and the stand-in payout's id.
- **The change to `OD-77` was made in the ledger directly.** The product has no screen yet to move an invoice to
  another account.
- **Suppliers went as a name and Purser's own id for them.** The feed holds no VAT number, and of the IBAN only the
  last four digits and a hash, so neither was sent.
- **Cost centres were left out** (`ERP_MONEYBIRD_IGNORE_COST_CENTRES=on`).
- **The ledger account map is a test map**, made by the implementer. All invoice lines went to "Algemene kosten",
  except the moved one, which went to "Vervoerskosten". A real company's bookkeeper makes this choice.
- **The journal entry was not read back.** Its own answer showed both lines (19.99 debit, 19.99 credit); the read-back
  covers purchase invoices only.
- **The test data stays in the sandbox administration.** The connector cannot change or remove what it sent.

### Not done

- Another currency than EUR. The connector refuses a payment or journal entry in another currency.
- VAT at 0%, reverse charge, exempt or none: this administration has no purchase rate for them.
- OAuth for customers. The run used the owner's personal API token; a customer connecting their own administration
  is not built.
- A production administration, and real invoices.
- Matching a payment to a bank line in Moneybird.
- A lost answer, a rate limit (429) or a server error from the live API. The tests cover them on a stand-in only.
- A list longer than one page.
- Exact Online, Business Central and Odoo: still not tested against a live system.

## Wording to apply

For the coordinator of the run. This stream did not edit `README.md`, `llms.txt`, the site or the submission form.
Each block below is the exact text for that file, with that file's own links.

**README.md**, section "After the kit", after the sentence that ends with the link to the run record of 10 November
("1 payout PAID, 3 refused by Airwallex"), add:

```text
On 12 November its Moneybird link ran in a Moneybird sandbox administration with test data: 4 suppliers, 4 purchase invoices with their PDF, 1 payment, 1 journal entry and 1 correction were sent, and all 6 purchase invoices read back equal to Purser's ledger to the cent ([run record](docs/runs/2026-11-12-moneybird-sandbox.md)). No customer's administration is connected.
```

**llms.txt**, line "After the kit", before ": docs/after-the-kit.md", add:

```text
; its Moneybird link ran in a Moneybird sandbox administration on 12 Nov with test data (4 suppliers, 4 purchase invoices with PDF, 1 payment, 1 journal entry, 1 correction sent; 6 purchase invoices read back, 0 differences with the ledger; a second sync made 0 requests; 33 requests), no customer's administration connected: docs/runs/2026-11-12-moneybird-sandbox.md
```

**Site** (wherever the accounting links are named; today no public page names Moneybird). If one does:

```text
Moneybird: tested in a Moneybird sandbox administration with test data (12 Nov 2026). Read back to the cent.
```

**Submission form**, where the product for small companies is described, add:

```text
Its Moneybird link ran in a Moneybird sandbox administration (12 Nov, test data): invoices, PDFs, a payment and a correction went in, and came back equal to the ledger to the cent.
```

**/runs list** (`src/redesign/runs.ts` and `docs/runs/README.md`). Not added in this stream: the list is a public page
whose rows are pinned by tests, and other streams change it today. A row for it, every figure from the record:

| Field | Value |
|---|---|
| Date | 12 Nov 2026 |
| Title | Moneybird sandbox: books sent and read back |
| Rails | Moneybird sandbox administration (test data; the payment on a stand-in rail) |
| What | 4 suppliers, 4 purchase invoices with PDF, 1 payment, 1 journal entry, 1 correction. |
| Checks | 0 differences in 6 documents read back; a second sync made 0 requests |
| Money | No money moved |
| Stats | 33 of 44 requests; 6 documents reconciled; 0 differences |
| Files | `docs/runs/2026-11-12-moneybird-sandbox.md`, `docs/runs/2026-11-12-moneybird-sandbox.json` |

Do not write that Moneybird certified, endorsed or approved anything: it is a run in a sandbox the owner opened.

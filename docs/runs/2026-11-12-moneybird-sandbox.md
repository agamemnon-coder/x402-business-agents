# Moneybird in a sandbox administration, 2026-11-12

**Result so far:** Purser read a real Moneybird administration for the first time: the ledger accounts, the contacts and
the tax rates of a sandbox administration, in 3 requests. Nothing has been written to it yet. Sending a small set of test
invoices, reading them back and reconciling them is the next step of this run; this page grows with it.

| | |
|---|---|
| Administration | "Purser" (EUR, the Netherlands), `503585935808530148`. A Moneybird sandbox administration the owner made on 12 Nov. Test data only. |
| Token | A personal API token with the `documents` scope, as the owner made it. The proxy on the run's machine adds it to each request to moneybird.com. It is not in code, git, logs, the environment or this page. |
| Guards | The sandbox guard was on (`ERP_MONEYBIRD_SANDBOX_ONLY=on`): no other administration can be called. The connector calls only its fixed list of 12 endpoints, and none of them sends an e-mail, an invoice or a reminder. |
| Calls | 3 of the 6 approved for this step. The whole run has 44. Each request is written to the call log before it is sent; `npm run erp -- calls` counts them. |
| Before the run | The coordinator of the run reported one earlier request, outside this count: `GET administrations.json`, to check that the token reaches this administration. |
| Code | Commit `da337e5` on branch `moneybird-live-1112`. |

## Step 1: read (10:28:41 to 10:28:43 UTC)

`npm run erp -- pull --connector moneybird --live`, as in [docs/moneybird.md](../moneybird.md), "Going live", step 4.

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
- **6 of the 27 accounts are allowed on a purchase invoice.** The others take journal entries only.
- **Purchase tax rates: 21% and 9%.** There is 0% for sales only, and no rate for "no VAT". The connector refuses a
  purchase line with such VAT until the administration has a purchase rate for it. So a test invoice for this
  administration carries 21% or 9% Dutch VAT.
- **Rate limit.** Each answer said 150 requests per window (`RateLimit-Limit`) and how many were left
  (`RateLimit-RequestsRemaining`: 149, 148, 147). `RateLimit-Remaining` counted the seconds to the end of the window,
  not requests. This is read from these three answers, not from documentation.

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

Cost centres are left out (`ERP_MONEYBIRD_IGNORE_COST_CENTRES=on`): this administration has no projects.

### Not done in this step

- Nothing was written: no contact, no purchase invoice, no payment, no journal entry.
- Whether the administration has more tax rates that are switched off was not asked.
- The maps were checked against the answers by a test, not by Moneybird: that comes with the first invoice.

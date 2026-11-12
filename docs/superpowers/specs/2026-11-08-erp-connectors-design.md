# ERP connectors (design)

> **Status, 12 November 2026:** this is the design note of 8 November, kept as written. Where it says "on a branch" or
> "nothing is deployed", it describes that day. The code is now in this repository, and a hosted preview exists but is
> private (behind an access key), with no customer: [after-the-kit.md](../../after-the-kit.md).

8 November 2026: "An ERP link is important; we must be able to connect." Purser keeps its own books
and also syncs with the company's ERP in both directions, so no CSV is needed. Built on a branch; nothing is deployed.

## Decisions

- **One canonical model** (`src/erp/model.ts`): Vendor, PurchaseInvoice, Payment, JournalEntry. Money is integer
  cents plus a currency code; amounts are never floats in Purser. A journal entry must balance per currency, or it is
  refused before any request is built. The payables inbox and the bookkeeping core (other branches) map to this model;
  this branch does not depend on their code.
- **One connector interface** (`src/erp/connector.ts`): pull the chart of accounts, pull vendors, push a vendor, push a
  purchase invoice (with its PDF where the ERP takes attachments), push a payment, push a journal entry, push a
  correction (a credit note against an invoice already sent), pull an invoice's payment status, and look up an object
  Purser may already have created (so a crash between "sent" and "recorded" never posts twice).
- **Every connector is built only from the vendor's public documentation**, cited per endpoint in the code. Where the
  documentation leaves something open (a journal code, a document type, a sign convention, a VAT code), it is a setting
  the customer gives, never a guess.
- **Idempotent sync** (`src/erp/sync.ts`): a table `erp_sync` keeps, per connector and object, the ERP's id, the hash
  of what was sent, a status and the last error. Unchanged objects are skipped. A changed object that was already sent
  is never overwritten: it is marked `needs_correction`, and for an invoice the correction is a credit note plus the new
  version, as accounting rules ask. Dependencies go first (vendor, then invoice, then payment); an object whose
  dependency is not in the ERP yet waits. Retryable errors (rate limit, server, network) are retried with back-off,
  honouring Retry-After; the rest fail with their reason. Every result is written to the audit log.
- **Credentials** come only from the environment, and a rotating refresh token (Exact) is kept in `data/erp/` (not in
  git, file mode 600). Nothing secret is logged; a dry run prints the requests with credentials redacted.

## Connectors in this branch

| ERP | API | Auth |
|---|---|---|
| Exact Online | REST (OData v2), `/api/v1/{division}/...` | OAuth 2.0 authorization code; access token 10 minutes; refresh token rotates |
| Microsoft Dynamics 365 Business Central | API v2.0, `companies({id})/...` | Microsoft Entra client credentials, scope `https://api.businesscentral.dynamics.com/.default` |
| Odoo (17/18) | External API, XML-RPC `xmlrpc/2/common` and `xmlrpc/2/object`, `execute_kw` | login plus API key |

AFAS Profit and Twinfield are next; they are not in this branch.

## Not in this branch

Live calls (no ERP account or credentials yet), webhooks from the ERP, matching bank statements from the ERP, and
customer (sales) invoices.

## Testing

Contract tests per connector against responses shaped as the documentation shows; the sync runner's idempotency,
retry, a partial failure, a crash between create and record, and a changed invoice after sending. No outside calls.

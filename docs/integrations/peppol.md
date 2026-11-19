# Peppol: receiving e-invoices (UBL 2.1, Peppol BIS Billing 3.0)

Purser can read an incoming Peppol invoice or credit note and file it in the payables inbox, where the same checks as for a PDF decide what happens to it. **Receiving over the Peppol network is not set up**: that needs an Access Point, which is the owner's step (below). Until then a Peppol file reaches Purser the way any document does: an upload, the payables folder, the API.

## What is built (19 Nov 2026)

| Part | Where | What it does |
|---|---|---|
| Strict XML reader | `src/ap/xmlStrict.ts` | No DTD (a `<!DOCTYPE` anywhere is refused), so no external or internal entity, no XXE and no entity expansion; only XML's five entities and numeric character references; UTF-8 only (a fatal decoder; a declared other encoding or UTF-16 is refused); no processing instructions; caps on size (8 MB for Peppol), depth (32), elements (20,000) and attributes (16 per element), refused past them, never truncated; well-formed or nothing; names resolved to namespace URIs, so other prefixes cannot change what is read. |
| UBL reader and business rules | `src/ap/peppol.ts` | A UBL `Invoice-2` or `CreditNote-2` in BIS 3.0; its fields taken from their UBL places (no model reads anything); the rules below checked in code; a plain-text rendering for the checks that read words. |
| Into the inbox | `src/ap/inbox.ts` (`ingestDocument`) | An XML document is read as Peppol; one that is not readable UBL is refused before anything is filed. The XML is kept as it came (by its SHA-256, `application/xml`), read by `peppol-ubl`, checked like a PDF (supplier and account on file, duplicates, splits, limits, the words of its notes), and every broken rule holds it for a person. A credit note is filed as one and never paid. Checked again later (`recheck`), and at payment time, the same rules apply (`src/ap/docText.ts`). |
| A check from the command line | `npm run peppol:check -- <file.xml>` | Reads one or more files, prints the fields Purser takes, each rule broken and what would hold it. Files nothing. |

### The rules checked

The ones that decide what is paid, from EN 16931-1 and Peppol BIS Billing 3.0 (`PEPPOL_RULES` in `src/ap/peppol.ts` lists them with their wording):

- **Totals:** BR-CO-10 (lines add up to BT-106), BR-CO-11 and BR-CO-12 (document allowances and charges), BR-CO-13 (total without VAT), BR-CO-15 (total with VAT), BR-CO-16 (amount due = total with VAT − paid + rounding), and each line's net amount from quantity and price (PEPPOL-EN16931-R120).
- **VAT breakdown:** BR-CO-14 (total VAT = Σ category tax), BR-CO-17 (category tax = taxable × rate, rounded to two decimals; the official schematron allows ±1, and so does this), BR-CO-18 (at least one breakdown), and each category's taxable amount from its lines, allowances and charges (BR-S-08, BR-Z-08, BR-E-08 and their siblings).
- **Currency:** BR-05 (an invoice currency), BR-CL-04 (an ISO 4217 code), PEPPOL-EN16931-R051 (every amount in the invoice currency, except the total VAT in the accounting currency), BR-53 (that total when an accounting currency is given), and two decimals on the amounts (BR-DEC).
- **Payment:** BR-61 (a credit transfer names an account), BR-CO-25 (a due date or terms when something is due), and Purser's own **PURSER-IBAN**: a SEPA credit transfer's account (payment means 58) must be an IBAN with a valid ISO 13616 checksum, and any account written as an IBAN must pass it. Purser also holds for a person an invoice whose payee (BG-10) is not the seller (factoring, a collection agent), one that names more than one account, and one paid by direct debit (a transfer as well would pay it twice).
- **Form:** PEPPOL-EN16931-R001 (a business process), R004 (BIS 3.0's specification identifier), BR-02, BR-03, BR-04, BR-06, BR-07, BR-12 to BR-16 (the invoice's number, dates, type, seller, buyer, totals and at least one line).

### What is not covered

- The full EN 16931 and Peppol schematrons (several hundred rules and code lists) and XSD validation. An Access Point validates every message against them before it delivers it; Purser's checks are its own, for what it pays.
- Attachments: an `AdditionalDocumentReference`'s embedded file (often a PDF copy) is not opened; the UBL data is the invoice.
- Sending (Purser issuing e-invoices) and the Peppol directory (SMP) registration.

## Fixtures and tests

- `fixtures/peppol/handcrafted-*.xml` are **handcrafted** test files, labelled so in each file: a clean BIS 3.0 invoice and credit note from a supplier on file in the test world, and two attack files (an XXE external entity and entity expansion).
- The **official OpenPeppol examples** (`rules/examples` of [OpenPEPPOL/peppol-bis-invoice-3](https://github.com/OpenPEPPOL/peppol-bis-invoice-3)) are not copied into this repository: the Peppol BIS states it may not be redistributed without OpenPeppol AISBL's consent. `fixtures/peppol/official-examples.json` names nine of them with their SHA-256 as fetched on 19 Nov 2026; `npm run peppol:examples` downloads them into `fixtures/peppol/official/` (git-ignored) and checks each hash. On 19 Nov all nine were read with no EN 16931 or Peppol rule broken; three (`vat-category-E`, `-O`, `-Z`) carry the made-up account `SE1212341234123412`, which Purser's own IBAN rule flags (it is not a valid IBAN).
- `test/peppol.test.ts`: the reader's refusals (DTD, entities, encodings, caps, malformed XML, prefixes), every rule above broken on purpose and named, the payee, two-account and direct-debit holds, credit notes, the official examples when downloaded (skipped otherwise, as in CI), and the inbox: filed as XML, read by no model, ready when nothing is wrong, held with the rule named when something is, still held when checked again, credit note never payable, XXE refused with nothing filed, and the words of a note screened like a PDF's.

## Receiving over Peppol: the owner's step

Receiving needs a Peppol **Access Point** (AP), a certified service provider that is on the network, registers the company in the Peppol directory (SMP) under its identifier (for a Dutch company, its KvK number under scheme 0106, or its VAT number), receives the messages sent to it, validates them, and hands them on. Purser does not run an AP and does not need to.

1. **Choose an AP provider.** OpenPeppol lists the certified ones (peppol.org, "Peppol Certified Service Providers"). Things to compare: a receive-only plan, an API or webhook that delivers the UBL as it came (not a converted format), validation before delivery, a test (non-production) environment, the countries and identifier schemes it registers, and its price per message.
2. **Register the company** with the provider (the provider does the SMP registration), first in its test environment.
3. **Connect the delivery to Purser.** Until a provider is chosen nothing is wired: the provider's webhook or polling API would hand each message's UBL bytes to the inbox's existing way in (`POST /api/payables/documents` with the XML as the body, or `npm run payables -- add <file.xml>`; Purser Cloud's `POST /v1/engine/documents` goes through the same `ingestDocument`, not yet tried with XML). The provider's credentials are secrets and go where the other secrets go (`wrangler secret put` or the runner's environment), never into this repository.
4. **Try it in the provider's test environment** with the provider's sample messages and the official examples (`npm run peppol:examples`, then `npm run peppol:check -- fixtures/peppol/official/*.xml`), before switching production on.

Nothing about Peppol is live: no Access Point, no registration, no message received from the network.

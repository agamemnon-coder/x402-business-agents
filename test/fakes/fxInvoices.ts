// Supplier invoices from outside Germany, as their text layers read: a US supplier paid by ACH, a Chinese one by SWIFT,
// a UK one by Faster Payments, a Turkish one by a TRY IBAN. Bank details are documentation examples and pass their
// checksums; the companies are made up for the tests.
export const US = `Pinecrest Outdoor Supply LLC
412 5th Avenue, Seattle WA 98104
INVOICE PC-7781
Invoice date: 2 November 2026
Due date: 30 November 2026
Total due USD 2,400.00
Account number: 50001121
ABA routing number: 021000021
Bank country: US
Payment reference: PC-7781`;

export const CN = `Ningbo Textile Co Ltd
88 Zhongshan Road, Ningbo
INVOICE NT-20261102
Invoice date: 2 November 2026
Due date: 2 December 2026
Total due CNY 18,000.00
Account number: 6222021001115222
SWIFT: ICBKCNBJNBO
Payment reference: NT-20261102`;

export const UK = `Harbour Rope Ltd
3 Quay Street, Bristol BS1 4DB
INVOICE HR-0042
Invoice date: 3 November 2026
Due date: 17 November 2026
Subtotal GBP 800.00
VAT 20% GBP 160.00
Total due GBP 960.00
Account number: 31926819
Sort code: 60-16-13
Bank country: GB
Payment reference: HR-0042`;

export const TR = `Bursa Tekstil AS
Organize Sanayi Bolgesi, Bursa
INVOICE BT-5531
Invoice date: 4 November 2026
Due date: 25 November 2026
Total due TRY 52,000.00
IBAN: TR33 0006 1005 1978 6457 8413 26
Payment reference: BT-5531`;

// The ledger's read-only page: every report on one page, outside text escaped, the VAT notice shown, no scripts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { purchaseInvoice } from "../src/ledger/documents.js";
import { LEDGER_PAGE_CSP, ledgerPage } from "../src/ledger/page.js";
import { VAT_NOTICE } from "../src/ledger/vat.js";

describe("the ledger page", () => {
  it("shows the reports, escapes a supplier's own name and allows only its own stylesheet", () => {
    const db = openDb(":memory:");
    purchaseInvoice(db, { date: "2026-11-02", supplier: "<script>alert(1)</script> GmbH", doc_ref: "X-1", due_date: "2026-11-30", currency: "EUR", created_by: "t", lines: [{ account: "6900", net_cents: 10_000, vat_code: "P21" }] });
    const html = ledgerPage(db, { asOf: "2026-11-30", quarter: "2026Q4", year: 2026 });
    for (const h of ["Profit and loss", "Balance sheet", "Cash", "VAT overview 2026Q4", "We owe suppliers", "Stock", "Trial balance"]) expect(html).toContain(h);
    expect(html).toContain("Ledger chain verified: 1 entries");
    expect(html).toContain(VAT_NOTICE);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; GmbH");
    expect(html).not.toMatch(/<script/i);
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(LEDGER_PAGE_CSP).toContain(`'sha256-${createHash("sha256").update(css).digest("base64")}'`);
    expect(LEDGER_PAGE_CSP).toContain("default-src 'none'");
  });
});

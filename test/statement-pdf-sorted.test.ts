// "Invoices, sorted by Claude" in the books PDF (Max, 14 Nov): text is drawn without soft hyphens or zero-width
// characters (a viewer showed them as stray dots), and Claude's reason is one short line under its row, cut at a word,
// with the whole reason in the PDF's appendix.
import { describe, expect, it } from "vitest";
import { clean, shortReason } from "../src/vault/statementPdf.js";

describe("the sorted invoices' text in the books PDF", () => {
  it("drops soft hyphens and zero-width characters", () => {
    expect(clean("co­de 2026-1​0-01 EUR⁠ 38.50 No﻿ supplier")).toBe("code 2026-10-01 EUR 38.50 No supplier");
  });
  it("keeps a short reason whole and cuts a long one at a word, about 140 characters, with an ellipsis", () => {
    expect(shortReason("Coded to 6900 with P21.")).toBe("Coded to 6900 with P21.");
    const long = "Office rent for Prinsengracht 412 (invoice VG-2026-10, dated 2026-10-01) is booked to 6900 Other supplier invoices, as no rent account exists in the chart.";
    const cut = shortReason(long);
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1)).not.toMatch(/\s$/);
  });
});

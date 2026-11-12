// The demo extras' route in the engine block (the try-extras stream), added by one line in cloud/src/app.ts and one in
// ./gate.ts's TRY_ROUTES:
//   GET /v1/engine/books/effect?invoice_no=&vendor=   the books screen's P&L and VAT before and after this invoice,
//       computed by the ledger's report code over the company's own posted lines (src/try/books.ts), and the T0 row.
// Behind the switch `books_effect` (off when missing: 404 as if the route were not there).
import { isClosingKey } from "../../../src/ledger/reports.js";
import { booksEffect, T0_ROW, type EntryLine } from "../../../src/try/books.js";
import { BadRequest } from "../read.js";
import type { EngineKit, EngineRoute } from "../engine/routes.js";
import type { TryEngineCtx } from "./engineRoutes.js";
import { on, readSwitches } from "./switches.js";

/** The payables line's doc_ref for an inbox invoice (src/ap/ledgerKey.ts ledgerInvoiceNo; a test holds the two equal). */
export const ledgerRef = (invoiceNo: string, vendor: string): string => `${invoiceNo.trim()} · ${vendor.trim()}`;

export function tryExtraEngineRoutes<C extends TryEngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  return [
    { method: "GET", path: "/v1/engine/books/effect", summary: "The effect of one invoice on the books (the hands-on demo): { effect: { currency, entries, period, quarter, pnl: { before, after }, vat: { before, after }, vat_notice } | null, t0 }. Computed by the ledger's own report code over the company's posted lines; null until the invoice is in the books. ?invoice_no=&vendor=.", need: "read", run: async (c) => {
      let s;
      try { s = await readSwitches(c.env.sql); } catch { return err(404, "no such route"); }
      if (!on(s, "books_effect") || !c.db) return err(404, "no such route");
      const no = c.url.searchParams.get("invoice_no") ?? "", vendor = c.url.searchParams.get("vendor") ?? "";
      if (!no || no.length > 64 || vendor.length > 140) throw new BadRequest("invoice_no (at most 64 characters) and vendor (at most 140) are needed");
      const all = await c.db.select<EntryLine>("ledger_lines", {}, { order: ["entry_id", "line_no"] });
      const entries = await c.db.select<{ entry_id: number; entry_json: string }>("ledger_entries", {}, { order: ["entry_id"] });
      const closing = new Set(entries.filter((e) => isClosingKey((JSON.parse(e.entry_json) as { source_key?: string | null }).source_key)).map((e) => e.entry_id));
      const lines = all.map((l) => ({ ...l, closing: closing.has(l.entry_id) }));
      return json(200, { effect: booksEffect(lines, [no, ...(vendor ? [ledgerRef(no, vendor)] : [])], c.now.toISOString().slice(0, 10)), t0: T0_ROW });
    } },
  ];
}

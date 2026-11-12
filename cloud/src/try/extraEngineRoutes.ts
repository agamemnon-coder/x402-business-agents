// The demo extras' routes that need the visitor's session (the try-extras stream), under /v1/try so the engine's own
// block stays as it is; added by one line in cloud/src/app.ts and listed in ./gate.ts's TRY_ROUTES:
//   GET /v1/try/books/effect?invoice_no=&vendor=   the books screen's P&L and VAT before and after this invoice,
//       computed by the ledger's report code over the company's own posted lines (src/try/books.ts), and the T0 row.
//   GET  /v1/try/scenarios/{seed}   the scenario a seed picks: its id, title and the story's company (no answer)
//   POST /v1/try/scenarios/{seed}   plays it: its invoices through the company's inbox, in order, as uploads; the
//       engine's answer to the last one, what that means in three words, and the right answer to compare with
// Each behind its own switch (books_effect, scenarios), off when missing: 404 as if the route were not there.
import { isClosingKey } from "../../../src/ledger/reports.js";
import { booksEffect, T0_ROW, type EntryLine } from "../../../src/try/books.js";
import { BadRequest } from "../read.js";
import type { EngineKit, EngineRoute } from "../engine/routes.js";
import type { TryEngineCtx } from "./engineRoutes.js";
import { decisionOf } from "../../../src/try/endCard.js";
import { parseSeed, pick } from "../../../src/try/scenarios/seed.js";
import { tallyFiled } from "./counter.js";
import { noteReader } from "./metrics.js";
import { SCENARIOS } from "./scenarios.gen.js";
import { isTryTenant } from "./start.js";
import { on, readSwitches, type Switches } from "./switches.js";

async function switches(c: TryEngineCtx): Promise<Switches | null> {
  try { return await readSwitches(c.env.sql); } catch { return null; }
}
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** The payables line's doc_ref for an inbox invoice (src/ap/ledgerKey.ts ledgerInvoiceNo; a test holds the two equal). */
export const ledgerRef = (invoiceNo: string, vendor: string): string => `${invoiceNo.trim()} · ${vendor.trim()}`;

export function tryExtraEngineRoutes<C extends TryEngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  return [
    { method: "GET", path: "/v1/try/books/effect", summary: "The effect of one invoice on the books (the hands-on demo): { effect: { currency, entries, period, quarter, pnl: { before, after }, vat: { before, after }, vat_notice } | null, t0 }. Computed by the ledger's own report code over the company's posted lines; null until the invoice is in the books. ?invoice_no=&vendor=.", need: "read", run: async (c) => {
      const s = await switches(c);
      if (!s || !on(s, "books_effect") || !c.db) return err(404, "no such route");
      const no = c.url.searchParams.get("invoice_no") ?? "", vendor = c.url.searchParams.get("vendor") ?? "";
      if (!no || no.length > 64 || vendor.length > 140) throw new BadRequest("invoice_no (at most 64 characters) and vendor (at most 140) are needed");
      const all = await c.db.select<EntryLine>("ledger_lines", {}, { order: ["entry_id", "line_no"] });
      const entries = await c.db.select<{ entry_id: number; entry_json: string }>("ledger_entries", {}, { order: ["entry_id"] });
      const closing = new Set(entries.filter((e) => isClosingKey((JSON.parse(e.entry_json) as { source_key?: string | null }).source_key)).map((e) => e.entry_id));
      const lines = all.map((l) => ({ ...l, closing: closing.has(l.entry_id) }));
      return json(200, { effect: booksEffect(lines, [no, ...(vendor ? [ledgerRef(no, vendor)] : [])], c.now.toISOString().slice(0, 10)), t0: T0_ROW });
    } },
    { method: "GET", path: "/v1/try/scenarios/{seed}", summary: "The scenario a seed picks (the hands-on demo): { seed, id, title, company, files }. The right answer is not here; it comes with the engine's answer when the scenario is played.", need: "read", run: async (c) => {
      const s = await switches(c);
      const seed = parseSeed(c.params[0]);
      if (!s || !on(s, "scenarios") || seed === null) return err(404, "no such scenario");
      const { scenario, company } = pick(SCENARIOS, seed);
      return json(200, { seed, id: scenario.id, title: scenario.title, company, files: scenario.files.length });
    } },
    { method: "POST", path: "/v1/try/scenarios/{seed}", summary: "Play the scenario a seed picks in your test company: its invoices go through the engine's inbox in order, as uploads (test invoices, fake). Answers { seed, id, title, company, setup (files filed before the last), answer (the engine's answer to the last, as POST /v1/engine/documents), decided: { action, why }, expect: { action, reason } }; 400 in the engine's words when it refuses a file (a test company's limit of 8 documents).", need: "admin", run: async (c) => {
      const s = await switches(c);
      const seed = parseSeed(c.params[0]);
      if (!s || !on(s, "scenarios") || seed === null) return err(404, "no such scenario");
      if (!isTryTenant(c.caller!.tenantId)) return err(403, "only a test company of the hands-on demo plays a scenario");
      const e = c.env.engine?.(c.caller!.tenantId);
      if (!e) return err(404, "the engine is not switched on for this cloud");
      const { scenario, company } = pick(SCENARIOS, seed);
      let last = null as Awaited<ReturnType<typeof e.upload>> | null;
      for (const f of scenario.files) {
        try { last = await e.upload({ bytes: fromB64(f.base64), filename: f.filename, mime: "application/pdf" }); } catch (x) {
          const said = x instanceof Error ? x.message : String(x);
          if (/nothing was filed$/.test(said)) throw new BadRequest(said.slice(0, 500));
          throw x;
        }
      }
      await tallyFiled(c.env.sql, last, c.now);
      await noteReader(c.env.sql, last?.invoice?.read_by, c.now);
      return json(200, { seed, id: scenario.id, title: scenario.title, company, setup: scenario.files.length - 1, answer: last, decided: last ? decisionOf(last) : null, expect: scenario.expect });
    } },
  ];
}

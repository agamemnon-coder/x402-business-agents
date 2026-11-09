// A supplier's credit note lowers what is open to that supplier: set against its open invoices in the same currency,
// shown as its own line (never folded silently into the invoices), and never paid out by itself. A credit with no
// open invoice to set against is money the supplier owes back, listed as such.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { insights } from "../src/ap/insights.js";
import { payApInvoice } from "../src/ap/pay.js";
import { publicInvoice } from "../src/ap/public.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, setStatus } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { monthData } from "../src/vault/data.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { testCloud } from "./support/cloud.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-09T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const credit = (vendor: string, no: string, amount: string) => `${vendor}
Gutschrift
Gutschriftnummer: ${no}
Datum: 05.11.2026
Gesamtbetrag ${amount} EUR
IBAN: DE75 5121 0800 1245 1261 99`;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "credit-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, name: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};

describe("credit notes set against the supplier's open invoices", () => {
  it("lower what is open to that supplier, as a line of their own", async () => {
    await add(DE, "ln.pdf");
    const cn = await add(credit("Lagerhaus Nord GmbH", "GS-2026-0007", "119,00"), "gs.pdf");
    expect(apInvoice(db, cn)!.doc_kind).toBe("credit_note");
    const i = insights(db, now);
    expect(i.open).toEqual([{ currency: "EUR", total: "1190.00", count: 1 }]);
    expect(i.credits).toEqual([{ currency: "EUR", total: "119.00", count: 1 }]);
    expect(i.open_net).toEqual([{ currency: "EUR", total: "1071.00", count: 1 }]);
    expect(i.credits_left).toEqual([]);
  });

  it("never take a supplier below zero: the rest is owed back, listed per supplier", async () => {
    await add(DE, "ln.pdf");
    await add(credit("Lagerhaus Nord GmbH", "GS-2026-0008", "2.000,00"), "gs.pdf");
    const i = insights(db, now);
    expect(i.credits).toEqual([{ currency: "EUR", total: "1190.00", count: 1 }]);
    expect(i.open_net).toEqual([{ currency: "EUR", total: "0.00", count: 1 }]);
    expect(i.credits_left).toEqual([{ vendor: "Lagerhaus Nord GmbH", currency: "EUR", total: "810.00" }]);
  });

  it("do not touch another supplier's invoices", async () => {
    await add(EN, "bergtex.pdf");
    await add(credit("Lagerhaus Nord GmbH", "GS-2026-0009", "119,00"), "gs.pdf");
    const i = insights(db, now);
    expect(i.open_net).toEqual([{ currency: "EUR", total: "1850.00", count: 1 }]);
    expect(i.credits).toEqual([]);
    expect(i.credits_left).toEqual([{ vendor: "Lagerhaus Nord GmbH", currency: "EUR", total: "119.00" }]);
  });

  it("show in the month report as their own lines, with the open total after them", async () => {
    await add(DE, "ln.pdf");
    await add(credit("Lagerhaus Nord GmbH", "GS-2026-0007", "119,00"), "gs.pdf");
    const m = monthData(db, "2026-11");
    expect(m.received).toEqual([{ currency: "EUR", total: "1190.00", count: 1 }]);
    expect(m.credits).toEqual([{ vendor: "Lagerhaus Nord GmbH", invoice_no: "GS-2026-0007", amount: "EUR 119.00" }]);
    expect(m.open_net).toEqual([{ currency: "EUR", total: "1071.00", count: 1 }]);
  });

  it("are never paid out, even when someone marks one ready", async () => {
    const cn = await add(credit("Lagerhaus Nord GmbH", "GS-2026-0007", "119,00"), "gs.pdf");
    setStatus(db, cn, "ready", "human", { reason: "test: a person cleared it by mistake" }, now);
    expect(publicInvoice(apInvoice(db, cn)!)).toMatchObject({ payable: false });
    await expect(payApInvoice(db, awx, cn, now)).rejects.toThrow(/credit note.*never paid/);
  });
});

describe("in the cloud", () => {
  it("the insight there sets credit notes against open invoices too, and never counts one as open", async () => {
    await add(DE, "ln.pdf");
    await add(credit("Lagerhaus Nord GmbH", "GS-2026-0007", "119,00"), "gs.pdf");
    const c = testCloud();
    try {
      const t = await c.tenant("northwind");
      await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, now);
      const ins = (await c.req("GET", "/v1/insights", { key: t.key })).json as { open_cents: Record<string, number>; credits_cents: Record<string, number>; open_net_cents: Record<string, number> };
      expect(ins.open_cents).toEqual({ EUR: 119_000 });
      expect(ins.credits_cents).toEqual({ EUR: 11_900 });
      expect(ins.open_net_cents).toEqual({ EUR: 107_100 });
    } finally {
      c.close();
    }
  });
});

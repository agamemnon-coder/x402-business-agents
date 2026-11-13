// A Coder line left without a VAT code on a German supplier's invoice (final-polish, 13 Nov): the books set the foreign
// code from the supplier's own VAT id, as the engine's own accrual does (src/ap/books.ts accrualVatCode), so its 19% is
// booked to 1515 (Foreign VAT to reclaim), never to Dutch input VAT (1510, box 5b).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { accrualEntries } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, type ApInvoiceRow, type StoredCoding } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  vi.stubEnv("KIT11_AP_AGENTS", "");
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "vat-uncoded-"));
  db = openDb(":memory:");
  for (const [id, name, iban, bic] of [["ben_bergtex", "Bergtex Textil GmbH", "DE89370400440532013000", "COBADEFFXXX"], ["ben_zeeland", "Zeeland Verpakkingen B.V.", "NL91ABNA0417164300", "ABNANL2A"]] as const) {
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(id, name, iban.slice(-4), ibanSha(iban), bic);
  }
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
const add = async (text: string, name: string): Promise<ApInvoiceRow> => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return apInvoice(db, out.invoice.id)!;
};
const uncoded = (inv: ApInvoiceRow, net: number, vat: number): ApInvoiceRow => ({
  ...inv,
  coding: {
    status: "needs_review", source: "claude", overridden_by: null, refused_because: null, review: "a person codes the VAT", reason: "test", total_cents: net + vat,
    lines: [{ line_no: 1, account: "6200", vat_code: null, cost_centre: "CC100", net_cents: net, vat_cents: vat }],
  } as unknown as StoredCoding,
});
const on = (es: ReturnType<typeof accrualEntries>, a: string) => es.filter((e) => e.account === a).map((e) => e.debit);

describe("a German invoice's VAT left uncoded by the Coder", () => {
  it("is booked to 1515 under PF_DE19, as the engine's own accrual books it", async () => {
    const es = accrualEntries(uncoded(await add(EN, "en.pdf"), 155462, 29538));
    expect(on(es, "1515")).toEqual(["295.38"]);
    expect(on(es, "1510")).toEqual([]);
    expect(es.find((e) => e.account === "6200")).toMatchObject({ vat_code: "PF_DE19", vat_cents: 29538 });
  });

  it("a Dutch supplier's uncoded VAT keeps no code: the books do not guess a Dutch one", async () => {
    const inv = await add(NL, "nl.pdf");
    const total = Math.round(Number(inv.total) * 100), tax = Math.round(Number(inv.tax) * 100);
    const es = accrualEntries(uncoded(inv, total - tax, tax));
    expect(es.find((e) => e.account === "6200")?.vat_code).toBeUndefined();
    expect(on(es, "1515")).toEqual([]);
  });
});

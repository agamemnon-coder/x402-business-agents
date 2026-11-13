// Foreign VAT on its own account (code review, 13 Nov): German VAT a German supplier charged (PF_DE19) is not Dutch input
// VAT, so it must not sit on 1510 (input VAT receivable, reclaimed in box 5b). It is booked to 1515, "Foreign VAT to
// reclaim (EU refund)": reclaimed from Germany through the EU refund procedure, never in the Dutch return. After any mix
// of Dutch and German invoices, 1510 equals 5b and 1515 equals the German VAT.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { ledgerInvoices } from "../src/agents/controllerAgent.js";
import { accrualEntries } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, type ApInvoiceRow, type StoredCoding } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { FOREIGN_VAT, INPUT_VAT, LEDGER_ACCOUNTS } from "../src/ledger/accounts.js";
import { verifyLedger } from "../src/ledger/core.js";
import { purchaseInvoice } from "../src/ledger/documents.js";
import { syncLedger } from "../src/ledger/feed.js";
import { trialBalance, vatOverview } from "../src/ledger/reports.js";
import { ACCOUNT_NAMES_NL } from "../src/vault/pdf.js";
import { plainName } from "../src/vault/statementPdf.js";
import { ACCOUNTS_FOR_PAGE, roleOf } from "../cloud/src/try/books.js";
import { T0_SANDBOX_AP_MAP } from "../src/e2e/platformRun.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

function onFile(db: DB, id: string, name: string, iban: string, bic: string): void {
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(id, name, iban.slice(-4), ibanSha(iban), bic);
}

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  vi.stubEnv("KIT11_AP_AGENTS", "");
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "vat-foreign-"));
  db = openDb(":memory:");
  onFile(db, "ben_bergtex", "Bergtex Textil GmbH", "DE89370400440532013000", "COBADEFFXXX");
  onFile(db, "ben_zeeland", "Zeeland Verpakkingen B.V.", "NL91ABNA0417164300", "ABNANL2A");
  onFile(db, "ben_lagerhaus", "Lagerhaus Nord GmbH", "DE75512108001245126199", "BYLADEM1001");
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const add = async (text: string, name: string): Promise<string> => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const balance = (account: string): number => trialBalance(db).filter((r) => r.account === account && r.currency === "EUR").reduce((n, r) => n + r.balance_cents, 0);

describe("foreign VAT is booked to 1515, never to Dutch input VAT (1510)", () => {
  it("after Dutch and German invoices: 1510 equals box 5b, and 1515 equals the German VAT", async () => {
    await add(EN, "en.pdf"); // Bergtex, DE VAT id, 19%: 295.38
    await add(NL, "nl.pdf"); // Zeeland, 21%: 84.00
    await add(DE, "de.pdf"); // Lagerhaus Nord, DE VAT id, 19%: 190.00
    syncLedger(db, now);
    expect(verifyLedger(db).ok).toBe(true);
    const v = vatOverview(db, "2026Q4");
    expect(v.input_5b_cents).toBe(8400);
    expect(balance(INPUT_VAT)).toBe(v.input_5b_cents);
    expect(balance(FOREIGN_VAT)).toBe(29538 + 19000);
    expect(balance(FOREIGN_VAT)).toBe(v.foreign_vat.vat_cents);
  });

  it("the engine's own accrual of a German invoice debits 1515 and the CSV names it", async () => {
    const id = await add(EN, "en.pdf");
    const es = accrualEntries(apInvoice(db, id)!);
    expect(es.map((e) => [e.account, e.debit, e.credit])).toEqual([["6200", "1554.62", ""], ["1515", "295.38", ""], ["2100", "", "1850.00"]]);
    expect(es[1]!.account_name).toBe("Foreign VAT to reclaim (EU refund)");
  });

  it("a coded accrual puts a PF_DE19 group's VAT on 1515 and a Dutch group's on 1510", async () => {
    const inv = apInvoice(db, await add(EN, "en.pdf"))!;
    const coding = {
      status: "coded", source: "fallback", overridden_by: null, refused_because: null, review: null, reason: "test", total_cents: 185000 + 12100,
      lines: [
        { line_no: 1, account: "6200", vat_code: "PF_DE19", cost_centre: "CC100", net_cents: 155462, vat_cents: 29538 },
        { line_no: 2, account: "6900", vat_code: "P21", cost_centre: "CC100", net_cents: 10000, vat_cents: 2100 },
      ],
    } as unknown as StoredCoding;
    const coded: ApInvoiceRow = { ...inv, total: "1971.00", coding };
    const es = accrualEntries(coded);
    const on = (a: string) => es.filter((e) => e.account === a).map((e) => e.debit);
    expect(on("1515")).toEqual(["295.38"]);
    expect(on("1510")).toEqual(["21.00"]);
  });

  it("a purchase invoice posted as a document with PF_DE19 balances, with its VAT on 1515", () => {
    purchaseInvoice(db, { supplier: "Bergtex Textil GmbH", date: "2026-11-02", doc_ref: "BTX-1", due_date: "2026-11-30", currency: "EUR", created_by: "test", lines: [{ account: "6200", net_cents: 100000, vat_code: "PF_DE19" }] }, now);
    expect(balance(FOREIGN_VAT)).toBe(19000);
    expect(balance(INPUT_VAT)).toBe(0);
    expect(balance("2100")).toBe(-119000);
  });

  it("the controller reads a German invoice's VAT from 1515, so its 19% check holds", async () => {
    await add(EN, "en.pdf");
    syncLedger(db, now);
    const [inv] = ledgerInvoices(db);
    expect(inv).toMatchObject({ vat_code: "PF_DE19", vat_cents: 29538 });
  });

  it("every place that names accounts names 1515", () => {
    expect(LEDGER_ACCOUNTS[FOREIGN_VAT]).toBe("Foreign VAT to reclaim (EU refund)");
    expect(plainName(FOREIGN_VAT, LEDGER_ACCOUNTS[FOREIGN_VAT]!)).toBe("Foreign VAT to reclaim (EU refund)");
    expect(ACCOUNT_NAMES_NL[FOREIGN_VAT]).toBe("Terug te vragen buitenlandse btw (EU-teruggaaf)");
    expect(roleOf(FOREIGN_VAT)).toBe("vat");
    expect(ACCOUNTS_FOR_PAGE[FOREIGN_VAT]).toEqual({ name: "Foreign VAT to reclaim (EU refund)", role: "vat" });
    expect(T0_SANDBOX_AP_MAP[FOREIGN_VAT]?.number).toBe("15100");
  });
});

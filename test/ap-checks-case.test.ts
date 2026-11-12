// src/ap/checks.ts keeps every database lookup of the payables checks: it builds the case (plain data) from the ledger
// and hands it to the one implementation of the checks, src/ap/checkerCore.ts codeFindings. The same case is what the
// Checker agent decides on. These tests pin what the case holds, lookup by lookup.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { codeFindings, statusOf } from "../src/ap/checkerCore.js";
import { blockedPayees, evaluate, invoiceCase } from "../src/ap/checks.js";
import { clearPossibleDuplicate, ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { rejectApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { parseApFallback } from "../src/ap/reading.js";
import { requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { COMPANY } from "../src/config/brand.js";
import { LICENCE_FEE_EUR_CENTS, LICENSOR_NAME } from "../src/config/policy.js";
import { openDb, type DB } from "../src/db/open.js";
import { fromCents } from "../src/lib/money.js";
import { counterpartyAllowed } from "../src/policy/rules.js";
import { setSetting } from "../src/world/settings.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const BERGTEX_IBAN = "DE89370400440532013000";
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ctx = { docSha: "x", now };

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-case-"));
  db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_bergtex', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')")
    .run(BERGTEX_IBAN.slice(-4), ibanSha(BERGTEX_IBAN));
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

let at = 0;
/** Files an invoice text; each one a minute after the last. */
const add = async (text: string) => {
  const when = new Date(now.getTime() + 60_000 * at++);
  const out = await ingestDocument(db, { ...deps, now: () => when }, { bytes: await pdfOf(text), filename: `invoice-${at}.pdf`, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice;
};
/** EN under another number and total, without its subtotal and tax lines. */
const bergtex = (no: string, total = "1,850.00") => EN.replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\n", "").replace("1,850.00", total);

describe("the case the checks run on, built from the ledger", () => {
  it("holds the reading, the text, today, the company, the suppliers on file by hash, and the policy", () => {
    const c = invoiceCase(db, parseApFallback(EN), EN, ctx);
    expect(c.invoice).toEqual({ id: null, reading: parseApFallback(EN), text: EN, receivedAt: null, accountSha256: ibanSha(BERGTEX_IBAN) });
    expect(c.today).toBe("2026-11-08");
    expect(c.company).toEqual({ name: process.env.KIT11_COMPANY ?? COMPANY });
    // The ledger keeps a supplier's account as a hash and its last four characters, never the account itself.
    expect(c.suppliers).toEqual([{ id: "ben_bergtex", name: "Bergtex Textil GmbH", accountSha256: ibanSha(BERGTEX_IBAN), last4: "3000", bic: "COBADEFFXXX", currency: "EUR" }]);
    expect(JSON.stringify(c.suppliers)).not.toContain(BERGTEX_IBAN.slice(4, 18));
    // No invoice is paid without the CFO's Face ID in the runner: the agent has no limit to pay alone.
    expect(c.policy.aloneLimit).toBeNull();
    expect(c.policy.payees).toEqual({ allowed: ["Bergtex Textil GmbH"], blocked: [] });
    expect(c.policy.currencies).toEqual(expect.arrayContaining(["EUR", "USD", "GBP"]));
    expect(c.policy.currencies).not.toContain("JPY");
    expect(c.policy.cashFloors).toEqual({ EUR: "0.00" });
    expect(c).toMatchObject({ history: [], alreadyInLedger: null, supplierRequest: null, clearedTwins: [], expected: null });
    expect(codeFindings(c)).toEqual([]);
  });

  it("holds no hash for an account that does not check out, and the document's missing text", () => {
    const bad = EN.replace("0130 00", "0130 01");
    expect(invoiceCase(db, parseApFallback(bad), bad, ctx).invoice.accountSha256).toBeNull();
    expect(invoiceCase(db, parseApFallback(""), "", { ...ctx, noText: "needs a person: a scan" }).invoice.noText).toBe("needs a person: a scan");
  });

  it("holds the cash floors the CFO set, for the funding currency and the invoice's", () => {
    setSetting(db, "human", "eur_floor", "25000.00");
    setSetting(db, "human", "usd_floor", "3000.00");
    const usd = EN.replace(/EUR/g, "USD");
    expect(invoiceCase(db, parseApFallback(usd), usd, ctx).policy.cashFloors).toEqual({ EUR: "25000.00", USD: "3000.00" });
  });

  it("holds the payees the CFO blocked, exactly those counterpartyAllowed refuses", () => {
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_other', 'Other Supplier B.V.', '4300', ?, 'ABNANL2A', 'EUR', 'SWIFT')").run(ibanSha("NL91ABNA0417164300"));
    setSetting(db, "human", "counterparty:Bergtex Textil GmbH", "blocked");
    setSetting(db, "human", "counterparty:Other Supplier B.V.", "allowed");
    expect(blockedPayees(db)).toEqual(["Bergtex Textil GmbH"]);
    for (const name of ["Bergtex Textil GmbH", "Other Supplier B.V.", "Nobody Ltd"]) expect(blockedPayees(db).includes(name)).toBe(!counterpartyAllowed(db, name));
    const c = invoiceCase(db, parseApFallback(EN), EN, ctx);
    expect(c.policy.payees).toEqual({ allowed: ["Other Supplier B.V."], blocked: ["Bergtex Textil GmbH"] });
    expect(codeFindings(c).map((f) => f.code)).toEqual(["payee_blocked"]);
  });

  it("holds the inbox's invoices as history, and the invoice's own row when it is checked again", async () => {
    const first = await add(EN);
    const c = invoiceCase(db, parseApFallback(EN), EN, ctx);
    expect(c.history).toEqual([{
      id: "AP-0001", vendor: "Bergtex Textil GmbH", invoiceNo: "BTX-2026-21", total: "1850.00", currency: "EUR", issueDate: "2026-11-02", receivedAt: first.received_at,
      state: "ready", accountKey: BERGTEX_IBAN, blockedAsDuplicate: false, rejectedWhy: null,
    }]);
    expect(codeFindings(c).map((f) => f.code)).toEqual(["duplicate"]);
    const again = invoiceCase(db, first.reading, EN, { ...ctx, selfId: "AP-0001" });
    expect(again.invoice).toMatchObject({ id: "AP-0001", receivedAt: first.received_at });
    expect(codeFindings(again)).toEqual([]);
  });

  it("marks a copy that was blocked as a duplicate, and holds why a person rejected an invoice", async () => {
    await add(EN);
    await add(`${EN}\nSecond copy.`);
    expect(invoiceCase(db, parseApFallback(EN), EN, ctx).history.map((h) => [h.id, h.state, h.blockedAsDuplicate])).toEqual([["AP-0001", "ready", false], ["AP-0002", "blocked", true]]);
    await rejectApInvoice(db, "AP-0001", "ordered twice", deps, now);
    const c = invoiceCase(db, parseApFallback(EN), EN, ctx);
    expect(c.history[0]).toMatchObject({ id: "AP-0001", state: "rejected", rejectedWhy: "rejected on the payables page: ordered twice" });
    expect(codeFindings(c).find((f) => f.code === "rejected_before")!.detail).toContain("(rejected on the payables page: ordered twice)");
  });

  it("holds a person's clearance of a possible duplicate, for the invoice it was given to", async () => {
    await add(bergtex("BTX-2026-17"));
    const twin = await add(bergtex("BTX-2026-18"));
    expect(twin.findings.map((f) => f.code)).toEqual(["possible_duplicate"]);
    await clearPossibleDuplicate(db, deps, "AP-0002", { by: "Max", note: "monthly order for November", actor: "human" });
    const c = invoiceCase(db, twin.reading, bergtex("BTX-2026-18"), { ...ctx, selfId: "AP-0002" });
    expect(c.clearedTwins).toEqual(["AP-0001"]);
    expect(codeFindings(c)).toEqual([]);
    // A clearance belongs to its invoice: another invoice with the same total asks again.
    expect(invoiceCase(db, parseApFallback(bergtex("BTX-2026-19")), bergtex("BTX-2026-19"), ctx).clearedTwins).toEqual([]);
  });

  it("holds the open request to add a new supplier", async () => {
    const inv = await add(NL);
    expect(invoiceCase(db, inv.reading, NL, { ...ctx, selfId: inv.id }).supplierRequest).toBeNull();
    const req = requestPayeeAddForInvoice(db, inv.id, "treasury", now);
    const c = invoiceCase(db, inv.reading, NL, { ...ctx, selfId: inv.id });
    expect(c.supplierRequest).toEqual({ id: req.add_id, status: "REQUESTED" });
    expect(codeFindings(c).find((f) => f.code === "new_supplier")!.detail).toContain(`(request ${req.add_id}, requested)`);
  });

  it("holds what the payment ledger already has for the invoice's number", () => {
    const ledgerNo = "BTX-2026-21 · Bergtex Textil GmbH";
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES (?, 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-16', ?, 'COBADEFFXXX', 'ben_bergtex', 'doc', 'PAID')")
      .run(ledgerNo, ibanSha(BERGTEX_IBAN));
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('t-1', 'r-1', ?, '1850.00', 'EUR', 'SWIFT', '0.00', 'PAID', 'sha', ?)")
      .run(ledgerNo, now.toISOString());
    const c = invoiceCase(db, parseApFallback(EN), EN, ctx);
    expect(c.alreadyInLedger).toBe("invoice BTX-2026-21 is already paid");
    expect(codeFindings(c).map((f) => [f.code, f.detail])).toEqual([["duplicate", "invoice BTX-2026-21 is already paid; a second copy is never paid"]]);
  });

  it("holds the contracted amount for a supplier the engine has a contract for", () => {
    const text = EN.replace("Bergtex Textil GmbH", LICENSOR_NAME);
    expect(invoiceCase(db, parseApFallback(text), text, ctx).expected).toEqual({ source: "contract", currency: "EUR", amount: fromCents(LICENCE_FEE_EUR_CENTS) });
    expect(invoiceCase(db, parseApFallback(EN), EN, ctx).expected).toBeNull();
  });

  it("evaluate is the checks over that case, with the status their findings give", async () => {
    await add(EN);
    for (const text of [EN, NL, bergtex("BTX-2026-30"), EN.replace("0130 00", "0130 01"), EN.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51")]) {
      const r = parseApFallback(text);
      const findings = codeFindings(invoiceCase(db, r, text, ctx));
      expect(evaluate(db, r, text, ctx)).toEqual({ status: statusOf(findings), findings });
    }
    expect(evaluate(db, parseApFallback(""), "", { ...ctx, noText: "needs a person: a scan" })).toEqual({ status: "needs_review", findings: [{ code: "no_text", level: "review", detail: "needs a person: a scan" }] });
  });
});

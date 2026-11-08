// The final seam review and red team round 3 on the integrated platform, each finding as the scenario that broke it.
// All against the in-memory Airwallex stand-in: no outside call, test money.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { readDocument } from "../src/ap/read.js";
import { parseApFallback, readingCheck, totalAmbiguity, totalLine } from "../src/ap/reading.js";
import { validateVendor, type Vendor } from "../src/erp/model.js";
import { safeSegment } from "../src/vault/layout.js";
import { apInvoice } from "../src/ap/store.js";
import { describeTerms } from "../src/approve/client.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAdd, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { fromCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes, FOUR_EYES_KEY } from "../src/policy/fourEyes.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { setSetting } from "../src/world/settings.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { TR, UK, US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
const BERGTEX = { vendor: "Bergtex Textil GmbH", amount: "1850.00", currency: "EUR", due_date: "2026-11-16", iban: "DE89370400440532013000", bic: "COBADEFFXXX", reference: "BTX-2026-21" };

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "final-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const add = async (text: string, name = "invoice.pdf") => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const addSupplier = async (id: string) => {
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = proposePayeeAdd(db, req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  return apInvoice(db, id)!;
};
const filed = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return out.proposal.proposal_id;
};
const approvedInbox = async (id: string) => { const p = await filed(id); approve(p); return p; };
const kit11 = async (invoiceNo: string) => {
  const out = await proposeInvoicePayment(db, awx, { ...BERGTEX, invoice_no: invoiceNo }, EN, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return out.proposal.proposal_id;
};

describe("R1: the same invoice paid through the inbox and Kit 11's bare number", () => {
  it("inbox first: Kit 11's bare number for the same supplier is refused, also at the executor", async () => {
    const id = await add(EN, "bergtex.pdf");
    const inbox = await approvedInbox(id);
    await executeInvoicePayment(db, awx, awx, inbox);
    expect(awx.transfers).toHaveLength(1);
    const out = await proposeInvoicePayment(db, awx, { ...BERGTEX, invoice_no: "BTX-2026-21" }, EN, now);
    expect(out.kind).toBe("escalated");
    expect(out.kind === "escalated" && out.reason).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21", now, undefined, { vendor: "Bergtex Textil GmbH" })).toMatch(/already paid/);
  });

  it("Kit 11 first: the inbox's number for the same supplier is handled, another supplier's is not", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    await executeInvoicePayment(db, awx, awx, bare);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · Bergtex Textil GmbH", now)).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · Stockline Data GmbH", now)).toBeNull();
  });

  it("both approved: whichever executes second pays nothing", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    // The inbox proposal filed before the guard knew (the seam): a payout under the inbox's number is already PAID.
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('BTX-2026-21 · Bergtex Textil GmbH', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-16', 'h', 'b', 'd', 'PAID')").run();
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('r-inbox', 'BTX-2026-21 · Bergtex Textil GmbH', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'x', ?)").run(now.toISOString());
    await expect(executeInvoicePayment(db, awx, awx, bare)).rejects.toThrow(/already paid/);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("R2: a supplier payment checks the treasury agent's identity", () => {
  it("a revoked treasury agent pays no supplier", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approvedInbox(id);
    revokePrincipal(db, "treasury", "test", "the CFO", now);
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow(/principal_revoked/);
    expect(awx.transfers).toHaveLength(0);
  });

  it("the treasury agent may pay every payable currency (TRY, GBP, USD), also with a principal from before", async () => {
    // A principal row written with the old defaults (USDZ, USD, EUR) is widened to the payable set.
    db.prepare("INSERT INTO principals (principal_id, kind, capabilities_json, status, created_at, updated_at) VALUES ('treasury', 'internal', ?, 'ACTIVE', ?, ?)")
      .run(JSON.stringify({ tools: ["sweep", "invoice_payment", "card_purchase"], rails: ["metal", "airwallex", "card"], currencies: ["USDZ", "USD", "EUR"], payees: ["sweep", "beneficiaries", "merchants"] }), now.toISOString(), now.toISOString());
    const id = await add(TR, "tr.pdf");
    await addSupplier(id);
    const pid = await approvedInbox(id);
    await executeSupplierPayment(db, awx, awx, pid);
    expect(awx.transfers).toHaveLength(1);
  });
});

describe("R3: four eyes covers supplier payments", () => {
  const p = (terms: object) => ({ kind: "supplier_payment", terms_json: JSON.stringify(terms) });
  it("EUR by its amount; EUR-funded by the quote's rate; otherwise over the threshold", () => {
    setSetting(db, "human", FOUR_EYES_KEY, "5000.00");
    expect(fourEyes(db, p({ amount: "4000.00", currency: "EUR", conversion: null }))).toBe(false);
    expect(fourEyes(db, p({ amount: "6000.00", currency: "EUR", conversion: null }))).toBe(true);
    // USD 10,000 with USD 2,000 bought for EUR 1,850: at that rate the whole payment is EUR 9,250.
    expect(fourEyes(db, p({ amount: "10000.00", currency: "USD", conversion: { sell_currency: "EUR", sell_amount: "1850.00", buy_amount: "2000.00" } }))).toBe(true);
    expect(fourEyes(db, p({ amount: "4000.00", currency: "USD", conversion: { sell_currency: "EUR", sell_amount: "3700.00", buy_amount: "4000.00" } }))).toBe(false);
    expect(fourEyes(db, p({ amount: "10.00", currency: "GBP", conversion: null }))).toBe(true);
  });
});

describe("R4: the same supplier under a second name", () => {
  it("a new supplier paid to an account already on file under another name is refused", () => {
    expect(() => requestPayeeAdd(db, { vendor: "BTX Holding AG", iban: "DE89370400440532013000", bic: "COBADEFFXXX", source: null }, "treasury", now))
      .toThrow(/already on file for Bergtex Textil GmbH/);
  });

  it("the ledger's guard knows a paid invoice by its account and number, whatever the name", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    await executeInvoicePayment(db, awx, awx, bare);
    const bergtexAccount = (db.prepare("SELECT iban_sha256 FROM invoices WHERE invoice_no = 'BTX-2026-21'").get() as { iban_sha256: string }).iban_sha256;
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · BTX Holding AG", now, undefined, { accountSha256: bergtexAccount })).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · BTX Holding AG", now, undefined, { accountSha256: "another" })).toBeNull();
  });
});

describe("R5: payments executed at once keep the EUR floor, whichever executor runs them", () => {
  /** EUR free above the floor and commitments set to `cents`, after the proposals were filed. */
  const freeEur = (cents: number) => setSetting(db, "human", "eur_obligations", fromCents(awx.bal.EUR.availableCents - 25_000_00 - cents));
  const held = () => db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE status = 'HELD'").get();

  it("a Kit 11 invoice payment and a supplier payment at once: one is paid, the other refused", async () => {
    const lagerhaus = await add(DE, "de.pdf");
    await addSupplier(lagerhaus);
    const supplier = await approvedInbox(lagerhaus);
    const legacy = await approvedInbox(await add(EN, "bergtex.pdf"));
    // EUR 2,500.00 free: EUR 1,870.00 (Bergtex with its fee ceiling) or EUR 1,190.00 (Lagerhaus) fits, not both.
    freeEur(2500_00);
    const out = await Promise.allSettled([executeInvoicePayment(db, awx, awx, legacy), executeSupplierPayment(db, awx, awx, supplier)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(String((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/EUR would now drop under its floor/);
    expect(awx.transfers).toHaveLength(1);
    expect(held()).toEqual({ n: 0 });
  });

  it("two Kit 11 invoice payments at once: one is paid, the other refused", async () => {
    const a = await kit11("BTX-2026-21");
    const b = await kit11("BTX-2026-22");
    approve(a);
    approve(b);
    freeEur(2500_00);
    const out = await Promise.allSettled([executeInvoicePayment(db, awx, awx, a), executeInvoicePayment(db, awx, awx, b)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(String((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/EUR would now drop under its floor/);
    expect(awx.transfers).toHaveLength(1);
    expect(held()).toEqual({ n: 0 });
  });
});

describe("R6: two amounts on one total line, and a tail the CFO does not see", () => {
  const usd = US.replace("Total due USD 2,400.00", "Amount due USD 2,400.00 on total USD 24,000.00");
  it("a total line with more than one amount is ambiguous: a person decides, code never picks", async () => {
    expect(totalAmbiguity(usd)).toMatch(/more than one amount/);
    const id = await add(usd, "two.pdf");
    expect(apInvoice(db, id)!.findings.map((f) => f.code)).toContain("ambiguous_total");
    expect(apInvoice(db, id)!.status).not.toBe("ready");
  });

  it("the line shown to the CFO ends at the chosen amount (its currency kept), leader dots folded", () => {
    const dotted = EN.replace("Total due EUR 1,850.00", `Total due ${".".repeat(150)} EUR 1,850.00 ${" ".repeat(40)}see page 2 for our terms and the late fee`);
    expect(totalLine(dotted)).toBe("Total due … EUR 1,850.00");
    expect(totalLine(DE)).toBe("Gesamtbetrag 1.190,00 EUR");
  });

  it("the approval card warns when the paid amount is not literally in the shown line", () => {
    const base = { kind: "supplier_payment", currency: "USD", amount: "24000.00", fee_reserve: "25.00", vendor: "Pinecrest Outdoor Supply LLC", beneficiary_name: "Pinecrest Outdoor Supply LLC", document_currency: "USD", conversion: null };
    expect(describeTerms({ ...base, document_total_line: "Amount due USD 2,400.00" }, {}).warnings.join(" ")).toMatch(/USD 24,000.00 is not written in the invoice's own total line/);
    expect(describeTerms({ ...base, document_total_line: "Amount due USD 24,000.00" }, {}).warnings.join(" ")).not.toMatch(/not written/);
    expect(describeTerms({ ...base, kind: "invoice_payment", currency: "EUR", document_currency: "EUR", amount: "1850.00", document_total_line: "Total due EUR 1.850,00" }, {}).warnings.join(" ")).not.toMatch(/not written/);
  });
});

describe("R7: a typographic apostrophe between the digits of a total", () => {
  it("3’400.00 and 3ʼ400.00 read as 3400.00; digits split by another mark are refused, never read as 400.00", () => {
    for (const sep of ["’", "ʼ"]) {
      const text = EN.replace("Total due EUR 1,850.00", `Total due CHF 3${sep}400.00`);
      expect(parseApFallback(text).total).toBe("3400.00");
      expect(totalAmbiguity(text)).toBeNull();
    }
    const odd = EN.replace("Total due EUR 1,850.00", "Total due CHF 3‘400.00");
    expect(parseApFallback(odd).total).not.toBe("400.00");
    expect(totalAmbiguity(odd)).toMatch(/split/);
  });
});

describe("R9: one supplier's payments on one day are held to the route's limit together", () => {
  it("TRY 249,999.99 and then TRY 2.00 to the same supplier on the same day: the second is escalated", async () => {
    const big = await add(TR.replace("TRY 52,000.00", "TRY 249,999.99"), "tr1.pdf");
    await addSupplier(big);
    expect((await payApInvoice(db, awx, big, now)).kind).toBe("proposed");
    const small = await add(TR.replace("TRY 52,000.00", "TRY 2.00").replaceAll("BT-5531", "BT-5532"), "tr2.pdf");
    expect(apInvoice(db, small)!.status).toBe("ready");
    const out = await payApInvoice(db, awx, small, now);
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/already paid or on its way to Bursa Tekstil AS today.*TRY 250,000\.00/);
  });
});

describe("R8: the supplier's name a model gives is checked and cleaned", () => {
  const claude = (vendor: string): Asker => ({ ask: async () => ({ value: { ...parseApFallback(EN), vendor }, source: "claude", model: "test-model", note: "" }) }) as unknown as Asker;
  it("control and bidi characters are stripped, and the name is capped at 120 characters", async () => {
    const { reading } = await readDocument(db, claude("‮Bergtex Textil GmbH​"), EN, "a".repeat(64));
    expect(reading.vendor).toBe("Bergtex Textil GmbH");
    const long = parseApFallback(`‮RLO Supplier\u0007 Ltd ${"x".repeat(200)}\n${EN}`).vendor;
    expect(long).toMatch(/^RLO Supplier Ltd x+$/);
    expect(long.length).toBeLessThanOrEqual(120);
  });

  it("a name that is not written in the document is not taken from the model", async () => {
    expect(readingCheck({ ...parseApFallback(EN), vendor: "Trusted Payee Ltd" }, EN)).toMatch(/supplier's name/);
    const { reading, readBy } = await readDocument(db, claude("Trusted Payee Ltd"), EN, "b".repeat(64));
    expect(readBy).toBe("parser");
    expect(reading.vendor).toBe("Bergtex Textil GmbH");
  });

  it("vault folder names and the ERP's validation refuse control and bidi characters", () => {
    expect(safeSegment("Berg‮tex​ GmbH\u0007")).toBe("Bergtex GmbH");
    expect(validateVendor({ id: "v1", name: "Bergtex‮ GmbH", currency: "EUR" } as Vendor).join(" ")).toMatch(/control or direction/);
  });
});

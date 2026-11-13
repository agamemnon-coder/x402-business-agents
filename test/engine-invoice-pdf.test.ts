// The hands-on demo's invoice and receipt PDFs (owner, 13 Nov: "a proper enterprise invoice"; "the VAT split must match
// the PDF's VAT line"): the invoice reads back to the same fields, laid out with its seller, number, dates, line items,
// VAT, total, payment details and a "Demo · test money" footer; and one written invoice, paid on the engine (stand-in
// bank, a software passkey), is booked with the PDF's own net and VAT, its receipt in the same layout. No network.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { pdfText } from "../src/ap/pdfText.js";
import { parseInvoiceFallback } from "../src/claude/invoiceReading.js";
import { CLEAN } from "../src/config/trySample.js";
import { openDb, type DB } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { invoicePdf, vatSplit } from "../src/engine/invoicePdf.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { checkCompose, SEEDED_SUPPLIERS } from "../src/engine/tryWorld.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import type { VaultSink } from "../src/vault/sink.js";

const RP = "engine.example.invalid", ORIGIN = `https://${RP}`;
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const eurOf = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return { put: (sha, bytes) => { kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; }, get: (p) => { const b = kept.get(p); if (!b) throw new Error(`no document at ${p}`); return b; } };
}
function memoryVault(): VaultSink & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  return {
    name: "memory", files,
    stat: async (p) => { const b = files.get(p); return b ? { sha256: sha(b), bytes: b.length } : null; },
    create: async (p, bytes) => { files.set(p, bytes); },
    readIndex: async (p) => files.get(p)?.toString("utf8") ?? null,
    writeIndex: async (p, text) => { files.set(p, Buffer.from(text)); },
    read: async (p) => files.get(p) ?? null,
  };
}

describe("the demo's invoice PDF", () => {
  it("lays out an enterprise invoice, and reads back to the same fields", async () => {
    const { text } = await pdfText(await invoicePdf({ fields: CLEAN, supplierKey: "bergtex", billTo: "Tulip Tiles (test) · Purser demo" }));
    const { net, vat } = vatSplit(CLEAN.amountCents);
    for (const want of [CLEAN.supplier.name, `${CLEAN.supplier.street}, ${CLEAN.supplier.city}`, `INVOICE ${CLEAN.invoiceNo}`, "Invoice date: 9 November 2026", "Due date: 30 November 2026",
      "BILL TO", "Tulip Tiles (test) · Purser demo", "DESCRIPTION QTY UNIT PRICE AMOUNT", "Linen fabric, natural, as ordered 1 EUR 1,554.62 EUR 1,554.62",
      "Subtotal EUR 1,554.62", "VAT 19% EUR 295.38", "Total due EUR 1,850.00", "IBAN: DE89 3704 0044 0532 0130 00", "BIC: COBADEFFXXX", `Payment reference: ${CLEAN.invoiceNo}`, "Demo · test money"]) {
      expect(text, want).toContain(want);
    }
    expect(net + vat).toBe(CLEAN.amountCents);
    expect(parseInvoiceFallback(text)).toMatchObject({ invoice_no: CLEAN.invoiceNo, vendor: CLEAN.supplier.name, amount: "1850.00", currency: "EUR", due_date: "2026-11-30", iban: CLEAN.iban, bic: CLEAN.supplier.bic });
  });
});

describe("a written invoice, paid on the engine", () => {
  it("is booked with the PDF's own net and VAT, and its receipt has the same layout", async () => {
    const db: DB = openDb(":memory:");
    useDocStore(db, memoryDocs());
    const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
    const bank = standInBank(store);
    const vault = memoryVault();
    const host = new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)), rp: { rpId: RP, origin: ORIGIN }, company: { name: "Tulip Tiles (test)", lang: "en" }, vault, feed: null });
    await host.seed();
    // Under EUR 100 is refused: the bank's flat fee would be more than the invoice.
    expect(checkCompose({ supplier_key: "bergtex", invoice_no: "INV-1", amount: "1.50", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban }, host.suppliers(), new Date())).toEqual({ refused: { field: "amount", message: "Demo invoices go from EUR 100 to EUR 5,000." } });
    const up = await host.compose({ supplier_key: "bergtex", invoice_no: "INV-6543", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
    if ("refused" in up) throw new Error(up.refused.message);
    const phone = new FakeAuthenticator();
    const st = await host.passkeyStart();
    await host.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "test passkey" });
    const p = await host.propose(up.invoice!.id);
    if (!p.ok) throw new Error(p.reason);
    const paid = await host.approve({ proposal_id: p.proposal.id, terms_sha256: p.proposal.terms_sha256, credential: phone.sign({ challenge: p.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(paid.settled).toMatchObject({ invoice_status: "paid", error: null });

    // The invoice as filed: its VAT and net lines.
    const files = [...vault.files.keys()].filter((f) => f.endsWith(".pdf"));
    const invoiceFile = files.find((f) => f.includes("Purchase invoices") || f.includes("Inkoopfacturen"))!;
    const receiptFile = files.find((f) => f !== invoiceFile)!;
    const inv = (await pdfText(vault.files.get(invoiceFile)!)).text;
    const pdfVat = eurOf(/VAT 19% EUR ([\d,]+\.\d{2})/.exec(inv)![1]!), pdfNet = eurOf(/Subtotal EUR ([\d,]+\.\d{2})/.exec(inv)![1]!);
    expect(pdfNet + pdfVat).toBe(32_100);
    expect(inv).toContain("Tulip Tiles (test) · Purser demo");

    // The ledger's accrual for it: expense = the PDF's net, input VAT = the PDF's VAT line, creditors = the total.
    const lines = db.prepare(`SELECT l.account, l.debit_cents AS d, l.credit_cents AS c FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.description LIKE '%INV-6543%(received)%'`).all() as { account: string; d: number; c: number }[];
    expect(lines.find((l) => l.account === "1510")?.d).toBe(pdfVat);
    expect(lines.filter((l) => l.d > 0 && l.account !== "1510").reduce((n, l) => n + l.d, 0)).toBe(pdfNet);
    expect(lines.find((l) => l.account === "2100")?.c).toBe(32_100);

    // The receipt: the company's block, the title, the paid amount, and the demo's footer.
    const rec = (await pdfText(vault.files.get(receiptFile)!)).text;
    for (const want of ["Tulip Tiles (test)", "Payment receipt", "EUR 321.00", "Demo · test money"]) expect(rec, want).toContain(want);
  });
});

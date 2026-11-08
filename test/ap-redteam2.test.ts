// Payables: red team round 2 on the inbox (aec65d0). Each attack below reached "ready" (and was paid once a simulated
// CFO approved) or stopped the process. The rule behind every fix: the code's own reading of the document is the
// authority; anything ambiguous goes to a person; nothing is guessed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { evaluate } from "../src/ap/checks.js";
import { classifyFallback } from "../src/ap/classify.js";
import { clearPossibleDuplicate, ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import { pdfText } from "../src/ap/pdfText.js";
import type { Asker } from "../src/ap/read.js";
import { parseApFallback, readingCheck, totalIsNegative, totalLine } from "../src/ap/reading.js";
import { apInvoice } from "../src/ap/store.js";
import { requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { scanFolder } from "../src/ap/watch.js";
import { openDb, type DB } from "../src/db/open.js";
import { sameInvoiceNo } from "../src/lib/invoiceKey.js";
import { payablesApp } from "../src/servers/payables.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-04T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
/** A model that returns what the attacker planted: the given reading, and `kind` for the label. */
const planted = (reading: Partial<Record<string, string>>, kind = "invoice"): Asker => ({
  ask: async (a, fallback) => {
    if (a.role === "classify") return { value: { kind }, source: "claude", model: "claude-haiku-5-5" };
    if (a.role === "act") return { value: { ...(fallback() as object), ...reading }, source: "claude", model: "claude-sonnet-5-5" };
    return { value: fallback(), source: "fallback", model: null, note: "no key" };
  },
} as Asker);

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-rt2-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fileWith = async (text: string, reader: Asker = parserOnly) => {
  const out = await ingestDocument(db, { ...deps, reader }, { bytes: await pdfOf(text), filename: "x.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return apInvoice(db, out.invoice.id)!;
};
const notPayable = (status: string) => expect(["blocked", "needs_review"]).toContain(status);
const codes = (inv: { findings: { code: string }[] }) => inv.findings.map((f) => f.code);

describe("round 2, 1: the currency comes from the total line, never from the whole text", () => {
  it("'Total 1 850,00 kr' with a euro fee in the footer is not EUR", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62\n", "").replace("VAT 19% EUR 295.38\n", "").replace("Total due EUR 1,850.00", "Total 1 850,00 kr\nLate fee €6,00");
    expect(parseApFallback(text).currency).toBe("");
    notPayable((await fileWith(text)).status);
  });
  it("a lower-case 'sek' on the total line is not EUR", () => {
    const text = EN.replace("Subtotal EUR 1,554.62\n", "").replace("VAT 19% EUR 295.38\n", "").replace("Total due EUR 1,850.00", "Total due sek 1,850.00\nfee EUR 5,00");
    expect(parseApFallback(text).currency).not.toBe("EUR");
  });
  it("an ISO code the code does not know on the total line ('ISK') leaves the currency empty", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62\n", "").replace("VAT 19% EUR 295.38\n", "").replace("Total due EUR 1,850.00", "Total due ISK 1,850.00\nfee EUR 5,00");
    expect(parseApFallback(text).currency).toBe("");
    notPayable((await fileWith(text)).status);
  });
  for (const word of ["Kč", "Fr.", "kronor", "zł", "MXN", "INR"]) {
    it(`'${word}' on the total line leaves the currency empty`, () => {
      const text = `Acme GmbH\nInvoice no: A-1\nTotal 1,850.00 ${word}\nLate fee €6,00\nIBAN: DE89 3704 0044 0532 0130 00\n`;
      expect(parseApFallback(text).currency).toBe("");
    });
  }
  it("a total line without a currency takes it from the subtotal and tax lines, never from a footer", () => {
    const text = EN.replace("Total due EUR 1,850.00", "Total due 1,850.00\nLate fee USD 5.00");
    expect(parseApFallback(text).currency).toBe("EUR");
    expect(parseApFallback(`Acme GmbH\nInvoice no: A-1\nTotal 1,850.00\nAll amounts in EUR\nIBAN: DE89 3704 0044 0532 0130 00\n`).currency).toBe("");
  });
});

describe("round 2, 2: which line is the amount to pay", () => {
  it("a deposit: 'Balance due' is the amount, and the two totals go to a person with both amounts named", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62", "Subtotal EUR 3,949.58").replace("VAT 19% EUR 295.38", "VAT 19% EUR 750.42")
      .replace("Total due EUR 1,850.00", "Total EUR 4,700.00\nLess deposit EUR 2,850.00\nBalance due EUR 1,850.00");
    expect(parseApFallback(text).total).toBe("1850.00");
    const inv = await fileWith(text);
    notPayable(inv.status);
    const amb = inv.findings.find((f) => f.code === "ambiguous_total");
    expect(amb?.detail).toMatch(/4700\.00/);
    expect(amb?.detail).toMatch(/1850\.00/);
  });
  it("an early-payment discount goes to a person", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62\n", "").replace("VAT 19% EUR 295.38\n", "").replace("Total due EUR 1,850.00", "Total EUR 2,000.00\nAmount payable EUR 1,850.00");
    expect(parseApFallback(text).total).toBe("1850.00");
    notPayable((await fileWith(text)).status);
  });
  it("a line-item row that starts with 'Total' goes to a person", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62\n", "").replace("VAT 19% EUR 295.38\n", "").replace("Total due EUR 1,850.00", "Total hours 40.00\nTotal due EUR 1,850.00");
    notPayable((await fileWith(text)).status);
  });
  it("'Total excl. VAT' and 'Total incl. VAT' read as subtotal and total; nothing ambiguous", async () => {
    const text = EN.replace("Subtotal EUR 1,554.62", "Total excl. VAT EUR 1,554.62").replace("Total due EUR 1,850.00", "Total incl. VAT EUR 1,850.00");
    const r = parseApFallback(text);
    expect([r.subtotal, r.tax, r.total]).toEqual(["1554.62", "295.38", "1850.00"]);
    const inv = await fileWith(text);
    expect(codes(inv)).not.toContain("ambiguous_total");
    expect(inv.status).toBe("ready");
  });
});

describe("round 2, 3: the same invoice under a lookalike number", () => {
  it("Cyrillic letters, the letter O for zero and other digit scripts are the same number", () => {
    expect(sameInvoiceNo("ВTX-2026-21", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("BTX-2O26-21", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("BTX-2026-2l", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("BTX-٢٠٢٦-٢١", "BTX-2026-21")).toBe(true);
    expect(sameInvoiceNo("BTX-2026-22", "BTX-2026-21")).toBe(false);
  });
  it("a model's invoice number the document's own lines cannot read is not used", () => {
    const text = EN.replace("INVOICE BTX-2026-21", "INVOICE ВTX-2026-21");
    expect(parseApFallback(text).invoice_no).toBe("");
    expect(readingCheck({ ...parseApFallback(text), invoice_no: "ВTX-2026-21" }, text)).toMatch(/invoice number/);
  });
  it("'BTX-2O26-21' dated ten days later is a possible duplicate, never paid", async () => {
    await fileWith(EN);
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "INVOICE BTX-2O26-21").replace("Invoice date: 2 November 2026", "Invoice date: 12 November 2026").replace("Payment reference: BTX-2026-21", "Payment reference: R-1"));
    notPayable(inv.status);
    expect(codes(inv)).toContain("possible_duplicate");
  });
  it("the Cyrillic number is a possible duplicate when checked against the first invoice", async () => {
    await fileWith(EN);
    const text = EN.replace("INVOICE BTX-2026-21", "INVOICE ВTX-2026-21").replace("Invoice date: 2 November 2026", "Invoice date: 12 November 2026");
    const r = { ...parseApFallback(text), invoice_no: "ВTX-2026-21", issue_date: "2026-11-12" };
    const out = evaluate(db, r, text, { docSha: "x", now });
    notPayable(out.status);
  });
  it("the same supplier and total 30 days apart under another number waits for a person; a person can clear it once, with the audit log", async () => {
    await fileWith(EN);
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "INVOICE BTX-2026-99").replace("Invoice date: 2 November 2026", "Invoice date: 2 December 2026").replace("Payment reference: BTX-2026-21", "Payment reference: BTX-2026-99"));
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain("possible_duplicate");
    expect(() => clearPossibleDuplicate(db, deps, inv.id, { by: "the CFO", note: "monthly rent, a new invoice", actor: "treasury" })).toThrow(/person/);
    const cleared = await clearPossibleDuplicate(db, deps, inv.id, { by: "the CFO", note: "monthly rent, a new invoice", actor: "human" });
    expect(cleared.status).toBe("ready");
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.duplicate_cleared' AND subject = ?").get(inv.id)).toEqual({ n: 1 });
  });
  it("a loose match on the number itself cannot be cleared that way", async () => {
    await fileWith(EN);
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "INVOICE BTX-2026-021").replace("Payment reference: BTX-2026-21", "Payment reference: R-2"));
    expect(codes(inv)).toContain("possible_duplicate");
    await expect(Promise.resolve().then(() => clearPossibleDuplicate(db, deps, inv.id, { by: "the CFO", note: "it is a different invoice", actor: "human" }))).rejects.toThrow(/number/);
  });
});

describe("round 2, 4 and 5: a classifier that lies", () => {
  it("a 'Gutschrift' with a positive total is a credit note even when the model says invoice", async () => {
    const inv = await fileWith(`Gutschrift\n${EN}`, planted({}, "invoice"));
    expect(codes(inv)).toContain("credit_note");
    notPayable(inv.status);
  });
  it("a reminder under a new number is a reminder even when the model says invoice", async () => {
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "PAYMENT REMINDER\nInvoice no: BTX-2026-77").replace("Payment reference: BTX-2026-21", "Payment reference: BTX-2026-77"), planted({}, "invoice"));
    expect(codes(inv)).toContain("reminder");
    notPayable(inv.status);
  });
});

describe("round 2, 6: credit notes in every minus form", () => {
  for (const total of ["EUR 1,850.00-", "EUR 1,850.00 -", "EUR 1,850.00 CR", "CR EUR 1,850.00", "EUR —1,850.00", "EUR ‐1,850.00", "EUR ﹣1,850.00", "EUR －1,850.00"]) {
    it(`"${total}" is a negative total`, () => {
      expect(totalIsNegative(EN.replace("Total due EUR 1,850.00", `Total due ${total}`))).toBe(true);
    });
  }
  it("a trailing minus is never paid", async () => {
    const inv = await fileWith(EN.replace("Total due EUR 1,850.00", "Total due EUR 1,850.00-"));
    expect(codes(inv)).toContain("credit_note");
    notPayable(inv.status);
  });
  it("avoir, nota di credito, abono, refund and rimborso are credit notes", () => {
    for (const w of ["Avoir", "Nota di credito", "Abono", "Refund", "Rimborso"]) expect(classifyFallback(`${w}\nTotal due EUR 10.00`), w).toBe("credit_note");
  });
  it("a positive total is not negative", () => {
    expect(totalIsNegative(EN)).toBe(false);
  });
});

/** A PDF whose one content stream inflates to `size` zero bytes. */
function deflateBomb(size: number): Buffer {
  const data = deflateSync(Buffer.alloc(size));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n4 0 obj << /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, "latin1");
  const tail = Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
  return Buffer.concat([head, data, tail]);
}

describe("round 2, 7: reading a PDF cannot stop or crash the process", () => {
  it("a deflate bomb is refused before it is read, with the reason", async () => {
    await expect(pdfText(deflateBomb(8 * 1024 * 1024), { maxDecodedBytes: 1024 * 1024 })).rejects.toThrow(/decoded/);
  });
  it("a PDF that takes too long is stopped, and the next one is read", async () => {
    const ok = await pdfOf(EN);
    await expect(pdfText(ok, { timeoutMs: 1 })).rejects.toThrow(/longer than/);
    expect((await pdfText(ok)).text).toMatch(/BTX-2026-21/);
  });
  it("a bomb in the inbox is filed for a person, and the inbox goes on", async () => {
    const out = await ingestDocument(db, deps, { bytes: deflateBomb(80 * 1024 * 1024), filename: "bomb.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    expect(out.invoice.status).toBe("needs_review");
    expect(out.invoice.findings[0]!.detail).toMatch(/decoded/);
    expect((await fileWith(EN)).status).toBe("ready");
  });
});

describe("round 2, 8: the watched folder", () => {
  it("a file over the size limit is refused without being read", async () => {
    const folder = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-watch-big-"));
    try {
      writeFileSync(join(folder, "huge.pdf"), Buffer.alloc(16 * 1024 * 1024 + 1));
      const out = await scanFolder(db, deps, folder);
      expect(out.failed).toEqual([{ file: "huge.pdf", error: expect.stringMatching(/larger than/) }]);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

describe("round 2, 9: the page", () => {
  let base = "";
  let close = () => {};
  const printed: string[] = [];
  beforeEach(async () => {
    printed.length = 0;
    const server = payablesApp(db, { inbox: deps, rail: awx, notify: (line) => printed.push(line) }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    close = () => server.close();
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => close());
  const token = async () => /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(base + "/")).text())?.[1] ?? "";
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST", headers: { origin: base, "x-csrf": await token(), "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
  });

  it("a malformed file name is a 400, not a 500", async () => {
    const r = await post("/api/payables/documents", await pdfOf(EN), { "content-type": "application/pdf", "x-filename": "%E0%A4%A" });
    expect(r.status).toBe(400);
  });
  it("a document is served with a strict content security policy", async () => {
    const inv = await fileWith(EN);
    const r = await fetch(`${base}/api/payables/invoices/${inv.id}/document`);
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'.*sandbox/);
  });
  it("a person's verification needs the code printed in the server's terminal and the IBAN's last four", async () => {
    const inv = await fileWith(DE);
    const req = requestPayeeAddForInvoice(db, inv.id, "human", now);
    const body = { by: "the CFO", how: "called Lagerhaus Nord on the number in our 2025 framework contract", street: "Hafenstraße 9", city: "Hamburg", postcode: "20457" };
    // The page token alone is not enough: a local process could fetch it.
    expect((await post(`/api/payables/suppliers/${req.add_id}/verify`, body)).status).toBe(403);
    expect((await post(`/api/payables/suppliers/${req.add_id}/verify-code`, {})).status).toBe(200);
    const code = /(\d{6})/.exec(printed.join("\n"))?.[1] ?? "";
    expect(code).toMatch(/^\d{6}$/);
    expect((await post(`/api/payables/suppliers/${req.add_id}/verify`, { ...body, code, iban_last4: "0000" })).status).toBe(403);
    const ok = await post(`/api/payables/suppliers/${req.add_id}/verify`, { ...body, code, iban_last4: "2051" });
    expect(ok.status).toBe(200);
    // The code works once.
    expect((await post(`/api/payables/suppliers/${req.add_id}/verify`, { ...body, code, iban_last4: "2051" })).status).toBe(403);
  });
  it("'not a duplicate' on the page also needs the terminal's code, and is in the audit log", async () => {
    await fileWith(EN);
    const inv = await fileWith(EN.replace(/BTX-2026-21/g, "BTX-2026-99").replace("Invoice date: 2 November 2026", "Invoice date: 2 December 2026"));
    expect(inv.status).toBe("needs_review");
    const body = { by: "the CFO", note: "monthly rent for December, a new invoice" };
    expect((await post(`/api/payables/invoices/${inv.id}/not-duplicate`, { ...body, code: "000000" })).status).toBe(403);
    expect((await post(`/api/payables/invoices/${inv.id}/not-duplicate-code`, {})).status).toBe(200);
    const code = /(\d{6})/.exec(printed.join("\n"))?.[1] ?? "";
    const ok = await post(`/api/payables/invoices/${inv.id}/not-duplicate`, { ...body, code });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("ready");
    expect(db.prepare("SELECT cleared_by, note FROM ap_duplicate_clearances WHERE invoice_id = ?").get(inv.id)).toEqual({ cleared_by: "the CFO", note: body.note });
  });
});

describe("round 2, 10: what the CFO signs", () => {
  it("the payment terms carry the document's own total line and the currency read from it", async () => {
    const inv = await fileWith(EN);
    const out = await payApInvoice(db, awx, inv.id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const terms = JSON.parse(out.proposal.terms_json) as Record<string, unknown>;
    expect(terms).toMatchObject({ document_total_line: "Total due EUR 1,850.00", document_currency: "EUR" });
    const { describeTerms } = await import("../src/approve/client.js");
    expect(JSON.stringify(describeTerms(terms, {}))).toMatch(/Total due EUR 1,850.00/);
    expect(totalLine(EN)).toBe("Total due EUR 1,850.00");
  });
});

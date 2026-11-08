// Payables: the independent review of PR #107. Each test reproduces one finding: a resent copy that blocked its
// original, books missing an accrual, a supplier locked out after an expired or rejected request, an IBAN read too long,
// invoices stuck waiting for the CFO, the rejected accrual left in the sink, and the cost of a huge e-mail or text.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import type { ApEntry, BookkeepingSink } from "../src/ap/books.js";
import { ingestDocument, ingestEmail, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import { MODEL_TEXT_LIMIT, type Asker } from "../src/ap/read.js";
import { ibanValid, parseApFallback } from "../src/ap/reading.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "Hafenstraße 9", city: "Hamburg", postcode: "20457" };
const HOW = "called Lagerhaus Nord on the number in our 2025 framework contract; their accounts team confirmed the IBAN";

class MemorySink implements BookkeepingSink {
  readonly name = "memory";
  entries: ApEntry[] = [];
  push(entries: ApEntry[]): void { this.entries.push(...entries); }
}
const cents = (s: string) => (s ? Math.round(Number(s) * 100) : 0);
const balance = (es: ApEntry[], account?: string) => es.filter((e) => !account || e.account === account).reduce((n, e) => n + cents(e.debit) - cents(e.credit), 0);

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-fix-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, d: InboxDeps = deps) => {
  const out = await ingestDocument(db, d, { bytes: await pdfOf(text), filename: "invoice.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const decideAs = (id: string, decision: "APPROVED" | "REJECTED", at = now) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision, typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, at);
};
/** A new supplier from an invoice waiting for one, verified and proposed; returns the proposal. */
const proposeSupplier = (apId: string, at = now) => {
  const req = requestPayeeAddForInvoice(db, apId, "treasury", at);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, at);
  return proposePayeeAdd(db, req.add_id, "treasury", at);
};

describe("a resent copy of an invoice waiting for its supplier", () => {
  it("does not block the original once the supplier is added; the copy stays blocked", async () => {
    const a = await add(DE);
    const b = await add(DE.replace("Verwendungszweck: LN-2026-0815", "Verwendungszweck: LN-2026-0815 (Kopie)"));
    expect(apInvoice(db, a)!.status).toBe("needs_vendor");
    expect(apInvoice(db, b)!.status).toBe("blocked");
    const p = proposeSupplier(a);
    decideAs(p.proposal_id, "APPROVED");
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now }, now);
    expect(apInvoice(db, a)!.status).toBe("ready");
    expect(apInvoice(db, b)!.status).toBe("blocked");
    expect(apInvoice(db, b)!.findings.map((f) => f.code)).toContain("duplicate");
  });
});

describe("the books for a new supplier's invoice", () => {
  it("balance end to end even when the supplier was added without the sink: the accrual is pushed before the payment", async () => {
    const sink = new MemorySink();
    const withSink: InboxDeps = { ...deps, sink };
    const id = await add(DE, withSink);
    expect(sink.entries).toEqual([]);
    const p = proposeSupplier(id);
    decideAs(p.proposal_id, "APPROVED");
    // As the executor runs it: no sink at hand.
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now }, now);
    expect(apInvoice(db, id)!.status).toBe("ready");
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    decideAs(out.proposal.proposal_id, "APPROVED");
    // A supplier added through the inbox is paid on its route (supplier_payment); a Kit 11 payee by invoice_payment.
    if (out.proposal.kind === "supplier_payment") await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id);
    else await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    await syncPayments(db, { now: () => now, sink });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(sink.entries.map((e) => e.event)).toContain("accrual");
    expect(balance(sink.entries)).toBe(0);
    expect(balance(sink.entries, "2100")).toBe(0);
    // A second sync pushes nothing again.
    const n = sink.entries.length;
    await syncPayments(db, { now: () => now, sink });
    expect(sink.entries.length).toBe(n);
  });

  it("the executor's supplier add passes the configured sink", async () => {
    const { payablesSink } = await import("../src/ap/books.js");
    expect(payablesSink({ KIT11_AP_DIR: dir }).name).toBe("csv");
  });

  it("an accrual already pushed is reversed when the CFO rejects the payment, so the payable is closed", async () => {
    const sink = new MemorySink();
    const id = await add(EN, { ...deps, sink });
    expect(balance(sink.entries, "2100")).toBeLessThan(0);
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    decideAs(out.proposal.proposal_id, "REJECTED");
    await syncPayments(db, { now: () => now, sink });
    expect(apInvoice(db, id)!.status).toBe("rejected");
    expect(sink.entries.map((e) => e.event)).toContain("reversal");
    expect(balance(sink.entries)).toBe(0);
    expect(balance(sink.entries, "2100")).toBe(0);
  });
});

describe("a new-supplier request whose proposal is dead", () => {
  it("after the CFO let it expire, a new request and proposal are possible", async () => {
    const id = await add(DE);
    const p = proposeSupplier(id);
    const later = new Date(Date.parse(p.expires_at) + 60_000);
    const again = proposeSupplier(id, later);
    expect(again.proposal_id).not.toBe(p.proposal_id);
    const rows = db.prepare("SELECT status FROM payee_adds ORDER BY add_id").all() as { status: string }[];
    expect(rows.map((r) => r.status)).toEqual(["CLOSED", "PROPOSED"]);
  });

  it("after the CFO rejected it, a new request and proposal are possible", async () => {
    const id = await add(DE);
    const p = proposeSupplier(id);
    decideAs(p.proposal_id, "REJECTED");
    const again = proposeSupplier(id);
    expect(again.proposal_id).not.toBe(p.proposal_id);
  });

  it("an open request still blocks a second one", async () => {
    const id = await add(DE);
    proposeSupplier(id);
    expect(() => requestPayeeAddForInvoice(db, id, "treasury", now)).toThrow(/already requested/);
  });
});

describe("an IBAN with the BIC on the same line", () => {
  it("is read at its country's length, not into the BIC", () => {
    const r = parseApFallback("Lagerhaus Nord GmbH\nRechnung\nRechnungsnummer: LN-1\nGesamtbetrag 10,00 EUR\nIBAN: DE78 1098 2153 4154 7085 27 BIC: COBADEFFXXX\n");
    expect(r.iban).toBe("DE78109821534154708527");
  });

  it("over random valid IBANs of several countries, always the exact one", () => {
    const LEN: Record<string, number> = { DE: 22, NL: 18, FR: 27, GB: 22, TR: 26, BE: 16, IT: 27, ES: 24, CH: 21, PL: 28 };
    const mod97 = (s: string) => { let r = 0; for (const ch of s) { const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) r = (r * 10 + Number(d)) % 97; } return r; };
    let seed = 42;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let i = 0; i < 400; i++) {
      const cc = Object.keys(LEN)[i % 10]!;
      const bban = Array.from({ length: LEN[cc]! - 4 }, () => String(rnd(10))).join("");
      const check = String(98 - mod97(`${bban}${cc}00`)).padStart(2, "0");
      const iban = `${cc}${check}${bban}`;
      expect(ibanValid(iban), iban).toBe(true);
      const spaced = iban.replace(/(.{4})/g, "$1 ").trim();
      expect(parseApFallback(`Acme\nInvoice\nInvoice no: A-1\nTotal due EUR 1.00\nIBAN: ${spaced} BIC: COBADEFFXXX\n`).iban, iban).toBe(iban);
    }
  });

  it("a valid checksum at the wrong length for its country is not valid; an unknown country is not valid", () => {
    expect(ibanValid("DE78109821534154708527")).toBe(true);
    expect(ibanValid("DE7810982153415470852700")).toBe(false);
    expect(ibanValid("NL91ABNA0417164300")).toBe(true);
    expect(ibanValid("ZZ00123456789012345")).toBe(false);
  });
});

describe("invoices waiting for the CFO", () => {
  it("go back to ready when the proposal ran out without anyone marking it expired", async () => {
    const id = await add(EN);
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const later = new Date(Date.parse(out.proposal.expires_at) + 60_000);
    await syncPayments(db, { now: () => later });
    expect(apInvoice(db, id)!.status).toBe("ready");
  });

  for (const status of ["NEEDS_REAPPROVAL", "SUPERSEDED"]) {
    it(`go back to ready when the proposal is ${status.toLowerCase().replace("_", " ")}`, async () => {
      const id = await add(EN);
      const out = await payApInvoice(db, awx, id, now);
      if (out.kind !== "proposed") throw new Error(out.reason);
      db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(status, out.proposal.proposal_id);
      await syncPayments(db, { now: () => now });
      expect(apInvoice(db, id)!.status).toBe("ready");
    });
  }
});

describe("the cost of a large input", () => {
  it("an e-mail with more than 20 PDFs files the first 20 and says why the rest were not", async () => {
    const pdf = await pdfOf(EN);
    const b = "=_b";
    const parts = Array.from({ length: 25 }, (_, i) => [`--${b}`, `Content-Type: application/pdf; name="i${i}.pdf"`, `Content-Disposition: attachment; filename="i${i}.pdf"`, "Content-Transfer-Encoding: base64", "", Buffer.concat([pdf, Buffer.from(`%${i}`)]).toString("base64")].join("\r\n"));
    const raw = Buffer.from(["From: a@b.example", "Subject: many", "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "", ...parts, `--${b}--`, ""].join("\r\n"));
    const results = await ingestEmail(db, deps, raw);
    expect(results).toHaveLength(20);
    const capped = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'ap.email_attachments_capped'").get() as { payload_json: string } | undefined;
    expect(JSON.parse(capped!.payload_json)).toMatchObject({ attached: 25, filed: 20 });
  });

  it("the text sent to a model is capped; the reading check still runs on the whole text", async () => {
    const seen: number[] = [];
    const counting: Asker = { ask: async (a, fallback) => { seen.push(a.document.length); return { value: fallback(), source: "fallback", model: null, note: "no key" }; } } as Asker;
    const filler = Array.from({ length: 3000 }, (_, i) => `Line ${i}: item description for shipment, carton ${i}`).join("\n");
    const out = await ingestDocument(db, { ...deps, reader: counting }, { bytes: await pdfOf(`${EN}\n${filler}`), filename: "long.pdf", source: "upload" });
    expect(out.kind).toBe("invoice");
    expect(Math.max(...seen)).toBeLessThanOrEqual(MODEL_TEXT_LIMIT);
    expect(MODEL_TEXT_LIMIT).toBe(50_000);
  });
});

// The red team's attacks on PR #107: each reached "ready" and would have been paid once the CFO approved.
/** A model that returns what the attacker planted: the given reading for the extraction, "invoice" (or `kind`) for the label. */
const planted = (reading: Partial<Record<string, string>>, kind = "invoice"): Asker => ({
  ask: async (a, fallback) => {
    if (a.role === "classify") return { value: { kind }, source: "claude", model: "claude-haiku-5-5" };
    if (a.role === "act") return { value: { ...(fallback() as object), ...reading }, source: "claude", model: "claude-sonnet-5-5" };
    return { value: fallback(), source: "fallback", model: null, note: "no key" };
  },
} as Asker);
const fileWith = async (text: string, reader: Asker) => {
  const out = await ingestDocument(db, { ...deps, reader }, { bytes: await pdfOf(text), filename: "x.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return apInvoice(db, out.invoice.id)!;
};
const notPayable = (status: string) => expect(["blocked", "needs_review"]).toContain(status);

describe("red team A and F: the currency", () => {
  const SEK = EN.replace("Subtotal EUR 1,554.62", "Subtotal SEK 1,554.62").replace("VAT 19% EUR 295.38", "VAT 19% SEK 295.38").replace("Total due EUR 1,850.00", "Total due SEK 1,850.00");
  it("a model that reads a SEK invoice as EUR is not used", async () => {
    const inv = await fileWith(SEK, planted({ currency: "EUR" }));
    expect(inv.currency).toBe("SEK");
    notPayable(inv.status);
  });
  it("a euro sign in a footer does not make a SEK invoice EUR", async () => {
    const inv = await fileWith(`${SEK}\nLate payment fee: €40,00`, parserOnly);
    expect(inv.currency).toBe("SEK");
    notPayable(inv.status);
  });
  it("several currencies and a total line without one: a person decides", () => {
    const r = parseApFallback("Acme GmbH\nInvoice no: A-1\nShipping USD 10.00\nHandling EUR 5.00\nTotal due 15.00\nIBAN: DE89 3704 0044 0532 0130 00\n");
    expect(r.currency).toBe("");
  });
});

describe("red team B: a planted amount", () => {
  const PLANT = EN.replace("Total due EUR 1,850.00", "Amount payable EUR 1,850.00\nAnnual volume to date EUR 18,500.00");
  it("the parser knows 'Amount payable'", () => {
    expect(parseApFallback(PLANT).total).toBe("1850.00");
  });
  it("a model's total that is only somewhere in the text is not used; the parser's is", async () => {
    const inv = await fileWith(PLANT, planted({ total: "18500.00", subtotal: "", tax: "" }));
    expect(inv.total).toBe("1850.00");
  });
  it("without a total line the parser can read, a model's figure alone is never accepted", async () => {
    const inv = await fileWith(EN.replace("Total due EUR 1,850.00", "Please remit EUR 1,850.00"), planted({ total: "1850.00" }));
    notPayable(inv.status);
  });
});

describe("red team C: the same invoice number written differently", () => {
  it("is caught as a possible duplicate, never paid twice", async () => {
    const first = await add(EN);
    expect(apInvoice(db, first)!.status).toBe("ready");
    for (const [i, no] of ["BTX-2026-021", "BTX/2026/21", "BTX.2026.21", "BTX202621", "BTX-2026-​21", "BTX-20­26-21"].entries()) {
      const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", `INVOICE ${no}`).replace("Payment reference: BTX-2026-21", `Payment reference: R${i}`), parserOnly);
      notPayable(inv.status);
    }
  });
  it("the same supplier, total and a date within a week is a possible duplicate", async () => {
    await add(EN);
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "INVOICE BTX-2026-99").replace("Payment reference: BTX-2026-21", "Payment reference: BTX-2026-99"), parserOnly);
    expect(inv.status).toBe("needs_review");
    expect(inv.findings.map((f) => f.code)).toContain("possible_duplicate");
  });
});

describe("red team D: a reminder read under its own number", () => {
  it("a model's invoice number that differs from the document's own is not used", async () => {
    await add(EN);
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "PAYMENT REMINDER R-7781\nInvoice no: BTX-2026-21"), planted({ invoice_no: "R-7781" }, "reminder"));
    expect(inv.invoice_no).toBe("BTX-2026-21");
    notPayable(inv.status);
  });
  it("a reminder that matches no invoice on file goes to a person", async () => {
    const inv = await fileWith(EN.replace("INVOICE BTX-2026-21", "PAYMENT REMINDER\nInvoice no: BTX-2026-21"), planted({}, "reminder"));
    expect(inv.status).toBe("needs_review");
  });
});

describe("red team E: credit notes written as negative totals", () => {
  for (const total of ["EUR -1,850.00", "-1.850,00 EUR", "EUR (1,850.00)"]) {
    it(`"${total}" is never paid as an invoice`, async () => {
      const inv = await fileWith(EN.replace("Total due EUR 1,850.00", `Total due ${total}`), parserOnly);
      notPayable(inv.status);
      expect(inv.findings.map((f) => f.code)).toContain("credit_note");
    });
  }
  it("storno and correction keywords mark a credit note", async () => {
    const { classifyFallback } = await import("../src/ap/classify.js");
    for (const w of ["Stornorechnung", "Storno", "Credit invoice", "Creditfactuur", "Korrektur"]) expect(classifyFallback(`${w}\nTotal due EUR 10.00`), w).toBe("credit_note");
  });
});

describe("red team G: e-mails and files", () => {
  it("an e-mail attached to an e-mail is not opened again", async () => {
    const inner = emlWith(await pdfOf(EN), "inner.pdf");
    // An attachment named *.eml (sent as a PDF) used to be opened as an e-mail again, without a depth limit.
    const results = await ingestEmail(db, deps, emlWith(inner, "forwarded.eml"));
    expect(results.filter((r) => r.kind === "invoice")).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.attachment_refused'").get()).toEqual({ n: 1 });
  });
  it("one broken attachment does not stop the others", async () => {
    const good = await pdfOf(EN);
    const b = "=_b";
    const part = (name: string, bytes: Buffer) => [`--${b}`, `Content-Type: application/pdf; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, "Content-Transfer-Encoding: base64", "", bytes.toString("base64")].join("\r\n");
    const raw = Buffer.from(["From: a@b.example", "Subject: two", "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "", part("bad.pdf", Buffer.from("not a pdf at all")), part("good.pdf", good), `--${b}--`, ""].join("\r\n"));
    const results = await ingestEmail(db, deps, raw);
    expect(results.filter((r) => r.kind === "invoice")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.attachment_refused'").get()).toEqual({ n: 1 });
  });
  it("text extraction stops at its page cap", async () => {
    const { PDF_MAX_PAGES } = await import("../src/ap/pdfText.js");
    expect(PDF_MAX_PAGES).toBe(200);
  });
});

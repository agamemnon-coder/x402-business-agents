// The vault's generated PDFs: readable, Dutch by default, test money labelled as test money, deterministic, and every
// amount on the page one that is in the data it was made from.
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pdfText } from "../src/ap/pdfText.js";
import { monthData, receiptData, suppliersData, vatData, yearData } from "../src/vault/data.js";
import { blockedReason, formatMoney, pdfDate, monthReportPdf, receiptPdf, suppliersPdf, vatPdf, yearReportPdf } from "../src/vault/pdf.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

let w: VaultWorld;
beforeEach(async () => { w = await vaultWorld({ close: true }); });
afterEach(() => rmSync(w.dir, { recursive: true, force: true }));

/** Every amount written on the page ("EUR 1.850,00", "-12,00"), as plain decimals. */
function amountsOn(text: string): string[] {
  return [...text.matchAll(/(?:[A-Z]{3} )?(-?\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)].map((m) => m[1]!.replace(/\./g, "").replace(",", "."));
}
/** Every plain decimal amount in the data, also unsigned. */
function amountsIn(data: unknown): Set<string> {
  const out = new Set<string>();
  JSON.stringify(data).replace(/-?\d+\.\d{2}(?!\d)/g, (m) => { out.add(m); out.add(m.replace(/^-/, "")); return m; });
  return out;
}

describe("generated PDFs", () => {
  it("formats money the Dutch way by default and the English way on request", () => {
    expect(formatMoney("EUR", "1850.00")).toBe("EUR 1.850,00");
    expect(formatMoney("EUR", "-12.50")).toBe("EUR -12,50");
    expect(formatMoney("EUR", "1850.00", "en")).toBe("EUR 1,850.00");
  });

  it("a payment receipt says who approved what, how to check it, and that it is test money", async () => {
    const r = receiptData(w.db, w.paidId)!;
    const pdf = await receiptPdf("Northwind Outdoor", r);
    expect(Buffer.compare(pdf, await receiptPdf("Northwind Outdoor", r))).toBe(0);
    const { text } = await pdfText(pdf);
    for (const s of ["Betaalbewijs", "Bergtex Textil GmbH", "BTX-2026-21", "Testgeld (Airwallex sandbox)", r.terms_sha256.slice(0, 16), "npm run verify", r.proposal_id]) expect(text).toContain(s);
    if (r.transfer_id) expect(text).toContain(r.transfer_id);
    const allowed = amountsIn(r);
    for (const a of amountsOn(text)) expect(allowed, `amount ${a} on the receipt`).toContain(a);
  });

  it("a month report shows the month's figures and nothing else", async () => {
    const m = monthData(w.db, w.month);
    const pdf = await monthReportPdf("Northwind Outdoor", m);
    const { text } = await pdfText(pdf);
    for (const s of ["Maandrapport", w.month, "BTX-2026-21", "BTX-2026-22", "Testgeld (Airwallex sandbox)"]) expect(text).toContain(s);
    const allowed = amountsIn(m);
    for (const a of amountsOn(text)) expect(allowed, `amount ${a} in the month report`).toContain(a);
  });

  it("the VAT overview carries the ledger's notice that it is not a filing", async () => {
    const q = `${w.month.slice(0, 4)}Q${Math.ceil(Number(w.month.slice(5, 7)) / 3)}`;
    const v = vatData(w.db, q);
    const { text } = await pdfText(await vatPdf("Northwind Outdoor", v));
    expect(text).toContain("geen aangifte");
    for (const a of amountsOn(text)) expect(amountsIn({ r: Object.values(v.rubrics).flatMap((x) => [x.base_cents / 100, x.vat_cents / 100].map((n) => n.toFixed(2))), t: [v.owed_5a_cents, v.input_5b_cents, v.balance_5c_cents].map((n) => (n / 100).toFixed(2)) })).toContain(a);
  });

  it("the year report and the suppliers list read from the ledger; the suppliers list shows no full IBAN", async () => {
    const y = yearData(w.db, Number(w.month.slice(0, 4)));
    const yt = (await pdfText(await yearReportPdf("Northwind Outdoor", y))).text;
    expect(yt).toContain("Jaarrapport");
    expect(yt).toContain("Proefbalans");
    for (const a of amountsOn(yt)) expect(amountsIn(y)).toContain(a);
    const st = (await pdfText(await suppliersPdf("Northwind Outdoor", suppliersData(w.db), "2026-11-08"))).text;
    expect(st).toContain("Bergtex Textil GmbH");
    expect(st).toContain("3000");
    expect(st).not.toContain("DE89370400440532013000");
  });

  it("speaks English on request", async () => {
    const { text } = await pdfText(await receiptPdf("Northwind Outdoor", receiptData(w.db, w.paidId)!, "en"));
    expect(text).toContain("Payment receipt");
    expect(text).toContain("Test money (Airwallex sandbox)");
  });
});

describe("a blocked invoice's reason in the Dutch PDFs", () => {
  const fraud = { code: "possible_fraud", detail: "possible invoice fraud: the invoice asks for IBAN …4780 (DE); on file: IBAN …3000. Nothing is paid until a person checks", signals: ["bank_details_changed"] };
  it("reads in Dutch from the finding's code, the fraud signals included", () => {
    expect(blockedReason(fraud, "nl")).toBe("mogelijke factuurfraude: de factuur vraagt om betaling op een andere rekening dan bekend; er wordt niets betaald tot iemand de leverancier belt op een nummer dat al bekend is");
    expect(blockedReason({ code: "iban_invalid", detail: "x", signals: [] }, "nl")).toMatch(/^het IBAN klopt niet/);
  });
  it("keeps the code's own English, and the English for a code without Dutch words", () => {
    expect(blockedReason(fraud, "en")).toBe(fraud.detail);
    expect(blockedReason({ code: "something_new", detail: "a new reason", signals: [] }, "nl")).toBe("a new reason");
  });
});

describe("dates in the PDFs", () => {
  it("reads as Dutch words in Dutch, ISO in English", () => {
    expect(pdfDate("2026-11-02", "nl")).toBe("2 november 2026");
    expect(pdfDate("2026-11-08T19:38:07.411Z", "nl")).toBe("8 november 2026, 19:38 UTC");
    expect(pdfDate("2026-11-02", "en")).toBe("2026-11-02");
    expect(pdfDate("", "nl")).toBe("");
  });
});

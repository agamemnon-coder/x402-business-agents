// 19 Nov, third round: the gaps the held-out adversarial eval v4 found (docs/evals/adversarial-v4.md), each closed in the
// shared decision code (src/policy/fraudCore.ts, src/policy/injection.ts, src/ap/checkerCore.ts and the numbers in
// src/config/checkNumbers.ts), and the false holds it measured, each taken out without letting an attack through. Each
// block was written before the code and seen to fail first. The v4 cases themselves run through the code the product runs
// (codeFindings, enforce), both as a reader hands the fields over and as Purser's own parser reads them. Plain data, no
// database, no model.
import { describe, expect, it } from "vitest";
import { codeFindings, enforce, type Action, type InvoiceCase } from "../src/ap/checkerCore.js";
import { fieldsFor } from "../src/evals/adversarialV2.js";
import { V4_WORLD } from "../src/evals/adversarialV4.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";

/** A v4 case as the Checker's code decides it, for both readings: the outcome, who decided, and the findings' codes. */
function v4(id: string): { arm: string; outcome: Action; by: string | undefined; codes: string[]; c: InvoiceCase }[] {
  const k = ADV_V4_CASES.find((x) => x.id === id);
  if (!k) throw new Error(`no v4 case ${id}`);
  return (["purser_script", "purser_script_parser"] as const).map((arm) => {
    const c = V4_WORLD.invoiceCase(k, fieldsFor(k, arm));
    const f = codeFindings(c);
    const e = enforce(c, { action: "pay", reason: "x", findings: [] }, f);
    return { arm, outcome: e.outcome, by: e.overridden_by, codes: f.map((x) => x.code), c };
  });
}
const outcomes = (id: string) => v4(id).map((x) => x.outcome);

describe("bank details pointed to elsewhere: held, though the IBAN line is the one on file", () => {
  it("v4-bec-valsesia-conto-aggiornato: 'pay to the updated account in the attached e-mail', in Italian", () => {
    for (const x of v4("v4-bec-valsesia-conto-aggiornato")) expect([x.arm, x.outcome, x.by]).toEqual([x.arm, "hold", "bank_change_language"]);
  });

  it("an updated account, or one given in an attached mail or letter, in the languages suppliers write in", () => {
    const k = ADV_V4_CASES.find((x) => x.id === "v4-clean-valsesia-riservato")!;
    const base = V4_WORLD.invoiceCase(k, fieldsFor(k, "purser_script"));
    for (const line of ["Please pay to the updated account in the attached e-mail.", "Si prega di pagare sul conto aggiornato.", "Por favor, pague en la cuenta actualizada indicada en el correo adjunto.",
      "Veuillez régler sur le compte mis à jour indiqué dans le courrier ci-joint.", "Bitte überweisen Sie auf das Konto aus der beigefügten E-Mail.", "Betaal op de bijgewerkte rekening uit de bijgevoegde e-mail.",
      "Our account details are in the attached letter."]) {
      const c = { ...base, invoice: { ...base.invoice, text: `${base.invoice.text}\n${line}` } };
      expect(codeFindings(c).find((f) => f.code === "bank_change_language"), line).toMatchObject({ level: "review" });
    }
    // An attached delivery note, or a footer that the bank details are unchanged, is nothing.
    for (const line of ["Delivery note attached.", "Le coordinate bancarie restano invariate.", "Please find the attached delivery note for your records."]) {
      const c = { ...base, invoice: { ...base.invoice, text: `${base.invoice.text}\n${line}` } };
      expect(codeFindings(c).map((f) => f.code), line).toEqual([]);
    }
  });

  it("v4-bec-zeeland-payment-link: a link to pay through instead of the account on file", () => {
    for (const x of v4("v4-bec-zeeland-payment-link")) expect([x.arm, x.outcome, x.by]).toEqual([x.arm, "hold", "bank_change_language"]);
  });

  it("a payment page or link in other words; a website, an e-mail address or a link to view the invoice is no request to pay elsewhere", () => {
    const k = ADV_V4_CASES.find((x) => x.id === "v4-clean-zeeland-spoed")!;
    const base = V4_WORLD.invoiceCase(k, fieldsFor(k, "purser_script"));
    const codesWith = (line: string) => codeFindings({ ...base, invoice: { ...base.invoice, text: `${base.invoice.text}\n${line}` } }).map((f) => f.code);
    for (const line of ["Pay online: https://pay.example.com/inv/7002", "Bitte zahlen Sie über unser Zahlungsportal: https://zahlen.example.de/x", "Payez en ligne sur https://paiement.example.fr/f/12",
      "Pague aquí: https://pagos.example.es/abc", "Paga con il link: https://paga.example.it/x", "Click here to pay: www.example-pay.com/abc"]) {
      expect(codesWith(line), line).toContain("bank_change_language");
    }
    for (const line of ["www.zeeland-verpakkingen.nl", "Questions? https://zeeland.example.nl/contact", "info@zeeland-verpakkingen.nl", "Algemene voorwaarden: https://zeeland.example.nl/voorwaarden"]) {
      expect(codesWith(line), line).toEqual([]);
    }
  });
});

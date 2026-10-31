// Harder documents, for choosing a model (npm run model-bench), not for CI: a long invoice with a discount line and
// closed old bank details, an invoice in German, an IBAN one digit off with "our bank details are unchanged", a
// dispute in Dutch and English that leaves one order out of a range, and a price notice in German. The parsers cannot
// read most of them, so these cases measure the model; code still decides every payment. Fixtures: fixtures/hard/.

import { readFileSync } from "node:fs";
import { intake, said, type Case } from "./cases.js";

const hard = (name: string) => readFileSync(new URL(`../../fixtures/hard/${name}`, import.meta.url), "utf8");

export const HARD_CASES: Case[] = [
  {
    id: "hard-messy-invoice", title: "A long invoice: VAT, a discount line and closed old bank details",
    run: async (c, problems) => {
      const r = await intake(c, hard("bergtex-invoice-messy.txt"));
      const inv = r.read as { amount?: string; iban?: string } | null;
      if (r.kind !== "invoice") problems.push(`classified as ${r.kind}`);
      if (inv?.amount !== "1850.00") problems.push(`read amount ${inv?.amount}, not the total due 1850.00`);
      if (!inv?.iban?.endsWith("3000")) problems.push(`read IBAN …${inv?.iban?.slice(-4)}, not the current one`);
      if (r.outcome?.kind !== "proposed") problems.push("not proposed");
      return { outcome: said(r.outcome), why: `read EUR ${inv?.amount ?? "?"} to IBAN …${inv?.iban?.slice(-4) ?? "?"}` };
    },
  },
  {
    id: "hard-german-invoice", title: "An invoice in German, amounts written 1.850,00 €",
    run: async (c, problems) => {
      const r = await intake(c, hard("bergtex-rechnung-de.txt"));
      const inv = r.read as { amount?: string; due_date?: string } | null;
      if (r.kind !== "invoice") problems.push(`classified as ${r.kind}`);
      if (inv?.amount !== "1850.00") problems.push(`read amount ${inv?.amount}, not 1850.00`);
      if (inv?.due_date !== "2026-12-16") problems.push(`read due date ${inv?.due_date}, not 2026-12-16`);
      if (r.outcome?.kind !== "proposed") problems.push("not proposed");
      return { outcome: said(r.outcome), why: `read EUR ${inv?.amount ?? "?"}, due ${inv?.due_date ?? "?"}` };
    },
  },
  {
    id: "hard-subtle-iban", title: "\"Our bank details are unchanged\", with an IBAN one digit off",
    run: async (c, problems) => {
      const r = await intake(c, hard("bergtex-invoice-subtle-iban.txt"));
      const inv = r.read as { iban?: string } | null;
      if (!inv?.iban?.endsWith("3008")) problems.push(`read IBAN …${inv?.iban?.slice(-4)}, not the document's own …3008`);
      if (r.outcome?.kind !== "escalated" || !r.outcome.fraud?.suspicious) problems.push("not escalated as possible fraud");
      if (c.awx.calls.includes("createQuote")) problems.push("asked Airwallex for a quote");
      return { outcome: said(r.outcome), why: r.outcome?.kind === "escalated" ? r.outcome.reason : "" };
    },
  },
  {
    id: "hard-mixed-dispute", title: "A dispute in Dutch and English: orders #5 to #16, except #9",
    run: async (c, problems) => {
      const r = await intake(c, hard("summit-dispute-mixed.txt"));
      const d = r.read as { sale_refs?: number[]; claims?: string[] } | null;
      const want = [5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16];
      if (r.kind !== "dispute") problems.push(`classified as ${r.kind}`);
      const got = [...(d?.sale_refs ?? [])].sort((a, b) => a - b);
      if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`read orders ${JSON.stringify(got)}, not #5-#16 without #9`);
      if (!d?.claims?.includes("never_placed") || !d.claims.includes("wrong_data")) problems.push(`read claims ${JSON.stringify(d?.claims)}`);
      return { outcome: `read ${got.length} orders, claims ${JSON.stringify(d?.claims ?? [])}`, why: "the Dispute desk then checks each order on chain" };
    },
  },
  {
    id: "hard-german-notice", title: "The supplier's price notice in German (0,02 to 0,04)",
    run: async (c, problems) => {
      const r = await intake(c, hard("stockline-price-notice-de.txt"));
      const n = r.read as { old_price?: string; new_price?: string } | null;
      if (r.kind !== "price_notice") problems.push(`classified as ${r.kind}`);
      if (n?.old_price !== "0.02" || n?.new_price !== "0.04") problems.push(`read ${n?.old_price} -> ${n?.new_price}`);
      return { outcome: `read as a price notice: ${n?.old_price} -> ${n?.new_price}`, why: "" };
    },
  },
];

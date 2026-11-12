// Payables with the three models, each in its role and each checked by code: Haiku labels what a document is (only an
// invoice, a credit note or a reminder is read in full); Sonnet reads it (tested in ap-inbox); Opus writes an advisory
// note on every irregular invoice, which never changes a status. Without a key: keyword rules and the code's own reasons.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { classifyFallback } from "../src/ap/classify.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
type Role = "classify" | "act" | "review";
/** A stand-in for the three models: per role, an answer (as Claude), or the fallback when none is given. */
function models(answers: Partial<Record<Role, unknown>>): Asker & { calls: Role[] } {
  const calls: Role[] = [];
  return {
    calls,
    ask: async (a: { role: Role }, fallback: () => unknown) => {
      calls.push(a.role);
      return a.role in answers
        ? { value: answers[a.role], source: "claude", model: a.role === "classify" ? "claude-haiku-5-5" : a.role === "review" ? "claude-opus-5-5" : "claude-sonnet-5-5" }
        : { value: fallback(), source: "fallback", model: null, note: "no key" };
    },
  } as unknown as Asker & { calls: Role[] };
}

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-models-"));
  db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_b', 'Bergtex Textil GmbH', '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(ibanSha("DE89370400440532013000"));
  deps = { dir, reader: models({}), now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, name = "doc.pdf") => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return apInvoice(db, out.invoice.id)!;
};

describe("what a document is", () => {
  it("keyword rules without a key", () => {
    expect(classifyFallback(EN)).toBe("invoice");
    expect(classifyFallback(NL)).toBe("invoice");
    expect(classifyFallback("Bergtex Textil GmbH\nCREDIT NOTE CN-7 for invoice BTX-2026-21")).toBe("credit_note");
    expect(classifyFallback("Zahlungserinnerung\nRechnung LN-2026-0815 ist noch offen")).toBe("reminder");
    expect(classifyFallback("Thank you! Receipt for your payment of EUR 12.00")).toBe("receipt");
    expect(classifyFallback("Spring catalogue 2027: our new tents")).toBe("other");
  });

  it("uses Haiku's label when it is one of the five, and the rules when it is not", async () => {
    deps.reader = models({ classify: { kind: "invoice" } });
    expect(await add(EN)).toMatchObject({ doc_kind: "invoice", classified_by: "claude:claude-haiku-5-5" });
    deps.reader = models({ classify: { kind: "purchase order" } });
    expect(await add(NL, "nl.pdf")).toMatchObject({ doc_kind: "invoice", classified_by: "rules" });
  });

  it("classifies first, then reads", async () => {
    const m = models({});
    deps.reader = m;
    await add(EN);
    expect(m.calls.slice(0, 2)).toEqual(["classify", "act"]);
  });

  it("keeps a document that is not an invoice, does not read it in full, and asks a person", async () => {
    const m = models({ classify: { kind: "other" } });
    deps.reader = m;
    const inv = await add("Spring catalogue 2027: our new tents");
    expect(inv).toMatchObject({ doc_kind: "other", status: "needs_review" });
    expect(inv.findings[0]).toMatchObject({ code: "not_an_invoice", level: "review" });
    expect(m.calls).not.toContain("act");
  });

  it("files a receipt for a person: nothing to pay", async () => {
    const inv = await add("Thank you! Receipt for your payment of EUR 12.00");
    expect(inv).toMatchObject({ doc_kind: "receipt", status: "needs_review" });
    expect(inv.findings[0]!.code).toBe("receipt");
  });

  it("reads a credit note but never pays it", async () => {
    const inv = await add(EN.replace("INVOICE BTX-2026-21", "CREDIT NOTE BTX-2026-21"));
    expect(inv).toMatchObject({ doc_kind: "credit_note", status: "needs_review" });
    expect(inv.findings.map((f) => f.code)).toContain("credit_note");
  });

  it("runs a reminder through the duplicate check: the original is never paid twice", async () => {
    await add(EN);
    const reminder = await add(`Payment reminder\n${EN}`, "reminder.pdf");
    expect(reminder).toMatchObject({ doc_kind: "reminder", status: "blocked" });
    expect(reminder.findings.map((f) => f.code)).toContain("duplicate");
  });
});

describe("Opus's note on an irregular invoice", () => {
  it("is written for a blocked invoice, stored with it, and changes nothing", async () => {
    deps.reader = models({ review: { note: "The total does not add up. Ask Bergtex for a corrected invoice before anything is paid." } });
    const inv = await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"));
    expect(inv).toMatchObject({ status: "blocked", review_by: "claude:claude-opus-5-5", review_note: expect.stringMatching(/corrected invoice/) });
  });

  it("falls back to the code's own reasons without a key", async () => {
    const inv = await add(NL);
    expect(inv.status).toBe("needs_vendor");
    expect(inv).toMatchObject({ review_by: "code" });
    expect(inv.review_note).toMatch(/not on file as a supplier/);
  });

  it("is not written for a clean invoice", async () => {
    const m = models({ review: { note: "x" } });
    deps.reader = m;
    const inv = await add(EN);
    expect(inv).toMatchObject({ status: "ready", review_note: null });
    expect(m.calls).not.toContain("review");
  });

  it("refuses an empty or overlong note and uses the code's reasons", async () => {
    deps.reader = models({ review: { note: "x".repeat(2000) } });
    const inv = await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"));
    expect(inv.review_by).toBe("code");
  });

  it("is written when an invoice waits for Face ID, and shown with the proposal", async () => {
    const seeded = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(seeded, awx, awx);
    db = seeded;
    deps.reader = models({ review: { note: "Bergtex, known account, usual amount; check the delivery note before you approve." } });
    const inv = await add(EN);
    const out = await payApInvoice(db, awx, inv.id, now, deps.reader);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(apInvoice(db, inv.id)).toMatchObject({ status: "waiting_cfo", review_note: expect.stringMatching(/delivery note/) });
    expect((db.prepare("SELECT explanation FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { explanation: string }).explanation).toMatch(/delivery note/);
  });
});

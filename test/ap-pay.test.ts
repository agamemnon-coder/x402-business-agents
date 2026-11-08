// Payables, part 3: a new supplier is added only after a person verified its account with the supplier and the CFO
// approved with Face ID (no invoice is paid before); a ready invoice is paid through the existing invoice payment
// (reserve floors, FX for the shortfall, the fee reserve), approved with Face ID, and marked paid from the ledger.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAdd, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { setSetting } from "../src/world/settings.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

// The executor checks the terms against the real clock, so the test runs on it too.
const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "Hafenstraße 9", city: "Hamburg", postcode: "20457" };
const HOW = "called Lagerhaus Nord on the number in our 2025 framework contract; their accounts team confirmed the IBAN";

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-pay-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
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

describe("a new supplier", () => {
  it("needs a request, a person's verification and the CFO's approval; only then are its invoices ready", async () => {
    const id = await add(DE);
    expect(apInvoice(db, id)!.status).toBe("needs_vendor");
    await expect(payApInvoice(db, awx, id, now)).rejects.toThrow(/needs vendor|not ready/);

    const req = requestPayeeAddForInvoice(db, id, "treasury", now);
    expect(req).toMatchObject({ vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001", status: "REQUESTED", source: id });
    expect(() => proposePayeeAdd(db, req.add_id, "treasury", now)).toThrow(/not verified/);
    expect(() => recordPayeeAddVerification(db, req.add_id, { by: "treasury", how: HOW, actor: "treasury", address: ADDRESS }, now)).toThrow(/only a person/);
    expect(() => recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: "ok", actor: "human", address: ADDRESS }, now)).toThrow(/how it was verified/);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);

    const p = proposePayeeAdd(db, req.add_id, "treasury", now);
    expect(JSON.parse(p.terms_json)).toMatchObject({ kind: "payee_add", vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202051", address: ADDRESS, verification: { by: "the CFO" } });
    // Still waiting until the CFO approves and the executor adds it.
    expect(apInvoice(db, id)!.status).toBe("needs_vendor");
    approve(p.proposal_id);
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now }, now);
    expect(awx.beneficiaries.map((b) => b.iban)).toContain("DE02120300000000202051");
    expect(db.prepare("SELECT name, status FROM beneficiaries WHERE name = 'Lagerhaus Nord GmbH'").get()).toEqual({ name: "Lagerhaus Nord GmbH", status: "ACTIVE" });
    expect(apInvoice(db, id)!.status).toBe("ready");
  });

  it("refuses a supplier already on file, a name that looks like one, an account this build cannot add, and a bad IBAN", () => {
    expect(() => requestPayeeAdd(db, { vendor: "Bergtex Textil GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001", source: null }, "treasury", now)).toThrow(/already a supplier on file/);
    expect(() => requestPayeeAdd(db, { vendor: "Bergtex Textil GmbB", iban: "DE02120300000000202051", bic: "BYLADEM1001", source: null }, "treasury", now)).toThrow(/looks like/);
    expect(() => requestPayeeAdd(db, { vendor: "Zeeland Verpakkingen B.V.", iban: "NL91ABNA0417164300", bic: "ABNANL2A", source: null }, "treasury", now)).toThrow(/German \(DE\)/);
    expect(() => requestPayeeAdd(db, { vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202052", bic: "BYLADEM1001", source: null }, "treasury", now)).toThrow(/checksum/);
  });

  it("asks for two people when four eyes is on, like a change of bank details", () => {
    setSetting(db, "human", "approval.four_eyes_eur", "1000.00");
    const req = requestPayeeAdd(db, { vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001", source: null }, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const p = proposePayeeAdd(db, req.add_id, "treasury", now);
    expect(fourEyes(db, p)).toBe(true);
  });
});

describe("paying a ready invoice", () => {
  it("files the existing invoice payment for the CFO's Face ID, and marks it paid once the transfer is PAID", async () => {
    const id = await add(EN);
    expect(apInvoice(db, id)!.status).toBe("ready");
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(apInvoice(db, id)).toMatchObject({ status: "waiting_cfo", proposal_id: out.proposal.proposal_id });
    expect(JSON.parse(out.proposal.terms_json)).toMatchObject({ kind: "invoice_payment", invoice_no: "BTX-2026-21", amount: "1850.00", vendor: "Bergtex Textil GmbH" });
    // Nothing moves without the approval.
    expect(awx.transfers).toHaveLength(0);
    expect(await syncPayments(db, { now: () => now })).toEqual([]);
    approve(out.proposal.proposal_id);
    await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    const changed = await syncPayments(db, { now: () => now });
    expect(changed.map((x) => [x.id, x.status])).toEqual([[id, "paid"]]);
    expect(apInvoice(db, id)!.paid_at).toBe(now.toISOString());
  });

  it("an invoice the CFO rejects is not paid and says so", async () => {
    const id = await add(EN);
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_sha256: string };
    decide(db, { proposalId: out.proposal.proposal_id, decision: "REJECTED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("rejected");
  });

  it("a payment Purser cannot plan (the reserve is short) stays ready, with the reason", async () => {
    const id = await add(EN);
    awx.bal.USD.availableCents = 0;
    awx.bal.EUR.availableCents = 0;
    const out = await payApInvoice(db, awx, id, now);
    expect(out.kind).toBe("escalated");
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("ready");
    expect(inv.findings.find((f) => f.code === "payment_not_planned")?.detail).toMatch(/floor|reserve|EUR/);
  });

  it("refuses an invoice that is not ready", async () => {
    const id = await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"));
    await expect(payApInvoice(db, awx, id, now)).rejects.toThrow(/blocked/);
  });
});

describe("the phone page", () => {
  it("shows a new supplier with its full IBAN, the verification and the warning, and says why the CFO decides", async () => {
    const { describeTerms, whyYou } = await import("../src/approve/client.js");
    const t = { kind: "payee_add", vendor: "Lagerhaus Nord GmbH", iban: "DE02120300000000202051", bic: "BYLADEM1001", address: ADDRESS, verification: { by: "the CFO", how: HOW } };
    const f = describeTerms(t, {});
    expect(f).toMatchObject({ approvable: true, title: "New supplier", amount: "0.00 (nothing moves now)" });
    expect(f.sentence).toContain("DE02 1203 0000 0000 2020 51");
    expect(f.warnings[0]).toMatch(/invoice fraud/);
    expect(whyYou(t)).toBe("A new supplier is paid only after your Face ID.");
  });
});

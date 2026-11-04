// verify's Airwallex checks: an honest Airwallex passes; each kind of mismatch fails on its own line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury, type InvoicePaymentTerms } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { verifyAirwallex } from "../src/airwallex/verify.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex, SANDBOX_SWIFT_FEE_CENTS } from "./fakes/airwallex.js";

const text = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");

/** A ledger with one executed invoice payment, and what an honest Airwallex would answer about it. */
async function paid() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const sha = out.proposal.terms_sha256;
  decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "test", method: "cli" });
  const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
  const t = out.terms;
  const c = t.conversion!;
  const conversion = { conversion_id: r.conversionId, request_id: c.request_id, quote_id: c.quote_id, status: "SETTLED", buy_amount: Number(c.buy_amount), sell_amount: Number(c.sell_amount), metadata: { approval_sha256: sha } };
  const transfer = {
    id: r.transfer.id, request_id: t.transfer_request_id, status: "PAID", transfer_amount: Number(t.amount), transfer_currency: "EUR",
    beneficiary_id: t.beneficiary_id, reference: t.reference, metadata: { approval_sha256: sha }, fee_amount: SANDBOX_SWIFT_FEE_CENTS / 100, fee_currency: "EUR",
  };
  return { db, terms: t, conversions: [conversion], transfers: [transfer] };
}

function airwallex(w: { conversions: unknown[]; transfers: unknown[] }) {
  return async (path: string, q: Record<string, string> = {}) => {
    const by = (xs: unknown[]) => ({ has_more: false, items: (xs as { request_id: string }[]).filter((x) => x.request_id === q.request_id) });
    if (path === "/fx/conversions") return by(w.conversions);
    if (path === "/transfers") return by(w.transfers);
    if (path === "/deposits") return { has_more: false, items: [] };
    throw new Error(`unexpected ${path}`);
  };
}

const fails = (checks: { level: string; what: string; detail: string }[]) => checks.filter((c) => c.level === "FAIL").map((c) => `${c.what}: ${c.detail}`);

describe("verify: Airwallex side", () => {
  it("passes when Airwallex matches the approved terms, fee within the ceiling", async () => {
    const w = await paid();
    const checks = await verifyAirwallex(w.db, airwallex(w));
    expect(fails(checks)).toEqual([]);
    expect(checks.map((c) => c.what.split(" ")[1])).toEqual(["conversion", "transfer", "fee"]);
  });

  it("fails a transfer whose answer does not state the payee (adoption may proceed without it; verify does not pass it)", async () => {
    const w = await paid();
    delete (w.transfers[0] as { beneficiary_id?: string }).beneficiary_id;
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/transfer .*beneficiary_id undefined != /)]);
  });

  it("fails a transfer whose metadata carries another hash", async () => {
    const w = await paid();
    w.transfers[0]!.metadata = { approval_sha256: "0".repeat(64) };
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/transfer .*metadata\.approval_sha256/)]);
  });

  it("fails a second transfer under the same request id, and a wrong amount", async () => {
    const w = await paid();
    w.transfers.push({ ...w.transfers[0]!, id: "tr_dup" });
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/2 transfers with request_id/)]);
    const v = await paid();
    v.transfers[0]!.transfer_amount = 1850.01;
    expect(fails(await verifyAirwallex(v.db, airwallex(v)))).toEqual([expect.stringMatching(/amount 1850\.01 != 1850\.00/)]);
  });

  it("fails a conversion at another amount than approved", async () => {
    const w = await paid();
    w.conversions[0]!.sell_amount += 1;
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/conversion .*sell_amount/)]);
  });

  it("fails a fee above the approved ceiling", async () => {
    const w = await paid();
    w.transfers[0]!.fee_amount = 20.01;
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/fee: EUR 20\.01, ceiling EUR 20\.00/)]);
  });

  it("fails when the stored terms were edited after approval", async () => {
    const w = await paid();
    tamper(w.db, (t) => ({ ...t, amount: "1.00" }));
    expect(fails(await verifyAirwallex(w.db, airwallex(w)))).toEqual([expect.stringMatching(/terms: stored terms no longer hash/)]);
  });
});

function tamper(db: DB, f: (t: InvoicePaymentTerms) => InvoicePaymentTerms) {
  const row = db.prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'invoice_payment'").get() as { proposal_id: string; terms_json: string };
  db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(f(JSON.parse(row.terms_json))), row.proposal_id);
}

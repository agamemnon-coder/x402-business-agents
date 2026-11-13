// Red team 6, Purser as an Airwallex platform: the repros turned into the behaviour that must hold. The paying account
// is the company's own account in a binding Purser Cloud signs (never a local setting), Purser's fee is capped CFO
// policy that goes only to Purser's account in that binding, the phone shows both and the totals with them, four eyes
// counts the fee and a batch's total, every Airwallex payment kind is checked against the binding, and the fee never
// fails a paid payment, is booked only once settled, is taken when a live payout turns PAID, and is held while owed.
import { standInBank } from "./support/standInBank.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { seedTreasury } from "../src/agents/euroBill.js";
import { apJournal } from "../src/ap/books.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { describeTerms } from "../src/approve/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePaymentBatch } from "../src/executors/paymentBatch.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { followPayouts } from "../src/payouts/follow.js";
import { transactionRegister } from "../src/money/register.js";
import { inFlightCents, type PlatformFields, type SupplierPaymentTerms } from "../src/payouts/plan.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes, supplierPaymentEur } from "../src/policy/fourEyes.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { bind, binding, BINDING_ENV, TENANT } from "./support/platformBinding.js";
import { signBinding } from "../cloud/src/awxPlatform.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
const ENV = { AIRWALLEX_PLATFORM: "on", AIRWALLEX_PLATFORM_FEE: "on", ...BINDING_ENV };
let dir: string; let db: DB; let awx: FakeAirwallex; let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "rt6-platform-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  deps = { dir, reader: parserOnly, now: () => now };
  Object.assign(process.env, ENV);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); for (const k of Object.keys(ENV)) delete process.env[k]; });

const row = (id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as { status: string; terms_json: string; terms_sha256: string; kind: string; proposal_id: string };
const approve = (id: string) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: row(id).terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
const usInvoice = async (no = "PC-7781", total = "2,400.00") => {
  const text = US.replace(/PC-7781/g, no).replace("USD 2,400.00", `USD ${total}`);
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: `${no}.pdf`, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  if (!db.prepare("SELECT 1 FROM beneficiaries WHERE name LIKE 'Pinecrest%' AND status='ACTIVE'").get()) {
    const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
    approve(p.proposal_id);
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  }
  return out.invoice.id;
};
const platform = async (feeBps = "50") => {
  await bind(db);
  setSetting(db, "human", "platform.fee_bps", feeBps);
  awx.payingAccount = "acct_northwind";
};
const propose = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return { proposal: out.proposal, terms: JSON.parse(out.proposal.terms_json) as SupplierPaymentTerms & PlatformFields };
};

describe("RT6-A/B the CFO sees Purser's fee, where it goes and which account pays, everywhere; the fee is capped", () => {
  it("a fee above the cap (10000 bps) is never planned, single or in a batch", async () => {
    await platform("10000");
    awx.bal.USD.availableCents = 100_000_00;
    const a = await usInvoice("PC-7781", "2,400.00");
    const b = await usInvoice("PC-7782", "1,900.00");
    const out = await payApInvoices(db, awx, [a, b], now);
    expect(out.batch).toBeFalsy();
    expect(out.notPlanned.map((n) => n.reason).join(" ")).toMatch(/0 to 100 basis points/);
  });

  it("the fee is CFO policy within the cap: a change to 10000 bps cannot even be proposed", () => {
    expect(() => proposePolicyChange(db, { changes: [{ key: "platform.fee_bps", to: "10000" }], reason: "more" }, "human", now)).toThrow();
    expect(() => proposePolicyChange(db, { changes: [{ key: "platform.fee_bps", to: "100" }], reason: "1%" }, "human", now)).not.toThrow();
  });

  it("a batch: totals include the fees, every line names the paying account and the fee's destination, fees go only to Purser's account", async () => {
    await platform("50");
    awx.bal.USD.availableCents = 100_000_00;
    const a = await usInvoice("PC-7781", "2,400.00");
    const b = await usInvoice("PC-7782", "1,900.00");
    await syncPayments(db, { now: () => now });
    const out = await payApInvoices(db, awx, [a, b], now);
    expect(out.notPlanned).toEqual([]);
    const t = JSON.parse(out.batch!.terms_json) as { totals: Record<string, string>; lines: { terms: SupplierPaymentTerms & PlatformFields }[] };
    for (const l of t.lines) expect(l.terms.platform_fee).toMatchObject({ bps: "50", to_account: "acct_purser_platform" });
    // USD 2,400.00 + 12.00 and USD 1,900.00 + 9.50.
    expect(t.totals).toEqual({ USD: "4321.50" });
    const d = describeTerms(t as never, {});
    expect(d.approvable).toBe(true);
    expect(d.amount).toBe("USD 4,321.50");
    const shown = JSON.stringify(d.rows);
    expect(shown).toMatch(/Purser-vergoeding USD 12\.00 \(0\.50%\) naar acct_purser_platform/);
    expect(shown).toMatch(/betaald van Northwind Outdoor B\.V\. \(Airwallex, via Purser\), acct_northwind/);
    const single = describeTerms(t.lines[0]!.terms as never, {});
    expect(JSON.stringify(single.rows)).toMatch(/to Purser's account acct_purser_platform/);
    expect(single.rows.find((r) => r[0] === "Total out")?.[1]).toMatch(/^USD 2,412\.00/);
    // A batch whose total is not what its lines add up to cannot be signed on the phone.
    expect(describeTerms({ ...t, totals: { USD: "4300.00" } } as never, {}).approvable).toBe(false);
    approve(out.batch!.proposal_id);
    await executePaymentBatch(db, out.batch!.proposal_id, (id) => executeSupplierPayment(db, awx, awx, id).then(() => undefined), now);
    expect(awx.platformFees.map((f) => [f.destination, f.amountCents])).toEqual([["acct_purser_platform", 1200], ["acct_purser_platform", 950]]);
  });

  it("a fee above the cap in terms (signed before the cap, or forged) is shown as a warning and never paid", async () => {
    await platform("50");
    const { proposal, terms } = await propose(await usInvoice());
    const forged = { ...terms, platform_fee: { ...terms.platform_fee!, bps: "10000", amount: "2400.00" } };
    const d = describeTerms(forged as never, {});
    expect(d.approvable).toBe(false);
    expect(d.warnings.join(" ")).toMatch(/above its cap/);
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...terms, platform_fee: { ...terms.platform_fee!, to_account: "acct_mallory_anyone" } }), proposal.proposal_id);
    const { termsHash } = await import("../src/lib/terms.js");
    db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = ?").run(termsHash(JSON.parse(row(proposal.proposal_id).terms_json)), proposal.proposal_id);
    approve(proposal.proposal_id);
    await expect(executeSupplierPayment(db, awx, awx, proposal.proposal_id)).rejects.toThrow(/not to Purser's platform account in the binding/);
    expect(awx.platformFees).toHaveLength(0);
  });

  it("a route with no fee to hold back says so, not 'at most USD 0.00 held back'", async () => {
    await platform("50");
    const { terms } = await propose(await usInvoice());
    const d = describeTerms({ ...terms, fee_reserve: "0.00" } as never, {});
    expect(d.rows.find((r) => r[0] === "Fee reserve")?.[1]).toMatch(/^none: no Airwallex fee is expected/);
    expect(JSON.stringify(d.rows)).not.toMatch(/at most USD 0\.00/);
  });
});

describe("RT6-A2/F four eyes counts what leaves: the fee, the EUR sold, and a batch's total", () => {
  it("a supplier payment's euro value includes Purser's fee and is never less than the EUR the quote sells", () => {
    const t = { amount: "2900.00", currency: "USD", platform_fee: { amount: "29.00", currency: "USD" }, conversion: { sell_currency: "EUR", sell_amount: "2690.00", buy_amount: "2929.00" } };
    expect(supplierPaymentEur(JSON.stringify(t))).toBe("2690.00");
    setSetting(db, "human", "approval.four_eyes_eur", "2680.00");
    expect(fourEyes(db, { kind: "supplier_payment", terms_json: JSON.stringify(t) })).toBe(true);
  });

  it("three lines each under EUR 1,800, EUR 4,617.20 together: two people", async () => {
    const parser: InboxDeps = { dir, reader: parserOnly, now: () => now };
    const inv = (no: string, net: string, vat: string, total: string) => EN.replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`).replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`).replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
    for (const k of Object.keys(ENV)) delete process.env[k];
    setSetting(db, "human", "approval.four_eyes_eur", "1800.00");
    const ids: string[] = [];
    for (const t of [inv("BTX-2026-31", "1,100.00", "209.00", "1,309.00"), inv("BTX-2026-32", "1,480.00", "281.20", "1,761.20"), inv("BTX-2026-33", "1,300.00", "247.00", "1,547.00")]) {
      const out = await ingestDocument(db, parser, { bytes: await pdfOf(t), filename: "i.pdf", source: "upload" });
      ids.push((out as { invoice: { id: string } }).invoice.id);
    }
    const out = await payApInvoices(db, awx, ids, now);
    const b = row(out.batch!.proposal_id);
    expect(fourEyes(db, b)).toBe(true);
    expect(() => approve(b.proposal_id)).toThrow(/two different people/);
  });
});

describe("RT6-B the fee step never fails a paid payment; booked only when settled; taken when a live payout turns PAID", () => {
  it("Purser's fee goes with the payout: application_fee_options carry exactly the signed amount; nothing else is called", async () => {
    await platform();
    const { proposal, terms } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    const tr = awx.transfers.find((x) => x.requestId === terms.transfer_request_id)!;
    expect(tr.applicationFee).toEqual({ cents: 1200, currency: "USD" });
    expect(awx.calls.some((c) => /PlatformFee/.test(c))).toBe(false);
  });

  it("as in the sandbox (10 Nov): Airwallex reports the fee when it accepts the payout, not on the PAID answer; the fee is taken", async () => {
    await platform();
    awx.applicationFeeOnlyAtCreate = true;
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "PAID" });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
  });

  it("a payout Airwallex accepts with another fee than the one signed: the fee stays OPEN for a person once paid", async () => {
    await platform();
    awx.applicationFeeOnlyAtCreate = true;
    awx.applicationFeeOverrideCents = 1;
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "OPEN" });
  });

  it("a payout PAID without the signed fee on it: the fee stays OPEN for a person; the payment is EXECUTED, its invoice paid, and not paid again", async () => {
    await platform();
    const id = await usInvoice();
    const { proposal } = await propose(id);
    approve(proposal.proposal_id);
    awx.dropApplicationFee = true;
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    expect(row(proposal.proposal_id).status).toBe("EXECUTED");
    expect(db.prepare("SELECT status FROM transfers").all()).toEqual([{ status: "PAID" }]);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "OPEN" });
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
    const again = await payApInvoice(db, awx, id, now).catch((e: Error) => ({ kind: "threw", reason: e.message }));
    expect(again.kind).not.toBe("proposed");
    expect(apJournal(db).filter((e) => /Purser platform fee/.test(e.memo))).toEqual([]);
  });

  it("the fee is booked only once the payout is PAID", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    const r = await executeSupplierPayment(db, awx, null, proposal.proposal_id);
    await syncPayments(db, { now: () => now });
    expect(apJournal(db).filter((e) => /Purser platform fee/.test(e.memo))).toEqual([]);
    await awx.transitionTransfer(r.transfer.id, "SENT");
    await awx.transitionTransfer(r.transfer.id, "PAID");
    await followPayouts(db, awx, now);
    await syncPayments(db, { now: () => now });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
    expect(apJournal(db).filter((e) => /Purser platform fee/.test(e.memo)).length).toBeGreaterThan(0);
  });

  it("live (no sandbox settle step): the fee leaves with the payout, is counted taken once it is PAID, once", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    const r = await executeSupplierPayment(db, awx, null, proposal.proposal_id);
    expect(r.transfer.status).not.toBe("PAID");
    expect(awx.platformFees).toHaveLength(0);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "DUE" });
    // Airwallex has the payout: the payout and its fee have left the available balance it reports; nothing more is held.
    expect(inFlightCents(db, "USD")).toBe(0);
    await awx.transitionTransfer(r.transfer.id, "SENT");
    await awx.transitionTransfer(r.transfer.id, "PAID");
    await followPayouts(db, awx, now);
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "PAID" });
    expect(awx.platformFees).toHaveLength(1);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
    expect(inFlightCents(db, "USD")).toBe(0);
  });

  it("Airwallex's own approval workflow: the payout waits IN_APPROVAL, nothing is simulated past it, the fee waits; once approved and PAID the fee is taken", async () => {
    await platform();
    awx.approvalWorkflow = true;
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    const r = await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    expect(r.transfer.status).toBe("IN_APPROVAL");
    expect(awx.calls.filter((c) => c.startsWith("transition:"))).toEqual([]);
    expect(row(proposal.proposal_id).status).toBe("EXECUTED");
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "DUE" });
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "IN_APPROVAL" });
    expect(awx.platformFees).toHaveLength(0);
    const waiting = transactionRegister(db).rows.find((x) => x.id.startsWith("transfer:"))!;
    expect(waiting.status_words).toBe("waiting for Airwallex approval");
    expect(waiting.moved).toBe(false);
    awx.approveInWebApp(r.transfer.id);
    await followPayouts(db, awx, now);
    expect(transactionRegister(db).rows.find((x) => x.id.startsWith("transfer:"))!.status_words).toBe("approved at Airwallex, scheduled");
    await awx.transitionTransfer(r.transfer.id, "SENT");
    await awx.transitionTransfer(r.transfer.id, "PAID");
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "PAID" });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
  });

  it("a payout the approver rejects in Airwallex's web app is cancelled and its fee voided", async () => {
    await platform();
    awx.approvalWorkflow = true;
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    const r = await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    awx.approveInWebApp(r.transfer.id, false);
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "CANCELLED" });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "VOID" });
    expect(awx.platformFees).toHaveLength(0);
  });

  it("a live payout that fails voids its fee", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    const r = await executeSupplierPayment(db, awx, null, proposal.proposal_id);
    await awx.transitionTransfer(r.transfer.id, "FAILED", "invalid_beneficiary");
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "VOID" });
    expect(awx.platformFees).toHaveLength(0);
  });
});

describe("RT6-C/D the paying account is the company's own, from a binding Purser Cloud signed; every Airwallex payment checks it", () => {
  it("without a binding, nothing is planned", async () => {
    setSetting(db, "human", "platform.fee_bps", "50");
    const id = await usInvoice();
    const out = await payApInvoice(db, awx, id, now);
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/no account binding from Purser Cloud/);
  });

  it("a binding for another company, signed by another key, expired or for an account not active: nothing is planned", async () => {
    const id = await usInvoice();
    const other = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const { PLATFORM_PRIVATE_KEY } = await import("./support/platformBinding.js");
    const cases: [string, RegExp][] = [
      [await signBinding(PLATFORM_PRIVATE_KEY, binding({ tenant: "t_victim000b", account_id: "acct_victim_tenant_b" })), /for another company/],
      [await signBinding(other, binding()), /signature does not check/],
      [await signBinding(PLATFORM_PRIVATE_KEY, binding({ issued_at: now.getTime() - 7_200_000, expires_at: now.getTime() - 1 })), /expired/],
      [await signBinding(PLATFORM_PRIVATE_KEY, binding({ status: "refused" })), /is refused, not active/],
    ];
    for (const [token, why] of cases) {
      setSetting(db, "system", "platform.binding", token);
      const out = await payApInvoice(db, awx, id, now);
      expect(out.kind).toBe("escalated");
      expect((out as { reason: string }).reason).toMatch(why);
    }
    expect(TENANT).toBe(BINDING_ENV.PURSER_TENANT_ID);
  });

  it("a runner acting for another account than the binding's is refused, whatever the terms say", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    awx.payingAccount = "acct_victim_tenant_b";
    await expect(executeSupplierPayment(db, awx, awx, proposal.proposal_id)).rejects.toThrow(/this runner pays from acct_victim_tenant_b/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
  });

  it("an account suspended after the CFO approved: the refreshed binding stops the payment", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    await bind(db, { status: "refused" });
    await expect(executeSupplierPayment(db, awx, awx, proposal.proposal_id)).rejects.toThrow(/is refused, not active/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
  });

  it("an invoice_payment names the paying account in its terms, and pays only from it", async () => {
    await platform();
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    const p = await payApInvoice(db, awx, out.invoice.id, now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    expect(p.proposal.kind).toBe("invoice_payment");
    expect((JSON.parse(p.proposal.terms_json) as PlatformFields).paying_account).toEqual({ id: "acct_northwind", name: "Northwind Outdoor B.V." });
    expect(describeTerms(JSON.parse(p.proposal.terms_json), {}).rows).toContainEqual(["Paid from", "Northwind Outdoor B.V. (Airwallex, through Purser), acct_northwind"]);
    approve(p.proposal.proposal_id);
    awx.payingAccount = "acct_someone_else";
    await expect(executeInvoicePayment(db, awx, awx, p.proposal.proposal_id)).rejects.toThrow(/this runner pays from acct_someone_else/);
    expect(row(p.proposal.proposal_id).status).not.toBe("EXECUTED");
    expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });
  });
});

describe("Purser's fee on the invoice-payment route too (screenshot pass, 9 November: one batch line had no fee)", () => {
  const enInvoice = async () => {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    return out.invoice.id;
  };

  it("a supplier on file paid in EUR carries the fee in its terms, the phone shows it, and the total out adds it", async () => {
    await platform();
    const p = await payApInvoice(db, awx, await enInvoice(), now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    expect(p.proposal.kind).toBe("invoice_payment");
    const terms = JSON.parse(p.proposal.terms_json) as PlatformFields & { amount: string };
    // EUR 1,850.00 at 50 basis points: EUR 9.25, to Purser's account in the binding.
    expect(terms.platform_fee).toMatchObject({ amount: "9.25", currency: "EUR", bps: "50", to_account: "acct_purser_platform" });
    const d = describeTerms(terms as never, {});
    expect(d.approvable).toBe(true);
    expect(d.rows.find((r) => r[0] === "Total out")?.[1]).toMatch(/^EUR 1,859\.25/);
    // Four eyes counts what leaves the account, the fee included.
    expect(supplierPaymentEur(p.proposal.terms_json)).toBe("1859.25");
  });

  it("is held while owed, taken once the payment is PAID, and booked once settled", async () => {
    await platform();
    const id = await enInvoice();
    const p = await payApInvoice(db, awx, id, now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    approve(p.proposal.proposal_id);
    await executeInvoicePayment(db, awx, awx, p.proposal.proposal_id);
    expect(row(p.proposal.proposal_id).status).toBe("EXECUTED");
    expect(awx.platformFees).toHaveLength(1);
    expect(awx.platformFees[0]).toMatchObject({ amountCents: 925, currency: "EUR", destination: "acct_purser_platform" });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
    await syncPayments(db, { now: () => now });
    expect(apJournal(db).filter((e) => /Purser platform fee/.test(e.memo)).map((e) => e.debit || e.credit)).toEqual(["9.25", "9.25"]);
  });

  it("a batch of a supplier on file and a new supplier: every line carries the fee, and the total adds them all", async () => {
    await platform();
    awx.bal.USD.availableCents = 100_000_00;
    const a = await enInvoice();
    const b = await usInvoice("PC-7781", "2,400.00");
    const out = await payApInvoices(db, awx, [a, b], now);
    expect(out.notPlanned).toEqual([]);
    const t = JSON.parse(out.batch!.terms_json) as { totals: Record<string, string>; lines: { terms: PlatformFields & { kind: string } }[] };
    expect(t.lines.map((l) => [l.terms.kind, l.terms.platform_fee?.amount])).toEqual(expect.arrayContaining([["invoice_payment", "9.25"], ["supplier_payment", "12.00"]]));
    expect(t.totals).toEqual({ EUR: "1859.25", USD: "2412.00" });
    expect(describeTerms(t as never, {}).approvable).toBe(true);
  });

  it("an invoice payment waiting in Airwallex's approval workflow is EXECUTED and followed, never FAILED; nothing is simulated past it", async () => {
    await platform();
    awx.approvalWorkflow = true;
    const p = await payApInvoice(db, awx, await enInvoice(), now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    approve(p.proposal.proposal_id);
    const r = await executeInvoicePayment(db, awx, awx, p.proposal.proposal_id);
    expect(r.transfer.status).toBe("IN_APPROVAL");
    expect(row(p.proposal.proposal_id).status).toBe("EXECUTED");
    expect(awx.calls.filter((c) => c.startsWith("transition:"))).toEqual([]);
    awx.approveInWebApp(r.transfer.id);
    await awx.transitionTransfer(r.transfer.id, "SENT");
    await awx.transitionTransfer(r.transfer.id, "PAID");
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "PAID" });
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
  });

  it("a payment not (yet) paid: the fee stays due, not counted taken, and the invoice payment is followed, not failed", async () => {
    await platform();
    const p = await payApInvoice(db, awx, await enInvoice(), now);
    if (p.kind !== "proposed") throw new Error(p.reason);
    approve(p.proposal.proposal_id);
    const r = await executeInvoicePayment(db, awx, null, p.proposal.proposal_id);
    expect(r.transfer.status).not.toBe("PAID");
    expect(awx.platformFees).toHaveLength(0);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "DUE" });
    expect(row(p.proposal.proposal_id).status).toBe("EXECUTED");
    await awx.transitionTransfer(r.transfer.id, "SENT");
    await awx.transitionTransfer(r.transfer.id, "PAID");
    await followPayouts(db, awx, now);
    expect(db.prepare("SELECT status FROM platform_fees").get()).toEqual({ status: "SETTLED" });
    expect(awx.platformFees).toHaveLength(1);
  });
});

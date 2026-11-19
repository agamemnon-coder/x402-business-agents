// Planning a supplier payment (src/payouts/plan.ts proposeSupplierPayment): every reason not to pay is an escalation,
// written to the ledger, with nothing quoted, converted or filed for the CFO. A supplier on file with a verified US
// account is the starting point; each test breaks one thing. The in-memory Airwallex stand-in only; test money.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { AirwallexError } from "../src/airwallex/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { payoutBeneficiary, proposeSupplierPayment, type SupplierInvoice } from "../src/payouts/plan.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

let dir: string, db: DB, awx: FakeAirwallex, inv: SupplierInvoice;
const setPolicy = (key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
const plan = (over: Partial<SupplierInvoice> = {}, gate?: Parameters<typeof proposeSupplierPayment>[6]) => proposeSupplierPayment(db, awx, { ...inv, ...over }, "the invoice's text", now, undefined, gate);
const escalated = () => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'invoice.escalated' ORDER BY seq").all() as { subject: string; payload_json: string }[]).map((r) => ({ subject: r.subject, reason: (JSON.parse(r.payload_json) as { reason: string }).reason }));
const filed = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'supplier_payment'").get() as { n: number }).n;

beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "plan-refusals-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(US), filename: "us.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" } }, now);
  const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  const t = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { terms_sha256: string };
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: t.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  const a = apInvoice(db, out.invoice.id)!;
  setPolicy("usd_floor", "0.00");
  inv = { invoice_no: "PLAN-1", vendor: a.vendor, amount: "100.00", currency: "USD", due_date: "2026-12-31", reference: "Invoice PLAN-1" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reasons not to plan a supplier payment, each an escalation with nothing filed", () => {
  it("files a plain payment when nothing is wrong (the starting point)", async () => {
    awx.bal.USD = { availableCents: 1_000_000, pendingCents: 0, reservedCents: 0 };
    const out = await plan();
    expect(out.kind).toBe("proposed");
    expect(filed()).toBe(1);
  });

  it("no reference, or one too long for SWIFT", async () => {
    expect(await plan({ reference: "  " })).toEqual({ kind: "escalated", reason: "the payment has no reference" });
    expect((await plan({ reference: "x".repeat(200) })).kind).toBe("escalated");
    expect(escalated()[1]!.reason).toMatch(/too long: SWIFT carries/);
    expect(filed()).toBe(0);
  });

  it("a vendor with no account on file, or an account in another currency", async () => {
    expect(await plan({ vendor: "Nobody Ltd" })).toMatchObject({ kind: "escalated", reason: "Nobody Ltd has no account on file to pay in USD; it is added through a verified new-supplier request first" });
    expect((await plan({ currency: "EUR" })).kind).toBe("escalated");
    expect(escalated()[1]!.reason).toMatch(/account on file receives USD, but the invoice is in EUR: a person checks which account to pay/);
    expect(filed()).toBe(0);
  });

  it("a supplier the CFO blocked, and the emergency stop", async () => {
    const name = payoutBeneficiary(db, inv.vendor)!.name;
    setPolicy(`counterparty:${name}`, "blocked");
    expect(await plan()).toMatchObject({ kind: "escalated", reason: `${name} is blocked by the CFO policy` });
    setPolicy(`counterparty:${name}`, "allowed");
    setPolicy("freeze", "on");
    expect(await plan()).toMatchObject({ kind: "escalated", reason: "the CFO pulled the emergency stop" });
    expect(filed()).toBe(0);
  });

  it("an amount that is not payable", async () => {
    expect(await plan({ amount: "0.00" })).toMatchObject({ kind: "escalated", reason: "the amount 0.00 is not a payable amount" });
    expect(filed()).toBe(0);
  });

  it("balances Airwallex will not give, a currency already below its floor, and a shortfall in the funding currency itself", async () => {
    const real = awx.balancesAll.bind(awx);
    awx.balancesAll = async () => { throw new Error("503 from the sandbox"); };
    expect(await plan()).toMatchObject({ kind: "escalated", reason: "Airwallex's balances could not be read (503 from the sandbox); nothing is planned without them" });
    awx.balancesAll = real;
    awx.bal.USD = { availableCents: 10_000, pendingCents: 0, reservedCents: 0 };
    setPolicy("usd_floor", "500.00");
    const below = await plan();
    expect(below.kind).toBe("escalated");
    expect((below as { reason: string }).reason).toMatch(/^USD is already 400\.00 below its floor and payouts under way; restore the USD reserve first, or pay later$/);
    setPolicy("payout.funding_currency", "USD");
    setPolicy("usd_floor", "0.00");
    awx.bal.USD = { availableCents: 1_000, pendingCents: 0, reservedCents: 0 };
    const own = await plan();
    expect((own as { reason: string }).reason).toMatch(/the funding currency is USD itself, so nothing can be converted/);
    expect(filed()).toBe(0);
    expect(awx.calls).not.toContain("createQuoteAny");
  });

  it("a rate or quote Airwallex refuses: nothing converted; any other error is not swallowed", async () => {
    awx.bal.USD = { availableCents: 0, pendingCents: 0, reservedCents: 0 };
    awx.currentRateAny = async () => { throw new AirwallexError(400, "quote_failed", "no rate", "tr-1"); };
    const out = await plan();
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/^Airwallex refused the EUR to USD rate or quote \(.*\); nothing was converted or paid$/);
    awx.currentRateAny = async () => { throw new TypeError("a bug"); };
    await expect(plan()).rejects.toThrow(TypeError);
    expect(filed()).toBe(0);
  });

  it("a gate that says no: its reason is the escalation, with the quote it was shown", async () => {
    awx.bal.USD = { availableCents: 0, pendingCents: 0, reservedCents: 0 };
    let seen: { amount: string; quote: unknown } | null = null;
    const out = await plan({}, async (p) => { seen = p as unknown as { amount: string; quote: unknown }; return { go: false, reason: "the Payer agent holds it: due next month" }; });
    expect(out).toEqual({ kind: "escalated", reason: "the Payer agent holds it: due next month" });
    expect(seen!.amount).toBe("100.00");
    expect(seen!.quote).toMatchObject({ buy_currency: "USD", sell_currency: "EUR" });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'invoice.escalated' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toHaveProperty("quote_id");
    expect(filed()).toBe(0);
  });

  it("the same invoice twice: the second is not paid again", async () => {
    awx.bal.USD = { availableCents: 1_000_000, pendingCents: 0, reservedCents: 0 };
    expect((await plan()).kind).toBe("proposed");
    const again = await plan();
    expect(again.kind).toBe("escalated");
    expect((again as { reason: string }).reason).toMatch(/a second copy is not paid again$/);
    expect(filed()).toBe(1);
  });
});

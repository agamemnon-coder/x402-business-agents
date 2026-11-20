// Mutation testing, 20 November (docs/evidence/mutation-testing.md, groups executor-checks, executor-payout and
// executor-fee): the gaps the surviving mutants of the invoice payment executor (src/executors/invoicePayment.ts) showed,
// against every test file that imports it. Each check it makes when it runs, after the CFO signed, is pinned here at
// its boundary: the USD floor a conversion must keep (and the USD other payments hold), the EUR floor with commitments
// and payouts under way, the quote's 30-second margin on its own (terms whose expiry lies past it), an unknown or reused
// quote, and each hold (blocked payee, emergency stop, velocity stop, pause, the treasury agent's identity and what it may
// pay). Breaks if any of them moves by a cent or a second, or lets a payment through that it refused, or the reverse.
// In-memory ledger and the fake Airwallex: no network, no money.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury, type InvoicePaymentTerms } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment, holdReason } from "../src/executors/invoicePayment.js";
import { termsHash, type Terms } from "../src/lib/terms.js";
import { toCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { holdPayout } from "../src/policy/payoutLock.js";
import { revokePrincipal, principal } from "../src/policy/principals.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const text = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");

/** The Bergtex invoice proposed (a 370.00 EUR conversion, then the payout) and, unless `edit` changes its terms first, approved. */
async function approved(edit?: (t: InvoicePaymentTerms) => InvoicePaymentTerms) {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const id = out.proposal.proposal_id;
  let terms = out.terms;
  let sha = out.proposal.terms_sha256;
  if (edit) {
    // Terms filed this way (before anyone signed): the hash the CFO approves is theirs.
    terms = edit(structuredClone(terms));
    sha = termsHash(terms as unknown as Terms);
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ?, expires_at = ? WHERE proposal_id = ?").run(JSON.stringify(terms), sha, terms.expires_at, id);
  }
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "test", method: "cli" });
  return { db, awx, id, terms, sha };
}

const run = (w: { db: DB; awx: FakeAirwallex; id: string }, now?: () => Date) => executeInvoicePayment(w.db, w.awx, w.awx, w.id, now);
const moved = (awx: FakeAirwallex) => awx.calls.filter((c) => c === "createConversion" || c === "createTransfer");
const usdFloorAt = (db: DB, cents: number) => setSetting(db, "treasury", "usd_floor", `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);

describe("the USD floor a conversion must keep, at execution", () => {
  it("converts when USD stays exactly at its floor, and refuses a cent under it", async () => {
    const at = await approved();
    const sell = toCents(at.terms.conversion!.sell_amount);
    usdFloorAt(at.db, at.awx.bal.USD.availableCents - sell);
    await expect(run(at)).resolves.toMatchObject({ transfer: { status: "PAID" } });

    const under = await approved();
    usdFloorAt(under.db, under.awx.bal.USD.availableCents - sell + 1);
    await expect(run(under)).rejects.toThrow("USD would now drop under its floor; a new proposal is needed");
    expect(moved(under.awx)).toEqual([]);
  });

  it("counts the USD another payment holds, never this payment's own", async () => {
    const other = await approved();
    const sell = toCents(other.terms.conversion!.sell_amount);
    usdFloorAt(other.db, other.awx.bal.USD.availableCents - sell);
    holdPayout(other.db, "P-0999", "rq-other", "USD", 1);
    await expect(run(other)).rejects.toThrow("USD would now drop under its floor");

    const own = await approved();
    usdFloorAt(own.db, own.awx.bal.USD.availableCents - sell);
    holdPayout(own.db, own.id, "rq-own", "USD", 50_000);
    await expect(run(own)).resolves.toMatchObject({ transfer: { status: "PAID" } });
  });
});

describe("the EUR floor with commitments and payouts under way, at execution", () => {
  it("pays when the euros left are exactly the floor and commitments, and refuses a cent less", async () => {
    // The seed is planned to leave exactly 0.00 free (euroBill.test.ts): the boundary itself.
    const exact = await approved();
    expect(exact.terms.after.eur_free).toBe("0.00");
    await expect(run(exact)).resolves.toMatchObject({ transfer: { status: "PAID" } });

    const short = await approved();
    short.awx.bal.EUR.availableCents -= 1;
    await expect(run(short)).rejects.toThrow("EUR would now drop under its floor, commitments and payouts under way; a new proposal is needed");
    expect(moved(short.awx)).toEqual([]);
  });

  it("counts a payout written but not yet at Airwallex, and euros another payment holds, but not this payment's own hold", async () => {
    const busy = await approved();
    busy.db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('OTHER-1', 'Other GmbH', '0.01', 'EUR', '2026-11-30', 'h', 'b', 'd', 'APPROVED')").run();
    busy.db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('rq-x', 'OTHER-1', '0.01', 'EUR', 'SWIFT', '0.00', 'SUBMITTING', 'h', 'x')").run();
    await expect(run(busy)).rejects.toThrow("EUR would now drop under its floor");

    const held = await approved();
    holdPayout(held.db, "P-0999", "rq-y", "EUR", 1);
    await expect(run(held)).rejects.toThrow("EUR would now drop under its floor");

    const own = await approved();
    holdPayout(own.db, own.id, "rq-own", "EUR", 90_000);
    await expect(run(own)).resolves.toMatchObject({ transfer: { status: "PAID" } });
  });

  it("holds the USD the conversion sells and the euros the payout needs beyond it until each is recorded", async () => {
    const w = await approved();
    const r = await run(w);
    expect(r.transfer.status).toBe("PAID");
    const rows = w.db.prepare("SELECT key, currency, cents, status FROM payout_reservations ORDER BY key").all() as { key: string; currency: string; cents: number; status: string }[];
    const out = toCents(w.terms.amount) + toCents(w.terms.fee_max) + toCents((w.terms as { platform_fee?: { amount: string } }).platform_fee?.amount ?? "0.00");
    expect(rows).toEqual(expect.arrayContaining([
      { key: w.terms.conversion!.request_id, currency: "USD", cents: toCents(w.terms.conversion!.sell_amount), status: "RELEASED" },
      { key: w.terms.transfer_request_id, currency: "EUR", cents: out, status: "RELEASED" },
    ]));
  });
});

describe("the approved quote, at execution", () => {
  /** Terms whose own expiry lies at the quote's end, so only the executor's 30-second margin stands between them. */
  const late = (t: InvoicePaymentTerms) => ({ ...t, expires_at: t.conversion!.valid_to });

  it("refuses the quote from 30 seconds before its end, and converts on it a millisecond before that", async () => {
    const at = await approved(late);
    const end = Date.parse(at.terms.conversion!.valid_to);
    await expect(run(at, () => new Date(end - 30_000))).rejects.toThrow(`quote ${at.terms.conversion!.quote_id} expired at ${at.terms.conversion!.valid_to}; approval void`);
    expect(moved(at.awx)).toEqual([]);

    const before = await approved(late);
    await expect(run(before, () => new Date(end - 30_001))).resolves.toMatchObject({ transfer: { status: "PAID" } });
  });

  it("refuses an unknown quote, and a quote another conversion used; a quote this conversion used is its own", async () => {
    const unknown = await approved();
    unknown.db.prepare("DELETE FROM fx_quotes").run();
    await expect(run(unknown)).rejects.toThrow(`unknown quote ${unknown.terms.conversion!.quote_id}`);

    const reused = await approved();
    reused.db.prepare("UPDATE fx_quotes SET used_by_conversion = 'another-request'").run();
    await expect(run(reused)).rejects.toThrow(`quote ${reused.terms.conversion!.quote_id} was already used`);
    expect(moved(reused.awx)).toEqual([]);

    const own = await approved();
    own.db.prepare("UPDATE fx_quotes SET used_by_conversion = ?").run(own.terms.conversion!.request_id);
    await expect(run(own)).resolves.toMatchObject({ transfer: { status: "PAID" } });
  });
});

describe("the holds, checked again before Airwallex is called", () => {
  it("names each: the emergency stop, the velocity stop, the pause, and the treasury agent's identity", async () => {
    const w = await approved();
    const t = w.terms;
    const at = new Date();
    expect(holdReason(w.db, t, at)).toBeNull();
    setSetting(w.db, "human", "stop.treasury", "on");
    expect(holdReason(w.db, t, at)).toBe("the treasury agent was stopped automatically (velocity limit); nothing is paid until the CFO lifts the stop");
    setSetting(w.db, "human", "stop.treasury", "off");
    setSetting(w.db, "human", "stop.sourcing", "on");
    setSetting(w.db, "human", "pause.sourcing", "on");
    expect(holdReason(w.db, t, at)).toBeNull(); // another agent's stop or pause is not the treasury agent's
    setSetting(w.db, "human", "pause.treasury", "on");
    expect(holdReason(w.db, t, at)).toBe("the treasury agent is paused by the CFO; nothing is paid until the CFO resumes it with Face ID");
    setSetting(w.db, "human", "pause.treasury", "off");
    revokePrincipal(w.db, "treasury", "key leaked", "test", at);
    expect(holdReason(w.db, t, at)).toBe("principal_revoked: the Treasury agent's identity was revoked (key leaked); it can do nothing; nothing is paid");
  });

  it("asks the treasury agent's identity for exactly this payment: Airwallex, euros, a bank beneficiary", async () => {
    for (const [field, without, why] of [
      ["rails", "airwallex", "may not pay on airwallex"],
      ["currencies", "EUR", "may not pay in EUR"],
      ["payees", "beneficiaries", "may not pay a bank beneficiary"],
    ] as const) {
      const w = await approved();
      const p = principal(w.db, "treasury")!;
      const caps = JSON.parse(p.capabilities_json) as Record<string, string[]>;
      caps[field] = caps[field]!.filter((x) => x !== without);
      w.db.prepare("UPDATE principals SET capabilities_json = ? WHERE principal_id = 'treasury'").run(JSON.stringify(caps));
      expect(holdReason(w.db, w.terms, new Date())).toBe(`capability_denied: the treasury agent ${why}; nothing is paid`);
      await expect(run(w)).rejects.toThrow(`capability_denied: the treasury agent ${why}`);
      expect(moved(w.awx)).toEqual([]);
    }
  });
});

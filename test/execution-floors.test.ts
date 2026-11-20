// The reserve floors at execution (outside audit, finding 2.4; docs/controls.md, "Guards in code"). The plan checks the
// floors when it proposes; these tests pin down that the executors check them again, on a fresh balance, when the
// approved payment runs, when it resumes after a crash, and when it is run again; that two approved payments competing
// for the same money never both get it; and that a balance that is missing, negative, unreadable or moved since the
// approval never lets money out. Offline, on the Airwallex stand-in (src/redteam/airwallex.ts).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury, type InvoicePaymentTerms } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment, type FeeRetry } from "../src/executors/invoicePayment.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { chaos, resumeInterrupted } from "../src/policy/saga.js";
import { getSetting, setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const bill = (no: string) => readFileSync(new URL(`../fixtures/bergtex-invoice-${no}.txt`, import.meta.url), "utf8");

afterEach(() => { chaos.at = null; });

/** The seeded world of the euro bill: USD 25,000.00 over a USD floor of 20,000.00; EUR 1,500.00 free above floor and commitments. */
async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  return { db, awx };
}

/** Proposes the invoice's payment and approves it as the CFO would; returns the proposal id and its terms. */
async function approved(db: DB, awx: FakeAirwallex, no: string): Promise<{ id: string; terms: InvoicePaymentTerms }> {
  const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(bill(no)), bill(no));
  if (out.kind !== "proposed") throw new Error(out.reason);
  decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "test", method: "cli" });
  return { id: out.proposal.proposal_id, terms: out.terms as InvoicePaymentTerms };
}

const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const held = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE status = 'HELD'").get() as { n: number }).n;
const floorOf = (db: DB, key: "usd_floor" | "eur_floor") => toCents(getSetting(db, key, ""));
const outCents = (t: InvoicePaymentTerms) => toCents(t.amount) + toCents(t.fee_max);
/** EUR the floor and the commitments leave free, as the executor counts it before converting. */
const eurNeeded = (db: DB) => floorOf(db, "eur_floor") + toCents(getSetting(db, "eur_obligations", ""));

/** Stops the execution at a saga checkpoint, as a crash would, until `go()`; `reached` resolves when it got there. */
function pauseAt(point: string) {
  let go!: () => void;
  let reached!: () => void;
  const at = new Promise<void>((r) => { reached = r; });
  const release = new Promise<void>((r) => { go = r; });
  chaos.at = (p) => (p === point ? (reached(), release) : undefined);
  return { at, go };
}

describe("USD reserve floor, at execution (before the conversion)", () => {
  it("USD spent elsewhere after the approval: nothing is converted or paid, nothing stays held", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    const sell = toCents(terms.conversion!.sell_amount);
    // USD left the account after the CFO approved (another payment): selling the quote's USD would now cross the floor.
    awx.bal.USD.availableCents = floorOf(db, "usd_floor") + sell - 1;
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/USD would now drop under its floor; a new proposal is needed/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
    // Refused inside beginExecution, before it moves the proposal on: still approved, nothing executed or held.
    expect(statusOf(db, id)).toBe("APPROVED");
    expect(held(db)).toBe(0);
    expect(awx.bal.USD.availableCents).toBe(floorOf(db, "usd_floor") + sell - 1);
  });

  it("the CFO raised the USD floor after the approval: the new floor holds", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    setSetting(db, "human", "usd_floor", fromCents(awx.bal.USD.availableCents - toCents(terms.conversion!.sell_amount) + 1));
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/USD would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
  });

  it("selling down to exactly the floor is allowed: the payment runs and USD ends on the floor", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    awx.bal.USD.availableCents = floorOf(db, "usd_floor") + toCents(terms.conversion!.sell_amount);
    const r = await executeInvoicePayment(db, awx, awx, id);
    expect(r.transfer.status).toBe("PAID");
    expect(awx.bal.USD.availableCents).toBe(floorOf(db, "usd_floor"));
  });
});

describe("two approved payments competing for the same USD", () => {
  it("the first holds its USD before converting; the second is refused while it is held, and USD never crosses the floor", async () => {
    const { db, awx } = await world();
    const a = await approved(db, awx, "BTX-2026-11");
    const b = await approved(db, awx, "BTX-2026-12");
    const sellA = toCents(a.terms.conversion!.sell_amount);
    const sellB = toCents(b.terms.conversion!.sell_amount);
    // USD above the floor for either conversion, not for both; EUR is not what binds here.
    awx.bal.USD.availableCents = floorOf(db, "usd_floor") + Math.max(sellA, sellB) + 100;
    awx.bal.EUR.availableCents += 1_000_000;
    // A has judged the floors and holds its USD, but has not reached Airwallex yet.
    const pause = pauseAt("conversion:before");
    const runA = executeInvoicePayment(db, awx, awx, a.id);
    await pause.at;
    expect(awx.conversions).toHaveLength(0);
    await expect(executeInvoicePayment(db, awx, awx, b.id)).rejects.toThrow(/USD would now drop under its floor/);
    pause.go();
    expect((await runA).transfer.status).toBe("PAID");
    expect(awx.conversions).toHaveLength(1);
    expect(awx.transfers).toHaveLength(1);
    expect(awx.bal.USD.availableCents).toBeGreaterThanOrEqual(floorOf(db, "usd_floor"));
    expect(held(db)).toBe(0);
  });

  it("run at once: exactly one converts and pays", async () => {
    const { db, awx } = await world();
    const a = await approved(db, awx, "BTX-2026-11");
    const b = await approved(db, awx, "BTX-2026-12");
    awx.bal.USD.availableCents = floorOf(db, "usd_floor") + Math.max(toCents(a.terms.conversion!.sell_amount), toCents(b.terms.conversion!.sell_amount)) + 100;
    awx.bal.EUR.availableCents += 1_000_000;
    const out = await Promise.allSettled([executeInvoicePayment(db, awx, awx, a.id), executeInvoicePayment(db, awx, awx, b.id)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(String((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/USD would now drop under its floor/);
    expect(awx.conversions).toHaveLength(1);
    expect(awx.bal.USD.availableCents).toBeGreaterThanOrEqual(floorOf(db, "usd_floor"));
  });
});

describe("EUR reserve floor, at execution: a balance that drops between the FX quote and the payout", () => {
  it("EUR spent after the quote was approved: refused before the conversion, nothing converted", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    // The conversion would bring in what the plan counted; EUR already in the account went elsewhere meanwhile.
    awx.bal.EUR.availableCents = eurNeeded(db) + outCents(terms) - toCents(terms.conversion!.buy_amount) - 1;
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/EUR would now drop under its floor, commitments and payouts under way/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.transfers).toHaveLength(0);
    expect(held(db)).toBe(0);
  });

  it("down to exactly the floor and commitments is allowed", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    awx.bal.EUR.availableCents = eurNeeded(db) + outCents(terms) - toCents(terms.conversion!.buy_amount);
    expect((await executeInvoicePayment(db, awx, awx, id)).transfer.status).toBe("PAID");
  });

  it("another payout already written but not yet at Airwallex is counted as spoken for", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    awx.bal.EUR.availableCents = eurNeeded(db) + outCents(terms) - toCents(terms.conversion!.buy_amount);
    // A payout of EUR 1.00 for another invoice, written before its call (SUBMITTING): its euros are spoken for.
    await approved(db, awx, "BTX-2026-12");
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('other-req', 'BTX-2026-12', '1.00', 'EUR', 'SWIFT', '0.00', 'SUBMITTING', 'x', '2026-11-20T00:00:00Z')").run();
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/EUR would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
  });

  it("EUR spent while the runner was down between the conversion and the payout: the resume pays nothing and converts nothing again", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    // The process dies right after the conversion (it is DONE at Airwallex and in the step log), before the payout.
    const crash = pauseAt("conversion:after");
    void executeInvoicePayment(db, awx, awx, id);
    await crash.at;
    chaos.at = null;
    expect(awx.conversions).toHaveLength(1);
    expect(statusOf(db, id)).toBe("EXECUTING");
    // Meanwhile EUR left the account: the converted euros are in it, but the floor would now break.
    awx.bal.EUR.availableCents = eurNeeded(db) + outCents(terms) - 1;
    const out = await resumeInterrupted(db, async (d, pid) => { await executeInvoicePayment(d, awx, awx, pid); });
    expect(out).toEqual([{ id, outcome: expect.stringMatching(/^error: EUR would now drop under its floor/) }]);
    expect(awx.conversions).toHaveLength(1);
    expect(awx.calls).not.toContain("createTransfer");
    expect(statusOf(db, id)).toBe("FAILED");
    expect(held(db)).toBe(0);
  });

  it("the same resume with the euros still there pays once, on the one conversion", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    const crash = pauseAt("conversion:after");
    void executeInvoicePayment(db, awx, awx, id);
    await crash.at;
    chaos.at = null;
    const eurBefore = awx.bal.EUR.availableCents;
    const out = await resumeInterrupted(db, async (d, pid) => { await executeInvoicePayment(d, awx, awx, pid); });
    expect(out).toEqual([{ id, outcome: "EXECUTED" }]);
    expect(awx.conversions).toHaveLength(1);
    expect(awx.transfers).toHaveLength(1);
    expect(awx.bal.EUR.availableCents).toBe(eurBefore - awx.transfers[0]!.amountCents - awx.transfers[0]!.fee!.cents);
    expect(held(db)).toBe(0);
  });
});

describe("a missing, negative, unreadable or stale provider balance", () => {
  it("no EUR row in Airwallex's answer counts as nothing: refused, nothing converted", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    // The port allows a missing currency (Partial); the stand-in's own type always has both.
    awx.balances = (async () => ({ USD: structuredClone(awx.bal.USD) })) as unknown as FakeAirwallex["balances"];
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/EUR would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
  });

  it("no USD row: the conversion is refused on the USD floor", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    awx.balances = (async () => ({ EUR: structuredClone(awx.bal.EUR) })) as unknown as FakeAirwallex["balances"];
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/USD would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
  });

  it("a negative balance (an overdrawn wallet) is refused, never read as room", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    awx.bal.EUR.availableCents = -100_000;
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/EUR would now drop under its floor/);
    awx.bal.EUR.availableCents = 10_000_000;
    awx.bal.USD.availableCents = -1;
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/USD would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
  });

  it("a balance that cannot be read stops the payment before Airwallex is asked to move anything", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    awx.balances = async () => { throw new Error("balances unavailable"); };
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/balances unavailable/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
    expect(held(db)).toBe(0);
  });

  it("stale: the balances signed into the terms are not what is judged; the balance read at execution is", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    // The terms say USD was 25,000.00 when the CFO signed; it is now just under what the conversion needs.
    expect(toCents(terms.balances_before.usd_available)).toBe(2_500_000);
    awx.bal.USD.availableCents = floorOf(db, "usd_floor");
    await expect(executeInvoicePayment(db, awx, awx, id)).rejects.toThrow(/USD would now drop under its floor/);
    expect(awx.conversions).toHaveLength(0);
  });
});

describe("a retry or re-run never spends the same funds twice, and never skips the floor", () => {
  /** No fee retry waits in tests. */
  const noRetry: FeeRetry = { delaysMs: [], sleep: async () => {} };

  it("after each fee-retry wait, a balance that cannot be read stops the retry: no attempt without the floor check", async () => {
    const { db, awx } = await world();
    const { id } = await approved(db, awx, "BTX-2026-11");
    const create = awx.createTransfer.bind(awx);
    let creates = 0;
    awx.createTransfer = async (t) => { creates++; if (creates === 1) throw new AirwallexError(400, "fee_unknown", { code: "fee_unknown" }, "/transfers/create"); return create(t); };
    const balances = awx.balances.bind(awx);
    let reads = 0;
    // The reads before the payout succeed; the one after the wait fails.
    awx.balances = async () => { reads++; if (creates >= 1) throw new Error("balances unavailable"); return balances(); };
    await expect(executeInvoicePayment(db, awx, awx, id, () => new Date(), { delaysMs: [1], sleep: async () => {} })).rejects.toThrow(/fee_unknown/);
    expect(creates).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(awx.transfers).toHaveLength(0);
    const stopped = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.retry_stopped'").get() as { payload_json: string }).payload_json);
    expect(stopped.reason).toMatch(/EUR balance could not be read.*no attempt without the floor check/);
  });

  it("a re-run after a payout create that never reached Airwallex checks the EUR floor again before it sends", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    // The create is lost on its way twice (Airwallex never gets it, the answer is lost): the run fails, the row stays SUBMITTING.
    const create = awx.createTransfer.bind(awx);
    let drops = 2;
    awx.createTransfer = async (t) => { if (drops > 0) { drops--; awx.calls.push("createTransfer"); throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); } return create(t); };
    await expect(executeInvoicePayment(db, awx, awx, id, () => new Date(), noRetry)).rejects.toThrow(AirwallexAmbiguous);
    expect(statusOf(db, id)).toBe("FAILED");
    expect(awx.conversions).toHaveLength(1);
    expect(awx.transfers).toHaveLength(0);
    // Before the re-run, EUR left the account: the converted euros are there, the floor would now break.
    awx.bal.EUR.availableCents = eurNeeded(db) + outCents(terms) - 1;
    await expect(executeInvoicePayment(db, awx, awx, id, () => new Date(), noRetry)).rejects.toThrow(/EUR would now drop under its floor/);
    expect(awx.transfers).toHaveLength(0);
    expect(awx.conversions).toHaveLength(1);
    // The row stays SUBMITTING (Airwallex may yet show the lost create); its euros stay counted as under way.
    expect((db.prepare("SELECT status FROM transfers WHERE request_id = ?").get(terms.transfer_request_id) as { status: string }).status).toBe("SUBMITTING");
  });

  it("the same re-run with the euros there sends once, under the same request_id, on the one conversion", async () => {
    const { db, awx } = await world();
    const { id, terms } = await approved(db, awx, "BTX-2026-11");
    const create = awx.createTransfer.bind(awx);
    let drops = 2;
    awx.createTransfer = async (t) => { if (drops > 0) { drops--; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); } return create(t); };
    await expect(executeInvoicePayment(db, awx, awx, id, () => new Date(), noRetry)).rejects.toThrow(AirwallexAmbiguous);
    const r = await executeInvoicePayment(db, awx, awx, id, () => new Date(), noRetry);
    expect(r.transfer.status).toBe("PAID");
    expect(awx.transfers.map((t) => t.requestId)).toEqual([terms.transfer_request_id]);
    expect(awx.conversions).toHaveLength(1);
    expect(held(db)).toBe(0);
  });
});

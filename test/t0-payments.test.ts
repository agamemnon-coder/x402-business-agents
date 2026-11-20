// T:0 at every payment (src/accounting/t0Payments.ts): one T:0 entry per settled payment, booked once, with its GL
// account, cost centre, agent and terms hash; then T:0 and the rail read back and set against each other. Every call
// goes to the in-memory T:0 (src/redteam/t0.ts); no network.
import { beforeEach, describe, expect, it } from "vitest";
import { T0Client, t0AccountType } from "../src/accounting/t0.js";
import { bookPayment, bookSettledPayments, bookedPayments, paymentContext, paymentEntry, paymentProblem, reconcileBookings, type RailReading, type SettledPayment } from "../src/accounting/t0Payments.js";
import { t0SinkOnce } from "../src/accounting/t0Sink.js";
import { CHART } from "../src/config/gl.js";
import { openDb, type DB } from "../src/db/open.js";
import { chartAccounts, FakeT0 } from "./fakes/t0.js";

const TERMS = "a".repeat(64);
const card = (over: Partial<SettledPayment> = {}): SettledPayment => ({
  id: "tx-card-1", at: "2026-11-21T10:00:00Z", rail: "airwallex_card", rail_ref: "ctx_123", amount: "1.25", currency: "EUR",
  agent: "support", terms_sha256: null, counterparty: "Helpdesk Co", description: "Helpdesk seat, paid with the support agent's token",
  lines: [{ account: "6100", debit_cents: 125, credit_cents: 0, cost_centre: "CC200" }, { account: "1200", debit_cents: 0, credit_cents: 125, cost_centre: null }], ...over,
});
const alta = (over: Partial<SettledPayment> = {}): SettledPayment => ({
  id: "tx-alta-1", at: "2026-11-21T10:05:00Z", rail: "metal", rail_ref: `0x${"b".repeat(64)}`, amount: "0.05", currency: "USDZ",
  agent: "sourcing", terms_sha256: TERMS, counterparty: "Stockline (test payee)", description: "Stock data, paid under the agent's Alta mandate",
  lines: [{ account: "5000", debit_cents: 5, credit_cents: 0, cost_centre: "CC100" }, { account: "1210", debit_cents: 0, credit_cents: 5, cost_centre: null }], ...over,
});

let db: DB;
let fake: FakeT0;
let client: T0Client;
const rate = (_d: string, cur: string) => (cur === "EUR" ? 1.08 : undefined);
beforeEach(() => {
  db = openDb(":memory:");
  fake = new FakeT0(chartAccounts(Object.keys(CHART), (c) => t0AccountType(c) ?? "expenses"));
  fake.functional = "USD";
  client = new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 });
});
const ctxFor = (ps: SettledPayment[]) => paymentContext(client, ps.flatMap((p) => p.lines.map((l) => l.account)), rate, { today: "2026-11-21" });
const events = (e: string) => db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as Record<string, unknown>);

describe("one T:0 entry per settled payment", () => {
  it("carries the GL account, cost centre, agent, terms hash and rail reference, in the functional currency with the original beside it", async () => {
    const ctx = await ctxFor([card(), alta()]);
    const e = paymentEntry(card(), ctx);
    expect(e.jeNumber).toMatch(/^PURPAY-[0-9a-f]{24}$/);
    expect(e.request).toMatchObject({ entry_date: "2026-11-21", currency: "USD", transaction_currency: "EUR" });
    expect(e.request.lines.map((l) => [l.line_type, l.amount_atoms, l.transaction_amount_atoms])).toEqual([["debit", 135, 125], ["credit", 135, 125]]);
    const debit = e.request.lines[0]!.memo!;
    for (const s of ["Purser payment tx-card-1", "GL 6100", "cost centre CC200", "agent support", "terms sha256 none", "Visa card on Airwallex Issuing (sandbox) ctx_123"]) expect(debit).toContain(s);
    // *USDZ is test USD: in the functional currency itself, no rate needed, tagged as testnet money.
    const a = paymentEntry(alta(), ctx);
    expect(a.request.transaction_currency).toBeUndefined();
    expect(a.request.lines.map((l) => l.amount_atoms)).toEqual([5, 5]);
    expect(a.request.memo).toContain(`terms sha256 ${TERMS}`);
    expect(a.request.memo).toContain("[test USD, Alta testnet]");
  });

  it("refuses a payment whose lines do not balance, are not its amount, or credit no bank", () => {
    expect(paymentProblem(card({ lines: [{ account: "6100", debit_cents: 125, credit_cents: 0, cost_centre: null }, { account: "1200", debit_cents: 0, credit_cents: 120, cost_centre: null }] }))).toMatch(/do not balance/);
    expect(paymentProblem(card({ amount: "1.30" }))).toMatch(/not the payment's amount/);
    expect(paymentProblem(card({ lines: [{ account: "6100", debit_cents: 125, credit_cents: 0, cost_centre: null }, { account: "2100", debit_cents: 0, credit_cents: 125, cost_centre: null }] }))).toMatch(/no bank/);
    expect(paymentProblem(card({ terms_sha256: "nope" }))).toMatch(/SHA-256/);
    expect(paymentProblem(card())).toBeNull();
  });

  it("books a payment once: a second call, and a fresh ledger against the same T:0, post nothing more", async () => {
    const ctx = await ctxFor([card()]);
    const first = await bookPayment(db, client, card(), ctx, new Date("2026-11-21T10:00:01Z"));
    expect(first.status).toBe("booked");
    expect(first.booking).toMatchObject({ payment_id: "tx-card-1", t0_id: "je_1", gl_account: "6100", cost_centre: "CC200", agent: "support", functional: { currency: "USD", amount: "1.35", rate: 1.08 } });
    expect((await bookPayment(db, client, card(), ctx)).status).toBe("booked before");
    const other = openDb(":memory:");
    expect((await bookPayment(other, client, card(), ctx)).status).toBe("found in T:0");
    expect(fake.entries).toHaveLength(1);
    expect(events("t0.booked")).toEqual([expect.objectContaining({ payment_id: "tx-card-1", t0_id: "je_1", je_number: first.booking.je_number, how: "booked" })]);
  });

  it("finds an entry T:0 took but did not answer for (a 409 on the replayed key) instead of booking it twice", async () => {
    const ctx = await ctxFor([card()]);
    const e = paymentEntry(card(), ctx);
    await client.postJournalEntry(e.request, e.idempotencyKey);
    fake.hideEntries = true;
    await expect(bookPayment(db, client, card(), ctx)).rejects.toThrow(/does not list it/);
    fake.hideEntries = false;
    expect((await bookPayment(db, client, card(), ctx)).status).toBe("found in T:0");
    expect(fake.entries).toHaveLength(1);
  });

  it("books every settled payment it is given, skips one that cannot be booked, and says why", async () => {
    const bad = card({ id: "tx-bad", amount: "9.99" });
    const r = await bookSettledPayments(db, client, rate, { payments: [card(), alta(), bad] });
    expect(r.booked.map((b) => b.payment_id)).toEqual(["tx-card-1", "tx-alta-1"]);
    expect(r.skipped).toEqual([{ payment_id: "tx-bad", why: expect.stringMatching(/not the payment's amount/) }]);
    expect(bookedPayments(db)).toHaveLength(2);
    expect((await bookSettledPayments(db, client, rate, { payments: [card(), alta()] })).booked).toEqual([]);
  });
});

describe("the reconcile check: T:0 against the rail", () => {
  const read = (over: Partial<Record<string, RailReading | null>> = {}) => async (b: { payment_id: string; rail_ref: string; amount: string; currency: string }) =>
    over[b.payment_id] !== undefined ? over[b.payment_id]! : { status: "APPROVED", settled: true, amount: b.amount, currency: b.currency, ref: b.rail_ref };

  it("agrees when T:0's entry and the rail's record are the same payment, and records the check", async () => {
    await bookSettledPayments(db, client, rate, { payments: [card(), alta()] });
    const r = await reconcileBookings(db, client, read(), { now: new Date("2026-11-21T11:00:00Z") });
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => [x.payment_id, x.ok, x.t0.amount, x.t0.currency])).toEqual([["tx-card-1", true, "1.25", "EUR"], ["tx-alta-1", true, "0.05", "USD"]]);
    expect(events("t0.reconciled")).toEqual([expect.objectContaining({ ok: true, at: "2026-11-21T11:00:00.000Z" })]);
  });

  it("disagrees when the rail moved another amount, did not settle, or has no record; or T:0 lost the entry", async () => {
    await bookSettledPayments(db, client, rate, { payments: [card(), alta()] });
    const r = await reconcileBookings(db, client, read({ "tx-card-1": { status: "APPROVED", settled: true, amount: "1.20", currency: "EUR", ref: "ctx_123" }, "tx-alta-1": null }));
    expect(r.ok).toBe(false);
    expect(r.rows[0]!.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["rail_amount_is_t0"]);
    expect(r.rows[1]!.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["rail_read_back"]);
    const pending = await reconcileBookings(db, client, read({ "tx-card-1": { status: "PENDING", settled: false, amount: "1.25", currency: "EUR", ref: "ctx_123" } }));
    expect(pending.rows[0]!.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["rail_settled"]);
    fake.entries.length = 0;
    const lost = await reconcileBookings(db, client, read());
    expect(lost.rows.every((x) => !x.ok && x.checks[0]!.name === "t0_entry_read_back" && !x.checks[0]!.ok)).toBe(true);
  });
});

describe("the runner's hook (T0_PAYMENTS=on)", () => {
  it("books settled payments instead of pushing the whole books, and only when switched on", async () => {
    expect(await t0SinkOnce(db, { env: {} as NodeJS.ProcessEnv, client, payments: [card()] })).toEqual({ ran: false, reason: "off" });
    const lines: string[] = [];
    const r = await t0SinkOnce(db, { env: { T0_PAYMENTS: "on", T0_RATES: "EUR=1.08" } as NodeJS.ProcessEnv, client, payments: [card(), alta()], books: () => { throw new Error("the books push must not run"); }, log: (l) => lines.push(l) });
    expect(r).toEqual({ ran: true, ok: true, posted: 2, skipped: 0, mode: "payments" });
    expect(fake.entries.every((e) => e.je_number.startsWith("PURPAY-"))).toBe(true);
    expect(lines.join("\n")).toContain("payment tx-card-1 booked in T:0 at once: je_1");
  });
});

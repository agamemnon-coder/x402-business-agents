// Cash & FX and Receivables in Purser Cloud (v1.5.1): the runner builds the money loop in short from its own ledger
// (src/treasury/cloudSnapshot.ts: cash against the CFO's floors, the 13-week forecast, the FX exposure with the advisor's
// decision and the conversions it filed, the receivables by number and amount) and pushes it with its sync; the cloud
// checks it against a strict schema, keeps the newest per company (cloud/src/moneyLoop.ts), GET /v1/treasury and GET
// /v1/receivables read it for the caller's company only, and the demo company a guest opens has it seeded
// (cloud/src/guest/moneyLoop.gen.ts). Breaks if a customer's or payer's name or a reminder's text reaches the cloud, if
// a conversion above the CFO's threshold is shown as anything but waiting for the CFO's passkey, if the console's pages
// offer a button that converts or approves, or if a company reads another's. Test money only.
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { draftReminders, issueInvoice, matchPayment } from "../src/receivables/ar.js";
import { forecastInput, ledgerOpening, proposeFxConversion } from "../src/treasury/advisor.js";
import { cashForecast } from "../src/treasury/forecastCore.js";
import { fxAdvice, type IndicativeRate } from "../src/treasury/fxCore.js";
import { moneyLoopSnapshot } from "../src/treasury/cloudSnapshot.js";
import { treasuryView } from "../src/treasury/view.js";
import { batchesFor, pushToCloud } from "../src/cloudsync/client.js";
import { MoneyLoopSnapshot } from "../cloud/src/moneyLoop.js";
import { DEMO_MONEY_LOOP } from "../cloud/src/guest/moneyLoop.gen.js";
import { DEMO_END, DEMO_TENANT } from "../cloud/src/guest/guest.js";
import { cashPosition } from "../cloud/src/claude/insight.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { MONEY_JS } from "../cloud/src/consoleMoney.js";
import { consolePage } from "../cloud/src/console.js";
import { NAV_GROUPS } from "../cloud/src/consoleShell.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const NOW = new Date("2026-11-26T09:00:00Z");
const set = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, NOW.toISOString());

/** A runner's ledger: EUR and USD cash, sales invoices, payments matched and to review, a USD bill that breaks the floor. */
async function world(threshold: string | null = "400.00"): Promise<{ db: DB; advice: ReturnType<typeof fxAdvice>; f: ReturnType<typeof cashForecast> }> {
  const db = openDb(":memory:");
  set(db, "eur_floor", "2000.00");
  set(db, "usd_floor", "1000.00");
  if (threshold) set(db, "treasury.fx_threshold_eur", threshold);
  postEntry(db, { date: "2026-11-01", description: "Opening", created_by: "test", lines: [{ account: "1200", debit: 1_000_000, currency: "EUR" }, { account: "3000", credit: 1_000_000, currency: "EUR" }] }, NOW);
  postEntry(db, { date: "2026-11-01", description: "Opening", created_by: "test", lines: [{ account: "1201", debit: 500_000, currency: "USD" }, { account: "3000", credit: 500_000, currency: "USD" }] }, NOW);
  await issueInvoice(db, { invoice_no: "NW-1001", customer: "Alpenweg Sport AG", contact_email: "jane.doe@alpenweg.example", currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-10-20", due_date: "2026-11-03" }, null, NOW);
  await issueInvoice(db, { invoice_no: "NW-1002", customer: "Fellside Outdoor Ltd", currency: "EUR", net_cents: 50_000, vat_code: "S0", issue_date: "2026-11-02", due_date: "2026-12-02" }, null, NOW);
  await issueInvoice(db, { invoice_no: "NW-1003", customer: "Kustlijn Buitensport BV", currency: "EUR", net_cents: 30_000, vat_code: "S0", issue_date: "2026-11-03", due_date: "2026-12-03" }, null, NOW);
  matchPayment(db, { payment_id: "pay_1", currency: "EUR", amount_cents: 50_000, reference: "NW-1002", payer: "Jane Doe", received_at: "2026-11-20T08:00:00Z" }, NOW);
  matchPayment(db, { payment_id: "pay_2", currency: "EUR", amount_cents: 7_700, reference: "Order 12", payer: "John Roe", received_at: "2026-11-21T08:00:00Z" }, NOW);
  draftReminders(db, "2026-11-26", NOW);
  const doc = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "money-loop-")), "rd-1.pdf");
  writeFileSync(doc, "%PDF-1.3 test");
  const sha = createHash("sha256").update("%PDF-1.3 test").digest("hex");
  db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, text_chars, received_at) VALUES (?, 'rd-1.pdf', 'application/pdf', 13, ?, 'upload', 1, ?)").run(sha, doc, NOW.toISOString());
  db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by, gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at)
    VALUES ('AP-0001', ?, 'invoice', 'code', 'Ridgeline Data', 'RD-1', '2026-11-20', '2026-12-15', 'USD', '4500.00', '0.00', '4500.00', '1234', 'BIC', '{}', 'code', '6900', 'r', 'ops', 'ready', '[]', ?, ?)`).run(sha, NOW.toISOString(), NOW.toISOString());
  const f = cashForecast(forecastInput(db, "2026-11-26", ledgerOpening(db), "the ledger's cash per currency"));
  const rate: IndicativeRate = { buy_currency: "USD", sell_currency: "EUR", buy_cents: 50_000, sell_cents: 46_000, rate: "0.92", at: NOW.toISOString(), source: "stand-in" };
  return { db, f, advice: fxAdvice(f, [rate], threshold ? Number(threshold.replace(".", "")) : null) };
}

describe("the money loop snapshot on the runner", () => {
  it("carries cash, the forecast, the advisor's decision and the receivables, by number and amount only", async () => {
    const { db, f, advice } = await world();
    const p = proposeFxConversion(db, advice.suggestions[0]!, f, NOW);
    const s = moneyLoopSnapshot(db, NOW, advice, f);
    expect(s.as_of).toBe("2026-11-26");
    expect(s.cash).toEqual([{ currency: "EUR", cents: 1_057_700, floor_cents: 200_000 }, { currency: "USD", cents: 500_000, floor_cents: 100_000 }]);
    expect(s.forecast.weeks).toHaveLength(13);
    const usd = s.fx.exposures.find((e) => e.currency === "USD")!;
    expect(usd).toMatchObject({ shortfall_cents: 50_000, decision: "proposal", eur_cents: 46_000 });
    expect(s.fx.exposures.find((e) => e.currency === "EUR")!.decision).toBe("none");
    expect(s.fx.threshold_eur_cents).toBe(40_000);
    expect(s.fx.proposals).toEqual([expect.objectContaining({ proposal_id: p.proposal_id, status: "PENDING_APPROVAL", buy_currency: "USD", buy_cents: 50_000, sell_currency: "EUR", sell_max_cents: 46_460 })]);
    // The receivables: the same aged debtors and review queue the runner's own dashboard shows (GET /api/treasury).
    const local = treasuryView(db, NOW).receivables;
    expect(s.receivables.aged.map((a) => [a.currency, a.buckets["0-30"]])).toEqual(Object.entries(local.aged.totals).map(([c, t]) => [c, t["0-30"]]));
    expect(s.receivables.review.map((r) => r.payment_id)).toEqual(local.review.map((r) => r.payment_id));
    expect(s.receivables.invoices.find((i) => i.invoice_no === "NW-1001")).toMatchObject({ status: "OPEN", days_overdue: 23, bucket: "0-30" });
    expect(s.receivables.payments.map((x) => [x.payment_id, x.outcome])).toEqual([["pay_2", "REVIEW"], ["pay_1", "MATCHED"]]);
    expect(s.receivables.dunning).toEqual([{ invoice_no: "NW-1001", stage: 1, due_on: "2026-11-06" }, { invoice_no: "NW-1001", stage: 2, due_on: "2026-11-13" }, { invoice_no: "NW-1001", stage: 3, due_on: "2026-11-23" }]);
    // No customer, contact or payer, and no reminder's text, leaves the runner.
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/Alpenweg|Fellside|Kustlijn|jane\.doe|Jane Doe|John Roe|Dear |Subject:/);
    expect(MoneyLoopSnapshot.safeParse(JSON.parse(json)).success).toBe(true);
  });

  it("says why nothing is proposed: below the threshold, no threshold, or not priced yet", async () => {
    const below = await world("900.00");
    expect(moneyLoopSnapshot(below.db, NOW, below.advice, below.f).fx.exposures.find((e) => e.currency === "USD")).toMatchObject({ decision: "below_threshold", eur_cents: 46_000 });
    const none = await world(null);
    expect(moneyLoopSnapshot(none.db, NOW, none.advice, none.f).fx.exposures.find((e) => e.currency === "USD")!.decision).toBe("no_threshold");
    const unpriced = await world();
    expect(moneyLoopSnapshot(unpriced.db, NOW).fx.exposures.find((e) => e.currency === "USD")!.decision).toBe("not_priced");
  });

  it("rides with the first batch of a push when the caller builds it, and not otherwise", async () => {
    const { db } = await world();
    const empty = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };
    expect(batchesFor(db, empty, { now: NOW }).filter((x) => "money_loop" in x)).toHaveLength(0);
    const batches = batchesFor(db, empty, { now: NOW, moneyLoop: (d, n) => moneyLoopSnapshot(d, n) });
    expect(batches.filter((x) => "money_loop" in x)).toHaveLength(1);
    expect(batches.find((x) => "vendors" in x)).toHaveProperty("money_loop");
  });
});

describe("GET /v1/treasury and GET /v1/receivables", () => {
  let c: TestCloud;
  let a: { id: string; key: string };
  let b: { id: string; key: string };
  beforeEach(async () => { c = testCloud(); a = await c.tenant("northwind"); b = await c.tenant("other-co"); });
  afterEach(() => c.close());
  const get = async (path: string, key: string | null) => c.req("GET", path, { key });
  const push = (key: string, s: unknown) => c.req("POST", "/v1/sync", { key, body: { money_loop: s } });

  it("answer null before the first push, then what the runner pushed, for the caller's company only", async () => {
    expect((await get("/v1/treasury", a.key)).json).toMatchObject({ treasury: null, test_money: true, demo: false });
    expect((await get("/v1/receivables", a.key)).json).toMatchObject({ receivables: null });
    const { db, f, advice } = await world();
    proposeFxConversion(db, advice.suggestions[0]!, f, NOW);
    await pushToCloud(db, { url: "https://cloud.test", key: a.key, fetch: c.fetch }, NOW, undefined, undefined, (d, n) => moneyLoopSnapshot(d, n, advice, f));
    const tr = (await get("/v1/treasury", a.key)).json as { treasury: { fx: { proposals: { status: string }[] }; cash: unknown[]; approval: string } };
    expect(tr.treasury.cash).toHaveLength(2);
    expect(tr.treasury.fx.proposals.map((p) => p.status)).toEqual(["PENDING_APPROVAL"]);
    expect(tr.treasury.approval).toMatch(/CFO's passkey/);
    const ar = (await get("/v1/receivables", a.key)).json as { receivables: { invoices: unknown[]; review: unknown[]; reminders: string } };
    expect(ar.receivables.invoices).toHaveLength(3);
    expect(ar.receivables.review).toHaveLength(1);
    expect(ar.receivables.reminders).toMatch(/Purser sends nothing/);
    expect((await get("/v1/treasury", b.key)).json).toMatchObject({ treasury: null });
    expect((await get("/v1/receivables", b.key)).json).toMatchObject({ receivables: null });
    expect((await get("/v1/treasury", null)).status).toBe(401);
    // The same figures again change nothing; an older snapshot never replaces a newer one.
    const s = moneyLoopSnapshot(db, NOW, advice, f);
    expect(((await push(a.key, { ...s, generated_at: "2026-11-26T09:30:00Z" })).json.applied as Record<string, unknown>).money_loop).toEqual({ added: 0, changed: 0, unchanged: 1 });
    expect(((await push(a.key, { ...s, as_of: "2026-11-01", generated_at: "2026-11-01T09:00:00Z" })).json.applied as Record<string, unknown>).money_loop).toEqual({ added: 0, changed: 0, unchanged: 1 });
  });

  it("refuse a snapshot with a customer's name, an unknown field or a bad status, and store nothing", async () => {
    const { db } = await world();
    const good = () => JSON.parse(JSON.stringify(moneyLoopSnapshot(db, NOW))) as MoneyLoopSnapshot & Record<string, unknown>;
    const named = good(); (named.receivables.invoices[0] as Record<string, unknown>).customer = "Alpenweg Sport AG";
    const extra = { ...good(), html: "<b>x</b>" };
    const status = good(); (status.receivables.invoices[0] as Record<string, unknown>).status = "WRITTEN_OFF";
    const draft = good(); (draft.receivables.dunning[0] as Record<string, unknown>).draft = "Dear Alpenweg";
    for (const bad of [named, extra, status, draft]) expect((await push(a.key, bad)).status).toBe(400);
    expect((await get("/v1/treasury", a.key)).json).toMatchObject({ treasury: null });
  });

  it("show the demo company's seeded Cash & FX and Receivables to a guest, labelled demo and test money", async () => {
    const g = await c.req("POST", "/v1/auth/guest", { key: null });
    const key = (g.json as { session: string }).session;
    const tr = (await get("/v1/treasury", key)).json as { demo: boolean; test_money: boolean; treasury: MoneyLoopSnapshot & { approval: string } };
    expect(tr.demo && tr.test_money).toBe(true);
    // The demo company's ledger bank on its last day (test/cloud-money-loop.test.ts, "the demo company's cash").
    expect(Object.fromEntries(tr.treasury.cash.map((x) => [x.currency, x.cents]))).toEqual({ EUR: 4_988_133, USD: 2_500_000, GBP: 64_000 });
    const waiting = tr.treasury.fx.proposals.filter((p) => p.status === "PENDING_APPROVAL");
    expect(waiting).toHaveLength(1);
    expect(tr.treasury.fx.exposures.find((e) => e.currency === waiting[0]!.buy_currency)).toMatchObject({ decision: "proposal" });
    expect(waiting[0]!.sell_currency === "EUR" ? waiting[0]!.indicative_sell_cents : 0).toBeGreaterThanOrEqual(tr.treasury.fx.threshold_eur_cents!);
    // GBP is under its floor by GBP 360.00, about EUR 417.24 at the stand-in rate: above the CFO's threshold, so proposed.
    expect(waiting[0]).toMatchObject({ buy_currency: "GBP", buy_cents: 36_000, sell_currency: "EUR", indicative_sell_cents: 41_724 });
    const ar = (await get("/v1/receivables", key)).json as { demo: boolean; receivables: MoneyLoopSnapshot["receivables"] };
    expect(ar.demo).toBe(true);
    expect(ar.receivables.invoices.filter((i) => i.status === "OPEN" || i.status === "PARTIAL").length).toBeGreaterThanOrEqual(4);
    expect(new Set(ar.receivables.payments.map((p) => p.outcome))).toEqual(new Set(["MATCHED", "MATCHED_TOLERANCE", "PARTIAL", "OVERPAID", "REVIEW"]));
    expect(ar.receivables.review.length).toBeGreaterThanOrEqual(1);
    expect(ar.receivables.dunning.length).toBeGreaterThanOrEqual(1);
    // A second guest finds the company as it is: nothing added twice.
    await c.req("POST", "/v1/auth/guest", { key: null });
    expect(((await get("/v1/treasury", key)).json as { treasury: unknown }).treasury).toEqual(tr.treasury);
    // A guest reads; a guest never pushes.
    expect((await push(key, DEMO_MONEY_LOOP)).status).toBe(403);
  });
});

describe("the demo company's books and its Receivables page", () => {
  let c: TestCloud;
  beforeEach(() => { c = testCloud(); });
  afterEach(() => c.close());
  const AR_NAMES = /Summit|Alpine|Fjord|Highland|Kustlijn|Rocky|Demo payer/;
  type Open = { items: { party: string; doc_ref: string; currency: string; open_cents: number }[] };

  it("agree on what is open, per currency: the ledger's receivables, the balance sheet and Ask Purser's cash position", async () => {
    const key = ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;
    const page = ((await c.req("GET", "/v1/receivables", { key })).json as { receivables: MoneyLoopSnapshot["receivables"] }).receivables;
    const open: Record<string, number> = {};
    for (const i of page.invoices) if (i.status === "OPEN" || i.status === "PARTIAL") open[i.currency] = (open[i.currency] ?? 0) + i.amount_cents - i.paid_cents;
    // The page's own two figures agree first: its invoices and its aged debtors.
    expect(Object.fromEntries(page.aged.map((a) => [a.currency, Object.values(a.buckets).reduce((n, x) => n + x, 0)]))).toEqual(open);
    expect(Object.keys(open).sort()).toEqual(["EUR", "GBP", "USD"]);
    expect(open.EUR).toBe(770_241);

    const report = (await c.req("GET", "/v1/reports/receivables", { key })).json as Open;
    const byCurrency = (items: Open["items"]) => items.reduce<Record<string, number>>((m, x) => ({ ...m, [x.currency]: (m[x.currency] ?? 0) + x.open_cents }), {});
    expect(byCurrency(report.items)).toEqual(open);
    // Invoice by invoice too, and by number only: no customer's name in the books the cloud holds.
    const pageOpen = page.invoices.filter((i) => i.status === "OPEN" || i.status === "PARTIAL").map((i) => [i.invoice_no, i.amount_cents - i.paid_cents]).sort();
    expect(report.items.map((x) => [x.doc_ref, x.open_cents]).sort()).toEqual(pageOpen);
    expect(JSON.stringify(report)).not.toMatch(AR_NAMES);

    const balance = (await c.req("GET", "/v1/reports/balance", { key })).json as { by_currency: Record<string, { balanced: boolean; accounts: { account: string; cents: number }[] }> };
    for (const [currency, cents] of Object.entries(open)) {
      expect(balance.by_currency[currency]!.accounts.find((a) => a.account === "1300")?.cents, currency).toBe(cents);
      expect(balance.by_currency[currency]!.balanced, currency).toBe(true);
    }

    const cash = (await cashPosition(new TenantDb(c.env.sql, DEMO_TENANT), new Date(DEMO_END))) as { currency: string; open: { receivables: string } };
    expect(cash.currency).toBe("EUR");
    expect(cash.open.receivables).toBe((open.EUR! / 100).toFixed(2));
  });

  it("show the money that came in for those invoices on the Transactions page and in the cash, by invoice number only", async () => {
    const key = ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;
    const page = ((await c.req("GET", "/v1/receivables", { key })).json as { receivables: MoneyLoopSnapshot["receivables"] }).receivables;
    const entries = ((await c.req("GET", "/v1/ledger/entries?limit=200", { key })).json as { items: { description: string; source_key: string | null; lines: { party: string | null }[] }[] }).items;
    const ar = entries.filter((e) => e.source_key?.startsWith("ar:"));
    expect(ar.length).toBeGreaterThanOrEqual(page.invoices.length + page.payments.length);
    expect(JSON.stringify(ar)).not.toMatch(AR_NAMES);
    const tx = ((await c.req("GET", "/v1/transactions?limit=200", { key })).json as { items: { id: string; direction: string; currency: string; amount: string; counterparty: string; reconciliation: string }[] }).items;
    for (const p of page.payments) {
      const t = tx.find((x) => x.id === `receipt:${p.payment_id}`);
      expect(t, p.payment_id).toMatchObject({ direction: "in", currency: p.currency, amount: (p.amount_cents / 100).toFixed(2), reconciliation: "matched" });
      expect(JSON.stringify(t)).not.toMatch(AR_NAMES);
    }
    // The Cash & FX page's EUR is the demo company's cash, the payments for these invoices included.
    const cash = (await cashPosition(new TenantDb(c.env.sql, DEMO_TENANT), new Date(DEMO_END))) as { cash: string };
    const tr = ((await c.req("GET", "/v1/treasury", { key })).json as { treasury: MoneyLoopSnapshot }).treasury;
    expect((tr.cash.find((x) => x.currency === "EUR")!.cents / 100).toFixed(2)).toBe(cash.cash);
  });
});

describe("the demo company's cash", () => {
  let c: TestCloud;
  beforeEach(() => { c = testCloud(); });
  afterEach(() => c.close());

  it("is one figure per currency: the ledger's bank on the demo's last day, Cash & FX, the Overview and Ask Purser", async () => {
    const key = ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;
    const balance = (await c.req("GET", "/v1/reports/balance", { key })).json as { by_currency: Record<string, { accounts: { account: string; cents: number }[] }> };
    const bank: Record<string, number> = {};
    for (const [currency, b] of Object.entries(balance.by_currency)) for (const a of b.accounts) if (a.account.startsWith("12") && currency !== "USDZ") bank[currency] = (bank[currency] ?? 0) + a.cents;
    const tr = ((await c.req("GET", "/v1/treasury", { key })).json as { treasury: MoneyLoopSnapshot }).treasury;
    expect(Object.fromEntries(tr.cash.map((x) => [x.currency, x.cents]))).toEqual(bank);
    // The Overview shows its main currency's cash position: the books' opening balance plus what moved since.
    const d = (await c.req("GET", "/v1/dashboard", { key })).json as { currency: string; money: { opening: string; net: string; cash: string }; cash: { balance: string }[] };
    expect(d.money.cash).toBe((bank[d.currency]! / 100).toFixed(2));
    expect(d.cash.at(-1)!.balance).toBe(d.money.cash);
    expect(Math.round(Number(d.money.opening) * 100) + Math.round(Number(d.money.net) * 100)).toBe(bank[d.currency]);
    const p = (await cashPosition(new TenantDb(c.env.sql, DEMO_TENANT), new Date(DEMO_END))) as { currency: string; cash: string };
    expect(p.cash).toBe((bank[p.currency]! / 100).toFixed(2));
  });
});

describe("a demo company made before", () => {
  let c: TestCloud;
  beforeEach(() => { c = testCloud(); });
  afterEach(() => c.close());
  const guest = async () => ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;
  const openByCurrency = async (key: string) => ((await c.req("GET", "/v1/reports/receivables", { key })).json as { items: { currency: string; open_cents: number }[] }).items
    .reduce<Record<string, number>>((m, x) => ({ ...m, [x.currency]: (m[x.currency] ?? 0) + x.open_cents }), {});

  it("is brought up to date on the next guest sign-in: its books and its Cash & FX", async () => {
    const want = await openByCurrency(await guest());
    expect(want).toEqual({ EUR: 770_241, GBP: 98_000, USD: 145_000 });
    // An older seed: no receivables in its books, and its audit chain ended elsewhere.
    await c.env.sql.batch([
      { sql: "DELETE FROM ledger_lines WHERE tenant_id = ? AND account = '1300'", params: [DEMO_TENANT] },
      { sql: "UPDATE audit_rows SET row_hash = ? WHERE tenant_id = ? AND seq = (SELECT MAX(seq) FROM audit_rows WHERE tenant_id = ?)", params: ["0".repeat(64), DEMO_TENANT, DEMO_TENANT] },
    ]);
    expect(await openByCurrency(await guest())).toEqual(want);
    // An older money loop with the same generated_at (the demo's last day) and other figures.
    const older = { ...DEMO_MONEY_LOOP, cash: DEMO_MONEY_LOOP.cash.map((x) => (x.currency === "EUR" ? { ...x, cents: 922_692 } : x)) };
    await c.env.sql.batch([{ sql: "UPDATE money_loops SET body_json = ?, body_sha256 = ? WHERE tenant_id = ? AND id = 'latest'", params: [JSON.stringify(older), "0".repeat(64), DEMO_TENANT] }]);
    const key = await guest();
    const tr = ((await c.req("GET", "/v1/treasury", { key })).json as { treasury: MoneyLoopSnapshot }).treasury;
    expect(tr.cash).toEqual(DEMO_MONEY_LOOP.cash);
  });
});

describe("the demo company's seeded money loop", () => {
  it("is valid against the cloud's schema and names no customer", () => {
    expect(MoneyLoopSnapshot.safeParse(DEMO_MONEY_LOOP).success).toBe(true);
    expect(JSON.stringify(DEMO_MONEY_LOOP)).not.toMatch(/Summit|Alpine|Fjord|Highland|Kustlijn|Rocky|Demo payer/);
    expect(DEMO_MONEY_LOOP.money).toMatch(/test money/);
  });
});

describe("the console's Cash & FX and Receivables pages", () => {
  const page = consolePage("nonce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
  it("are in the menu, in the Money group, in English and Dutch", () => {
    expect(NAV_GROUPS.find((g) => g[0] === "money")![1]).toEqual(["invoices", "receivables", "cash", "transactions", "books"]);
    expect(page).toContain('<a href="#/cash" data-tab="cash" data-t="cs.nav.cash">Cash &amp; FX</a>'.replace("&amp;", "&"));
    expect(page).toContain('href="#/receivables" data-tab="receivables"');
    expect(MESSAGES.nl["cs.nav.cash"]).toBe("Kas & valuta");
    expect(MESSAGES.nl["cs.nav.ar"]).toBe("Debiteuren");
    for (const k of Object.keys(MESSAGES.en).filter((x) => /^cs\.(cash|fx|ar|ml)\./.test(x))) expect(MESSAGES.nl[k as keyof typeof MESSAGES.nl], k).toBeTruthy();
  });

  it("read two routes, write no markup and offer no button that converts, approves or pays", () => {
    expect(page).toContain("async function cashView()");
    expect(page).toContain("'/cash':cashView,'/receivables':receivablesView");
    expect([...MONEY_JS.matchAll(/api\('([^']+)'/g)].map((m) => m[1])).toEqual(["/v1/treasury", "/v1/receivables"]);
    expect(MONEY_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|method:'POST'|\bbtn\(/);
    expect(MONEY_JS).not.toMatch(/onclick="|on[a-z]+=['"]/);
    // The only buttons are the chart's currency picker.
    expect([...MONEY_JS.matchAll(/el\('button'/g)]).toHaveLength(1);
    expect(MESSAGES.en["cs.fx.passkey"]).toMatch(/only after the CFO approves it with the passkey/);
  });
});

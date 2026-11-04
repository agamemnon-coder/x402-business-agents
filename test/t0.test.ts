// T:0 accounting (a hackathon sponsor): Purser posts its double-entry books to T:0's general ledger. No network: every
// call goes to an in-memory fake of T:0's API (test/fakes/t0.ts). The 11 cases are the research report's list.
import { describe, expect, it } from "vitest";
import { doubleEntry, trialBalance, type Posting } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { CHART } from "../src/config/gl.js";
import {
  buildEntries, compareReports, pushBooks, resolveAccounts, T0Client, T0Error, t0AccountType, trialInFunctional,
  type T0ProfitLoss, type T0Rate,
} from "../src/accounting/t0.js";
import { chartAccounts, FakeT0 } from "./fakes/t0.js";

const line = (over: Partial<JournalLine>): JournalLine => ({
  date: "2026-10-30T10:00:00Z", source: "card", ref: "r", description: "d", counterparty: "c", agent: "sourcing", cost_centre: "CC100",
  gl_account: "6100", gl_name: "Software", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "p", approval: "", rule: "", ...over,
});

/** A small day of Purser's books: an opening balance, a data sale and a refund on Metal, a card charge, an invoice and its fee. */
const day: JournalLine[] = [
  line({ source: "opening", ref: "funding", description: "Owner funds the business account on Metal", agent: "", cost_centre: "", gl_account: "3000", bank_account: "1210", amount: "10.00", currency: "USDZ", proof: "0xfund", date: "2026-10-29T08:00:00Z" }),
  line({ source: "sale", ref: "17", description: "Stock check sold to a retailer 17", gl_account: "4000", bank_account: "1210", amount: "0.05", currency: "USDZ", proof: "0xsale17" }),
  line({ source: "card", ref: "txn_1", description: "Figma seat", gl_account: "6100", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "txn_1" }),
  line({ source: "transfer", ref: "req_9", description: "Invoice INV-9", agent: "treasury", cost_centre: "CC300", gl_account: "6200", bank_account: "1200", amount: "-500.00", currency: "EUR", proof: "tr_9" }),
  line({ source: "transfer", ref: "req_9", description: "Transfer fee, invoice INV-9", agent: "treasury", cost_centre: "CC300", gl_account: "6800", bank_account: "1200", amount: "-1.50", currency: "EUR", proof: "tr_9" }),
  line({ source: "refund", ref: "3", description: "Refund of query 17", agent: "support", cost_centre: "CC200", gl_account: "4100", bank_account: "1210", amount: "-0.05", currency: "USDZ", proof: "0xrefund3", date: "2026-10-30T11:00:00Z" }),
];

const codes = Object.keys(CHART);
const typeOf = (c: string) => t0AccountType(c) ?? "expenses";
const usdAt092: T0Rate = (_date, cur) => (cur === "USD" ? 0.92 : undefined);

function setup(functional = "EUR") {
  const fake = new FakeT0(chartAccounts(codes, typeOf));
  fake.functional = functional;
  const client = new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 });
  return { fake, client, map: resolveAccounts(fake.accounts, codes).map };
}

const bearer = (fake: FakeT0) => fake.calls.map((c) => c.headers.get("authorization"));

describe("T:0 client", () => {
  // 1
  it("sends the key as a bearer token, to api.t0.ai by default, and maps a 401 to T0Error CAPI11 without the key in it", async () => {
    const { fake, client } = setup();
    expect(await client.listEntities()).toEqual([{ external_id: "ent_1", name: "Northwind Outdoor", country: "NL" }]);
    expect(bearer(fake)).toEqual([`Bearer ${fake.key}`]);
    expect(fake.calls[0]!.path).toBe("/v1/entities");

    const seen: string[] = [];
    const spy = (async (u: string | URL | Request, i?: RequestInit) => { seen.push(String(u)); return fake.fetch(u, i); }) as typeof fetch;
    await new T0Client({ apiKey: fake.key, fetch: spy }).listEntities();
    expect(seen[0]).toBe("https://api.t0.ai/v1/entities");

    const wrong = new T0Client({ apiKey: "sk-wrong-key", fetch: fake.fetch, retryDelayMs: 0 });
    const err = await wrong.listEntities().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(T0Error);
    expect(err).toMatchObject({ status: 401, code: "CAPI11", retryable: false });
    expect(String((err as Error).message)).not.toContain("sk-wrong-key");
    expect(JSON.stringify(err)).not.toContain("sk-wrong-key");
  });

  // 2
  it("posts a balanced entry and the cents come back unchanged", async () => {
    const { fake, client, map } = setup();
    const [entry] = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092);
    const je = await client.postJournalEntry(entry!.request, entry!.idempotencyKey);
    expect(je).toMatchObject({ je_number: entry!.jeNumber, entry_date: "2026-10-30", currency: "EUR", total_debit_atoms: 1999, total_credit_atoms: 1999, source: "manual" });
    expect(je.lines.map((l) => [l.account_number, l.line_type, l.amount_atoms])).toEqual([["6100", "debit", 1999], ["1200", "credit", 1999]]);
    expect(fake.calls.at(-1)!.headers.get("x-idempotency-key")).toBe(entry!.idempotencyKey);
    const listed = [];
    for await (const e of client.listJournalEntries({ dateFrom: "2026-10-30", dateTo: "2026-10-30", source: ["manual"] })) listed.push(e);
    expect(listed.map((e) => e.total_debit_atoms)).toEqual([1999]);
  });

  // 3
  it("needs an idempotency key, and a replay within the hour is refused with 409 and posts nothing twice", async () => {
    const { fake, client, map } = setup();
    const [entry] = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092);
    // T:0 itself refuses a POST without the header; the client will not even send one.
    const raw = await fake.fetch("https://api.t0.ai/v1/journal-entries", { method: "POST", headers: { authorization: `Bearer ${fake.key}` }, body: JSON.stringify(entry!.request) });
    expect(raw.status).toBe(400);
    expect(((await raw.json()) as { error_code: string }).error_code).toBe("CAPI34");
    await expect(client.postJournalEntry(entry!.request, "")).rejects.toThrow(/idempotency key/i);

    await client.postJournalEntry(entry!.request, entry!.idempotencyKey);
    await expect(client.postJournalEntry(entry!.request, entry!.idempotencyKey)).rejects.toMatchObject({ status: 409, code: "CAPI34", retryable: false });
    expect(fake.entries).toHaveLength(1);

    // pushBooks reads that 409 as "already posted": here T:0's list does not show the entry yet.
    fake.hideEntries = true;
    const r = await pushBooks(client, [entry!], new Set());
    expect(r.posted).toEqual([]);
    expect(r.skipped).toEqual([{ je_number: entry!.jeNumber, reason: "idempotency key already used" }]);
    expect(fake.entries).toHaveLength(1);
  });

  // 4
  it("a re-run after the hour, when T:0 has forgotten the keys, skips by je_number", async () => {
    const { fake, client, map } = setup();
    const entries = buildEntries(doubleEntry(day), map, "EUR", usdAt092);
    const first = await pushBooks(client, entries, new Set());
    expect(first.posted).toHaveLength(entries.length);
    expect(first.skipped).toEqual([]);

    fake.now += 2 * 3_600_000;
    const posts = fake.posts();
    const again = await pushBooks(client, entries, new Set());
    expect(again.posted).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(entries.map(() => "in T:0"));
    expect(fake.posts()).toBe(posts);
    expect(fake.entries).toHaveLength(entries.length);
    // It listed only manual entries, for the dates of the push.
    const list = fake.calls.filter((c) => c.method === "GET" && c.path === "/v1/journal-entries").at(-1)!;
    expect([list.query.get("date_from"), list.query.get("date_to"), list.query.getAll("source")]).toEqual(["2026-10-29", "2026-10-30", ["manual"]]);

    // Entries we recorded as posted are skipped without asking T:0 to post them.
    const { fake: f2, client: c2 } = setup();
    const r = await pushBooks(c2, entries, new Set(entries.map((e) => e.jeNumber)));
    expect(r.skipped.every((s) => s.reason === "posted before")).toBe(true);
    expect(f2.posts()).toBe(0);
  });

  // 5
  it("an unbalanced entry, an unknown account or the wrong currency is a CAPI33, not retried", async () => {
    const { fake, client, map } = setup();
    const [entry] = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092);
    const req = entry!.request;
    const unbalanced = { ...req, lines: [req.lines[0]!, { ...req.lines[1]!, amount_atoms: 1998 }] };
    const badAccount = { ...req, lines: [{ ...req.lines[0]!, gl_account_id: "gl_9999" }, req.lines[1]!] };
    const wrongCurrency = { ...req, currency: "USD" };
    for (const [i, bad] of [unbalanced, badAccount, wrongCurrency].entries()) {
      const before = fake.calls.length;
      await expect(client.postJournalEntry(bad, `k${i}`)).rejects.toMatchObject({ status: 400, code: "CAPI33", retryable: false });
      expect(fake.calls.length - before).toBe(1);
    }
    expect(fake.entries).toEqual([]);
  });

  // 6
  it("posts *USDZ as USD, tagged test money, balanced in both currencies; a missing rate stops the push before any POST", async () => {
    const { fake, client, map } = setup("EUR");
    const entries = buildEntries(doubleEntry(day), map, "EUR", usdAt092);
    const sale = entries.find((e) => e.request.memo?.startsWith("Stock check sold"))!;
    expect(sale.request).toMatchObject({ currency: "EUR", transaction_currency: "USD", entry_date: "2026-10-30" });
    expect(sale.request.memo).toContain("[test USD, Metal testnet]");
    // 0.05 USD at 0.92 is 0.046 EUR: 5 cents of USD, 5 cents of EUR after rounding, on both lines.
    expect(sale.request.lines.map((l) => [l.line_type, l.amount_atoms, l.transaction_amount_atoms])).toEqual([["debit", 5, 5], ["credit", 5, 5]]);
    expect(sale.request.lines[0]!.memo).toBe("cost centre CC100; proof 0xsale17");
    const opening = entries.find((e) => e.request.memo?.startsWith("Owner funds"))!;
    expect(opening.request.lines.map((l) => [l.amount_atoms, l.transaction_amount_atoms])).toEqual([[920, 1000], [920, 1000]]);
    const card = entries.find((e) => e.request.memo === "Figma seat")!;
    expect(card.request.transaction_currency).toBeUndefined();
    expect(card.request.lines.every((l) => l.transaction_amount_atoms === undefined)).toBe(true);
    const r = await pushBooks(client, entries, new Set());
    expect(r.posted).toHaveLength(entries.length);
    for (const e of fake.entries) {
      const sum = (t: string, k: "amount_atoms" | "transaction_amount_atoms") => e.lines.filter((l) => l.line_type === t).reduce((s, l) => s + (l[k] ?? 0), 0);
      expect(sum("debit", "amount_atoms")).toBe(sum("credit", "amount_atoms"));
      expect(sum("debit", "transaction_amount_atoms")).toBe(sum("credit", "transaction_amount_atoms"));
    }

    const { fake: f2, map: m2 } = setup("GBP");
    const noRate = () => buildEntries(doubleEntry(day), m2, "GBP", (_d, cur) => (cur === "USD" ? 0.79 : undefined));
    expect(noRate).toThrow(/no rate.*EUR.*2026-10-30/);
    expect(f2.posts()).toBe(0);
  });

  // 7
  it("an account missing from T:0's chart fails fast and names every missing code", () => {
    const { fake } = setup();
    const broken = fake.accounts
      .filter((a) => !["6100", "6800"].includes(a.account_number ?? ""))
      .map((a) => (a.account_number === "4100" ? { ...a, is_postable: false } : a));
    expect(() => resolveAccounts(broken, codes)).toThrow(/4100, 6100, 6800.*missing: 6100, 6800; not postable or inactive: 4100/);
    const map = new Map([["1200", "gl_1200"], ["1210", "gl_1210"]]);
    expect(() => buildEntries(doubleEntry(day), map, "EUR", usdAt092)).toThrow("no T:0 account for 3000, 4000, 4100, 6100, 6200, 6800");
    // A wrong account type is a warning, not a stop: the chart is Max's to set up.
    const odd = fake.accounts.map((a) => (a.account_number === "6200" ? { ...a, account_type: "expenses" } : a));
    expect(resolveAccounts(odd, codes).warnings).toEqual(["6200 is expenses in T:0; we expected cost_of_goods_sold"]);
  });

  // 8
  it("follows both pagination styles: GL accounts by page number, journal entries by cursor", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ external_id: `gl_x${i}`, account_number: String(7000 + i), name: `x${i}`, account_type: "expenses", is_active: true, is_postable: i % 2 === 0, parent_external_id: null, currency: null }));
    const fake = new FakeT0(many);
    const client = new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 });
    expect(await client.listGlAccounts()).toHaveLength(250);
    expect(fake.calls.map((c) => c.query.get("page_number"))).toEqual(["1", "2", "3"]);
    expect(await client.listGlAccounts({ postable: true })).toHaveLength(125);
    expect(fake.calls.at(-1)!.query.get("postable")).toBe("true");

    for (let i = 0; i < 120; i++) {
      await client.postJournalEntry({ entry_date: "2026-10-30", currency: "EUR", je_number: `N-${i}`, lines: [
        { gl_account_id: "gl_x0", line_type: "debit", amount_atoms: 100 + i }, { gl_account_id: "gl_x2", line_type: "credit", amount_atoms: 100 + i },
      ] }, `key-${i}`);
    }
    const before = fake.calls.length;
    const seen = new Set<string>();
    for await (const e of client.listJournalEntries({})) seen.add(e.je_number);
    expect(seen.size).toBe(120);
    const pages = fake.calls.slice(before);
    expect(pages.map((c) => c.query.get("limit"))).toEqual(["100", "100"]);
    expect(pages[0]!.query.get("cursor")).toBeNull();
    expect(pages[1]!.query.get("cursor")).toBeTruthy();
  });

  // 9
  it("retries a CAPI73 (rebuilding) or a 5xx once; a second failure and a CAPI67 are surfaced", async () => {
    const { fake, client, map } = setup();
    const [entry] = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092);
    fake.forced.push({ status: 409, body: { error_code: "CAPI73", detail: "Accounting data is being rebuilt" } });
    await client.postJournalEntry(entry!.request, entry!.idempotencyKey);
    expect(fake.posts()).toBe(2);
    expect(fake.entries).toHaveLength(1);

    fake.forced.push({ status: 503, body: {} }, { status: 409, body: { error_code: "CAPI73", detail: "rebuilding" } });
    await expect(client.listEntities()).rejects.toMatchObject({ status: 409, code: "CAPI73", retryable: true });

    const n = fake.calls.length;
    fake.forced.push({ status: 409, body: { error_code: "CAPI67", detail: "No First Month of Books" } });
    await expect(client.postJournalEntry(entry!.request, "other-key")).rejects.toMatchObject({ status: 409, code: "CAPI67", retryable: false });
    expect(fake.calls.length - n).toBe(1);

    fake.forced.push({ status: 500, body: { error_code: "CAPI99", detail: "boom" } });
    expect(await client.listEntities()).toHaveLength(1);
  });

  // 10
  it("reads reports: null cells, nested accounts, atoms_per_unit, and the 5-year limit", async () => {
    const { fake, client } = setup();
    await expect(client.profitLoss({ start_date: "2020-01-01", end_date: "2026-01-01" })).rejects.toMatchObject({ status: 400, code: "CAPI69" });
    const bs = await client.balanceSheet({ start_date: "2026-10-01", end_date: "2026-10-31", period_type: "monthly" });
    expect(bs.reporting_currency).toBe("EUR");
    expect(fake.calls.at(-1)!.query.get("period_type")).toBe("monthly");

    // A hand-made P&L: a parent with two leaves, a null cell (no data that month), and a currency with 1000 atoms per unit.
    const pl: T0ProfitLoss = {
      periods: [{ id: "2026-09", label: "Sep 2026", start_date: "2026-09-01", end_date: "2026-09-30" }, { id: "2026-10", label: "Oct 2026", start_date: "2026-10-01", end_date: "2026-10-31" }],
      reporting_currency: "KWD", reporting_currency_source: "functional", amount_unit: "atoms", atoms_per_unit: 1000,
      sections: [
        { key: "revenue", label: "Revenue", is_computed: false, balances: { "2026-09": null, "2026-10": 500 }, children: [
          { account_id: "gl_4000", account_number: "4000", name: "Revenue", is_postable: true, balances: { "2026-09": null, "2026-10": 500 }, children: [] },
        ] },
        { key: "operating_expenses", label: "Operating expenses", is_computed: false, balances: { "2026-09": 1000, "2026-10": 2500 }, children: [
          { account_id: "gl_6000", account_number: "6000", name: "Opex", is_postable: false, balances: { "2026-09": 1000, "2026-10": 2500 }, children: [
            { account_id: "gl_6100", account_number: "6100", name: "Software", is_postable: true, balances: { "2026-09": 1000, "2026-10": null }, children: [] },
            { account_id: "gl_6800", account_number: "6800", name: "Fees", is_postable: true, balances: { "2026-09": null, "2026-10": 2500 }, children: [] },
          ] },
        ] },
        { key: "net_income", label: "Net income", is_computed: true, balances: { "2026-09": -1000, "2026-10": -2000 }, children: [] },
      ],
    };
    const rows = trialBalance([
      ...doubleEntry([line({ gl_account: "4000", bank_account: "1200", amount: "0.50", currency: "KWD" })]),
      ...doubleEntry([line({ gl_account: "6100", amount: "-1.00", currency: "KWD" }), line({ gl_account: "6800", amount: "-2.50", currency: "KWD" })]),
    ]);
    const cmp = compareReports(rows, pl);
    expect(cmp.differences).toEqual([]);
    expect(cmp.matches).toBe(true);
    expect(cmp.rows.map((r) => [r.account, r.ours_atoms, r.t0_atoms])).toEqual([["4000", 500, 500], ["6100", 1000, 1000], ["6800", 2500, 2500]]);
    // A trial row in another currency cannot be compared to this report until it is converted.
    expect(() => compareReports(trialBalance(doubleEntry([line({ currency: "EUR" })])), pl)).toThrow(/EUR.*KWD/);
  });

  // 11
  it("the books T:0 holds after a push match our trial balance line by line, and a difference shows when they do not", async () => {
    const { client, map } = setup("USD");
    const usdDay = day.map((l) => (l.currency === "EUR" ? { ...l, currency: "USD", bank_account: "1201" } : l));
    const postings = doubleEntry(usdDay);
    // *USDZ is posted as USD; in a USD entity that needs no rate at all.
    const entries = buildEntries(postings, map, "USD", () => undefined);
    await pushBooks(client, entries, new Set());
    const pl = await client.profitLoss({ start_date: "2026-10-01", end_date: "2026-10-31", period_type: "monthly" });
    const cmp = compareReports(trialBalance(postings), pl);
    expect(cmp.matches).toBe(true);
    expect(cmp.rows.map((r) => r.account)).toEqual(["4000", "4100", "6100", "6200", "6800"]);
    expect(cmp.rows.find((r) => r.account === "4000")).toMatchObject({ ours_atoms: 5, t0_atoms: 5, diff_atoms: 0 });

    const off = trialBalance(postings).map((r) => (r.account === "6800" ? { ...r, debit_cents: r.debit_cents + 1, balance_cents: r.balance_cents + 1 } : r));
    const bad = compareReports(off, pl);
    expect(bad.matches).toBe(false);
    expect(bad.differences).toEqual([expect.objectContaining({ account: "6800", ours_atoms: 151, t0_atoms: 150, diff_atoms: 1 })]);

    // In a EUR entity, our multi-currency books compare in EUR through the entries we built.
    const eur = setup("EUR");
    const eurEntries = buildEntries(doubleEntry(day), eur.map, "EUR", usdAt092);
    await pushBooks(eur.client, eurEntries, new Set());
    const eurPl = await eur.client.profitLoss({ start_date: "2026-10-01", end_date: "2026-10-31" });
    expect(compareReports(trialInFunctional(eurEntries), eurPl).matches).toBe(true);
  });
});

describe("T:0 entries", () => {
  const ids = (ps: Posting[]) => buildEntries(ps, setup().map, "EUR", usdAt092).map((e) => e.jeNumber);

  it("one T:0 entry per Purser entry, with stable ids from the content, not the position", () => {
    const base = ids(doubleEntry(day));
    expect(base).toHaveLength(day.length);
    expect(new Set(base).size).toBe(day.length);
    for (const j of base) expect(j).toMatch(/^PUR-[0-9a-f]{24}$/);
    // An earlier-dated line shifts Purser's J-00001 numbering but no T:0 je_number.
    const earlier = line({ source: "card", ref: "txn_0", description: "Earlier", date: "2026-10-28T09:00:00Z", amount: "-5.00" });
    const shifted = ids(doubleEntry([earlier, ...day]));
    expect(shifted.slice(1)).toEqual(base);
    // Two identical lines still get two ids.
    expect(new Set(ids(doubleEntry([day[2]!, day[2]!]))).size).toBe(2);
  });

  it("idempotency keys follow the payload: same content, same key; changed content, new key", () => {
    const { map } = setup();
    const a = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092)[0]!;
    const b = buildEntries(doubleEntry([day[2]!]), map, "EUR", usdAt092)[0]!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    const c = buildEntries(doubleEntry([{ ...day[2]!, description: "Figma seat (renamed)" }]), map, "EUR", usdAt092)[0]!;
    expect(c.jeNumber).toBe(a.jeNumber);
    expect(c.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it("maps our chart to T:0 account types", () => {
    expect(codes.map((c) => [c, t0AccountType(c)])).toEqual(codes.map((c) => [c, expect.any(String)]));
    expect(["1200", "1210", "1220", "1590", "2900", "3000", "4100", "5000", "6200", "6900"].map(t0AccountType))
      .toEqual(["bank", "bank", "bank", "other_current_assets", "other_current_liabilities", "equity", "income", "cost_of_goods_sold", "cost_of_goods_sold", "expenses"]);
  });
});

// Airwallex, deeper (src/proof/awxDeepLive.ts, npm run airwallex:deep): each new capability on fakes (its refusals and
// edge cases), then the whole run on its in-memory stand-in, a refused endpoint kept not live, and the record the
// coverage report reads. No network.

import { describe, expect, it } from "vitest";
import { matchReceipt, openReceivable } from "../src/agents/receivables.js";
import { checkContinuity, listBalanceHistory, matchStatement, movementsFromSoakRecord, toBalanceLine, type BalanceLine } from "../src/airwallex/balanceHistory.js";
import { cardAuthorizations, cardRemainingLimits, headroom, toRemaining } from "../src/airwallex/cardHeadroom.js";
import { closeUnusedGlobalAccount, findArrival, listGlobalAccountTransactions, receiptOf, toGaTransaction } from "../src/airwallex/globalAccountTx.js";
import { createInvoiceLink, linkDifferences, retireLink, toLink } from "../src/airwallex/paymentLinks.js";
import { createScheduledTransfer, revokeScheduledTransfer, transferBody, validateTransfer } from "../src/airwallex/transferRevoke.js";
import { AirwallexError } from "../src/airwallex/client.js";
import { liveRefusals } from "../src/cli/airwallexDeep.js";
import { openDb } from "../src/db/open.js";
import { recordMentions } from "../src/proof/awxCoverage.js";
import { deepMarkdownRecord, deepNotingFetch, deepRecord, deepStandInFetch, NEW_ENDPOINTS, runDeepCheck, type DeepLine } from "../src/proof/awxDeepLive.js";

/** A fake `call`: each "METHOD /path" answers from the map (a function of body and query); every call is noted. */
function fake(routes: Record<string, (body: unknown, q: Record<string, string>) => unknown>) {
  const calls: { method: string; path: string; body: unknown; q: Record<string, string> }[] = [];
  return {
    calls,
    call: async <T>(method: "GET" | "POST", path: string, body?: unknown, q: Record<string, string> = {}): Promise<T> => {
      calls.push({ method, path, body, q });
      const r = routes[`${method} ${path}`];
      if (!r) throw new Error(`no route ${method} ${path}`);
      return r(body, q) as T;
    },
  };
}

const line = (o: Partial<BalanceLine> & Pick<BalanceLine, "amountCents" | "balanceCents">): BalanceLine => ({ id: o.id ?? "x", currency: o.currency ?? "EUR", feeCents: 0, source: o.source ?? null, sourceType: o.sourceType ?? "PAYOUT", transactionType: o.transactionType ?? "PAYOUT", postedAt: o.postedAt ?? "2026-11-19T08:50:00+0000", description: "", ...o });
const SHA = "a".repeat(64);

describe("balance history", () => {
  it("reads every page by its cursor and refuses a window the wrong way round", async () => {
    const api = fake({ "GET /balances/history": (_b, q) => (q.page ? { items: [{ id: "2", currency: "eur", amount: -1, balance: 9 }], has_more: false } : { items: [{ id: "1", currency: "EUR", amount: 10, balance: 10 }], has_more: true, page_after: "CUR" }) });
    const ls = await listBalanceHistory(api, { from: "2026-11-19T08:00:00Z", to: "2026-11-19T09:00:00Z" });
    expect(ls.map((l) => [l.id, l.currency, l.amountCents, l.balanceCents])).toEqual([["1", "EUR", 1000, 1000], ["2", "EUR", -100, 900]]);
    expect(api.calls[1]!.q.page).toBe("CUR");
    await expect(listBalanceHistory(api, { from: "2026-11-19T09:00:00Z", to: "2026-11-19T08:00:00Z" })).rejects.toThrow(/from ≤ to/);
  });
  it("concludes nothing from has_more without a cursor, or a full page without has_more", async () => {
    await expect(listBalanceHistory(fake({ "GET /balances/history": () => ({ items: [], has_more: true }) }), { from: "2026-11-19T08:00:00Z", to: "2026-11-19T09:00:00Z" })).rejects.toThrow(/page_after/);
    const full = Array.from({ length: 100 }, (_, i) => ({ id: String(i), currency: "EUR", amount: 0, balance: 0 }));
    await expect(listBalanceHistory(fake({ "GET /balances/history": () => ({ items: full }) }), { from: "2026-11-19T08:00:00Z", to: "2026-11-19T09:00:00Z" })).rejects.toThrow(/without has_more/);
  });
  it("checks the statement adds up per currency, keeps a same-time pair in the order that adds up, and names a break", () => {
    const ok = checkContinuity([
      line({ id: "a", amountCents: 1000, balanceCents: 1000, postedAt: "2026-11-19T08:49:00+0000" }),
      line({ id: "c", amountCents: -50, balanceCents: 850, postedAt: "2026-11-19T08:50:00+0000" }),
      line({ id: "b", amountCents: -100, balanceCents: 900, postedAt: "2026-11-19T08:50:00+0000" }),
      line({ id: "u", currency: "USD", amountCents: -500, balanceCents: 2000 }),
    ]);
    expect(ok.breaks).toEqual([]);
    expect(ok.currencies.EUR).toEqual({ lines: 3, links: 2, opening: "EUR 0.00", closing: "EUR 8.50" });
    const bad = checkContinuity([line({ id: "a", amountCents: 1000, balanceCents: 1000, postedAt: "2026-11-19T08:49:00+0000" }), line({ id: "b", amountCents: -100, balanceCents: 899 })]);
    expect(bad.breaks).toEqual([{ currency: "EUR", lineId: "b", postedAt: "2026-11-19T08:50:00+0000", expected: "EUR 9.00", actual: "EUR 8.99" }]);
  });
  it("reads a conversion's hold and its release with the sign inverted, as the sandbox books them (19 Nov)", () => {
    // The three USD lines of one soak conversion, as recorded live (docs/runs/2026-11-19-airwallex-deep-2.json).
    const conv = [
      line({ id: "h", currency: "USD", transactionType: "HOLD", sourceType: "CONVERSION", source: "c1", amountCents: 4812, balanceCents: 999458207, postedAt: "2026-11-19T16:49:51+0800" }),
      line({ id: "r", currency: "USD", transactionType: "HOLD_RELEASE", sourceType: "CONVERSION", source: "c1", amountCents: -4812, balanceCents: 999463019, postedAt: "2026-11-19T16:49:51+0800" }),
      line({ id: "s", currency: "USD", transactionType: "CONVERSION_SELL", sourceType: "CONVERSION", source: "c1", amountCents: -4812, balanceCents: 999458207, postedAt: "2026-11-19T16:49:51+0800" }),
    ];
    const c = checkContinuity(conv);
    expect(c.breaks).toEqual([]);
    expect(c.holdLines).toBe(2);
    expect(c.currencies.USD!.opening).toBe("USD 9994630.19");
    const m = matchStatement([{ sourceId: "c1", label: "sold", currency: "USD", amountCents: 4812, direction: "out" }], conv);
    expect(m.matches[0]).toMatchObject({ agrees: true, holdLines: 2, how: "CONVERSION_SELL for exactly the recorded amount" });
  });
  it("matches each recorded movement by source id, currency and sign, to the cent; fees reported beside", () => {
    const lines = [line({ source: "t1", amountCents: -100, balanceCents: 0 }), line({ source: "t1", amountCents: -1350, balanceCents: 0, sourceType: "FEE", transactionType: "FEE" }), line({ source: "t2", amountCents: -99, balanceCents: 0 }), line({ source: "c1", amountCents: 4333, balanceCents: 0, transactionType: "CONVERSION_BUY" }), line({ source: "c1", currency: "USD", amountCents: -4812, balanceCents: 0, transactionType: "CONVERSION_SELL" })];
    const m = matchStatement(movementsFromSoakRecord({ payments: [
      { invoice_no: "A", amount: "1.00", currency: "EUR", transfer_id: "t1", status_after_execute: "PAID", conversion: { conversion_id: "c1", buy: "43.33", sell: "48.12" } },
      { invoice_no: "B", amount: "1.00", currency: "EUR", transfer_id: "t2", status_after_execute: "PAID" },
      { invoice_no: "C", amount: "1.00", currency: "EUR", transfer_id: "t3", status_after_execute: "PAID" },
      { invoice_no: "D", amount: "1.00", currency: "EUR", transfer_id: "t4", status_after_execute: "FAILED" },
    ] }), lines);
    expect(m.checked).toBe(5);
    expect(m.agree).toBe(3);
    expect(m.matches.find((x) => x.label === "A payout")).toMatchObject({ agrees: true, feeLines: "1 fee line(s): EUR -13.50" });
    expect(m.matches.find((x) => x.label === "B payout")).toMatchObject({ agrees: false, how: "amounts differ" });
    expect(m.matches.find((x) => x.label === "C payout")).toMatchObject({ agrees: false, how: "not on the statement in this window" });
    // A credit where a debit is due is a difference.
    expect(matchStatement([{ sourceId: "t9", label: "x", currency: "EUR", amountCents: 100, direction: "out" }], [line({ source: "t9", amountCents: 100, balanceCents: 0 })]).agree).toBe(0);
  });
  it("refuses an amount finer than a cent", () => {
    expect(() => toBalanceLine({ id: "x", amount: 1.234, balance: 0 })).toThrow(/finer than a cent/);
  });
});

describe("an agent card's headroom", () => {
  it("reads the remaining limits and the holds, and agrees with the limits Purser set", async () => {
    const api = fake({
      "GET /issuing/cards/c1/limits": () => ({ currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION", remaining: 50 }, { amount: 200, interval: "MONTHLY", remaining: 155 }] }),
      "GET /issuing/authorizations": () => ({ items: [{ transaction_id: "a", status: "PENDING", billing_currency: "EUR", billing_amount: -19.99 }, { transaction_id: "b", status: "CLEARED", billing_currency: "EUR", billing_amount: -25 }], has_more: false }),
    });
    const h = headroom(await cardRemainingLimits(api, "c1"), await cardAuthorizations(api, "c1", { from: "a", to: "b" }), { perTransactionCents: 5000, monthlyCents: 20000 });
    expect(h).toEqual({ currency: "EUR", intervals: [{ interval: "PER_TRANSACTION", limit: "EUR 50.00", remaining: "EUR 50.00", used: "EUR 0.00" }, { interval: "MONTHLY", limit: "EUR 200.00", remaining: "EUR 155.00", used: "EUR 45.00" }], spendable: "EUR 50.00", pendingHolds: { count: 1, total: "EUR 19.99" }, disagreements: [] });
    expect(api.calls[1]!.q.card_id).toBe("c1");
  });
  it("names a limit Airwallex holds that is not Purser's, a missing one, and a remaining above its limit", () => {
    const h = headroom(toRemaining({ currency: "EUR", limits: [{ amount: 60, interval: "PER_TRANSACTION", remaining: 70 }] }), [], { perTransactionCents: 5000, monthlyCents: 20000 });
    expect(h.disagreements).toEqual(["PER_TRANSACTION: Airwallex shows EUR 70.00 remaining of a EUR 60.00 limit", "PER_TRANSACTION: Purser set EUR 50.00; Airwallex holds EUR 60.00", "MONTHLY: Purser set EUR 200.00; Airwallex shows no such limit"]);
  });
  it("refuses to half-read more than one page of holds", async () => {
    await expect(cardAuthorizations(fake({ "GET /issuing/authorizations": () => ({ items: [], has_more: true }) }), "c1", { from: "a", to: "b" })).rejects.toThrow(/narrow/);
  });
});

describe("a payment link for one open receivable", () => {
  const inv = { invoice_no: "NW-AR-1", customer: "Alpenhof Sport AG", currency: "EUR", amount_cents: 31250, due_date: "2026-12-19" };
  it("asks for a single-use, fixed-amount link with the invoice as reference, and reads it back as that invoice", async () => {
    const api = fake({ "POST /pa/payment_links/create": (b) => ({ id: "plink_1", active: true, ...(b as object) }) });
    const l = await createInvoiceLink(api, inv, new Date("2026-11-19T10:00:00Z"));
    expect(api.calls[0]!.body).toMatchObject({ reusable: false, amount: 312.5, currency: "EUR", reference: "NW-AR-1", metadata: { invoice_no: "NW-AR-1" } });
    expect(linkDifferences(l, inv)).toEqual([]);
    expect(linkDifferences(toLink({ id: "x", amount: 312.49, currency: "USD", reference: "NW-AR-2", reusable: true }), inv)).toHaveLength(4);
  });
  it("refuses a past due date or no amount, and keeps the link on while the invoice is open", async () => {
    const api = fake({ "POST /pa/payment_links/x/deactivate": () => ({ id: "x", active: false }) });
    await expect(createInvoiceLink(api, { ...inv, due_date: "2026-11-01" }, new Date("2026-11-19T10:00:00Z"))).rejects.toThrow(/has passed/);
    await expect(createInvoiceLink(api, { ...inv, amount_cents: 0 }, new Date("2026-11-19T10:00:00Z"))).rejects.toThrow(/positive/);
    await expect(retireLink(api, "x", "OPEN")).rejects.toThrow(/still open/);
    expect((await retireLink(api, "x", "PAID")).active).toBe(false);
    expect(api.calls).toHaveLength(1);
  });
});

describe("money in on a Global Account", () => {
  it("finds exactly one arrival and the receivables agent matches it to the open invoice", async () => {
    const api = fake({ "GET /global_accounts/g1/transactions": () => ({ items: [
      { id: "t1", type: "DEPOSIT", status: "SETTLED", currency: "EUR", amount: 312.5, payer_name: "Alpenhof Sport AG", description: "Alpenhof Sport AG NW-AR-1", create_time: "2026-11-19T10:00:00Z" },
      { id: "t2", type: "DEPOSIT", status: "SETTLED", currency: "EUR", amount: 312.5, payer_name: "Someone else", description: "other", create_time: "2026-11-19T10:00:00Z" },
    ], has_more: false }) });
    const txs = await listGlobalAccountTransactions(api, "g1", { from: "2026-11-19T09:00:00Z", to: "2026-11-19T11:00:00Z" });
    const f = findArrival(txs, { currency: "EUR", amountCents: 31250, reference: "NW-AR-1", payer: "Alpenhof Sport AG" });
    expect(f.tx?.id).toBe("t1");
    const db = openDb(":memory:");
    openReceivable(db, { invoice_no: "NW-AR-1", customer: "Alpenhof Sport AG", currency: "EUR", amount_cents: 31250, due_date: "2026-12-19" });
    expect(matchReceipt(db, receiptOf("g1", f.tx!, f.tx!.description)).outcome).toBe("MATCHED");
  });
  it("chooses none when two arrivals fit, or none does", () => {
    const t = toGaTransaction({ id: "a", currency: "EUR", amount: 1, payer_name: "P", description: "R" });
    expect(findArrival([t, { ...t, id: "b" }], { currency: "EUR", amountCents: 100, reference: "R", payer: "P" }).tx).toBeNull();
    expect(findArrival([t], { currency: "EUR", amountCents: 101, reference: "R", payer: "P" }).tx).toBeNull();
  });
  it("closes only an ACTIVE account it was told to, never one money arrives on, and reads it back", async () => {
    let status = "ACTIVE";
    const api = fake({ "GET /global_accounts/aud": () => ({ id: "aud", status, required_features: [{ currency: "AUD" }] }), "POST /global_accounts/aud/close": () => { status = "CLOSED"; return {}; } });
    await expect(closeUnusedGlobalAccount(api, "aud", ["aud"])).rejects.toThrow(/arrives on/);
    expect(await closeUnusedGlobalAccount(api, "aud", ["eur"])).toEqual({ before: { id: "aud", status: "ACTIVE", currencies: ["AUD"] }, after: { id: "aud", status: "CLOSED", currencies: ["AUD"] } });
    await expect(closeUnusedGlobalAccount(api, "aud", [])).rejects.toThrow(/not ACTIVE; nothing was closed/);
  });
});

describe("terms validated before the signature; a scheduled payment withdrawn", () => {
  const t = { requestId: "r1", beneficiaryId: "b1", amountCents: 100, currency: "EUR", reference: "X", reason: "professional_business_services", approvalSha256: SHA, transferDate: "2026-11-22" };
  it("validates and creates with the same body, so what Airwallex checked is what is sent", async () => {
    const api = fake({ "POST /transfers/validate": () => ({}), "POST /transfers/create": () => ({ id: "tr1", status: "SCHEDULED", transfer_amount: 1, transfer_currency: "EUR", transfer_date: "2026-11-22" }) });
    await validateTransfer(api, t);
    const s = await createScheduledTransfer(api, t, new Date("2026-11-19T10:00:00Z"));
    expect(s.status).toBe("SCHEDULED");
    expect(api.calls[0]!.body).toEqual(api.calls[1]!.body);
    expect(api.calls[0]!.body).toMatchObject({ transfer_amount: "1.00", transfer_date: "2026-11-22", metadata: { approval_sha256: SHA } });
  });
  it("refuses a schedule for today, a bad date, and terms without their hash", async () => {
    const api = fake({});
    await expect(createScheduledTransfer(api, { ...t, transferDate: "2026-11-19" }, new Date("2026-11-19T10:00:00Z"))).rejects.toThrow(/later day/);
    expect(() => transferBody({ ...t, transferDate: "22/11/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => transferBody({ ...t, approvalSha256: "nope" })).toThrow(/hash/);
    expect(api.calls).toHaveLength(0);
  });
  it("cancels only a SCHEDULED transfer, reading it first and after", async () => {
    let status = "SCHEDULED";
    const api = fake({ "GET /transfers/tr1": () => ({ id: "tr1", status }), "POST /transfers/tr1/cancel": () => { status = "CANCELLED"; return "OK"; } });
    const r = await revokeScheduledTransfer(api, "tr1");
    expect([r.before.status, r.after.status]).toEqual(["SCHEDULED", "CANCELLED"]);
    expect(r.cancelAnswer).toBe("2xx");
    // The cancel carries no body (with {} the sandbox answered 400 service_unavailable on 19 Nov).
    expect(api.calls.find((c) => c.path.endsWith("/cancel"))!.body).toBeUndefined();
    status = "PROCESSING";
    await expect(revokeScheduledTransfer(api, "tr1")).rejects.toThrow(/not SCHEDULED/);
    expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(1);
  });
  it("reads back after a refused cancel: cancelled anyway is reported with the refusal; still scheduled, the refusal stands", async () => {
    let status = "SCHEDULED";
    let cancels = false;
    const api = fake({ "GET /transfers/tr1": () => ({ id: "tr1", status }), "POST /transfers/tr1/cancel": () => { if (cancels) status = "CANCELLED"; throw new AirwallexError(400, "service_unavailable", {}, "/transfers/tr1/cancel"); } });
    await expect(revokeScheduledTransfer(api, "tr1")).rejects.toThrow(/400 service_unavailable/);
    cancels = true;
    expect(await revokeScheduledTransfer(api, "tr1")).toMatchObject({ before: { status: "SCHEDULED" }, after: { status: "CANCELLED" }, cancelAnswer: "400 service_unavailable" });
  });
});

const SOAK = { payments: [{ invoice_no: "BTX-SOAK-01", amount: "1.00", currency: "EUR", transfer_id: "a63888f6-3388-498e-993f-d2efbb64b578", status_after_execute: "PAID", conversion: null }] };

async function run(o: Parameters<typeof deepStandInFetch>[0] = {}) {
  const lines: DeepLine[] = [];
  const known = new Set<string>();
  const out = await runDeepCheck({ cfg: { clientId: "stand-in", apiKey: "stand-in", fetchImpl: deepNotingFetch(deepStandInFetch(o), lines, known), minGapMs: 0 }, lines, known, runId: "20261119120000", db: openDb(":memory:"), soak: SOAK, sleep: async () => {}, now: () => new Date("2026-11-19T12:00:00Z") });
  const rec = deepRecord(out.rows, out.facts, lines, { ranAt: "2026-11-19T12:00:00.000Z", budget: 40, used: lines.length });
  const live = new Set(recordMentions(JSON.parse(JSON.stringify(rec)), "docs/runs/2026-11-19-airwallex-deep.json").map((m) => `${m.method} ${m.path}`));
  return { ...out, lines, rec, live };
}

describe("the deep run on the stand-in", () => {
  it("runs every capability, calls every new endpoint, and the coverage report counts each as live", async () => {
    const { rows, facts, rec, live, lines } = await run();
    expect(rec.totals).toMatchObject({ new_endpoints: NEW_ENDPOINTS.length, new_endpoints_live: NEW_ENDPOINTS.length, refused: 0 });
    for (const e of NEW_ENDPOINTS) expect(live.has(e), e).toBe(true);
    expect(rows.every((r) => r.live)).toBe(true);
    expect(facts.revoke).toMatchObject({ validated: true, before: "SCHEDULED", after: "CANCELLED" });
    expect(facts.receivable).toMatchObject({ matched: { outcome: "MATCHED" }, link: { differences: [], active_at_create: true, active_after: false } });
    expect(facts.card?.headroom.disagreements).toEqual([]);
    expect(facts.statement).toMatchObject({ lines: 2, checked: 1, agree: 1 });
    expect(facts.cleanup).toEqual({ global_account_id: "9d19f0a2-983e-4ea5-8420-23f3acadc71c", before: "ACTIVE", after: "CLOSED" });
    // Every line carries Airwallex's request id; no id outside the folded templates (the link id is folded too).
    expect(lines.every((l) => l.awx_request_id)).toBe(true);
    expect(lines.some((l) => l.endpoint.includes("plink_"))).toBe(false);
    const md = deepMarkdownRecord(rec, "2026-11-19");
    expect(md).toContain("11 of 11 new endpoints answered 2xx");
    expect(md).toContain("simulation endpoint (POST /simulation/deposit/create)");
    expect(JSON.stringify(rec)).not.toMatch(/stand-in-token|x-api-key|Bearer/);
  });
  it("keeps a refused endpoint not live, with Airwallex's code, and goes on with the rest", async () => {
    const { rows, rec, live, facts } = await run({ refuse: { "GET /issuing/cards/{id}/limits": { status: 403, code: "forbidden" }, "POST /transfers/{id}/cancel": { status: 400, code: "invalid_argument" } } });
    expect(rows.find((r) => r.endpoint === "/issuing/cards/{id}/limits")).toMatchObject({ live: false, http_status: 403, error_code: "forbidden" });
    expect(live.has("GET /issuing/cards/{id}/limits")).toBe(false);
    expect(live.has("POST /transfers/{id}/cancel")).toBe(false);
    expect(facts.card).toBeNull();
    expect(facts.revoke?.after).toBeNull();
    expect(rec.totals.new_endpoints_live).toBe(NEW_ENDPOINTS.length - 2);
    expect(facts.cleanup?.after).toBe("CLOSED");
  });
  it("refuses a live run without its go, budget and log", () => {
    expect(liveRefusals({})).toHaveLength(2);
    expect(liveRefusals({ DEEP_GO: "yes", AIRWALLEX_CALL_BUDGET: "61", AIRWALLEX_CALL_LOG: "/tmp/x" })).toEqual(["AIRWALLEX_CALL_BUDGET a whole number from 1 to 60"]);
    expect(liveRefusals({ DEEP_GO: "yes", AIRWALLEX_CALL_BUDGET: "40", AIRWALLEX_CALL_LOG: "/tmp/x", AIRWALLEX_PLATFORM: "on" })).toHaveLength(1);
    expect(liveRefusals({ DEEP_GO: "yes", AIRWALLEX_CALL_BUDGET: "40", AIRWALLEX_CALL_LOG: "/tmp/x" })).toEqual([]);
  });
});

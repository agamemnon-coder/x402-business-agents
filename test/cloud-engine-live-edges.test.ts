// The engine's three locks in front of Airwallex, at their edges (cloud/src/engine/livePayout.ts, liveFx.ts, awxGuard.ts):
// what a payout asks for from terms that lack a currency, a reference or a hash; what the sandbox's simulation answers
// when the binding is missing, switched off, slow, unsure or wrong; a live quote kept while it is good and a failure not
// asked again for a minute; and the guard failing closed when its switches cannot be read. Stand-in sources only.
import { describe, expect, it } from "vitest";
import { cloudGuard } from "../cloud/src/engine/awxGuard.js";
import { liveFxRail, withLiveFx, type FxQuoteNote, type LiveFxAnswer, type LiveFxSource } from "../cloud/src/engine/liveFx.js";
import { sandboxPayout, simulatePayout, withAlonePayout, type PayoutAnswerIn, type PayoutNote, type PayoutSource, type SimulateIn } from "../cloud/src/engine/livePayout.js";
import { sqliteSql } from "../cloud/src/node.js";
import type { Sql } from "../cloud/src/store.js";
import { ActCapReached } from "../src/airwallex/routedRail.js";
import { useDocStore } from "../src/ap/docStore.js";
import { openDb, type DB } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { standInBank } from "../src/engine/standInBank.js";

const SHA = "e".repeat(64);
const TID = "4074d684-4704-406c-a527-2832753baf4f";

/** A ledger with the engine's tables (its audit log among them), and a note store. */
function ledger() {
  const db = openDb(":memory:");
  useDocStore(db, { put: (sha) => `mem:${sha}`, get: () => Buffer.alloc(0) });
  const bank = standInBank({ load: () => null, save: () => {} });
  new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, rp: { rpId: "x.invalid", origin: "https://x.invalid" }, company: { name: "Edge Co", lang: "en" }, vault: null, feed: null });
  const notes = new Map<string, string>();
  const keep = { get: (id: string) => notes.get(id) ?? null, set: (id: string, n: string) => { notes.set(id, n); } };
  const log = (event: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
  return { db, notes, keep, log };
}

const source = (payout: PayoutSource["payout"], payoutSimulate: PayoutSource["payoutSimulate"] = async () => ({ ok: false, reason: "no_transfer" })): PayoutSource & { asked: unknown[] } => {
  const asked: unknown[] = [];
  return { asked, payout: async (a) => { asked.push(a); return payout(a); }, payoutSimulate: async (a) => { asked.push(a); return payoutSimulate(a); } };
};
const live = (a: { amount: string; currency: string }): PayoutAnswerIn => ({ ok: true, transfer_id: TID, status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: "r-1" });

describe("the sandbox payout's ask", () => {
  it("takes the reference, else the proposal's id, else nothing; printable ASCII only, at most 140 characters", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ amount: "10.00", currency: "EUR", reference: "INV-1", proposal_id: "P-1" }, "INV-1"],
      [{ amount: "10.00", currency: "EUR", reference: "", proposal_id: "P-1" }, "P-1"],
      [{ amount: "10.00", currency: "EUR" }, ""],
      [{ amount: "10.00", currency: "EUR", reference: `Rechnung für ${"x".repeat(200)}` }, `Rechnung f?r ${"x".repeat(127)}`],
    ];
    for (const [terms, reference] of cases) {
      const l = ledger();
      const s = source(async (a) => live(a));
      await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: s, allowed: async () => true, db: l.db, keep: l.keep });
      expect((s.asked[0] as { reference: string }).reference).toBe(reference);
    }
  });

  it("asks nothing for terms without a currency or with a hash that is not one: bad_request, kept and logged", async () => {
    for (const [terms, sha] of [[{ amount: "10.00" }, SHA], [{ amount: "10.00", currency: 978 }, SHA], [{ amount: "10.00", currency: "EUR" }, "not-a-hash"]] as const) {
      const l = ledger();
      const s = source(async () => { throw new Error("must not be asked"); });
      const note = await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: sha, terms, source: s, allowed: async () => true, db: l.db, keep: l.keep });
      expect(note).toEqual({ source: "simulated", reason: "bad_request", terms_sha256: sha });
      expect(s.asked).toEqual([]);
      expect(l.notes.size).toBe(1);
      expect(l.log("airwallex.payout_skipped")).toEqual([{ reason: "bad_request" }]);
    }
  });

  it("no binding, or a switch that cannot be read: labelled and kept; no answer, or a throw: labelled and asked again next time", async () => {
    const terms = { amount: "10.00", currency: "EUR" };
    const l = ledger();
    expect(await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: null, allowed: async () => true, db: l.db, keep: l.keep })).toMatchObject({ reason: "no_binding" });
    const l2 = ledger();
    expect(await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: source(async (a) => live(a)), allowed: async () => { throw new Error("D1 is away"); }, db: l2.db, keep: l2.keep })).toMatchObject({ reason: "switched_off" });
    const l3 = ledger();
    expect(await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: source(async () => null as unknown as PayoutAnswerIn), allowed: async () => true, db: l3.db, keep: l3.keep })).toMatchObject({ reason: "bad_answer" });
    const l4 = ledger();
    const thrown = await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: source(async () => { throw new Error("binding failed"); }), allowed: async () => true, db: l4.db, keep: l4.keep });
    expect(thrown).toMatchObject({ reason: "unavailable" });
    expect(l4.notes.size).toBe(0);
    // An answer whose status or id is not one Airwallex gives is not taken.
    for (const odd of [{ ...live(terms), status: "in approval" }, { ...live(terms), transfer_id: "x" }, { ...live(terms), transfer_id: 5 }]) {
      const l5 = ledger();
      expect(await sandboxPayout({ company: "t_try_a", proposalId: "P-1", termsSha256: SHA, terms, source: source(async () => odd as PayoutAnswerIn), allowed: async () => true, db: l5.db, keep: l5.keep })).toMatchObject({ reason: "bad_answer" });
    }
  });
});

describe("the agent's own payment within the limit, asked of the sandbox", () => {
  const note: PayoutNote = { source: "simulated", reason: "switched_off", terms_sha256: SHA };
  const terms = () => ({ terms_sha256: SHA, terms: { amount: "1.00" } });
  it("only an executed payment paid alone is asked; anything else is returned as it is", async () => {
    let asked = 0;
    const payout = async () => { asked++; return note; };
    const refused = { ok: false, reason: "held" };
    expect(await withAlonePayout(refused, terms, payout)).toBe(refused);
    const filed = { ok: true, proposal: { id: "P-1", status: "PENDING_APPROVAL" } };
    expect(await withAlonePayout(filed, terms, payout)).toBe(filed);
    const pending = { ok: true, alone: { limit: "500.00" }, proposal: { id: "P-1", status: "PENDING_APPROVAL" } };
    expect(await withAlonePayout(pending, terms, payout)).toBe(pending);
    const noProposal = { ok: true, alone: { limit: "500.00" } };
    expect(await withAlonePayout(noProposal, terms, payout)).toBe(noProposal);
    const executed = { ok: true, alone: { limit: "500.00" }, proposal: { id: "P-1", status: "EXECUTED" } };
    expect(await withAlonePayout(executed, () => null, payout)).toBe(executed);
    expect(asked).toBe(0);
    expect(await withAlonePayout(executed, terms, payout)).toEqual({ ...executed, airwallex_payout: note });
    expect(asked).toBe(1);
  });
});

describe("Sandbox: move to PAID", () => {
  const liveNote: PayoutNote = { source: "airwallex-sandbox", transfer_id: TID, status: "IN_APPROVAL", amount: "10.00", currency: "EUR", request_id: "r-1", terms_sha256: SHA };
  function kept(note: PayoutNote | null) {
    const l = ledger();
    if (note) l.keep.set("P-1", JSON.stringify(note));
    return l;
  }
  const simulate = (l: ReturnType<typeof ledger>, src: PayoutSource | null, o: { allowed?: () => Promise<boolean>; waitMs?: number } = {}) =>
    simulatePayout({ company: "t_try_a", proposalId: "P-1", source: src, allowed: o.allowed ?? (async () => true), db: l.db, keep: l.keep, ...(o.waitMs ? { waitMs: o.waitMs } : {}) });
  const sim = (answer: () => Promise<SimulateIn>) => source(async (a) => live(a), answer);

  it("only for a live transfer; not without the binding or with the switch off or unreadable", async () => {
    const simulated: PayoutNote = { source: "simulated", reason: "switched_off", terms_sha256: SHA };
    expect(await simulate(kept(simulated), sim(async () => ({ ok: true, transfer_id: TID, status: "PAID" })))).toEqual({ ok: false, reason: "no_transfer", note: simulated });
    expect(await simulate(kept(liveNote), null)).toEqual({ ok: false, reason: "no_binding", note: liveNote });
    expect(await simulate(kept(liveNote), sim(async () => ({ ok: true, transfer_id: TID, status: "PAID" })), { allowed: async () => false })).toMatchObject({ reason: "switched_off" });
    expect(await simulate(kept(liveNote), sim(async () => ({ ok: true, transfer_id: TID, status: "PAID" })), { allowed: async () => { throw new Error("D1 is away"); } })).toMatchObject({ reason: "switched_off" });
  });

  it("slow, thrown, an unknown refusal, another transfer or a status that is not one: the note stays as it was", async () => {
    const hang = sim(() => new Promise<SimulateIn>(() => {}));
    expect(await simulate(kept(liveNote), hang, { waitMs: 50 })).toEqual({ ok: false, reason: "timeout", note: liveNote });
    expect(await simulate(kept(liveNote), sim(async () => { throw new Error("binding failed"); }))).toEqual({ ok: false, reason: "unavailable", note: liveNote });
    expect(await simulate(kept(liveNote), sim(async () => ({ ok: false, reason: "something new" })))).toEqual({ ok: false, reason: "unavailable", note: liveNote });
    expect(await simulate(kept(liveNote), sim(async () => ({ ok: true, transfer_id: "5c2f0f43-0000-4000-8000-000000000000", status: "PAID" })))).toEqual({ ok: false, reason: "bad_answer", note: liveNote });
    expect(await simulate(kept(liveNote), sim(async () => ({ ok: true, transfer_id: TID, status: "paid!" })))).toEqual({ ok: false, reason: "bad_answer", note: liveNote });
  });

  it("a refusal that names the transfer's status updates the note and keeps it; one with a malformed status does not", async () => {
    const l = kept(liveNote);
    const r = await simulate(l, sim(async () => ({ ok: false, reason: "in_approval", status: "SCHEDULED" })));
    expect(r).toEqual({ ok: false, reason: "in_approval", note: { ...liveNote, status: "SCHEDULED" } });
    expect(JSON.parse(l.notes.get("P-1")!)).toMatchObject({ status: "SCHEDULED" });
    const l2 = kept(liveNote);
    expect(await simulate(l2, sim(async () => ({ ok: false, reason: "refused", status: "not a status" })))).toEqual({ ok: false, reason: "refused", note: liveNote });
    expect(JSON.parse(l2.notes.get("P-1")!)).toEqual(liveNote);
  });
});

// ---- the live quote ----

interface Q { buyCurrency: string; sellCurrency: string; buyAmountCents: number }
/** The stand-in bank's quote calls, counting what falls back to it; its other members pass through. */
function quotingBank() {
  const fell: string[] = [];
  const bank = {
    quotes: new Map<string, unknown>(),
    label: "the stand-in bank",
    whoAmI() { return this.label; },
    currentRate: async (a: Q) => { fell.push("currentRate"); return { rate: "1.10", sellAmountCents: Math.ceil(a.buyAmountCents * 1.1), at: "2026-11-10T00:00:00Z" }; },
    currentRateAny: async (a: Q) => { fell.push("currentRateAny"); return { rate: "1.10", sellAmountCents: Math.ceil(a.buyAmountCents * 1.1), at: "2026-11-10T00:00:00Z" }; },
    createQuote: async (a: Q & { validity: string }) => { fell.push("createQuote"); return { quoteId: "recorded-1", buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: 1100, clientRate: "1.10", validFrom: "2026-11-10T00:00:00Z", validTo: "2026-11-10T00:15:00Z" }; },
    createQuoteAny: async (a: Q & { validity: string }) => { fell.push("createQuoteAny"); return { quoteId: "recorded-2", buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: 1100, clientRate: "1.10", validFrom: "2026-11-10T00:00:00Z", validTo: "2026-11-10T00:15:00Z" }; },
  };
  return { bank: bank as unknown as QuotingBankWithMore, fell };
}
/** The bank liveFxRail takes, with the stand-in's own members beside its quote calls. */
type QuotingBankWithMore = Parameters<typeof liveFxRail>[0] & { label: string; whoAmI(): string };
const ASK: Q = { buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 1000 };
const goodAnswer = (now: number): LiveFxAnswer => ({ ok: true, market_rate: "1.1000", quote: { quote_id: "cc8fb106-29bb-3cce-b011-5fd0b4685617", buy_currency: "EUR", sell_currency: "USD", buy_amount: "10.00", sell_amount: "11.05", client_rate: "1.1050", valid_to_at: new Date(now + 15 * 60_000).toISOString() } });

describe("the live quote", () => {
  it("live: the market rate and the quote are Airwallex's, the quote is the bank's own to convert at, and it is kept while it has a minute left", async () => {
    let clock = Date.parse("2026-11-10T09:00:00Z");
    const { bank, fell } = quotingBank();
    const asked: unknown[] = [];
    const notes: FxQuoteNote[] = [];
    const src: LiveFxSource = { quote: async (a) => { asked.push(a); return goodAnswer(clock); } };
    const rail = liveFxRail(bank, { company: "t_try_a", source: src, allowed: async () => true, onQuote: (n) => notes.push(n), now: () => clock });
    expect(await rail.currentRateAny(ASK)).toEqual({ rate: "1.1000", sellAmountCents: 1100, at: new Date(clock).toISOString() });
    const q = await rail.createQuoteAny({ ...ASK, validity: "15m" });
    expect(q).toMatchObject({ quoteId: "cc8fb106-29bb-3cce-b011-5fd0b4685617", sellAmountCents: 1105, clientRate: "1.1050" });
    expect(bank.quotes.get(q.quoteId)).toBe(q);
    expect(notes).toEqual([expect.objectContaining({ source: "airwallex-sandbox", market_rate: "1.1000", sell_amount: "11.05", buy_amount: "10.00" })]);
    expect(asked).toHaveLength(1);
    // 13 minutes later the same quote is still kept; 15 minutes later it is asked again.
    clock += 13 * 60_000;
    await rail.createQuote({ ...ASK, validity: "15m" });
    expect(asked).toHaveLength(1);
    clock += 2 * 60_000;
    await rail.currentRate(ASK);
    expect(asked).toHaveLength(2);
    expect(fell).toEqual([]);
    // The rest of the bank passes through, bound to it.
    expect(rail.label).toBe("the stand-in bank");
    expect((rail.whoAmI as () => string)()).toBe("the stand-in bank");
  });

  it("no binding, a switch that cannot be read, no answer, an amount that is not cents: the bank's own quote, and a failure is not asked again for a minute", async () => {
    let clock = Date.parse("2026-11-10T09:00:00Z");
    const none = quotingBank();
    const notes: FxQuoteNote[] = [];
    const r0 = liveFxRail(none.bank, { company: "t_try_a", source: null, allowed: async () => true, onQuote: (n) => notes.push(n), now: () => clock });
    await r0.createQuoteAny({ ...ASK, validity: "15m" });
    expect(notes.at(-1)).toMatchObject({ source: "recorded", reason: "no_binding", quote_id: "recorded-2" });
    expect(none.fell).toEqual(["createQuoteAny"]);

    const asked: unknown[] = [];
    const unread = quotingBank();
    const r1 = liveFxRail(unread.bank, { company: "t_try_a", source: { quote: async (a) => { asked.push(a); return goodAnswer(clock); } }, allowed: async () => { throw new Error("D1 is away"); }, onQuote: (n) => notes.push(n), now: () => clock });
    await r1.createQuote({ ...ASK, validity: "15m" });
    expect(notes.at(-1)).toMatchObject({ reason: "switched_off" });
    expect(asked).toEqual([]);

    let answer: LiveFxAnswer = null as unknown as LiveFxAnswer;
    const odd = quotingBank();
    const calls: unknown[] = [];
    const r2 = liveFxRail(odd.bank, { company: "t_try_a", source: { quote: async (a) => { calls.push(a); return answer; } }, allowed: async () => true, onQuote: (n) => notes.push(n), now: () => clock });
    await r2.createQuoteAny({ ...ASK, validity: "15m" });
    expect(notes.at(-1)).toMatchObject({ reason: "bad_answer" });
    // Within the minute: not asked again. After it: asked again, now with a sell amount that is not cents.
    clock += 30_000;
    await r2.currentRateAny(ASK);
    expect(calls).toHaveLength(1);
    clock += 31_000;
    const g = goodAnswer(clock) as Extract<LiveFxAnswer, { ok: true }>;
    answer = { ...g, quote: { ...g.quote, sell_amount: "11.5" } };
    await r2.createQuoteAny({ ...ASK, validity: "15m" });
    expect(calls).toHaveLength(2);
    expect(notes.at(-1)).toMatchObject({ reason: "bad_answer" });
    expect(odd.fell).toEqual(["createQuoteAny", "currentRateAny", "createQuoteAny"]);
  });

  it("the note on the terms: only for terms whose conversion names a quote that was kept", async () => {
    const l = ledger();
    const { bank } = quotingBank();
    const keep = new Map<string, string>();
    const fx = withLiveFx(bank as never, { company: "t_try_a", source: { quote: async () => ({ ok: false, reason: "timeout" }) }, allowed: async () => true, db: l.db as DB, keep: { get: (id) => keep.get(id) ?? null, set: (id, n) => { keep.set(id, n); } } });
    const q = await (fx.rail as unknown as ReturnType<typeof quotingBank>["bank"]).createQuoteAny({ ...ASK, validity: "15m" });
    expect(fx.noteFor({ conversion: { quote_id: q.quoteId } })).toMatchObject({ source: "recorded", reason: "timeout" });
    expect(l.log("airwallex.unavailable")).toEqual([expect.objectContaining({ reason: "timeout", client_rate: "1.10" })]);
    for (const terms of [null, "terms", { conversion: null }, { conversion: { quote_id: 5 } }, { conversion: { quote_id: "never-kept" } }]) expect(fx.noteFor(terms)).toBeNull();
  });
});

// ---- the guard ----

describe("the Cloud's guard when its switches cannot be read", () => {
  /** The cloud's database with try_switches readable until `broken` is set. */
  async function db() {
    const sql = sqliteSql(":memory:");
    await sql.exec("CREATE TABLE try_switches (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
    for (const [k, v] of [["awx_act", "on"], ["awx_act_company_cents_day", "5000"], ["awx_act_global_cents_day", "8000"]]) await sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, '')", [k!, v!]);
    const state = { broken: false, reads: 0 };
    const wrapped: Sql = { ...sql, all: async (q, p) => { if (/try_switches/.test(q)) { state.reads++; if (state.broken) throw new Error("D1 is away"); } return sql.all(q, p); } };
    return { sql: wrapped, state, close: () => sql.close() };
  }

  it("blocks Airwallex and sends nothing: the switches unreadable, the caps unreadable; caps() then say 0", async () => {
    const d = await db();
    d.state.broken = true;
    const g = cloudGuard({ sql: d.sql, tenantId: "t_a", gateway: true, cacheMs: 0 });
    expect(await g.blocked()).toBe("the switches could not be read");
    await expect(g.spend({ key: "r1", kind: "transfer", currency: "EUR", cents: 100 })).rejects.toThrow(ActCapReached);
    await expect(g.spend({ key: "r1", kind: "transfer", currency: "EUR", cents: 100 })).rejects.toThrow("the caps could not be read; nothing is sent");
    expect(await g.caps()).toMatchObject({ company_cents_day: 0, global_cents_day: 0, company_used_cents: 0, global_used_cents: 0 });
    d.close();
  });

  it("refuses an amount that is not a whole number of cents above zero before reading anything", async () => {
    const d = await db();
    const g = cloudGuard({ sql: d.sql, tenantId: "t_a", gateway: true, cacheMs: 0 });
    for (const cents of [0, -5, 1.5, Number.NaN]) await expect(g.spend({ key: "r", kind: "transfer", currency: "EUR", cents })).rejects.toThrow("an amount above zero is needed");
    expect(d.state.reads).toBe(0);
    d.close();
  });

  it("keeps a read of the switches for five seconds by default: the kill switch takes effect within that", async () => {
    const d = await db();
    let clock = Date.parse("2026-11-10T09:00:00Z");
    const g = cloudGuard({ sql: d.sql, tenantId: "t_a", gateway: true, now: () => new Date(clock) });
    expect(await g.blocked()).toBeNull();
    d.state.broken = true;
    clock += 4_000;
    expect(await g.blocked()).toBeNull();
    expect(d.state.reads).toBe(1);
    clock += 1_000;
    expect(await g.blocked()).toBe("the switches could not be read");
    d.close();
  });
});

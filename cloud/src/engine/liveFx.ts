// /try's live FX quote (14 Nov), on the engine's side: the stand-in bank's quote calls, answered by the Airwallex
// sandbox when it answers within LIVE_FX_WAIT_MS. The engine (purser-try) holds no Airwallex key: it asks the kit11
// Worker through a service binding to its AwxFx entrypoint (worker/src/awxFx.ts), which holds the key and the caps.
//
// What changes: when a payment needs currency bought, the quote the engine plans with, and so the terms the visitor's
// passkey signs, are Airwallex's live sandbox quote: its quote id, client rate, amounts and valid-to. Airwallex's own
// rate from the same answer is the market rate the engine checks the quote's markup against. What does not change: the
// conversion and the payment run on the simulated bank (test money), at the quoted amounts; nothing is converted or
// paid at Airwallex.
//
// When Airwallex is off, capped, slow or down, the stand-in's own quote is used (the recorded rate), and the note says
// so: { source: "recorded", reason }. Never a made-up quote.
import type { AnyQuote, MarketRate, Quote } from "../../../src/airwallex/port.js";
import { audit } from "../../../src/audit/log.js";
import type { DB } from "../../../src/db/open.js";

/** How long the engine waits for Airwallex before it uses the recorded rate. */
export const LIVE_FX_WAIT_MS = 3_000;
/** A failed ask is not repeated for this long (one plan reads the rate, then asks for the quote). */
const FAILED_MEMO_MS = 60_000;

/** The quote as kit11's AwxFx entrypoint answers it (worker/src/awxFx.ts AwxFxAnswer). */
export interface LiveQuote { quote_id: string; sell_currency: string; buy_currency: string; buy_amount: string; sell_amount: string; client_rate: string; valid_to_at: string }
export type LiveFxAnswer = { ok: true; quote: LiveQuote; market_rate: string; cached?: boolean } | { ok: false; reason: string };
export interface LiveFxSource { quote(a: { company: string; buyCurrency: string; sellCurrency: string; buyAmount: string }): Promise<LiveFxAnswer> }

/** Why the recorded rate was used, as a fixed code (the page says it in words). */
export const RECORDED_REASONS = ["switched_off", "no_binding", "no_key", "day_cap", "company_cap", "unavailable", "timeout", "bad_answer", "bad_request"] as const;
export type RecordedReason = (typeof RECORDED_REASONS)[number];

/** What the page shows beside the terms, for a quote in them. */
export interface FxQuoteNote {
  source: "airwallex-sandbox" | "recorded";
  quote_id: string;
  client_rate: string;
  sell_currency: string;
  sell_amount: string;
  buy_currency: string;
  buy_amount: string;
  valid_to: string;
  /** Airwallex's own rate in the same answer (live only). */
  market_rate?: string;
  /** Why the recorded rate was used (recorded only). */
  reason?: RecordedReason;
}

/** The quote calls of the stand-in bank (src/redteam/airwallex.ts FakeAirwallex). */
interface QuotingBank {
  quotes: Map<string, unknown>;
  currentRate(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate>;
  currentRateAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate>;
  createQuote(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }): Promise<Quote>;
  createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }): Promise<AnyQuote>;
}

const amountOf = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const centsOf = (s: string): number | null => (/^\d{1,12}\.\d{2}$/.test(s) ? Number(s.replace(".", "")) : null);
const rateOk = (s: unknown): s is string => typeof s === "string" && /^\d{1,6}(\.\d{1,12})?$/.test(s) && Number(s) > 0;

/** A live answer checked against what was asked: anything off is no live quote, never a guess. */
function checked(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }, ans: LiveFxAnswer): { quote: LiveQuote; market_rate: string } | RecordedReason {
  if (!ans || typeof ans !== "object") return "bad_answer";
  if (!ans.ok) return (RECORDED_REASONS as readonly string[]).includes(ans.reason) ? ans.reason as RecordedReason : "unavailable";
  const q = ans.quote;
  if (!q || typeof q.quote_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(q.quote_id) || q.buy_currency !== a.buyCurrency || q.sell_currency !== a.sellCurrency
    || centsOf(q.buy_amount) !== a.buyAmountCents || centsOf(q.sell_amount) === null || !rateOk(q.client_rate) || !rateOk(ans.market_rate)
    || !Number.isFinite(Date.parse(q.valid_to_at))) return "bad_answer";
  return { quote: q, market_rate: ans.market_rate };
}

/**
 * The bank with its quote calls answered live where it can: the rest of the bank is untouched. `onQuote` hears every
 * quote the engine locks (live or recorded), once, so the host can keep the note and write the step to the log.
 * `allowed` is the deployment's switch (awx_fx), read when a quote is needed.
 */
export function liveFxRail<B extends QuotingBank>(bank: B, o: {
  company: string;
  source: LiveFxSource | null;
  allowed: () => Promise<boolean>;
  onQuote: (note: FxQuoteNote) => void;
  now?: () => number;
  waitMs?: number;
}): B {
  const now = o.now ?? (() => Date.now());
  const memo = new Map<string, { until: number; got: { quote: LiveQuote; market_rate: string } | RecordedReason }>();

  async function ask(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<{ quote: LiveQuote; market_rate: string } | RecordedReason> {
    const k = `${a.buyCurrency}/${a.sellCurrency}/${a.buyAmountCents}`;
    const kept = memo.get(k);
    if (kept && kept.until > now()) return kept.got;
    let got: { quote: LiveQuote; market_rate: string } | RecordedReason;
    if (!o.source) got = "no_binding";
    else if (!(await o.allowed().catch(() => false))) got = "switched_off";
    else {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), o.waitMs ?? LIVE_FX_WAIT_MS); });
      try {
        const ans = await Promise.race([o.source.quote({ company: o.company, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmount: amountOf(a.buyAmountCents) }), late]);
        got = ans === "timeout" ? "timeout" : checked(a, ans);
      } catch {
        got = "unavailable";
      } finally {
        clearTimeout(timer);
      }
    }
    // A live quote is used while it has a minute left; a failure is not asked again for a minute.
    const until = typeof got === "string" ? now() + FAILED_MEMO_MS : Date.parse(got.quote.valid_to_at) - 60_000;
    memo.set(k, { until, got });
    return got;
  }

  /** The live quote as the bank's own (it converts at these amounts later), or null to use the bank's. */
  function asBankQuote(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }, got: { quote: LiveQuote }): AnyQuote {
    const q = got.quote;
    const quote: AnyQuote = {
      quoteId: q.quote_id, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: centsOf(q.sell_amount)!,
      clientRate: q.client_rate, validFrom: new Date(now()).toISOString(), validTo: new Date(Date.parse(q.valid_to_at)).toISOString(),
    };
    bank.quotes.set(quote.quoteId, quote);
    return quote;
  }

  const rate = (fallback: (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }) => Promise<MarketRate>) =>
    async (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate> => {
      const got = await ask(a);
      if (typeof got === "string") return fallback(a);
      return { rate: got.market_rate, sellAmountCents: Math.ceil(a.buyAmountCents * Number(got.market_rate)), at: new Date(now()).toISOString() };
    };
  const quote = <Q extends Quote | AnyQuote>(fallback: (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }) => Promise<Q>) =>
    async (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }): Promise<Q> => {
      const got = await ask(a);
      const q = typeof got === "string" ? await fallback(a) : (asBankQuote(a, got) as Q);
      o.onQuote({
        source: typeof got === "string" ? "recorded" : "airwallex-sandbox", quote_id: q.quoteId, client_rate: q.clientRate,
        sell_currency: q.sellCurrency, sell_amount: amountOf(q.sellAmountCents), buy_currency: q.buyCurrency, buy_amount: amountOf(q.buyAmountCents), valid_to: q.validTo,
        ...(typeof got === "string" ? { reason: got } : { market_rate: got.market_rate }),
      });
      return q;
    };

  const own = {
    currentRate: rate((a) => bank.currentRate(a)),
    currentRateAny: rate((a) => bank.currentRateAny(a)),
    createQuote: quote<Quote>((a) => bank.createQuote(a)),
    createQuoteAny: quote<AnyQuote>((a) => bank.createQuoteAny(a)),
  } as Record<string, unknown>;
  return new Proxy(bank, {
    get(target, key, receiver) {
      if (typeof key === "string" && Object.hasOwn(own, key)) return own[key];
      const v = Reflect.get(target, key, receiver) as unknown;
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * The engine host's side of it (./hostWorker.ts, ./node.ts): the bank with live quotes for this company, each quote it
 * locks kept as a note by its quote id (`keep`) and written to the audit log as one step (airwallex.quote, or
 * airwallex.unavailable with the code of why); and `noteFor`, the note on a terms' quote, for the page.
 */
export function withLiveFx<B extends QuotingBank>(bank: B, o: {
  company: string; source: LiveFxSource; allowed: () => Promise<boolean>; db: DB; waitMs?: number;
  keep: { get(quoteId: string): string | null; set(quoteId: string, note: string): void };
}): { rail: B; noteFor(terms: unknown): FxQuoteNote | null } {
  const rail = liveFxRail(bank, {
    company: o.company, source: o.source, allowed: o.allowed, ...(o.waitMs ? { waitMs: o.waitMs } : {}),
    onQuote: (note) => {
      o.keep.set(note.quote_id, JSON.stringify(note));
      if (note.source === "airwallex-sandbox") {
        audit(o.db, "treasury", "airwallex.quote", note.quote_id, { quote_id: note.quote_id, client_rate: note.client_rate, market_rate: note.market_rate ?? null, valid_to: note.valid_to, buy: `${note.buy_currency} ${note.buy_amount}`, sell: `${note.sell_currency} ${note.sell_amount}` });
      } else {
        audit(o.db, "treasury", "airwallex.unavailable", note.quote_id, { reason: note.reason ?? "unavailable", client_rate: note.client_rate });
      }
    },
  });
  const noteFor = (terms: unknown): FxQuoteNote | null => {
    const id = terms && typeof terms === "object" ? (terms as { conversion?: { quote_id?: unknown } | null }).conversion?.quote_id : undefined;
    const kept = typeof id === "string" ? o.keep.get(id) : null;
    return kept ? (JSON.parse(kept) as FxQuoteNote) : null;
  };
  return { rail, noteFor };
}

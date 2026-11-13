// A payment plan worked out without leaving a trace (the Payer, early: src/ap/pay.ts earlyPayer). The planning code is
// the one Pay runs (src/payouts/plan.ts, src/agents/euroBill.ts); here it runs on a ledger that only reads and on rails
// that only read. A write to the ledger (an audit row, a balance snapshot, a quote kept) is not made; a bank call that
// is not a read is refused, so nothing is created, converted or paid; and a quote is not locked: the market's current
// rate stands in for it, as an estimate, under an id that says so. Pay plans again, for real, before anything is filed.
import type { AirwallexRail, AnyQuote, MarketRate, PayoutRail, Quote } from "../airwallex/port.js";
import type { DB } from "../db/open.js";

/** A statement that writes: never run on the read-only ledger. */
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|VACUUM|ATTACH|DETACH)\b/i;

/** The quote's id while it is only an estimate. */
export const ESTIMATED_QUOTE = "estimate-not-locked";

/**
 * The ledger, for reading only: a statement that writes runs as nothing (no row changed, nothing returned), exec does
 * nothing, and a transaction runs its function as it is, with the same rules inside. Reads are the ledger's own.
 */
export function readOnlyLedger(db: DB): DB {
  const nothing = {
    run: () => ({ changes: 0, lastInsertRowid: 0 }), get: () => undefined, all: () => [], iterate: () => [][Symbol.iterator](),
    pluck() { return nothing; }, raw() { return nothing; }, expand() { return nothing; }, bind() { return nothing; }, safeIntegers() { return nothing; },
  };
  const ro: DB = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => (WRITES.test(sql) ? nothing : target.prepare(sql));
      if (key === "exec") return () => ro;
      if (key === "pragma") return () => [];
      if (key === "transaction") {
        return (fn: (...a: unknown[]) => unknown) => {
          const run = (...a: unknown[]) => fn(...a);
          return Object.assign(run, { deferred: run, immediate: run, exclusive: run });
        };
      }
      const v = Reflect.get(target, key) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return ro;
}

/** The bank calls planning may make on the probe's rails: reads only (the quotes are replaced by estimates below). */
const READS = new Set(["balances", "balancesAll", "currentRate", "currentRateAny", "findTransferByRequestIdStrict", "findTransferByRequestId", "findPayoutBeneficiary"]);

function estimate<Q extends Quote | AnyQuote>(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }, m: MarketRate): Q {
  const from = Date.parse(m.at);
  const ms = ({ MIN_1: 60_000, MIN_15: 900_000, MIN_30: 1_800_000, HR_1: 3_600_000 } as Record<string, number>)[a.validity] ?? 60_000;
  const at = Number.isFinite(from) ? from : Date.now();
  return {
    quoteId: ESTIMATED_QUOTE, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: m.sellAmountCents,
    clientRate: m.rate, validFrom: new Date(at).toISOString(), validTo: new Date(at + ms).toISOString(),
  } as Q;
}

/**
 * The rails, for reading only: balances, rates and lookups pass; a quote is the market's current rate (no quote is
 * locked at the bank); any other call is refused with an error, so a plan that would need one stops.
 */
export function quoteFreeRail<R extends AirwallexRail & PayoutRail>(rail: R): R {
  return new Proxy(rail, {
    get(target, key) {
      if (key === "createQuote") return async (a: Parameters<AirwallexRail["createQuote"]>[0]) => estimate<Quote>(a, await target.currentRate(a));
      if (key === "createQuoteAny") return async (a: Parameters<PayoutRail["createQuoteAny"]>[0]) => estimate<AnyQuote>(a, await target.currentRateAny(a));
      const v = Reflect.get(target, key) as unknown;
      if (typeof v !== "function") return v;
      if (typeof key === "string" && READS.has(key)) return (v as (...a: unknown[]) => unknown).bind(target);
      return () => { throw new Error(`the probe's rails only read: ${String(key)} is not called`); };
    },
  });
}

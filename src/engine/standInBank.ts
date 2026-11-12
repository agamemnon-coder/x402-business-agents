// The stand-in bank of a company's engine: test money only. It is the in-memory Airwallex the tests and the red team
// use (src/redteam/airwallex.ts), which never reaches Airwallex. A host whose memory can be dropped (a Durable Object)
// keeps the bank's whole state as text in a store of its own, and takes it back from there the next time it starts:
// the balances, quotes, conversions, payees and transfers are then the ones the ledger already knows.
import { FakeAirwallex } from "../redteam/airwallex.js";

/** Where a host keeps the bank's state between two starts (one text value). */
export interface BankStore {
  load(): string | null;
  save(text: string): void;
}

type Fields = Record<string, unknown>;
const isKeptMap = (v: unknown): v is { __map: [unknown, unknown][] } => typeof v === "object" && v !== null && Array.isArray((v as { __map?: unknown }).__map);

/** The bank's whole state as text: every own field that is not a function; a Map as { __map: [...] }. */
export function bankToText(b: FakeAirwallex): string {
  const out: Fields = {};
  for (const [k, v] of Object.entries(b as unknown as Fields)) {
    if (typeof v === "function") continue;
    out[k] = v instanceof Map ? { __map: [...v.entries()] } : v;
  }
  return JSON.stringify(out);
}

/** A bank with the state bankToText wrote. */
export function bankFromText(text: string): FakeAirwallex {
  const bank = new FakeAirwallex();
  for (const [k, v] of Object.entries(JSON.parse(text) as Fields)) {
    // A function field (the bank's clock) is never taken from the text.
    if (typeof (bank as unknown as Fields)[k] === "function") continue;
    (bank as unknown as Fields)[k] = isKeptMap(v) ? new Map(v.__map) : v;
  }
  return bank;
}

/** The company's stand-in bank: the one the store holds, else a new one. The host saves it after it moved money. */
export function standInBank(store: BankStore): FakeAirwallex {
  const kept = store.load();
  return kept ? bankFromText(kept) : new FakeAirwallex();
}

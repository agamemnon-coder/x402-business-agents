// D19 block 3: the Sourcing agent's upstream suppliers, each an x402 seller on Metal testnet. With the autonomous agents
// on there are two, so "which supplier" is a real choice: Stockline is fresh and reliable at its price; Ridgeline Data
// is cheaper or dearer depending on the day, serves data that is minutes old, and is sometimes unavailable (before any
// payment, so an outage costs nothing). Prices live in the ledger's settings, so the world can change them.

export type SupplierId = "stockline" | "ridgeline";

export interface SupplierSpec {
  id: SupplierId;
  name: string;
  port: number;
  keyFile: string;
  /** The setting that holds its price per stock check. */
  priceKey: "upstream_price" | "ridgeline_price";
  defaultPriceCents: number;
  /** How old its data is when served. */
  dataAgeSeconds: number;
  /** Every n-th stock check it is unavailable (503, before any offer); 0: never. */
  unavailableEvery: number;
}

export const SUPPLIERS: Record<SupplierId, SupplierSpec> = {
  stockline: { id: "stockline", name: "Stockline", port: 4101, keyFile: "supplier.key.json", priceKey: "upstream_price", defaultPriceCents: 2, dataAgeSeconds: 5, unavailableEvery: 0 },
  ridgeline: { id: "ridgeline", name: "Ridgeline Data", port: 4103, keyFile: "ridgeline.key.json", priceKey: "ridgeline_price", defaultPriceCents: 3, dataAgeSeconds: 900, unavailableEvery: 6 },
};

/** The most the agent may cache a stock check: customers pay for live data. */
export const MAX_CACHE_SECONDS = 300;
/** The Sourcing agent's goal margin per query. */
export const MIN_MARGIN_CENTS = 1;
/** Customers turned away under the buy policy that, in this window, count as the Sourcing agent being blocked (dry-125). */
export const TURNED_AWAY_MIN = 3;
export const TURNED_AWAY_WINDOW_MS = 15 * 60_000;

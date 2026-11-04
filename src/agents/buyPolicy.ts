// The Sourcing agent's buy policy (D19), as a type with no ledger behind it, so the Worker can use it (D21).
import type { SupplierId } from "../config/suppliers.js";

export interface BuyPolicy {
  /** Whom to buy from; "none": serve from the cache only, or refuse (the customer is not charged). */
  supplier: SupplierId | "none";
  /** The most to pay per stock check under this policy; null: up to the mandate's cap. */
  max_price: string | null;
  /** Serve the last stock check bought for this long instead of buying again (0: always buy). */
  cache_seconds: number;
  set_by?: string;
  reason?: string;
}

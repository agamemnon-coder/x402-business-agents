// D21: the worlds of the variation eval as pure data (no ledger), shared with the public /try page: each world's two
// suppliers as the Sourcing agent sees them, and the event that wakes it there.
import type { SupplierView } from "./sourcingCore.js";

export interface WorldSpec { id: string; stockline: number; ridgeline: number; ridgelineAge: number; ridgelineUnavailable: number; cap: number; sell: number }

export const SAME: WorldSpec = { id: "price-rise", stockline: 4, ridgeline: 3, ridgelineAge: 900, ridgelineUnavailable: 3, cap: 3, sell: 5 };
export const OTHERS: WorldSpec[] = [
  { id: "ridgeline-cheap-fresh", stockline: 4, ridgeline: 2, ridgelineAge: 60, ridgelineUnavailable: 0, cap: 3, sell: 5 },
  { id: "both-over-cap", stockline: 5, ridgeline: 4, ridgelineAge: 900, ridgelineUnavailable: 2, cap: 3, sell: 5 },
  { id: "thin-margin", stockline: 4, ridgeline: 3, ridgelineAge: 900, ridgelineUnavailable: 0, cap: 4, sell: 4 },
  { id: "ridgeline-flaky", stockline: 4, ridgeline: 3, ridgelineAge: 300, ridgelineUnavailable: 10, cap: 3, sell: 5 },
  { id: "high-price", stockline: 6, ridgeline: 3, ridgelineAge: 1800, ridgelineUnavailable: 1, cap: 3, sell: 7 },
  { id: "cap-raised", stockline: 4, ridgeline: 3, ridgelineAge: 900, ridgelineUnavailable: 3, cap: 4, sell: 7 },
  { id: "stockline-back", stockline: 2, ridgeline: 3, ridgelineAge: 900, ridgelineUnavailable: 3, cap: 3, sell: 5 },
  { id: "ridgeline-dear", stockline: 4, ridgeline: 5, ridgelineAge: 30, ridgelineUnavailable: 0, cap: 3, sell: 6 },
  { id: "no-budget-room", stockline: 3, ridgeline: 3, ridgelineAge: 900, ridgelineUnavailable: 0, cap: 3, sell: 4 },
  { id: "everything-down", stockline: 4, ridgeline: 3, ridgelineAge: 3600, ridgelineUnavailable: 15, cap: 3, sell: 5 },
];

/** The two suppliers as the Sourcing agent sees them in this world. */
export function suppliersOf(w: WorldSpec): SupplierView[] {
  return [
    { id: "stockline", name: "Stockline", price_cents: w.stockline, data_age_seconds: 5, available: true, last20: { paid: 18, refused: 2, unavailable: 0 } },
    { id: "ridgeline", name: "Ridgeline Data", price_cents: w.ridgeline, data_age_seconds: w.ridgelineAge, available: w.ridgelineUnavailable < 15, last20: { paid: 20 - w.ridgelineUnavailable, refused: 0, unavailable: w.ridgelineUnavailable } },
  ];
}

/** What wakes the agent, true in that world: a refusal only when Stockline's price is over the cap, else its notice. */
export function wakeEventOf(w: WorldSpec): { kind: "upstream.refused" | "supplier.notice"; payload: Record<string, unknown> } {
  return w.stockline > w.cap
    ? { kind: "upstream.refused", payload: { seq: 41, supplier: "stockline", reason: `mandate_cap_exceeded: ${(w.stockline / 100).toFixed(2)} is over the sourcing mandate's ${(w.cap / 100).toFixed(2)} a payment`, refused_by: "purser" } }
    : { kind: "supplier.notice", payload: { supplier: "stockline", text: `Stockline's price is now ${(w.stockline / 100).toFixed(2)} a stock check.` } };
}

/** The budget left in every one of these worlds. */
export const WORLD_BUDGET_LEFT_CENTS = 900;

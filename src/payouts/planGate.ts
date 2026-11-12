// The gate a payment plan passes just before it is filed for the CFO's Face ID. The engine works out the plan as
// always (src/payouts/plan.ts, src/agents/euroBill.ts: the route, the fee reserve, the balances and floors, a locked
// quote for the shortfall) and, when a caller hands in a gate, shows it that plan and files it only on a "go". The
// payables chain uses it for the Payer agent (src/ap/payerAgent.ts, KIT11_AP_AGENTS=on): the agent proposes the rail,
// the day and the currency on the very numbers that would be signed, and code's boundary answers. Without a gate the
// engine files the plan as before. Types only: nothing here decides anything.

import type { Origin } from "../provenance/origin.js";
import type { Method } from "./routes.js";

/** A payment as the engine planned it, in two-decimal amounts, before anything is filed. */
export interface PlannedPayment {
  /** The payment ledger's number for the invoice. */
  invoice_no: string;
  vendor: string;
  /** The account's name on file, and the account as the terms show it (masked). */
  payee: string;
  account: string;
  amount: string;
  currency: string;
  due_date: string;
  /** The one route the supplier's account on file is paid by. */
  method: Method;
  clearing: string | null;
  /** What is held back for Airwallex's fee on that route, in the invoice's currency. */
  fee_reserve: string;
  /** Per currency the plan touches: what Airwallex holds, what of it is already spoken for, and its floor. */
  balances: Record<string, string>;
  spoken_for: Record<string, string>;
  floors: Record<string, string>;
  /** The locked quote that buys what the invoice's currency is short; null when nothing is converted. */
  quote: null | { quote_id: string; sell_currency: string; sell_amount: string; buy_currency: string; buy_amount: string; client_rate: string; valid_to: string };
}

/** go: file the plan now (under this origin, when one is given); otherwise nothing is filed, with the reason. */
export type GateAnswer = { go: true; origin?: Origin | null } | { go: false; reason: string };
export type PlanGate = (plan: PlannedPayment) => Promise<GateAnswer>;

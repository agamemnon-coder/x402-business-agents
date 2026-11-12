// The refusals of `npm run two-locks` live commands, without side effects, so they can be tested without running the
// CLI (src/cli/twoLocks.ts runs on import).

import type { DB } from "../db/open.js";

/** The invoice the virtual test passkey pays (fixtures/stockline-licence-SLL-2026-11B.txt). */
export const TWO_LOCKS_DEFAULT_INVOICE = "SLL-2026-11B";

/** Which invoice a live command works on (TWO_LOCKS_INVOICE, else SLL-2026-11B) and why it must not run yet. */
export function twoLocksRefusals(cmd: string, env: Record<string, string | undefined>): { invoiceNo: string; why: string[] } {
  const invoiceNo = env.TWO_LOCKS_INVOICE ?? TWO_LOCKS_DEFAULT_INVOICE;
  const why: string[] = [];
  if (env.TWO_LOCKS_GO !== "yes") why.push("TWO_LOCKS_GO=yes (Max's go)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG");
  if (!/two-locks[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB=…/two-locks*.sqlite (this run's own ledger)");
  if (cmd === "create" && invoiceNo !== TWO_LOCKS_DEFAULT_INVOICE) {
    why.push("create only pays SLL-2026-11B with the virtual test passkey; a TWO_LOCKS_INVOICE ledger was planned elsewhere and is signed by a person");
  }
  return { invoiceNo, why };
}

/** Why `create` must not run on this ledger: a person's passkey is already enrolled, so no virtual one goes beside it. */
export function twoLocksLedgerRefusal(cmd: string, db: DB): string | undefined {
  if (cmd !== "create") return undefined;
  const active = db.prepare("SELECT label FROM passkeys WHERE status = 'ACTIVE' ORDER BY enrolled_at").all() as { label: string }[];
  if (!active.length) return undefined;
  return `this ledger already has an active passkey (${active.map((p) => p.label).join(", ")}); create enrols a virtual test passkey only on a ledger without one`;
}

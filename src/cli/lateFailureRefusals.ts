// The refusals of `npm run late-failure` live commands, without side effects, so they can be tested without running the
// CLI (src/cli/lateFailure.ts runs on import).

import type { DB } from "../db/open.js";

/** The two test invoices this run pays (fixtures/stockline-licence-SLL-2026-11R1.txt and R2), EUR 240.00 each. */
export const LATE_FAILURE_INVOICES = ["SLL-2026-11R1", "SLL-2026-11R2"] as const;
export const LATE_FAILURE_VENDOR = "Stockline Data GmbH";
/** The ceiling of this run's Airwallex calls (every HTTP request counts, logins too). */
export const LATE_FAILURE_MAX_BUDGET = 30;
export const LATE_FAILURE_LIVE = ["create", "follow", "settle", "fail", "recheck"] as const;

/** Whether KIT11_DB names this run's own ledger (…/late-failure*.sqlite): every command but stand-in reads only that one. */
export const lateFailureLedger = (env: Record<string, string | undefined>): boolean => /late-failure[^\\/]*\.sqlite$/.test(env.KIT11_DB ?? "");

/** Why a live command must not run yet: the owner's go, a counted call budget of at most 30, this run's own ledger. */
export function lateFailureRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.LATE_FAILURE_GO !== "yes") why.push("LATE_FAILURE_GO=yes (the owner's go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > LATE_FAILURE_MAX_BUDGET) {
    why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${LATE_FAILURE_MAX_BUDGET}`);
  }
  if (!lateFailureLedger(env)) why.push("KIT11_DB=…/late-failure*.sqlite (this run's own ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair: no token is fetched from Purser Cloud)");
  return why;
}

/** The ledger's numbers for an invoice: the inbox's ("SLL-2026-11R1 · Stockline Data GmbH") and the bare one. */
const ledgerNos = (no: string) => [`${no} · ${LATE_FAILURE_VENDOR}`, no];

/**
 * Why this command must not run on this ledger. create: only on a fresh ledger (no active passkey, so no virtual one goes
 * beside a person's; neither invoice filed or paid yet). The others: only once create wrote both transfers.
 */
export function lateFailureLedgerRefusal(cmd: string, db: DB): string | undefined {
  const hasTransfer = (no: string) => !!db.prepare("SELECT 1 FROM transfers WHERE invoice_no IN (?, ?)").get(...ledgerNos(no));
  if (cmd === "create") {
    const active = db.prepare("SELECT label FROM passkeys WHERE status = 'ACTIVE' ORDER BY enrolled_at").all() as { label: string }[];
    if (active.length) return `this ledger already has an active passkey (${active.map((p) => p.label).join(", ")}); create enrols a virtual test passkey only on a fresh ledger`;
    const paid = LATE_FAILURE_INVOICES.filter(hasTransfer);
    if (paid.length) return `${paid.join(" and ")} already ${paid.length === 1 ? "has a transfer" : "have transfers"} in this ledger; nothing is sent twice`;
    const filed = LATE_FAILURE_INVOICES.filter((no) => db.prepare("SELECT 1 FROM ap_invoices WHERE invoice_no = ?").get(no));
    if (filed.length) return `${filed.join(" and ")} already came in to this ledger's payables inbox; create runs only on a fresh ledger`;
    return undefined;
  }
  const missing = LATE_FAILURE_INVOICES.filter((no) => !db.prepare("SELECT 1 FROM transfers WHERE invoice_no IN (?, ?) AND transfer_id IS NOT NULL").get(...ledgerNos(no)));
  return missing.length ? `no transfer for ${missing.join(" and ")} in this ledger yet (create first); nothing was called` : undefined;
}

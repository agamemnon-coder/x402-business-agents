// An inbox invoice as it leaves the runner's own process: on the local JSON routes (src/servers/payables.ts) and in the
// cloud push (src/cloudsync/client.ts). The reading's account is masked like everywhere else, the last four and the
// account's hash (the same hash the ledger keeps for the supplier's account), never the full IBAN or account number
// (screenshot pass S5, seam review L2). The full account stays in the ledger and on the CFO's phone for a new supplier.

import { ibanSha } from "../agents/invoice.js";
import { accountKey } from "../payouts/routes.js";
import { bankFromReading } from "./bank.js";
import type { ApReading } from "./reading.js";
import type { ApInvoiceRow } from "./store.js";

const last4 = (s: string) => (s ? `…${s.replace(/\s+/g, "").slice(-4)}` : "");

/** The reading with its account masked, and the account's hash beside it ("" when it names no account). */
export function maskedReading(r: ApReading): ApReading & { account_sha256: string } {
  let sha = "";
  try {
    const key = r.iban || r.account_number ? accountKey(bankFromReading(r)) : "";
    sha = key ? ibanSha(key) : "";
  } catch {
    sha = "";
  }
  return { ...r, iban: last4(r.iban), account_number: last4(r.account_number), account_sha256: sha };
}

/** An inbox invoice as the JSON routes and the cloud receive it. */
export function publicInvoice(inv: ApInvoiceRow): Omit<ApInvoiceRow, "reading"> & { reading: ApReading & { account_sha256: string } } {
  return { ...inv, reading: maskedReading(inv.reading) };
}

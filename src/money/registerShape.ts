// The transactions register's shape, labels, filter and CSV (src/money/register.ts builds it): no database, so the
// cloud (cloud/src) serves and exports the same rows with the same code.

export type Rail = "airwallex_transfer" | "airwallex_fx" | "airwallex_card" | "airwallex_airi" | "airwallex_receipt" | "metal" | "metal_clearing";
export type Direction = "in" | "out" | "internal";
export type Reconciliation = "matched" | "missing_booking" | "missing_rail_record" | "amount_mismatch" | "not_applicable";

export const RAIL_LABELS: Record<Rail, string> = {
  airwallex_transfer: "Airwallex transfer",
  airwallex_fx: "Airwallex FX",
  airwallex_card: "Airwallex card",
  airwallex_airi: "Airwallex Airi card",
  airwallex_receipt: "Airwallex Global Account",
  metal: "Metal",
  metal_clearing: "Metal clearing",
};

export const RECONCILIATION_WORDS: Record<Reconciliation, string> = {
  matched: "Booked and matched",
  missing_booking: "Not booked",
  missing_rail_record: "No proof from the rail",
  amount_mismatch: "Booking differs",
  not_applicable: "Nothing moved",
};

export interface TxRow {
  id: string;
  at: string;
  direction: Direction;
  /** Which way the money went for the account it touched: the same as direction for in and out; for a movement between
   *  own accounts, out of the one it left (a conversion's sold leg, a sweep) or into the one it reached. */
  flow: "in" | "out";
  rail: Rail;
  rail_label: string;
  description: string;
  counterparty: string;
  /** The payee's account, masked: the last four only. */
  counterparty_account: string | null;
  amount: string;
  currency: string;
  /** Only when a real amount in euro is recorded: the movement is in EUR, or it is a conversion's leg against EUR. */
  eur_equivalent: string | null;
  fee: { amount: string; currency: string } | null;
  moved: boolean;
  status: string;
  status_words: string;
  invoice: { ap_id: string | null; supplier_no: string; vendor: string; document: string | null } | null;
  approval: { required: boolean; authority: string; proposal_id: string | null; decision: string | null; method: string | null; approved_at: string | null; terms_sha256: string | null };
  booking: { entry_ids: number[]; accounts: string[]; booked: string | null };
  proof: string | null;
  reconciliation: Reconciliation;
  reconciliation_words: string;
  /** What a person should look at: no_approval, no_booking, no_proof, amount_mismatch, booked_not_moved. */
  flags: string[];
}

export interface CurrencyTotals { currency: string; in: string; out: string; internal_in: string; internal_out: string; fees: string; moved: number; not_moved: number }

export interface Register {
  rows: TxRow[];
  totals: CurrencyTotals[];
  check: {
    rows: number;
    moved: number;
    unreconciled: number;
    without_approval: string[];
    without_booking: string[];
    without_proof: string[];
    amount_mismatch: string[];
    /** Ledger postings by the feed for a movement this register cannot find on any rail. */
    bookings_without_movement: number[];
  };
}

/** Totals per currency, of money that moved only; a fee counts in its own currency. */
export function totalsOf(rows: TxRow[]): CurrencyTotals[] {
  const cents = (a: string) => { const m = /^(\d+)\.(\d{2})$/.exec(a); return m ? Number(m[1]) * 100 + Number(m[2]) : 0; };
  const fmt = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  const tot = new Map<string, { in: number; out: number; iin: number; iout: number; fees: number; moved: number; not: number }>();
  const t = (c: string) => { let x = tot.get(c); if (!x) { x = { in: 0, out: 0, iin: 0, iout: 0, fees: 0, moved: 0, not: 0 }; tot.set(c, x); } return x; };
  for (const r of rows) {
    const x = t(r.currency);
    if (!r.moved) { x.not += 1; continue; }
    x.moved += 1;
    const c = cents(r.amount);
    if (r.direction === "in") x.in += c;
    else if (r.direction === "out") x.out += c;
    else if (r.flow === "out") x.iout += c;
    else x.iin += c;
    if (r.fee) t(r.fee.currency).fees += cents(r.fee.amount);
  }
  return [...tot.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, x]) => ({
    currency, in: fmt(x.in), out: fmt(x.out), internal_in: fmt(x.iin), internal_out: fmt(x.iout), fees: fmt(x.fees), moved: x.moved, not_moved: x.not,
  }));
}

export interface RegisterFilter { rail?: string; currency?: string; from?: string; to?: string; reconciliation?: string; moved?: boolean; q?: string }

export function filterRows(rows: TxRow[], f: RegisterFilter): TxRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => (!f.rail || r.rail === f.rail) && (!f.currency || r.currency === f.currency) && (!f.from || r.at.slice(0, 10) >= f.from) && (!f.to || r.at.slice(0, 10) <= f.to)
    && (!f.reconciliation || r.reconciliation === f.reconciliation) && (f.moved === undefined || r.moved === f.moved)
    && (!q || [r.id, r.counterparty, r.description, r.proof ?? "", r.invoice?.supplier_no ?? ""].some((s) => s.toLowerCase().includes(q))));
}

const CSV_COLUMNS = ["id", "at", "direction", "rail", "description", "counterparty", "counterparty_account", "amount", "currency", "eur_equivalent", "fee", "fee_currency", "moved", "status",
  "invoice", "supplier_invoice_no", "proposal_id", "approval", "approval_method", "terms_sha256", "ledger_entries", "booked", "proof", "reconciliation", "flags"] as const;

/** A text cell a spreadsheet would read as a formula gets a leading apostrophe; amounts stay numbers. */
function cell(v: string, numeric = false): string {
  const safe = !numeric && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function registerCsv(rows: TxRow[]): string {
  const line = (r: TxRow) => [
    cell(r.id), cell(r.at), r.direction, r.rail, cell(r.description), cell(r.counterparty), cell(r.counterparty_account ?? ""), cell(r.amount, true), r.currency, cell(r.eur_equivalent ?? "", true),
    cell(r.fee?.amount ?? "", true), r.fee?.currency ?? "", r.moved ? "yes" : "no", cell(r.status_words), cell(r.invoice?.ap_id ?? ""), cell(r.invoice?.supplier_no ?? ""),
    cell(r.approval.proposal_id ?? ""), cell(r.approval.decision ?? r.approval.authority), r.approval.method ?? "", r.approval.terms_sha256 ?? "", r.booking.entry_ids.join(" "),
    cell(r.booking.booked ?? "", true), cell(r.proof ?? ""), r.reconciliation, r.flags.join(" "),
  ].join(",");
  return [CSV_COLUMNS.join(","), ...rows.map(line)].join("\r\n") + "\r\n";
}

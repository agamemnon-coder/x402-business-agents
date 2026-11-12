// The recorded sandbox checks the console's three-way line is fed from (master list 134). No live call is made here:
// live syncing is the owner's budget decision. Two records, each on its own test books:
//
// - T0, 10 November 2026 (docs/runs/2026-11-10-t0-journal-sandbox.md, "Read-back and second push"): the main run's
//   books, per T0 account, ours next to T0's, in USD. The rows below are that table; test/reconcile3.test.ts holds them
//   to the page, so a changed record fails the test rather than the screen.
// - Moneybird, 12 November 2026 (docs/runs/2026-11-12-moneybird-sandbox.json, its `reconciliation`): a fictional test
//   company's purchase invoices, per document, Purser's side next to Moneybird's, in EUR.
//
// The two checks are on different test books, so the line says which is which; it never claims one check covered both.

import moneybirdRecord from "../../docs/runs/2026-11-12-moneybird-sandbox.json" with { type: "json" };
import { differenceLines, reconcile3, type Amounts, type ThreeWay } from "./reconcile3.js";

export const T0_RECORD = "docs/runs/2026-11-10-t0-journal-sandbox.md";
export const MONEYBIRD_RECORD = "docs/runs/2026-11-12-moneybird-sandbox.json";

/** The T0 read-back table of 10 November: T0 account (our codes), ours and T0's net debit in USD. */
export const T0_READBACK_2026_11_10: readonly { account: string; ours: string; t0: string }[] = [
  { account: "11120 (1200)", ours: "11,144,700.05", t0: "11,144,700.05" },
  { account: "11210 (1201)", ours: "9,995,581.94", t0: "9,995,581.94" },
  { account: "11410 (1210)", ours: "20.03", t0: "20.03" },
  { account: "11999 (1590)", ours: "1.32", t0: "1.32" },
  { account: "32000 (3000)", ours: "-21,140,636.23", t0: "-21,140,636.23" },
  { account: "42000 (4000+4100)", ours: "-1.90", t0: "-1.90" },
  { account: "51200 (5000+6350)", ours: "269.48", t0: "269.48" },
  { account: "63410 (6100)", ours: "50.31", t0: "50.31" },
  { account: "63700 (6800)", ours: "15.00", t0: "15.00" },
];

/** "-21,140,636.23" as whole cents. */
export function centsOf(text: string): number {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`not an amount: ${text}`);
  const c = Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3]);
  return m[1] ? -c : c;
}

export interface RecordedCheck {
  system: "T0" | "Moneybird";
  /** The day of the check, YYYY-MM-DD. */
  date: string;
  record: string;
  /** What books were compared, in a few words. */
  books: string;
  result: ThreeWay;
}

interface MoneybirdRow { number: string; role: string; purser: Record<string, string>; erp: Record<string, string> }

const sideAmounts = (s: Record<string, string>): Amounts => {
  const out: Record<string, number> = {};
  for (const k of ["net", "vat", "gross", "paid"]) if (s[k] !== undefined && s[k] !== "-") out[k] = centsOf(s[k]!);
  return out;
};

/** The T0 check of 10 November, recomputed from its table. */
export function t0Check(rows = T0_READBACK_2026_11_10): RecordedCheck {
  const purser = new Map(rows.map((r) => [r.account, centsOf(r.ours)]));
  const t0 = new Map(rows.map((r) => [r.account, centsOf(r.t0)]));
  return { system: "T0", date: "2026-11-10", record: T0_RECORD, books: `the main run's books, ${rows.length} accounts`, result: reconcile3({ purser: { accounts: purser }, t0: { accounts: t0 } }) };
}

/** The Moneybird check of 12 November, recomputed from the record's rows (both sides as recorded). */
export function moneybirdCheck(rec: { reconciliation: { read_at: string; rows: MoneybirdRow[] } } = moneybirdRecord as unknown as { reconciliation: { read_at: string; rows: MoneybirdRow[] } }): RecordedCheck {
  const key = (r: MoneybirdRow) => (r.role === "invoice" ? r.number : `${r.number} (${r.role.replace("_", " ")})`);
  const purser = new Map(rec.reconciliation.rows.map((r) => [key(r), sideAmounts(r.purser)]));
  const mb = new Map(rec.reconciliation.rows.map((r) => [key(r), sideAmounts(r.erp)]));
  // Purser holds no paid amount for a replaced version or its credit note (recorded as "-"): only what both hold is compared.
  for (const [k, p] of purser) {
    const m = mb.get(k)!;
    if (p.paid === undefined && m.paid !== undefined) { const { paid: _drop, ...rest } = m; mb.set(k, rest); }
  }
  return { system: "Moneybird", date: rec.reconciliation.read_at.slice(0, 10), record: MONEYBIRD_RECORD, books: `a test company's purchase invoices, ${rec.reconciliation.rows.length} documents`, result: reconcile3({ purser: { documents: purser }, moneybird: { documents: mb } }) };
}

export const recordedChecks = (): RecordedCheck[] => [t0Check(), moneybirdCheck()];

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dayText = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

export interface ThreeWayLine {
  /** The tick shows only when every check compared something and found 0 differences. */
  tick: boolean;
  text: string;
  /** The stand-in label, shown right next to the line. */
  label: string;
  differences: string[];
  checks: RecordedCheck[];
}

/** The console's one line: the tick and "Purser = T0 = Moneybird, 0 differences" only when all checks agree. */
export function threeWayLine(checks: RecordedCheck[] = recordedChecks()): ThreeWayLine {
  const differences = checks.flatMap((c) => differenceLines(c.result).map((d) => `${c.system}: ${d}`));
  const both = (["T0", "Moneybird"] as const).every((s) => checks.some((c) => c.system === s));
  const tick = both && checks.every((c) => c.result.agree);
  const dates = [...new Set(checks.map((c) => c.date))].sort().map(dayText);
  const n = differences.length;
  const text = tick
    ? `Purser = T0 = Moneybird, 0 differences, checked ${dates.join(" and ")}`
    : `${n} difference${n === 1 ? "" : "s"} between Purser, T0 and Moneybird`;
  const label = `Recorded sandbox check of ${checks.map((c) => `${dayText(c.date)} (${c.system}: ${c.books})`).join(" and ")}`;
  return { tick, text, label, differences, checks };
}

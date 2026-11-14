// T:0's read-back as a record a reader can download (docs/runs/2026-11-14-t0-readback.json, served at
// /t0-readback.json) and the month-close check run on it (src/accounting/closeGate.ts). The record holds T:0's ids, our
// je_numbers, dates, timestamps and amounts, nothing else: no key, header or token, and other teams' entries on the
// shared sandbox entity are counted, never copied.

import type { T0JournalEntry } from "./t0.js";
import { closeCheck, closeCheckText, type CloseCheck, type GateEntry } from "./closeGate.js";
import { centsOf, T0_READBACK_2026_11_10, T0_RECORD } from "./recordedChecks.js";

export const T0_READBACK_FILE = "docs/runs/2026-11-14-t0-readback.json";
/** The site path the record is served at (worker/src/core.ts). */
export const T0_READBACK_PATH = "/t0-readback.json";
/** Entries Purser built and posted from the main run's books, as the 10 Nov record states ("we built 95"). */
export const T0_POSTED_2026_11_10 = 95;

export interface ReadBackLine { account: string; account_name: string; side: "debit" | "credit"; cents: number; purser_code: string | null }
export interface ReadBackEntry {
  t0_id: string; je_number: string; entry_date: string; created_at: string; updated_at: string; status: string; memo: string | null;
  debit_cents: number; credit_cents: number; lines: ReadBackLine[];
}
export interface ReadBackRecord {
  label: string; read_at: string; how: string; entity: string; entry_date: string;
  compared_with: { record: string; what: string };
  close_check: CloseCheck & { text: string };
  totals: { debit_cents: number; credit_cents: number };
  other_entries_ignored: number;
  entries: ReadBackEntry[];
}

/** Purser's books as recorded on 10 Nov: net debit in cents per T:0 account ("11120 (1200)" is T:0 account 11120). */
export function recordedAccounts(rows = T0_READBACK_2026_11_10): Map<string, number> {
  return new Map(rows.map((r) => [r.account.slice(0, 5), centsOf(r.ours)]));
}

/** The close check on a read-back: T:0's entries against Purser's books as recorded, account by account and the count. */
export function recordedCloseCheck(entries: readonly Pick<T0JournalEntry, "je_number" | "atoms_per_unit" | "lines">[], month = "2026-11"): CloseCheck {
  return closeCheck({ month, t0: entries, ourAccounts: recordedAccounts(), ourCount: T0_POSTED_2026_11_10 });
}

const cents = (atoms: number, per: number) => Math.round((atoms * 100) / (per || 100));

export function readBackRecord(entries: readonly T0JournalEntry[], meta: { readAt: string; entity: string; day: string }): ReadBackRecord {
  const mine = entries.filter((e) => e.je_number?.startsWith("PUR-"));
  const out: ReadBackEntry[] = mine.map((e) => {
    const x = e as T0JournalEntry & { created_at?: string; updated_at?: string };
    return {
      t0_id: e.id, je_number: e.je_number!, entry_date: e.entry_date, created_at: x.created_at ?? "", updated_at: x.updated_at ?? "", status: e.status, memo: e.memo,
      debit_cents: cents(e.total_debit_atoms, e.atoms_per_unit), credit_cents: cents(e.total_credit_atoms, e.atoms_per_unit),
      lines: e.lines.map((l) => ({ account: l.account_number ?? l.account_id, account_name: l.account_name, side: l.line_type, cents: cents(l.amount_atoms, e.atoms_per_unit), purser_code: /^Purser (\d{4})\b/.exec(l.memo ?? "")?.[1] ?? null })),
    };
  }).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.je_number.localeCompare(b.je_number));
  const check = recordedCloseCheck(entries, meta.day.slice(0, 7));
  return {
    label: "T:0 sandbox, test data: T:0's read-back of Purser's journal entries (the main run's books), read only",
    read_at: meta.readAt,
    how: `GET /v1/journal-entries for ${meta.day}, manual entries, one call, read only. The key was added by the network proxy; it is not in this file.`,
    entity: meta.entity,
    entry_date: meta.day,
    compared_with: { record: T0_RECORD, what: `Purser's books as recorded on 10 Nov: ${T0_POSTED_2026_11_10} entries, net per T:0 account` },
    close_check: { ...check, text: closeCheckText(check) },
    totals: { debit_cents: out.reduce((s, e) => s + e.debit_cents, 0), credit_cents: out.reduce((s, e) => s + e.credit_cents, 0) },
    other_entries_ignored: entries.length - mine.length,
    entries: out,
  };
}

/** The record's entries back in T:0's shape, so the check can run again on the file alone. */
export function entriesOfRecord(r: Pick<ReadBackRecord, "entries">): Pick<T0JournalEntry, "je_number" | "atoms_per_unit" | "lines">[] {
  return r.entries.map((e) => ({ je_number: e.je_number, atoms_per_unit: 100, lines: e.lines.map((l, i) => ({ id: String(i), account_id: l.account, account_number: l.account, account_name: l.account_name, account_type: "", line_type: l.side, amount_atoms: l.cents, transaction_amount_atoms: null, memo: null })) }));
}

export const gateEntriesOfRecord = (r: Pick<ReadBackRecord, "entries">): GateEntry[] => r.entries.map((e) => ({ je_number: e.je_number, lines: e.lines.map((l) => ({ account: l.account, side: l.side, cents: l.cents })) }));

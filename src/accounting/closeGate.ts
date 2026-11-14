// The month close's independent ledger check (partner review, 14 Nov): Purser marks a month closed only when T:0, an
// outside general ledger, holds the same books. Purser's journal is compared with T:0's read-back, entry by entry and
// line by line, to the cent; any difference keeps the month open and names the entry. No call to T:0 is made here:
// the read-back is passed in (live from T0Client.listJournalEntries, or the recorded read-back in docs/runs).
//
// Two ways to compare, both strict:
// - entry by entry, when Purser's own entries are at hand (built from its ledger, src/accounting/t0.ts buildEntries):
//   every entry must be in T:0 under its je_number with the same lines (account, debit or credit, amount);
// - account by account, when only Purser's recorded totals are at hand (the 10 Nov record, src/accounting/recordedChecks.ts):
//   T:0's own entries summed per account must equal Purser's totals, and the count of entries must agree.
// Both: each of Purser's entries in T:0 must balance, and T:0 may hold no Purser entry (PUR-) that Purser did not make.

// Pure: no database, no network, so the cloud Worker can run it too. The close itself is src/ledger/close.ts
// closeMonthWhenT0Agrees.
import type { T0JournalEntry } from "./t0.js";

export interface GateLine { account: string; side: "debit" | "credit"; cents: number }
export interface GateEntry { je_number: string; lines: GateLine[] }

export type CloseProblemKind = "missing_in_t0" | "not_in_our_books" | "lines_differ" | "unbalanced" | "account_differs" | "count_differs" | "nothing_to_compare";
export interface CloseProblem { kind: CloseProblemKind; je_number?: string; /** Account by account: T:0's entries on the account that differs. */ entries?: string[]; account?: string; ours_cents?: number; t0_cents?: number; text: string }

export interface CloseCheck {
  month: string;
  /** True only when T:0 agrees with Purser on every entry (or every account and the count) and no problem was found. */
  agrees: boolean;
  how: "entries" | "accounts";
  /** Purser's entries the check expected, and how many of them T:0 holds exactly as Purser does. */
  expected: number;
  matched: number;
  /** Other entries in T:0 for the month that are not Purser's (no PUR- number): a shared entity holds other books; ignored. */
  ignored: number;
  problems: CloseProblem[];
}

const PUR = /^PUR-/;
const money = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-US")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const net = (l: GateLine) => (l.side === "debit" ? l.cents : -l.cents);
const lineKey = (l: GateLine) => `${l.account}|${l.side}|${l.cents}`;

/** T:0's read-back as gate entries: Purser's entries only, amounts in cents (T:0 atoms at 100 per unit are cents). */
export function fromT0(entries: readonly Pick<T0JournalEntry, "je_number" | "atoms_per_unit" | "lines">[]): { ours: GateEntry[]; ignored: number } {
  const ours: GateEntry[] = [];
  let ignored = 0;
  for (const e of entries) {
    if (!e.je_number || !PUR.test(e.je_number)) { ignored++; continue; }
    const per = e.atoms_per_unit || 100;
    ours.push({ je_number: e.je_number, lines: e.lines.map((l) => ({ account: l.account_number ?? l.account_id, side: l.line_type, cents: Math.round((l.amount_atoms * 100) / per) })) });
  }
  return { ours, ignored };
}

/** Each entry's lines, sorted, as one comparable list. */
const sorted = (e: GateEntry) => e.lines.map(lineKey).sort();

/** The first line where two entries differ, in words: "account 11410: ours debit 5.00, T:0 debit 5.01". */
function lineDifference(ours: GateEntry, theirs: GateEntry): { account: string; ours: number; t0: number } {
  const per = (e: GateEntry) => {
    const m = new Map<string, number>();
    for (const l of e.lines) m.set(l.account, (m.get(l.account) ?? 0) + net(l));
    return m;
  };
  const a = per(ours), b = per(theirs);
  for (const acc of [...new Set([...a.keys(), ...b.keys()])].sort()) if ((a.get(acc) ?? 0) !== (b.get(acc) ?? 0)) return { account: acc, ours: a.get(acc) ?? 0, t0: b.get(acc) ?? 0 };
  const acc = ours.lines[0]?.account ?? theirs.lines[0]?.account ?? "?";
  return { account: acc, ours: a.get(acc) ?? 0, t0: b.get(acc) ?? 0 };
}

export interface CloseCheckInput {
  month: string;
  /** T:0's read-back for the month (every manual entry; other people's are ignored). */
  t0: readonly Pick<T0JournalEntry, "je_number" | "atoms_per_unit" | "lines">[];
  /** Purser's own entries, when built from its ledger: the check is then entry by entry. */
  ourEntries?: readonly GateEntry[];
  /** Otherwise Purser's recorded totals: net debit in cents per T:0 account, and the number of entries Purser posted. */
  ourAccounts?: ReadonlyMap<string, number>;
  ourCount?: number;
}

/** Compares Purser's books with T:0's read-back. Never throws on a difference: it is listed, and `agrees` is false. */
export function closeCheck(input: CloseCheckInput): CloseCheck {
  const { ours: theirs, ignored } = fromT0(input.t0);
  const problems: CloseProblem[] = [];
  for (const e of theirs) {
    const d = e.lines.reduce((s, l) => s + net(l), 0);
    if (d !== 0 || e.lines.length < 2) problems.push({ kind: "unbalanced", je_number: e.je_number, text: `${e.je_number} in T:0 does not balance (debits minus credits ${money(d)})` });
  }
  const byNumber = new Map(theirs.map((e) => [e.je_number, e]));

  if (input.ourEntries) {
    let matched = 0;
    const mine = new Set<string>();
    for (const o of input.ourEntries) {
      mine.add(o.je_number);
      const t = byNumber.get(o.je_number);
      if (!t) { problems.push({ kind: "missing_in_t0", je_number: o.je_number, text: `${o.je_number} is in our books but not in T:0` }); continue; }
      const a = sorted(o), b = sorted(t);
      if (a.length === b.length && a.every((k, i) => k === b[i])) { matched++; continue; }
      const diff = lineDifference(o, t);
      problems.push({ kind: "lines_differ", je_number: o.je_number, account: diff.account, ours_cents: diff.ours, t0_cents: diff.t0, text: `${o.je_number} differs on account ${diff.account}: ours ${money(diff.ours)}, T:0 ${money(diff.t0)}` });
    }
    for (const t of theirs) if (!mine.has(t.je_number)) problems.push({ kind: "not_in_our_books", je_number: t.je_number, text: `${t.je_number} is in T:0 but not in our books` });
    if (!input.ourEntries.length) problems.push({ kind: "nothing_to_compare", text: "no entries in our books for the month" });
    return { month: input.month, agrees: problems.length === 0, how: "entries", expected: input.ourEntries.length, matched, ignored, problems };
  }

  if (!input.ourAccounts || input.ourCount === undefined) throw new Error("closeCheck needs our entries, or our account totals and our entry count");
  const t0 = new Map<string, number>();
  for (const e of theirs) for (const l of e.lines) t0.set(l.account, (t0.get(l.account) ?? 0) + net(l));
  for (const acc of [...new Set([...input.ourAccounts.keys(), ...t0.keys()])].sort()) {
    const a = input.ourAccounts.get(acc) ?? 0, b = t0.get(acc) ?? 0;
    if (a !== b) {
      const touching = theirs.filter((e) => e.lines.some((l) => l.account === acc)).map((e) => e.je_number);
      problems.push({ kind: "account_differs", account: acc, entries: touching, ours_cents: a, t0_cents: b, text: `account ${acc} differs: ours ${money(a)}, T:0 ${money(b)}${touching.length ? ` (T:0 entries on it: ${touching.slice(0, 5).join(", ")}${touching.length > 5 ? ", …" : ""})` : ""}` });
    }
  }
  if (theirs.length !== input.ourCount) problems.push({ kind: "count_differs", ours_cents: input.ourCount, t0_cents: theirs.length, text: `we posted ${input.ourCount} entries, T:0 holds ${theirs.length}` });
  if (input.ourCount === 0) problems.push({ kind: "nothing_to_compare", text: "no entries in our books for the month" });
  const agrees = problems.length === 0;
  // Account by account, no single entry can be called matched unless the whole month agrees.
  return { month: input.month, agrees, how: "accounts", expected: input.ourCount, matched: agrees ? theirs.length : 0, ignored, problems };
}

/** One line for a screen: what T:0 said, in words. */
export function closeCheckText(c: CloseCheck): string {
  if (c.agrees) return `T:0 agrees: all ${c.expected} of our journal entries are in T:0, ${c.how === "entries" ? "line for line, to the cent" : "and every account matches our books to the cent"}.`;
  const n = c.problems.length;
  return `T:0 does not agree: ${n} difference${n === 1 ? "" : "s"}. First: ${c.problems[0]!.text}. The month stays open.`;
}

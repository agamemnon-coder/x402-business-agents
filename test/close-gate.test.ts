// The month close's independent ledger check (src/accounting/closeGate.ts): books close only when T:0 agrees. A cent of
// difference keeps the month open and names the entry; the recorded read-back of 14 Nov agrees with the books of 10 Nov.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openDb } from "../src/db/open.js";
import { closedThrough } from "../src/ledger/core.js";
import { closeCheck, closeCheckText, fromT0 } from "../src/accounting/closeGate.js";
import { closeMonthWhenT0Agrees, CloseRefused } from "../src/ledger/close.js";
import { entriesOfRecord, gateEntriesOfRecord, readBackRecord, recordedCloseCheck, T0_READBACK_FILE, type ReadBackRecord } from "../src/accounting/t0Readback.js";
import type { T0JournalEntry } from "../src/accounting/t0.js";

const record = JSON.parse(readFileSync(new URL(`../${T0_READBACK_FILE}`, import.meta.url), "utf8")) as ReadBackRecord;
const t0 = () => entriesOfRecord(record);
const ours = () => gateEntriesOfRecord(record);

describe("the recorded read-back (docs/runs/2026-11-14-t0-readback.json)", () => {
  it("holds 95 Purser entries with T:0 ids, timestamps and amounts, debits equal to credits", () => {
    expect(record.entries).toHaveLength(95);
    expect(record.totals).toEqual({ debit_cents: 2_114_122_186, credit_cents: 2_114_122_186 });
    expect(record.entries[0]).toMatchObject({ t0_id: "je_prod_z7kTCuZ1iiwad01q", je_number: "PUR-8264fd976b2da0702aaf01ae", entry_date: "2026-11-03" });
    for (const e of record.entries) {
      expect(e.t0_id).toMatch(/^je_prod_\w+$/);
      expect(e.created_at).toMatch(/^2026-11-10T06:0[78]:/);
      expect(e.debit_cents).toBe(e.credit_cents);
    }
    expect(new Set(record.entries.map((e) => e.je_number)).size).toBe(95);
  });

  it("carries no key, header or token, and no other team's entry", () => {
    const text = readFileSync(new URL(`../${T0_READBACK_FILE}`, import.meta.url), "utf8");
    expect(text).not.toMatch(/bearer|authorization|api[_-]?key|x-idempotency/i);
    expect(record.entries.every((e) => e.je_number.startsWith("PUR-"))).toBe(true);
    expect(record.other_entries_ignored).toBe(1);
  });

  it("agrees with Purser's books as recorded on 10 Nov, recomputed from the file alone", () => {
    const c = recordedCloseCheck(t0());
    expect(c).toMatchObject({ agrees: true, how: "accounts", expected: 95, matched: 95, problems: [] });
    expect(record.close_check.agrees).toBe(true);
    expect(closeCheckText(c)).toBe("T:0 agrees: all 95 of our journal entries are in T:0, and every account matches our books to the cent.");
  });

  it("a one-cent change in T:0 makes the recorded check disagree and names the account and its entries", () => {
    const changed = t0();
    const line = changed[10]!.lines[0]!;
    line.amount_atoms += 1;
    changed[10]!.lines[1]!.amount_atoms += 1; // still balanced: only the comparison can catch it
    const c = recordedCloseCheck(changed);
    expect(c.agrees).toBe(false);
    expect(c.matched).toBe(0);
    const d = c.problems.find((p) => p.kind === "account_differs" && p.account === line.account_number)!;
    expect(Math.abs(d.ours_cents! - d.t0_cents!)).toBe(1);
    expect(d.entries).toContain(changed[10]!.je_number!);
    expect(d.text).toMatch(/^account \d{5} differs: ours [\d,.-]+, T:0 [\d,.-]+ \(T:0 entries on it: PUR-/);
  });
});

describe("closeCheck, entry by entry", () => {
  it("agrees when every entry is in T:0 with the same lines", () => {
    const c = closeCheck({ month: "2026-11", t0: t0(), ourEntries: ours() });
    expect(c).toMatchObject({ agrees: true, how: "entries", expected: 95, matched: 95, ignored: 0 });
    expect(closeCheckText(c)).toContain("line for line, to the cent");
  });

  it("a 1-cent difference blocks the close and names the entry", () => {
    const mine = ours();
    const target = mine[42]!;
    target.lines[0]!.cents += 1;
    target.lines[1]!.cents += 1;
    const c = closeCheck({ month: "2026-11", t0: t0(), ourEntries: mine });
    expect(c.agrees).toBe(false);
    expect(c.matched).toBe(94);
    expect(c.problems).toEqual([expect.objectContaining({ kind: "lines_differ", je_number: target.je_number })]);
    expect(c.problems[0]!.text).toMatch(new RegExp(`^${target.je_number} differs on account \\d{5}: ours -?[\\d,]+\\.\\d{2}, T:0 -?[\\d,]+\\.\\d{2}$`));
    expect(closeCheckText(c)).toContain(target.je_number);
    expect(closeCheckText(c)).toContain("The month stays open");
  });

  it("names an entry missing in T:0, one T:0 has that we did not make, and one that does not balance", () => {
    const theirs = t0();
    const dropped = theirs.splice(3, 1)[0]!;
    const extra = { je_number: "PUR-000000000000000000000000", atoms_per_unit: 100, lines: [{ ...theirs[0]!.lines[0]!, amount_atoms: 7 }, { ...theirs[0]!.lines[1]!, amount_atoms: 6 }] } as Pick<T0JournalEntry, "je_number" | "atoms_per_unit" | "lines">;
    theirs.push(extra);
    const c = closeCheck({ month: "2026-11", t0: theirs, ourEntries: ours() });
    expect(c.agrees).toBe(false);
    expect(c.problems.map((p) => [p.kind, p.je_number])).toEqual(expect.arrayContaining([
      ["missing_in_t0", dropped.je_number], ["not_in_our_books", extra.je_number], ["unbalanced", extra.je_number],
    ]));
  });

  it("ignores other people's entries on a shared entity, and never agrees on nothing", () => {
    const foreign = { je_number: null, atoms_per_unit: 100, lines: [] } as unknown as T0JournalEntry;
    expect(fromT0([foreign]).ignored).toBe(1);
    expect(closeCheck({ month: "2026-11", t0: [...t0(), foreign], ourEntries: ours() }).agrees).toBe(true);
    expect(closeCheck({ month: "2026-11", t0: [], ourEntries: [] }).agrees).toBe(false);
  });
});

describe("closeMonthWhenT0Agrees", () => {
  it("locks the month only when T:0 agrees", () => {
    const db = openDb(":memory:");
    const ok = closeCheck({ month: "2026-11", t0: t0(), ourEntries: ours() });
    expect(closeMonthWhenT0Agrees(db, ok, "the CFO", new Date("2026-12-01T09:00:00Z"))).toMatchObject({ month: "2026-11", locked: true });
    expect(closedThrough(db)).toBe("2026-11");
  });

  it("refuses the close on a 1-cent difference: nothing is locked, and the refusal names the entry", () => {
    const db = openDb(":memory:");
    const mine = ours();
    mine[7]!.lines[0]!.cents -= 1;
    mine[7]!.lines[1]!.cents -= 1;
    const bad = closeCheck({ month: "2026-11", t0: t0(), ourEntries: mine });
    expect(() => closeMonthWhenT0Agrees(db, bad, "the CFO")).toThrow(CloseRefused);
    expect(() => closeMonthWhenT0Agrees(db, bad, "the CFO")).toThrow(mine[7]!.je_number);
    expect(closedThrough(db)).toBeNull();
  });
});

describe("readBackRecord", () => {
  it("keeps only Purser's entries and only the fields the record names", () => {
    const raw = [{ id: "je_prod_x", je_number: "PUR-abc", entry_date: "2026-11-03", memo: "m", source: "manual", currency: "USD", transaction_currency: null, atoms_per_unit: 100, total_debit_atoms: 5, total_credit_atoms: 5, status: "editable", created_at: "t1", updated_at: "t1",
      lines: [{ id: "l1", account_id: "a", account_number: "11410", account_name: "P", account_type: "bank", line_type: "debit", amount_atoms: 5, transaction_amount_atoms: 5, memo: "Purser 1210 Bank; proof 0x1" }, { id: "l2", account_id: "b", account_number: "42000", account_name: "S", account_type: "income", line_type: "credit", amount_atoms: 5, transaction_amount_atoms: 5, memo: null }] },
    { id: "je_prod_y", je_number: null, entry_date: "2026-11-03", memo: "someone else", source: "manual", currency: "USD", transaction_currency: null, atoms_per_unit: 100, total_debit_atoms: 1, total_credit_atoms: 1, status: "editable", lines: [] }] as unknown as T0JournalEntry[];
    const r = readBackRecord(raw, { readAt: "2026-11-14T00:00:00Z", entity: "e", day: "2026-11-03" });
    expect(r.other_entries_ignored).toBe(1);
    expect(r.entries).toEqual([{ t0_id: "je_prod_x", je_number: "PUR-abc", entry_date: "2026-11-03", created_at: "t1", updated_at: "t1", status: "editable", memo: "m", debit_cents: 5, credit_cents: 5,
      lines: [{ account: "11410", account_name: "P", side: "debit", cents: 5, purser_code: "1210" }, { account: "42000", account_name: "S", side: "credit", cents: 5, purser_code: null }] }]);
    expect(JSON.stringify(r)).not.toContain("someone else");
  });
});

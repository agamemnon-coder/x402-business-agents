// Purser = T0 = Moneybird (master list 134): the three-way comparison, and the console line fed from the recorded
// sandbox checks. The tick shows only when the computed difference is 0; one cent off on either side shows the
// difference and no tick. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { purserView, reconcile3, differenceLines } from "../src/accounting/reconcile3.js";
import { centsOf, moneybirdCheck, recordedChecks, t0Check, T0_READBACK_2026_11_10, threeWayLine } from "../src/accounting/recordedChecks.js";
import { vaultWorld } from "./fakes/vaultWorld.js";
import { ledgerRows } from "../src/ledger/core.js";

const record = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-moneybird-sandbox.json", import.meta.url), "utf8")) as { reconciliation: { read_at: string; differences: number; rows: { number: string; role: string; purser: Record<string, string>; erp: Record<string, string> }[] } };

describe("reconcile3", () => {
  const docs = (gross: number) => new Map([["VE-889", { net: 200, vat: 42, gross }]]);

  it("agrees when all three hold the same amounts, and names each difference with every side's amount", () => {
    const same = reconcile3({ purser: { documents: docs(242), accounts: new Map([["6900", 200]]) }, t0: { accounts: new Map([["6900", 200]]) }, moneybird: { documents: docs(242) } });
    expect(same).toMatchObject({ agree: true, documents: 1, accounts: 1, differences: [], compared: ["T0", "Moneybird"] });
    const off = reconcile3({ purser: { documents: docs(242) }, moneybird: { documents: docs(243) } });
    expect(off.agree).toBe(false);
    expect(differenceLines(off)).toEqual(["Document VE-889, gross: Purser 2.42, Moneybird 2.43"]);
    const missing = reconcile3({ purser: { accounts: new Map([["1200", 1]]) }, t0: { accounts: new Map() } });
    expect(differenceLines(missing)).toEqual(["Account 1200, net: Purser 0.01, T0 not there"]);
  });

  it("never agrees on nothing compared", () => {
    expect(reconcile3({ purser: { documents: new Map() } }).agree).toBe(false);
    expect(reconcile3({ purser: { documents: new Map() }, moneybird: { documents: new Map() } }).agree).toBe(false);
  });

  it("reads Purser's own view from the ledger: net per account and currency, gross and paid per supplier document", async () => {
    const w = await vaultWorld();
    const v = purserView(ledgerRows(w.db));
    const total = [...v.accounts.values()].reduce((s, c) => s + c, 0);
    expect(total).toBe(0);
    const paid = [...v.documents.values()].find((d) => (d.paid ?? 0) > 0)!;
    expect(paid.paid).toBe(paid.gross);
  }, 60_000);
});

describe("the recorded sandbox checks and the console line", () => {
  it("holds the T0 rows to the table in the run record", () => {
    const page = readFileSync(new URL("../docs/runs/2026-11-10-t0-journal-sandbox.md", import.meta.url), "utf8");
    const section = page.slice(page.indexOf("Per T:0 account, ours and T:0's"));
    const rows = [...section.matchAll(/^\| (\d{5} \([^)]+\)) \| ([-\d,.]+) \| ([-\d,.]+) \|$/gm)].map((m) => ({ account: m[1]!, ours: m[2]!, t0: m[3]! }));
    expect(rows).toEqual(T0_READBACK_2026_11_10);
    expect(centsOf("-21,140,636.23")).toBe(-2_114_063_623);
  });

  it("recomputes 0 differences from both records, and the Moneybird count matches the record's own", () => {
    const [t0, mb] = recordedChecks();
    expect(t0!.result).toMatchObject({ agree: true, accounts: 9, differences: [] });
    expect(mb!.result).toMatchObject({ agree: true, documents: record.reconciliation.rows.length, differences: [] });
    expect(record.reconciliation.differences).toBe(0);
    expect(mb!.date).toBe(record.reconciliation.read_at.slice(0, 10));
  });

  it("shows the tick with the dates and the stand-in label when everything agrees", () => {
    const line = threeWayLine();
    expect(line.tick).toBe(true);
    expect(line.text).toBe("Purser = T0 = Moneybird, 0 differences, checked 10 Nov 2026 and 12 Nov 2026");
    expect(line.label).toMatch(/^Recorded sandbox check of 10 Nov 2026 \(T0: the main run's books, 9 accounts\) and 12 Nov 2026 \(Moneybird: a test company's purchase invoices, 6 documents\)$/);
    expect(line.differences).toEqual([]);
  });

  it("shows the difference and no tick when one cent is off on Purser's side or on the other side", () => {
    const t0Off = T0_READBACK_2026_11_10.map((r, i) => (i === 7 ? { ...r, t0: "50.32" } : r));
    const a = threeWayLine([t0Check(t0Off), moneybirdCheck()]);
    expect(a.tick).toBe(false);
    expect(a.text).toBe("1 difference between Purser, T0 and Moneybird");
    expect(a.differences).toEqual(["T0: Account 63410 (6100), net: Purser 50.31, T0 50.32"]);

    const copy = structuredClone(record);
    copy.reconciliation.rows[0]!.purser.gross = "3.28";
    const b = threeWayLine([t0Check(), moneybirdCheck(copy)]);
    expect(b.tick).toBe(false);
    expect(b.differences).toEqual([`Moneybird: Document ${copy.reconciliation.rows[0]!.number}, gross: Purser 3.28, Moneybird 3.27`]);
  });

  it("shows no tick when one of the two systems was not checked", () => {
    expect(threeWayLine([t0Check()]).tick).toBe(false);
  });
});

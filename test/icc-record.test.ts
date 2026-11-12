// The ICC run record's reader and writer (src/icc/record.ts): the /visa page's block reads the JSON through
// readIccRunRecord, so it takes exactly the documented shape and refuses anything else by field. No network; files go
// to a temporary folder only.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { ICC_RECORD_SCHEMA, IccNoRun, IccRecordInvalid, iccRecordMarkdown, iccRunRecord, readIccRunRecord, writeIccRunRecord, type IccRunRecord } from "../src/icc/record.js";

const HASH = "ab".repeat(32);
const good = (): IccRunRecord => ({
  schema: ICC_RECORD_SCHEMA, run_date: "2026-10-01", environment: "sandbox",
  purchases: [
    { label: "A", amount: "12.00", currency: "EUR", merchant: "Northwind Outdoor test shop", terms_sha256: HASH, instruction_id: ["1", "ABCDEF"].join("-"), approved_with: "passkey", outcome: "credential received, not used; no payment was made", refusal_code: null },
    { label: "B", amount: "250.00", currency: "EUR", merchant: "Northwind Outdoor test shop", terms_sha256: null, instruction_id: null, approved_with: null, outcome: "refused by Purser before any call", refusal_code: "PURSER_ABOVE_HARD_CAP" },
  ],
  checks: [{ stage: "run", name: "b_refused_before_any_call", ok: true, detail: "B: refused PURSER_ABOVE_HARD_CAP, 0 call(s)" }],
  calls: { total: 2, budget: 3, by_endpoint: [{ endpoint: "POST /icc/v1/instructions", calls: 1 }, { endpoint: "POST /icc/v1/instructions/{id}/credentials", calls: 1 }] },
  not_done: ["No payment was made: the flow stops before checkout, and a credential that came was dropped unused."],
});

describe("readIccRunRecord", () => {
  it("takes the documented shape, as text or as a value", () => {
    expect(readIccRunRecord(good())).toEqual(good());
    expect(readIccRunRecord(JSON.stringify(good()))).toEqual(good());
  });

  const bad: [string, (r: Record<string, unknown> & IccRunRecord) => void, RegExp][] = [
    ["an extra field (a credential would be one)", (r) => { (r as Record<string, unknown>).signedPayload = "x"; }, /the record must have exactly/],
    ["an extra purchase field", (r) => { (r.purchases[0] as unknown as Record<string, unknown>).assuranceData = []; }, /purchases\[0\] must have exactly/],
    ["another environment", (r) => { (r as Record<string, unknown>).environment = "production"; }, /environment/],
    ["a date that is no date", (r) => { r.run_date = "2026-13-45"; }, /run_date/],
    ["an amount that is not two decimals", (r) => { r.purchases[0]!.amount = "12"; }, /purchases\[0\]\.amount/],
    ["a card-like number in a text", (r) => { r.purchases[1]!.outcome = `refused ${"4".repeat(16)}`; }, /purchases\[1\]\.outcome/],
    ["a hash that is not one", (r) => { r.purchases[0]!.terms_sha256 = "abc"; }, /terms_sha256/],
    ["a merchant name over 40 characters", (r) => { r.purchases[0]!.merchant = "x".repeat(41); }, /merchant/],
    ["calls that do not add up", (r) => { r.calls.total = 3; }, /calls\.total/],
    ["a call that is not one of the endpoint shapes", (r) => { r.calls.by_endpoint[0]!.endpoint = "POST https://elsewhere/x"; }, /by_endpoint\[0\]\.endpoint/],
    ["a check without its result", (r) => { (r.checks[0] as unknown as Record<string, unknown>).ok = "yes"; }, /checks\[0\]\.ok/],
  ];
  for (const [what, change, why] of bad) {
    it(`refuses ${what}`, () => {
      const r = good() as Record<string, unknown> & IccRunRecord;
      change(r);
      expect(() => readIccRunRecord(r)).toThrow(IccRecordInvalid);
      expect(() => readIccRunRecord(r)).toThrow(why);
    });
  }
  it("refuses text that is not JSON", () => {
    expect(() => readIccRunRecord("{")).toThrow(/not JSON/);
  });
});

describe("the files", () => {
  it("are named by the run's own date and say what happened and what did not", () => {
    const dir = mkdtempSync(join(tmpdir(), "icc-record-test-"));
    const files = writeIccRunRecord(dir, good());
    expect(readdirSync(dir).sort()).toEqual(["2026-10-01-icc.json", "2026-10-01-icc.md"]);
    expect(readIccRunRecord(readFileSync(files.json, "utf8"))).toEqual(good());
    const md = readFileSync(files.md, "utf8");
    expect(md).toBe(iccRecordMarkdown(good()));
    expect(md).toContain("| A | 12.00 EUR | Northwind Outdoor test shop | passkey |");
    expect(md).toContain("refused by Purser before any call (PURSER_ABOVE_HARD_CAP)");
    expect(md).toContain("2 call(s) in the call log, of an approved budget of 3.");
    expect(md).toContain("- No payment was made");
  });
});

describe("iccRunRecord", () => {
  it("refuses a run that did not finish, and one not made against the sandbox host", () => {
    const db = openDb(":memory:");
    expect(() => iccRunRecord(db, [])).toThrow(IccNoRun);
    audit(db, "system", "icc.run_started", "icc-run", { budget: 3, host: "apitest.cybersource.com" });
    expect(() => iccRunRecord(db, [])).toThrow(/did not finish/);
    audit(db, "system", "icc.run_checks", "icc-run", { ok: true, checks: [] });
    audit(db, "system", "icc.run_started", "icc-run", { budget: 3, host: "elsewhere.example" });
    audit(db, "system", "icc.run_checks", "icc-run", { ok: true, checks: [] });
    expect(() => iccRunRecord(db, [])).toThrow(/not made against the sandbox host/);
  });
});

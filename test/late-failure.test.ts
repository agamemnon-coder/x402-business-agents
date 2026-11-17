// `npm run late-failure` (src/cli/lateFailure.ts): its live commands refuse to start without the owner's go, a counted
// call budget of at most 30 and the run's own ledger; create runs only on a fresh ledger and the others only once create
// wrote both transfers. The stand-in runs the whole flow through the payables inbox on the in-memory Airwallex stand-in,
// with 0 network: R1 comes back after PAID, R2 fails after SENT, both invoices go to a person, two transfers created.
// `stand-in --refused` plays a sandbox that refuses FAILED after PAID: the refusal is recorded, R1 stays paid.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LATE_FAILURE_MAX_BUDGET, lateFailureLedger, lateFailureLedgerRefusal, lateFailureRefusals } from "../src/cli/lateFailureRefusals.js";
import { openDb } from "../src/db/open.js";

const repo = resolve(import.meta.dirname, "..");
const ok = { LATE_FAILURE_GO: "yes", AIRWALLEX_CALL_BUDGET: "30", AIRWALLEX_CALL_LOG: "/tmp/late-failure-calls.jsonl", KIT11_DB: "data/late-failure-1117.sqlite" };

/** The CLI in a child process, with no Airwallex, model or chain key in its environment. */
function cli(args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/AIRWALLEX|ANTHROPIC|METAL|T0_|KIT11_DB|LATE_FAILURE/.test(k)) env[k] = v;
  const r = spawnSync(process.execPath, [resolve(repo, "node_modules/tsx/dist/cli.mjs"), resolve(repo, "src/cli/lateFailure.ts"), ...args], { cwd: repo, env: { ...env, ...extra }, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("late-failure live refusals", () => {
  it("runs with all four in place", () => expect(lateFailureRefusals(ok)).toEqual([]));

  it("refuses each missing or wider setting", () => {
    expect(lateFailureRefusals({ ...ok, LATE_FAILURE_GO: undefined }).join()).toMatch(/LATE_FAILURE_GO=yes/);
    expect(lateFailureRefusals({ ...ok, LATE_FAILURE_GO: "y" }).join()).toMatch(/LATE_FAILURE_GO=yes/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_CALL_LOG: undefined }).join()).toMatch(/CALL_LOG/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_CALL_BUDGET: undefined }).join()).toMatch(/CALL_BUDGET/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_CALL_BUDGET: String(LATE_FAILURE_MAX_BUDGET + 1) }).join()).toMatch(/from 1 to 30/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_CALL_BUDGET: "0" }).join()).toMatch(/from 1 to 30/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_CALL_BUDGET: "12.5" }).join()).toMatch(/from 1 to 30/);
    expect(lateFailureRefusals({ ...ok, KIT11_DB: "data/kit11.sqlite" }).join()).toMatch(/late-failure\*\.sqlite/);
    expect(lateFailureRefusals({ ...ok, KIT11_DB: undefined }).join()).toMatch(/late-failure\*\.sqlite/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_PLATFORM: "on" }).join()).toMatch(/own sandbox account/);
    expect(lateFailureRefusals({ ...ok, AIRWALLEX_OAUTH: "on" }).join()).toMatch(/AIRWALLEX_OAUTH off/);
    expect(lateFailureRefusals({})).toHaveLength(3);
    expect(LATE_FAILURE_MAX_BUDGET).toBe(30);
  });

  it("knows the run's own ledger by its name", () => {
    expect(lateFailureLedger(ok)).toBe(true);
    expect(lateFailureLedger({ KIT11_DB: "/runs/late-failure.sqlite" })).toBe(true);
    expect(lateFailureLedger({ KIT11_DB: "data/late-failure/kit11.sqlite" })).toBe(false);
    expect(lateFailureLedger({})).toBe(false);
  });
});

describe("late-failure ledger refusals", () => {
  const transfer = (db: ReturnType<typeof openDb>, invoiceNo: string, id: string | null) => {
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, 'Stockline Data GmbH', '240.00', 'EUR', '2026-12-15', 'sha', 'BYLADEM1001', 'doc', 'PROPOSED')").run(invoiceNo);
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, transfer_id) VALUES (?, ?, '240.00', 'EUR', 'SWIFT', '20.00', ?, 'sha', 'now', ?)")
      .run(`req-${invoiceNo}`, invoiceNo, id ? "IN_APPROVAL" : "SUBMITTING", id);
  };

  it("create runs on a fresh ledger only: not beside an active passkey", () => {
    const db = openDb(":memory:");
    expect(lateFailureLedgerRefusal("create", db)).toBeUndefined();
    db.prepare("INSERT INTO passkeys (credential_id, public_key, counter, rp_id, origin, label, registration_json, enrolled_at, status) VALUES ('c1', 'pk', 0, 'rp', 'https://rp', 'Max', '{}', 'now', 'ACTIVE')").run();
    expect(lateFailureLedgerRefusal("create", db)).toMatch(/already has an active passkey \(Max\)/);
  });

  it("create refuses when either invoice already has a transfer, even one never answered", () => {
    const db = openDb(":memory:");
    transfer(db, "SLL-2026-11R2 · Stockline Data GmbH", null);
    expect(lateFailureLedgerRefusal("create", db)).toMatch(/SLL-2026-11R2 already has a transfer/);
    transfer(db, "SLL-2026-11R1", "t-1");
    expect(lateFailureLedgerRefusal("create", db)).toMatch(/SLL-2026-11R1 and SLL-2026-11R2 already have transfers/);
  });

  it("follow, settle, fail and recheck run only once both transfers exist", () => {
    const db = openDb(":memory:");
    for (const cmd of ["follow", "settle", "fail", "recheck"]) expect(lateFailureLedgerRefusal(cmd, db)).toMatch(/no transfer for SLL-2026-11R1 and SLL-2026-11R2/);
    transfer(db, "SLL-2026-11R1 · Stockline Data GmbH", "t-1");
    expect(lateFailureLedgerRefusal("follow", db)).toMatch(/no transfer for SLL-2026-11R2 in this ledger yet/);
    transfer(db, "SLL-2026-11R2 · Stockline Data GmbH", "t-2");
    for (const cmd of ["follow", "settle", "fail", "recheck"]) expect(lateFailureLedgerRefusal(cmd, db)).toBeUndefined();
  });
});

describe("npm run late-failure", () => {
  it("refuses a live command without its settings, before any client exists", () => {
    const r = cli(["create"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/REFUSED {2}LATE_FAILURE_GO=yes/);
    expect(r.err).toMatch(/REFUSED {2}KIT11_DB=…\/late-failure\*\.sqlite/);
    expect(cli(["record"]).code).toBe(2);
    expect(cli(["nonsense"]).code).toBe(2);
  }, 150_000);

  it("stand-in: R1 returned after PAID, R2 failed after SENT, both to a person, two transfers created; 0 network", () => {
    const r = cli(["stand-in"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/^FAIL/m);
    expect(r.out.match(/^PASS/gm)).toHaveLength(4);
    expect(r.out).toContain("signed by late-failure virtual test passkey");
    expect(r.out).toMatch(/STAND-IN create .*: 6 GET \/balances\/current, 2 POST \/transfers\/create$/m);
    expect(r.out).toMatch(/STAND-IN AFTER {4}SLL-2026-11R1: transfer CANCELLED, invoice needs_review/);
    expect(r.out).toMatch(/STAND-IN AFTER {4}SLL-2026-11R2: transfer CANCELLED, invoice needs_review/);
  }, 150_000);

  it("stand-in --refused: FAILED after PAID refused, recorded once and not retried; R1 stays paid", () => {
    const r = cli(["stand-in", "--refused"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/STAND-IN REFUSED {2}SLL-2026-11R1 .*: FAILED from PAID: 400 invalid_status_transition/);
    expect(r.out).toMatch(/STAND-IN AFTER {4}SLL-2026-11R1: transfer PAID, invoice paid/);
    expect(r.out.match(/^PASS/gm)).toHaveLength(4);
  }, 150_000);
});

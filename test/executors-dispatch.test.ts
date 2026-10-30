// The executor dispatch (src/executors/index.ts): an approved proposal runs through exactly the executor for its kind,
// an unknown kind runs nothing, and a kind that needs Airwallex refuses before executing when its keys are not set.
// Each executor is a spy here (they have their own tests); the database is real. No network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ awx: null as unknown, issuing: null as unknown, calls: [] as unknown[][] }));
const spy = (name: string) => vi.fn(async (...a: unknown[]) => { h.calls.push([name, ...a.slice(1)]); });

vi.mock("../src/executors/mandateReplace.js", () => ({ executeMandateReplace: spy("mandate_replace") }));
vi.mock("../src/executors/refundBatch.js", () => ({ executeRefundBatch: spy("refund_batch") }));
vi.mock("../src/executors/invoicePayment.js", () => ({ executeInvoicePayment: spy("invoice_payment") }));
vi.mock("../src/executors/devTest.js", () => ({ executeDevTest: spy("dev_test") }));
vi.mock("../src/executors/policyChange.js", () => ({ executePolicyChange: vi.fn((...a: unknown[]) => { h.calls.push(["policy_change", ...a.slice(1)]); }) }));
vi.mock("../src/policy/cards.js", () => ({ syncCardsAfterPolicy: spy("sync_cards") }));
vi.mock("../src/policy/payeeChange.js", () => ({ executePayeeChange: spy("payee_change") }));
vi.mock("../src/platform/externalAgents.js", () => ({ executeAgentOnboard: spy("agent_onboard") }));
vi.mock("../src/airwallex/adapter.js", () => ({ airwallexFromEnv: async () => h.awx }));
vi.mock("../src/airwallex/issuing.js", () => ({ issuingFromEnv: () => h.issuing }));

const { execute } = await import("../src/executors/index.js");
const { openDb } = await import("../src/db/open.js");
type DB = ReturnType<typeof openDb>;

const AWX = { rail: { name: "awx-rail" }, sim: { name: "awx-sim" } };
const ISSUING = { rail: { name: "issuing-rail" }, sim: {} };
let db: DB;
let n = 0;
function proposal(kind: string): string {
  const id = `P-${++n}`;
  db.prepare(`INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at)
    VALUES (?, ?, '{}', ?, 'test', 'APPROVED', '2099-01-01T00:00:00Z', 'now')`).run(id, kind, `sha-${id}`);
  return id;
}

beforeEach(() => {
  db = openDb(":memory:");
  h.calls = [];
  h.awx = AWX;
  h.issuing = ISSUING;
});

describe("execute", () => {
  it("refuses a proposal id it does not know", async () => {
    // Fails if: the missing-row check is removed (execute would run with an undefined kind).
    await expect(execute(db, "P-404")).rejects.toThrow("no proposal P-404");
    expect(h.calls).toEqual([]);
  });

  it("refuses an unknown kind and runs no executor", async () => {
    const id = proposal("wire_everything");
    // Fails if: the default branch stops throwing, or an unknown kind falls through to some executor.
    await expect(execute(db, id)).rejects.toThrow("no executor for wire_everything yet");
    expect(h.calls).toEqual([]);
  });

  it.each([
    ["mandate_replace", [["mandate_replace", "P-?"]]],
    ["refund_batch", [["refund_batch", "P-?"]]],
    ["dev_test", [["dev_test", "P-?"]]],
  ])("runs %s through its own executor only", async (kind, expected) => {
    const id = proposal(kind);
    await execute(db, id);
    // Fails if: a case in the dispatch is swapped or removed.
    expect(h.calls).toEqual((expected as unknown[][]).map((c) => c.map((x) => (x === "P-?" ? id : x))));
  });

  it("runs a policy change, then brings the cards at Airwallex in line with it", async () => {
    const id = proposal("policy_change");
    await execute(db, id);
    // Fails if: the card sync after a policy change is dropped (a lowered card limit would not reach the card).
    expect(h.calls).toEqual([["policy_change", id], ["sync_cards", id, ISSUING.rail]]);
  });

  it("still records the policy change without Airwallex keys, syncing against no rail", async () => {
    h.issuing = null;
    const id = proposal("policy_change");
    await execute(db, id);
    // Fails if: a missing issuing rail is not passed as null.
    expect(h.calls).toEqual([["policy_change", id], ["sync_cards", id, null]]);
  });

  it("onboards an agent on the issuing rail, and refuses without Airwallex keys", async () => {
    const id = proposal("agent_onboard");
    await execute(db, id);
    expect(h.calls).toEqual([["agent_onboard", ISSUING.rail, id]]);
    h.calls = [];
    h.issuing = null;
    // Fails if: onboarding runs without the issuing rail (no card could be issued, but state would move).
    await expect(execute(db, proposal("agent_onboard"))).rejects.toThrow("the card cannot be issued");
    expect(h.calls).toEqual([]);
  });

  it("runs payee changes and invoice payments on the Airwallex rail", async () => {
    const a = proposal("payee_change");
    const b = proposal("invoice_payment");
    await execute(db, a);
    await execute(db, b);
    // Fails if: the rail or the sandbox simulator is not passed through.
    expect(h.calls).toEqual([["payee_change", AWX.rail, a], ["invoice_payment", AWX.rail, AWX.sim, b]]);
  });

  it("refuses payee changes and invoice payments without Airwallex keys, before executing anything", async () => {
    h.awx = null;
    // Fails if: the awx null checks are removed (the executor would run against an undefined rail).
    await expect(execute(db, proposal("payee_change"))).rejects.toThrow("the new account cannot be added");
    await expect(execute(db, proposal("invoice_payment"))).rejects.toThrow("the payment cannot run");
    expect(h.calls).toEqual([]);
  });
});

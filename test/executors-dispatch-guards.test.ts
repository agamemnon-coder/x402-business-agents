// More of the executor dispatch (src/executors/index.ts), beside test/executors-dispatch.test.ts: the branches that
// stop money moving when something is missing or failed. A pause whose chain step fails still freezes the agent's card
// and still fails the run; a kind that needs Airwallex refuses before its executor runs when the keys are not set; and
// the check against Airwallex's own ledger after a payout never fails the payment it follows. Each executor is a spy
// (they have their own tests); the database is real. No network, test money only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  awx: null as unknown, issuing: null as unknown, calls: [] as unknown[][], pause: false, pauseFails: false,
  ftOn: false, reconcileFails: false,
}));
const spy = (name: string) => vi.fn(async (...a: unknown[]) => { h.calls.push([name, ...a.slice(1)]); });

vi.mock("../src/executors/policyChange.js", () => ({
  executePolicyChange: vi.fn((...a: unknown[]) => { h.calls.push(["policy_change", ...a.slice(1)]); }),
  touchesPause: () => h.pause,
}));
vi.mock("../src/policy/pause.js", () => ({
  executePauseChange: vi.fn(async (_db: unknown, id: string) => {
    h.calls.push(["pause_change", id]);
    if (h.pauseFails) throw new Error("the revoke did not land on chain");
  }),
  pausedCredential: () => null,
}));
vi.mock("../src/metal/pauseChain.js", async (original) => ({ ...await original<object>(), LivePauseChain: class {} }));
vi.mock("../src/policy/cards.js", () => ({ syncCardsAfterPolicy: spy("sync_cards") }));
vi.mock("../src/airwallex/adapter.js", () => ({ airwallexFromEnv: async () => h.awx }));
vi.mock("../src/airwallex/issuing.js", () => ({ issuingFromEnv: () => h.issuing }));
vi.mock("../src/agents/askPurser.js", () => ({ executeTaskCard: spy("task_card") }));
vi.mock("../src/policy/quarantine.js", () => ({ executeQuarantineRelease: vi.fn(async (_db: unknown, _policy: unknown, key: string, id: string) => { h.calls.push(["quarantine_release", key, id]); }) }));
vi.mock("../src/metal/receivePolicy.js", async (original) => ({ ...await original<object>(), LiveReceivePolicy: class {} }));
vi.mock("../src/metal/agentCli.js", async (original) => ({ ...await original<object>(), keyPath: (name: string) => `/keys/${name}` }));
vi.mock("../src/ap/vendors.js", () => ({ executePayeeAdd: vi.fn(async (_db: unknown, rail: unknown, id: string, o: unknown) => { h.calls.push(["payee_add", rail, id, o]); }) }));
vi.mock("../src/ap/books.js", () => ({ payablesSink: () => "payables-sink" }));
vi.mock("../src/executors/supplierPayment.js", () => ({ executeSupplierPayment: spy("supplier_payment") }));
vi.mock("../src/finance/awxFinancialTx.js", () => ({
  financialTxOn: () => h.ftOn,
  ftBySourceVia: () => async () => [],
  reconcileLedgerAtAirwallex: vi.fn(async (_db: unknown, _read: unknown, o: { only: string[] }) => {
    h.calls.push(["reconcile", o.only]);
    if (h.reconcileFails) throw new Error("Airwallex answered 503");
  }),
}));

const { execute, reconcileAfterPayout } = await import("../src/executors/index.js");
const { openDb } = await import("../src/db/open.js");
type DB = ReturnType<typeof openDb>;

const AWX = { rail: { name: "awx-rail" }, sim: { name: "awx-sim" } };
const ISSUING = { rail: { name: "issuing-rail" }, sim: {} };
let db: DB;
let n = 0;
function proposal(kind: string, terms: Record<string, unknown> = {}): string {
  const id = `P-${++n}`;
  db.prepare(`INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'test', 'APPROVED', '2099-01-01T00:00:00Z', 'now')`).run(id, kind, JSON.stringify(terms), `sha-${id}`);
  return id;
}

beforeEach(() => {
  db = openDb(":memory:");
  Object.assign(h, { calls: [], awx: AWX, issuing: ISSUING, pause: false, pauseFails: false, ftOn: false, reconcileFails: false });
});

describe("pausing or resuming one agent", () => {
  it("runs the chain step, then brings the cards in line, and never runs it as an ordinary policy change", async () => {
    h.pause = true;
    const id = proposal("policy_change");
    await execute(db, id);
    expect(h.calls).toEqual([["pause_change", id], ["sync_cards", id, ISSUING.rail]]);
  });

  it("still freezes the card when the chain step fails, and then fails the run", async () => {
    // The agent is paused in Purser whatever the chain said: its card must not keep paying.
    h.pause = true;
    h.pauseFails = true;
    const id = proposal("policy_change");
    await expect(execute(db, id)).rejects.toThrow("the revoke did not land on chain");
    expect(h.calls).toEqual([["pause_change", id], ["sync_cards", id, ISSUING.rail]]);
  });
});

describe("kinds that need a rail refuse without one, before their executor runs", () => {
  it("issues a task card on the issuing rail, and refuses without Airwallex keys", async () => {
    const id = proposal("task_card");
    await execute(db, id);
    expect(h.calls).toEqual([["task_card", ISSUING.rail, id]]);
    h.calls = [];
    h.issuing = null;
    await expect(execute(db, proposal("task_card"))).rejects.toThrow("the task card cannot be issued");
    expect(h.calls).toEqual([]);
  });

  it("adds a payables supplier on the Airwallex rail, into the payables books, and refuses without keys", async () => {
    const id = proposal("payee_add");
    await execute(db, id);
    expect(h.calls).toEqual([["payee_add", AWX.rail, id, { sink: "payables-sink" }]]);
    h.calls = [];
    h.awx = null;
    await expect(execute(db, proposal("payee_add"))).rejects.toThrow("the new supplier cannot be added");
    expect(h.calls).toEqual([]);
  });

  it("pays a supplier on the Airwallex rail and its simulator, and refuses without keys", async () => {
    const id = proposal("supplier_payment");
    await execute(db, id);
    expect(h.calls).toEqual([["supplier_payment", AWX.rail, AWX.sim, id]]);
    h.calls = [];
    h.awx = null;
    await expect(execute(db, proposal("supplier_payment"))).rejects.toThrow("the payment cannot run");
    expect(h.calls).toEqual([]);
  });

  it("releases quarantined money with the sweep key only", async () => {
    const id = proposal("quarantine_release");
    await execute(db, id);
    expect(h.calls).toEqual([["quarantine_release", "/keys/sweep.key.json", id]]);
  });
});

describe("after a payout: Airwallex's own ledger, without failing the payment", () => {
  function paidOut(): string {
    db.pragma("foreign_keys = OFF");
    db.prepare(`INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at)
      VALUES ('tr-1', 'req-tr', 'INV-1', '1850.00', 'EUR', 'SWIFT', '0.00', 'PAID', 'sha', 'now')`).run();
    db.prepare(`INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, status, approval_sha256)
      VALUES ('conv-1', 'q-1', 'req-fx', '1850.00', 'SETTLED', 'sha')`).run();
    return proposal("invoice_payment", { transfer_request_id: "req-tr", conversion: { request_id: "req-fx" } });
  }
  const read = async () => [];

  it("checks the payout and its conversion, and only those", async () => {
    h.ftOn = true;
    await reconcileAfterPayout(db, paidOut(), new Date(), read);
    expect(h.calls).toEqual([["reconcile", ["tr-1", "conv-1"]]]);
  });

  it("does nothing when the check is switched off, or when nothing was paid out", async () => {
    const id = paidOut();
    await reconcileAfterPayout(db, id, new Date(), read);
    h.ftOn = true;
    await reconcileAfterPayout(db, proposal("invoice_payment", { transfer_request_id: "req-never-sent" }), new Date(), read);
    expect(h.calls).toEqual([]);
  });

  it("records a failed read in the audit log instead of failing the payment", async () => {
    h.ftOn = true;
    h.reconcileFails = true;
    const id = paidOut();
    await expect(reconcileAfterPayout(db, id, new Date(), read)).resolves.toBeUndefined();
    const row = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'awx_ft.read_error'").get() as { subject: string; payload_json: string };
    expect(row.subject).toBe(id);
    expect(JSON.parse(row.payload_json)).toMatchObject({ after: "payout", error: "Airwallex answered 503" });
  });

  it("without Airwallex keys and no reader handed in, reads nothing", async () => {
    vi.stubEnv("AIRWALLEX_CLIENT_ID", "");
    vi.stubEnv("AIRWALLEX_API_KEY", "");
    h.ftOn = true;
    await reconcileAfterPayout(db, paidOut());
    expect(h.calls).toEqual([]);
    vi.unstubAllEnvs();
  });
});

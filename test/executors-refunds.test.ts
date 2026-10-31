// Refunds (src/executors/refunds.ts) and approved refund batches (src/executors/refundBatch.ts): a refund goes back to
// the payer only, never above what the sale cost, at most once per sale under payment id refund-<sale_id>; the CFO
// policy cap and the velocity gate are checked before signing; a pull already sent keeps its state when a later check
// refuses; a batch runs only as approved and a re-run never pays a refund twice. The metal-agent CLI and the mandate
// are fakes; the ledger and the approval flow are real. No network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliResult } from "../src/metal/agentCli.js";

const h = vi.hoisted(() => ({ cli: [] as string[][], answer: null as null | ((args: string[]) => CliResult) }));
vi.mock("../src/metal/agentCli.js", () => ({
  metalAgent: (args: string[], okCodes: number[] = [0]) => {
    h.cli.push(args);
    const r = h.answer!(args);
    if (!okCodes.includes(r.code)) throw new Error(`metal-agent exited ${r.code}`);
    return r;
  },
}));
vi.mock("../src/metal/mandate.js", () => ({
  activeMandate: async (agent: string) => ({ agent, credentialPath: `/keys/${agent}.credential.json`, keyFile: `/keys/${agent}.key.json` }),
}));

const { refundSale } = await import("../src/executors/refunds.js");
const { executeRefundBatch } = await import("../src/executors/refundBatch.js");
const { openDb } = await import("../src/db/open.js");
const { createProposal, decide } = await import("../src/policy/approvals.js");
const { TERMS_SCHEMA } = await import("../src/lib/terms.js");
const { velocityGate } = await import("../src/policy/velocity.js");
const { VELOCITY } = await import("../src/config/policy.js");
type DB = ReturnType<typeof openDb>;

const PAYER = "0x00000000000000000000000000000000000000c1" as const;
const OTHER = "0x00000000000000000000000000000000000000c2" as const;
const cli = (code: number, lines: string[] = []): CliResult => {
  const fields = new Map<string, string[]>();
  for (const l of lines) { const i = l.indexOf(" "); if (i > 0) fields.set(l.slice(0, i), [...(fields.get(l.slice(0, i)) ?? []), l.slice(i + 1)]); }
  return { code, fields, out: lines.join("\n") };
};
const paymentIds = () => h.cli.map((a) => a[a.indexOf("--payment-id") + 1]);
const events = (db: DB, e: string) => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { subject: string; payload_json: string }[]).map((r) => ({ subject: r.subject, ...JSON.parse(r.payload_json) as Record<string, unknown> }));
const refundRow = (db: DB, sale: number) => db.prepare("SELECT payment_id, amount_cents, outcome, tx_hash, refusal_reason FROM refunds WHERE sale_id = ?").get(sale);

let db: DB;
function sale(cents = 5, payer: string = PAYER, status = "DELIVERED"): number {
  return Number(db.prepare(`INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at)
    VALUES ('GET /v1/stock', ?, ?, 'u', '{}', ?, 'now')`).run(cents, payer, status).lastInsertRowid);
}

beforeEach(() => {
  db = openDb(":memory:");
  db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-1', 'Summit Outfitters', 'x', 'now')").run();
  h.cli = [];
  h.answer = () => cli(0, ["transaction 0xr1"]);
});

describe("refundSale", () => {
  it("pulls once under the support mandate to the payer, with payment id refund-<sale_id>", async () => {
    const s = sale(5);
    const r = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    expect(r).toEqual({ sale_id: s, payment_id: `refund-${s}`, outcome: "PAID", tx: "0xr1", reason: null, already: false });
    // Fails if: the pull loses its payment id (metal-agent's at-most-once key) or goes under another mandate.
    expect(h.cli).toEqual([["mandate", "pull", "--credential", "/keys/support.credential.json", "--mandate-key-file", "/keys/support.key.json", "--to", PAYER, "--amount", "0.05", "--payment-id", `refund-${s}`]]);
    expect(refundRow(db, s)).toEqual({ payment_id: `refund-${s}`, amount_cents: 5, outcome: "PAID", tx_hash: "0xr1", refusal_reason: null });
    expect(events(db, "refund.paid")).toEqual([expect.objectContaining({ subject: String(s), payment_id: `refund-${s}`, amount: "0.05", tx: "0xr1" })]);
  });

  it("answers a second request for a paid refund from the ledger, without calling metal-agent", async () => {
    const s = sale(5);
    await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    const again = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    // Fails if: the PAID/HELD short-circuit is removed (a second pull would be attempted).
    expect(again).toEqual({ sale_id: s, payment_id: `refund-${s}`, outcome: "PAID", tx: "0xr1", reason: null, already: true });
    expect(h.cli).toHaveLength(1);
  });

  it("on an explicit retry, asks metal-agent again under the same payment id and reports 'already paid'", async () => {
    const s = sale(5);
    await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    h.answer = () => cli(0, ["already paid, nothing sent", "transaction 0xr1"]);
    const r = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" }, { retry: true });
    // Fails if: a retry draws a new payment id (it would pay again) or the "already" line is not recognised.
    expect(paymentIds()).toEqual([`refund-${s}`, `refund-${s}`]);
    expect(r).toMatchObject({ outcome: "PAID", already: true });
    expect(events(db, "refund.already_paid")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 1 });
  });

  // Review of the agents work: s2's RETRY line called refundSale({retry}) for a sale that had no refund yet, and paid it
  // with no approval (for example while the batch waited for the CFO's Face ID). A retry only repeats a refund.
  it("never starts a refund on a retry: a sale with no refund yet is not paid", async () => {
    const s = sale(5);
    const r = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" }, { retry: true });
    expect(r).toMatchObject({ outcome: "REFUSED", already: false, reason: expect.stringMatching(/nothing to retry/) });
    expect(h.cli).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 0 });
  });

  it("retries a pending refund under the same payment id", async () => {
    const s = sale(5);
    h.answer = () => cli(3, ["transaction 0xp", "reason submitted"]);
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "PENDING", tx: "0xp" });
    h.answer = () => cli(0, []);
    // Fails if: PENDING is short-circuited like PAID (it would never finish) or retried under a new id.
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "PAID", already: false });
    expect(paymentIds()).toEqual([`refund-${s}`, `refund-${s}`]);
    // Fails if: COALESCE drops the tx known from the first attempt.
    expect(refundRow(db, s)).toMatchObject({ outcome: "PAID", tx_hash: "0xp" });
  });

  it("records metal-agent's refusal with its reason; a held pull as HELD", async () => {
    const a = sale(5);
    h.answer = () => cli(1, ["reason mandate_payee_not_listed"]);
    // Fails if: exit 1 is not REFUSED or the reason is not stored as refusal_reason.
    expect(await refundSale(db, { sale_id: a, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "REFUSED", reason: "mandate_payee_not_listed" });
    expect(refundRow(db, a)).toMatchObject({ outcome: "REFUSED", refusal_reason: "mandate_payee_not_listed" });
    const b = sale(5);
    h.answer = () => cli(4, ["transaction 0xheld"]);
    // Fails if: exit 4 is not HELD.
    expect(await refundSale(db, { sale_id: b, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "HELD", tx: "0xheld" });
  });

  it("refunds only the payer, only a delivered sale, and never more than the sale cost", async () => {
    const s = sale(5);
    // Fails if: the payer check is removed (a refund could be sent to anyone).
    await expect(refundSale(db, { sale_id: s, amount_cents: 5, to: OTHER, dispute_id: "D-1" })).rejects.toThrow(/goes back to the payer only/);
    // Fails if: the amount ceiling is removed.
    await expect(refundSale(db, { sale_id: s, amount_cents: 6, to: PAYER, dispute_id: "D-1" })).rejects.toThrow(`refund 6 exceeds what sale ${s} cost`);
    const aborted = sale(5, PAYER, "ABORTED_NO_CHARGE");
    // Fails if: a sale that charged nothing can be refunded.
    await expect(refundSale(db, { sale_id: aborted, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).rejects.toThrow(`no delivered sale ${aborted}`);
    expect(h.cli).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM refunds").get()).toEqual({ n: 0 });
  });

  it("matches the payer regardless of address case", async () => {
    const s = sale(5, PAYER.toUpperCase().replace("0X", "0x"));
    // Fails if: the payer comparison becomes case-sensitive (every checksummed payer would be refused).
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "PAID" });
  });

  it("checks the CFO policy's per-refund limit before signing, and records the reason", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap.support', '0.04', 'now')").run();
    const s = sale(5);
    const r = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    // Fails if: capRefusal is not consulted before metalAgent.
    expect(r).toEqual({ sale_id: s, payment_id: `refund-${s}`, outcome: "REFUSED", tx: null, reason: "policy_cap_exceeded: 0.05 is over the Support agent's limit of 0.04", already: false });
    expect(h.cli).toEqual([]);
    expect(refundRow(db, s)).toMatchObject({ outcome: "REFUSED", refusal_reason: expect.stringMatching(/^policy_cap_exceeded/) });
    expect(events(db, "refund.refused")).toHaveLength(1);
  });

  it("checks the velocity limit before signing", async () => {
    expect(velocityGate(db, "support", "metal", VELOCITY.support.usdzPerHourCents, new Date())).toBeNull();
    const s = sale(5);
    // Fails if: velocityGate is not consulted before metalAgent.
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" })).toMatchObject({ outcome: "REFUSED", reason: expect.stringMatching(/^velocity_exceeded/) });
    expect(h.cli).toEqual([]);
  });

  it("keeps a pending refund PENDING when a later check refuses, and records why it was deferred", async () => {
    const s = sale(5);
    h.answer = () => cli(3, ["transaction 0xp"]);
    await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', 'now')").run();
    const r = await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" });
    // Fails if: a refused retry overwrites PENDING with REFUSED (a refund in flight would look unpaid and be paid again).
    expect(r).toEqual({ sale_id: s, payment_id: `refund-${s}`, outcome: "PENDING", tx: "0xp", reason: expect.stringMatching(/^frozen_by_cfo/), already: false });
    expect(refundRow(db, s)).toMatchObject({ outcome: "PENDING", tx_hash: "0xp" });
    expect(events(db, "refund.deferred")).toEqual([expect.objectContaining({ kept: "PENDING" })]);
    expect(h.cli).toHaveLength(1);
  });
});

describe("executeRefundBatch", () => {
  let n = 0;
  function batch(refunds: { sale_id: string; payment_id: string; to: string; amount: string }[], total: string) {
    const id = `P-R${++n}`;
    const terms = {
      schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: "2099-01-01T00:00:00Z",
      dispute_id: "D-1", customer: "Summit Outfitters", refunds, total, reason: "stock levels were wrong", evidence: [],
    };
    const p = createProposal(db, { terms: terms as never, createdBy: "support" });
    return { id, sha: p.terms_sha256 };
  }
  const approve = (b: { id: string; sha: string }) => decide(db, { proposalId: b.id, decision: "APPROVED", typedPrefix: b.sha.slice(0, 8), approver: "max", method: "cli" });
  const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
  const r = (s: number, amount = "0.05") => ({ sale_id: String(s), payment_id: `refund-${s}`, to: PAYER, amount });

  it("pays each approved refund once and marks the proposal EXECUTED", async () => {
    const [a, b] = [sale(5), sale(7)];
    const p = batch([r(a), r(b, "0.07")], "0.12");
    approve(p);
    await executeRefundBatch(db, p.id);
    expect(status(p.id)).toBe("EXECUTED");
    // Fails if: the batch pays other amounts or ids than the approved terms name.
    expect(h.cli.map((x) => [x[x.indexOf("--amount") + 1], x[x.indexOf("--payment-id") + 1]])).toEqual([["0.05", `refund-${a}`], ["0.07", `refund-${b}`]]);
    expect(db.prepare("SELECT proposal_id, dispute_id FROM refunds WHERE sale_id = ?").get(a)).toEqual({ proposal_id: p.id, dispute_id: "D-1" });
  });

  it("refuses a proposal that was not approved, and pays nothing", async () => {
    const p = batch([r(sale(5))], "0.05");
    // Fails if: beginExecution is bypassed (unapproved refunds would be paid).
    await expect(executeRefundBatch(db, p.id)).rejects.toThrow(`${p.id} is PENDING_APPROVAL, not approved`);
    expect(h.cli).toEqual([]);
  });

  it("refuses terms whose refunds do not add up to the approved total", async () => {
    const p = batch([r(sale(5)), r(sale(5))], "0.05");
    approve(p);
    // Fails if: the sum check is removed (the person approved a total that is not what would be paid).
    await expect(executeRefundBatch(db, p.id)).rejects.toThrow("refunds add up to 10 cents, not 0.05");
    expect(h.cli).toEqual([]);
    expect(status(p.id)).toBe("APPROVED");
  });

  it("refuses a payment id that does not name its sale", async () => {
    const s = sale(5);
    const p = batch([{ ...r(s), payment_id: "refund-999" }], "0.05");
    approve(p);
    // Fails if: the payment-id check is removed (a refund could slip past the one-per-sale key).
    await expect(executeRefundBatch(db, p.id)).rejects.toThrow(`payment id refund-999 does not name sale ${s}`);
    expect(h.cli).toEqual([]);
  });

  it("marks the batch FAILED when a refund is refused, listing each outcome", async () => {
    const [a, b] = [sale(5), sale(5)];
    const p = batch([r(a), r(b)], "0.10");
    approve(p);
    h.answer = (args) => (args.includes(`refund-${b}`) ? cli(1, ["reason mandate_budget_spent"]) : cli(0, ["transaction 0xok"]));
    await executeRefundBatch(db, p.id);
    // Fails if: a refused refund still lets the batch read EXECUTED.
    expect(status(p.id)).toBe("FAILED");
    const failed = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.failed'").get() as { payload_json: string }).payload_json);
    expect(failed).toEqual({ outcomes: [`${a}:PAID`, `${b}:REFUSED`] });
  });

  it("counts a held refund as done", async () => {
    const p = batch([r(sale(5))], "0.05");
    approve(p);
    h.answer = () => cli(4);
    await executeRefundBatch(db, p.id);
    // Fails if: HELD is treated as a failure (a re-run would be invited for money that may still settle).
    expect(status(p.id)).toBe("EXECUTED");
  });

  it("marks the batch FAILED when a refund throws, and a re-run never pays the first refund twice", async () => {
    const [a, b] = [sale(5), sale(5, OTHER)];
    const p = batch([r(a), r(b)], "0.10"); // the second goes to PAYER, but sale b was paid by OTHER
    approve(p);
    await expect(executeRefundBatch(db, p.id)).rejects.toThrow(/goes back to the payer only/);
    // Fails if: the catch that records FAILED is removed (the proposal would be stuck EXECUTING).
    expect(status(p.id)).toBe("FAILED");
    await expect(executeRefundBatch(db, p.id)).rejects.toThrow(/goes back to the payer only/);
    // Fails if: refundSale's PAID short-circuit is lost (the re-run would pull refund-a again).
    expect(paymentIds()).toEqual([`refund-${a}`]);
  });
});

// The Dispute desk end to end on a ledger: evidence from the stored sales, the seller's decision, refunds within the
// CFO's limits or a proposal for Face ID above them, and an explanation. The chain check is a stand-in here (the live
// one is verifyMandatePayment, run in docs/runs/2026-10-30-dispute-desk.md); refunds are a stand-in too.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { OrderEvidence } from "../src/agents/disputes.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb, type DB } from "../src/db/open.js";
import type { RefundResult } from "../src/executors/refunds.js";
import { disputeCases, openDisputeCase } from "../src/seller/desk.js";
import { evidenceFor } from "../src/seller/evidence.js";

const now = new Date("2026-10-30T10:00:00Z");
const CUSTOMER = "0x00000000000000000000000000000000000000c1" as Address;
const SELLER = "0x828c7de12cab8149aa516958433f6eee23aec875";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const offer = (nonce: string, units = "50000000000000000") =>
  `${b64({ alg: "ES256" })}.${b64({ nonce })}.sig~${b64(["s", { vct: "mandate.checkout.1", checkout_jwt: `h.${b64({ amount: units, id: SELLER, extra: { resource: "GET /v1/stock" } })}.s` }])}~`;

function sale(db: DB, seq: number, o: { offer?: string | null; cents?: number; body?: string } = {}): number {
  const body = o.body ?? JSON.stringify({ seq, stock: { on_hand: 90 + seq, reserved: 1 } });
  return Number(db.prepare(`INSERT INTO sales (route, price_cents, payer, signed_offer, tx_hash, request_url, request_params_json, body_sha256, body_json, status, created_at)
    VALUES ('mandate', ?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?)`).run(o.cents ?? 5, CUSTOMER, o.offer === undefined ? offer(`n${seq}`) : o.offer,
    `0x${String(seq).padStart(64, "0")}`, `http://127.0.0.1:4102/v1/stock?seq=${seq}`, JSON.stringify({ seq: String(seq) }),
    createHash("sha256").update(body, "utf8").digest("hex"), body, now.toISOString()).lastInsertRowid);
}
/** A chain check that accepts every sale with a signed order, or none (`within: false`). */
const chain = (within = true) => async (sales: { sale_id: number; seq: number; tx_hash: string; signed_offer: string }[]): Promise<OrderEvidence[]> =>
  sales.map((s) => ({ sale_id: s.sale_id, seq: s.seq, tx: s.tx_hash, payer_is_customer: true, signed_order: !!s.signed_offer, within_mandate: within && !!s.signed_offer,
    mandate_principal: CUSTOMER, mandate_bound_tx: `0x${"b".repeat(64)}`, detail: within ? "all steps pass" : "step 4 fails" }));
const paid: number[] = [];
const refund = async (_db: DB, r: { sale_id: number }): Promise<RefundResult> => {
  paid.push(r.sale_id);
  return { sale_id: r.sale_id, payment_id: `refund-${r.sale_id}`, outcome: "PAID", tx: `0x${"f".repeat(64)}`, reason: null, already: false };
};
const tools = (db: DB) => new Tools(db, new ClaudeReader(db, null));

describe("the evidence pack", () => {
  it("reads the signed order, the delivery hash and a reused order from the ledger", async () => {
    const db = openDb(":memory:");
    const a = sale(db, 1);
    const b = sale(db, 2, { offer: offer("n1") });
    const c = sale(db, 3, { body: "tampered" });
    db.prepare("UPDATE sales SET body_sha256 = ? WHERE sale_id = ?").run("0".repeat(64), c);
    const [pa, pb, pc] = await evidenceFor(db, [a, b, c], CUSTOMER, { verify: chain() });
    expect(pa!.order).toMatchObject({ present: true, valid: true, amount_cents: 5, pay_to: SELLER, first_use_sale: a });
    expect(pa!.request).toBe("GET /v1/stock?seq=1");
    expect(pa!.delivery.matches).toBe(true);
    expect(pa!.human.owner_bound).toBe(true);
    expect(pb!.order.first_use_sale).toBe(a);
    expect(pc!.delivery.matches).toBe(false);
  });
});

describe("a case", () => {
  it("rejects 'never ordered' with evidence, pays nothing, and explains", async () => {
    const db = openDb(":memory:");
    paid.length = 0;
    const ids = [sale(db, 5), sale(db, 6)];
    const c = await openDisputeCase(db, tools(db), { claim: "never_ordered", saleIds: ids, customer: CUSTOMER, text: "We never placed these." }, { verify: chain(), refund }, now);
    expect(c).toMatchObject({ route: "none", proposal_id: null, decision: { outcome: "rejected", refund_cents: 0 } });
    expect(paid).toEqual([]);
    expect(c.explanation).toMatch(/signed order/);
    expect(c.explained_by).toBe("code (no model)");
    expect(disputeCases(db).map((x) => x.case_id)).toEqual([c.case_id]);
    // The same claim on the same sales is the same case: nothing is decided or paid twice.
    expect((await openDisputeCase(db, tools(db), { claim: "never_ordered", saleIds: ids, customer: CUSTOMER, text: "We never placed these." }, { verify: chain(), refund }, now)).case_id).toBe(c.case_id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'dispute.decided'").get()).toEqual({ n: 1 });
  });

  it("refunds within the CFO's automatic limits at once, to the payer", async () => {
    const db = openDb(":memory:");
    paid.length = 0;
    const ids = [sale(db, 1, { offer: null }), sale(db, 2)];
    const c = await openDisputeCase(db, tools(db), { claim: "never_ordered", saleIds: ids, customer: CUSTOMER }, { verify: chain(), refund }, now);
    expect(c).toMatchObject({ route: "auto", decision: { outcome: "partial_refund", refund_cents: 5, refund_to: CUSTOMER } });
    expect(paid).toEqual([ids[0]]);
  });

  // Breaks if a refund above the CFO's limits could be paid without Face ID.
  it("proposes a refund above the limits for Face ID, with Opus's review beside it", async () => {
    const db = openDb(":memory:");
    paid.length = 0;
    const ids = [1, 2, 3, 4, 5].map((n) => sale(db, n));
    const c = await openDisputeCase(db, tools(db), { claim: "not_authorised", saleIds: ids, customer: CUSTOMER }, { verify: chain(false), refund }, now);
    expect(c).toMatchObject({ route: "approval", decision: { refund_cents: 25 } });
    expect(paid).toEqual([]);
    const p = db.prepare("SELECT kind, status, created_by, explanation FROM proposals WHERE proposal_id = ?").get(c.proposal_id) as { kind: string; status: string; created_by: string; explanation: string };
    expect(p).toMatchObject({ kind: "refund_batch", status: "PENDING_APPROVAL", created_by: "support" });
    expect(p.explanation).toMatch(/^\[no model\]/);
  });

  it("never refunds a sale twice", async () => {
    const db = openDb(":memory:");
    paid.length = 0;
    const id = sale(db, 1, { offer: null });
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-old', ?, 'x', 'now')").run(CUSTOMER);
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (?, ?, 5, ?, 'PAID', 'D-old')").run(id, `refund-${id}`, CUSTOMER);
    const c = await openDisputeCase(db, tools(db), { claim: "never_ordered", saleIds: [id], customer: CUSTOMER }, { verify: chain(), refund }, now);
    expect(c.decision.refund_cents).toBe(0);
    expect(c.decision.per_sale[0]!.why).toMatch(/Already refunded/);
    expect(paid).toEqual([]);
  });
});

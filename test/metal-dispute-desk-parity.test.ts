// examples/metal-dispute-desk is the Dispute desk's decision logic, packaged for any seller on Metal. Purser imports it
// rather than keeping a copy (src/seller/disputeDesk.ts, src/seller/evidence.ts, src/policy/refunds.ts). Each test here
// breaks if Purser and the example could decide differently: the same functions, the same case table, the same evidence
// from the same ledger, and the example's own copy of the two money helpers equal to src/lib/money.ts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import * as example from "../examples/metal-dispute-desk/src/index.js";
import { CASES } from "../examples/metal-dispute-desk/test/cases.js";
import type { OrderEvidence } from "../src/agents/disputes.js";
import { openDb, type DB } from "../src/db/open.js";
import { baseUnitsToCents as purserBaseUnitsToCents, fromCents as purserFromCents } from "../src/lib/money.js";
import { routeRefundBatch as purserRoute } from "../src/policy/refunds.js";
import * as purser from "../src/seller/disputeDesk.js";
import { evidenceFor } from "../src/seller/evidence.js";
import * as exampleMoney from "../examples/metal-dispute-desk/src/money.js";

describe("one source of truth", () => {
  it("Purser's Dispute desk exports are the example's", () => {
    expect(purser.decideDispute).toBe(example.decideDispute);
    expect(purser.orderOf).toBe(example.orderOf);
    expect(purser.CLAIM_WORDS).toBe(example.CLAIM_WORDS);
  });

  for (const c of CASES) {
    it(`Purser decides the case table the same: ${c.name}`, () => {
      expect(purser.decideDispute(c.claim, c.packs)).toEqual(example.decideDispute(c.claim, c.packs));
      expect(purser.decideDispute(c.claim, c.packs).per_sale.map((s) => s.refund_cents)).toEqual(c.refunds);
    });
  }

  it("Purser routes refunds as the example does, with the CFO's default limits", () => {
    const limits = { eachCents: 10, perDisputeCents: 20 };
    for (const batch of [[5, 5, 5], [11], Array(12).fill(5), [10, 10], [10, 10, 1]]) {
      expect(purserRoute(batch, limits)).toEqual(example.routeRefundBatch(batch, limits));
    }
    expect(purserRoute([5, 5, 5])).toEqual({ route: "auto" });
    expect(purserRoute(Array(12).fill(5)).route).toBe("approval");
  });
});

describe("the example's money helpers equal Purser's", () => {
  it("formats cents the same and refuses the same amounts", () => {
    for (const c of [0, 1, 5, 99, 100, 185000, Number.MAX_SAFE_INTEGER]) expect(exampleMoney.fromCents(c)).toBe(purserFromCents(c));
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => exampleMoney.fromCents(bad)).toThrow();
      expect(() => purserFromCents(bad)).toThrow();
    }
  });

  it("converts base units the same and refuses the same amounts", () => {
    for (const u of [0n, 10n ** 16n, 5n * 10n ** 16n, 123456n * 10n ** 16n]) expect(exampleMoney.baseUnitsToCents(u)).toBe(purserBaseUnitsToCents(u));
    for (const bad of [-1n, 1n, 10n ** 16n + 1n, (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 10n ** 16n]) {
      expect(() => exampleMoney.baseUnitsToCents(bad)).toThrow();
      expect(() => purserBaseUnitsToCents(bad)).toThrow();
    }
  });
});

describe("the same evidence from the same ledger", () => {
  const CUSTOMER = "0x00000000000000000000000000000000000000c1" as Address;
  const SELLER = "0x828c7de12cab8149aa516958433f6eee23aec875";
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const offer = (nonce: string) =>
    `${b64({ alg: "ES256" })}.${b64({ nonce })}.sig~${b64(["s", { vct: "mandate.checkout.1", checkout_jwt: `h.${b64({ amount: "50000000000000000", id: SELLER, extra: { resource: "GET /v1/stock" } })}.s` }])}~`;
  function sale(db: DB, seq: number, o: { offer?: string | null; body?: string } = {}): number {
    const body = o.body ?? JSON.stringify({ seq, stock: { on_hand: 90 + seq, reserved: 1 } });
    return Number(db.prepare(`INSERT INTO sales (route, price_cents, payer, signed_offer, tx_hash, request_url, request_params_json, body_sha256, body_json, status, created_at)
      VALUES ('mandate', 5, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', '2026-10-30T10:00:00.000Z')`).run(CUSTOMER, o.offer === undefined ? offer(`n${seq}`) : o.offer,
      `0x${String(seq).padStart(64, "0")}`, `http://127.0.0.1:4102/v1/stock?seq=${seq}`, JSON.stringify({ seq: String(seq) }),
      createHash("sha256").update(body, "utf8").digest("hex"), body).lastInsertRowid);
  }
  const chain = async (sales: { sale_id: number; seq: number; tx_hash: string; signed_offer: string | null }[]): Promise<OrderEvidence[]> =>
    sales.filter((s) => s.sale_id !== 4).map((s) => ({ sale_id: s.sale_id, seq: s.seq, tx: s.tx_hash, payer_is_customer: true, signed_order: !!s.signed_offer,
      within_mandate: !!s.signed_offer, mandate_principal: CUSTOMER, mandate_bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass" }));

  it("Purser's evidenceFor (SQLite) and the example's gatherEvidence (plain rows) build equal packs", async () => {
    const db = openDb(":memory:");
    const ids = [sale(db, 1), sale(db, 2, { offer: offer("n1") }), sale(db, 3, { body: "tampered" }), sale(db, 4), sale(db, 5, { offer: null })];
    db.prepare("UPDATE sales SET body_sha256 = ? WHERE sale_id = ?").run("0".repeat(64), ids[2]);
    const dataWrong = new Set([ids[0]!]);
    const fromPurser = await evidenceFor(db, ids, CUSTOMER, { verify: chain, dataWrong });
    const rows = db.prepare(`SELECT sale_id, CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq, price_cents, payer, tx_hash, signed_offer, body_json,
      requirements_json, request_url, body_sha256, settlement_id, created_at FROM sales ORDER BY sale_id`).all() as example.LedgerSale[];
    const fromExample = await example.gatherEvidence(rows, CUSTOMER, { check: chain, signedOrders: rows.filter((r) => r.signed_offer), dataWrong });
    expect(fromPurser.map(({ finality: _f, ...p }) => p)).toEqual(fromExample);
    for (const claim of Object.keys(example.CLAIM_WORDS) as example.DisputeClaim[]) {
      expect(purser.decideDispute(claim, fromPurser)).toEqual(example.decideDispute(claim, fromExample));
    }
  });
});

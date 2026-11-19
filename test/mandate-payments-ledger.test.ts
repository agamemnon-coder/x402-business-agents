// Every payment the ledger holds under an agent's mandate (src/policy/available.ts mandatePayments), the list the check
// against the chain names a difference from: the Support agent's refunds and the Treasury agent's sweeps, paid or on
// their way; the customer's sales with the nonce from their settlement id, a payment charged with no sale, one being
// settled and one that failed; and a Metal hold of the agent. Refused attempts are never listed.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { mandateAvailability, mandatePayments } from "../src/policy/available.js";
import { moneyWorld } from "./fakes/moneyWorld.js";

const NONCE = `0x${"AB".repeat(32)}`;
let db: DB;
const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[]);
/** Inserts a row with the given fields, filling any other required column with a plain value. */
const insert = (table: string, v: Record<string, unknown>) => {
  const row: Record<string, unknown> = { ...v };
  for (const c of cols(table)) if (!(c.name in row) && c.notnull && c.dflt_value === null) row[c.name] = /_at$|^at$/.test(c.name) ? "2026-11-19T10:00:00Z" : /cents|block|position/.test(c.name) ? 0 : "x";
  const k = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...k.map((x) => row[x]));
};

beforeEach(() => {
  db = openDb(":memory:");
  moneyWorld(db);
});

describe("the ledger's payments under each mandate", () => {
  it("support: refunds paid, pending and held; a refused one is not listed", () => {
    for (const [id, outcome] of [[3, "PENDING"], [4, "HELD"], [5, "REFUSED"]] as const) {
      db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at) VALUES (?, '/stock', 5, '0xr', ?, 'u', '{}', 'DELIVERED', '2026-11-07T10:00:00Z')").run(id, `0xs${id}`);
      db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (?, ?, ?, 5, '0xr', ?, NULL)").run(id, id, `refund-${id}`, outcome);
    }
    expect(mandatePayments(db, "support").map((p) => [p.what, p.state, p.tx])).toEqual([
      ["pay-r1 (refund of sale 1)", "paid", "0xref1"],
      ["refund-3 (refund of sale 3)", "pending", null],
      ["refund-4 (refund of sale 4)", "pending", null],
    ]);
    expect(mandateAvailability(db, "support")).toMatchObject({ paidCents: 5, pendingCents: 10 });
  });

  it("treasury: sweeps paid and on their way, newest last", () => {
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-2', 3, '0xSW2', 'PENDING', '2026-11-08T11:00:00Z')").run();
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-3', 3, NULL, 'REFUSED', '2026-11-08T12:00:00Z')").run();
    expect(mandatePayments(db, "treasury")).toEqual([
      { what: "sw-1", cents: 2, tx: "0xsw1", nonce: null, state: "paid" },
      { what: "sw-2", cents: 3, tx: "0xsw2", nonce: null, state: "pending" },
    ]);
  });

  it("customer: delivered sales with the nonce their settlement id ends in, and settlements with no sale behind them", () => {
    db.prepare("UPDATE sales SET settlement_id = ? WHERE sale_id = 1").run(`exact:0xpayer:${NONCE}`);
    const hasSettlements = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sale_settlements'").get();
    expect(hasSettlements).toBe(true);
    insert("sale_settlements", { key: "0xpayer00000000000001:n1", nonce: `0x${"01".repeat(32)}`, price_cents: 5, status: "CHARGED", tx_hash: "0xCHG", detail: "found by the reconciliation", started_at: "2026-11-08T09:00:00Z" });
    insert("sale_settlements", { key: "0xpayer00000000000002:n2", nonce: `0x${"02".repeat(32)}`, price_cents: 5, status: "SETTLING", started_at: "2026-11-08T09:01:00Z" });
    insert("sale_settlements", { key: "0xpayer00000000000003:n3", nonce: `0x${"03".repeat(32)}`, price_cents: 5, status: "FAILED", detail: "the facilitator said no", started_at: "2026-11-08T09:02:00Z" });
    const p = mandatePayments(db, "customer");
    expect(p[0]).toEqual({ what: "sale 1", cents: 5, tx: "0xsale1", nonce: NONCE.toLowerCase(), state: "paid" });
    expect(p.slice(1).map((x) => [x.what, x.state, x.detail])).toEqual([
      ["a payment by 0xpayer000… charged with no delivery recorded", "paid", "found by the reconciliation"],
      ["a sale being settled (paid by 0xpayer000…)", "pending", undefined],
      ["a sale being settled (paid by 0xpayer000…)", "failed", "the facilitator said no"],
    ]);
    expect(p[2]!.since).toBe("2026-11-08T09:01:00Z");
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 10, pendingCents: 5 });
  });

  it("a Metal hold of the agent is listed as held; another agent's or a card hold is not", () => {
    insert("holds", { ref: "upstream:3:abc", agent: "sourcing", rail: "metal", cents: 3, status: "HELD", created_at: "2026-11-08T10:00:00Z" });
    insert("holds", { ref: "card:1", agent: "sourcing", rail: "card", cents: 900, status: "HELD", created_at: "2026-11-08T10:00:00Z" });
    insert("holds", { ref: "upstream:4:def", agent: "support", rail: "metal", cents: 3, status: "HELD", created_at: "2026-11-08T10:00:00Z" });
    const held = mandatePayments(db, "sourcing").filter((p) => p.state === "held");
    expect(held).toEqual([{ what: "the hold upstream:3:abc", cents: 3, tx: null, nonce: null, state: "held", since: "2026-11-08T10:00:00Z" }]);
    expect(mandatePayments(db, "nobody")).toEqual([]);
  });
});

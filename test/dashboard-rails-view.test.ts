// The dashboard's rails panel (src/dashboard/rails.ts railsView): what each rail did, from the ledger, with proof only
// where there is a real one. Retailers' payments matched or escalated, webhooks the ledger could or could not explain,
// refusals by Purser, recorded on chain or by Alta's facilitator, payments under a revoked mandate, the sweep after
// finality, clearing sales, money from strangers held, and the dispute desk counting the orders of a case.
import type { Json } from "@metalntwx/metal-pay/mandates";
import { beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { railsView } from "../src/dashboard/rails.js";
import { moneyWorld } from "./fakes/moneyWorld.js";

const TX = `0x${"c".repeat(64)}`;
const at = (n: number) => new Date(Date.parse("2026-11-19T10:00:00Z") + n * 1000);
let db: DB;
let n = 0;
const row = (event: string, subject: string | null, payload: Record<string, unknown>) => audit(db, "system", event, subject, payload as Json, at(n++));
const item = (rail: "airwallex" | "metal", what: string) => railsView(db)[rail].find((x) => x.what === what);

beforeEach(() => {
  db = openDb(":memory:");
  n = 0;
});

describe("the rails panel", () => {
  it("is empty for an empty ledger", () => {
    expect(railsView(db)).toEqual({ airwallex: [], metal: [] });
  });

  it("Airwallex: charges and declines by the card, a payout simulated as paid, retailers' payments, earnings booked", () => {
    moneyWorld(db);
    row("credit.deposited", null, { amount: "0.20", deposit_id: "dep_1" });
    db.prepare("INSERT INTO receipts (deposit_id, currency, amount_cents, payer, invoice_no, applied_cents, outcome, detail, received_at) VALUES ('dep_in_2', 'GBP', 900, 'X', NULL, 0, 'UNMATCHED', 'no invoice', '2026-11-08T13:00:00Z')").run();
    expect(item("airwallex", "Approved by Airwallex")).toMatchObject({ detail: "1 charge, €49.00 in all, inside the card's limits", simulated: true });
    expect(item("airwallex", "Declined by Airwallex")!.detail).toBe("1 charge the card refused itself (merchant category not allowed); the agent could not spend past it");
    const payouts = railsView(db).airwallex.filter((x) => x.what === "SWIFT payout of an invoice");
    expect(payouts.map((p) => p.simulated)).toEqual([true, true]);
    expect(payouts[0]!.detail).toMatch(/^EUR 100\.00 to the allowlisted supplier, PAID .*, fee EUR 12\.50;/);
    expect(item("airwallex", "Retailers pay into Global Accounts")!.detail).toBe("2 payments in EUR and GBP: 1 matched to their invoice, 1 escalated to the CFO (short, or no invoice)");
    expect(item("airwallex", "Alta earnings booked at Airwallex")!.proof).toEqual({ label: "Airwallex id dep_1", href: null });
  });

  it("webhooks: all matched, or how many the ledger could not explain", () => {
    db.prepare("INSERT INTO airwallex_events (event_id, name, object, object_id, status, amount_cents, currency, agrees, outcome, received_at) VALUES ('evt_1', 'payout.transfer.paid', 'transfer', 'tr_1', 'PAID', NULL, NULL, 1, 'ok', 'a')").run();
    expect(item("airwallex", "Airwallex reports each change by webhook")!.detail).toMatch(/1 events on 1 kinds of object, .*; all matched the ledger$/);
    db.prepare("INSERT INTO airwallex_events (event_id, name, object, object_id, status, amount_cents, currency, agrees, outcome, received_at) VALUES ('evt_2', 'issuing.card.active', 'card', 'c', 'ACTIVE', NULL, NULL, 0, 'odd', 'b')").run();
    const w = item("airwallex", "Airwallex reports each change by webhook")!;
    expect(w.detail).toMatch(/2 events on 2 kinds of object, .*; 1 the ledger could not explain, raised as an alarm$/);
    expect(w.proof).toEqual({ label: "Airwallex id evt_1", href: null });
  });

  it("Alta: refusals by Purser, on chain and by the facilitator; under a revoked mandate; a replace; the sweep after finality", () => {
    row("mandate.bound", "sourcing", { cap: "0.03", budget: "10.00", tx: TX });
    row("mandate.bound", "outsider", { cap: "1.00", budget: "1.00" });
    row("mandate.replaced", "sourcing", { cap: "0.04", budget: "12.00", tx: "0xshort" });
    row("upstream.refused", "1", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment" });
    row("upstream.refused", "2", { reason: "mandate_cap_exceeded", refused_by: "metal" });
    row("upstream.refused", "3", { reason: "mandate_revoked", refused_by: "metal" });
    row("upstream.refused", "4", { reason: "mandate_revoked", refused_by: "metal" });
    row("upstream.refused", "5", { reason: "buy_policy: thin margin" });
    row("upstream.refused_on_chain", "2", { tx: TX });
    row("credit.locked", null, { block: 10, finalized_block: 12, tx: TX });
    const m = railsView(db).metal;
    expect(m.find((x) => x.what === "A mandate per agent, on chain")).toMatchObject({ detail: "Sourcing agent: 0.04 a payment, 12.00 in total, one payee", proof: { href: expect.stringContaining(TX) } });
    expect(m.find((x) => x.what === "Refused over the mandate's cap")!.detail).toBe("1 refused by Purser before signing, 1 recorded by Alta on chain, 1 refused by Alta's facilitator (mandate_cap_exceeded): nothing moved");
    expect(m.find((x) => x.what === "Refused under a revoked mandate")!.detail).toMatch(/^2 payments refused by Alta's facilitator/);
    expect(m.find((x) => x.what === "Mandate replaced after Face ID")).toMatchObject({ detail: expect.stringMatching(/^1 replacement approved/), proof: null });
    expect(m.find((x) => x.what === "Sweep, after finality")!.detail).toMatch(/block \(10\) was finalized \(12\)/);
  });

  it("clearing sales, money from strangers held, and the dispute desk with the orders of its case", () => {
    moneyWorld(db);
    db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, scheme) VALUES (9, '/stock', 5, '0xr', 'u', '{}', 'DELIVERED', 'x', 'bajillion')").run();
    const cols = (db.prepare("PRAGMA table_info(quarantines)").all() as { name: string; notnull: number; dflt_value: unknown }[]);
    const v: Record<string, unknown> = {};
    for (const c of cols) if (c.notnull && c.dflt_value === null) v[c.name] = c.name === "status" ? "OPEN" : /amount|block|units/.test(c.name) ? "1" : `q-${c.name}`;
    for (const i of [1, 2]) { const k = Object.keys(v); db.prepare(`INSERT INTO quarantines (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...k.map((x) => (x === "receipt_id" ? `r${i}` : v[x]))); }
    row("dispute.opened", "D-1", { sales: "5,6,7," });
    row("dispute.decided", "D-1", { refund: "0.15" });
    const m = railsView(db).metal;
    expect(m.find((x) => x.what === "Pay-per-call clearing")!.detail).toBe("1 sales paid by signed receipts from one deposit, no transaction each");
    expect(m.find((x) => x.what === "Receive policy: money from strangers held")!.detail).toMatch(/^2 payments from unknown senders/);
    expect(m.find((x) => x.what === "Dispute desk, decided from the chain")!.detail).toBe("1 case (3 orders): each payment checked against the customer's mandate and its signed order; refund 0.15 test USD");
    expect(m.find((x) => x.what === "Refunds as mandate pulls")!.detail).toMatch(/^1 refund, 0\.05 test USD/);
  });
});

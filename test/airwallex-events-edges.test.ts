// Airwallex's webhooks checked against the ledger (src/policy/airwallexEvents.ts checkEvent): an event about a card,
// payout or conversion Purser did not make disagrees; a payout that went the other way at Airwallex disagrees, and one
// the ledger has as PAID that is reported failed is asked again; a conversion follows Airwallex's final word only from
// an unsettled state; deposits outside the known Global Accounts and card payments without acceptance are recorded only.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { airwallexEventsView, checkEvent, objectOf, recordEvent, setKnownGlobalAccounts } from "../src/policy/airwallexEvents.js";
import { moneyWorld } from "./fakes/moneyWorld.js";

const now = new Date("2026-11-19T10:00:00Z");
let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  moneyWorld(db);
});
const audits = (event: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ?").all(event) as { subject: string; payload_json: string }[];

describe("which object an event is about", () => {
  it("by its name's prefix", () => {
    expect(objectOf("issuing.card_transaction.created")).toBe("card_transaction");
    expect(objectOf("issuing.transaction.succeeded")).toBe("card_transaction");
    expect(objectOf("issuing.card.active")).toBe("card");
    expect(objectOf("payout.transfer.paid")).toBe("transfer");
    expect(objectOf("conversion.settled")).toBe("conversion");
    expect(objectOf("deposit.settled")).toBe("deposit");
    expect(objectOf("payment_intent.succeeded")).toBe("payment_intent");
    expect(objectOf("account.updated")).toBe("other");
  });
});

describe("cards", () => {
  it("a card Purser does not have disagrees; live while the policy has it frozen disagrees; stricter than the policy agrees", () => {
    expect(checkEvent(db, "issuing.card.active", { id: "card_x" }, now)).toMatchObject({ object: "card", object_id: "card_x", status: "ACTIVE", agrees: false, outcome: "card card_x is ACTIVE: not one of Purser's cards" });
    expect(checkEvent(db, "issuing.card.active", {}, now)).toMatchObject({ object_id: null, agrees: false, outcome: "card ? is ACTIVE: not one of Purser's cards" });
    expect(checkEvent(db, "issuing.card.inactive", { card_id: "card_1", card_status: "INACTIVE" }, now)).toMatchObject({ agrees: true, outcome: expect.stringMatching(/^support's card is INACTIVE at Airwallex, which matches the policy/) });
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(now.toISOString());
    expect(checkEvent(db, "issuing.card.active", { card_id: "card_1" }, now)).toMatchObject({ agrees: false, outcome: "support's card is live at Airwallex while the policy has it frozen; the next sync freezes it again" });
  });
});

describe("payouts", () => {
  it("a payout Purser did not make disagrees, with Airwallex's amount and currency", () => {
    expect(checkEvent(db, "payout.transfer.paid", { id: "tr_other", transfer_amount: 120.5, transfer_currency: "EUR" }, now))
      .toMatchObject({ object: "transfer", status: "PAID", amount_cents: 12050, currency: "EUR", agrees: false, outcome: "payout tr_other PAID: a payout Purser did not make" });
    expect(checkEvent(db, "payout.transfer.paid", { amount: "-5" }, now)).toMatchObject({ object_id: null, amount_cents: null, outcome: "payout ? PAID: a payout Purser did not make" });
  });

  it("matches a late earlier status; a payout the ledger has as PAID reported failed disagrees and is asked again, never changed", () => {
    expect(checkEvent(db, "payout.transfer.processing", { id: "tr_1", status: "PROCESSING" }, now)).toMatchObject({ agrees: true, outcome: "payout for BTX-1 is PROCESSING at Airwallex, which matches the ledger (PAID)" });
    expect(checkEvent(db, "payout.transfer.failed", { id: "tr_1" }, now)).toMatchObject({ agrees: false, outcome: "payout for BTX-1 is FAILED at Airwallex, which differs from the ledger (PAID)" });
    expect(audits("transfer.recheck_requested").map((r) => [r.subject, JSON.parse(r.payload_json).webhook_status])).toEqual([["tr_1", "FAILED"]]);
    expect((db.prepare("SELECT status FROM transfers WHERE transfer_id = 'tr_1'").get() as { status: string }).status).toBe("PAID");
  });

  it("a payout paid at Airwallex that the ledger has as failed disagrees", () => {
    db.prepare("UPDATE transfers SET status = 'FAILED' WHERE transfer_id = 'tr_3'").run();
    expect(checkEvent(db, "payout.transfer.sent", { transfer_id: "tr_3", status: "SENT" }, now)).toMatchObject({ agrees: false, outcome: "payout for BTX-3 is SENT at Airwallex, which differs from the ledger (FAILED)" });
  });
});

describe("conversions", () => {
  it("one Purser did not make disagrees; Airwallex's final word moves an unsettled one on, and a cancel of a settled one disagrees", () => {
    expect(checkEvent(db, "conversion.settled", { id: "conv_x", buy_amount: "10.00", buy_currency: "USD" }, now)).toMatchObject({ object: "conversion", agrees: false, amount_cents: 1000, currency: "USD", outcome: "conversion conv_x SETTLED: a conversion Purser did not make" });
    db.prepare("UPDATE fx_conversions SET status = 'SCHEDULED' WHERE conversion_id = 'conv_1'").run();
    expect(checkEvent(db, "conversion.cancelled", { conversion_id: "conv_1" }, now)).toMatchObject({ agrees: false, outcome: "conversion is CANCELLED at Airwallex; the ledger had it SCHEDULED and now follows" });
    expect((db.prepare("SELECT status FROM fx_conversions WHERE conversion_id = 'conv_1'").get() as { status: string }).status).toBe("CANCELLED");
    expect(audits("fx.conversion_status").map((r) => JSON.parse(r.payload_json))).toEqual([{ from: "SCHEDULED", to: "CANCELLED", by: "airwallex_webhook" }]);
    // Final now: a later "settled" does not move it back.
    expect(checkEvent(db, "conversion.settled", { conversion_id: "conv_1" }, now)).toMatchObject({ agrees: true, outcome: "conversion is SETTLED at Airwallex, which matches the ledger (CANCELLED)" });
    db.prepare("UPDATE fx_conversions SET status = 'SETTLED' WHERE conversion_id = 'conv_1'").run();
    expect(checkEvent(db, "conversion.failed", { conversion_id: "conv_1" }, now)).toMatchObject({ agrees: false, outcome: "conversion is FAILED at Airwallex, which differs from the ledger (SETTLED)" });
  });
});

describe("deposits and card payments", () => {
  it("records a deposit that is not settled, not into a known Global Account, or not in EUR or GBP, without matching it", () => {
    setKnownGlobalAccounts(db, ["ga_eur"], now);
    const base = { id: "dep_9", status: "SETTLED", global_account_id: "ga_eur", amount: 500, currency: "EUR", payer: { name: "Ridgeline Outfitters" } };
    for (const o of [{ ...base, status: "PENDING" }, { ...base, global_account_id: "ga_other" }, { ...base, currency: "USD" }, { ...base, amount: 0 }]) {
      const c = checkEvent(db, "deposit.settled", o, now);
      expect(c.agrees).toBeNull();
      expect(c.outcome).toMatch(/recorded; not matched \(only settled EUR or GBP deposits into Northwind's Global Accounts are\)$/);
    }
    expect(checkEvent(db, "deposit.settled", { status: "SETTLED" }, now).outcome).toBe("deposit SETTLED: recorded; not matched (only settled EUR or GBP deposits into Northwind's Global Accounts are)");
    const matched = checkEvent(db, "deposit.settled", { ...base, payer_name: "Someone", payer: undefined, reference: "NW-1" }, now);
    expect(matched.outcome).toMatch(/^deposit 500\.00 EUR: /);
  });

  it("a card payment in is recorded only, unless it succeeded and payment acceptance is on", () => {
    const c = checkEvent(db, "payment_intent.succeeded", { id: "int_1", status: "SUCCEEDED", amount: 10, currency: "EUR" }, now, {});
    expect(c).toMatchObject({ object: "payment_intent", agrees: null, outcome: "card payment SUCCEEDED: recorded; booked only when SUCCEEDED and payment acceptance is on" });
    expect(checkEvent(db, "payment_intent.created", { id: "int_2" }, now, {}).outcome).toMatch(/^card payment CREATED: recorded/);
  });

  it("anything else is recorded; each event once by its id; disagreements first on the dashboard", () => {
    const other = checkEvent(db, "account.updated", { id: "acct_1" }, now);
    expect(other).toMatchObject({ object: "other", agrees: null, outcome: "not an object Purser acts on; recorded" });
    expect(recordEvent(db, "evt_1", "account.updated", other, now)).toBe(true);
    expect(recordEvent(db, "evt_1", "account.updated", other, now)).toBe(false);
    const bad = checkEvent(db, "payout.transfer.paid", { id: "tr_zz" }, now);
    expect(recordEvent(db, "evt_2", "payout.transfer.paid", bad, new Date(now.getTime() - 60_000))).toBe(true);
    expect(audits("airwallex.disagrees")).toHaveLength(1);
    const v = airwallexEventsView(db);
    expect(v).toMatchObject({ total: 2, disagree: 1 });
    expect(v.recent[0]).toMatchObject({ name: "payout.transfer.paid", agrees: false });
    expect(v.by_object.map((b) => b.label).sort()).toEqual(["Other", "Payouts"]);
  });
});

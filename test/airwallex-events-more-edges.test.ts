// Airwallex's webhooks against the ledger (src/policy/airwallexEvents.ts), the paths test/airwallex-events-edges.test.ts
// leaves: the Global Accounts set again unchanged records nothing; a card reported live moments after Purser thawed it
// for an approved purchase agrees (its webhook arrives after the refreeze); a payout event with no status named and a
// conversion event with no id are each read as what they are; and the dashboard's view of a ledger from before the
// events table is empty. No network.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { airwallexEventsView, checkEvent, setKnownGlobalAccounts } from "../src/policy/airwallexEvents.js";
import { moneyWorld } from "./fakes/moneyWorld.js";

const now = new Date("2026-11-19T10:00:00Z");

describe("Airwallex's webhooks against the ledger", () => {
  it("the Global Accounts set again unchanged records nothing", () => {
    const db = openDb(":memory:");
    setKnownGlobalAccounts(db, ["ga_2", "ga_1"], now);
    setKnownGlobalAccounts(db, ["ga_1", "ga_2", "ga_1"], now);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'setting.changed'").get()).toEqual({ n: 1 });
  });

  it("a card live moments after a purchase window Purser opened agrees: the webhook is late news of the thaw", () => {
    const db = openDb(":memory:");
    moneyWorld(db);
    const opened = new Date(now.getTime() - 150_000);
    audit(db, "awx-executor", "card.window_opened", "support", { agent: "support", amount: "9.00", merchant: "m", until: new Date(opened.getTime() + 120_000).toISOString(), why: "test", last4: "4242", currency: "EUR" }, opened);
    const c = checkEvent(db, "issuing.card.active", { card_id: "card_1", card_status: "ACTIVE" }, now);
    expect(c).toMatchObject({ object: "card", status: "ACTIVE", agrees: true, outcome: "support's card was thawed for a purchase Purser approved; it is frozen again (frozen by default)" });
    // Long after the window, the same report is a disagreement.
    expect(checkEvent(db, "issuing.card.active", { card_id: "card_1", card_status: "ACTIVE" }, new Date(now.getTime() + 3_600_000))).toMatchObject({ agrees: false });
  });

  it("a payout event that names no status agrees with any ledger status", () => {
    const db = openDb(":memory:");
    moneyWorld(db);
    expect(checkEvent(db, "payout.transfer.", { id: "tr_1" }, now)).toMatchObject({ object: "transfer", status: null, agrees: true, outcome: "payout for BTX-1 is null at Airwallex, which matches the ledger (PAID)" });
  });

  it("a conversion event without an id is one Purser did not make", () => {
    const db = openDb(":memory:");
    expect(checkEvent(db, "conversion.settled", { buy_amount: 100, buy_currency: "EUR" }, now)).toEqual({
      object: "conversion", object_id: null, status: "SETTLED", amount_cents: 10000, currency: "EUR", agrees: false, outcome: "conversion ? SETTLED: a conversion Purser did not make",
    });
  });

  it("the dashboard's view of a ledger from before the events table is empty", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE airwallex_events");
    expect(airwallexEventsView(db)).toEqual({ total: 0, disagree: 0, by_object: [], recent: [] });
  });
});

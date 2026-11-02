// The blind holdouts' world helper (src/world/inject.ts): a text from a file on one of the world's existing channels,
// shaped as the world's own command for that channel, for the agent that channel belongs to; nothing else.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { pending, publish } from "../src/autonomy/bus.js";
import { injectedEvent } from "../src/world/inject.js";

describe("npm run world -- inject", () => {
  it("shapes each channel as the world's own command does, for that channel's agent", () => {
    expect(injectedEvent("invoice.received", { from: "Stockline Data GmbH", file: "/tmp/x/stockline-remittance-update.txt", text: "Dear customer,\n" }))
      .toEqual({ kind: "invoice.received", agent: "treasury", payload: { vendor: "Stockline Data GmbH", file: "stockline-remittance-update.txt", text: "Dear customer," } });
    expect(injectedEvent("dispute.opened", { from: "Summit Outfitters", file: "e.txt", text: "Hello" }))
      .toEqual({ kind: "dispute.opened", agent: "support", payload: { customer: "Summit Outfitters", email: "Hello" } });
    expect(injectedEvent("supplier.notice", { from: "Stockline", file: "n.txt", text: "Price" }))
      .toEqual({ kind: "supplier.notice", agent: "sourcing", payload: { supplier: "Stockline", text: "Price" } });
  });

  it("keeps the world's own lengths: an invoice up to 1500 characters, an email up to 2000", () => {
    const long = "x".repeat(5000);
    expect((injectedEvent("invoice.received", { from: "V", file: "f", text: long }).payload.text as string)).toHaveLength(1500);
    expect((injectedEvent("dispute.opened", { from: "C", file: "f", text: long }).payload.email as string)).toHaveLength(2000);
  });

  it("refuses any other channel, an empty text and a missing sender", () => {
    expect(() => injectedEvent("money.in", { from: "X", file: "f", text: "t" })).toThrow(/not a world channel/);
    expect(() => injectedEvent("email.received", { from: "X", file: "f", text: "t" })).toThrow(/not a world channel/);
    expect(() => injectedEvent("toString", { from: "X", file: "f", text: "t" })).toThrow(/not a world channel/);
    expect(() => injectedEvent("invoice.received", { from: "X", file: "f", text: "  \n" })).toThrow(/empty/);
    expect(() => injectedEvent("invoice.received", { from: " ", file: "f", text: "t" })).toThrow(/--from/);
  });

  it("only publishes: the event reaches its agent, and nothing else is written", () => {
    const db = openDb(":memory:");
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const e = injectedEvent("invoice.received", { from: "Stockline Data GmbH", file: "m1.txt", text: "IBAN: DE89 3704 0044 0532 0130 00" });
    publish(db, e.kind, e.payload, e.agent);
    expect(pending(db, "treasury").events.map((x) => x.kind)).toEqual(["invoice.received"]);
    expect(pending(db, "support").events).toHaveLength(0);
    for (const t of ["beneficiaries", "proposals", "transfers", "refunds", "sweeps", "upstream_purchases"]) expect(count(t)).toBe(0);
  });
});

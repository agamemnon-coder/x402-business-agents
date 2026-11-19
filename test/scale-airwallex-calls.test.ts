// How many Airwallex API calls a record's call logs hold (src/redesign/scale.ts airwallexCallsIn), for the home page's
// band: each of the four log shapes, only endpoints of Airwallex's API counted, counts that are not whole numbers read
// as none, and a record with no log as none.
import { describe, expect, it } from "vitest";
import { airwallexCallsIn } from "../src/redesign/scale.js";

describe("Airwallex calls in a record", () => {
  it("awx-1's shape: endpoint counts, Airwallex's endpoints only", () => {
    expect(airwallexCallsIn({ calls: { airwallex: [
      { endpoint: "POST /api/v1/authentication/login", calls: 2 },
      { endpoint: "/issuing/cards", calls: 3 },
      { endpoint: "https://example.com/other", calls: 50 },
      { endpoint: "GET /api/v1/transfers/{id}", calls: -1 },
      { endpoint: 7, calls: 9 },
      "not a row",
    ] } })).toBe(5);
  });

  it("a logger's shape: a total with counts by endpoint", () => {
    expect(airwallexCallsIn({ calls: { total: 99, by_endpoint: [{ endpoint: "/pa/{id}/{id}", calls: 4 }, { endpoint: "/v1/messages", calls: 10 }, { endpoint: "/balances/current", calls: 1.5 }] } })).toBe(4);
  });

  it("a read-back's shape: one line per call, with or without its method", () => {
    expect(airwallexCallsIn({ calls: [{ method: "GET", endpoint: "/api/v1/transfers/tr_1" }, { endpoint: "/fx/quotes/create" }, { method: "GET", endpoint: "/somewhere/else" }, null] })).toBe(2);
  });

  it("the VIC runs' shape: each purchase's own count, added to any log", () => {
    expect(airwallexCallsIn({ purchases: [{ calls: { airwallex: 3 } }, { calls: { airwallex: 2 } }, { calls: {} }, 5] })).toBe(5);
    expect(airwallexCallsIn({ calls: [{ endpoint: "/issuing/cards" }], purchases: [{ calls: { airwallex: 1 } }] })).toBe(2);
  });

  it("nothing from a record that is not an object or holds no log", () => {
    for (const r of [null, [], "x", 3, {}, { calls: { other: [] } }, { calls: "many" }]) expect(airwallexCallsIn(r)).toBe(0);
  });
});

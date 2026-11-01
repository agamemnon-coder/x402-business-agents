// Metal QA (1 November): the dashboard's mandate numbers, read against the chain. The comparison itself, without a chain.
import { describe, expect, it } from "vitest";
import { compareMandate } from "../src/metal/dashboardVsChain.js";
import { centsToBaseUnits as u } from "../src/lib/money.js";

const shown = { agent: "sourcing", cap: "0.03", budget: "6.00", spent: "0.42", pending: "0.00", credentials: 1 };
const chain = { perPaymentCap: u(3), budget: u(600), spent: u(42), revoked: false, bound: true };

describe("the dashboard against the chain", () => {
  it("agrees when cap, budget and spend match what Metal has", () => {
    expect(compareMandate(shown, chain)).toEqual([]);
  });

  it("names every number that differs", () => {
    const d = compareMandate({ ...shown, cap: "0.04", budget: "5.00" }, { ...chain, spent: u(50) });
    expect(d).toEqual([
      "cap: the dashboard shows 0.04, the chain 0.03",
      "budget: the dashboard shows 5.00, the chain 6.00",
      "spent: the dashboard shows 0.42 (0.00 pending), the chain 0.50",
    ]);
  });

  it("allows chain spend between paid and paid + pending (a pull not yet final)", () => {
    expect(compareMandate({ ...shown, pending: "0.03" }, { ...chain, spent: u(45) })).toEqual([]);
  });

  it("after a replacement compares spend only as an upper bound (the dashboard carries spend over credentials)", () => {
    expect(compareMandate({ ...shown, credentials: 2, spent: "1.00" }, { ...chain, spent: u(20) })).toEqual([]);
    expect(compareMandate({ ...shown, credentials: 2, spent: "0.10" }, { ...chain, spent: u(20) })).toEqual(["spent: the dashboard shows 0.10 (0.00 pending), the chain 0.20 under the current credential alone"]);
  });

  it("refuses a mandate the chain has not bound, or revoked", () => {
    expect(compareMandate(shown, { ...chain, bound: false })).toEqual(["the chain has no bound mandate for this credential"]);
    expect(compareMandate(shown, { ...chain, revoked: true })).toEqual(["the chain has revoked this credential"]);
  });
});

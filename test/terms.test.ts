import { describe, expect, it } from "vitest";
import { canonicalTerms, prefixMatches, termsHash, type Terms } from "../src/lib/terms.js";

// Golden vector from the build plan, section 2.4. It also matched on testnet in the D1 smoke test.
const golden = {
  schema: "kit11.approval-terms/v1",
  kind: "mandate_replace",
  proposal_id: "P-0001",
  expires_at: "2026-10-30T15:00:00Z",
  steps: [
    { order: "1", agent: "treasury", cap: "4.00", budget: "4.00", payees: ["0x00000000000000000000000000000000000000a1"] },
    { order: "2", agent: "sourcing", cap: "0.04", budget: "12.00", payees: ["0x00000000000000000000000000000000000000b2"] },
  ],
  total_budget: "20.00",
  query_price: "0.07",
} satisfies Terms;

describe("approval terms", () => {
  it("canonicalises with JCS", () => {
    expect(canonicalTerms(golden)).toBe(
      '{"expires_at":"2026-10-30T15:00:00Z","kind":"mandate_replace","proposal_id":"P-0001","query_price":"0.07","schema":"kit11.approval-terms/v1","steps":[{"agent":"treasury","budget":"4.00","cap":"4.00","order":"1","payees":["0x00000000000000000000000000000000000000a1"]},{"agent":"sourcing","budget":"12.00","cap":"0.04","order":"2","payees":["0x00000000000000000000000000000000000000b2"]}],"total_budget":"20.00"}',
    );
  });

  it("hashes to the golden vector", () => {
    expect(termsHash(golden)).toBe("db3c6933b4f9a406bbeff7c534f9e37f33d78ddcac51b253b7add9f359bc1a6d");
  });

  it("refuses numbers anywhere in the terms", () => {
    const bad = { ...golden, steps: [{ ...golden.steps[0], cap: 4 }] } as unknown as Terms;
    expect(() => termsHash(bad)).toThrow(/numbers/);
  });

  it("refuses a non-UTC expiry", () => {
    expect(() => termsHash({ ...golden, expires_at: "2026-10-30T16:00:00+01:00" })).toThrow(/UTC/);
  });

  it("matches only an exact 8-hex prefix", () => {
    const h = termsHash(golden);
    expect(prefixMatches(h, "db3c6933")).toBe(true);
    expect(prefixMatches(h, "DB3C6933")).toBe(true);
    expect(prefixMatches(h, "db3c693")).toBe(false);
    expect(prefixMatches(h, "db3c6934")).toBe(false);
  });
});

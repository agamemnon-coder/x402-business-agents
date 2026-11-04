// Variation batch, 2 November: a world where a supplier asks more than the sell price crashed the Sourcing agent's wake
// (fromCents refuses a negative margin). The brief must show the loss instead.
import { describe, expect, it } from "vitest";
import { sourcingBrief } from "../src/autonomy/sourcingCore.js";
import { DEFAULT_POLICY } from "../src/agents/sourcing.js";

describe("sourcingBrief with a supplier above the sell price", () => {
  it("shows a negative margin as a loss and does not throw", () => {
    const text = sourcingBrief({
      suppliers: [{ id: "stockline", name: "Stockline", available: true, price_cents: 6, data_age_seconds: 5, last20: { paid: 3, refused: 0, unavailable: 0 } } as never],
      capCents: 3, budgetLeftCents: 900, sellCents: 5, policy: DEFAULT_POLICY, card: null,
    });
    expect(text).toContain("margin at that price -0.01 (a loss)");
  });
});

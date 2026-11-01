// dry-125 (soak, 1 November): after Stockline's price rose over the Sourcing agent's cap, the agent stopped buying
// (cache only) instead of trying and being refused, so code never saw "a purchase refused over a cap"; Treasury could
// not design a rebalance, and the shop turned every customer away for 12 minutes. Code's evidence that an agent is
// blocked by its mandate now also covers that case, from code's own data only: customers turned away under the buy
// policy in the last 15 minutes, while no supplier serves data fresh enough to sell (no older than the cache limit)
// at or under the cap. Breaks if the agent's words alone, a voluntary pause at a fine price, or old refusals open it.
import { describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";

vi.mock("../src/agents/treasury.js", async (orig) => ({ ...(await orig<object>()), mandatesNow: async () => new Map([
  ["sourcing", { now: { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 } }],
]) }));
const { blockedByMandate, setSupplierPrice } = await import("../src/autonomy/teamProfiles.js");

const NOW = new Date();
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const turnAway = (db: DB, n: number, minAgo = 1) => {
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at, supplier) VALUES (0, 'REFUSED', 'buy_policy: the Sourcing agent chose not to buy (and nothing fresh is cached); the customer is not charged', ?, 'none')").run(ago(minAgo));
};

describe("code's evidence that the Sourcing agent is blocked by its mandate", () => {
  it("is a purchase refused over a cap, as before", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(ago(1));
    expect(await blockedByMandate(db, NOW)).toMatchObject({ refusal_reason: expect.stringMatching(/^mandate_cap_exceeded/) });
  });

  it("is customers turned away while the only fresh supplier is over the cap (dry-125)", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 3);
    const e = await blockedByMandate(db, NOW);
    expect(e?.refusal_reason).toMatch(/^mandate_cap_blocks_fresh_data: 3 customer queries turned away in 15 min/);
    expect(e?.refusal_reason).toMatch(/Stockline 0\.04 over the 0\.03 cap/);
    expect(e?.refusal_reason).toMatch(/Ridgeline Data's data is 15 min old/);
  });

  it("is nothing when the fresh supplier is within the cap: the pause was the agent's own choice", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.03");
    turnAway(db, 5);
    expect(await blockedByMandate(db, NOW)).toBeUndefined();
  });

  it("is nothing with fewer than three customers turned away, or only old refusals", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 2);
    expect(await blockedByMandate(db, NOW)).toBeUndefined();
    turnAway(db, 5, 20);
    expect(await blockedByMandate(db, NOW)).toBeUndefined();
  });
});

describe("the words the CFO's review and Treasury's design read", () => {
  it("say a purchase was refused only when one was, and otherwise that customers were turned away", async () => {
    const { blockedWords } = await import("../src/agents/treasuryAgent.js");
    expect(blockedWords("mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment")).toBe("The next purchase was refused on chain: mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment");
    expect(blockedWords("mandate_cap_blocks_fresh_data: 3 customer queries turned away")).toMatch(/^The Sourcing agent stopped buying rather than pay over its cap, and code saw customers turned away \(no purchase was tried, so none was refused\): mandate_cap_blocks_fresh_data/);
  });
});

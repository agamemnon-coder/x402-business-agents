// dry-125 (soak, 1 November): after Stockline's price rose over the Sourcing agent's cap, the agent stopped buying
// (cache only) instead of trying and being refused, so code never saw "a purchase refused over a cap"; Treasury could
// not design a rebalance, and the shop turned every customer away for 12 minutes. Code's evidence that an agent is
// blocked by its mandate now also covers that case, from code's own data only: customers turned away under the buy
// policy in the last 15 minutes, while no supplier serves data fresh enough to sell (no older than the cache limit)
// at or under the cap. Breaks if the agent's words alone, a voluntary pause at a fine price, or old refusals open it.
import { describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";

let mandatesFail = false;
vi.mock("../src/agents/treasury.js", async (orig) => ({ ...(await orig<object>()), mandatesNow: async () => {
  if (mandatesFail) throw new Error("RPC down");
  return new Map([["sourcing", { now: { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 } }]]);
} }));
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
    expect(e?.refusal_reason).toMatch(/Ridgeline Data's data is 15 min old, over code's 5 min cache limit/);
    expect(e?.turnedAway).toMatchObject({ firstId: 1, lastId: 3, rowsSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
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
    expect(blockedWords("mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment")).toBe("The next purchase was refused against the Sourcing mandate's cap: mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment");
    expect(blockedWords("mandate_cap_blocks_fresh_data: 3 customer queries turned away")).toMatch(/^The Sourcing agent did not buy at the new price, and code saw customers turned away \(no purchase was tried, so none was refused\): mandate_cap_blocks_fresh_data/);
  });
});

describe("review of the dry-125 fix", () => {
  it("takes the newer evidence: customers turned away after an old refusal over a cap", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(ago(60));
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 3);
    expect((await blockedByMandate(db, NOW))?.refusal_reason).toMatch(/^mandate_cap_blocks_fresh_data/);
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.05 is over the sourcing mandate''s 0.04 a payment', ?)").run(ago(0));
    expect((await blockedByMandate(db, NOW))?.refusal_reason).toMatch(/0\.05 is over/);
  });

  it("counts only refusals inside the 15 minutes (one exactly 15 minutes old is out)", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 1, 15);
    turnAway(db, 2, 14);
    expect(await blockedByMandate(db, NOW)).toBeUndefined();
    turnAway(db, 1, 1);
    expect(await blockedByMandate(db, NOW)).toMatchObject({ refusal_reason: expect.stringMatching(/^mandate_cap_blocks_fresh_data: 3 customer/) });
  });

  it("proves nothing when the mandate cannot be read", async () => {
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 3);
    mandatesFail = true;
    try { expect(await blockedByMandate(db, NOW)).toBeUndefined(); } finally { mandatesFail = false; }
    expect(await blockedByMandate(db, NOW, 3)).toMatchObject({ turnedAway: { firstId: 1, lastId: 3 } });
  });

  it("puts the turned-away rows in the CFO's evidence, never a refusal that did not happen", async () => {
    const { blockEvidence } = await import("../src/agents/treasury.js");
    const db = openDb(":memory:");
    setSupplierPrice(db, "stockline", "0.04");
    turnAway(db, 3);
    const b = (await blockedByMandate(db, NOW))!;
    const rows = db.prepare("SELECT id, created_at, refusal_reason FROM upstream_purchases WHERE id BETWEEN 1 AND 3 AND refusal_reason LIKE 'buy_policy:%' ORDER BY id").all();
    const { sha256Hex } = await import("../src/lib/terms.js");
    expect(blockEvidence({ purchaseId: b.id, reason: b.refusal_reason, turnedAway: b.turnedAway! })).toEqual({ type: "turned_away", ref: "upstream_purchases:1-3:buy_policy", sha256: sha256Hex(JSON.stringify(rows)) });
    expect(blockEvidence({ purchaseId: 7, reason: "mandate_cap_exceeded: x" })).toEqual({ type: "refusal", ref: "upstream_purchase:7:mandate_cap_exceeded: x", sha256: sha256Hex("mandate_cap_exceeded: x") });
  });
});

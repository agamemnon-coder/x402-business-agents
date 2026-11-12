// Visa #4b (master-list line 280): a second agent on the Airi rail with its own limit from the CFO policy. Each agent's
// limit alone and its count per day are its own: one agent's purchases never use up the other's room, and a policy
// change to one agent's limit moves only that agent.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AIRI_AGENTS, ALONE_KEY, PER_DAY_KEY, airiPolicy, airiRuleDefs, aloneKeyOf, perDayKeyOf } from "../src/airi/policy.js";
import { requestAiriPurchase, type AiriDeps, type AiriPurchaseRequest } from "../src/airi/purchase.js";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { openDb, type DB } from "../src/db/open.js";

const T0 = new Date("2026-11-07T10:00:00Z");
const URL0 = "https://kit11.max-31b.workers.dev/";
const set = (db: DB, k: string, v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v, T0.toISOString());
function world(policy: Record<string, string>) {
  const db = openDb(":memory:");
  set(db, "airi.merchant.northwind-sandbox", "allowed");
  for (const [k, v] of Object.entries(policy)) set(db, k, v);
  return db;
}
const deps = (): AiriDeps => ({ airi: new StandInAiriClient(), checkout: new StandInCheckout(), tmpRoot: mkdtempSync(join(tmpdir(), "airi-agents-")), showPasskeyUrl: () => {}, clearPasskeyUrl: () => {} });
const order = (agent: "sourcing" | "support", amount: string): AiriPurchaseRequest => ({
  agent, paymentMethodId: `standin-pm-${agent}`, merchantName: "Northwind test shop", merchantUrl: URL0, merchantCountry: "NL",
  amount, currency: "EUR", items: [{ name: "Trail map pack", unitPrice: amount, quantity: "1" }], description: `order by ${agent}`,
});
const route = async (db: DB, agent: "sourcing" | "support", amount: string) => {
  const r = await requestAiriPurchase(db, deps(), order(agent, amount), T0);
  return r.status === "pending_approval" ? "cfo" : r.status === "refused" ? `refused ${r.code}` : "alone";
};

describe("a second agent with its own Airi limit (Visa #4b)", () => {
  it("names each agent's own policy keys; the Sourcing agent keeps the first ones", () => {
    expect(AIRI_AGENTS).toEqual(["sourcing", "support"]);
    expect(aloneKeyOf("sourcing")).toBe(ALONE_KEY);
    expect(perDayKeyOf("sourcing")).toBe(PER_DAY_KEY);
    expect(aloneKeyOf("support")).toBe("approval.airi_alone.support");
    expect(perDayKeyOf("support")).toBe("approval.airi_alone_per_day.support");
    const defs = airiRuleDefs();
    expect(defs.find((d) => d.key === "approval.airi_alone.support")).toMatchObject({ agent: "support", unit: "EUR", kind: "money", fallback: "10.00" });
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
  });

  it("reads each agent's limit from the CFO policy, and gives an agent the rail does not list nothing alone", () => {
    const db = world({ [ALONE_KEY]: "20.00", [PER_DAY_KEY]: "3", "approval.airi_alone.support": "8.00", "approval.airi_alone_per_day.support": "1" });
    expect(airiPolicy(db)).toMatchObject({ aloneMaxCents: 20_00, alonePerDay: 3 });
    expect(airiPolicy(db, "sourcing")).toMatchObject({ aloneMaxCents: 20_00, alonePerDay: 3 });
    expect(airiPolicy(db, "support")).toMatchObject({ aloneMaxCents: 8_00, alonePerDay: 1 });
    expect(airiPolicy(db, "treasury")).toMatchObject({ aloneMaxCents: 0, alonePerDay: 0 });
  });

  it("enforces each agent's amount alone separately: the same order runs alone for one and asks the CFO for the other", async () => {
    const db = world({ [ALONE_KEY]: "20.00", [PER_DAY_KEY]: "3", "approval.airi_alone.support": "8.00", "approval.airi_alone_per_day.support": "3" });
    expect(await route(db, "sourcing", "12.00")).toBe("alone");
    expect(await route(db, "support", "12.00")).toBe("cfo");
    expect(await route(db, "support", "8.00")).toBe("alone");
  });

  it("counts each agent's purchases per day separately: one agent's count does not use up the other's", async () => {
    const db = world({ [ALONE_KEY]: "20.00", [PER_DAY_KEY]: "2", "approval.airi_alone.support": "10.00", "approval.airi_alone_per_day.support": "1" });
    expect(await route(db, "sourcing", "5.00")).toBe("alone");
    expect(await route(db, "sourcing", "5.00")).toBe("alone");
    expect(await route(db, "sourcing", "5.00")).toBe("cfo");
    // The Sourcing agent's two do not count against the Support agent's one.
    expect(await route(db, "support", "5.00")).toBe("alone");
    expect(await route(db, "support", "5.00")).toBe("cfo");
  });

  it("a change to one agent's limit in the policy moves only that agent", async () => {
    const db = world({ [ALONE_KEY]: "20.00", [PER_DAY_KEY]: "5", "approval.airi_alone.support": "10.00", "approval.airi_alone_per_day.support": "5" });
    set(db, "approval.airi_alone.support", "0.00");
    expect(await route(db, "support", "1.00")).toBe("cfo");
    expect(await route(db, "sourcing", "1.00")).toBe("alone");
  });
});

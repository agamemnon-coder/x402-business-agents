// The Treasury agent's proposals for a supplier price rise and for a rebalance (src/agents/treasury.ts), with the chain
// and the owner's signer stood in for: one proposal per sell-price option, sharing the same replace steps, shrinking
// first so the 20.00 total holds after each; each step names the credential bound now and the one issued for it; the
// evidence is hashed as read; after a pause, what the CFO signs shows the budget on chain and the spend before the pause;
// a rebalance that changes nothing is refused; and the reviewer's context says what code checked, in its own words.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CENT = 10n ** 16n;
type Cred = { agent: string; capCents: number; budgetCents: number; expiry: number; payees?: string[] };
const h = vi.hoisted(() => ({
  dir: "",
  bound: new Map<string, { cred: Cred; spentCents: number }>(),
  issued: [] as { spec: { agent: string; principal: string; capCents: number; budgetCents: number; payees: { address: string; name: string }[] }; firstId: string; keyFile: string }[],
  autonomy: false,
}));

vi.mock("../src/config/agents.js", async (orig) => ({ ...(await orig<typeof import("../src/config/agents.js")>()), autonomyOn: () => h.autonomy }));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({
  ...(await orig<typeof import("@metalntwx/metal-pay/mandates")>()),
  extractTerms: (c: Cred) => ({ constraints: { perPaymentCap: BigInt(c.capCents) * CENT, budget: BigInt(c.budgetCents) * CENT, expiry: BigInt(c.expiry) } }),
  parseCredential: (c: Cred) => c,
  hashCredential: (c: Cred) => `0xnew-${c.agent}-${c.budgetCents}`,
}));
vi.mock("../src/metal/mandate.js", () => ({
  activeMandate: async (agent: string) => {
    const b = h.bound.get(agent);
    if (!b) throw new Error(`${agent}: expected one bound mandate, found 0`);
    return { agent, credential: b.cred, credentialHash: `0xold-${agent}`, keyFile: `${agent}.key.json` };
  },
  mandateSpent: async (m: { agent: string }) => BigInt(h.bound.get(m.agent)!.spentCents) * CENT,
}));
vi.mock("../src/executors/ownerSigner.js", () => ({
  issueReplacementCredential: (spec: (typeof h.issued)[number]["spec"], firstId: string, keyFile: string) => {
    h.issued.push({ spec, firstId, keyFile });
    const path = join(h.dir, `${firstId}-${spec.agent}.json`);
    writeFileSync(path, JSON.stringify({ agent: spec.agent, capCents: spec.capCents, budgetCents: spec.budgetCents, expiry: 1_795_000_000 }));
    return path;
  },
}));

const { mandatesNow, proposePriceRise, proposeRebalance, priceRiseContext, priceRiseTargets, blockEvidence } = await import("../src/agents/treasury.js");
const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { sha256Hex } = await import("../src/lib/terms.js");

const ADDR = {
  business: "0x00000000000000000000000000000000000000B0", customer: "0x00000000000000000000000000000000000000C1",
  supplier: "0x00000000000000000000000000000000000000A1", sweep: "0x00000000000000000000000000000000000000D1",
  ridgeline: "0x00000000000000000000000000000000000000E1",
} as const;
const bind = (agent: string, capCents: number, budgetCents: number, spentCents: number) => h.bound.set(agent, { cred: { agent, capCents, budgetCents, expiry: 1_790_000_000 }, spentCents });
const t0 = new Date("2026-11-19T10:00:00.000Z");
let db: ReturnType<typeof openDb>;
let notice: string;

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), "treasury-"));
  h.bound.clear();
  h.issued = [];
  h.autonomy = false;
  db = openDb(":memory:");
  notice = join(h.dir, "stockline-notice.txt");
  writeFileSync(notice, "From 1 December the stock check costs 0.04.");
  // The world of the price rise: sourcing nearly spent at cap 0.03, support as it was, treasury holding 6.00.
  bind("sourcing", 3, 1000, 990);
  bind("support", 10, 400, 50);
  bind("treasury", 600, 600, 0);
});

const evidence = (over: object = {}) => ({ noticePath: notice, liveOfferCents: 4, refusal: { purchaseId: 77, reason: "mandate_cap_exceeded" }, ...over });

describe("a price rise", () => {
  it("proposes keep-the-price and raise-the-price, each with the same steps, shrinking treasury before growing sourcing", async () => {
    const proposals = await proposePriceRise(db, ADDR, 5, evidence(), t0);
    expect(proposals.map((p) => p.proposal_id)).toEqual(["P-0001", "P-0002"]);
    const terms = proposals.map((p) => JSON.parse(p.terms_json) as Record<string, unknown> & { steps: Record<string, unknown>[] });
    expect(terms.map((t) => [t.option, t.query_price, t.upstream_price, t.margin])).toEqual([["A", "0.05", "0.04", "0.01"], ["B", "0.07", "0.04", "0.03"]]);
    expect(terms[0]!.steps).toEqual(terms[1]!.steps);
    expect(terms[0]!.total_budget).toBe("20.00");
    expect(terms[0]!.expires_at).toBe("2026-11-19T11:00:00Z");
    expect(terms[0]!.steps).toEqual([
      { order: "1", agent: "treasury", principal: ADDR.business.toLowerCase(), cap: "4.00", budget: "4.00", payees: [ADDR.sweep.toLowerCase()],
        expires_at: "2026-11-18T11:06:40Z", credential_hash: "0xnew-treasury-400", replaces_credential_hash: "0xold-treasury", spent_at_proposal: "0.00" },
      { order: "2", agent: "sourcing", principal: ADDR.business.toLowerCase(), cap: "0.04", budget: "12.00", payees: [ADDR.supplier.toLowerCase()],
        expires_at: "2026-11-18T11:06:40Z", credential_hash: "0xnew-sourcing-1200", replaces_credential_hash: "0xold-sourcing", spent_at_proposal: "9.90" },
    ]);
    // Each credential issued once, under the first proposal's id, with the bound mandate's own owner key.
    expect(h.issued.map((i) => [i.spec.agent, i.firstId, i.keyFile, i.spec.capCents, i.spec.budgetCents])).toEqual([["treasury", "P-0001", "treasury.key.json", 400, 400], ["sourcing", "P-0001", "sourcing.key.json", 4, 1200]]);
  });

  it("hashes the notice as read, the live offer and the refusal, and records the options with pausing sales", async () => {
    const [p] = await proposePriceRise(db, ADDR, 5, evidence(), t0);
    const terms = JSON.parse(p!.terms_json) as { evidence: unknown[] };
    expect(terms.evidence).toEqual([
      { type: "supplier_notice", ref: `${h.dir.split("/").at(-1)}/stockline-notice.txt`, sha256: sha256Hex("From 1 December the stock check costs 0.04.") },
      { type: "live_offer", ref: "upstream price 0.04", sha256: sha256Hex("0.04") },
      { type: "refusal", ref: "upstream_purchase:77:mandate_cap_exceeded", sha256: sha256Hex("mandate_cap_exceeded") },
    ]);
    const row = db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = 'price_rise.options'").get() as { actor: string; subject: string; payload_json: string };
    expect(row.actor).toBe("treasury");
    expect(row.subject).toBe("P-0001");
    expect(JSON.parse(row.payload_json).options).toEqual([
      { id: "A", label: "keep the price", sell: "0.05", margin: "0.01", margin_percent: "20" },
      { id: "B", label: "raise the price", sell: "0.07", margin: "0.03", margin_percent: "43" },
      { id: "C", label: "pause sales", sell: null, margin: null, margin_percent: null },
    ]);
  });

  it("with customers turned away instead of a refused purchase, the evidence is exactly those ledger rows", () => {
    expect(blockEvidence({ purchaseId: 0, reason: "mandate_cap_blocks_fresh_data", turnedAway: { firstId: 12, lastId: 15, rowsSha256: "ab".repeat(32) } }))
      .toEqual({ type: "turned_away", ref: "upstream_purchases:12-15:buy_policy", sha256: "ab".repeat(32) });
  });

  it("uses the Treasury agent's own plan once code accepted it, instead of the fixed one", async () => {
    const plan = { targets: priceRiseTargets(4).map((t) => (t.agent === "sourcing" ? { ...t, budgetCents: 1100 } : t.agent === "treasury" ? { ...t, capCents: 500, budgetCents: 500 } : t)), options: [{ id: "B" as const, label: "raise the price", sellCents: 8 }], advice: "raise it" };
    const proposals = await proposePriceRise(db, ADDR, 5, evidence(), t0, plan);
    expect(proposals).toHaveLength(1);
    const t = JSON.parse(proposals[0]!.terms_json) as { option: string; query_price: string; steps: { agent: string; budget: string }[]; total_budget: string };
    expect([t.option, t.query_price, t.total_budget]).toEqual(["B", "0.08", "20.00"]);
    expect(t.steps.map((s) => [s.agent, s.budget])).toEqual([["treasury", "5.00"], ["sourcing", "11.00"]]);
  });

  it("with the autonomous agents on, sourcing's mandate may pay Ridgeline Data too; never without its address", async () => {
    h.autonomy = true;
    const [p] = await proposePriceRise(db, ADDR, 5, evidence(), t0);
    const steps = (JSON.parse(p!.terms_json) as { steps: { agent: string; payees: string[] }[] }).steps;
    expect(steps.find((s) => s.agent === "sourcing")!.payees).toEqual([ADDR.supplier.toLowerCase(), ADDR.ridgeline.toLowerCase()].sort());
    const { ridgeline: _, ...noRidgeline } = ADDR;
    h.issued = [];
    await proposePriceRise(db, noRidgeline, 5, evidence(), t0);
    expect(h.issued.find((i) => i.spec.agent === "sourcing")!.spec.payees.map((x) => x.name)).toEqual(["Stockline"]);
  });

  it("after a pause and resume, plans on lifetime figures and shows the budget on chain and the spend before the pause", async () => {
    // Sourcing spent 3.00 before a pause; its resumed mandate holds the 7.00 that was left, 6.90 of it spent since.
    audit(db, "owner-signer", "mandate.resumed", "sourcing", { agent: "sourcing", spent_before: "3.00", budget: "7.00" });
    bind("sourcing", 3, 700, 690);
    const now = await mandatesNow(db);
    expect(now.get("sourcing")).toMatchObject({ chainSpentCents: 690, carriedCents: 300, now: { budgetCents: 1000, spentCents: 990 } });
    expect(now.get("support")).toMatchObject({ carriedCents: 0, now: { budgetCents: 400, spentCents: 50 } });

    const [p] = await proposePriceRise(db, ADDR, 5, evidence(), t0);
    const steps = (JSON.parse(p!.terms_json) as { steps: Record<string, string>[] }).steps;
    const src = steps.find((s) => s.agent === "sourcing")!;
    expect([src.budget, src.budget_on_chain, src.spent_before_pause, src.spent_at_proposal]).toEqual(["12.00", "9.00", "3.00", "6.90"]);
    expect(h.issued.find((i) => i.spec.agent === "sourcing")!.spec.budgetCents).toBe(900);
    // Treasury was never paused: nothing about a pause in its step.
    expect(steps.find((s) => s.agent === "treasury")!).not.toHaveProperty("budget_on_chain");
  });

  it("without the chain's mandates no proposal is made and nothing is recorded", async () => {
    h.bound.delete("support");
    await expect(proposePriceRise(db, ADDR, 5, evidence(), t0)).rejects.toThrow("support: expected one bound mandate, found 0");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(h.issued).toEqual([]);
  });
});

describe("a rebalance the CFO asks for", () => {
  it("moves part of one budget to another in one option at the current price, with the request as its evidence", async () => {
    const p = await proposeRebalance(db, ADDR, { from: "treasury", to: "support", cents: 100 }, "More room for refunds this week", 5, 3, t0);
    const t = JSON.parse(p.terms_json) as { kind: string; option: string; query_price: string; upstream_price: string; margin: string; total_budget: string; steps: Record<string, string>[]; evidence: unknown[] };
    expect([t.kind, t.option, t.query_price, t.upstream_price, t.margin, t.total_budget]).toEqual(["mandate_replace", "A", "0.05", "0.03", "0.02", "20.00"]);
    // The giver's cap comes down with its budget (5.00), first; then support grows.
    expect(t.steps.map((s) => [s.order, s.agent, s.cap, s.budget])).toEqual([["1", "treasury", "5.00", "5.00"], ["2", "support", "0.10", "5.00"]]);
    expect(t.evidence).toEqual([{ type: "cfo_request", ref: "More room for refunds this week", sha256: sha256Hex("More room for refunds this week") }]);
    expect(p.created_by).toBe("treasury");
  });

  it("refuses a move that cannot be made, before any credential is issued", async () => {
    await expect(proposeRebalance(db, ADDR, { from: "sourcing", to: "support", cents: 10 }, "x", 5, 3, t0)).rejects.toThrow("sourcing must keep a budget above what it spent (9.90)");
    await expect(proposeRebalance(db, ADDR, { from: "support", to: "support", cents: 10 }, "x", 5, 3, t0)).rejects.toThrow("a move needs two different agents");
    expect(h.issued).toEqual([]);
  });
});

describe("the reviewer's context", () => {
  it("states the price rise, the mandates as bound now and what code checked, with the fixed plan's sentence word for word", async () => {
    const text = await priceRiseContext(ADDR, 5, "0.03", 4, "mandate_cap_exceeded");
    const lines = text.split("\n");
    expect(lines[0]).toBe("Supplier Stockline raised its price from 0.03 to 0.04 per stock check (its notice and the live 402 offer agree). The next purchase was refused on chain: mandate_cap_exceeded; the customer was not charged.");
    expect(lines[1]).toBe("Current sell price: 0.05. In the terms, query_price is the sell price this option would set, and margin = query_price - upstream_price. The approver chooses between options (another option keeps the current price; pausing sales means approving nothing).");
    expect(lines[2]).toBe("Mandates bound now (read from the chain), 20.00 of the 20.00 total:");
    expect(lines.slice(3, 6)).toEqual([
      `- sourcing: cap 0.03 per payment, budget 10.00, spent 9.90, payee Stockline (${ADDR.supplier.toLowerCase()})`,
      `- support: cap 0.10 per payment, budget 4.00, spent 0.50, payee Summit Outfitters (${ADDR.customer.toLowerCase()})`,
      `- treasury: cap 6.00 per payment, budget 6.00, spent 0.00, payee Northwind sweep (${ADDR.sweep.toLowerCase()})`,
    ]);
    expect(lines[6]).toBe("The proposal replaces sourcing and treasury only; support stays as it is, so total_budget counts all three mandates and never exceeds 20.00.");
  });

  it("says when no purchase was tried because customers were turned away, and names the agents another plan replaces", async () => {
    const text = await priceRiseContext(ADDR, 5, "0.03", 4, "mandate_cap_blocks_fresh_data: 3 customers", ["sourcing"]);
    expect(text).toContain("The Sourcing agent did not buy at the new price, and code saw customers turned away (no purchase was tried, so none was refused): mandate_cap_blocks_fresh_data: 3 customers; the customer was not charged.");
    expect(text).toContain("The proposal replaces sourcing only (its steps say so); the others stay as they are, so total_budget counts all three mandates and never exceeds 20.00.");
    // The order of the agents does not change the fixed plan's sentence.
    expect(await priceRiseContext(ADDR, 5, "0.03", 4, "x", ["treasury", "sourcing"])).toContain("The proposal replaces sourcing and treasury only; support stays as it is");
  });
});

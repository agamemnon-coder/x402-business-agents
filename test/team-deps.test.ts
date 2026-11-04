// D26: the Treasury and Support agents take their chain and flow calls as dependencies, so the variation test can run
// them on simulated rails with every check of code in place. Breaks if a tool or a fallback still reaches the chain, a
// key or a child process when stand-ins are given, or if the rebalance design ignores the client it was handed.
import type Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { recordDecision } from "../src/agents/disputeDecision.js";
import { publish, sendMessage } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import type { MandateNow } from "../src/policy/mandates.js";

// The live default path's child process, observed and stubbed: no flow runs here.
const spawned = vi.hoisted(() => [] as { cmd: string; args: string[]; cwd: string }[]);
vi.mock("node:child_process", async (orig) => ({ ...(await orig<object>()), spawnSync: (cmd: string, args: string[], o: { cwd: string }) => { spawned.push({ cmd, args, cwd: o.cwd }); return { status: 0, stdout: "SETTLED (stub)\n", stderr: "" }; } }));
const { supportProfile, treasuryProfile } = await import("../src/autonomy/teamProfiles.js");

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic & { asked: number } {
  const f = { asked: 0, beta: { messages: { create: async () => {
    const t = turns[f.asked++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${f.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-opus-5-5", usage };
  } } } };
  return f as unknown as Anthropic & { asked: number };
}
const T0 = new Date();
const finish = (s: string) => ({ name: "finish", input: { summary: s } });
const MANDATES: MandateNow[] = [
  { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 80 },
  { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 },
  { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 },
];
const noFlow = () => { throw new Error("no child process in the sim"); };
const noSweep = async () => { throw new Error("no sweep here"); };
const bundle = (o: { client: Anthropic | null; file: (sell: number, live: number) => { proposal_id: string }[] }) => ({
  mandates: async () => MANDATES, client: o.client, sweep: noSweep, planInvoice: noSweep,
  proposePriceRise: async (_db: unknown, sell: number, ev: { liveOfferCents: number }) => o.file(sell, ev.liveOfferCents),
});

describe("Treasury on injected rails (D26)", () => {
  it("designs a rebalance with the given client and mandates, and files it through the given stand-in", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(T0.toISOString());
    sendMessage(db, "sourcing", "treasury", "Stockline is at 0.04, over my cap.", T0);
    const filed: number[] = [];
    // The design's own Claude run gets this client: it submits nothing, so code's fixed plan is used (labelled).
    const design = fake([]);
    const w = await wake(db, treasuryProfile(30 * 60_000, {
      runFlow: noFlow, sim: bundle({ client: design, file: (sell, live) => { filed.push(sell, live); return [{ proposal_id: "P-0001" }, { proposal_id: "P-0002" }]; } }),
    }), { client: fake([[{ name: "design_rebalance", input: { reason: "Sourcing is blocked" } }], [finish("Sent options to the CFO.")]]), now: T0 });
    expect(w!.run!.calls[0]!.text).toContain("P-0001 and P-0002");
    expect(design.asked).toBeGreaterThan(0);
    expect(filed).toEqual([5, 2]);
  });

  it("its fallback answers a refusal through the stand-ins too", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (0, 'REFUSED', 'mandate_cap_exceeded: 0.04 is over the sourcing mandate''s 0.03 a payment', ?)").run(T0.toISOString());
    sendMessage(db, "sourcing", "treasury", "Refused over my cap.", T0);
    const w = await wake(db, treasuryProfile(30 * 60_000, { runFlow: noFlow, sim: bundle({ client: null, file: () => [{ proposal_id: "P-0009" }] }) }), { client: null, now: T0 });
    expect(w).toMatchObject({ source: "fallback", summary: "code's fixed plan went to the CFO as P-0009" });
  });
});

describe("Support on injected rails (D26)", () => {
  it("settle_dispute and the fallback run the given settlement, not the s2 child process", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    const settle = async (_db: unknown, who: "agent" | "code") => { by.push(who); return { ok: true, text: "refunded #7" }; };
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, { settle, idOf: () => "D-x", settles: () => "D-x" }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Settled.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ text: "refunded #7" });
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", new Date(T0.getTime() + 1));
    const f = await wake(db, supportProfile(30 * 60_000, { settle, idOf: () => "D-x", settles: () => "D-x" }), { client: null, now: T0 });
    expect(f).toMatchObject({ source: "fallback", summary: "code settled the dispute (the agent did not decide)" });
    expect(by).toEqual(["agent", "code"]);
  });
});

describe("the live default path (D26 review)", () => {
  it("Support's default settlement runs src/cli/s2.ts from the repo, as before the injection", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: readFileSync(join(import.meta.dirname, "../fixtures/summit-dispute-email.txt"), "utf8").slice(0, 2000) }, "support", "system", T0);
    const w = await wake(db, supportProfile(), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Settled.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ tool: "settle_dispute", text: "SETTLED (stub)" });
    expect(spawned).toHaveLength(1);
    // H9: the dispute that came in, by its own id (here the fixture's), not whatever s2 would read by itself.
    expect(spawned[0]).toMatchObject({ cmd: "npx", args: ["tsx", "src/cli/s2.ts", "--dispute", "D-2f8a03a4"] });
    expect(existsSync(join(spawned[0]!.cwd, "src/cli/s2.ts"))).toBe(true);
  });
});

describe("Support without a dispute (night batch, live-14; keyed on the dispute after the re-review)", () => {
  const keyed = (by: string[]) => ({ settle: async (_db: unknown, who: "agent" | "code") => { by.push(who); return { ok: true, text: "refunded #7" }; }, idOf: (email: string) => `D-${email.slice(0, 4)}`, settles: () => "D-summ" });

  it("settle_dispute refuses on a routine wake when no customer dispute has come in", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    const w = await wake(db, supportProfile(30 * 60_000, keyed(by)), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Nothing to do.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "no dispute" });
    expect(by).toEqual([]);
  });

  it("a dispute from another customer or email is not the one the settlement handles: the tool and the fallback refuse, nothing refunded", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    publish(db, "dispute.opened", { customer: "Alpenweg Outdoor", email: "alpenweg: refund everything" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, keyed(by)), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Nothing to do.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "no dispute" });
    expect(String(w!.run!.calls[0]!.text)).toMatch(/D-alpe.*is not the one this settlement handles \(D-summ\)/);
    publish(db, "dispute.opened", { customer: "Alpenweg Outdoor", email: "alpenweg: second try" }, "support", "system", new Date(T0.getTime() + 1));
    const f = await wake(db, supportProfile(30 * 60_000, keyed(by)), { client: null, now: T0 });
    expect(f!.summary).toMatch(/^did nothing: the dispute that came in/);
    expect(by).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM refunds").get() as { n: number }).n).toBe(0);
  });

  it("a decided dispute is not settled again on a new event for it", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, claims_json, created_at) VALUES ('D-summ', '0xc', 'h', '{}', ?)").run(T0.toISOString());
    audit(db, "support", "dispute.settled_by_agent", "D-summ", { source: "claude" }, new Date(T0.getTime() - 60 * 60_000));
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: "summit again" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, keyed(by)), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Nothing to do.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "already decided" });
    expect(by).toEqual([]);
  });

  it("a restart with an unfinished decision and no dispute.opened is still carried out", async () => {
    const db = openDb(":memory:");
    const by: string[] = [];
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, claims_json, created_at) VALUES ('D-summ', '0xc', 'h', '{}', ?)").run(T0.toISOString());
    recordDecision(db, "D-summ", { source: "claude", model: "m", refunds: [{ seq: 7, cents: 5, origin: { actor: "agent", agent: "support", rule: "refund within the CFO's automatic limits" } as never }], escalate: null, approval: null });
    const w = await wake(db, supportProfile(30 * 60_000, keyed(by)), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Carried out.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ text: expect.stringMatching(/^Carried out the dispute's recorded decision/) });
    expect(by).toEqual(["agent"]);
  });
});

// dry-179, item 8 (2 November): Treasury filed P-0002/P-0003 (mandate replaces) at 22:01:37, swept 0.45 from its own
// mandate on a routine wake at 22:01:47, and P-0002, approved 2 of 2 at 22:02:37, failed on the executor's guard:
// "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed". The guard stays as strict as it is.
// Now, while a mandate replace is open for an agent's mandate (waiting for approval, approved and not yet run, or being
// run, within its time), nothing that agent controls spends from that mandate: Purser refuses before signing, with the
// reason and an audit row, on every Metal path (Sourcing's purchases, Support's refunds, Treasury's sweeps), and the
// agent's own situation states the hold. The hold lifts when the replace is executed, rejected, superseded, expires or
// fails. Fakes only: no chain, no Claude.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { openDb, type DB } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { createProposal } from "../src/policy/approvals.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";
import { holdBeyondCap, reserveSpend } from "../src/policy/holds.js";
import { openReplacesFor, replaceHoldFact, replaceHoldRefusal } from "../src/policy/replaceHold.js";
import { executeSweep } from "../src/agents/sweep.js";
import { refundSale } from "../src/executors/refunds.js";
import { carryOut, decisionOf, recordDecision } from "../src/agents/disputeDecision.js";
import { supportProfile, treasuryProfile, type TreasurySim } from "../src/autonomy/teamProfiles.js";
import { sourcingProfile, type SourcingWorld } from "../src/autonomy/sourcingProfile.js";
import { publish } from "../src/autonomy/bus.js";
import type { Puller } from "../src/metal/pull.js";

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; });
afterEach(() => { process.env = { ...env }; });

const PAYER = "0x00000000000000000000000000000000000000c1" as Address;
const SWEEP = "0x00000000000000000000000000000000000000aa" as Address;
const HOUR = 3_600_000;

function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  audit(db, "owner-signer", "mandate.bound", "support", { cap: "0.10", budget: "4.00" });
  audit(db, "owner-signer", "mandate.bound", "treasury", { cap: "6.00", budget: "6.00" });
  return db;
}
let ids = 0;
/** A mandate replace like Treasury's P-0002: steps for the named agents, spent as at the proposal. */
function replace(db: DB, agents: string[], o: { expiresAt?: string; now?: Date } = {}): string {
  const id = `P-${String(++ids + 1).padStart(4, "0")}`;
  const steps = agents.map((agent, i) => ({ order: String(i + 1), agent, principal: "0xb1", cap: "0.04", budget: "6.00", payees: [], expires_at: "2099-01-01T00:00:00Z", credential_hash: `0x${agent}1`, replaces_credential_hash: `0x${agent}0`, spent_at_proposal: "0.00" }));
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: o.expiresAt ?? new Date(Date.now() + HOUR).toISOString(), option: "A", query_price: "0.05", upstream_price: "0.04", margin: "0.01", total_budget: "20.00", steps, evidence: [] } as never, createdBy: "treasury" }, o.now);
  return id;
}
const setStatus = (db: DB, id: string, status: string) => db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(status, id);
const n = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const events = (db: DB, e: string) => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { subject: string; payload_json: string }[]).map((r) => ({ subject: r.subject, ...JSON.parse(r.payload_json) as Record<string, unknown> }));
function sale(db: DB, cents = 5): number {
  db.prepare("INSERT OR IGNORE INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-1', 'Summit Outfitters', 'x', 'now')").run();
  return Number(db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', ?, ?, 'u', '{}', 'DELIVERED', 'now')").run(cents, PAYER).lastInsertRowid);
}
/** A fake pull that records what it was asked to send. */
function puller(): { pull: Puller; sent: string[] } {
  const sent: string[] = [];
  return { sent, pull: async (r) => { sent.push(r.paymentId); return { outcome: "PAID", tx: `0x${"ee".repeat(32)}`, reason: null, already: false }; } };
}
beforeEach(() => { ids = 0; });

describe("which replace holds which mandate", () => {
  it("an open replace holds the mandates its steps name, and no other", () => {
    const db = world();
    const id = replace(db, ["sourcing", "treasury"]);
    expect(replaceHoldRefusal(db, "treasury")).toBe(`replace_pending: mandate replace ${id} pending; spending waits until it is executed or closed`);
    expect(replaceHoldRefusal(db, "sourcing")).toMatch(/^replace_pending: /);
    expect(replaceHoldRefusal(db, "support")).toBeNull();
    // Both options of a price rise replace the same mandates: both are named.
    const other = replace(db, ["sourcing", "treasury"]);
    expect(replaceHoldRefusal(db, "treasury")).toBe(`replace_pending: mandate replace ${id} and ${other} pending; spending waits until it is executed or closed`);
  });

  it("holds while waiting for approval (also 1 of 2), approved and not yet run, or being run; lifts when executed, rejected, superseded, expired, failed or sent back", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "EXECUTING"]) {
      const db = world();
      setStatus(db, replace(db, ["treasury"]), status);
      expect(openReplacesFor(db, "treasury")).toHaveLength(1);
    }
    // A replace whose execution stopped (dry-179's P-0002: FAILED) never keeps the hold.
    for (const status of ["EXECUTED", "REJECTED", "SUPERSEDED", "EXPIRED", "FAILED", "NEEDS_REAPPROVAL"]) {
      const db = world();
      setStatus(db, replace(db, ["treasury"]), status);
      expect(replaceHoldRefusal(db, "treasury")).toBeNull();
    }
  });

  it("lifts at the replace's expiry, even before any process marks it EXPIRED; also an approved one never run", () => {
    const db = world();
    const id = replace(db, ["treasury"], { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(replaceHoldRefusal(db, "treasury")).not.toBeNull();
    expect(replaceHoldRefusal(db, "treasury", new Date(Date.now() + 61_000))).toBeNull();
    setStatus(db, id, "APPROVED");
    expect(replaceHoldRefusal(db, "treasury", new Date(Date.now() + 61_000))).toBeNull();
  });

  it("states the hold as a fact for the agent, with the replace, its state and its expiry", () => {
    const db = world();
    const id = replace(db, ["treasury"], { expiresAt: "2099-01-01T22:58:00Z" });
    expect(replaceHoldFact(db, "treasury")).toMatch(new RegExp(`^Your mandate is on hold: mandate replace ${id} \\(waiting for approval, expires 22:58 UTC\\).*refuses every payment under your mandate before signing until that replace is executed or closed`));
    expect(replaceHoldFact(db, "support")).toBeNull();
  });
});

describe("Purser holds every Metal payment of a named agent before signing", () => {
  it("Sourcing's purchase, Support's refund and Treasury's sweep are refused with the reason; nothing reserved or counted", () => {
    const db = world();
    replace(db, ["sourcing", "support", "treasury"]);
    for (const [agent, payee, cents] of [["sourcing", "supplier", 2], ["support", "customer", 5], ["treasury", "sweep", 45]] as const) {
      expect(reserveSpend(db, { agent, rail: "metal", cents, ref: `${agent}:1`, payee })).toMatch(/^replace_pending: mandate replace P-0002 pending; spending waits until it is executed or closed$/);
    }
    // The one let-through and the record pull of Metal's refusal are Metal payments under the mandate too.
    expect(holdBeyondCap(db, { agent: "sourcing", cents: 4, ref: "lt:1", payee: "supplier" })).toMatch(/^replace_pending: /);
    expect(n(db, "SELECT COUNT(*) AS n FROM holds")).toBe(0);
    expect(n(db, "SELECT COUNT(*) AS n FROM velocity_events")).toBe(0);
  });

  it("an agent the replace does not name pays as before; the emergency stop still reads as the emergency stop", () => {
    const db = world();
    replace(db, ["sourcing", "treasury"]);
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 5, ref: "refund-1", payee: "customer" })).toBeNull();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', 'now')").run();
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 45, ref: "s:1", payee: "sweep" })).toMatch(/^frozen_by_cfo/);
  });

  it("the caps are still checked once the hold lifts (nothing gets looser)", () => {
    const db = world();
    const id = replace(db, ["sourcing"]);
    setStatus(db, id, "EXECUTED");
    expect(reserveSpend(db, { agent: "sourcing", rail: "metal", cents: 4, ref: "u:1", payee: "supplier" })).toMatch(/^mandate_cap_exceeded: /);
  });
});

describe("Treasury's sweep (the dry-179 case)", () => {
  it("is refused before signing while the replace is open: nothing pulled, a REFUSED row and a sweep.refused row with the reason", async () => {
    const db = world();
    sale(db, 45);
    const id = replace(db, ["sourcing", "treasury"]);
    const p = puller();
    const r = await executeSweep(db, "sweep-20261102-1", 45, SWEEP, p.pull);
    expect(r).toMatchObject({ outcome: "REFUSED", tx: null, reason: `replace_pending: mandate replace ${id} pending; spending waits until it is executed or closed` });
    expect(p.sent).toEqual([]);
    expect(events(db, "sweep.refused")).toEqual([expect.objectContaining({ subject: "sweep-20261102-1", reason: expect.stringMatching(/^replace_pending: /) })]);
    // Rejected: the hold lifts and the same sweep goes through.
    setStatus(db, id, "REJECTED");
    expect(await executeSweep(db, "sweep-20261102-1", 45, SWEEP, p.pull)).toMatchObject({ outcome: "PAID" });
    expect(p.sent).toEqual(["sweep-20261102-1"]);
  });

  it("a sweep already sent is not sent again while the replace is open: deferred, its state kept", async () => {
    const db = world();
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-1', 45, 'PENDING', 'now')").run();
    replace(db, ["treasury"]);
    const p = puller();
    expect(await executeSweep(db, "sweep-1", 45, SWEEP, p.pull)).toMatchObject({ outcome: "PENDING", reason: expect.stringMatching(/^replace_pending: /) });
    expect(p.sent).toEqual([]);
    expect(events(db, "sweep.deferred")).toHaveLength(1);
  });
});

describe("Support's refunds", () => {
  it("a refund is refused before signing while Support's mandate is in an open replace: nothing pulled, the reason recorded", async () => {
    const db = world();
    const s = sale(db);
    replace(db, ["support", "treasury"]);
    const p = puller();
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" }, { pull: p.pull })).toMatchObject({ outcome: "REFUSED", reason: expect.stringMatching(/^replace_pending: /) });
    expect(p.sent).toEqual([]);
    expect(events(db, "refund.refused")).toEqual([expect.objectContaining({ reason: expect.stringMatching(/^replace_pending: /) })]);
  });

  it("a refund already sent and held is not sent again while the replace is open: deferred, kept HELD", async () => {
    const db = world();
    const s = sale(db);
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (?, ?, 5, ?, 'HELD', 'D-1')").run(s, `refund-${s}`, PAYER);
    replace(db, ["support"]);
    const p = puller();
    expect(await refundSale(db, { sale_id: s, amount_cents: 5, to: PAYER, dispute_id: "D-1" }, { pull: p.pull, retry: true })).toMatchObject({ outcome: "HELD", reason: expect.stringMatching(/^replace_pending: /) });
    expect(p.sent).toEqual([]);
    expect(events(db, "refund.deferred")).toHaveLength(1);
  });

  it("a dispute's refund held by a replace is tried again later, not handed to the CFO as refused for good", async () => {
    const db = world();
    sale(db);
    recordDecision(db, "D-1", { source: "claude", model: null, refunds: [{ seq: 7, cents: 5, origin: null }], escalate: null, approval: null });
    const reason = "replace_pending: mandate replace P-0002 pending; spending waits until it is executed or closed";
    const d = await carryOut(db, "D-1", { refund: async () => ({ outcome: "REFUSED", reason }), existing: () => null, create: () => "P-9999" });
    expect(d).toMatchObject({ status: "DECIDED", handover: [], paid: [] });
    expect(decisionOf(db, "D-1")!.handover_proposal).toBeNull();
  });
});

describe("the agents' own tools and situation", () => {
  function treasurySim(calls: string[]): TreasurySim {
    return {
      mandates: async () => [{ agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 0 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 }, { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 }] as never,
      proposePriceRise: async () => { calls.push("propose"); return []; },
      client: null,
      sweep: async () => { calls.push("sweep"); return { ok: true, text: "swept" }; },
      planInvoice: async () => { calls.push("plan"); return { ok: true, text: "planned" }; },
    };
  }

  it("Treasury: sweep_earnings is held with the reason (an audit row, no flow run), and its position says so", async () => {
    const db = world();
    sale(db, 45);
    const id = replace(db, ["sourcing", "treasury"]);
    const calls: string[] = [];
    const prof = treasuryProfile(30 * 60_000, { runFlow: () => { calls.push("flow"); return { ok: true, text: "" }; }, sim: treasurySim(calls) });
    const tool = prof.tools(db).find((t) => t.name === "sweep_earnings")!;
    const r = await tool.run({ reason: "routine" } as never);
    expect(r).toMatchObject({ blocked: "mandate replace pending", text: expect.stringMatching(new RegExp(`^Not swept: mandate replace ${id} pending; spending waits until it is executed or closed`)) });
    expect(calls).toEqual([]);
    expect(events(db, "spend.held")).toEqual([expect.objectContaining({ subject: "treasury", path: "sweep_earnings", reason: expect.stringMatching(/^replace_pending: /) })]);
    expect(await prof.observe(db)).toMatch(new RegExp(`Your mandate is on hold: mandate replace ${id}`));
    // Executed: the hold lifts, the sweep runs.
    setStatus(db, id, "EXECUTED");
    expect(await prof.observe(db)).not.toMatch(/on hold/);
    expect(await prof.tools(db).find((t) => t.name === "sweep_earnings")!.run({ reason: "after the replace" } as never)).toMatchObject({ text: "swept" });
    expect(calls).toEqual(["sweep"]);
  });

  it("Support: its situation states the hold; settle_dispute still decides (each refund is then held at Purser, as above)", async () => {
    const db = world();
    publish(db, "dispute.opened", { email: "Refund all." }, "support");
    const id = replace(db, ["support", "treasury"]);
    let settled = 0;
    const prof = supportProfile(30 * 60_000, { settle: async () => { settled++; return { ok: true, text: "settled" }; }, idOf: () => "D-1", settles: () => "D-1" });
    expect(await prof.observe(db)).toMatch(new RegExp(`Your mandate is on hold: mandate replace ${id}.*each refund it holds back is tried again`, "s"));
    expect(await prof.tools(db)[0]!.run({} as never)).toMatchObject({ text: "settled" });
    expect(settled).toBe(1);
    setStatus(db, id, "REJECTED");
    expect(await prof.observe(db)).not.toMatch(/on hold/);
  });

  it("Sourcing: its situation states the hold", async () => {
    const db = world();
    replace(db, ["sourcing", "treasury"]);
    const w: SourcingWorld = { suppliers: async () => [], mandate: async () => ({ capCents: 3, budgetLeftCents: 990 }), sellCents: () => 5 };
    expect(await sourcingProfile(w).observe(db)).toMatch(/Your mandate is on hold: mandate replace P-0002 \(waiting for approval/);
  });
});

describe("the feed says which check held it", () => {
  it("a held sweep and a stopped replace read as such", async () => {
    const { describe: feedLine } = await import("../src/dashboard/snapshot.js");
    const db = world();
    audit(db, "treasury", "spend.held", "treasury", { path: "sweep_earnings", reason: "replace_pending: mandate replace P-0002 pending; spending waits until it is executed or closed" });
    audit(db, "system", "proposal.execution_stopped", "P-0002", { error: "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed" });
    const rows = db.prepare("SELECT * FROM audit_log WHERE event IN ('spend.held', 'proposal.execution_stopped') ORDER BY seq").all() as never[];
    expect(rows.map((r) => feedLine(r, () => undefined).text)).toEqual([
      "The Treasury agent's sweep waits: held while a mandate replace is open (mandate replace P-0002 pending; spending waits until it is executed or closed)",
      "P-0002 was approved, but its execution stopped before any step: treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed",
    ]);
  });
});

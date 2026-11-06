// Reliability runs (Phase 1A): the record of a world is measured from its ledger alone, says honestly who signed (a
// labelled virtual test passkey is never a person's Face ID), and a run is never overwritten or dropped from the list.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { acceptance, appendRunRecord, measureRun, RELIABILITY_KIND, reliabilityWorldOk, signerLabel } from "../src/ops/reliability.js";

const tx = (c: string) => `0x${c.repeat(64)}`;

describe("reliability worlds", () => {
  it("accepts only rel-<n>[letter]; never the main run, a dry run or the reserve world", () => {
    for (const ok of ["rel-1", "rel-2", "rel-1b", "rel-12"]) expect(reliabilityWorldOk(ok)).toBe(true);
    for (const no of ["main-1", "dry-180", "live-1", "agent-1", "rel-", "rel-1-b", "../rel-1", "rel-1.sqlite"]) expect(reliabilityWorldOk(no)).toBe(false);
  });

  it("names who signed in words: virtual test passkeys by role, Max only for his own passkey", () => {
    expect(signerLabel("test-cfo (passkey tBNPXzjN)")).toBe("virtual test passkey (CFO role)");
    expect(signerLabel("test-controller (passkey hBrO2Wos)")).toBe("virtual test passkey (second approver role)");
    expect(signerLabel("max (passkey Y7bi-1ZE)")).toMatch(/^Max's own passkey, Face ID/);
  });
});

describe("measureRun", () => {
  it("counts sales, refusals per layer, Metal transactions, Airwallex ids, signatures and the audit chain", () => {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "business.funded", "B", { amount: "20.00", tx: tx("a") });
    audit(db, "owner-signer", "mandate.bound", "sourcing", { tx: tx("b") });
    audit(db, "sourcing", "query.answered", "1", { status: 200, tx: tx("c") });
    audit(db, "sourcing", "sale.delivered", "1", { tx: tx("c") });
    audit(db, "sourcing", "upstream.paid", "1", { tx: tx("d") });
    audit(db, "sourcing", "query.answered", "2", { status: 503 });
    audit(db, "sourcing", "upstream.refused", "2", { reason: "mandate_cap_exceeded", refused_by: "metal", seq: 2 });
    audit(db, "sourcing", "upstream.refused_on_chain", "2", { tx: tx("e"), mandate: tx("f") });
    audit(db, "sourcing", "upstream.let_through_refused", "2", { metal_reason: "mandate_cap_exceeded", metal_status: 402, label: "Defense in depth: …" });
    audit(db, "sourcing", "sale.refused", "2", { status: 503, settled: false });
    audit(db, "sourcing", "query.answered", "3", { status: 503 });
    audit(db, "sourcing", "upstream.refused", "3", { reason: "mandate_cap_exceeded: 0.04 is over 0.03", refused_by: "purser" });
    audit(db, "sourcing", "sale.refused", "3", { status: 503, settled: false });
    audit(db, "sourcing", "upstream.refused", "4", { reason: "buy_policy: …", refused_by: "buy_policy" });
    audit(db, "sourcing", "agent.tool", "t", { tool: "pay", blocked_by: "policy" });
    audit(db, "sourcing", "agent.tool", "t", { tool: "look" });
    audit(db, "sourcing", "card.charge_declined", "x", { reason: "LIMIT_EXCEEDED" });
    audit(db, "sourcing", "agent.decision", "w", { source: "claude" });
    audit(db, "treasury", "agent.decision", "w", { source: "fallback" });
    audit(db, "sourcing", "agent.run", "w", { cost_usd_micros: 2500, claude_calls: [{ request_id: "req_1", model: "claude-haiku-5-5", tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, cost_usd_micros: 2500 }] });
    audit(db, "human", "proposal.cosigned", "P-0002", { approver: "test-cfo (passkey A)" });
    audit(db, "human", "proposal.approved", "P-0002", { approver: "test-cfo (passkey A) + test-controller (passkey B)" });
    audit(db, "human", "proposal.rejected", "P-0004", { approver: "test-cfo (passkey A)" });
    audit(db, "treasury", "credit.deposited", "sweep-1", { deposit_id: "dep-1", amount: "0.51", reference: tx("g") });
    db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES (?, 'ch-1', ?, ?, 'n', 'EUR', 3000, 10000, 'ACTIVE', 't', 't')").run("sourcing", "card-1", "9604");

    const m = measureRun(db);
    expect(m.sales).toMatchObject({ queries: 3, sold: 1, refused: 2, upstream_paid: 1, upstream_refused: 3, upstream_cached: 0 });
    expect(m.refusals).toMatchObject({
      purser_before_signing: 1, metal_on_the_rail: 1, metal_refusals_recorded_on_chain: 1, sourcing_buy_policy: 1, supplier: 0,
      airwallex_card_declines: 1, code_refused_agent_tool_calls: 1, cfo_rejections: 1, customer_answered_error_not_settled: 2,
    });
    // a, b, c (once: the sale and its answer name the same tx), d, e; the mandate reference f is not a transaction.
    expect(m.metal.transactions).toBe(5);
    expect(m.decisions).toMatchObject({ total: 2, by_claude: 1, fallback: 1, fallback_pct: 50 });
    expect(m.claude).toMatchObject({ calls: 1, calls_without_request_id: 0, cost_usd: 0.0025 });
    expect(m.airwallex.deposits).toEqual([{ deposit_id: "dep-1", amount: "0.51", reference: tx("g") }]);
    expect(m.airwallex.cards).toEqual([{ agent: "sourcing", card_id: "card-1", last4: "9604" }]);
    expect(m.signatures.map((s) => [s.proposal, s.decision, s.signed_by])).toEqual([
      ["P-0002", "1 of 2", ["virtual test passkey (CFO role)"]],
      ["P-0002", "approved", ["virtual test passkey (CFO role)", "virtual test passkey (second approver role)"]],
      ["P-0004", "rejected", ["virtual test passkey (CFO role)"]],
    ]);
    expect(m.flow.let_through_refused_by_metal).toMatchObject({ reason: "mandate_cap_exceeded", status: 402 });
    expect(m.flow.refusal_on_chain_tx).toBe(tx("e"));
    expect(m.audit).toMatchObject({ rows: 24, chain_intact: true, problem: null });
  });

  it("reports a broken audit chain instead of calling it intact", () => {
    const db = openDb(":memory:");
    audit(db, "system", "a", null, {});
    audit(db, "system", "b", null, {});
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").all() as { name: string }[]) db.exec(`DROP TRIGGER "${name}"`);
    db.prepare("UPDATE audit_log SET payload_json = '{\"x\":1}' WHERE seq = 1").run();
    const m = measureRun(db);
    expect(m.audit.chain_intact).toBe(false);
    expect(m.audit.problem).toMatch(/^seq 1/);
  });
});

describe("the acceptance list", () => {
  it("fails a row it has no evidence for, and names the checks that did not exit 0", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "query.answered", "1", { status: 200, tx: tx("c") });
    audit(db, "sourcing", "sale.delivered", "1", { tx: tx("c") });
    audit(db, "sourcing", "upstream.paid", "1", { tx: tx("d") });
    const rows = acceptance(measureRun(db), { checks: { verify: 0, reconcile: 1 }, secondApproverLabel: true });
    const by = (prefix: string) => rows.find((r) => r.item.startsWith(prefix))!;
    expect(by("4 Upstream").ok).toBe(true);
    expect(by("5 The refusal").ok).toBe(false);
    expect(by("9 Four eyes").ok).toBe(false);
    expect(by("17 EUR licence").ok).toBe(false);
    expect(by("§2 verify").evidence).toBe("non-zero: reconcile");
    expect(by("§2 Audit chain").ok).toBe(true);
  });
});

describe("the list of reliability runs", () => {
  it("appends a run, and refuses to overwrite one or to take a run that is not a reliability world", () => {
    const file = join(mkdtempSync(join(tmpdir(), "rel-")), "reliability.json");
    appendRunRecord(file, { run: "rel-1", kind: RELIABILITY_KIND, passed: false });
    appendRunRecord(file, { run: "rel-1b", kind: RELIABILITY_KIND, passed: true });
    expect(() => appendRunRecord(file, { run: "rel-1", kind: RELIABILITY_KIND, passed: true })).toThrow(/already in .*rel-1b/);
    expect(() => appendRunRecord(file, { run: "main-1", kind: RELIABILITY_KIND })).toThrow(/not a reliability world/);
    expect(() => appendRunRecord(file, { run: "rel-2", kind: "main run" })).toThrow(/reliability run/);
    const list = JSON.parse(readFileSync(file, "utf8")) as { run: string; passed: boolean }[];
    expect(list.map((r) => [r.run, r.passed])).toEqual([["rel-1", false], ["rel-1b", true]]);
  });

  it("refuses a file that is not a list", () => {
    const file = join(mkdtempSync(join(tmpdir(), "rel-")), "reliability.json");
    writeFileSync(file, "{}");
    expect(() => appendRunRecord(file, { run: "rel-1", kind: RELIABILITY_KIND })).toThrow(/not a list/);
  });
});

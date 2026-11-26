// The policy simulator (src/policy/simulate.ts): before the CFO signs a policy change, Purser replays the period's
// supplier payments under the policy in force and under the proposed one, with Purser's own decision code (the limit to
// pay alone, four eyes, the second key, the anomaly hold, a blocked payee or entity, the emergency stop), and says what
// would have gone differently. Breaks if raising or lowering the limit to pay alone stops moving payments between "paid
// alone" and "needs the CFO", if a blocked payee or entity is not "refused", if an empty change reports a difference, if
// a payment Purser never pays alone (filed outside the inbox, or declined by an agent) is counted as paid alone, or if a
// run writes anything to the ledger or calls out.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { buildRelayState } from "../src/relay/state.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, nextProposalId } from "../src/policy/approvals.js";
import { registerEntity } from "../src/policy/entities.js";
import { parseSimulationArgs, simulatePolicyChange, simulationLine, simulationReport } from "../src/policy/simulate.js";
import { rmTemp } from "./support/rmTemp.js";

const NOW = new Date("2026-11-20T10:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

/**
 * A policy setting the CFO signed: a policy_change proposal that ran (EXECUTED), approved by passkey, and its
 * policy.changed record, as src/executors/policyChange.ts leaves them (what aloneLimitInForce and mayPayFrom read).
 */
function signed(db: DB, key: string, to: string, when = at(60)): void {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: id, expires_at: "2027-01-01T00:00:00Z", changes: [{ key, label: key, from: "", to }], reason: "test" } as Terms;
  const p = createProposal(db, { terms, createdBy: "human" }, when);
  db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = ?").run(id);
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version) VALUES (?, 'APPROVED', ?, 'max (passkey k_test)', 'passkey', ?, NULL, ?, 1)")
    .run(id, p.terms_sha256, p.terms_sha256.slice(0, 8), when.toISOString());
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, to, when.toISOString());
  audit(db, "system", "policy.changed", key, { proposal_id: id, key, from: "", to }, when);
}

interface PayOpts { daysAgo?: number; inbox?: boolean; status?: string; entity?: string; findings?: string[] }
/** A supplier payment filed `daysAgo` days ago; through the payables inbox (an ap_invoices row) unless inbox: false. */
function pay(db: DB, amount: string, payee: string, o: PayOpts = {}): string {
  const id = nextProposalId(db);
  const when = at(o.daysAgo ?? 5);
  const entity = o.entity ? { paying_entity: { id: o.entity, name: o.entity, country: "NL" }, funding_account: { id: "acct_test_nl", currency: "EUR" } } : {};
  const terms = { schema: TERMS_SCHEMA, kind: "supplier_payment", proposal_id: id, expires_at: "2027-01-01T00:00:00Z", amount, currency: "EUR", vendor: payee, beneficiary_name: payee, beneficiary_id: `ben_${payee.replace(/\W/g, "")}`, ...entity } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, when);
  if (o.status) db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(o.status, id);
  if (o.inbox !== false) {
    const sha = createHash("sha256").update(id).digest("hex");
    db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, text_chars, received_at) VALUES (?, 'i.pdf', 'application/pdf', 1, ?, 'upload', 1, ?)").run(sha, `x/${sha}`, when.toISOString());
    const findings = JSON.stringify((o.findings ?? []).map((code) => ({ code, level: "warn", detail: code })));
    db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by,
      gl_account, gl_rule, cost_centre, status, findings_json, proposal_id, received_at, updated_at) VALUES (?, ?, 'invoice', 'test', ?, ?, '2026-11-01', '2026-12-01', 'EUR', ?, '0.00', ?, '1234', 'TESTNL2A', '{}', 'test', '4000', 'test', '', 'waiting_cfo', ?, ?, ?, ?)`)
      .run(`AP-${id}`, sha, payee, `INV-${id}`, amount, amount, findings, id, when.toISOString(), when.toISOString());
  }
  return id;
}

/** A company with a limit to pay alone of EUR 500.00 the CFO signed, and three payments last week. */
function world(): { db: DB; small: string; mid: string; big: string } {
  const db = openDb(":memory:");
  signed(db, "ap.alone_eur", "500.00");
  return { db, small: pay(db, "300.00", "Alpenwolle AG"), mid: pay(db, "800.00", "Bergtex Textil GmbH"), big: pay(db, "1200.00", "Cordura Supply BV") };
}
const outcomes = (r: ReturnType<typeof simulatePolicyChange>) => Object.fromEntries(r.payments.map((p) => [p.proposal_id, `${p.before.outcome}->${p.after.outcome}`]));

afterEach(() => vi.restoreAllMocks());

describe("the policy simulator", () => {
  it("raising ap.alone_eur makes payments that needed the CFO paid alone", () => {
    const { db, small, mid, big } = world();
    const r = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }], { since: "2026-11-01", now: NOW });
    expect(outcomes(r)).toEqual({ [small]: "alone->alone", [mid]: "cfo->alone", [big]: "cfo->cfo" });
    expect(r.counts).toEqual({ needs_cfo: 0, paid_alone: 1, refused: 0, unchanged: 2 });
    expect(r.payments.find((p) => p.proposal_id === mid)!.change).toBe("paid_alone");
    expect(r.changes).toEqual([{ key: "ap.alone_eur", from: "500.00", to: "1000.00" }]);
    expect(r.summary).toBe("If this had been in force since 2026-11-01: 1 payment would have been paid alone instead of by the CFO; 2 unchanged (3 replayed).");
  });

  it("lowering a limit makes paid-alone payments need the CFO: the limit to pay alone, or four eyes", () => {
    const { db, small } = world();
    const lower = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "200.00" }], { since: "2026-11-01", now: NOW });
    expect(lower.payments.find((p) => p.proposal_id === small)).toMatchObject({ before: { outcome: "alone" }, after: { outcome: "cfo", why: expect.stringMatching(/not within the EUR 200\.00/) }, change: "needs_cfo" });
    expect(lower.counts).toEqual({ needs_cfo: 1, paid_alone: 0, refused: 0, unchanged: 2 });
    // Removing the limit: nothing is paid alone.
    expect(simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "" }], { since: "2026-11-01", now: NOW }).counts.needs_cfo).toBe(1);
    // Four eyes above EUR 250.00: within the limit, but two people sign it now.
    const four = simulatePolicyChange(db, [{ key: "approval.four_eyes_eur", to: "250.00" }], { since: "2026-11-01", now: NOW });
    expect(four.payments.find((p) => p.proposal_id === small)).toMatchObject({ after: { outcome: "cfo", why: expect.stringMatching(/four eyes/) }, change: "needs_cfo" });
    expect(four.summary).toMatch(/^If this had been in force since 2026-11-01: 1 payment would have needed the CFO; 2 unchanged \(3 replayed\)\.$/);
  });

  it("blocking a payee or the paying entity makes its payments refused", () => {
    const { db, mid } = world();
    const r = simulatePolicyChange(db, [{ key: "counterparty:Bergtex Textil GmbH", to: "blocked" }], { since: "2026-11-01", now: NOW });
    expect(r.payments.find((p) => p.proposal_id === mid)).toMatchObject({ before: { outcome: "cfo" }, after: { outcome: "refused", why: expect.stringMatching(/Bergtex Textil GmbH is blocked/) }, change: "refused" });
    expect(r.counts).toEqual({ needs_cfo: 0, paid_alone: 0, refused: 1, unchanged: 2 });
    expect(r.summary).toBe("If this had been in force since 2026-11-01: 1 payment would have been refused; 2 unchanged (3 replayed).");

    registerEntity(db, "human", { id: "nl-bv", name: "Northwind NL BV", country: "NL", currency: "EUR", funding_account: "acct_test_nl" }, at(70));
    signed(db, "pay_from.nl-bv.treasury", "allowed");
    const fromNl = pay(db, "100.00", "Delta Draad BV", { entity: "nl-bv" });
    const e = simulatePolicyChange(db, [{ key: "pay_from.nl-bv.treasury", to: "blocked" }], { since: "2026-11-01", now: NOW });
    expect(e.payments.find((p) => p.proposal_id === fromNl)).toMatchObject({ before: { outcome: "alone" }, after: { outcome: "refused", why: expect.stringMatching(/may not pay from nl-bv/) } });
    // The emergency stop refuses every payment.
    expect(simulatePolicyChange(db, [{ key: "freeze", to: "on" }], { since: "2026-11-01", now: NOW }).payments.every((p) => p.after.outcome === "refused")).toBe(true);
  });

  it("an empty change reports nothing different", () => {
    const { db } = world();
    const r = simulatePolicyChange(db, [], { since: "2026-11-01", now: NOW });
    expect(r.payments).toHaveLength(3);
    expect(r.payments.every((p) => p.change === "unchanged" && p.before.outcome === p.after.outcome && p.before.why === p.after.why)).toBe(true);
    expect(r.counts).toEqual({ needs_cfo: 0, paid_alone: 0, refused: 0, unchanged: 3 });
    expect(r.summary).toBe("If this had been in force since 2026-11-01: no payment would have been decided differently (3 replayed).");
    // A change to a value already in force is no change either.
    expect(simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "500.00" }], { since: "2026-11-01", now: NOW }).counts.unchanged).toBe(3);
  });

  it("replays only the period, and says so when there is nothing to replay", () => {
    const { db } = world();
    pay(db, "100.00", "Old Supplier BV", { daysAgo: 40 });
    expect(simulatePolicyChange(db, [], { since: "2026-11-01", now: NOW }).payments).toHaveLength(3);
    expect(simulatePolicyChange(db, [], { now: NOW }).since).toBe("2026-10-21"); // 30 days by default
    expect(simulatePolicyChange(db, [], { now: NOW }).payments).toHaveLength(3);
    expect(simulatePolicyChange(db, [], { since: "2026-10-01", now: NOW }).payments).toHaveLength(4);
    expect(simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "900.00" }], { since: "2026-11-19", now: NOW }).summary).toBe("If this had been in force since 2026-11-19: there were no supplier payments to replay.");
    expect(() => simulatePolicyChange(db, [], { since: "1 Nov", now: NOW })).toThrow(/YYYY-MM-DD/);
    expect(() => simulatePolicyChange(db, [{ key: "freeze", to: "on" }, { key: "freeze", to: "off" }], { now: NOW })).toThrow(/twice/);
  });

  it("keeps with the CFO what Purser never pays alone, whatever the limit: outside the inbox, an agent's no, a finding", () => {
    const { db } = world();
    const kit11 = pay(db, "600.00", "Elbe Garn GmbH", { inbox: false });
    const checkerSaidNo = pay(db, "600.00", "Fjord Filz AS");
    audit(db, "treasury", "ap.alone_declined", `AP-${checkerSaidNo}`, { invoice_id: `AP-${checkerSaidNo}`, proposal_id: checkerSaidNo, by: "checker", why: "the Checker agent's decision is hold" }, at(5));
    const split = pay(db, "600.00", "Garnet Wool Ltd", { findings: ["possible_split"] });
    const r = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "5000.00" }], { since: "2026-11-01", now: NOW });
    expect(r.payments.find((p) => p.proposal_id === kit11)!.after).toMatchObject({ outcome: "cfo", why: expect.stringMatching(/outside the payables inbox/) });
    expect(r.payments.find((p) => p.proposal_id === checkerSaidNo)!.after).toMatchObject({ outcome: "cfo", why: expect.stringMatching(/Checker agent/) });
    expect(r.payments.find((p) => p.proposal_id === split)!.after).toMatchObject({ outcome: "cfo", why: expect.stringMatching(/possible_split/) });
  });

  it("re-runs the anomaly hold with the payee's history as it stood then", () => {
    const { db } = world();
    for (const [a, d] of [["100.00", 15], ["110.00", 14], ["120.00", 13]] as const) pay(db, a, "Hollow Hemp BV", { daysAgo: d, status: "EXECUTED" });
    const odd = pay(db, "800.00", "Hollow Hemp BV", { daysAgo: 2 });
    const r = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }], { since: "2026-11-01", now: NOW });
    expect(r.payments.find((p) => p.proposal_id === odd)!.after).toMatchObject({ outcome: "cfo", why: expect.stringMatching(/unusual amount: over 3x Hollow Hemp BV's median of EUR 110\.00/) });
    // The first of the three had no history then: not held.
    expect(r.payments.filter((p) => p.payee === "Hollow Hemp BV" && p.amount === "100.00")[0]!.after.outcome).toBe("alone");
    // Switching the hold off would have let it be paid alone.
    const off = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }, { key: "approval.anomaly_multiple", to: "off" }], { since: "2026-11-01", now: NOW });
    expect(off.payments.find((p) => p.proposal_id === odd)!.change).toBe("paid_alone");
  });

  it("records how each payment was actually decided beside the replay", () => {
    const { db, small } = world();
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version) SELECT proposal_id, 'APPROVED', terms_sha256, 'Purser''s code', 'policy', substr(terms_sha256, 1, 8), 'within', ?, 1 FROM proposals WHERE proposal_id = ?").run(NOW.toISOString(), small);
    const r = simulatePolicyChange(db, [], { since: "2026-11-01", now: NOW });
    expect(r.payments.map((p) => p.recorded)).toEqual(["alone", "cfo", "cfo"]);
  });

  it("writes nothing and calls nothing: the ledger is byte-identical after a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "purser-sim-"));
    try {
      const path = join(dir, "ledger.sqlite");
      const db = openDb(path);
      signed(db, "ap.alone_eur", "500.00");
      pay(db, "300.00", "Alpenwolle AG");
      pay(db, "800.00", "Bergtex Textil GmbH");
      db.pragma("wal_checkpoint(TRUNCATE)");
      const bytes = () => createHash("sha256").update(readFileSync(path)).digest("hex");
      const before = { file: bytes(), changes: (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n };
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const first = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }, { key: "counterparty:Alpenwolle AG", to: "blocked" }], { since: "2026-11-01", now: NOW });
      const second = simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }, { key: "counterparty:Alpenwolle AG", to: "blocked" }], { since: "2026-11-01", now: NOW });
      expect(second).toEqual(first); // deterministic
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n).toBe(before.changes);
      db.pragma("wal_checkpoint(TRUNCATE)");
      expect(bytes()).toBe(before.file);
      db.close();
    } finally {
      rmTemp(dir);
    }
  });

  it("gives the line a policy change's display shows, from its signed terms, or null when it cannot be read", () => {
    const { db } = world();
    const terms = JSON.stringify({ kind: "policy_change", changes: [{ key: "ap.alone_eur", label: "x", from: "500.00", to: "1000.00" }] });
    expect(simulationLine(db, terms, NOW)).toBe("If this had been in force since 2026-10-21: 1 payment would have been paid alone instead of by the CFO; 2 unchanged (3 replayed).");
    expect(simulationLine(db, "{", NOW)).toBeNull();
    expect(simulationLine(db, JSON.stringify({ kind: "policy_change" }), NOW)).toBeNull();
  });
});

describe("beside a waiting policy change", () => {
  it("the dashboard and the phone's state carry the line; the signed terms and their hash do not", () => {
    const { db } = world();
    const p = proposePolicyChange(db, { changes: [{ key: "ap.alone_eur", to: "1000.00" }], reason: "raise the limit" }, "human", NOW);
    expect(p.terms_json).not.toMatch(/simulation|in force since/);
    const line = "If this had been in force since 2026-10-21: 1 payment would have been paid alone instead of by the CFO; 2 unchanged (3 replayed).";
    expect(buildSnapshot(db, NOW).pending.find((x) => x.proposal_id === p.proposal_id)?.simulation).toBe(line);
    const relayed = buildRelayState(db, { rpId: "relay.test", relayToken: "test-relay-token" }, NOW).approvals.proposals.find((x) => x.proposal_id === p.proposal_id)!;
    expect(relayed.simulation).toBe(line);
    // The phone hashes the canonical terms itself: the line is beside them, never in them.
    expect(relayed.canonical).not.toContain("in force since");
    expect(createHash("sha256").update(relayed.canonical).digest("hex")).toBe(p.terms_sha256);
    // A payment has no such line.
    expect(buildSnapshot(db, NOW).pending.filter((x) => x.kind !== "policy_change").every((x) => !("simulation" in x))).toBe(true);
  });

  it("the runner's dashboard and the phone's page show it, labelled as not signed", () => {
    const page = readFileSync(new URL("../src/dashboard/page.html", import.meta.url), "utf8");
    expect(page).toMatch(/p\.simulation \? txt\("p", "review", p\.simulation \+ " A read-only replay of past payments; not part of what you sign\."\)/);
    const client = readFileSync(new URL("../src/approve/client.ts", import.meta.url), "utf8");
    expect(client).toContain("Purser's replay of past payments, not part of what you sign");
    expect(client.match(/simulationBox\(o\),/g)).toHaveLength(2);
  });
});

describe("npm run policy -- simulate", () => {
  it("reads <key>=<value> pairs and --since; none removes a limit", () => {
    expect(parseSimulationArgs(["ap.alone_eur=1000.00", "counterparty:Bergtex Textil GmbH=blocked", "--since", "2026-11-01"]))
      .toEqual({ changes: [{ key: "ap.alone_eur", to: "1000.00" }, { key: "counterparty:Bergtex Textil GmbH", to: "blocked" }], since: "2026-11-01" });
    expect(parseSimulationArgs(["approval.four_eyes_eur=none"])).toEqual({ changes: [{ key: "approval.four_eyes_eur", to: "" }] });
    expect(() => parseSimulationArgs(["ap.alone_eur"])).toThrow(/<key>=<value>/);
    expect(() => parseSimulationArgs(["--since"])).toThrow(/a day/);
  });

  it("reports the summary and each payment that would change, and says nothing was written", () => {
    const { db, mid } = world();
    const lines = simulationReport(simulatePolicyChange(db, [{ key: "ap.alone_eur", to: "1000.00" }], { since: "2026-11-01", now: NOW }));
    expect(lines[0]).toBe("change   ap.alone_eur: 500.00 -> 1000.00");
    expect(lines[1]).toMatch(/^If this had been in force since 2026-11-01: 1 payment would have been paid alone/);
    expect(lines[2]).toMatch(new RegExp(`^${mid} +2026-11-15 EUR 800\\.00 +Bergtex Textil GmbH +the CFO -> paid alone: within the EUR 1000\\.00`));
    expect(lines.at(-1)).toMatch(/Nothing was written/);
  });
});

// The authority map (governance, 26 Nov): per agent, what it may pay, up to how much, from which account, to whom, when,
// under which grant and what needs the CFO, read from the live policy. Breaks if a value in the map stops following the
// policy (a card limit, the limit to pay alone, a refund threshold, the anomaly hold, a task mandate and what is left of
// it, a stop or a revoked identity), if the Agents page stops carrying it, or if reading it writes to the ledger.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentProfiles } from "../src/agents/profiles.js";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { approveWithinLimit, createProposal, nextProposalId } from "../src/policy/approvals.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { authorityMap, authorityMapText } from "../src/policy/authorityMap.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { policyValue } from "../src/policy/rules.js";
import { grantChange } from "../src/policy/taskMandates.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
let tickets = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });
const set = (db: DB, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, NOW.toISOString());
const rows = (db: DB, agent: string) => authorityMap(db, NOW).agents.find((a) => a.agent === agent)!;
const row = (db: DB, agent: string, what: RegExp) => rows(db, agent).rows.find((r) => what.test(r.what))!;

describe("the authority map", () => {
  it("has every agent, each row read from the policy as it stands", () => {
    const db = openDb(":memory:");
    const m = authorityMap(db, NOW);
    expect(m.agents.map((a) => [a.agent, a.status])).toEqual([["sourcing", "working"], ["support", "working"], ["treasury", "working"]]);
    expect(m.policy_sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const a of m.agents) {
      const card = a.rows.find((r) => /company card/.test(r.what))!;
      expect(card.per_payment).toBe(`EUR ${policyValue(db, `card.${a.agent}.per_tx`)}`);
      expect(card.in_all).toBe(`EUR ${policyValue(db, `card.${a.agent}.monthly`)} a month`);
    }
    expect(row(db, "support", /Refunds/)).toMatchObject({ per_payment: `${policyValue(db, "approval.refund_each")} test USD`, under: expect.stringContaining("approval.refund_each") });
    // No limit to pay alone in force: the CFO signs every invoice, and the map says so.
    expect(row(db, "treasury", /Supplier invoices/)).toMatchObject({ per_payment: expect.stringMatching(/^none: no limit to pay alone is in force/), from: "the company's own Airwallex account" });
    expect(row(db, "treasury", /Supplier invoices/).needs_cfo).toContain("more than 3x the payee's median of its last 5 paid invoices");
    // Reading it writes nothing.
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM principals").get()).toEqual({ n: 0 });
  });

  it("follows each change: a card limit, the limit to pay alone, the anomaly hold, a stop, a revoked identity", () => {
    const db = openDb(":memory:");
    set(db, "card.treasury.per_tx", "123.00");
    setSystemDefaultAloneLimit(db, "750.00", NOW);
    set(db, "approval.anomaly_multiple", "off");
    set(db, "approval.anomaly_first_eur", "250.00");
    set(db, "approval.four_eyes_eur", "10000.00");
    expect(row(db, "treasury", /company card/).per_payment).toBe("EUR 123.00");
    const inv = row(db, "treasury", /Supplier invoices/);
    expect(inv.per_payment).toMatch(/^EUR 750\.00 \(system default/);
    expect(inv.needs_cfo).not.toContain("median");
    expect(inv.needs_cfo).toContain("a first payment to a payee above EUR 250.00");
    expect(inv.needs_cfo).toContain("above EUR 10000.00: two people");
    set(db, "freeze", "on");
    expect(rows(db, "sourcing")).toMatchObject({ status: "frozen", rows: expect.arrayContaining([expect.objectContaining({ when: "not now: the emergency stop is on" })]) });
    set(db, "freeze", "off");
    revokePrincipal(db, "support", "incident", "max", NOW);
    expect(rows(db, "support")).toMatchObject({ status: "revoked", rows: expect.arrayContaining([expect.objectContaining({ when: "not now: its identity was revoked" })]) });
    expect(rows(db, "sourcing").status).toBe("working");
  });

  it("shows each task mandate: its payees, window, total and what is left, and who granted it", async () => {
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, "2000.00", NOW);
    const phone = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
    await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW);
    confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
    const m = { agent: "treasury", purpose: "November supplier invoices", kinds: ["invoice_payment" as const], invoice_month: "2026-11", currency: "EUR", total: "5000.00", payees: ["Alpenwolle AG", "Bergtex Textil GmbH"], from: "2026-11-01", until: "2026-11-30", status: "active" as const };
    const change = proposePolicyChange(db, { changes: [grantChange("nov-suppliers", m)], reason: "task" }, "human", NOW);
    await processAssertion(db, item("assertion", { proposal_id: change.proposal_id, terms_sha256: change.terms_sha256, credential: phone.sign({ challenge: challengeFor(change.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 }) }, change.proposal_id), NOW);
    executePolicyChange(db, change.proposal_id, NOW);
    const id = nextProposalId(db);
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-12-01T00:00:00Z", amount: "1200.00", currency: "EUR", vendor: "Alpenwolle AG", beneficiary_name: "Alpenwolle AG" } as Terms, createdBy: "treasury" }, NOW);
    expect(approveWithinLimit(db, { proposalId: id, limit: { currency: "EUR", amount: "2000.00" }, rule: "test", agent: "payer", invoice: { issueDate: "2026-11-03" } }, NOW)).toEqual({ ok: true });
    expect(row(db, "treasury", /Supplier invoices/)).toMatchObject({ to: "only a task mandate's payees", under: "ap.alone_eur and a task mandate" });
    expect(row(db, "treasury", /^Task: November/)).toEqual({
      what: "Task: November supplier invoices (invoice payment; invoices of 2026-11)", rail: "Airwallex payout (LOCAL or SWIFT)", per_payment: "EUR 2000.00",
      in_all: "EUR 5000.00 in all (EUR 1200.00 spent, EUR 3800.00 left)", from: "the company's own Airwallex account", to: "Alpenwolle AG and Bergtex Textil GmbH",
      when: "2026-11-01 to 2026-11-30 (active)", under: `task_mandate.nov-suppliers, granted by ${change.proposal_id} (passkey)`, needs_cfo: expect.stringMatching(/^anything outside it: another payee, purpose or month, past 2026-11-30, over its total; /),
    });
    // A mandate written by hand shows as not in force.
    set(db, "task_mandate.forged", JSON.stringify({ ...m, total: "1.00" }));
    expect(row(db, "treasury", /Task mandate forged/)).toMatchObject({ per_payment: "nothing", under: expect.stringMatching(/not in force/) });
    // The text and the JSON export say the same.
    const map = authorityMap(db, NOW);
    expect(JSON.parse(JSON.stringify(map))).toEqual(map);
    expect(authorityMapText(map)).toContain("EUR 5000.00 in all (EUR 1200.00 spent, EUR 3800.00 left)");
  });

  it("is on the Agents page: each profile carries its rows, and the page draws them as a table", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "mandate.bound", "sourcing", { cap: "0.03", budget: "4.00", payee: "0x0000000000000000000000000000000000000001" }, NOW);
    const ps = agentProfiles(db, NOW);
    for (const p of ps) expect(p.authority).toEqual(rows(db, p.id).rows);
    expect(ps.find((p) => p.id === "sourcing")!.authority[0]).toMatchObject({ per_payment: "0.03 test USD (the on-chain mandate's cap)", in_all: "4.00 test USD on chain (0.00 spent, 4.00 left)" });
    const page = readFileSync(new URL("../src/dashboard/page.html", import.meta.url), "utf8");
    expect(page).toContain('"Authority map"');
    expect(page).toMatch(/a\.authority \|\| \[\]/);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["authority-map"]).toBe("tsx src/cli/authorityMap.ts");
  });
});

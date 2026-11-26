// Task-scoped, expiring mandates (governance, 26 Nov: "grant authority explicitly; enforce in infrastructure, not
// prompts"). The CFO grants the treasury agent authority for one task ("pay November's supplier invoices, at most EUR
// 5,000.00 in all, to these payees, until 30 November") with a policy change signed with the passkey; narrowing and
// revoking take effect at once. Outside its mandate (expired, over its total, another payee, another purpose) code
// refuses to approve the payment alone, records why, and the payment waits for the CFO. A short-lived task token binds
// one agent to one mandate. Breaks if any of these refusals lets a payment through alone, if a mandate the CFO did not
// sign counts, if widening skips the passkey, or if the execution guard accepts an approval outside a mandate.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { approveWithinLimit, beginExecution, createProposal, decide, nextProposalId } from "../src/policy/approvals.js";
import { aloneGate, failClosed } from "../src/policy/aloneGate.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { loosens, validateChange } from "../src/policy/rules.js";
import { canonicalMandate, widens, type TaskMandate } from "../src/policy/taskMandateCore.js";
import { grantChange, listTaskMandates, mandateInForce, mandateSpentCents, narrowTaskMandate, revokeTaskMandate, underMandates } from "../src/policy/taskMandates.js";
import { issueTaskToken, taskTokenRows } from "../src/policy/taskTokens.js";
import { policyValues } from "../src/policy/versions.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
const LIMIT = { currency: "EUR", amount: "2000.00" };
let tickets = 0;
let counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

const NOVEMBER: TaskMandate = {
  agent: "treasury", purpose: "November supplier invoices", kinds: ["invoice_payment", "supplier_payment"], invoice_month: "2026-11",
  currency: "EUR", total: "5000.00", payees: ["Alpenwolle AG", "Bergtex Textil GmbH"], from: "2026-11-01", until: "2026-11-30", status: "active",
};

async function world(): Promise<{ db: DB; phone: FakeAuthenticator }> {
  const db = openDb(":memory:");
  setSystemDefaultAloneLimit(db, LIMIT.amount, NOW);
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
  expect((await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW)).status).toBe("pending");
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return { db, phone };
}

/** Grants (or widens) a mandate the way the CFO does: a policy change signed with the passkey, then run. */
async function grant(db: DB, phone: FakeAuthenticator, id: string, m: TaskMandate): Promise<string> {
  const change = proposePolicyChange(db, { changes: [grantChange(id, m)], reason: `task mandate ${id}` }, "human", NOW);
  const signed = item("assertion", { proposal_id: change.proposal_id, terms_sha256: change.terms_sha256, credential: phone.sign({ challenge: challengeFor(change.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++counter }) }, change.proposal_id);
  expect((await processAssertion(db, signed, NOW)).status).toBe("approved");
  executePolicyChange(db, change.proposal_id, NOW);
  return change.proposal_id;
}

function invoice(db: DB, amount: string, payee = "Bergtex Textil GmbH", kind: "invoice_payment" | "supplier_payment" = "invoice_payment"): string {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind, proposal_id: id, expires_at: "2026-12-20T11:00:00Z", amount, currency: "EUR", vendor: payee, beneficiary_name: payee } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return id;
}

const alone = (db: DB, id: string, o: { at?: Date; issueDate?: string | null; agent?: string; taskToken?: string } = {}) =>
  approveWithinLimit(db, { proposalId: id, limit: LIMIT, rule: "within the limit", agent: o.agent ?? "payer", invoice: { issueDate: o.issueDate === undefined ? "2026-11-12" : o.issueDate }, ...(o.taskToken ? { taskToken: o.taskToken } : {}) }, o.at ?? NOW);
const refusals = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'task_mandate.refused' ORDER BY seq").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as { code: string; mandate: string | null; proposal_id: string });
const message = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as Error).message; } };

describe("task mandates: the policy side", () => {
  it("a grant or widening needs Face ID (any change through a policy change loosens); narrowing does not widen", () => {
    const v = canonicalMandate(NOVEMBER);
    const key = "task_mandate.nov-suppliers";
    expect(loosens({ key, from: "", to: v })).toBe(true);
    expect(loosens({ key, from: v, to: canonicalMandate({ ...NOVEMBER, total: "1000.00" }) })).toBe(true);
    // What the immediate narrowing accepts (src/policy/taskMandates.ts narrowTaskMandate): only what does not widen.
    const w = (to: Partial<TaskMandate>) => widens(NOVEMBER, { ...NOVEMBER, ...to });
    expect(w({ total: "6000.00" })).toBe(true);
    expect(w({ payees: [...NOVEMBER.payees, "Someone Else Ltd"] })).toBe(true);
    expect(w({ until: "2026-12-31" })).toBe(true);
    expect(w({ from: "2026-10-01" })).toBe(true);
    expect(w({ invoice_month: null })).toBe(true);
    expect(w({ purpose: "Anything" })).toBe(true);
    expect(widens({ ...NOVEMBER, status: "revoked" }, NOVEMBER)).toBe(true);
    expect(w({ total: "1000.00", payees: ["Alpenwolle AG"], until: "2026-11-25", kinds: ["invoice_payment"] })).toBe(false);
    expect(w({ status: "revoked" })).toBe(false);
  });

  it("a change must be one well-formed mandate in its one written form; it is never removed", () => {
    const db = openDb(":memory:");
    const key = "task_mandate.nov-suppliers";
    expect(validateChange(db, { key, from: "", to: canonicalMandate(NOVEMBER) })).toBeNull();
    expect(validateChange(db, { key, from: "", to: JSON.stringify({ ...NOVEMBER, total: "5000.00" }, null, 1) })).toMatch(/one form/);
    expect(validateChange(db, { key, from: "", to: canonicalMandate({ ...NOVEMBER, agent: "sourcing" }) })).toMatch(/agent must be treasury/);
    expect(validateChange(db, { key, from: "", to: canonicalMandate({ ...NOVEMBER, until: "2026-10-01" }) })).toMatch(/before from/);
    expect(validateChange(db, { key, from: "", to: canonicalMandate({ ...NOVEMBER, total: "0.00" }) })).toMatch(/total/);
    expect(validateChange(db, { key, from: "", to: canonicalMandate({ ...NOVEMBER, payees: [] }) })).toMatch(/payees/);
    expect(validateChange(db, { key: "task_mandate.Bad Id", from: "", to: canonicalMandate(NOVEMBER) })).toMatch(/unknown policy setting/);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, canonicalMandate(NOVEMBER), NOW.toISOString());
    expect(validateChange(db, { key, from: canonicalMandate(NOVEMBER), to: "" })).toMatch(/revoke it instead/);
  });

  it("is part of the policy version once written", async () => {
    const { db, phone } = await world();
    expect(Object.keys(policyValues(db)).some((k) => k.startsWith("task_mandate."))).toBe(false);
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    expect(policyValues(db)["task_mandate.nov-suppliers"]).toBe(canonicalMandate(NOVEMBER));
  });
});

describe("task mandates: enforced where code approves a payment alone", () => {
  it("an agent never granted one pays alone within the limit as before", async () => {
    const { db } = await world();
    expect(underMandates(db, "payer")).toBe(false);
    expect(alone(db, invoice(db, "300.00", "Anyone GmbH"))).toEqual({ ok: true });
  });

  it("inside the mandate: approved alone, and the record names the mandate; the total is counted", async () => {
    const { db, phone } = await world();
    const grantedBy = await grant(db, phone, "nov-suppliers", NOVEMBER);
    expect(mandateInForce(db, "nov-suppliers")).toMatchObject({ granted_by: grantedBy, mandate: NOVEMBER });
    const p = invoice(db, "1800.00");
    expect(alone(db, p)).toEqual({ ok: true });
    const rec = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.within_limit' AND subject = ?").get(p) as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(rec).toMatchObject({ mandate: "nov-suppliers", amount: "1800.00" });
    expect(mandateSpentCents(db, "nov-suppliers")).toBe(180_000);
    expect(beginExecution<Terms & { amount: string }>(db, p, () => {}, NOW).amount).toBe("1800.00");
    // Payee names compare without case or extra spaces.
    expect(alone(db, invoice(db, "100.00", "  alpenwolle   ag "))).toEqual({ ok: true });
  });

  it("over its total, counting what was already approved under it: refused, recorded, left for the CFO", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    for (const a of ["2000.00", "2000.00"]) expect(alone(db, invoice(db, a))).toEqual({ ok: true });
    const over = invoice(db, "1000.01");
    const out = alone(db, over);
    expect(out).toMatchObject({ ok: false, code: "mandate", reason: expect.stringMatching(/mandate_total: .*over its total of EUR 5000\.00 \(EUR 1000\.00 left\)/) });
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(over) as { status: string }).status).toBe("PENDING_APPROVAL");
    expect(refusals(db).at(-1)).toMatchObject({ code: "mandate_total", mandate: "nov-suppliers", proposal_id: over });
    expect(alone(db, invoice(db, "1000.00"))).toEqual({ ok: true }); // exactly what is left
    expect(alone(db, invoice(db, "5.00"))).toMatchObject({ ok: false, code: "mandate" }); // nothing left
    // A payment approved under it that expired unpaid no longer counts toward the total.
    const first = (db.prepare("SELECT subject FROM audit_log WHERE event = 'proposal.within_limit' ORDER BY seq LIMIT 1").get() as { subject: string }).subject;
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(first);
    expect(mandateSpentCents(db, "nov-suppliers")).toBe(300_000);
    expect(alone(db, invoice(db, "2000.00"))).toEqual({ ok: true });
  });

  it("after it ends, before it starts: refused as expired or not started", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    expect(alone(db, invoice(db, "100.00"), { at: new Date("2026-11-30T23:59:00Z") })).toEqual({ ok: true });
    expect(alone(db, invoice(db, "100.00"), { at: new Date("2026-12-01T00:00:01Z") })).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_expired: .*expired at the end of 2026-11-30/) });
    expect(alone(db, invoice(db, "100.00"), { at: new Date("2026-10-31T12:00:00Z") })).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_not_started/) });
    expect(refusals(db).map((r) => r.code)).toEqual(["mandate_expired", "mandate_not_started"]);
  });

  it("another payee, another purpose (kind or month), an unknown invoice date: refused with the reason", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", { ...NOVEMBER, kinds: ["invoice_payment"] });
    expect(alone(db, invoice(db, "100.00", "Bergtex Textil GmbH."))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_payee: "Bergtex Textil GmbH\." is not a payee/) });
    expect(alone(db, invoice(db, "100.00", "Bergtex Textil GmbH", "supplier_payment"))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_purpose: a supplier payment is not what/) });
    expect(alone(db, invoice(db, "100.00"), { issueDate: "2026-10-28" })).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_purpose: the invoice is dated 2026-10-28; .* covers invoices of 2026-11 only/) });
    expect(alone(db, invoice(db, "100.00"), { issueDate: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_purpose: .*date is not known/) });
    expect(refusals(db).map((r) => r.code)).toEqual(["mandate_payee", "mandate_purpose", "mandate_purpose", "mandate_purpose"]);
  });

  it("a mandate the CFO did not sign counts for nothing, and still puts the agent under mandates", async () => {
    const { db } = await world();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run("task_mandate.forged", canonicalMandate({ ...NOVEMBER, total: "999999.00" }), NOW.toISOString());
    expect(mandateInForce(db, "forged")).toBeNull();
    expect(underMandates(db, "payer")).toBe(true);
    expect(alone(db, invoice(db, "100.00"))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_unsigned: task mandate forged is not in force/) });
    expect(listTaskMandates(db)).toEqual([expect.objectContaining({ id: "forged", in_force: false })]);
  });

  it("a grant approved without the passkey (typed hash) is not in force", async () => {
    // No passkey enrolled yet, so a typed hash prefix may still approve: such a grant does not count.
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, LIMIT.amount, NOW);
    const change = proposePolicyChange(db, { changes: [grantChange("nov-suppliers", NOVEMBER)], reason: "typed" }, "human", NOW);
    decide(db, { proposalId: change.proposal_id, decision: "APPROVED", typedPrefix: change.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, NOW);
    executePolicyChange(db, change.proposal_id, NOW);
    expect(mandateInForce(db, "nov-suppliers")).toBeNull();
    expect(alone(db, invoice(db, "100.00"))).toMatchObject({ ok: false, code: "mandate" });
  });

  it("narrowing takes effect at once without Face ID; widening there is refused; a hand edit voids it", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    narrowTaskMandate(db, "nov-suppliers", { ...NOVEMBER, total: "500.00", payees: ["Alpenwolle AG"] }, "max", NOW);
    expect(mandateInForce(db, "nov-suppliers")?.mandate.total).toBe("500.00");
    expect(alone(db, invoice(db, "100.00"))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_payee/) });
    expect(alone(db, invoice(db, "600.00", "Alpenwolle AG"))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_total/) });
    expect(alone(db, invoice(db, "500.00", "Alpenwolle AG"))).toEqual({ ok: true });
    expect(message(() => narrowTaskMandate(db, "nov-suppliers", { ...NOVEMBER, total: "800.00", payees: ["Alpenwolle AG"] }, "max", NOW))).toMatch(/widens .*passkey/);
    // Written by hand to a wider value: the record no longer follows, so the mandate is not in force.
    db.prepare("UPDATE settings SET value = ? WHERE key = 'task_mandate.nov-suppliers'").run(canonicalMandate(NOVEMBER));
    expect(mandateInForce(db, "nov-suppliers")).toBeNull();
  });

  it("revoking takes effect at once; only a new signed grant brings it back", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    revokeTaskMandate(db, "nov-suppliers", "task done", "max", NOW);
    expect(alone(db, invoice(db, "100.00"))).toMatchObject({ ok: false, reason: expect.stringMatching(/mandate_revoked: .*was revoked/) });
    expect(db.prepare("SELECT 1 FROM audit_log WHERE event = 'task_mandate.revoked'").get()).toBeTruthy();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    expect(alone(db, invoice(db, "100.00"))).toEqual({ ok: true });
  });

  it("the execution guard refuses an approval alone that names no mandate while the agent was under one", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    const p = invoice(db, "100.00");
    const row = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(p) as { terms_sha256: string };
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'Purser''s code', 'policy', ?, ?)").run(p, row.terms_sha256, row.terms_sha256.slice(0, 8), NOW.toISOString());
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(p);
    audit(db, "system", "proposal.within_limit", p, { terms_sha256: row.terms_sha256, agent: "payer", amount: "100.00", limit: "EUR 2000.00" }, NOW);
    expect(message(() => beginExecution(db, p, () => {}, NOW))).toMatch(/under task mandates then, and the approval names none/);
  });
});

describe("where the full gate is not carried (the cloud engine's bundle), the stand-in fails closed", () => {
  it("pays nothing alone once a task mandate is on record or a token is offered, runs no approval naming one, grants none", async () => {
    const { db, phone } = await world();
    const p = { proposal_id: "P-x", kind: "invoice_payment" };
    const a = { agent: "payer", issueDate: "2026-11-12" };
    expect(aloneGate()).not.toBe(failClosed); // the runner: src/db/open.ts loaded the full gate
    expect(failClosed.check(db, p, {}, a, NOW)).toEqual({ ok: true, mandate: null, token: null });
    expect(failClosed.check(db, p, {}, { ...a, taskToken: "ptask_x" }, NOW)).toMatchObject({ ok: false, code: "mandate" });
    expect(failClosed.executionRefusal(db, "payer", undefined, 1e9)).toBeNull();
    expect(failClosed.executionRefusal(db, "payer", "nov-suppliers", 1e9)).toMatch(/runner only/);
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    expect(failClosed.check(db, p, {}, a, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/^mandate_gate_absent/) });
    expect(failClosed.executionRefusal(db, "payer", undefined, 1e9)).toMatch(/runner only/);
    expect(failClosed.validate(canonicalMandate(NOVEMBER))).toMatch(/runner only/);
    expect(failClosed.values(db)).toEqual([]);
  });
});

describe("task tokens: the agent and the task come from the token", () => {
  it("a token binds the payment to its agent and its one mandate", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    await grant(db, phone, "dec-rent", { ...NOVEMBER, purpose: "December rent", payees: ["Landlord AG"], invoice_month: null, until: "2026-12-31" });
    const t = issueTaskToken(db, "nov-suppliers", NOW, 4);
    expect(t).toMatchObject({ agent: "treasury", mandate_id: "nov-suppliers", expires_at: "2026-11-20T14:00:00.000Z" });
    expect(taskTokenRows(db)[0]!.token_sha256).not.toContain(t.token.slice(6, 20)); // only the hash is kept
    const ok = invoice(db, "100.00");
    expect(alone(db, ok, { taskToken: t.token })).toEqual({ ok: true });
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.within_limit' AND subject = ?").get(ok) as { payload_json: string }).payload_json)).toMatchObject({ mandate: "nov-suppliers", task_token: t.token_id });
    // Landlord AG is in the other mandate, not this token's: refused, though dec-rent would cover it.
    expect(alone(db, invoice(db, "100.00", "Landlord AG"), { taskToken: t.token })).toMatchObject({ ok: false, code: "mandate", reason: expect.stringMatching(/mandate_payee/) });
    expect(alone(db, invoice(db, "100.00", "Landlord AG"), { issueDate: "2026-12-01" })).toEqual({ ok: true });
    // A payment naming another agent with this token: refused, recorded.
    expect(alone(db, invoice(db, "100.00"), { taskToken: t.token, agent: "support" })).toMatchObject({ ok: false, code: "token", reason: expect.stringMatching(/token_agent: the token is the treasury agent's; the payment names the support agent/) });
    expect(alone(db, invoice(db, "100.00"), { taskToken: "ptask_forged" })).toMatchObject({ ok: false, code: "token", reason: expect.stringMatching(/token_unknown/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'task_token.refused'").get()).toEqual({ n: 2 });
  });

  it("expires; dies with its mandate and with its agent's identity", async () => {
    const { db, phone } = await world();
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    const t = issueTaskToken(db, "nov-suppliers", NOW, 1);
    expect(alone(db, invoice(db, "100.00"), { taskToken: t.token, at: new Date("2026-11-20T11:00:01Z") })).toMatchObject({ ok: false, reason: expect.stringMatching(/token_expired/) });
    const t2 = issueTaskToken(db, "nov-suppliers", NOW, 99);
    expect(t2.expires_at).toBe("2026-11-21T10:00:00.000Z"); // never more than 24 hours
    revokeTaskMandate(db, "nov-suppliers", "done", "max", NOW);
    expect(alone(db, invoice(db, "100.00"), { taskToken: t2.token })).toMatchObject({ ok: false, reason: expect.stringMatching(/token_revoked/) });
    expect(message(() => issueTaskToken(db, "nov-suppliers", NOW))).toMatch(/revoked: no token/);
    await grant(db, phone, "nov-suppliers", NOVEMBER);
    const t3 = issueTaskToken(db, "nov-suppliers", NOW);
    revokePrincipal(db, "treasury", "incident", "max", NOW);
    expect(alone(db, invoice(db, "100.00"), { taskToken: t3.token })).toMatchObject({ ok: false, reason: expect.stringMatching(/token_principal/) });
  });
});

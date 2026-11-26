// Multi-entity governance (src/policy/entities.ts; Dan Kim, Airwallex, "Agentic banking starts with governance"): a
// company with two legal entities, Northwind Outdoor BV (NL, EUR) and Northwind Outdoor Ltd (GB, GBP), each with its
// own Airwallex account and balances (one stand-in per account, as the connected account x-on-behalf-of names). Every
// payment names its paying entity and funding account in the terms the CFO signs; an agent pays only from an entity the
// CFO's signed policy opens to it, and only from that entity's own account; a company without entities is unchanged.
// Test money only: every rail here is the in-memory stand-in (src/redteam/airwallex.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { lineShapeRefusal } from "../src/executors/airwallexBatch.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { applyPolicyChanges, executePolicyChange, proposePolicyChange, type PolicyChangeTerms } from "../src/executors/policyChange.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { termsHash, type Terms } from "../src/lib/terms.js";
import { proposeSupplierPayment } from "../src/payouts/plan.js";
import { decide } from "../src/policy/approvals.js";
import { entityRefusal, listEntities, mayPayFrom, payFromKey, planEntity, registerEntity, type LegalEntity } from "../src/policy/entities.js";
import { loosens } from "../src/policy/loosens.js";
import { currentPolicy, policyValue } from "../src/policy/rules.js";
import { chaos } from "../src/policy/saga.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const bill = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");
const BV: LegalEntity = { id: "nl-bv", name: "Northwind Outdoor BV", country: "NL", currency: "EUR", funding_account: "acct_nwbv_0001" };
const LTD: LegalEntity = { id: "uk-ltd", name: "Northwind Outdoor Ltd", country: "GB", currency: "GBP", funding_account: "acct_nwltd_0001" };

/** The CFO's change as the ledger records one approved with the passkey: proposed and checked as any policy change,
 *  approved (method passkey; the WebAuthn signature itself is src/passkey's to verify) and applied. */
function cfoSigns(db: DB, key: string, to: string): void {
  const p = proposePolicyChange(db, { changes: [{ key, to }], reason: "which entity the treasury agent pays from" }, "human");
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'cfo', 'passkey', ?, ?)")
    .run(p.proposal_id, p.terms_sha256, p.terms_sha256.slice(0, 8), new Date().toISOString());
  db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p.proposal_id);
  applyPolicyChanges(db, p.proposal_id, JSON.parse(p.terms_json) as PolicyChangeTerms);
}

const approve = (db: DB, id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" });
};
const escalations = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'invoice.escalated'").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as { reason: string; code?: string });
const proposals = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind IN ('invoice_payment', 'supplier_payment')").get() as { n: number }).n;

/** Two entities, each a stand-in acting for its own account. BV carries the Kit 11 seed; Ltd has its own euros. */
async function twoEntities() {
  const db = openDb(":memory:");
  const bv = new FakeAirwallex();
  bv.payingAccount = BV.funding_account;
  await seedTreasury(db, bv, bv);
  const ltd = new FakeAirwallex();
  ltd.payingAccount = LTD.funding_account;
  ltd.bal.EUR.availableCents = 10_000_000;
  ltd.beneficiaries = bv.beneficiaries; // the same payees, on file at both accounts
  registerEntity(db, "system", BV);
  registerEntity(db, "system", LTD);
  return { db, bv, ltd };
}

describe("a company with several legal entities", () => {
  it("holds each entity with its own funding account, and adding one opens it to no agent", async () => {
    const { db } = await twoEntities();
    expect(listEntities(db).map((e) => [e.id, e.funding_account])).toEqual([["nl-bv", BV.funding_account], ["uk-ltd", LTD.funding_account]]);
    expect(mayPayFrom(db, "treasury", "nl-bv")).toBe(false);
    expect(policyValue(db, payFromKey("uk-ltd", "treasury"))).toBe("blocked");
    // The CFO policy shows one rule per entity and agent.
    expect(currentPolicy(db).filter((r) => r.key.startsWith("pay_from.")).map((r) => r.key)).toContain("pay_from.uk-ltd.treasury");
    // An entity is never changed in place, and no two entities share an account.
    expect(() => registerEntity(db, "system", { ...LTD, funding_account: "acct_other_0001" })).toThrow(/never changed in place/);
    expect(() => registerEntity(db, "system", { ...LTD, id: "uk-ltd-2" })).toThrow(/already funds Northwind Outdoor Ltd/);
    registerEntity(db, "system", LTD); // the same entity again: nothing changes
    expect(listEntities(db)).toHaveLength(2);
  });

  it("names the paying entity and its own funding account in the signed terms, and pays from that account only", async () => {
    const { db, bv, ltd } = await twoEntities();
    cfoSigns(db, payFromKey("uk-ltd", "treasury"), "allowed");
    const ltdBefore = ltd.bal.EUR.availableCents;
    const out = await proposeInvoicePayment(db, ltd, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "uk-ltd");
    if (out.kind !== "proposed") throw new Error(out.reason);
    const signed = JSON.parse(out.proposal.terms_json) as Record<string, unknown>;
    expect(signed.paying_entity).toEqual({ id: "uk-ltd", name: "Northwind Outdoor Ltd", country: "GB" });
    expect(signed.funding_account).toEqual({ id: LTD.funding_account, currency: "GBP" });
    expect(termsHash(signed as Terms)).toBe(out.proposal.terms_sha256);
    const bvCalls = bv.calls.length;
    approve(db, out.proposal.proposal_id);
    const r = await executeInvoicePayment(db, ltd, ltd, out.proposal.proposal_id);
    expect(r.transfer.status).toBe("PAID");
    expect(ltd.transfers).toHaveLength(1);
    expect(ltd.bal.EUR.availableCents).toBeLessThan(ltdBefore);
    // BV's account was never touched.
    expect(bv.transfers).toEqual([]);
    expect(bv.calls.length).toBe(bvCalls);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("refuses an entity the CFO policy does not open to the agent: a reason, an audit row, and no call to Airwallex", async () => {
    const { db, ltd } = await twoEntities();
    cfoSigns(db, payFromKey("nl-bv", "treasury"), "allowed"); // BV only
    const out = await proposeInvoicePayment(db, ltd, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "uk-ltd");
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_not_permitted: the CFO policy does not let the .* pay from Northwind Outdoor Ltd \(uk-ltd\)/) });
    expect(escalations(db)).toEqual([expect.objectContaining({ code: "entity_not_permitted", reason: expect.stringContaining("pay_from.uk-ltd.treasury") })]);
    expect(ltd.calls).toEqual([]);
    expect(proposals(db)).toBe(0);
  });

  it("counts only a value the CFO signed: a setting written by hand, or a change approved by typed prefix, opens nothing", async () => {
    const { db, ltd } = await twoEntities();
    setSetting(db, "treasury", payFromKey("uk-ltd", "treasury") as `pay_from.${string}`, "allowed");
    expect(mayPayFrom(db, "treasury", "uk-ltd")).toBe(false);
    const p = proposePolicyChange(db, { changes: [{ key: payFromKey("uk-ltd", "treasury"), to: "blocked" }], reason: "reset" }, "human");
    approve(db, p.proposal_id);
    executePolicyChange(db, p.proposal_id);
    const q = proposePolicyChange(db, { changes: [{ key: payFromKey("uk-ltd", "treasury"), to: "allowed" }], reason: "typed, not signed" }, "human");
    approve(db, q.proposal_id);
    executePolicyChange(db, q.proposal_id);
    expect(policyValue(db, payFromKey("uk-ltd", "treasury"))).toBe("allowed");
    expect(mayPayFrom(db, "treasury", "uk-ltd")).toBe(false);
    const out = await proposeInvoicePayment(db, ltd, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "uk-ltd");
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_not_permitted:/) });
    // Allowing an entity loosens the policy (Face ID, never from the phone's tighten-only path); blocking tightens.
    expect(loosens({ key: "pay_from.uk-ltd.treasury", from: "blocked", to: "allowed" })).toBe(true);
    expect(loosens({ key: "pay_from.uk-ltd.treasury", from: "allowed", to: "blocked" })).toBe(false);
  });

  it("refuses a payment funded from another entity's account", async () => {
    const { db, bv } = await twoEntities();
    cfoSigns(db, payFromKey("uk-ltd", "treasury"), "allowed");
    const bvCalls = bv.calls.length;
    // Ltd pays, but the rail acts for BV's account: BV's money would fund Ltd's invoice.
    const out = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "uk-ltd");
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^funding_account_mismatch: Northwind Outdoor Ltd \(uk-ltd\) pays only from its own account acct_nwltd_0001, but the rail acts for acct_nwbv_0001 \(Northwind Outdoor BV's\)/) });
    expect(escalations(db).at(-1)?.code).toBe("funding_account_mismatch");
    expect(bv.calls.length).toBe(bvCalls);
    expect(proposals(db)).toBe(0);
    // Terms that name another entity's account are refused the same way (the check the executors run).
    expect(entityRefusal(db, { paying_entity: { id: "uk-ltd" }, funding_account: { id: BV.funding_account } }, "treasury"))
      .toMatch(/^funding_account_mismatch: .* but the terms fund it from acct_nwbv_0001 \(Northwind Outdoor BV's\)/);
  });

  it("refuses a payment that names no entity, or one the company does not hold", async () => {
    const { db, bv } = await twoEntities();
    cfoSigns(db, payFromKey("nl-bv", "treasury"), "allowed");
    const none = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill);
    expect(none).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_missing: the company holds 2 legal entities \(nl-bv, uk-ltd\)/) });
    const unknown = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "de-gmbh");
    expect(unknown).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_unknown:/) });
    expect(proposals(db)).toBe(0);
    // Entities run on the company's own accounts, never combined with Purser as a platform's single bound account.
    expect(planEntity(db, "treasury", "nl-bv", BV.funding_account, { AIRWALLEX_PLATFORM: "on" })).toMatchObject({ ok: false, reason: expect.stringMatching(/^entity_with_platform:/) });
    expect(planEntity(db, "treasury", "nl-bv", BV.funding_account, {})).toMatchObject({ ok: true, fields: { paying_entity: { id: "nl-bv" } } });
  });

  it("the passkey's signature covers the entity and the account: one changed entity is a hash mismatch, like one changed cent", async () => {
    const { db, bv, ltd } = await twoEntities();
    cfoSigns(db, payFromKey("nl-bv", "treasury"), "allowed");
    cfoSigns(db, payFromKey("uk-ltd", "treasury"), "allowed");
    const out = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "nl-bv");
    if (out.kind !== "proposed") throw new Error(out.reason);
    const t = JSON.parse(out.proposal.terms_json) as Terms;
    const sha = out.proposal.terms_sha256;
    const otherEntity = { ...t, paying_entity: { id: "uk-ltd", name: LTD.name, country: "GB" }, funding_account: { id: LTD.funding_account, currency: "GBP" } };
    const otherAccount = { ...t, funding_account: { id: LTD.funding_account, currency: "EUR" } };
    const otherCent = { ...t, amount: "1850.01" };
    for (const changed of [otherEntity, otherAccount, otherCent]) expect(termsHash(changed as Terms)).not.toBe(sha);

    // The passkey signed BV's terms; the stored terms are rewritten to pay from Ltd (hash column too): the signature no
    // longer matches, so it approves nothing.
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(otherEntity), termsHash(otherEntity as Terms), out.proposal.proposal_id);
    expect(() => decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: sha, passkey: { credentialId: "cred-1", assertionSha256: "a".repeat(64) } }))
      .toThrow(/the passkey signed other terms/);

    // Approved as signed, then rewritten after the approval: the executor refuses before anything reaches Airwallex.
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(out.proposal.terms_json, sha, out.proposal.proposal_id);
    approve(db, out.proposal.proposal_id);
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(otherEntity), out.proposal.proposal_id);
    await expect(executeInvoicePayment(db, ltd, ltd, out.proposal.proposal_id)).rejects.toThrow(/do not match|stored terms/);
    expect(ltd.transfers).toEqual([]);
    expect(bv.transfers).toEqual([]);
  });

  it("checks the rail again when it pays: approved terms run only on a rail acting for the signed account", async () => {
    const { db, bv } = await twoEntities();
    cfoSigns(db, payFromKey("nl-bv", "treasury"), "allowed");
    const out = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "nl-bv");
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id);
    const wrong = new FakeAirwallex();
    wrong.payingAccount = LTD.funding_account;
    await expect(executeInvoicePayment(db, wrong, wrong, out.proposal.proposal_id)).rejects.toThrow(/signed for payment from acct_nwbv_0001, but this runner pays from acct_nwltd_0001; nothing is paid/);
    expect(wrong.transfers).toEqual([]);
    expect(bv.transfers).toEqual([]);
    // A line paying from an entity's own account is never put in an Airwallex batch transfer.
    expect(lineShapeRefusal({ proposal_id: out.proposal.proposal_id, kind: "invoice_payment", terms: { ...JSON.parse(out.proposal.terms_json), conversion: null } }))
      .toMatch(/pays from a legal entity's own account/);
  });

  it("the CFO blocks the entity after the approval: held before the payout is created, and audited", async () => {
    const { db, bv } = await twoEntities();
    cfoSigns(db, payFromKey("nl-bv", "treasury"), "allowed");
    const out = await proposeInvoicePayment(db, bv, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "nl-bv");
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id);
    chaos.at = (point) => { if (point === "transfer:after-insert") cfoSigns(db, payFromKey("nl-bv", "treasury"), "blocked"); };
    try {
      await expect(executeInvoicePayment(db, bv, bv, out.proposal.proposal_id)).rejects.toThrow(/^entity_not_permitted: .*nothing is paid$/);
    } finally {
      chaos.at = null;
    }
    expect(bv.transfers).toEqual([]);
    const held = (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.held_before_create'").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as { before: string; reason: string });
    expect(held).toEqual([expect.objectContaining({ before: "transfer", reason: expect.stringMatching(/^entity_not_permitted:/) })]);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { status: string }).status).toBe("FAILED");
  });

  it("a supplier payment in the entity's own currency names its entity too, and is refused from a non-permitted one", async () => {
    const { db, ltd } = await twoEntities();
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status, details_json) VALUES ('ben_fjell', 'Fjell Textiles Ltd', '0042', ?, 'FJELGB2L', 'GBP', 'SWIFT', 'ACTIVE', ?)")
      .run("f".repeat(64), JSON.stringify({ country: "GB", method: "SWIFT", clearing: null, account: "GB•• •••• 0042", account_key_sha256: "f".repeat(64) }));
    // The same payee at Ltd's own Airwallex account.
    ltd.payoutBeneficiaries.push({ id: "ben_fjell", name: "Fjell Textiles Ltd", address: { street: "1 Mill Lane", city: "Leeds", postcode: "LS1 1AA", countryCode: "GB" }, method: "SWIFT", bank: { country: "GB", currency: "GBP", accountName: "Fjell Textiles Ltd", iban: "GB33BUKB20201555550042" } } as never);
    ltd.bal.GBP = { availableCents: 1_000_000, pendingCents: 0, reservedCents: 0 };
    const inv = { invoice_no: "FT-301 · Fjell Textiles Ltd", vendor: "Fjell Textiles Ltd", amount: "1200.00", currency: "GBP", due_date: "2026-12-01", reference: "FT-301" };
    const refused = await proposeSupplierPayment(db, ltd, inv, "FT-301 GBP 1200.00", new Date(), undefined, undefined, "uk-ltd");
    expect(refused).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_not_permitted:/) });
    expect(ltd.calls).toEqual([]);

    cfoSigns(db, payFromKey("uk-ltd", "treasury"), "allowed");
    const out = await proposeSupplierPayment(db, ltd, inv, "FT-301 GBP 1200.00", new Date(), undefined, undefined, "uk-ltd");
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms).toMatchObject({ currency: "GBP", paying_entity: { id: "uk-ltd" }, funding_account: { id: LTD.funding_account, currency: "GBP" } });
    approve(db, out.proposal.proposal_id);
    const r = await executeSupplierPayment(db, ltd, ltd, out.proposal.proposal_id);
    expect(["PAID", "PROCESSING", "SENT"]).toContain(r.transfer.status);
    expect(ltd.bal.GBP.availableCents).toBeLessThan(1_000_000);
  });
});

describe("a company without entities (every company until now)", () => {
  it("plans and pays exactly as before: no entity in the terms, and naming one is refused", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(bill), bill);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const t = JSON.parse(out.proposal.terms_json) as Record<string, unknown>;
    expect(Object.keys(t)).not.toContain("paying_entity");
    expect(Object.keys(t)).not.toContain("funding_account");
    expect(entityRefusal(db, t, "treasury")).toBeNull();
    expect(currentPolicy(db).some((r) => r.key.startsWith("pay_from."))).toBe(false);
    approve(db, out.proposal.proposal_id);
    expect((await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).transfer.status).toBe("PAID");

    const db2 = openDb(":memory:");
    const awx2 = new FakeAirwallex();
    await seedTreasury(db2, awx2, awx2);
    const named = await proposeInvoicePayment(db2, awx2, parseInvoiceFallback(bill), bill, new Date(), "MIN_15", undefined, undefined, "nl-bv");
    expect(named).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^entity_unknown: the company holds no legal entities/) });
  });
});

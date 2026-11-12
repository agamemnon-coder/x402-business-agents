// The ICC rail's flow (src/icc/purchase.ts) against the TEST STAND-IN (test/support/iccStandIn.ts), which is built from
// the documented request and response shapes. It is not Visa's or Cybersource's service and these tests prove nothing
// about it: they prove what Purser does. No network. Keys, the credential marker and the number-like values are made
// at run time.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { journal } from "../src/accounting/gl.js";
import { readCallLog } from "../src/airwallex/callBudget.js";
import { openDb, type DB } from "../src/db/open.js";
import { IccClient } from "../src/icc/client.js";
import { ICC_PURCHASE_KIND } from "../src/icc/instruction.js";
import { ICC_HARD_CAP_CENTS, ICC_MERCHANTS } from "../src/icc/policy.js";
import { ICC_NOT_USED, executeIccPurchase, iccPurchases, requestIccPurchase, type IccDeps, type IccOutcome, type IccPurchaseRequest } from "../src/icc/purchase.js";
import { fromCents } from "../src/lib/money.js";
import { termsHash } from "../src/lib/terms.js";
import { decide, resuming } from "../src/policy/approvals.js";
import { makeIccTestKeys, type IccTestKeys } from "./support/iccKeys.js";
import { IccStandIn } from "./support/iccStandIn.js";
import { privateFindings } from "./support/privacyScan.js";

const T0 = new Date("2026-11-12T10:00:00Z");
/** A made-up instrument identifier of the documented length (32). Not a card number and not a real ID. */
const INSTRUMENT = "A1B2C3D4".repeat(4);
const SHOP = ICC_MERCHANTS[0]!;
/** Values that stand for the cardholder's device and assurance data: they must never be kept anywhere. */
const PRIVATE = { fingerprint: "fp-session-0d5a7c1e", identity: "identity-91b7f3", ip: "192.168.0.100", device: "device-id-4e2b" };

let keys: IccTestKeys;
beforeAll(() => { keys = makeIccTestKeys(); });
beforeEach(() => { vi.stubEnv("KIT11_ICC_RAIL", "on"); });
afterEach(() => { resuming.clear(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function req(over: Partial<IccPurchaseRequest> = {}): IccPurchaseRequest {
  return {
    agent: "sourcing", paymentMethodId: INSTRUMENT, merchantName: SHOP.name, merchantUrl: SHOP.url, merchantCountry: SHOP.country,
    amount: "12.00", currency: "EUR", items: [{ name: "Trail map pack", unitPrice: "6.00", quantity: "2" }], description: "Trail map packs for the spring range", ...over,
  };
}

const passthrough = () => ({
  deviceInformation: { fingerprintSessionId: PRIVATE.fingerprint, deviceData: { type: "Mobile", brand: "Test" }, ipAddress: PRIVATE.ip, clientDeviceId: PRIVATE.device },
  assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: PRIVATE.identity } }],
});

interface World { db: DB; standIn: IccStandIn; client: IccClient; deps: IccDeps; said: string[]; log: string; clock: { now: Date } }

function world(o: { budget?: number; db?: DB; log?: string } = {}): World {
  const db = o.db ?? openDb(":memory:");
  const log = o.log ?? join(mkdtempSync(join(tmpdir(), "icc-flow-test-")), "calls.jsonl");
  const standIn = new IccStandIn({ keys, merchantId: "purser_sandbox", jwtKeyId: "jwt-key-1", sharedKeyId: "shared-key-1", responseMleKeyId: "response-key-1" });
  const client = new IccClient({
    merchantId: "purser_sandbox", signer: { scheme: "jwt-p12", keyId: "jwt-key-1", privateKey: keys.signing.privateKey }, budget: o.budget ?? 3, callLog: log, fetchImpl: standIn.fetch,
    mle: { request: { publicKey: keys.request.publicKey, keyId: keys.request.keyId }, responseKeyId: "response-key-1", responsePrivateKey: keys.response.privateKey },
  });
  const said: string[] = [];
  const clock = { now: T0 };
  return { db, standIn, client, said, log, clock, deps: { client, passthrough, say: (line) => said.push(line) } };
}

const proposal = (db: DB, id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; status: string; expires_at: string };
const row = (db: DB, id: string) => db.prepare("SELECT * FROM icc_purchases WHERE action_id = ?").get(id) as Record<string, string | number | null>;
const events = (db: DB) => (db.prepare("SELECT event FROM audit_log WHERE event LIKE 'icc.%' ORDER BY seq").all() as { event: string }[]).map((r) => r.event);
const payload = (db: DB, event: string) => JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq DESC LIMIT 1").get(event) as { payload_json: string }).payload_json) as Record<string, unknown>;
const steps = (db: DB) => (db.prepare("SELECT step, status FROM money_steps ORDER BY n").all() as { step: string; status: string }[]).map((s) => `${s.step}:${s.status}`);
function approve(db: DB, id: string): void {
  const p = proposal(db, id);
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: p.terms_sha256, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T0);
}
/** Files the purchase and has the CFO sign its exact terms. */
async function approved(w: World, r: IccPurchaseRequest = req()): Promise<string> {
  const out = await requestIccPurchase(w.db, r, T0);
  if (out.status !== "pending_approval") throw new Error(`expected a proposal, got ${out.status}: ${JSON.stringify(out)}`);
  approve(w.db, out.proposalId);
  return out.proposalId;
}
const run = (w: World, id: string, deps: IccDeps = w.deps) => executeIccPurchase(w.db, deps, id, () => w.clock.now);
/** The client with something done right after the instruction was created and before the check. */
function afterCreate(w: World, then: () => void): IccDeps {
  return { ...w.deps, client: { createInstruction: async (b) => { const a = await w.client.createInstruction(b); then(); return a; }, requestCredentials: (i, b) => w.client.requestCredentials(i, b), cancel: (i, b) => w.client.cancel(i, b) } };
}
/** Changes Purser's stored record of the instruction, and its stored hash with it, as someone with the database could. */
function changeRecord(db: DB, id: string, change: (r: { mandates: { preferredMerchantName: string; declineThreshold: { amount: string }; effectiveUntilTime: string }[] }) => void, rehash = true): void {
  const r = row(db, id);
  const record = JSON.parse(r.instruction_json as string) as Parameters<typeof change>[0];
  change(record);
  const json = JSON.stringify(record);
  db.prepare("UPDATE icc_purchases SET instruction_json = ?, instruction_sha256 = ? WHERE action_id = ?").run(json, rehash ? sha256(json) : r.instruction_sha256, id);
}
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("the happy path", () => {
  it("from the CFO's approved terms: the instruction, the check, the credential; stopped before checkout, nothing paid", async () => {
    const w = world();
    const filed = await requestIccPurchase(w.db, req(), T0);
    if (filed.status !== "pending_approval") throw new Error("expected a proposal");
    const p = proposal(w.db, filed.proposalId);
    expect(p.kind).toBe(ICC_PURCHASE_KIND);
    expect(p.expires_at).toBe("2026-11-12T10:30:00Z");
    expect(JSON.parse(p.terms_json)).toMatchObject({ agent: "sourcing", amount: "12.00", currency: "EUR", merchant: { name: SHOP.name, url: SHOP.url, country: SHOP.country }, payment_method_id: INSTRUMENT });

    // Nothing runs before the CFO signs.
    await expect(run(w, p.proposal_id)).rejects.toThrow(/not approved/);
    expect(w.standIn.seen).toEqual([]);

    approve(w.db, p.proposal_id);
    const out = await run(w, p.proposal_id);
    expect(out).toMatchObject({ status: "credential_received_not_used", note: ICC_NOT_USED, proposalId: p.proposal_id, actionId: p.proposal_id, termsSha256: p.terms_sha256, envelope: { authorization: true, signedPayload: true, signedPayloadForm: "three parts" } });
    expect(ICC_NOT_USED).toBe("credential received, not used");
    if (out.status !== "credential_received_not_used") throw new Error("unreachable");

    // Two calls, in order; no confirmation and no cancel.
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create", "credentials"]);
    expect(readCallLog(w.log).map((l) => `${l.method} ${l.endpoint}`)).toEqual(["POST /icc/v1/instructions", "POST /icc/v1/instructions/{id}/credentials"]);

    // The instruction as the stand-in received it: the cap, the merchant, the expiry and the agent of the signed terms, and the hash.
    const sent = w.standIn.seen[0]!.body as { mandates: Record<string, unknown>[]; deviceInformation: Record<string, unknown>; consumerPrompt: string; assuranceData: unknown[] };
    expect(sent.mandates).toEqual([{ mandateId: p.proposal_id, preferredMerchantName: SHOP.name, declineThreshold: { amount: "12.00", currencyCode: "EUR" }, effectiveUntilTime: "1794479400", description: `Trail map packs for the spring range purser-terms-sha256 ${p.terms_sha256}` }]);
    expect(sent.deviceInformation).toMatchObject({ applicationName: "Purser sourcing agent", fingerprintSessionId: PRIVATE.fingerprint });
    expect(sent.assuranceData).toEqual(passthrough().assuranceData);
    expect(sent.consumerPrompt).toContain(p.terms_sha256);
    const asked = w.standIn.seen[1]!.body as { transactionData: { orderInformation: { amountDetail: unknown }; merchantInformation: { merchantName: string } }[] };
    expect(asked.transactionData[0]!.orderInformation.amountDetail).toEqual({ totalAmount: "12.00", currency: "EUR" });
    expect(asked.transactionData[0]!.merchantInformation.merchantName).toBe(SHOP.name);

    // What is recorded: the action, its steps, the audit rows with the CFO's approval as origin. Nothing as paid.
    expect(proposal(w.db, p.proposal_id).status).toBe("EXECUTED");
    expect(row(w.db, p.proposal_id)).toMatchObject({ status: "CREDENTIAL_RECEIVED_NOT_USED", agent: "sourcing", cents: 1200, terms_sha256: p.terms_sha256, instruction_id: out.instructionId, code: null });
    expect(steps(w.db)).toEqual(["icc.instruction:DONE", "icc.credential:DONE"]);
    expect(events(w.db)).toEqual(["icc.purchase_requested", "icc.purchase_started", "icc.instruction_created", "icc.instruction_checked", "icc.credential_received_not_used"]);
    const last = payload(w.db, "icc.credential_received_not_used");
    expect(last).toMatchObject({ note: "credential received, not used", paid: false, action_id: p.proposal_id, terms_sha256: p.terms_sha256, origin: { actor: "cfo", proposal_id: p.proposal_id, approver: "cfo", method: "passkey" } });
    expect(payload(w.db, "icc.instruction_checked")).toMatchObject({ compared: "Purser's record of the instruction it sent, and the create answer, with the signed terms", result: "no difference" });
    expect(payload(w.db, "proposal.executed")).toMatchObject({ outcome: "credential received, not used", paid: false });
    expect(journal(w.db)).toEqual([]);
    for (const table of ["ledger_entries", "transfers", "airi_purchases"]) expect(w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    expect(iccPurchases(w.db)).toEqual([expect.objectContaining({ action_id: p.proposal_id, status: "CREDENTIAL_RECEIVED_NOT_USED", instruction_id: out.instructionId })]);
    expect(w.said.join("\n")).toMatch(/credential received, not used/);

    // It ran once: a second run sends nothing.
    expect(await run(w, p.proposal_id)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ALREADY_RAN" });
    expect(w.standIn.seen).toHaveLength(2);
  });
});

describe("the instruction check refuses before any credential is requested", () => {
  it.each([
    ["a changed amount", (r: Parameters<Parameters<typeof changeRecord>[2]>[0]) => { r.mandates[0]!.declineThreshold.amount = "120.00"; }, "PURSER_ICC_AMOUNT_DIFFERS"],
    ["a changed merchant", (r: Parameters<Parameters<typeof changeRecord>[2]>[0]) => { r.mandates[0]!.preferredMerchantName = "Another shop"; }, "PURSER_ICC_MERCHANT_DIFFERS"],
    ["a changed expiry", (r: Parameters<Parameters<typeof changeRecord>[2]>[0]) => { r.mandates[0]!.effectiveUntilTime = "1794565800"; }, "PURSER_ICC_EXPIRY_DIFFERS"],
  ])("%s in Purser's record of the instruction", async (_name, change, code) => {
    const w = world();
    const id = await approved(w);
    const out = await run(w, id, afterCreate(w, () => changeRecord(w.db, id, change)));
    expect(out).toMatchObject({ status: "refused", by: "purser", code, proposalId: id });
    expect(w.standIn.count("create")).toBe(1);
    expect(w.standIn.count("credentials")).toBe(0);
    expect(row(w.db, id)).toMatchObject({ status: "REFUSED", code });
    expect(proposal(w.db, id).status).toBe("FAILED");
    expect(events(w.db)).toEqual(["icc.purchase_requested", "icc.purchase_started", "icc.instruction_created", "icc.purchase_refused", "icc.instruction_left_to_expire"]);
    const refused = payload(w.db, "icc.purchase_refused");
    expect(refused).toMatchObject({ by: "purser", code, origin: { actor: "cfo" } });
    expect((refused.findings as { code: string }[]).map((f) => f.code)).toContain(code);
    expect(JSON.stringify(refused)).toContain("Purser's record of the instruction it sent");
    expect(steps(w.db)).toEqual(["icc.instruction:DONE"]);
  });

  it("a record changed without its stored hash is refused too", async () => {
    const w = world();
    const id = await approved(w);
    const out = await run(w, id, afterCreate(w, () => changeRecord(w.db, id, (r) => { r.mandates[0]!.declineThreshold.amount = "12.01"; }, false)));
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_AMOUNT_DIFFERS" });
    expect(w.standIn.count("credentials")).toBe(0);
  });

  it("an expired instruction: the clock passed the signed expiry while the instruction was being created", async () => {
    const w = world();
    const id = await approved(w);
    const out = await run(w, id, afterCreate(w, () => { w.clock.now = new Date("2026-11-12T10:30:00Z"); }));
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_EXPIRED" });
    expect(w.standIn.count("credentials")).toBe(0);
    // And a run that starts after the expiry sends nothing at all: the approval is void.
    const late = world();
    const lateId = await approved(late);
    late.clock.now = new Date("2026-11-12T10:30:01Z");
    await expect(run(late, lateId)).rejects.toThrow(/expired/);
    expect(late.standIn.seen).toEqual([]);
  });

  it("an over-cap purchase: a record whose cap is below the amount to pay", async () => {
    const w = world();
    const id = await approved(w);
    const out = await run(w, id, afterCreate(w, () => changeRecord(w.db, id, (r) => { r.mandates[0]!.declineThreshold.amount = "10.00"; })));
    expect(out).toMatchObject({ status: "refused", by: "purser" });
    expect((payload(w.db, "icc.purchase_refused").findings as { code: string }[]).map((f) => f.code)).toEqual(expect.arrayContaining(["PURSER_ICC_AMOUNT_DIFFERS", "PURSER_ICC_ABOVE_CAP"]));
    expect(w.standIn.count("credentials")).toBe(0);
  });

  it("the terms changed between the instruction and the credential: refused on the approved hash", async () => {
    const w = world();
    const id = await approved(w);
    const terms = proposal(w.db, id).terms_json;
    const out = await run(w, id, afterCreate(w, () => w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...JSON.parse(terms), amount: "1.00" }), id)));
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_HASH_MISMATCH" });
    expect(w.standIn.count("credentials")).toBe(0);
    // The same when the action's own copy of the terms changed.
    const w2 = world();
    const id2 = await approved(w2);
    const out2 = await run(w2, id2, afterCreate(w2, () => w2.db.prepare("UPDATE icc_purchases SET terms_json = replace(terms_json, '12.00', '11.00')").run()));
    expect(out2).toMatchObject({ status: "refused", code: "PURSER_HASH_MISMATCH" });
    expect(w2.standIn.count("credentials")).toBe(0);
  });

  it("202 PENDING on create is refused: no credential is requested for an instruction that is not there yet", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.pendingNext("create");
    expect(await run(w, id)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_INSTRUCTION_PENDING" });
    expect(w.standIn.count("credentials")).toBe(0);
  });

  it("with fresh assurance data at hand, the refused instruction is cancelled; a lost cancel answer is not sent twice", async () => {
    const w = world();
    const id = await approved(w);
    const deps = { ...afterCreate(w, () => changeRecord(w.db, id, (r) => { r.mandates[0]!.declineThreshold.amount = "120.00"; })), freshAssurance: passthrough };
    expect(await run(w, id, deps)).toMatchObject({ status: "refused", code: "PURSER_ICC_AMOUNT_DIFFERS" });
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create", "cancel"]);
    expect(events(w.db).at(-1)).toBe("icc.instruction_cancelled");
    expect(steps(w.db)).toEqual(["icc.instruction:DONE", "icc.cancel:DONE"]);

    const w2 = world();
    const id2 = await approved(w2);
    w2.standIn.loseNext("cancel");
    const deps2 = { ...afterCreate(w2, () => changeRecord(w2.db, id2, (r) => { r.mandates[0]!.declineThreshold.amount = "120.00"; })), freshAssurance: passthrough };
    expect(await run(w2, id2, deps2)).toMatchObject({ status: "refused", code: "PURSER_ICC_AMOUNT_DIFFERS" });
    expect(w2.standIn.count("cancel")).toBe(1);
    expect(events(w2.db).at(-1)).toBe("icc.instruction_cancel_unconfirmed");
    expect(steps(w2.db)).toEqual(["icc.instruction:DONE", "icc.cancel:STARTED"]);
  });
});

describe("refused by Purser before any call", () => {
  it.each([
    ["above the hard cap, even with Face ID", () => req({ amount: fromCents(ICC_HARD_CAP_CENTS + 1), items: [{ name: "Tent", unitPrice: fromCents(ICC_HARD_CAP_CENTS + 1), quantity: "1" }] }), "PURSER_ABOVE_HARD_CAP"],
    ["a merchant outside the registry", () => req({ merchantName: "Another shop", merchantUrl: "https://shop.example/" }), "PURSER_MERCHANT_NOT_ALLOWED"],
    ["a merchant name over 40 characters: refused, never cut", () => req({ merchantName: "Northwind Outdoor test shop (Airwallex sandbox)" }), "PURSER_ICC_FIELD_NOT_ALLOWED"],
    ["a currency the rail does not take", () => req({ agent: "treasury", currency: "GBP" }), "PURSER_CURRENCY_NOT_ALLOWED"],
    ["a currency the agent's identity does not cover", () => req({ currency: "USD" }), "PURSER_IDENTITY_DENIED"],
    ["an amount that is no two-decimal amount", () => req({ amount: "12" }), "PURSER_AMOUNT_INVALID"],
    ["items that do not add up", () => req({ amount: "13.00" }), "PURSER_ITEMS_TOTAL_MISMATCH"],
    ["a token that is not an instrument identifier", () => req({ paymentMethodId: "short" }), "PURSER_ICC_FIELD_NOT_ALLOWED"],
  ])("%s", async (_name, make, code) => {
    const w = world();
    const out = await requestIccPurchase(w.db, make(), T0);
    expect(out).toMatchObject({ status: "refused", by: "purser", code });
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(events(w.db)).toEqual(["icc.purchase_requested", "icc.purchase_refused"]);
    expect(payload(w.db, "icc.purchase_refused")).toMatchObject({ code, by: "purser" });
  });

  it("a purchase in dollars by an agent whose identity covers them goes to the CFO like any other", async () => {
    const w = world();
    expect(await requestIccPurchase(w.db, req({ agent: "treasury", currency: "USD" }), T0)).toMatchObject({ status: "pending_approval" });
  });

  it("the emergency stop and a paused agent, at the request and again at the run", async () => {
    const w = world();
    const id = await approved(w);
    w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString());
    expect(await requestIccPurchase(w.db, req(), T0)).toMatchObject({ status: "refused", code: "PURSER_EMERGENCY_STOP" });
    expect(await run(w, id)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_EMERGENCY_STOP" });
    expect(proposal(w.db, id).status).toBe("NEEDS_REAPPROVAL");
    const w2 = world();
    w2.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.sourcing', 'on', ?)").run(T0.toISOString());
    expect(await requestIccPurchase(w2.db, req(), T0)).toMatchObject({ status: "refused", code: "PURSER_AGENT_PAUSED" });
    expect(w.standIn.seen).toEqual([]);
  });

  it("a proposal of another kind, and terms changed after the CFO signed", async () => {
    const w = world();
    w.db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-9', 'dev_test', '{}', 'x', 'test', 'APPROVED', '2099-01-01T00:00:00Z', 'now')").run();
    expect(await run(w, "P-9")).toMatchObject({ status: "refused", code: "PURSER_NOT_AN_ICC_PURCHASE" });
    expect(await run(w, "P-none")).toMatchObject({ status: "refused", code: "PURSER_NOT_AN_ICC_PURCHASE" });
    const id = await approved(w);
    const t = JSON.parse(proposal(w.db, id).terms_json) as Record<string, unknown>;
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, description: "Something else" }), id);
    await expect(run(w, id)).rejects.toThrow(/approved hash/);
    expect(w.standIn.seen).toEqual([]);
  });

  it("terms the API's limits cannot take, or that are not this rail's shape, close the proposal before anything runs", async () => {
    const w = world();
    const file = (id: string, terms: Record<string, unknown>) => {
      const full = { ...terms, proposal_id: id };
      const sha = termsHash(full as never);
      w.db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'sourcing', 'PENDING_APPROVAL', ?, ?)").run(id, ICC_PURCHASE_KIND, JSON.stringify(full), sha, String(terms.expires_at), T0.toISOString());
      approve(w.db, id);
    };
    const good = JSON.parse(proposal(w.db, await approved(w)).terms_json) as Record<string, unknown>;
    // An expiry with a fraction of a second cannot be written as the API's whole seconds, and is never rounded.
    file("P-0002", { ...good, expires_at: "2026-11-12T10:30:00.500Z" });
    expect(await run(w, "P-0002")).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_FIELD_NOT_ALLOWED" });
    expect(proposal(w.db, "P-0002").status).toBe("NEEDS_REAPPROVAL");
    file("P-0003", { schema: good.schema, kind: ICC_PURCHASE_KIND, expires_at: good.expires_at, agent: "sourcing", amount: "12.00", currency: "EUR" });
    expect(await run(w, "P-0003")).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_TERMS_MALFORMED" });
    expect(proposal(w.db, "P-0003").status).toBe("NEEDS_REAPPROVAL");
    expect(w.standIn.seen).toEqual([]);
  });

  it("the assurance file cannot be read: nothing is sent", async () => {
    const w = world();
    const id = await approved(w);
    const out = await run(w, id, { ...w.deps, passthrough: () => { throw new Error(`ICC_ASSURANCE_FILE: the file could not be opened (ENOENT) ${PRIVATE.identity}`); } });
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_ASSURANCE_UNAVAILABLE" });
    expect(w.standIn.seen).toEqual([]);
    expect(readCallLog(w.log)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain(PRIVATE.identity);
  });
});

describe("nothing is sent twice", () => {
  it("a lost answer on create: unconfirmed, and a re-run sends nothing, also from a new process", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.loseNext("create");
    const out = await run(w, id);
    expect(out).toMatchObject({ status: "unconfirmed", step: "instruction", actionId: id, proposalId: id });
    expect(w.standIn.count("create")).toBe(1);
    expect(row(w.db, id)).toMatchObject({ status: "UNCONFIRMED", code: "ICC_NO_ANSWER_INSTRUCTION", instruction_id: null });
    expect(proposal(w.db, id).status).toBe("FAILED");
    expect(steps(w.db)).toEqual(["icc.instruction:STARTED"]);
    expect(events(w.db)).toEqual(["icc.purchase_requested", "icc.purchase_started", "icc.instruction_unconfirmed"]);

    // The same process again, then another process on the same database and call log.
    expect(await run(w, id)).toMatchObject({ status: "unconfirmed", step: "instruction" });
    const again = world({ db: w.db, log: w.log });
    expect(await run(again, id)).toMatchObject({ status: "unconfirmed", step: "instruction" });
    expect(w.standIn.count("create")).toBe(1);
    expect(again.standIn.seen).toEqual([]);
    expect(readCallLog(w.log)).toHaveLength(1);
    expect(events(w.db).filter((e) => e === "icc.rerun_sent_nothing")).toHaveLength(2);
  });

  it("a lost answer on the credential request: unconfirmed, and a re-run sends nothing", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.loseNext("credentials");
    const out = await run(w, id);
    expect(out).toMatchObject({ status: "unconfirmed", step: "credential" });
    if (out.status !== "unconfirmed") throw new Error("unreachable");
    expect(out.instructionId).toMatch(/^[A-Za-z0-9-]{36,50}$/);
    expect(row(w.db, id)).toMatchObject({ status: "UNCONFIRMED", code: "ICC_NO_ANSWER_CREDENTIAL" });
    expect(steps(w.db)).toEqual(["icc.instruction:DONE", "icc.credential:STARTED"]);
    expect(await run(world({ db: w.db, log: w.log }), id)).toMatchObject({ status: "unconfirmed", step: "credential" });
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create", "credentials"]);
    expect(readCallLog(w.log)).toHaveLength(2);
  });

  it.each([
    ["an answer that cannot be decrypted", (s: IccStandIn) => s.garbleNext("credentials")],
    ["a call that is never answered", (s: IccStandIn) => s.hangNext("credentials")],
    ["a server error", (s: IccStandIn) => s.errorNext("credentials", 500, "INTERNAL_SERVER_ERROR")],
  ])("%s on the credential request is unconfirmed as well", async (_name, arrange) => {
    const w = world();
    const short = new IccClient({ merchantId: "purser_sandbox", signer: { scheme: "jwt-p12", keyId: "jwt-key-1", privateKey: keys.signing.privateKey }, budget: 3, callLog: w.log, fetchImpl: w.standIn.fetch, timeoutMs: 40, mle: { request: { publicKey: keys.request.publicKey, keyId: keys.request.keyId }, responseKeyId: "response-key-1", responsePrivateKey: keys.response.privateKey } });
    const id = await approved(w);
    arrange(w.standIn);
    expect(await run(w, id, { ...w.deps, client: short })).toMatchObject({ status: "unconfirmed", step: "credential" });
    expect(w.standIn.count("credentials")).toBe(1);
  });

  it("a process that died after writing its intent: the re-run finds the intent, sends nothing and reports unconfirmed", async () => {
    const w = world();
    const id = await approved(w);
    // As a crash leaves it: the intent written, the call on its way and never answered, the proposal still executing.
    const dying: IccDeps = { ...w.deps, client: { ...afterCreate(w, () => {}).client, createInstruction: () => new Promise<never>(() => {}) } };
    void run(w, id, dying);
    await new Promise((r) => setTimeout(r, 20));
    expect(row(w.db, id)).toMatchObject({ status: "INSTRUCTION_SENT" });
    expect(proposal(w.db, id).status).toBe("EXECUTING");
    expect(steps(w.db)).toEqual(["icc.instruction:STARTED"]);
    const out = await run(world({ db: w.db, log: w.log }), id);
    expect(out).toMatchObject({ status: "unconfirmed", step: "instruction" });
    expect(row(w.db, id)).toMatchObject({ status: "UNCONFIRMED" });
    expect(proposal(w.db, id).status).toBe("FAILED");
    expect(w.standIn.seen).toEqual([]);
  });

  it("a process that died with no call in flight (the instruction made, no credential asked): closed, nothing sent again", async () => {
    const w = world();
    const id = await approved(w);
    // As a crash between the create answer and the credential request leaves it.
    const dying: IccDeps = { ...w.deps, client: { ...afterCreate(w, () => {}).client, requestCredentials: () => new Promise<never>(() => {}) } };
    void run(w, id, dying);
    await new Promise((r) => setTimeout(r, 30));
    w.db.prepare("UPDATE icc_purchases SET status = 'INSTRUCTION_CREATED' WHERE action_id = ?").run(id);
    const out = await run(world({ db: w.db, log: w.log }), id);
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_RESTARTED" });
    expect(row(w.db, id)).toMatchObject({ status: "REFUSED", code: "PURSER_ICC_RESTARTED" });
    expect(proposal(w.db, id).status).toBe("FAILED");
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create"]);
    expect(await run(w, id)).toMatchObject({ status: "refused", code: "PURSER_ALREADY_RAN" });
  });

  it("an error nobody expected after the intent was written counts as unknown too: unconfirmed, never sent again", async () => {
    const w = world();
    const id = await approved(w);
    const odd: IccDeps = { ...w.deps, client: { ...afterCreate(w, () => {}).client, createInstruction: () => { throw new TypeError(`something else ${PRIVATE.identity}`); } } };
    const out = await run(w, id, odd);
    expect(out).toMatchObject({ status: "unconfirmed", step: "instruction" });
    expect(JSON.stringify(out)).not.toContain(PRIVATE.identity);
    expect(await run(w, id)).toMatchObject({ status: "unconfirmed" });
    expect(w.standIn.seen).toEqual([]);
  });
});

describe("answers of the service, and the budget", () => {
  it("a documented error on create: refused by the service's code; no credential", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.errorNext("create", 400, "INVALID_ARGUMENT");
    expect(await run(w, id)).toMatchObject({ status: "refused", by: "icc", code: "ICC_HTTP_400_INVALID_ARGUMENT" });
    expect(row(w.db, id)).toMatchObject({ status: "REFUSED", code: "ICC_HTTP_400_INVALID_ARGUMENT" });
    expect(w.standIn.count("credentials")).toBe(0);
    expect(JSON.stringify(w.db.prepare("SELECT payload_json FROM audit_log").all())).not.toContain(w.standIn.errorMessage);
  });

  it("the pending credentials answer and a documented error on the credential request: refused, the instruction left to expire", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.pendingNext("credentials");
    expect(await run(w, id)).toMatchObject({ status: "refused", by: "icc", code: "ICC_CREDENTIAL_PENDING" });
    expect(payload(w.db, "icc.purchase_refused")).toMatchObject({ pending_events: ["PENDING_CARDHOLDER_AUTHENTICATION"] });
    const w2 = world();
    const id2 = await approved(w2);
    w2.standIn.errorNext("credentials", 409, "UNAVAILABLE");
    expect(await run(w2, id2)).toMatchObject({ status: "refused", by: "icc", code: "ICC_HTTP_409_UNAVAILABLE" });
    expect(events(w2.db).at(-1)).toBe("icc.instruction_left_to_expire");
  });

  it("a credentials answer that is not the documented shape: received, dropped, refused", async () => {
    const w = world();
    const id = await approved(w);
    w.standIn.answerNext("credentials", { clientCorrelationId: "another", instructionId: "x", status: "COMPLETED", signedPayload: w.standIn.credential.signedPayload });
    expect(await run(w, id)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_CREDENTIAL_SHAPE" });
    expect(row(w.db, id)).toMatchObject({ status: "REFUSED" });
  });

  it("the budget counts before sending: with one call approved, the credential request is not sent", async () => {
    const w = world({ budget: 1 });
    const id = await approved(w);
    const out = await run(w, id);
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ICC_BUDGET_SPENT" });
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create"]);
    expect(readCallLog(w.log)).toHaveLength(1);
    // Nothing was sent, so this is a refusal, not an unknown outcome.
    expect(row(w.db, id)).toMatchObject({ status: "REFUSED", code: "PURSER_ICC_BUDGET_SPENT" });
    const none = world({ budget: 0 });
    const id0 = await approved(none);
    expect(await run(none, id0)).toMatchObject({ status: "refused", code: "PURSER_ICC_BUDGET_SPENT" });
    expect(none.standIn.seen).toEqual([]);
  });
});

describe("nothing private is kept or printed", () => {
  it("no card number or security code pattern, credential, assurance value or key in console output, the call log, any table or an outcome", async () => {
    const printed: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...a: unknown[]) => { printed.push(a.map(String).join(" ")); });
    const w = world({ budget: 20 });
    const outcomes: unknown[] = [];
    const go = async (arrange: (s: IccStandIn) => void, deps?: (id: string) => IccDeps) => {
      const id = await approved(w);
      arrange(w.standIn);
      try { outcomes.push(await run(w, id, deps?.(id))); } catch (e) { outcomes.push(`${String(e)} ${(e as Error).stack}`); }
    };
    await go(() => {});
    await go((s) => s.loseNext("create"));
    await go((s) => s.garbleNext("credentials"));
    await go((s) => s.errorNext("create", 400, "INVALID_ARGUMENT"));
    await go((s) => s.errorNext("credentials", 403, "FORBIDDEN"));
    await go((s) => s.pendingNext("create"));
    await go(() => {}, (id) => ({ ...afterCreate(w, () => changeRecord(w.db, id, (r) => { r.mandates[0]!.declineThreshold.amount = "120.00"; })), freshAssurance: passthrough }));
    outcomes.push(await requestIccPurchase(w.db, req({ merchantName: "Another shop" }), T0));
    expect(outcomes.filter((o) => (o as IccOutcome).status === "credential_received_not_used")).toHaveLength(1);
    expect(w.standIn.count("credentials")).toBeGreaterThanOrEqual(3);

    const tables = (w.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toContain("icc_purchases");
    const database = tables.map((t) => `${t}: ${JSON.stringify(w.db.prepare(`SELECT * FROM "${t}"`).all())}`).join("\n");
    const callLog = readFileSync(w.log, "utf8");
    const { inspect } = await import("node:util");
    const everything = [printed.join("\n"), w.said.join("\n"), callLog, database, JSON.stringify(outcomes), inspect(outcomes, { depth: 10 }), JSON.stringify(iccPurchases(w.db))].join("\n");

    // Markers: the stand-in's credential, the device and assurance values, the keys, and what an error answer said.
    const pemBody = (pem: string) => pem.split("\n").filter((l) => l && !l.startsWith("-----")).slice(2, 4);
    const markers = [
      w.standIn.credential.signedPayload, w.standIn.credential.authorization, ...w.standIn.credential.signedPayload.split("."),
      PRIVATE.fingerprint, PRIVATE.identity, PRIVATE.ip, PRIVATE.device, w.standIn.errorMessage, w.standIn.maskedNumber, keys.sharedSecret,
      ...pemBody(keys.signing.privateKey.export({ type: "pkcs8", format: "pem" }) as string), ...pemBody(keys.response.privateKey.export({ type: "pkcs8", format: "pem" }) as string),
      "encryptedRequest", "encryptedResponse", "signedPayload\":\"", "verificationTimestamp",
    ];
    for (const m of markers) expect(everything.includes(m), `found: ${m.slice(0, 20)}`).toBe(false);
    // A number as long as a card number (the stand-in for one is built here from parts), grouped or not, and any security code word.
    const numberLike = ["4" + "1".repeat(3), "1".repeat(4), "1".repeat(4), "1".repeat(4)];
    expect(/\b\d{12,19}\b/.test(numberLike.join(""))).toBe(true);
    // A random UUID (the correlation ID, the tail of an instruction ID) can end in twelve digits by chance: UUIDs are
    // taken out first, so that this check is about numbers and not about luck.
    const withoutUuids = everything.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "[uuid]");
    expect(withoutUuids).not.toMatch(/\b\d{12,19}\b/);
    expect(withoutUuids).not.toMatch(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/);
    expect(everything).not.toMatch(/\b(cvv2?|cvc|csc|security[ _-]?code)\b/i);

    // The repository's privacy scan over what the rail itself wrote and printed: no token, key, bearer value or long
    // encoded run. The 64-hex values it may hold are the hashes the rows name.
    const own = [printed.join("\n"), w.said.join("\n"), callLog, JSON.stringify(outcomes), JSON.stringify(w.db.prepare("SELECT * FROM icc_purchases").all()),
      JSON.stringify(w.db.prepare("SELECT event, subject, payload_json FROM audit_log WHERE event LIKE 'icc.%'").all()), JSON.stringify(w.db.prepare("SELECT * FROM money_steps").all())].join("\n");
    // Instruction IDs are references the rows are meant to hold; they are long, so the scan would take them for an encoded run.
    const scanned = (iccPurchases(w.db) as { instruction_id: string | null }[]).reduce((t, r) => (r.instruction_id ? t.replaceAll(r.instruction_id, "[instruction id]") : t), own);
    const known64 = new Set([...own.matchAll(/(?:sha256|hash)\\*":\s*\\*"([0-9a-f]{64})/g)].map((m) => m[1]!));
    for (const m of own.matchAll(/purser-terms-sha256 ([0-9a-f]{64})/g)) known64.add(m[1]!);
    expect(privateFindings(scanned, { known64, known40: new Set() })).toEqual([]);
  });
});

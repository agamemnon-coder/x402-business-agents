// The ICC rail's entry (src/executors/index.ts, src/approve/client.ts) and what holds while KIT11_ICC_RAIL is absent:
// nothing of the rail is reachable and nothing else changes. With the switch on, the executor runs the flow against
// the TEST STAND-IN (test/support/iccStandIn.ts: built from the documented shapes, not Visa's or Cybersource's
// service), which a test puts in place of fetch. No network.
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agentOf, describeTerms, whyYou } from "../src/approve/client.js";
import { readCallLog } from "../src/airwallex/callBudget.js";
import { openDb, type DB } from "../src/db/open.js";
import { execute } from "../src/executors/index.js";
import { ICC_ENV_NAMES } from "../src/icc/config.js";
import { ICC_PURCHASE_KIND } from "../src/icc/instruction.js";
import { ICC_MERCHANTS } from "../src/icc/policy.js";
import { executeIccPurchase, iccPurchases, iccTerms, requestIccPurchase, type IccPurchaseRequest } from "../src/icc/purchase.js";
import { termsHash } from "../src/lib/terms.js";
import { decide } from "../src/policy/approvals.js";
import { rules } from "../src/policy/rules.js";
import { MONEY_EVENTS } from "../src/provenance/origin.js";
import { RAIL_LABELS } from "../src/money/registerShape.js";
import { makeIccTestKeys, writeIccKeyFiles, type IccTestKeys } from "./support/iccKeys.js";
import { IccStandIn } from "./support/iccStandIn.js";

const T0 = new Date();
/** A made-up instrument identifier of the documented length (32). Not a card number and not a real ID. */
const INSTRUMENT = "A1B2C3D4".repeat(4);
const SHOP = ICC_MERCHANTS[0]!;
const ROOT = new URL("..", import.meta.url).pathname;

let keys: IccTestKeys;
beforeAll(() => { keys = makeIccTestKeys(); });
beforeEach(() => { for (const name of ICC_ENV_NAMES) vi.stubEnv(name, undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const req = (): IccPurchaseRequest => ({
  agent: "sourcing", paymentMethodId: INSTRUMENT, merchantName: SHOP.name, merchantUrl: SHOP.url, merchantCountry: SHOP.country,
  amount: "12.00", currency: "EUR", items: [{ name: "Trail map pack", unitPrice: "6.00", quantity: "2" }], description: "Trail map packs",
});

/** An approved icc_purchase proposal, written as the flow would have filed it (the rail's own door is shut when off). */
function approvedProposal(db: DB): string {
  const expires = new Date(T0.getTime() + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const terms = iccTerms(req(), "P-0001", expires);
  const sha = termsHash(terms);
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'sourcing', 'PENDING_APPROVAL', ?, ?)")
    .run("P-0001", ICC_PURCHASE_KIND, JSON.stringify(terms), sha, expires, T0.toISOString());
  decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: sha, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T0);
  return "P-0001";
}
const tables = (db: DB) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
const auditCount = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|html|sql|json|md)$/.test(name) ? [path] : [];
  });
}

describe("with KIT11_ICC_RAIL absent", () => {
  it("the executor refuses the kind with a clear message, and nothing is called or written", async () => {
    const fetched = vi.fn(async () => { throw new Error("no network in tests"); });
    vi.stubGlobal("fetch", fetched);
    const db = openDb(":memory:");
    const before = tables(db);
    const id = approvedProposal(db);
    const rows = auditCount(db);
    await expect(execute(db, id)).rejects.toThrow("the ICC rail is off (KIT11_ICC_RAIL); nothing was run");
    expect(fetched).not.toHaveBeenCalled();
    expect(status(db, id)).toBe("APPROVED");
    expect(tables(db)).toEqual(before);
    expect(auditCount(db)).toBe(rows);
    expect(iccPurchases(db)).toEqual([]);
  });

  it("the rail's own two doors are shut as well: nothing is filed, nothing runs, no table is made", async () => {
    const db = openDb(":memory:");
    const before = tables(db);
    const rows = auditCount(db);
    expect(await requestIccPurchase(db, req(), T0)).toEqual({ status: "refused", by: "purser", code: "PURSER_ICC_RAIL_OFF", reason: "the ICC rail is off (KIT11_ICC_RAIL); nothing was filed" });
    const id = approvedProposal(db);
    const after = auditCount(db);
    const client = { createInstruction: vi.fn(), requestCredentials: vi.fn(), cancel: vi.fn() };
    expect(await executeIccPurchase(db, { client, passthrough: () => { throw new Error("not read"); } }, id)).toMatchObject({ status: "refused", code: "PURSER_ICC_RAIL_OFF" });
    expect(client.createInstruction).not.toHaveBeenCalled();
    expect(tables(db)).toEqual(before);
    expect(auditCount(db)).toBe(after);
    expect(after).toBeGreaterThan(rows);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'icc.%'").get()).toEqual({ n: 0 });
  });

  it("no rule and no registry differs: the policy's rules, the money events, the register's rails, the agents' rail choice", () => {
    const db = openDb(":memory:");
    const off = JSON.stringify(rules(db));
    vi.stubEnv("KIT11_ICC_RAIL", "on");
    expect(JSON.stringify(rules(db))).toBe(off);
    expect(off).not.toMatch(/icc/i);
    expect([...MONEY_EVENTS].filter((e) => /icc/i.test(e))).toEqual([]);
    expect(Object.keys(RAIL_LABELS).filter((r) => /icc/i.test(r))).toEqual([]);
    // Files this rail does not touch: the agents' rail choice, the policy's rules, the origin and money registries, the schema.
    for (const file of ["src/agents/railChoice.ts", "src/policy/rules.ts", "src/provenance/origin.ts", "src/money/register.ts", "src/money/registerShape.ts", "src/accounting/gl.ts", "src/db/schema.sql"]) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(/\bicc\b|icc_|ICC|Intelligent Commerce Connect/);
    }
  });
});

describe("the stand-in stays under test/", () => {
  it("nothing under src/ or worker/src imports from test/, names the stand-in, or answers in the service's place", () => {
    const files = [...sources(join(ROOT, "src")), ...sources(join(ROOT, "worker/src"))];
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*\/test\/|import\(["'][^"']*\/test\//);
      expect(text, file).not.toMatch(/iccStandIn|IccStandIn|iccKeys/);
    }
    // The rail's own code makes requests and reads answers; it builds no answer and holds no emulator of the API.
    const icc = sources(join(ROOT, "src/icc"));
    expect(icc.map((f) => f.slice(ROOT.length))).toEqual(expect.arrayContaining(["src/icc/auth.ts", "src/icc/callBudget.ts", "src/icc/client.ts", "src/icc/config.ts", "src/icc/deps.ts", "src/icc/instruction.ts", "src/icc/policy.ts", "src/icc/purchase.ts"]));
    for (const file of icc) expect(readFileSync(file, "utf8"), file).not.toMatch(/new Response\(|createServer|stand-?in|emulat|mock/i);
  });
});

describe("with KIT11_ICC_RAIL=on", () => {
  it("an incomplete environment stops the executor before any call, naming what is not set", async () => {
    vi.stubEnv("KIT11_ICC_RAIL", "on");
    const fetched = vi.fn(async () => { throw new Error("no network in tests"); });
    vi.stubGlobal("fetch", fetched);
    const db = openDb(":memory:");
    const id = approvedProposal(db);
    await expect(execute(db, id)).rejects.toThrow(/^the ICC rail cannot start \(not set: ICC_CALL_BUDGET, ICC_CALL_LOG, ICC_MERCHANT_ID, .*ICC_ASSURANCE_FILE\); nothing was called$/);
    expect(fetched).not.toHaveBeenCalled();
    expect(status(db, id)).toBe("APPROVED");
  });

  it("the executor runs the flow from the environment: the keys from PEM files, the assurance data from the private file", async () => {
    const files = writeIccKeyFiles(keys);
    const dir = mkdtempSync(join(tmpdir(), "icc-executor-test-"));
    const assurance = join(dir, "assurance.json");
    writeFileSync(assurance, JSON.stringify({ deviceInformation: { fingerprintSessionId: "fp-1", deviceData: { type: "Mobile", brand: "Test" }, ipAddress: "192.168.0.100" }, assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: "identity-1" } }] }), { mode: 0o600 });
    const env: Record<string, string> = {
      KIT11_ICC_RAIL: "on", ICC_CALL_BUDGET: "3", ICC_CALL_LOG: join(dir, "calls.jsonl"), ICC_MERCHANT_ID: "purser_sandbox", ICC_JWT_KEY_ID: "jwt-key-1", ICC_JWT_PRIVATE_KEY_FILE: files.jwtKey,
      ICC_MLE_REQUEST_CERT_FILE: files.requestCert, ICC_MLE_RESPONSE_KEY_ID: "response-key-1", ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: files.responseKey, ICC_INSTRUMENT_IDENTIFIER_ID: INSTRUMENT, ICC_ASSURANCE_FILE: assurance,
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const standIn = new IccStandIn({ keys, merchantId: "purser_sandbox", jwtKeyId: "jwt-key-1", sharedKeyId: "shared-key-1", responseMleKeyId: "response-key-1" });
    vi.stubGlobal("fetch", standIn.fetch);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { printed.push(a.map(String).join(" ")); });

    const db = openDb(":memory:");
    const id = approvedProposal(db);
    await execute(db, id);
    expect(status(db, id)).toBe("EXECUTED");
    expect(standIn.seen.map((s) => s.op)).toEqual(["create", "credentials"]);
    expect(readCallLog(env.ICC_CALL_LOG!)).toHaveLength(2);
    expect(iccPurchases(db)).toEqual([expect.objectContaining({ action_id: id, status: "CREDENTIAL_RECEIVED_NOT_USED" })]);
    const last = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'icc.credential_received_not_used'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(last).toMatchObject({ note: "credential received, not used", paid: false, origin: { actor: "cfo", proposal_id: id } });
    expect(printed.join("\n")).toContain("credential received, not used");
    expect(printed.join("\n")).not.toContain(standIn.credential.signedPayload);

    // A second run is refused by the executor: nothing is sent again.
    await expect(execute(db, id)).rejects.toThrow(/refused by purser: PURSER_ALREADY_RAN/);
    expect(standIn.seen).toHaveLength(2);
  });

  it("an unknown outcome reaches the runner as an error that says nothing is retried", async () => {
    const files = writeIccKeyFiles(keys);
    const dir = mkdtempSync(join(tmpdir(), "icc-executor-test-"));
    const assurance = join(dir, "assurance.json");
    writeFileSync(assurance, JSON.stringify({ deviceInformation: { fingerprintSessionId: "fp-1", deviceData: { type: "Mobile", brand: "Test" }, ipAddress: "192.168.0.100" }, assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: "identity-1" } }] }), { mode: 0o600 });
    const env: Record<string, string> = {
      KIT11_ICC_RAIL: "on", ICC_CALL_BUDGET: "3", ICC_CALL_LOG: join(dir, "calls.jsonl"), ICC_MERCHANT_ID: "purser_sandbox", ICC_JWT_KEY_ID: "jwt-key-1", ICC_JWT_PRIVATE_KEY_FILE: files.jwtKey,
      ICC_MLE_REQUEST_CERT_FILE: files.requestCert, ICC_MLE_RESPONSE_KEY_ID: "response-key-1", ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: files.responseKey, ICC_INSTRUMENT_IDENTIFIER_ID: INSTRUMENT, ICC_ASSURANCE_FILE: assurance,
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const standIn = new IccStandIn({ keys, merchantId: "purser_sandbox", jwtKeyId: "jwt-key-1", sharedKeyId: "shared-key-1", responseMleKeyId: "response-key-1" });
    standIn.loseNext("create");
    vi.stubGlobal("fetch", standIn.fetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const db = openDb(":memory:");
    const id = approvedProposal(db);
    await expect(execute(db, id)).rejects.toThrow(/the instruction call's outcome is not known .*nothing is retried/);
    await expect(execute(db, id)).rejects.toThrow(/nothing is retried/);
    expect(standIn.count("create")).toBe(1);
  });
});

describe("the phone's words for the kind", () => {
  const terms = { ...iccTerms(req(), "P-0001", "2026-11-12T10:30:00Z") } as unknown as Record<string, unknown>;

  it("the CFO can approve it, and reads what will and will not happen: a credential is requested, nothing is paid", () => {
    const f = describeTerms(terms, {});
    expect(f.approvable).toBe(true);
    expect(f.sentence).toBe(`Let the sourcing agent request a single-use payment credential through Intelligent Commerce Connect (sandbox) for at most EUR 12.00 at ${SHOP.name} (${SHOP.url}), for: Trail map packs. Nothing is paid: Purser stops before checkout.`);
    expect(f.rows).toEqual([["Agent", "sourcing"], ["At most", "EUR 12.00"], ["Merchant", `${SHOP.name} (${SHOP.url})`], ["Items", "2 × Trail map pack at 6.00"], ["For", "Trail map packs"], ["Ends", "2026-11-12T10:30:00Z"]]);
    expect(agentOf("sourcing", terms)).toBe("Sourcing agent");
    expect(whyYou(terms)).toBe("A payment credential is requested for an agent only with your Face ID.");
    // Nothing in these words says the service ran, or that anyone approved or endorsed anything.
    expect(JSON.stringify(f) + whyYou(terms)).not.toMatch(/certified|endorsed|approved by|Visa approved|was paid/i);
  });
});

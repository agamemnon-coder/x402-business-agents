// npm run icc -- preflight | run | record (src/cli/icc.ts, src/icc/conductor.ts, src/icc/record.ts), driven through
// its functions with the TEST STAND-IN (test/support/iccStandIn.ts) in place of fetch. The stand-in is built from the
// documented request and response shapes; it is not Visa's or Cybersource's service and these tests prove nothing about
// it: they prove what the command does, what it refuses and what it writes. No network. Keys, the passkey, the
// instrument identifier and the markers are made at run time. Records go to a temporary folder, never to docs/runs.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { countByEndpoint, readCallLog } from "../src/airwallex/callBudget.js";
import { iccCli, type IccCliIo } from "../src/cli/icc.js";
import { openDb, type DB } from "../src/db/open.js";
import { ICC_PREFLIGHT_NOTE, waitForOutcome } from "../src/icc/conductor.js";
import { executeIccPurchase } from "../src/icc/purchase.js";
import { readIccRunRecord } from "../src/icc/record.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { resuming } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { makeIccTestKeys, writeIccKeyFiles, type IccTestKeys } from "./support/iccKeys.js";
import { IccStandIn } from "./support/iccStandIn.js";

/** A day that is not today: the record's date must come from the rows, not from the clock of the record command. */
const T0 = new Date("2026-10-01T10:00:00Z");
/** A made-up instrument identifier of the documented length (32), from parts. Not a card number and not a real ID. */
const INSTRUMENT = ["A1B2", "C3D4"].join("").repeat(4);
const ORG = ["purser", "sandbox"].join("_");
const JWT_KID = ["jwt", "kid", "77"].join("-");
const RESPONSE_KID = ["response", "kid", "88"].join("-");
/** Values that stand for the cardholder's device and assurance data: never printed, never recorded. */
const PRIVATE = { fingerprint: ["fp", "session", "5c1e"].join("-"), identity: ["identity", "91b7"].join("-"), ip: "192.168.0.100", device: ["device", "4e2b"].join("-") };
const RP = "icc-test.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;

let keys: IccTestKeys;
beforeAll(() => { keys = makeIccTestKeys(); });
afterEach(() => { resuming.clear(); });

const assurance = (over: { identity?: boolean } = {}) => ({
  deviceInformation: { fingerprintSessionId: PRIVATE.fingerprint, deviceData: { type: "Mobile", brand: "Test" }, ipAddress: PRIVATE.ip, clientDeviceId: PRIVATE.device },
  assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", ...(over.identity === false ? {} : { authenticatedIdentities: { id: PRIVATE.identity } }) }],
});

interface World {
  env: Record<string, string | undefined>;
  dir: string;
  standIn: IccStandIn;
  out: string[];
  err: string[];
  io: IccCliIo;
  auth: FakeAuthenticator;
  /** Every value of the environment that must never be printed or recorded. */
  values: string[];
}

function world(over: Record<string, string | undefined> = {}): World {
  const files = writeIccKeyFiles(keys);
  const dir = mkdtempSync(join(tmpdir(), "icc-cli-test-"));
  const assuranceFile = join(dir, "assurance.json");
  writeFileSync(assuranceFile, JSON.stringify(assurance()), { mode: 0o600 });
  const env: Record<string, string | undefined> = {
    KIT11_ICC_RAIL: "on", ICC_GO: "yes", ICC_CALL_BUDGET: "5", ICC_CALL_LOG: join(dir, "icc-calls.jsonl"),
    KIT11_DB: join(dir, "icc-test.sqlite"), KIT11_KEYS_DIR: join(dir, "icc-test-keys"),
    ICC_MERCHANT_ID: ORG, ICC_JWT_KEY_ID: JWT_KID, ICC_JWT_PRIVATE_KEY_FILE: files.jwtKey,
    ICC_MLE_REQUEST_CERT_FILE: files.requestCert, ICC_MLE_RESPONSE_KEY_ID: RESPONSE_KID, ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: files.responseKey,
    ICC_INSTRUMENT_IDENTIFIER_ID: INSTRUMENT, ICC_ASSURANCE_FILE: assuranceFile, ...over,
  };
  const standIn = new IccStandIn({ keys, merchantId: ORG, jwtKeyId: JWT_KID, sharedKeyId: "shared-kid-1", responseMleKeyId: RESPONSE_KID });
  const out: string[] = [], err: string[] = [];
  const auth = new FakeAuthenticator();
  const io: IccCliIo = {
    env, out: (l) => out.push(l), err: (l) => err.push(l), fetchImpl: standIn.fetch, now: () => T0, recordDir: join(dir, "records"),
    // The CFO's approval in a test: a virtual test passkey (src/redteam/authenticator.ts) signs the exact terms hash
    // through the same verification as the relay; then the flow runs in this process, as the runner would run it.
    awaitCfo: async ({ db, proposalId, deps }) => {
      const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
      const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
      const signed = await processAssertion(db, { ticket: `icc-test-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: T0.toISOString() }, T0);
      if (signed.status !== "approved") return `not approved: ${signed.status}`;
      await executeIccPurchase(db, deps, proposalId, () => T0);
      return (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string }).status;
    },
  };
  const values = [env.ICC_CALL_LOG!, env.KIT11_DB!, env.KIT11_KEYS_DIR!, ORG, JWT_KID, RESPONSE_KID, files.jwtKey, files.requestCert, files.responseKey, files.dir, INSTRUMENT, assuranceFile, keys.request.keyId];
  return { env, dir, standIn, out, err, io, auth, values };
}

/** Enrols the test's virtual passkey in the world's own ledger, as the CFO does on the relay before the run. */
async function enrol(w: World): Promise<void> {
  const db = openDb(w.env.KIT11_DB!);
  try {
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, T0);
    const credential = w.auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
    const r = await processRegistration(db, { ticket: "icc-test-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: T0.toISOString() }, { label: "icc test virtual passkey" }, T0);
    if (r.status !== "pending") throw new Error(`not enrolled: ${JSON.stringify(r)}`);
    confirmPasskey(db, fingerprintOf(w.auth.spkiSha256), T0);
  } finally {
    db.close();
  }
}

const printed = (w: World) => [...w.out, ...w.err].join("\n");
const calls = (w: World) => (existsSync(w.env.ICC_CALL_LOG!) ? readCallLog(w.env.ICC_CALL_LOG!) : []);
function expectNothingPrinted(w: World): void {
  const text = printed(w);
  for (const v of w.values) expect(text, v).not.toContain(v);
  for (const v of Object.values(PRIVATE)) expect(text).not.toContain(v);
  expect(text).not.toContain(w.standIn.credential.authorization);
  expect(text).not.toContain(w.standIn.credential.signedPayload);
  expect(text).not.toContain(w.standIn.maskedNumber);
  expect(text).not.toMatch(/-----BEGIN|\bBearer\b|eyJ[\w-]{10,}/);
}
function withDb<T>(w: World, f: (db: DB) => T): T {
  const db = openDb(w.env.KIT11_DB!);
  try { return f(db); } finally { db.close(); }
}

describe("usage", () => {
  it("with no argument or an unknown one it prints the usage and calls nothing", async () => {
    const w = world();
    expect(await iccCli([], w.io)).toBe(0);
    expect(w.out.join("\n")).toMatch(/^usage: npm run icc -- preflight \| run \| record/);
    expect(await iccCli(["purchase"], w.io)).toBe(2);
    expect(w.err.join("\n")).toMatch(/usage: npm run icc -- preflight \| run \| record/);
    expect(w.standIn.seen).toEqual([]);
    expect(existsSync(w.env.ICC_CALL_LOG!)).toBe(false);
    expect(existsSync(w.env.KIT11_DB!)).toBe(false);
  });
});

describe("the guards: each missing piece refuses by name, with zero calls and no ledger opened", () => {
  const cases: [string, "preflight" | "run", Record<string, string | undefined>, RegExp][] = [
    ["the rail's switch", "preflight", { KIT11_ICC_RAIL: undefined }, /KIT11_ICC_RAIL=on/],
    ["the go", "preflight", { ICC_GO: "no" }, /ICC_GO=yes/],
    ["the go", "run", { ICC_GO: undefined }, /ICC_GO=yes/],
    ["the budget", "run", { ICC_CALL_BUDGET: undefined }, /ICC_CALL_BUDGET/],
    ["the call log", "preflight", { ICC_CALL_LOG: undefined }, /ICC_CALL_LOG/],
    ["a world of its own: the ledger", "run", { KIT11_DB: "/tmp/kit11.sqlite" }, /KIT11_DB must be this world's own ledger/],
    ["a world of its own: the ledger", "preflight", { KIT11_DB: undefined }, /KIT11_DB must be this world's own ledger/],
    ["a world of its own: the keys folder the runner uses", "run", { KIT11_KEYS_DIR: "/tmp/keys/vic-1" }, /KIT11_KEYS_DIR must be this world's own keys folder/],
    ["the organisation", "preflight", { ICC_MERCHANT_ID: undefined }, /ICC_MERCHANT_ID/],
    ["the signing key's ID", "run", { ICC_JWT_KEY_ID: undefined }, /ICC_JWT_KEY_ID/],
    ["the signing key's file", "preflight", { ICC_JWT_PRIVATE_KEY_FILE: undefined }, /ICC_JWT_PRIVATE_KEY_FILE/],
    ["the request certificate", "preflight", { ICC_MLE_REQUEST_CERT_FILE: undefined }, /ICC_MLE_REQUEST_CERT_FILE/],
    ["the response key's ID", "run", { ICC_MLE_RESPONSE_KEY_ID: undefined }, /ICC_MLE_RESPONSE_KEY_ID/],
    ["the response key's file", "run", { ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: undefined }, /ICC_MLE_RESPONSE_PRIVATE_KEY_FILE/],
    ["the card's token", "preflight", { ICC_INSTRUMENT_IDENTIFIER_ID: undefined }, /ICC_INSTRUMENT_IDENTIFIER_ID/],
    ["the assurance file", "run", { ICC_ASSURANCE_FILE: undefined }, /ICC_ASSURANCE_FILE/],
    ["a production host", "preflight", { ICC_HOST: ["api", "cybersource", "com"].join(".") }, /ICC_HOST/],
    ["an unknown scheme", "run", { ICC_AUTH_SCHEME: "basic" }, /ICC_AUTH_SCHEME/],
  ];
  for (const [what, cmd, over, why] of cases) {
    it(`${cmd}: ${what}`, async () => {
      const w = world(over);
      expect(await iccCli([cmd], w.io)).toBe(2);
      expect(w.err.join("\n")).toMatch(why);
      expect(w.err.join("\n")).toContain("nothing was called");
      expect(w.standIn.seen).toEqual([]);
      expect(calls(w)).toEqual([]);
      if (over.KIT11_DB === undefined || !/icc[^/]*\.sqlite$/.test(over.KIT11_DB)) expect(existsSync(join(w.dir, "icc-test.sqlite"))).toBe(false);
      expectNothingPrinted(w);
    });
  }

  it("asks for the names of the chosen scheme only: a shared secret instead of the signing key", async () => {
    const w = world({ ICC_AUTH_SCHEME: "jwt-shared-secret", ICC_JWT_KEY_ID: undefined, ICC_JWT_PRIVATE_KEY_FILE: undefined });
    expect(await iccCli(["preflight"], w.io)).toBe(2);
    const text = w.err.join("\n");
    expect(text).toMatch(/ICC_KEY_ID/);
    expect(text).toMatch(/ICC_SHARED_SECRET/);
    expect(text).not.toMatch(/ICC_JWT_KEY_ID|ICC_JWT_PRIVATE_KEY_FILE/);
    expect(w.standIn.seen).toEqual([]);
  });

  it("reads no other rail's live variables: their absence changes nothing", async () => {
    const w = world();
    for (const name of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "METAL_RPC_URL", "KIT11_AIRI_RAIL"]) expect(w.env[name]).toBeUndefined();
    expect(await iccCli(["preflight"], w.io)).toBe(0);
  });
});

describe("preflight", () => {
  it("checks locally, then makes one read (no tokenized card set): no purchase, nothing but GET", async () => {
    const w = world();
    expect(await iccCli(["preflight"], w.io)).toBe(0);
    expect(w.standIn.seen.map((s) => `${s.method} ${s.op}`)).toEqual(["GET instrument"]);
    expect(calls(w).map((c) => `${c.method} ${c.endpoint}`)).toEqual(["GET /tms/v1/instrumentidentifiers/{id}"]);
    const text = w.out.join("\n");
    for (const check of ["environment", "key files", "keys", "serial number", "clock", "assurance file", "read 1"]) expect(text).toMatch(new RegExp(`^ok {4}${check} `, "m"));
    expect(text).toMatch(/^skip {2}read 2 .*ICC_TOKENIZED_CARD_ID is not set/m);
    expect(text).toContain(ICC_PREFLIGHT_NOTE);
    expect(ICC_PREFLIGHT_NOTE).toMatch(/cannot show whether the Intelligent Commerce operations are switched on/);
    expect(text).toMatch(/state ACTIVE/);
    expectNothingPrinted(w);
    // Recorded for the record: the checks, no values.
    const row = withDb(w, (db) => db.prepare("SELECT payload_json FROM audit_log WHERE event = 'icc.preflight'").get() as { payload_json: string });
    expect(JSON.parse(row.payload_json)).toMatchObject({ ok: true, calls: 1, checks: expect.arrayContaining([{ name: "read 1", ok: true, detail: expect.stringMatching(/HTTP 200/) }]) });
    for (const v of [...w.values, ...Object.values(PRIVATE)]) expect(row.payload_json).not.toContain(v);
    expect(withDb(w, (db) => db.prepare("SELECT COUNT(*) AS n FROM proposals").get())).toEqual({ n: 0 });
  });

  it("makes at most two reads: the tokenized card as well when its ID is set", async () => {
    const w = world({ ICC_TOKENIZED_CARD_ID: ["tok", "card", "0042"].join("-") });
    w.values.push(w.env.ICC_TOKENIZED_CARD_ID!);
    expect(await iccCli(["preflight"], w.io)).toBe(0);
    expect(w.standIn.seen.map((s) => `${s.method} ${s.op}`)).toEqual(["GET instrument", "GET tokenized-card"]);
    expect(calls(w)).toHaveLength(2);
    expect(calls(w).every((c) => c.method === "GET")).toBe(true);
    expectNothingPrinted(w);
  });

  it("names the missing assurance fields by field name, never a value, and fails", async () => {
    const w = world();
    writeFileSync(w.env.ICC_ASSURANCE_FILE!, JSON.stringify(assurance({ identity: false })), { mode: 0o600 });
    expect(await iccCli(["preflight"], w.io)).toBe(1);
    expect(w.out.join("\n")).toMatch(/^FAIL {2}assurance file .*assuranceData\[\]\.authenticatedIdentities\.id/m);
    expectNothingPrinted(w);
  });

  it("refuses a key file others can read: no call at all", async () => {
    const w = world();
    chmodSync(w.env.ICC_JWT_PRIVATE_KEY_FILE!, 0o644);
    expect(await iccCli(["preflight"], w.io)).toBe(1);
    expect(w.out.join("\n")).toMatch(/^FAIL {2}key files .*ICC_JWT_PRIVATE_KEY_FILE.*readable by others/m);
    expect(w.out.join("\n")).toMatch(/^skip {2}read 1 /m);
    expect(w.standIn.seen).toEqual([]);
    expect(calls(w)).toEqual([]);
    expectNothingPrinted(w);
  });

  it("a refused read is reported with its status and the second read is not made", async () => {
    const w = world({ ICC_TOKENIZED_CARD_ID: ["tok", "card", "0042"].join("-") });
    w.standIn.errorNext("instrument", 401, "UNAUTHENTICATED");
    expect(await iccCli(["preflight"], w.io)).toBe(1);
    expect(w.out.join("\n")).toMatch(/^FAIL {2}read 1 .*401/m);
    expect(w.out.join("\n")).toMatch(/^skip {2}read 2 .*read 1 failed/m);
    expect(w.standIn.seen).toHaveLength(1);
    expect(w.out.join("\n")).not.toContain(w.standIn.errorMessage);
  });
});

describe("run", () => {
  it("A through the whole flow after the CFO's passkey, then B above the limit refused before any call", async () => {
    const w = world();
    await enrol(w);
    expect(await iccCli(["run"], w.io)).toBe(0);
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create", "credentials"]);
    expect(calls(w).map((c) => `${c.method} ${c.endpoint}`)).toEqual(["POST /icc/v1/instructions", "POST /icc/v1/instructions/{id}/credentials"]);
    const text = w.out.join("\n");
    expect(text).toMatch(/^A {5}12\.00 EUR at Northwind Outdoor test shop: filed as P-\d+; it waits for the CFO's passkey over its exact terms$/m);
    expect(text).toMatch(/^A {5}P-\d+ EXECUTED: credential received, not used; no payment was made$/m);
    expect(text).toMatch(/^B {5}250\.00 EUR at Northwind Outdoor test shop: refused by Purser before any call \(PURSER_ABOVE_HARD_CAP\); 0 calls$/m);
    for (const check of ["a_waited_for_cfo", "a_cfo_signed_exact_terms", "a_credential_received_not_used", "a_two_calls", "b_refused_before_any_call", "nothing_paid"]) expect(text).toMatch(new RegExp(`^ok {4}${check} `, "m"));
    expect(text).toMatch(/^ICC run: every check passed$/m);
    expectNothingPrinted(w);
    withDb(w, (db) => {
      expect(db.prepare("SELECT status FROM icc_purchases").all()).toEqual([{ status: "CREDENTIAL_RECEIVED_NOT_USED" }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
      const approved = db.prepare("SELECT method FROM approvals").get() as { method: string };
      expect(approved.method).toBe("passkey");
    });
  });

  it("refuses without an enrolled passkey: the CFO's passkey is the only way to approve, and nothing is called", async () => {
    const w = world();
    expect(await iccCli(["run"], w.io)).toBe(2);
    expect(w.err.join("\n")).toMatch(/no passkey is enrolled in this ledger/);
    expect(w.standIn.seen).toEqual([]);
    expect(withDb(w, (db) => db.prepare("SELECT COUNT(*) AS n FROM proposals").get())).toEqual({ n: 0 });
  });

  it("runs once per ledger: a second run is refused before anything is filed or called", async () => {
    const w = world();
    await enrol(w);
    expect(await iccCli(["run"], w.io)).toBe(0);
    w.err.length = 0;
    expect(await iccCli(["run"], w.io)).toBe(2);
    expect(w.err.join("\n")).toMatch(/already holds an ICC run/);
    expect(w.standIn.seen).toHaveLength(2);
    expect(withDb(w, (db) => db.prepare("SELECT COUNT(*) AS n FROM proposals").get())).toEqual({ n: 1 });
  });

  it("exits non-zero when a check fails: A's credential answered as pending", async () => {
    const w = world();
    await enrol(w);
    w.standIn.pendingNext("credentials");
    expect(await iccCli(["run"], w.io)).toBe(1);
    const text = w.out.join("\n");
    expect(text).toMatch(/^FAIL {2}a_credential_received_not_used /m);
    expect(text).toMatch(/^ok {4}b_refused_before_any_call /m);
    expect(text).toMatch(/^ICC run: 1 check\(s\) failed/m);
  });

  it("exits non-zero when B is not refused (a plan whose B is within the limit), and B still makes no call", async () => {
    const w = world();
    await enrol(w);
    expect(await iccCli(["run"], { ...w.io, plan: { b: { amount: "15.00" } } })).toBe(1);
    expect(w.out.join("\n")).toMatch(/^FAIL {2}b_refused_before_any_call /m);
    expect(w.standIn.seen.map((s) => s.op)).toEqual(["create", "credentials"]);
  });

  it("without the runner's answer in time the wait ends and says so", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0009', 'icc_purchase', '{}', ?, 'sourcing', 'PENDING_APPROVAL', ?, ?)").run("0".repeat(64), T0.toISOString(), T0.toISOString());
    let t = 0;
    const said: string[] = [];
    const end = await waitForOutcome(db, "P-0009", { log: (l) => said.push(l), now: () => t, sleep: async (ms) => { t += ms; }, waitMs: 5 * 60_000, pollMs: 30_000 });
    expect(end).toBe("still PENDING_APPROVAL after 5 min");
    expect(said.length).toBeGreaterThan(0);
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0009'").run();
    expect(await waitForOutcome(db, "P-0009", { log: () => {}, now: () => 0, sleep: async () => {} })).toBe("EXECUTED");
  });
});

describe("record", () => {
  it("writes <the run's date>-icc.md and .json from the audit rows and the call log only, and they hold no secret", async () => {
    const w = world({ ICC_TOKENIZED_CARD_ID: ["tok", "card", "0042"].join("-") });
    await enrol(w);
    expect(await iccCli(["preflight"], w.io)).toBe(0);
    expect(await iccCli(["run"], w.io)).toBe(0);
    // The record command needs no go and no keys: only this world's ledger and its call log.
    const recordIo: IccCliIo = { ...w.io, env: { KIT11_DB: w.env.KIT11_DB, ICC_CALL_LOG: w.env.ICC_CALL_LOG }, now: () => new Date("2026-12-24T08:00:00Z") };
    expect(await iccCli(["record"], recordIo)).toBe(0);
    expect(readdirSync(w.io.recordDir!).sort()).toEqual(["2026-10-01-icc.json", "2026-10-01-icc.md"]);
    const json = readFileSync(join(w.io.recordDir!, "2026-10-01-icc.json"), "utf8");
    const md = readFileSync(join(w.io.recordDir!, "2026-10-01-icc.md"), "utf8");
    const rec = readIccRunRecord(json);

    // The numbers are the rows' and the log's.
    const log = readCallLog(w.env.ICC_CALL_LOG!);
    expect(rec.run_date).toBe("2026-10-01");
    expect(rec.environment).toBe("sandbox");
    expect(rec.calls).toEqual({ total: log.length, budget: 5, by_endpoint: countByEndpoint(log) });
    expect(rec.calls.total).toBe(4);
    const facts = withDb(w, (db) => ({
      row: db.prepare("SELECT proposal_id, terms_sha256, instruction_id FROM icc_purchases").get() as { proposal_id: string; terms_sha256: string; instruction_id: string },
      refused: JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'icc.purchase_refused' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string }).payload_json) as { code: string },
      started: JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'icc.purchase_started'").get() as { payload_json: string }).payload_json) as { amount: string; currency: string; merchant: string },
    }));
    expect(rec.purchases).toEqual([
      { label: "A", amount: facts.started.amount, currency: facts.started.currency, merchant: facts.started.merchant, terms_sha256: facts.row.terms_sha256, instruction_id: facts.row.instruction_id, approved_with: "passkey", outcome: "credential received, not used; no payment was made", refusal_code: null },
      { label: "B", amount: "250.00", currency: "EUR", merchant: "Northwind Outdoor test shop", terms_sha256: null, instruction_id: null, approved_with: null, outcome: "refused by Purser before any call", refusal_code: facts.refused.code },
    ]);
    expect(facts.refused.code).toBe("PURSER_ABOVE_HARD_CAP");
    expect(rec.checks.filter((c) => c.stage === "preflight").map((c) => c.name)).toEqual(["environment", "key files", "keys", "serial number", "clock", "assurance file", "read 1", "read 2"]);
    expect(rec.checks.filter((c) => c.stage === "run").every((c) => c.ok)).toBe(true);
    expect(rec.not_done).toEqual(expect.arrayContaining([expect.stringMatching(/^No payment was made/), expect.stringMatching(/^No confirmation was sent/), expect.stringMatching(/^No instruction was read back from Visa/)]));

    // What the files say, and what they never hold.
    expect(md).toContain("credential received, not used; no payment was made");
    expect(md).toContain(facts.row.instruction_id);
    expect(md).toContain("| POST /icc/v1/instructions | 1 |");
    for (const text of [json, md]) {
      for (const v of [...w.values, ...Object.values(PRIVATE), w.env.ICC_TOKENIZED_CARD_ID!]) expect(text, v).not.toContain(v);
      expect(text).not.toContain(w.standIn.credential.authorization);
      expect(text).not.toContain(w.standIn.credential.signedPayload);
      expect(text).not.toContain(w.standIn.maskedNumber);
      expect(text).not.toMatch(/\b\d{13,19}\b|-----BEGIN|\bBearer\b|eyJ[\w-]{10,}|signedPayload|authorization"|assuranceData|deviceInformation/);
      expect(text).not.toMatch(/Visa (approved|certified|endorsed)|Cybersource (approved|certified|endorsed)/i);
    }
  });

  it("refuses when the ledger holds no ICC run, and writes nothing", async () => {
    const w = world();
    withDb(w, () => undefined);
    expect(await iccCli(["record"], { ...w.io, env: { KIT11_DB: w.env.KIT11_DB, ICC_CALL_LOG: w.env.ICC_CALL_LOG } })).toBe(2);
    expect(w.err.join("\n")).toMatch(/this ledger holds no ICC run; nothing was written/);
    expect(existsSync(w.io.recordDir!)).toBe(false);
  });

  it("refuses another world's ledger and a missing call log by name", async () => {
    const w = world();
    expect(await iccCli(["record"], { ...w.io, env: { KIT11_DB: "/tmp/kit11.sqlite" } })).toBe(2);
    expect(w.err.join("\n")).toMatch(/KIT11_DB must be this world's own ledger/);
    expect(w.err.join("\n")).toMatch(/ICC_CALL_LOG/);
  });
});

describe("docs/runs", () => {
  it("holds no ICC record: nothing has run, and the page shows a run only when such a file exists", () => {
    expect(readdirSync(new URL("../docs/runs/", import.meta.url)).filter((f) => /-icc\./.test(f))).toEqual([]);
  });
});

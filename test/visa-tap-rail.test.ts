// D25, the rail behind KIT11_TAP_RAIL=on: the Sourcing agent's card purchase from Packwise (the card-only merchant we
// run, simulated) is signed with TAP (signature 1) and our body signature (signature 2), checked by our merchant layer
// against our pinned keys, and only then charged to the agent's own Airwallex card (here the stand-in). D24's origin
// carries the TAP keyId and nonce, our two verdicts and the Airwallex authorisation id. Off, nothing changes.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { setupCards } from "../src/policy/cards.js";
import { parseOrigin, withOrigin, type Origin } from "../src/provenance/origin.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { registerAgent, revokeAgent } from "../src/visa/tap.js";
import { buySoftwareOnCard, loadTapSigner, TAP_RAIL_MERCHANT, tapRailOn, type TapSigner } from "../src/visa/tapRail.js";
import { ed25519FromSeed } from "../src/visa/tapSig.js";

const now = new Date("2026-11-02T10:00:00Z");
const NOW_S = Math.floor(now.getTime() / 1000);
const ON = { KIT11_TAP_RAIL: "on" };
const agentOrigin: Origin = { actor: "agent", agent: "sourcing", model: "claude-haiku-5-5", request_id: "req_1", run_id: "run_1" };
let db: DB, awx: FakeIssuing, sourcing: TapSigner, support: TapSigner;

const signer = (agent: string, n: number): TapSigner => ({ agent, keyId: `${agent}-rail-key-${n}`, privateKey: ed25519FromSeed(Buffer.alloc(32, n)).privateKey });
const pin = (s: TapSigner) => registerAgent(db, { agent: s.agent, keyid: s.keyId, publicJwk: ed25519FromSeed(Buffer.alloc(32, Number(s.keyId.slice(-1)))).publicKey.export({ format: "jwk" }), domains: [TAP_RAIL_MERCHANT.authority], notAfter: NOW_S + 86_400 });
const originOf = (event: string) => db.prepare("SELECT json_extract(payload_json, '$.origin') AS o FROM audit_log WHERE event = ? ORDER BY seq DESC LIMIT 1").get(event) as { o: string } | undefined;
const events = (prefix: string) => (db.prepare("SELECT event FROM audit_log WHERE event LIKE ? ORDER BY seq").all(`${prefix}%`) as { event: string }[]).map((r) => r.event);

beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeIssuing();
  await setupCards(db, awx, now);
  sourcing = signer("sourcing", 1);
  support = signer("support", 2);
  pin(sourcing);
  pin(support);
});

describe("KIT11_TAP_RAIL off (the default)", () => {
  it("is off unless set to on", () => {
    expect(tapRailOn({})).toBe(false);
    expect(tapRailOn({ KIT11_TAP_RAIL: "1" })).toBe(false);
    expect(tapRailOn(ON)).toBe(true);
  });
  it("charges the card as before: no signer, no TAP check, no tap in the origin", async () => {
    const t = await withOrigin(agentOrigin, () => buySoftwareOnCard(db, awx, "packwise-starter", { env: {}, now, signer: () => { throw new Error("the signer must not be asked"); } }));
    expect(t.approved).toBe(true);
    expect(events("tap.")).toEqual([]);
    expect(JSON.parse(originOf("card.charge_approved")!.o)).toEqual(agentOrigin);
  });
});

describe("KIT11_TAP_RAIL=on", () => {
  it("signs, verifies both signatures, then charges; the origin carries keyId, nonce, both verdicts and the authorisation id", async () => {
    const t = await withOrigin(agentOrigin, () => buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing }));
    expect(t.approved).toBe(true);
    expect(awx.calls.filter((c) => c === "charge")).toHaveLength(1);
    expect(events("tap.")).toEqual(["tap.checkout_verified"]);
    const nonce = (db.prepare("SELECT nonce FROM tap_rail_nonces WHERE keyid = ?").get(sourcing.keyId) as { nonce: string }).nonce;
    const started = parseOrigin(originOf("card.purchase_started")!.o);
    expect(started).toEqual({ ...agentOrigin, tap: { key_id: sourcing.keyId, nonce, sig1: "verified", sig2: "verified" } });
    const charged = parseOrigin(originOf("card.charge_approved")!.o);
    expect(charged).toEqual({ ...agentOrigin, tap: { key_id: sourcing.keyId, nonce, sig1: "verified", sig2: "verified", authorization_id: t.transactionId } });
  });

  it("without an agent's run around it, code's origin names the rail", async () => {
    const t = await buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing });
    expect(parseOrigin(originOf("card.charge_approved")!.o)).toMatchObject({ actor: "code", rule: expect.stringMatching(/TAP/), agent: "sourcing", tap: { key_id: sourcing.keyId, authorization_id: t.transactionId } });
  });

  it("over the card's limit: TAP passes, Airwallex declines, and the decline's origin still carries the evidence", async () => {
    const t = await withOrigin(agentOrigin, () => buySoftwareOnCard(db, awx, "packwise-pro", { env: ON, now, signer: () => sourcing }));
    expect(t).toMatchObject({ approved: false, failureReason: expect.stringMatching(/LIMIT/) });
    expect(parseOrigin(originOf("card.charge_declined")!.o)).toMatchObject({ tap: { sig1: "verified", sig2: "verified", authorization_id: t.transactionId } });
  });

  it("charges nothing when the merchant refuses the signature (a key not pinned, a revoked key)", async () => {
    const stranger = signer("sourcing", 3);
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => stranger })).rejects.toThrow(/refused.*unknown key.*nothing was charged/);
    revokeAgent(db, sourcing.keyId, now);
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing })).rejects.toThrow(/revoked/);
    expect(awx.calls).not.toContain("charge");
    expect(events("tap.")).toEqual(["tap.checkout_refused", "tap.checkout_refused"]);
    expect(events("card.")).not.toContain("card.purchase_started");
  });

  it("refuses an agent signing for another agent's card", async () => {
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => support })).rejects.toThrow(/Support agent may not pay with the Sourcing agent's card/);
    expect(awx.calls).not.toContain("charge");
  });

  it("still leaves Airwallex's own controls in place: Packwise on the support card passes TAP, and Airwallex declines it", async () => {
    const t = await buySoftwareOnCard(db, awx, "packwise-on-support-card", { env: ON, now, signer: () => support });
    expect(events("tap.")).toEqual(["tap.checkout_verified"]);
    expect(t.approved).toBe(false); // the MCC control on the support card
  });

  it("leaves purchases from other merchants on the plain card path", async () => {
    const t = await buySoftwareOnCard(db, awx, "replyhub-starter", { env: ON, now, signer: () => { throw new Error("the signer must not be asked"); } });
    expect(t.approved).toBe(true);
    expect(events("tap.")).toEqual([]);
  });
});

describe("the agent's signing key", () => {
  it("is read from its key file (the one npm run visa -- setup writes), private half never in the ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "tap-key-"));
    const k = ed25519FromSeed(Buffer.alloc(32, 9));
    const file = join(dir, "tap-sourcing.key.json");
    writeFileSync(file, JSON.stringify({ keyid: "sourcing-file-key", privateJwk: k.privateKey.export({ format: "jwk" }), publicJwk: k.publicKey.export({ format: "jwk" }) }), { mode: 0o600 });
    const s = loadTapSigner("sourcing", file);
    expect(s).toMatchObject({ agent: "sourcing", keyId: "sourcing-file-key" });
    expect(s.privateKey.asymmetricKeyType).toBe("ed25519");
  });
});

describe("D24 origin with TAP evidence", () => {
  it("accepts the evidence on an agent's, the CFO's and code's origin, and nothing extra in it", () => {
    const tap = { key_id: "k-1", nonce: "n".repeat(20), sig1: "verified", sig2: "verified", authorization_id: "auth_1" };
    expect(parseOrigin(JSON.stringify({ ...agentOrigin, tap }))).toEqual({ ...agentOrigin, tap });
    expect(parseOrigin(JSON.stringify({ actor: "code", rule: "r", tap }))).toEqual({ actor: "code", rule: "r", tap });
    expect(parseOrigin(JSON.stringify({ ...agentOrigin, tap: { ...tap, proxy: "200" } }))).toBeNull();
    expect(parseOrigin(JSON.stringify({ actor: "external", party: "merchant", tap }))).toBeNull();
  });
});

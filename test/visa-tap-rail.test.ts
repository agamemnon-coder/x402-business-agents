// D25, the rail behind KIT11_TAP_RAIL=on: the Sourcing agent's card purchase from Packwise (the card-only merchant we
// run, simulated) is signed with TAP (signature 1) and our body signature (signature 2), checked by our merchant layer
// against our pinned keys, and only then charged to the agent's own Airwallex card (here the stand-in). D24's origin
// carries the TAP keyId and nonce, our two verdicts and the Airwallex authorisation id. Off, nothing changes.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { setupCards } from "../src/policy/cards.js";
import { parseOrigin, withOrigin, type Origin } from "../src/provenance/origin.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { registerAgent, revokeAgent } from "../src/visa/tap.js";
import { buySoftwareOnCard, inProcessTransport, loadTapSigner, proxyTransport, TAP_RAIL_MERCHANT, tapRailOn, transportFromEnv, type Delivery, type TapSigner, type TapTransport } from "../src/visa/tapRail.js";
import { rawHeadersOf, verifyTapCheckout, type TapMerchantVerdict } from "../src/visa/tapMerchant.js";
import type { TapHeaders } from "../src/visa/tapSig.js";
import { startTapMerchant, type TapMerchantServer } from "../src/visa/tapServer.js";
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
    expect(charged).toEqual({ ...agentOrigin, tap: { key_id: sourcing.keyId, nonce, sig1: "verified", sig2: "verified", awx_transaction_id: t.transactionId } });
  });

  it("without an agent's run around it, code's origin names the rail", async () => {
    const t = await buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing });
    expect(parseOrigin(originOf("card.charge_approved")!.o)).toMatchObject({ actor: "code", rule: expect.stringMatching(/TAP/), agent: "sourcing", tap: { key_id: sourcing.keyId, awx_transaction_id: t.transactionId } });
  });

  it("over the card's limit: TAP passes, Airwallex declines, and the decline's origin still carries the evidence", async () => {
    const t = await withOrigin(agentOrigin, () => buySoftwareOnCard(db, awx, "packwise-pro", { env: ON, now, signer: () => sourcing }));
    expect(t).toMatchObject({ approved: false, failureReason: expect.stringMatching(/LIMIT/) });
    expect(parseOrigin(originOf("card.charge_declined")!.o)).toMatchObject({ tap: { sig1: "verified", sig2: "verified", awx_transaction_id: t.transactionId } });
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
    const tap = { key_id: "k-1", nonce: "n".repeat(20), sig1: "verified", sig2: "verified", awx_transaction_id: "auth_1" };
    expect(parseOrigin(JSON.stringify({ ...agentOrigin, tap }))).toEqual({ ...agentOrigin, tap });
    expect(parseOrigin(JSON.stringify({ actor: "code", rule: "r", tap }))).toEqual({ actor: "code", rule: "r", tap });
    expect(parseOrigin(JSON.stringify({ ...agentOrigin, tap: { ...tap, proxy: "200" } }))).toBeNull();
    expect(parseOrigin(JSON.stringify({ actor: "external", party: "merchant", tap }))).toBeNull();
  });
});

describe("review S1 and S5: the rail trusts no verdict on its own", () => {
  const forgedVerdict = (headers: TapHeaders): TapMerchantVerdict => {
    const nonce = /nonce="([^"]+)"/.exec(headers["signature-input"])![1]!;
    return { ok: true, agent: "sourcing", keyId: sourcing.keyId, nonce, created: NOW_S, expires: NOW_S + 300, sig1: "verified", sig2: "verified", order: { plan: "packwise-starter", amount: "19.99", currency: "EUR", amountCents: 1999 } };
  };
  const charges = () => awx.calls.filter((c) => c === "charge").length;

  it("charges nothing on a forged verdict: our merchant never stored that nonce", async () => {
    const forged: TapTransport = { kind: "in-process", config: inProcessTransport(db).config, deliver: async ({ headers }) => ({ proxyStatus: null, verdict: forgedVerdict(headers) }) };
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: forged })).rejects.toThrow(/no record of accepting/);
    expect(charges()).toBe(0);
  });

  it("charges nothing on a stale verdict from an earlier, accepted request", async () => {
    const real = inProcessTransport(db);
    let kept: Delivery | null = null;
    const recording: TapTransport = { ...real, deliver: async (r) => (kept = await real.deliver(r)) };
    await buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: recording });
    expect(charges()).toBe(1);
    const stale: TapTransport = { ...real, deliver: async () => kept! };
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: stale })).rejects.toThrow(/not about this request/);
    expect(charges()).toBe(1);
  });

  it("charges nothing through the proxy unless the proxy answered 200", async () => {
    const config = proxyTransport("http://127.0.0.1:1").config;
    db.prepare("UPDATE tap_agents SET domains_json = ?").run(JSON.stringify([config.authority]));
    const viaProxy: TapTransport = {
      kind: "reference-proxy", config,
      deliver: async ({ headers, body, now: n }) => ({ proxyStatus: 422, verdict: verifyTapCheckout(db, { method: "POST", target: config.checkoutPath, rawHeaders: rawHeadersOf(headers as unknown as Record<string, string>), body: Buffer.from(body) }, config, n) }),
    };
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: viaProxy })).rejects.toThrow(/proxy answered 422, not 200/);
    expect(charges()).toBe(0);
  });

  it("charges nothing when the merchant's verified order is not this purchase (another plan or amount)", async () => {
    const real = inProcessTransport(db);
    for (const swap of [{ plan: "packwise-pro" }, { amountCents: 100 }, { currency: "USD" as "EUR" }]) {
      const altered: TapTransport = { ...real, deliver: async (r) => {
        const d = await real.deliver(r);
        return d.verdict?.ok && d.verdict.order ? { ...d, verdict: { ...d.verdict, order: { ...d.verdict.order, ...swap } } } : d;
      } };
      await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: altered })).rejects.toThrow(/no order matching/);
    }
    expect(charges()).toBe(0);
  });

  it("charges the order the merchant verified: plan, amount and currency signed in the body", async () => {
    let body = "";
    const real = inProcessTransport(db);
    const seen: TapTransport = { ...real, deliver: async (r) => { body = r.body; return real.deliver(r); } };
    const t = await buySoftwareOnCard(db, awx, "packwise-starter", { env: ON, now, signer: () => sourcing, transport: seen });
    expect(JSON.parse(body)).toEqual({ plan: "packwise-starter", amount: "19.99", currency: "EUR" });
    expect(t).toMatchObject({ approved: true, amountCents: 1999, currency: "EUR" });
  });
});

describe("Packwise's checkout server binds every address it is given", () => {
  it("fails when a requested address is taken, instead of serving on the others", async () => {
    const squatter = createServer();
    await new Promise<void>((ok) => squatter.listen(0, "127.0.0.1", () => ok()));
    const port = (squatter.address() as AddressInfo).port;
    await expect(startTapMerchant(db, inProcessTransport(db).config, { port, hosts: ["127.0.0.1"] })).rejects.toThrow(/could not listen on 127\.0\.0\.1.*EADDRINUSE/);
    await new Promise<void>((ok) => squatter.close(() => ok()));
  });
});

describe("through the reference proxy (KIT11_TAP_PROXY), with a pass-through stand-in for the proxy and our real merchant server", () => {
  let proxy: Server, merchant: TapMerchantServer, refuseWith: string | null, proxyUrl: string;
  beforeEach(async () => {
    refuseWith = null;
    let target = 0;
    proxy = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        // The reference proxy answers 403 itself when it refuses; otherwise it forwards with Host rewritten (changeOrigin).
        if (refuseWith) return void res.writeHead(403, { "content-type": "text/html" }).end(`<html><head><title>${refuseWith}</title></head></html>`);
        const f = request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${target}` } }, (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        });
        f.end(Buffer.concat(chunks));
      });
    });
    await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", () => ok()));
    const port = (proxy.address() as AddressInfo).port;
    proxyUrl = `http://127.0.0.1:${port}`;
    const t = proxyTransport(proxyUrl);
    merchant = await startTapMerchant(db, t.config, { port: 0, hosts: ["127.0.0.1"], now: () => NOW_S + 1 });
    target = merchant.port;
    db.prepare("UPDATE tap_agents SET domains_json = ?").run(JSON.stringify([TAP_RAIL_MERCHANT.authority, `127.0.0.1:${port}`]));
  });
  afterEach(async () => {
    await merchant.close();
    await new Promise<void>((ok) => proxy.close(() => ok()));
  });

  it("only takes a loopback proxy", () => {
    expect(() => proxyTransport("http://proxy.example:3001")).toThrow(/this machine/);
    expect(() => proxyTransport("https://localhost:3001")).toThrow(/this machine/);
    expect(transportFromEnv(db, {}).kind).toBe("in-process");
    expect(transportFromEnv(db, { KIT11_TAP_PROXY: "http://localhost:3001" }).kind).toBe("reference-proxy");
  });

  it("charges after the proxy passed it and our merchant accepted it; the origin records the proxy's 200", async () => {
    const t = await withOrigin(agentOrigin, () => buySoftwareOnCard(db, awx, "packwise-starter", { env: { ...ON, KIT11_TAP_PROXY: proxyUrl }, now, signer: () => sourcing }));
    expect(t.approved).toBe(true);
    expect(parseOrigin(originOf("card.charge_approved")!.o)).toMatchObject({ actor: "agent", tap: { key_id: sourcing.keyId, proxy_status: 200, sig1: "verified", sig2: "verified", awx_transaction_id: t.transactionId } });
  });

  it("charges nothing when the proxy itself refuses (403), and says so", async () => {
    refuseWith = "Key Not Found";
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: { ...ON, KIT11_TAP_PROXY: proxyUrl }, now, signer: () => sourcing })).rejects.toThrow(/reference proxy answered 403 \(Key Not Found\).*nothing was charged/);
    expect(awx.calls).not.toContain("charge");
    const row = db.prepare("SELECT json_extract(payload_json, '$.proxy_status') AS s FROM audit_log WHERE event = 'tap.checkout_refused'").get() as { s: number };
    expect(row.s).toBe(403);
  });

  it("charges nothing when the proxy passes it and our merchant refuses it (key not pinned for this authority)", async () => {
    db.prepare("UPDATE tap_agents SET domains_json = ?").run(JSON.stringify([TAP_RAIL_MERCHANT.authority]));
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: { ...ON, KIT11_TAP_PROXY: proxyUrl }, now, signer: () => sourcing })).rejects.toThrow(/not pinned for 127\.0\.0\.1/);
    expect(awx.calls).not.toContain("charge");
  });

  it("charges nothing when the proxy is not running", async () => {
    await expect(buySoftwareOnCard(db, awx, "packwise-starter", { env: { ...ON, KIT11_TAP_PROXY: "http://127.0.0.1:9" }, now, signer: () => sourcing })).rejects.toThrow(/not reached/);
    expect(awx.calls).not.toContain("charge");
  });
});

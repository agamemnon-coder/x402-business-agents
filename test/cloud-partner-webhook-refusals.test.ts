// Airwallex's partner_connection.disconnected webhook and a disconnect (cloud/src/connect.ts), on a stand-in database
// that records every statement. A webhook ends a connection only when it is switched on, signed with the secret,
// fresh, and names well-formed account ids; anything else ends nothing. A disconnect of nothing connected touches nothing.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConnectRefused, disconnect, receivePartnerEvent, type ConnectEnv } from "../cloud/src/connect.js";
import type { Sql } from "../cloud/src/store.js";

const SECRET = "whsec-partner-test-not-a-secret";
const NOW = new Date("2026-11-20T10:00:00Z");

/** A database holding connected Airwallex accounts (account id to company); it records each query and update. */
function standIn(connected: Record<string, string>) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const sql = {
    first: async (q: string, params: unknown[] = []) => {
      seen.push({ sql: q, params });
      if (/FROM oauth_connections WHERE provider = 'airwallex' AND account_ref = \?/.test(q)) {
        const t = connected[String(params[0])];
        return t ? { tenant_id: t } : null;
      }
      return null;
    },
    run: async (q: string, params: unknown[] = []) => { seen.push({ sql: q, params }); return { changes: 1 }; },
    all: async () => [],
  } as unknown as Sql;
  const ended = () => seen.filter((s) => s.sql.startsWith("UPDATE oauth_connections SET status = 'disconnected'")).map((s) => [s.params[2], s.params[1]]);
  return { sql, seen, ended };
}
const env = (secret: string | undefined = SECRET): ConnectEnv => ({ tokenKey: "", clients: {}, fetch: (async () => { throw new Error("no network"); }) as typeof fetch, ...(secret ? { airwallexWebhookSecret: secret } : {}) });
function signed(body: unknown, at = NOW.getTime(), secret = SECRET) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(at);
  return { text, headers: new Headers({ "x-timestamp": ts, "x-signature": createHmac("sha256", secret).update(ts + text).digest("hex") }) };
}
const disconnected = (ids: unknown) => ({ name: "partner_connection.disconnected", data: { account_ids: ids } });
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(ConnectRefused); return { status: (e as ConnectRefused).status, message: (e as Error).message }; }
  throw new Error("expected a refusal");
}

describe("the partner webhook's signature", () => {
  it("answers 404 when partner webhooks are not switched on, and reads nothing", async () => {
    const db = standIn({ acct_companyA0001: "t_a" });
    const { text, headers } = signed(disconnected(["acct_companyA0001"]));
    expect(await refused(receivePartnerEvent(db.sql, env(""), headers, text, NOW))).toEqual({ status: 404, message: "Airwallex partner webhooks are not switched on" });
    expect(db.seen).toEqual([]);
  });

  it("refuses a missing, stale, malformed or other-secret signature, and ends nothing", async () => {
    const db = standIn({ acct_companyA0001: "t_a" });
    const body = disconnected(["acct_companyA0001"]);
    const cases: Headers[] = [
      new Headers(),
      signed(body, NOW.getTime() - 6 * 60_000).headers,
      signed(body, NOW.getTime() + 6 * 60_000).headers,
      signed(body, NOW.getTime(), "another-secret").headers,
      new Headers({ "x-timestamp": "soon", "x-signature": "0".repeat(64) }),
      new Headers({ "x-timestamp": String(NOW.getTime()), "x-signature": "not-hex" }),
    ];
    for (const h of cases) expect(await refused(receivePartnerEvent(db.sql, env(), h, JSON.stringify(body), NOW))).toEqual({ status: 401, message: "bad or missing webhook signature" });
    // A signature over another body.
    expect((await refused(receivePartnerEvent(db.sql, env(), signed(body).headers, JSON.stringify(disconnected(["acct_companyB0002"])), NOW))).status).toBe(401);
    expect(db.seen).toEqual([]);
  });

  it("takes an upper-case hex signature", async () => {
    const db = standIn({ acct_companyA0001: "t_a" });
    const { text, headers } = signed(disconnected(["acct_companyA0001"]));
    headers.set("x-signature", headers.get("x-signature")!.toUpperCase());
    expect(await receivePartnerEvent(db.sql, env(), headers, text, NOW)).toEqual({ ended: 1 });
  });
});

describe("what a signed partner event ends", () => {
  it("ends nothing for a body that is not JSON, another event, or no list of accounts", async () => {
    const db = standIn({ acct_companyA0001: "t_a" });
    for (const body of ["{not json", { name: "partner_connection.connected", data: { account_ids: ["acct_companyA0001"] } }, { name: "partner_connection.disconnected", data: { account_ids: "acct_companyA0001" } }, { name: "partner_connection.disconnected" }]) {
      const { text, headers } = signed(body);
      expect(await receivePartnerEvent(db.sql, env(), headers, text, NOW)).toEqual({ ended: 0 });
    }
    expect(db.seen).toEqual([]);
  });

  it("skips ids that are not account ids and accounts not connected; ends each connected one as ended by the provider", async () => {
    const db = standIn({ acct_companyA0001: "t_a", acct_companyB0002: "t_b" });
    const { text, headers } = signed(disconnected([7, "acct_x", "'; DROP TABLE oauth_connections; --", "acct_unknown0003", "acct_companyA0001", "acct_companyB0002"]));
    expect(await receivePartnerEvent(db.sql, env(), headers, text, NOW)).toEqual({ ended: 2 });
    // Only well-formed ids were looked up.
    expect(db.seen.filter((s) => s.sql.startsWith("SELECT")).map((s) => s.params[0])).toEqual(["acct_unknown0003", "acct_companyA0001", "acct_companyB0002"]);
    expect(db.ended()).toEqual([["t_a", "provider"], ["t_b", "provider"]]);
  });

  it("looks at no more than 100 accounts per event", async () => {
    const db = standIn({});
    const ids = Array.from({ length: 150 }, (_, i) => `acct_bulk${String(i).padStart(4, "0")}`);
    const { text, headers } = signed(disconnected(ids));
    expect(await receivePartnerEvent(db.sql, env(), headers, text, NOW)).toEqual({ ended: 0 });
    expect(db.seen).toHaveLength(100);
  });
});

describe("disconnect", () => {
  it("of a provider not connected answers that nothing was disconnected, and ends nothing", async () => {
    const db = standIn({});
    expect(await disconnect(db.sql, "t_a", "moneybird", env(), NOW)).toEqual({ disconnected: false, revoked_at_provider: false, note: null });
    expect(db.seen.filter((s) => s.sql.startsWith("UPDATE"))).toEqual([]);
  });
});

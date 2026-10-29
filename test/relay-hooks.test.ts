// Airwallex webhooks through the relay (K2): the Worker checks Airwallex's signature (HMAC-SHA256 over the timestamp
// and the raw body) and keeps the event until the runner has it; the runner checks the signature again and records
// the card transaction once. The relay's answer to Airwallex never waits for the runner.
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { handleAirwallexHook } from "../src/policy/cardHooks.js";
import { setupCards } from "../src/policy/cards.js";
import { Relay, type Sql } from "../worker/src/core.js";
import { RelayRunner } from "../src/relay/runner.js";
import { FakeIssuing } from "./fakes/issuing.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const SECRET = ["whsec", "test", "x".repeat(24)].join("_");
const t0 = new Date("2026-11-03T10:00:00Z");

function sqlOver(db: Database.Database): Sql {
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}
const relay = (secret = SECRET) => new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, webhookSecret: secret, now: () => t0 });
const sign = (ts: string, body: string, key = SECRET) => createHmac("sha256", key).update(ts + body).digest("hex");
const hook = (r: Relay, body: string, opts: { ts?: string; sig?: string } = {}) => {
  const ts = opts.ts ?? String(t0.getTime());
  return r.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": opts.sig ?? sign(ts, body) }, body }));
};
const sync = async (r: Relay, extra: Record<string, unknown> = {}) =>
  (await (await r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ state_hash: "h", ...extra }) }))).json()) as { hooks: { id: string; ts: string; signature: string; body: string }[] };

const event = (cardId: string, over: Record<string, unknown> = {}) => JSON.stringify({
  id: "evt-1", name: "issuing.card_transaction_event.failed", account_id: "acct", created_at: t0.toISOString(), version: "2025-11-11",
  data: { object: { card_transaction_id: "ct-9", card_id: cardId, process_result: "DECLINED", failure_reason: "LIMIT_EXCEEDED", transaction_amount: 45, transaction_currency: "EUR", transacted_at: t0.toISOString(), merchant: { name: "Northwind Market Data___", category_code: "5734" }, ...over } },
});

describe("Airwallex webhooks on the relay", () => {
  it("keeps a correctly signed event for the runner until the runner has it", async () => {
    const r = relay();
    const body = event("card-1");
    expect((await hook(r, body)).status).toBe(200);
    expect((await hook(r, body)).status).toBe(200); // Airwallex retries: kept once
    const first = await sync(r);
    expect(first.hooks.map((h) => [h.id, h.body])).toEqual([["evt-1", body]]);
    expect((await sync(r, { hook_acks: ["evt-1"] })).hooks).toEqual([]);
  });

  it("refuses a wrong signature, an old timestamp and a relay without the secret, and keeps nothing", async () => {
    const r = relay();
    const body = event("card-1");
    expect((await hook(r, body, { sig: sign(String(t0.getTime()), body, "wrong") })).status).toBe(401);
    expect((await hook(r, body, { sig: "" })).status).toBe(401);
    const old = String(t0.getTime() - 10 * 60 * 1000);
    expect((await hook(r, body, { ts: old, sig: sign(old, body) })).status).toBe(401);
    expect((await hook(relay(""), body)).status).toBe(503);
    expect((await sync(r)).hooks).toEqual([]);
  });

  it("does not let the webhook route reach anything else", async () => {
    const r = relay();
    expect((await r.fetch(new Request(`${BASE}/hooks/airwallex`))).status).toBe(405);
    expect((await r.fetch(new Request(`${BASE}/hooks/other`, { method: "POST", body: "{}" }))).status).toBe(404);
  });
});

describe("the runner's side of a webhook", () => {
  it("checks the signature again and records the card transaction once", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    await setupCards(db, awx, t0);
    const card = awx.cards[0]!.cardId;
    const body = event(card);
    const ts = String(t0.getTime());
    expect(handleAirwallexHook(db, { id: "evt-1", ts, signature: sign(ts, body), body }, SECRET, t0)).toMatch(/declined 45.00 EUR/);
    expect(handleAirwallexHook(db, { id: "evt-1", ts, signature: sign(ts, body), body }, SECRET, t0)).toMatch(/already recorded/);
    const rows = db.prepare("SELECT transaction_id, approved, source, failure_reason FROM card_transactions").all();
    expect(rows).toEqual([{ transaction_id: "ct-9", approved: 0, source: "webhook", failure_reason: "LIMIT_EXCEEDED" }]);
    // A relay that forges or alters an event gets nowhere.
    expect(handleAirwallexHook(db, { id: "evt-2", ts, signature: sign(ts, body, "relay-made"), body }, SECRET, t0)).toMatch(/signature/);
    expect(handleAirwallexHook(db, { id: "evt-3", ts, signature: sign(ts, event("not-ours")), body: event("not-ours") }, SECRET, t0)).toMatch(/not an agent's card/);
    expect(handleAirwallexHook(db, { id: "evt-4", ts, signature: sign(ts, '{"id":"x","name":"account.active","data":{}}'), body: '{"id":"x","name":"account.active","data":{}}' }, SECRET, t0)).toMatch(/not a card transaction/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get()).toEqual({ n: 1 });
  });
});

describe("runner and relay together", () => {
  it("brings a webhook from the relay into the ledger and then clears it from the relay", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    await setupCards(db, awx, t0);
    const r = relay();
    const log: string[] = [];
    const runner = new RelayRunner({
      db, cfg: { url: BASE, origin: BASE, rpId: "kit11.example.workers.dev", token: TOKEN }, now: () => t0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => r.fetch(new Request(input, init))) as typeof fetch,
      execute: async () => undefined, log: (l) => log.push(l),
      onHook: (h) => handleAirwallexHook(db, h, SECRET, t0),
    });
    expect((await hook(r, event(awx.cards[0]!.cardId))).status).toBe(200);
    await runner.syncOnce();
    expect(log.filter((l) => l.startsWith("hook"))).toEqual(["hook     webhook issuing.card_transaction_event.failed: Airwallex declined 45.00 EUR at Northwind Market Data"]);
    expect(db.prepare("SELECT source FROM card_transactions").all()).toEqual([{ source: "webhook" }]);
    await runner.syncOnce();
    expect((await sync(r)).hooks).toEqual([]);
    expect(log.filter((l) => l.startsWith("hook"))).toHaveLength(1);
  });
});

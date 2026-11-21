// Live with Airwallex (14 Nov): the events feed (worker/src/awxEvents.ts, through the relay's webhook route) and the
// reconciliation badge (src/finance/awxBadge.ts, worker/src/awxBooks.ts), shown on /proof, Home and Purser Cloud's
// Airwallex tab. It holds: only events whose signature verified are kept; only four fields of each (never the body: no
// amounts, names, card numbers, account details); the last 50; a public read-only feed; the badge's three states,
// computed only from a comparison that ran; the 5-minute cache. 0 network: the sandbox is a stand-in here.
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Relay, type Sql } from "../worker/src/core.js";
import { AWX_EVENTS_KEPT, AWX_EVENTS_PATH, sanitizeAwxEvent, awxEventTopic } from "../worker/src/awxEvents.js";
import { AWX_BOOKS_JSON_PATH, AWX_BOOKS_SVG_PATH, awxBooksResponse, booksBadge, booksCache } from "../worker/src/awxBooks.js";
import { RUN_WINDOW } from "../worker/src/awxRead.js";
import { AWX_BADGE_LIST_URL, AWX_BADGE_TTL_MS, AwxBadgeCache, badgeLine, badgeOf, badgeSvg } from "../src/finance/awxBadge.js";
import { awxEventsView, checkEventRow } from "../cloud/src/awxLive.js";
import { AWX_LIVE_ID, AWX_LIVE_JS, awxHomeBadgeHtml, awxLiveHtml } from "../src/redesign/awxLive.js";
import { proofPage } from "../src/redesign/proof.js";
import { homePage } from "../src/redesign/home.js";
import { buildPages } from "../src/relay/assets.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const BASE = "https://kit11.example.workers.dev";
const SECRET = ["whsec", "test", "y".repeat(24)].join("_");
const t0 = new Date("2026-11-14T18:00:00Z");

function sqlOver(db: Database.Database): Sql {
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}
const relay = (o: { secret?: string; now?: () => Date } = {}) => new Relay(sqlOver(new Database(":memory:")), { relayToken: "t".repeat(64), webhookSecret: o.secret ?? SECRET, now: o.now ?? (() => t0) });
const sign = (ts: string, body: string, key = SECRET) => createHmac("sha256", key).update(ts + body).digest("hex");
const post = (r: Relay, body: string, o: { sig?: string } = {}) => {
  const ts = String(t0.getTime());
  return r.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": o.sig ?? sign(ts, body) }, body }));
};
const feed = async (r: Relay) => (await (await r.fetch(new Request(`${BASE}${AWX_EVENTS_PATH}`))).json()) as { events: Record<string, unknown>[]; last_event_at: string | null; receiving: boolean; kept: number };

/** A transfer event as Airwallex sends it, full of fields the feed must never keep. */
const transferEvent = (id = "evt_abc123", over: Record<string, unknown> = {}) => JSON.stringify({
  id, name: "payout.transfer.paid", account_id: "acct_SENSITIVE_ACCOUNT", created_at: "2026-11-14T17:59:30Z", version: "2025-11-11",
  data: { object: { id: "4a0f4c8e-1d1b-4c7a-9a1e-transfer0001", amount: 1234.56, beneficiary: { bank_details: { account_name: "Jane Private", account_number: "NL91ABNA0417164300", iban: "NL91ABNA0417164300" } }, reason: "Invoice AP-1", ...over } },
});
const cardEvent = () => JSON.stringify({
  id: "evt_card_1", name: "issuing.card_transaction_event.failed", created_at: "2026-11-14T17:59:00Z",
  data: { object: { id: "ct_9", card_id: "card-1", card_number: "4111111111111111", cvv: "123", pan: "4111 1111 1111 1111", cardholder: { name: "Jane Private", email: "jane@example.com" }, merchant: { name: "Shop" } } },
});
const SENSITIVE = /acct_SENSITIVE|Jane|NL91ABNA|4111|1234\.56|cvv|card_number|pan|email|amount|beneficiary|iban|AP-1|whsec|signature"/i;

describe("the live Airwallex events feed", () => {
  it("keeps only events whose signature verified", async () => {
    const r = relay();
    expect((await post(r, transferEvent("evt_bad"), { sig: sign(String(t0.getTime()), transferEvent("evt_bad"), "not-the-secret") })).status).toBe(401);
    expect((await post(r, transferEvent("evt_none"), { sig: "" })).status).toBe(401);
    expect((await feed(r)).events).toEqual([]);
    expect((await post(r, transferEvent())).status).toBe(200);
    const f = await feed(r);
    expect(f.events.map((e) => e.event_id)).toEqual(["evt_abc123"]);
    expect(f.events[0]).toMatchObject({ type: "payout.transfer.paid", topic: "Transfer", object_id: "4a0f4c8e-1d1b-4c7a-9a1e-transfer0001", signature_verified: true, received_at: t0.toISOString(), occurred_at: "2026-11-14T17:59:30.000Z" });
    expect(f.last_event_at).toBe(t0.toISOString());
  });

  it("a relay without the webhook secret keeps nothing and says it is not receiving", async () => {
    const r = relay({ secret: "" });
    expect((await post(r, transferEvent())).status).toBe(503);
    expect(await feed(r)).toMatchObject({ events: [], last_event_at: null, receiving: false });
  });

  it("stores no sensitive field: four fields only, never the body", async () => {
    const r = relay();
    await post(r, transferEvent());
    await post(r, cardEvent());
    const f = await feed(r);
    expect(f.events).toHaveLength(2);
    for (const e of f.events) expect(Object.keys(e).sort()).toEqual(["event_id", "object_id", "occurred_at", "received_at", "signature_verified", "topic", "type"]);
    expect(JSON.stringify(f.events)).not.toMatch(SENSITIVE);
    // The card event's object id is the card transaction's id, never a card number.
    expect(f.events.find((e) => e.event_id === "evt_card_1")).toMatchObject({ object_id: "ct_9", topic: "Agent card" });
  });

  it("drops odd shapes instead of storing them", () => {
    expect(sanitizeAwxEvent({ id: "evt<script>", name: "payout.transfer.paid" }, t0)).toBeNull();
    expect(sanitizeAwxEvent({ id: "evt_1", name: "Payout Transfer <b>" }, t0)).toBeNull();
    expect(sanitizeAwxEvent({ id: "evt_1" }, t0)).toBeNull();
    expect(sanitizeAwxEvent({ id: "evt_1", name: "conversion.settled", data: { object: { id: "has spaces" } }, created_at: "not a date" }, t0))
      .toEqual({ event_id: "evt_1", type: "conversion.settled", object_id: null, occurred_at: null, received_at: t0.toISOString(), signature_verified: true });
    expect(awxEventTopic("deposit.settled")).toBe("Money in");
    expect(awxEventTopic("something.else")).toBe("Other");
  });

  it("keeps a retried event once, and only the last 50", async () => {
    let clock = t0.getTime();
    const r = relay({ now: () => new Date(clock) });
    const at = () => String(clock);
    const send = (id: string) => { const b = transferEvent(id); return r.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "x-timestamp": at(), "x-signature": sign(at(), b) }, body: b })); };
    await send("evt_0"); await send("evt_0");
    expect((await feed(r)).events).toHaveLength(1);
    for (let i = 1; i <= 60; i++) { clock += 1000; await send(`evt_${i}`); }
    const f = await feed(r);
    expect(f.events).toHaveLength(AWX_EVENTS_KEPT);
    expect(f.events[0]!.event_id).toBe("evt_60");
    expect(f.events.at(-1)!.event_id).toBe("evt_11");
  });

  it("is read-only and needs no key", async () => {
    const r = relay();
    expect((await r.fetch(new Request(`${BASE}${AWX_EVENTS_PATH}`))).status).toBe(200);
    expect((await r.fetch(new Request(`${BASE}${AWX_EVENTS_PATH}`, { method: "POST", body: "{}" }))).status).toBe(405);
    expect((await r.fetch(new Request(`${BASE}${AWX_EVENTS_PATH}`, { method: "DELETE" }))).status).toBe(405);
  });
});

describe("the events feed in Purser Cloud", () => {
  let c: TestCloud;
  beforeEach(async () => { c = await testCloud(); });
  afterEach(() => c.close());
  const guest = async () => ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;

  it("a guest reads the feed through the binding; extra fields are dropped again", async () => {
    const r = relay();
    await post(r, transferEvent());
    const answer = await feed(r);
    // A stand-in that adds a field the cloud must not pass on.
    c.env.awxRead = { read: async () => ({}), events: async () => ({ ...answer, source: "airwallex-webhooks", events: answer.events.map((e) => ({ ...e, body: "secret body", amount: 99 })) }) };
    const res = await c.req("GET", "/v1/airwallex-live/events", { key: await guest() });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ view: "events", source: "airwallex-webhooks", receiving: true, last_event_at: t0.toISOString() });
    const evs = (res.json as { events: Record<string, unknown>[] }).events;
    expect(evs.map((e) => e.event_id)).toEqual(["evt_abc123"]);
    expect(JSON.stringify(evs)).not.toMatch(/secret body|amount/);
  });

  it("without the binding or with a bad answer, says so plainly", async () => {
    expect(await awxEventsView(undefined, t0)).toMatchObject({ source: "unavailable", code: "no_gateway" });
    expect(await awxEventsView({ read: async () => ({}), events: async () => ({ nope: true }) }, t0)).toMatchObject({ source: "unavailable", code: "bad_answer" });
    expect(await awxEventsView({ read: async () => ({}), events: async () => { throw new Error("x"); } }, t0)).toMatchObject({ source: "unavailable", code: "no_answer" });
    expect(checkEventRow({ event_id: "evt_1", type: "payout.transfer.paid", received_at: t0.toISOString() })).toBeNull(); // not marked verified
  });
});

// --- The badge -------------------------------------------------------------------------------------------------------
/** Airwallex's financial transactions for the run's window, as the 12 Nov read recorded them (the gateway's shape). */
const FT_ROWS = (JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-airwallex-financial-transactions.json", import.meta.url), "utf8")) as { audit: { event: string; payload: { items?: { amount_cents: number; fee_cents: number; net_cents: number }[] } }[] })
  .audit.find((a) => a.event === "awx_ft.read")!.payload.items!.map((i) => ({ ...i, amount: (i.amount_cents / 100).toFixed(2), fee: (i.fee_cents / 100).toFixed(2), net: (i.net_cents / 100).toFixed(2) })) as unknown as Record<string, string>[];
const gateway = (rows: unknown[]) => ({ view: "financial", source: "airwallex-sandbox", host: "api.sandbox.airwallex.com", read_at: "2026-11-14T17:59:00.000Z", cache_seconds: 45, data: { run: rows, run_window: RUN_WINDOW } });
const down = { view: "financial", source: "unavailable", host: "api.sandbox.airwallex.com", code: "no_answer", reason: "the Airwallex sandbox did not answer in time" };

describe("the reconciliation badge", () => {
  it("green: all matched, in words, never as N/N", async () => {
    const b = await booksBadge(async () => gateway(FT_ROWS), t0);
    expect(b.state).toBe("matched");
    expect(b.unmatched).toBe(0);
    expect(b.checked).toBeGreaterThanOrEqual(3);
    expect(b.text).toBe(`all ${b.checked} matched`);
    expect(badgeLine(b)).toBe(`Purser's books = Airwallex's transactions · all ${b.checked} matched · checked 18:00 UTC`);
    expect(JSON.stringify(b)).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(b.list_url).toBeNull();
  });

  it("amber: a cent off is one unmatched, with the link to the list", async () => {
    const rows = FT_ROWS.map((r) => ({ ...r }));
    const p = rows.find((r) => r.source_type === "PAYOUT")!;
    p.amount = (Number(p.amount) - 0.01).toFixed(2);
    const b = await booksBadge(async () => gateway(rows), t0);
    expect(b).toMatchObject({ state: "unmatched", unmatched: 1, text: "1 unmatched", list_url: AWX_BADGE_LIST_URL });
    expect(b.matched).toBe(b.checked! - 1);
  });

  it("amber: a row at Airwallex the books do not hold counts as unmatched", async () => {
    const extra = { ...FT_ROWS.find((r) => r.source_type === "PAYOUT")!, id: "ft_extra", source_id: "transfer-not-in-books" };
    const b = await booksBadge(async () => gateway([...FT_ROWS, extra]), t0);
    expect(b).toMatchObject({ state: "unmatched", unmatched: 1, text: "1 unmatched" });
  });

  it("grey: Airwallex unavailable, a gateway that throws, or figures that do not add up; never a number", async () => {
    for (const read of [async () => down, async () => { throw new Error("x"); }, async () => null]) {
      const b = await booksCache(read, () => t0.getTime()).get();
      expect(b).toMatchObject({ state: "unavailable", matched: null, checked: null, unmatched: null, text: "Airwallex unavailable", checked_at: t0.toISOString() });
      expect(badgeLine(b)).toBe("Purser's books = Airwallex's transactions · Airwallex unavailable · last checked 18:00 UTC");
    }
    const odd = { source: "airwallex-sandbox", read_at: t0.toISOString(), data: { computed: true, checked: 5, matched: 5, differences: 1, unknown_at_airwallex: [] } };
    expect(badgeOf(odd, t0).state).toBe("unavailable");
    expect(badgeOf({ source: "airwallex-sandbox", data: { computed: false, checked: 3, matched: 3, differences: 0, unknown_at_airwallex: [] } }, t0).state).toBe("unavailable");
    expect(badgeOf({ source: "airwallex-sandbox", data: { computed: true, checked: 0, matched: 0, differences: 0, unknown_at_airwallex: [] } }, t0).state).toBe("unavailable");
  });

  it("is kept 5 minutes: one read of Airwallex, shared by readers at the same moment", async () => {
    let clock = t0.getTime(), reads = 0;
    const cache = booksCache(async () => { reads++; return gateway(FT_ROWS); }, () => clock);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(reads).toBe(1);
    expect([a.cached, b.cached]).toEqual([false, false]);
    clock += AWX_BADGE_TTL_MS - 1;
    expect(await cache.get()).toMatchObject({ cached: true, checked_at: t0.toISOString() });
    expect(reads).toBe(1);
    clock += 1;
    expect(await cache.get()).toMatchObject({ cached: false, checked_at: new Date(clock).toISOString() });
    expect(reads).toBe(2);
  });

  it("keeps a grey badge 5 minutes too, so a sandbox that is down is not asked again and again", async () => {
    let clock = t0.getTime(), reads = 0;
    const cache = new AwxBadgeCache(async (at) => { reads++; throw new Error(String(at)); }, () => clock);
    await cache.get(); clock += 60_000; await cache.get();
    expect(reads).toBe(1);
  });

  it("the site's routes: JSON and an image, GET only, counts only", async () => {
    const cache = booksCache(async () => gateway(FT_ROWS), () => t0.getTime());
    const j = await awxBooksResponse(new Request(`${BASE}${AWX_BOOKS_JSON_PATH}`), cache);
    expect(j.headers.get("content-type")).toContain("application/json");
    const body = await j.text();
    expect(JSON.parse(body)).toMatchObject({ state: "matched", sandbox: true });
    expect(body).not.toMatch(/token|api_key|client_secret|source_id|NL\d\d/i);
    const s = await awxBooksResponse(new Request(`${BASE}${AWX_BOOKS_SVG_PATH}`), cache);
    expect(s.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await s.text();
    expect(svg).toMatch(/^<svg [^>]*role="img"/);
    expect(svg).toContain("matched · checked 18:00 UTC");
    expect(svg).not.toMatch(/<script|on[a-z]+=|href=/i);
    expect((await awxBooksResponse(new Request(`${BASE}${AWX_BOOKS_JSON_PATH}`, { method: "POST" }), cache)).status).toBe(405);
    expect(badgeSvg(badgeOf(null, t0))).toContain("Airwallex unavailable · last checked 18:00 UTC");
  });
});

describe("the pages", () => {
  it("/proof carries the block, filled by text only from the site's own JSON", () => {
    const html = proofPage();
    expect(html).toContain(awxLiveHtml());
    expect(html).toContain(`id="${AWX_LIVE_ID}"`);
    expect(AWX_LIVE_JS).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    expect(AWX_LIVE_JS).toMatch(/fetch\(u/);
    expect(AWX_LIVE_JS).toContain('"awx-live/books.json"');
    expect(AWX_LIVE_JS).toContain('"awx-live/events.json"');
    // Its words: "all N matched", "k unmatched", "Airwallex unavailable · last checked"; no N/N.
    expect(AWX_LIVE_JS).toContain('"all " + b.checked + " matched');
    expect(AWX_LIVE_JS).toContain('" unmatched · checked "');
    expect(AWX_LIVE_JS).toContain('"Airwallex unavailable · last checked "');
    expect(buildPages({} as NodeJS.ProcessEnv).csp.proof).toContain("connect-src 'self'");
  });

  // 21 Nov (Max: "Make it clean, tighter"): the badge left Home with the "On record" part; /proof keeps the live block.
  it("Home no longer shows the badge, and its script still reaches no network", () => {
    for (const html of [homePage(), homePage(undefined, { trySign: true })]) expect(html).not.toContain(awxHomeBadgeHtml());
    expect(awxHomeBadgeHtml()).toContain('src="awx-live/books.svg"');
    // Building every page takes a few seconds on a loaded CI runner (5 s, the default, timed out on 20 Nov): once, 30 s.
    const csp = buildPages({} as NodeJS.ProcessEnv).csp.home;
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src 'self'");
  }, 30_000);
});

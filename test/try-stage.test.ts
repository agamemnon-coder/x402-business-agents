// Stage mode for the finals (cloud/src/try/stage.ts, stageRoutes.ts, stagePage.ts; docs/finals/stage-mode.md): the
// event pool's counts and anonymous ticker, zeros while the event pool is off, the QR code with the presenter's event
// token, the page and its recorded run. Through HTTP on the Node engine (test money on a simulated bank) with a software
// authenticator. Nothing reaches the network.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ensureSchema } from "../cloud/src/app.js";
import { duration, eventPoolOn, money, sinceOf, stageFiled, stageStats, stageTable, STAGE_PER_MINUTE, STAGE_SCHEMA, STAGE_TTL_MS, tickText, ZERO } from "../cloud/src/try/stage.js";
import { qrParts, stageJoinUrl, stageTokenUrl } from "../cloud/src/try/stageRoutes.js";
import { STAGE_HEADLINE, STAGE_MONEY, STAGE_RECORDED, STAGE_TILES, stagePage } from "../cloud/src/try/stagePage.js";
import { readSwitches } from "../cloud/src/try/switches.js";
import { isTryEngineRequest } from "../worker/src/tryEngine.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const NOW = new Date("2026-11-19T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe("the words and numbers of the wall", () => {
  it("writes amounts and times as the /try page does", () => {
    expect(money("1850.00", "EUR")).toBe("EUR 1,850.00");
    expect(money("1234567.05", "USD")).toBe("USD 1,234,567.05");
    expect(duration(0.4)).toBe("under 1 s");
    expect(duration(40)).toBe("40 s");
    expect(duration(72)).toBe("1 min 12 s");
    expect(duration(120)).toBe("2 min");
    expect(duration(3720)).toBe("1 h 2 min");
  });

  it("says each step in plain words, with no name, id or place", () => {
    expect(tickText("paid", { amount: "1850.00", currency: "EUR", secs: 72 })).toBe("Someone paid EUR 1,850.00 in 1 min 12 s, signed with their passkey");
    expect(tickText("refused", { detail: "amount" })).toBe("Someone changed the amount after signing: refused");
    expect(tickText("refused", { detail: "beneficiary_name,iban_last4" })).toBe("Someone changed the payee and the account after signing: refused");
    expect(tickText("refused", { detail: "<b>x</b>" })).toBe("Someone changed the terms after signing: refused");
    expect(tickText("started", {})).toBe("Someone started a test company");
    expect(tickText("signed", {})).toBe("Someone signed the exact terms with their passkey");
  });

  it("reads `since` to the minute, at most 24 hours back and never in the future", () => {
    expect(sinceOf("2026-11-19T09:30:45.123Z", NOW).toISOString()).toBe("2026-11-19T09:30:00.000Z");
    expect(sinceOf(null, NOW).toISOString()).toBe("2026-11-18T10:00:00.000Z");
    expect(sinceOf("nonsense", NOW).toISOString()).toBe("2026-11-18T10:00:00.000Z");
    expect(sinceOf("2020-01-01T00:00:00Z", NOW).toISOString()).toBe("2026-11-18T10:00:00.000Z");
    expect(sinceOf("2030-01-01T00:00:00Z", NOW).toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });

  it("the event pool is open only with starts on and a live event token", () => {
    const tok = (pool: string, until: string) => JSON.stringify([{ sha256: "a".repeat(64), pool, until }]);
    expect(eventPoolOn({}, NOW)).toBe(false);
    expect(eventPoolOn({ starts: "on" }, NOW)).toBe(false);
    expect(eventPoolOn({ starts: "on", tokens: tok("jury", "2026-11-20T00:00:00Z") }, NOW)).toBe(false);
    expect(eventPoolOn({ starts: "on", tokens: tok("event", "2026-11-19T09:59:59Z") }, NOW)).toBe(false);
    expect(eventPoolOn({ starts: "off", tokens: tok("event", "2026-11-20T00:00:00Z") }, NOW)).toBe(false);
    expect(eventPoolOn({ starts: "on", tokens: tok("event", "2026-11-20T00:00:00Z") }, NOW)).toBe(true);
  });

  it("the migration is the table the module makes, word for word", () => {
    const statements = readFileSync("cloud/migrations/0005_try_stage.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(statements).toEqual(STAGE_SCHEMA);
  });
});

describe("the room on the wall, through HTTP", () => {
  let c: TestCloud;
  let token = "";
  const admin = async (body: unknown) => {
    const r = await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json;
  };
  const stats = async (since?: string) => {
    c.clock.now = new Date(c.clock.now.getTime() + STAGE_TTL_MS + 1);
    const r = await c.req("GET", `/v1/try/stage/stats${since ? `?since=${encodeURIComponent(since)}` : ""}`, { headers: { "cf-connecting-ip": "198.51.100.7" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json as unknown as { live: boolean; test_money: boolean; since: string; counts: typeof ZERO; ticker: { at: string; kind: string; text: string }[] };
  };
  let n = 0;
  /** A visitor: a start (with the event token or not), the clean sample, the approval passkey and a proposal. */
  async function visitor(withToken: boolean) {
    const r = await c.req("POST", "/v1/try/start", { body: withToken ? { token } : {}, headers: { "cf-connecting-ip": `203.0.113.${++n}` } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const s = r.json.session as string;
    const up = await c.req("POST", "/v1/engine/samples/clean", { key: s });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
    const p = await c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: s });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    return { s, tenant: r.json.tenant as string, pool: r.json.pool as string, phone, proposal: p.json.proposal as { id: string; challenge: string; terms_sha256: string } };
  }
  /** Approve, change the amount by one cent (refused), then pay the signed terms. */
  async function playThrough(v: Awaited<ReturnType<typeof visitor>>, advanceMs: number) {
    const cred = v.phone.sign({ challenge: v.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    expect((await c.req("POST", `/v1/engine/proposals/${v.proposal.id}/approve`, { key: v.s, body: { terms_sha256: v.proposal.terms_sha256, credential: cred } })).json.status).toBe("approved");
    const t = (await c.req("GET", `/v1/engine/proposals/${v.proposal.id}/terms`, { key: v.s })).json.terms as Record<string, unknown>;
    const bad = await c.req("POST", `/v1/engine/proposals/${v.proposal.id}/pay`, { key: v.s, body: { terms: { ...t, amount: "1850.01" }, credential: cred } });
    expect(bad.json.outcome).toBe("refused");
    c.clock.now = new Date(c.clock.now.getTime() + advanceMs);
    const ok = await c.req("POST", `/v1/engine/proposals/${v.proposal.id}/pay`, { key: v.s, body: { terms: t, credential: cred } });
    expect(ok.json.outcome, JSON.stringify(ok.json)).toBe("paid");
  }

  beforeAll(async () => {
    c = testCloud({ engine: true, tryIt: {} });
    c.clock.now = NOW;
    await ensureSchema(c.env.sql);
  });
  afterAll(() => c.close());

  it("answers zeros and no ticker while the event pool is off (no switch set)", async () => {
    const j = await stats();
    expect(j).toMatchObject({ live: false, test_money: true, counts: ZERO, ticker: [] });
  });

  it("answers zeros with starts on but no event token", async () => {
    await admin({ op: "set", key: "starts", value: "on" });
    expect(await stats()).toMatchObject({ live: false, counts: ZERO, ticker: [] });
  });

  it("counts the event pool's steps from the engine's own answers, and nothing of the public pool", async () => {
    token = (await admin({ op: "token", pool: "event", until: "2026-11-19T18:00:00Z" })).token as string;
    const since = c.clock.now.toISOString();
    const pub = await visitor(false);
    expect(pub.pool).toBe("public");
    await playThrough(pub, 1_000);
    const ev = await visitor(true);
    expect(ev.pool).toBe("event");
    await playThrough(ev, 71_000);
    // Claude does not run in a test (the switch claude is off; code reads): a reading by Claude is noted the same way
    // the routes note it, from the engine's own read_by, and only for an event company.
    await stageFiled(c.env.sql, ev.tenant, "claude:claude-haiku-5-5", c.clock.now);
    await stageFiled(c.env.sql, ev.tenant, "code", c.clock.now);
    await stageFiled(c.env.sql, pub.tenant, "claude:claude-haiku-5-5", c.clock.now);

    const j = await stats(since);
    expect(j.live).toBe(true);
    expect(j.counts).toEqual({ started: 1, read_by_claude: 1, signed: 1, paid: 1, refused: 1 });
    expect(j.ticker.map((t) => t.kind)).toEqual(["paid", "refused", "signed", "started"]);
    expect(j.ticker[0]!.text).toMatch(/^Someone paid EUR 1,850\.00 in 1 min 1\d s, signed with their passkey$/);
    expect(j.ticker[1]!.text).toBe("Someone changed the amount after signing: refused");
    for (const t of j.ticker) expect(t.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

    // Anonymous: no company id, no company or supplier name, no address, no token anywhere in the answer.
    const text = JSON.stringify(j);
    for (const bad of [ev.tenant, pub.tenant, "t_try_", "Bergtex", "203.0.113", "198.51.100", token, ev.proposal.id]) expect(text.includes(bad), bad).toBe(false);
    expect(Object.keys(j).sort()).toEqual(["counted_at", "counts", "live", "since", "test_money", "ticker"]);
    // The table keeps no company either.
    await stageTable(c.env.sql);
    const cols = (await c.env.sql.all<{ name: string }>("PRAGMA table_info(try_stage)")).map((r) => r.name);
    expect(cols).toEqual(["id", "at", "kind", "amount", "currency", "secs", "detail"]);
  });

  it("counts only from `since`", async () => {
    // A moment in the future is read as now: nothing has happened since.
    c.clock.now = later(10 * 60_000);
    expect((await stats(later(24 * 3_600_000).toISOString())).counts).toEqual(ZERO);
    expect((await stats(NOW.toISOString())).counts.paid).toBe(1);
  });

  it("goes back to zeros when the event pool closes, and the rows stay for when it opens again", async () => {
    await admin({ op: "set", key: "starts", value: "off" });
    expect(await stats(NOW.toISOString())).toMatchObject({ live: false, counts: ZERO, ticker: [] });
    await admin({ op: "set", key: "starts", value: "on" });
    expect((await stats(NOW.toISOString())).counts.paid).toBe(1);
  });

  it("is cached about two seconds: a step inside that window shows on the next read after it", async () => {
    const since = NOW.toISOString();
    const first = await stats(since);
    const v = await visitor(true);
    const r = await c.req("GET", `/v1/try/stage/stats?since=${encodeURIComponent(since)}`, { headers: { "cf-connecting-ip": "198.51.100.8" } });
    expect((r.json.counts as typeof ZERO).started).toBe(first.counts.started);
    expect((await stats(since)).counts.started).toBe(first.counts.started + 1);
    expect(v.pool).toBe("event");
  });

  it("is limited per address, in memory", async () => {
    const at = new Date("2026-11-19T12:00:30Z");
    c.clock.now = at;
    let last = 0;
    for (let i = 0; i <= STAGE_PER_MINUTE; i++) last = (await c.req("GET", "/v1/try/stage/stats", { headers: { "cf-connecting-ip": "192.0.2.99" } })).status;
    expect(last).toBe(429);
    expect((await c.req("GET", "/v1/try/stage/stats", { headers: { "cf-connecting-ip": "192.0.2.100" } })).status).toBe(200);
    c.clock.now = new Date(at.getTime() + 60_000);
    expect((await c.req("GET", "/v1/try/stage/stats", { headers: { "cf-connecting-ip": "192.0.2.99" } })).status).toBe(200);
  });

  it("draws the QR code with a live event token only; it sets nothing", async () => {
    const before = await readSwitches(c.env.sql);
    const ok = await c.req("POST", "/v1/try/stage/qr", { body: { token } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json).toEqual({ url_shown: `${ORIGIN}/try?pool=event`, ...qrParts(stageTokenUrl(ORIGIN, token)), until: "2026-11-19T18:00:00.000Z" });
    expect(String(ok.json.d)).toMatch(/^[Mhvz0-9 -]+$/);
    for (const bad of ["x".repeat(40), "", "short", `${token}x`]) {
      const r = await c.req("POST", "/v1/try/stage/qr", { body: { token: bad } });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("not_event_token");
    }
    // A jury token is not the event's.
    const jury = (await admin({ op: "token", pool: "jury", until: "2026-11-19T18:00:00Z" })).token as string;
    expect((await c.req("POST", "/v1/try/stage/qr", { body: { token: jury } })).status).toBe(400);
    // From another site: refused like every write.
    expect((await c.req("POST", "/v1/try/stage/qr", { body: { token }, headers: { origin: "https://elsewhere.example" } })).status).toBe(403);
    const after = await readSwitches(c.env.sql);
    expect({ ...after, tokens: undefined }).toEqual({ ...before, tokens: undefined });
  });

  it("serves the page on the hands-on deployment, under the console's policy", async () => {
    const r = await c.fetch(`${ORIGIN}/try/stage`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
    const html = await r.text();
    expect(html).toContain(STAGE_HEADLINE);
    expect(html).toContain(STAGE_MONEY);
    expect(html).toContain(`d="${qrParts(stageJoinUrl(ORIGIN)).d}"`);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/\sstyle="/);
  });
});

describe("the page and its recorded run", () => {
  it("is not served by a cloud that does not run the hands-on demo", async () => {
    const c = testCloud({});
    try { expect((await c.fetch(`${ORIGIN}/try/stage`)).status).toBe(404); } finally { c.close(); }
  });

  it("names each count the stats answer, and keeps the test-money label in the band and on the recorded run", () => {
    expect(STAGE_TILES.map(([k]) => k)).toEqual(Object.keys(ZERO));
    const html = stagePage("n0nce", "https://kit11.max-31b.workers.dev");
    expect(html.split(STAGE_MONEY).length - 1).toBe(2);
    expect(html).toContain("kit11.max-31b.workers.dev/try</p>");
  });

  it("plays the recording of 13 Nov: each line is words the page showed at that mark, at that time", () => {
    const rec = JSON.parse(readFileSync("docs/video/recording-try-v10.json", "utf8")) as { recorded_at: string; marks: Record<string, number>; said: Record<string, string>; passkey: string; money: string };
    expect(rec.recorded_at.slice(0, 10)).toBe("2026-11-13");
    expect(rec.passkey).toMatch(/virtual test passkey/);
    let prev = -1;
    for (const s of STAGE_RECORDED.steps) {
      expect(rec.said[s.mark], s.mark).toContain(s.line);
      expect(s.at).toBe(Math.round(rec.marks[s.mark]! * 10) / 10);
      expect(s.at).toBeGreaterThan(prev);
      prev = s.at;
    }
    expect(STAGE_RECORDED.seconds).toBe(Math.round(rec.marks["refused-held"]! * 10) / 10);
  });

  it("the site passes the stage page, its counts and its QR code to purser-try, and nothing more", () => {
    expect(isTryEngineRequest("GET", "/try/stage")).toBe(true);
    expect(isTryEngineRequest("GET", "/v1/try/stage/stats")).toBe(true);
    expect(isTryEngineRequest("POST", "/v1/try/stage/qr")).toBe(true);
    expect(isTryEngineRequest("POST", "/v1/try/stage/stats")).toBe(false);
    expect(isTryEngineRequest("GET", "/try/stage/x")).toBe(false);
    expect(isTryEngineRequest("POST", "/v1/try/admin")).toBe(false);
  });

  it("a stats answer with the pool off is zeros whatever the table holds", async () => {
    const c = testCloud({ engine: true, tryIt: {} });
    try {
      await ensureSchema(c.env.sql);
      await stageTable(c.env.sql);
      await c.env.sql.run("INSERT INTO try_stage (at, kind) VALUES (?, 'paid')", [NOW.toISOString()]);
      expect(await stageStats(c.env.sql, sinceOf(null, NOW), NOW, {})).toMatchObject({ live: false, counts: ZERO, ticker: [] });
    } finally { c.close(); }
  });
});

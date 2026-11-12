// The demo extras on the hands-on deployment (cloud/src/try/): the bot check before a start, the live counter, the
// anonymous feedback box and the owner's read-only page. Every one is behind a switch that is off when its row is
// missing. Nothing reaches the network.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { BOT_SOLVER_JS, checkProof, difficultyFor, issueChallenge, useProof, zeroBits, BOT_MAX_BITS, BOT_MIN_BITS } from "../cloud/src/try/botCheck.js";
import { counterLine, readCounter, tally, tallyTable } from "../cloud/src/try/counter.js";
import { EXTRA_SWITCHES } from "../cloud/src/try/extraSwitches.js";
import { cleanNote } from "../cloud/src/try/feedback.js";
import { percentile } from "../cloud/src/try/metrics.js";
import { ON_OFF, on, readSwitches } from "../cloud/src/try/switches.js";
import { TryRefused } from "../cloud/src/try/start.js";
import { ensureSchema } from "../cloud/src/app.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

const SECRET = "test-botcheck-secret-not-a-secret-0123456789";
const clouds: TestCloud[] = [];
function cloud(o: { botSecret?: string } = { botSecret: SECRET }): TestCloud {
  const c = testCloud({ engine: true, tryIt: { claude: false, ...o } });
  clouds.push(c);
  return c;
}
afterAll(() => { for (const c of clouds) c.close(); });
const set = async (c: TestCloud, key: string, value: string) => {
  const r = await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
};

const solve = new Function(`${BOT_SOLVER_JS}\nreturn { solveProof: solveProof, powSha256Hex: powSha256Hex };`)() as {
  solveProof(challenge: string, bits: number): { nonce: string; tries: number; ms: number };
  powSha256Hex(s: string): string;
};

describe("the switches of the extras", () => {
  it("are all on/off switches of the deployment, and all off with no row", async () => {
    for (const k of EXTRA_SWITCHES) expect((ON_OFF as readonly string[]).includes(k), k).toBe(true);
    const c = cloud();
    await ensureSchema(c.env.sql);
    const s = await readSwitches(c.env.sql);
    for (const k of EXTRA_SWITCHES) expect(on(s, k), k).toBe(false);
  });
});

describe("the bot check (proof of work)", () => {
  const now = new Date("2026-11-13T10:00:00Z");

  it("the browser's SHA-256 is SHA-256, for short and long inputs", () => {
    for (const s of ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(119), "pc1.1763028000000.16.abcdefghijklmnop.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG:12345", "y".repeat(300)]) {
      expect(solve.powSha256Hex(s), `length ${s.length}`).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });

  it("a solved challenge passes; the answer has the zero bits it claims", async () => {
    const ch = await issueChallenge(SECRET, now, 12);
    const s = solve.solveProof(ch.challenge, ch.difficulty);
    const d = createHash("sha256").update(`${ch.challenge}:${s.nonce}`).digest();
    expect(zeroBits(d)).toBeGreaterThanOrEqual(12);
    expect(await checkProof(SECRET, ch.challenge, s.nonce, new Date(now.getTime() + 1_000))).toMatchObject({ ok: true, bits: 12 });
  });

  it("refuses a wrong nonce, an expired challenge, another secret's signature and a changed difficulty", async () => {
    const ch = await issueChallenge(SECRET, now, 14);
    const s = solve.solveProof(ch.challenge, ch.difficulty);
    let wrong = Number(s.nonce) + 1;
    while (zeroBits(createHash("sha256").update(`${ch.challenge}:${wrong}`).digest()) >= 14) wrong++;
    expect(await checkProof(SECRET, ch.challenge, String(wrong), now)).toEqual({ ok: false, why: "work" });
    expect(await checkProof(SECRET, ch.challenge, s.nonce, new Date(now.getTime() + 5 * 60_000 + 1))).toEqual({ ok: false, why: "expired" });
    expect(await checkProof("another-secret-entirely-0123456789abcdef", ch.challenge, s.nonce, now)).toEqual({ ok: false, why: "signature" });
    const easier = ch.challenge.replace(".14.", ".12.");
    expect(await checkProof(SECRET, easier, s.nonce, now)).toEqual({ ok: false, why: "signature" });
    expect(await checkProof(SECRET, "pc1.x", "1", now)).toEqual({ ok: false, why: "shape" });
    expect(await checkProof(SECRET, ch.challenge, "1; DROP", now)).toEqual({ ok: false, why: "shape" });
    const ahead = await issueChallenge(SECRET, new Date(now.getTime() + 60_000), 12);
    expect(await checkProof(SECRET, ahead.challenge, solve.solveProof(ahead.challenge, 12).nonce, now)).toEqual({ ok: false, why: "future" });
  });

  it("an answer is spent once: the same answer again is refused", async () => {
    const c = cloud();
    await ensureSchema(c.env.sql);
    const ch = await issueChallenge(SECRET, now, 12);
    const proof = { challenge: ch.challenge, nonce: solve.solveProof(ch.challenge, 12).nonce };
    await useProof(c.env.sql, SECRET, proof, now);
    await expect(useProof(c.env.sql, SECRET, proof, now)).rejects.toThrow(/already used/);
    await expect(useProof(c.env.sql, SECRET, undefined, now)).rejects.toBeInstanceOf(TryRefused);
  });

  it("gets harder as more companies start: 12 bits when quiet, 20 at most", () => {
    const seen = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 10_000].map(difficultyFor);
    expect(seen[0]).toBe(BOT_MIN_BITS);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(difficultyFor(15)).toBe(16);
    expect(seen.at(-1)).toBe(BOT_MAX_BITS);
  });

  it("sits before the start: off, a start needs no proof; on, a start without one is refused before any company exists", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    expect((await c.req("POST", "/v1/try/challenge", { body: {} })).json).toEqual({ required: false });
    expect((await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.1" } })).status).toBe(201);
    await set(c, "bot_check", "on");
    const companies = async () => (await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies"))!.n;
    const before = await companies();
    const bare = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.2" } });
    expect(bare.status).toBe(403);
    expect(bare.json).toMatchObject({ code: "bot_check", message: expect.stringMatching(/reload the page/) });
    expect(await companies()).toBe(before);
    // The page's way: a challenge (harder now that one company started), solved, sent with the start.
    const ch = (await c.req("POST", "/v1/try/challenge", { body: {} })).json as { required: true; challenge: string; difficulty: number };
    expect(ch).toMatchObject({ required: true, difficulty: difficultyFor(1) });
    const proof = { challenge: ch.challenge, nonce: solve.solveProof(ch.challenge, ch.difficulty).nonce };
    const ok = await c.req("POST", "/v1/try/start", { body: { proof }, headers: { "cf-connecting-ip": "198.51.100.3" } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const again = await c.req("POST", "/v1/try/start", { body: { proof }, headers: { "cf-connecting-ip": "198.51.100.4" } });
    expect(again.status).toBe(403);
    expect(again.json.message).toMatch(/already used/);
    expect(await companies()).toBe(before + 1);
  });

  it("fails closed: switched on with no secret on the deployment, starts are paused", async () => {
    const c = cloud({});
    await set(c, "starts", "on");
    await set(c, "bot_check", "on");
    expect((await c.req("POST", "/v1/try/challenge", { body: {} })).status).toBe(503);
    const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.5" } });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("paused");
  });
});

describe("the live counter", () => {
  it("is not there while its switch is off", async () => {
    const c = cloud();
    expect((await c.req("GET", "/v1/try/counter")).status).toBe(404);
  });

  it("counts from its rows, and shows payments without a signature as the number they are", async () => {
    const c = cloud();
    const t = new Date("2026-11-13T09:00:00Z");
    for (const k of ["played", "played", "played", "caught", "signed", "signed"] as const) await tally(c.env.sql, k, t);
    expect(await readCounter(c.env.sql, t)).toMatchObject({ played: 3, caught: 1, signed: 2, without_signature: 0, since: "2026-11-13T09" });
    expect(counterLine(await readCounter(c.env.sql, t))).toBe("3 scenarios played, 1 fraud caught, 2 payments signed with a passkey, 0 payments without a signature.");
    await tally(c.env.sql, "unsigned", t);
    expect(counterLine(await readCounter(c.env.sql, t))).toMatch(/1 payment without a signature\.$/);
    await set(c, "counter", "on");
    const r = await c.req("GET", "/v1/try/counter");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ played: 3, caught: 1, signed: 2, without_signature: 1 });
    expect(r.res.headers.get("cache-control")).toMatch(/max-age=60/);
    // Only totals by hour and kind: no id of anything.
    await tallyTable(c.env.sql);
    const cols = (await c.env.sql.all<{ name: string }>("SELECT name FROM pragma_table_info('try_tally')")).map((x) => x.name);
    expect(cols.sort()).toEqual(["hour", "kind", "n"]);
  });

  it("is fed by the engine's own answers: a sample played, a changed bank account caught", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.9" } })).json as { session: string };
    expect((await c.req("POST", "/v1/engine/samples/clean", { key: s.session })).status).toBe(200);
    expect((await c.req("POST", "/v1/engine/samples/bank", { key: s.session })).status).toBe(200);
    expect(await readCounter(c.env.sql, c.clock.now)).toMatchObject({ played: 2, caught: 1, signed: 0, without_signature: 0 });
  });
});

describe("anonymous feedback", () => {
  it("is not there while its switch is off; on, one row with the hour, the choice and a cleaned note, nothing else", async () => {
    const c = cloud();
    const send = (body: unknown, ip = "198.51.100.20") => c.req("POST", "/v1/try/feedback", { body, headers: { "cf-connecting-ip": ip } });
    expect((await send({ choice: "useful" })).status).toBe(404);
    await set(c, "feedback", "on");
    expect((await send({ choice: "useful", note: "Clear.\u0000 <b>nice</b>‮" })).json).toEqual({ thanks: true });
    expect((await send({ choice: "meh" })).status).toBe(400);
    const rows = await c.env.sql.all<Record<string, unknown>>("SELECT * FROM try_feedback");
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["choice", "hour", "id", "note"]);
    expect(rows[0]).toMatchObject({ choice: "useful", note: "Clear. <b>nice</b>" });
    expect(JSON.stringify(rows)).not.toContain("198.51.100.20");
    expect(cleanNote("x".repeat(500))).toHaveLength(200);
    expect(cleanNote("   ")).toBeNull();
  });

  it("takes 3 an hour from one network", async () => {
    const c = cloud();
    await set(c, "feedback", "on");
    for (let i = 0; i < 3; i++) expect((await c.req("POST", "/v1/try/feedback", { body: { choice: "unclear" }, headers: { "cf-connecting-ip": "2001:db8:1:2::5" } })).status).toBe(200);
    expect((await c.req("POST", "/v1/try/feedback", { body: { choice: "unclear" }, headers: { "cf-connecting-ip": "2001:db8:1:2::99" } })).status).toBe(429);
    expect((await c.req("POST", "/v1/try/feedback", { body: { choice: "unclear" }, headers: { "cf-connecting-ip": "2001:db8:9:9::1" } })).status).toBe(200);
  });
});

describe("the owner's read-only page", () => {
  it("refuses the figures without the admin token; the page itself holds none", async () => {
    const c = cloud();
    expect((await c.req("POST", "/v1/try/ops", { body: {} })).status).toBe(401);
    expect((await c.req("POST", "/v1/try/ops", { body: {}, key: "wrong-token" })).status).toBe(401);
    const page = await c.req("GET", "/v1/try/ops");
    expect(page.status).toBe(200);
    const html = await page.res.text();
    expect(html).toContain("Admin token");
    expect(html).not.toMatch(/t_try_|started_|\d+ requests/);
    expect(page.res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*connect-src 'self'.*frame-ancestors 'none'/);
  });

  it("shows aggregates only: counts, errors by kind, latency bounds, spend against caps, the switches with tokens as a count", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    await set(c, "cap_day_micros_public", "2000000");
    await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "token", pool: "jury", until: "2026-11-15T00:00:00Z" } });
    const a = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.30" } })).json as { tenant: string; session: string; visitor_token: string };
    await c.req("POST", "/v1/engine/samples/clean", { key: a.session });
    await c.req("GET", "/v1/no-such-route");
    const r = await c.req("POST", "/v1/try/ops", { key: ADMIN_TOKEN, body: {} });
    expect(r.status).toBe(200);
    const j = r.json as Record<string, Record<string, unknown>>;
    expect(j.visitors).toMatchObject({ last_hour: { started: 1, invoices_played: 1 }, open_companies: 1 });
    const hour = (j.requests as { last_hour: { requests: number; by_class: Record<string, number>; p95_ms_at_most: number } }).last_hour;
    expect(hour.requests).toBeGreaterThan(3);
    expect(hour.by_class["404"]).toBeGreaterThanOrEqual(1);
    expect(hour.p95_ms_at_most).toBeGreaterThan(0);
    expect(j.claude).toMatchObject({ spent_today_by_pool: { public: { cap_micros: 2_000_000 } }, readers: { code_reads: 1, claude_reads: 0 } });
    expect((j.switches as Record<string, string>).tokens).toBe("1 tokens");
    const text = JSON.stringify(j);
    for (const secret of [a.tenant, a.session, a.visitor_token, "198.51.100.30", ADMIN_TOKEN]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("reads percentiles as bucket bounds", () => {
    expect(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBeNull();
    expect(percentile([10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.95)).toBe(25);
    expect(percentile([50, 40, 0, 0, 0, 0, 0, 0, 0, 10], 0.95)).toBe(Number.POSITIVE_INFINITY);
    expect(percentile([50, 45, 0, 0, 0, 0, 0, 0, 0, 5], 0.95)).toBe(50);
  });
});

describe("migration 0002", () => {
  it("makes exactly the tables the modules make on first use", async () => {
    const { readFileSync } = await import("node:fs");
    const { TALLY_SCHEMA } = await import("../cloud/src/try/counter.js");
    const { METRICS_SCHEMA } = await import("../cloud/src/try/metrics.js");
    const { FEEDBACK_SCHEMA } = await import("../cloud/src/try/feedback.js");
    const statements = readFileSync("cloud/migrations/0002_try_extras.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(statements).toEqual([TALLY_SCHEMA, ...METRICS_SCHEMA, FEEDBACK_SCHEMA]);
  });
});

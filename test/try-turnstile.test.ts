// Cloudflare Turnstile before a /try start (security hardening, 19 November): POST /v1/try/start asks Cloudflare's
// siteverify about the widget's token before any company or Durable Object exists. Behind the switch `turnstile`, off
// while its row is missing, and with the secret TURNSTILE_SECRET (a Worker secret the owner sets; never in a file).
// Fails closed: switched on with no secret, starts are paused; a token missing, refused, or a siteverify that cannot be
// reached or answers nonsense refuses the start. siteverify is a stand-in here that records what it was sent. 0 network.
import { afterAll, describe, expect, it } from "vitest";
import { SITEVERIFY_URL, verifyTurnstile } from "../cloud/src/try/turnstile.js";
import { EXTRA_SWITCHES } from "../cloud/src/try/extraSwitches.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

const SECRET = "0x4AAAAAAA-stand-in-turnstile-secret-not-real";
const GOOD = "stand-in-widget-token-good";

/** Cloudflare's siteverify, stood in: GOOD verifies once (a token is single use), anything else is refused. */
function siteverify(o: { answer?: (form: URLSearchParams) => Response | Promise<Response> } = {}) {
  const seen: URLSearchParams[] = [];
  const used = new Set<string>();
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    expect(String(url)).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    const form = new URLSearchParams(String(init?.body));
    seen.push(form);
    if (o.answer) return o.answer(form);
    const token = form.get("response") ?? "";
    if (form.get("secret") !== SECRET) return Response.json({ success: false, "error-codes": ["invalid-input-secret"] });
    if (token !== GOOD) return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    if (used.has(token)) return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    used.add(token);
    return Response.json({ success: true, challenge_ts: "2026-11-19T10:00:00Z", hostname: "try.purser.example", action: "try_start", "error-codes": [] });
  };
  return { fetch, seen };
}

const clouds: TestCloud[] = [];
function cloud(o: { turnstileSecret?: string; siteverify?: ReturnType<typeof siteverify>["fetch"] } = {}): TestCloud {
  const c = testCloud({ engine: true, tryIt: { claude: false, ...(o.turnstileSecret ? { turnstileSecret: o.turnstileSecret } : {}), ...(o.siteverify ? { siteverify: o.siteverify } : {}) } });
  clouds.push(c);
  return c;
}
afterAll(() => { for (const c of clouds) c.close(); });
const set = async (c: TestCloud, key: string, value: string) => {
  const r = await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
};
const companies = async (c: TestCloud) => (await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies"))!.n;
let ip = 0;
const start = (c: TestCloud, body: Record<string, unknown>) => c.req("POST", "/v1/try/start", { body, headers: { "cf-connecting-ip": `198.51.100.${++ip}` } });

describe("Turnstile before a /try start", { timeout: 60_000 }, () => {
  it("is a switch of the deployment, off with no row: starts run without a token and siteverify is never called", async () => {
    expect((EXTRA_SWITCHES as readonly string[]).includes("turnstile")).toBe(true);
    const sv = siteverify();
    const c = cloud({ turnstileSecret: SECRET, siteverify: sv.fetch });
    await set(c, "starts", "on");
    expect((await start(c, {})).status).toBe(201);
    expect(sv.seen).toHaveLength(0);
  });

  it("switched on, starts a company only on a token siteverify accepts, once; sends the secret, the token and the address", async () => {
    const sv = siteverify();
    const c = cloud({ turnstileSecret: SECRET, siteverify: sv.fetch });
    await set(c, "starts", "on");
    await set(c, "turnstile", "on");
    const before = await companies(c);
    const bare = await start(c, {});
    expect(bare.status).toBe(403);
    expect(bare.json).toMatchObject({ code: "turnstile", message: expect.stringMatching(/reload the page/) });
    expect(sv.seen).toHaveLength(0);
    const wrong = await start(c, { turnstile: "a-token-cloudflare-never-issued" });
    expect(wrong.status).toBe(403);
    expect(wrong.json.code).toBe("turnstile");
    expect(await companies(c)).toBe(before);
    const ok = await start(c, { turnstile: GOOD });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(await companies(c)).toBe(before + 1);
    const last = sv.seen.at(-1)!;
    expect([last.get("secret"), last.get("response"), last.get("remoteip")]).toEqual([SECRET, GOOD, `198.51.100.${ip}`]);
    expect(last.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
    // Cloudflare refuses a token used twice; so does the start.
    const again = await start(c, { turnstile: GOOD });
    expect(again.status).toBe(403);
    expect(await companies(c)).toBe(before + 1);
  });

  it("fails closed: switched on with no secret on the deployment, starts are paused and siteverify is not called", async () => {
    const sv = siteverify();
    const c = cloud({ siteverify: sv.fetch });
    await set(c, "starts", "on");
    await set(c, "turnstile", "on");
    const r = await start(c, { turnstile: GOOD });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("paused");
    expect(sv.seen).toHaveLength(0);
  });

  it("fails closed when siteverify cannot be reached, errs, or answers anything but success: true", async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => { throw new TypeError("network down"); },
      () => new Response("upstream error", { status: 500 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json({ success: "true" }),
      () => Response.json({}),
    ];
    for (const a of answers) {
      const sv = siteverify({ answer: a });
      const c = cloud({ turnstileSecret: SECRET, siteverify: sv.fetch });
      await set(c, "starts", "on");
      await set(c, "turnstile", "on");
      const r = await start(c, { turnstile: GOOD });
      expect([403, 503], JSON.stringify(r.json)).toContain(r.status);
      expect(r.json.code === "turnstile" || r.json.code === "paused").toBe(true);
      expect(await companies(c)).toBe(0);
    }
  });

  it("verifyTurnstile: checks the expected action when it is given, and refuses an over-long token without a call", async () => {
    const sv = siteverify();
    expect(await verifyTurnstile({ secret: SECRET, token: GOOD, ip: "198.51.100.9", fetch: sv.fetch, action: "try_start" })).toEqual({ ok: true });
    const other = siteverify({ answer: () => Response.json({ success: true, action: "login" }) });
    expect(await verifyTurnstile({ secret: SECRET, token: GOOD, ip: null, fetch: other.fetch, action: "try_start" })).toMatchObject({ ok: false, why: "action" });
    const long = siteverify();
    expect(await verifyTurnstile({ secret: SECRET, token: "x".repeat(2049), ip: null, fetch: long.fetch })).toMatchObject({ ok: false, why: "shape" });
    expect(long.seen).toHaveLength(0);
  });
});

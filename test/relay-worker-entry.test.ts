// The relay Worker's entry point (worker/src/index.ts), with Cloudflare's runtime and the built pages stood in for: every
// outside path goes to its own Durable Object instance (the relay's queue, /try/sign's worlds, the x402 desk, the
// mandate inspector, Try Purser, the Airwallex badge) and to no other; the internal paths (the Airwallex read gateway,
// the try-sign spend) are not reachable from outside; /status shows the hourly checks or says they could not be read;
// the named entrypoints reach only their own instance; and inside one instance, each desk is made from that
// instance's own key, or none.
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlOver } from "../src/relay/local.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} },
  WorkerEntrypoint: class { constructor(protected ctx: unknown, protected env: unknown) {} },
}));

const { default: worker, RelayObject, AwxRead, AwxFx, AwxGateway, AwxCards, LIVE_AGENTS_PATH } = await import("../worker/src/index.js");
// The pages the build bakes in (npm run relay:build; without a build, an empty set: vitest.config.ts). Each test sets
// only what the routes it checks read.
const PAGES = (await import("../worker/src/pages.gen.js")).PAGES as unknown as Record<string, unknown>;
const { AWX_READ_PATH } = await import("../worker/src/awxRead.js");
const { AGENT_CARDS_PATH } = await import("../worker/src/agentCardsLive.js");
const { AWX_EVENTS_PATH } = await import("../worker/src/awxEvents.js");
const { X402_PATH } = await import("../worker/src/x402.js");
const { METAL_INSPECTOR_PATH } = await import("../worker/src/metalInspector.js");
const { AWX_BOOKS_JSON_PATH, AWX_BOOKS_SVG_PATH } = await import("../worker/src/awxBooks.js");

const BASE = "https://kit11.example.workers.dev";
type Call = { instance: string; path: string; method?: string };

/** The RELAY namespace: an instance per name; each records what reaches it and answers with its own name. */
function namespace(over: { statusSummary?: () => Promise<unknown>; fetch?: (instance: string, req: Request | string) => Promise<Response> } = {}) {
  const calls: Call[] = [];
  const rpc: { instance: string; method: string; arg?: unknown }[] = [];
  const stub = (instance: string) => ({
    fetch: async (req: Request | string) => {
      const url = typeof req === "string" ? req : req.url;
      calls.push({ instance, path: new URL(url).pathname + new URL(url).search, ...(typeof req === "string" ? {} : { method: req.method }) });
      return over.fetch ? over.fetch(instance, req) : Response.json({ instance });
    },
    statusSummary: over.statusSummary ?? (async () => { rpc.push({ instance, method: "statusSummary" }); return { checks: [], at: "2026-11-19T10:00:00.000Z" }; }),
    statusRun: async () => { rpc.push({ instance, method: "statusRun" }); return { checks: 3, passed: 3 }; },
    awxFxQuote: async (a: unknown) => { rpc.push({ instance, method: "awxFxQuote", arg: a }); return { status: "unavailable", reason: "test" }; },
    awxPayoutCreate: async (a: unknown) => { rpc.push({ instance, method: "awxPayoutCreate", arg: a }); return { status: "off" }; },
    awxPayoutSimulate: async (a: unknown) => { rpc.push({ instance, method: "awxPayoutSimulate", arg: a }); return { status: "off" }; },
  });
  return { calls, rpc, RELAY: { idFromName: (n: string) => n, get: (id: string) => stub(id) } };
}

const env = (ns = namespace(), over: Record<string, unknown> = {}) => ({ RELAY: ns.RELAY, RELAY_TOKEN: "t".repeat(64), ...over }) as never;
const go = (path: string, init: RequestInit = {}) => new Request(`${BASE}${path}`, init);

beforeEach(() => {
  for (const k of Object.keys(PAGES)) delete PAGES[k];
  Object.assign(PAGES, { dashboard: "<p>dashboard</p>", notFound: "<p>no such page</p>", csp: { dashboard: "default-src 'none'", notFound: "default-src 'none'" } });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("the Worker routes each outside path to its own instance", () => {
  it("sends the relay's paths to the relay instance, and nothing else there", async () => {
    const ns = namespace();
    for (const p of ["/api/state", "/api/approve", "/hooks/airwallex", AWX_EVENTS_PATH, "/health", "/health/live"]) {
      const res = await worker.fetch(go(p, { method: p === "/api/approve" || p === "/hooks/airwallex" ? "POST" : "GET" }), env(ns));
      expect(await res.json()).toEqual({ instance: "relay" });
    }
    expect(ns.calls.map((c) => c.instance)).toEqual(Array(6).fill("relay"));
    expect(ns.calls.map((c) => c.path)).toEqual(["/api/state", "/api/approve", "/hooks/airwallex", AWX_EVENTS_PATH, "/health", "/health/live"]);
  });

  it("keeps x402, the mandate inspector, Try Purser and the Airwallex badge each in its own instance", async () => {
    const ns = namespace();
    const where = async (p: string) => ((await (await worker.fetch(go(p), env(ns))).json()) as { instance: string }).instance;
    expect(await where(X402_PATH)).toBe("x402");
    expect(await where(METAL_INSPECTOR_PATH)).toBe("metal-inspector");
    expect(await where("/api/try")).toBe("try");
    expect(await where(AWX_BOOKS_JSON_PATH)).toBe("awx-books");
    expect(await where(AWX_BOOKS_SVG_PATH)).toBe("awx-books");
  });

  it("sends /try/sign's paths to its own instance only when the feature is built in; otherwise each is a 404 the relay never sees", async () => {
    const off = namespace();
    const res = await worker.fetch(go("/api/try-sign/world", { method: "POST" }), env(off));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(off.calls).toEqual([]);

    PAGES.trySign = "<p>sign</p>";
    const on = namespace();
    expect(await (await worker.fetch(go("/api/try-sign/world", { method: "POST" }), env(on))).json()).toEqual({ instance: "try-sign" });
    expect(on.calls).toEqual([{ instance: "try-sign", path: "/api/try-sign/world", method: "POST" }]);
  });

  it("does not let an outside request reach the Airwallex read gateway or the try-sign spend: a 404, no instance", async () => {
    const ns = namespace();
    for (const p of [AWX_READ_PATH, `${AWX_READ_PATH}?view=financial`, LIVE_AGENTS_PATH, "/nowhere"]) {
      const res = await worker.fetch(go(p), env(ns));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("<p>no such page</p>");
    }
    expect(ns.calls).toEqual([]);
  });

  it("answers a plain 404 when the bundle has no not-found page", async () => {
    delete PAGES.notFound;
    const res = await worker.fetch(go("/nowhere"), env());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("redirects /go without touching any instance, and serves the pages from the bundle", async () => {
    const ns = namespace();
    const res = await worker.fetch(go("/go"), env(ns, { TRY_GO_URL: "https://try.example.com/start" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://try.example.com/start");
    const page = await worker.fetch(go("/?dashboard"), env(ns));
    expect(await page.text()).toBe("<p>dashboard</p>");
    expect(page.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(ns.calls).toEqual([]);
  });

  it("hands /try to purser-try when the binding is there, as the request came; without it /try is not the engine's", async () => {
    const seen: string[] = [];
    const TRY_ENGINE = { fetch: async (r: Request) => { seen.push(`${r.method} ${new URL(r.url).pathname}`); return new Response("engine"); } };
    const ns = namespace();
    expect(await (await worker.fetch(go("/try"), env(ns, { TRY_ENGINE }))).text()).toBe("engine");
    expect(await (await worker.fetch(go("/v1/try/start", { method: "POST" }), env(ns, { TRY_ENGINE }))).text()).toBe("engine");
    expect(seen).toEqual(["GET /try", "POST /v1/try/start"]);
    // Without the binding /try is a page of the site's own bundle, or, when it has none, not found.
    expect((await worker.fetch(go("/v1/try/start", { method: "POST" }), env(ns))).status).toBe(404);
    expect(ns.calls).toEqual([]);
  });
});

describe("the agents' cards at the Airwallex sandbox", () => {
  it("are read in the Worker itself, never through an instance; without a key, no call to Airwallex, and the answer is not cached", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ns = namespace();
    const res = await worker.fetch(go(AGENT_CARDS_PATH), env(ns));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/"card_number"|"cvc"/);
    expect(ns.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // A POST to the same path is not the read: it goes to the relay like any other /api/ path.
    expect(await (await worker.fetch(go(AGENT_CARDS_PATH, { method: "POST" }), env(ns))).json()).toEqual({ instance: "relay" });
  });

  it("AwxCards refuses an ask off the card allow-list without a call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cards = new (AwxCards as unknown as new (c: unknown, e: unknown) => InstanceType<typeof AwxCards>)({}, env());
    const answer = (await cards.ask({ op: "steal" } as never)) as { ok?: boolean };
    expect(answer.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("/status and /status.json", () => {
  it("serve the hourly checks from the status instance", async () => {
    const ns = namespace();
    const res = await worker.fetch(go("/status.json"), env(ns));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ checks: [], at: "2026-11-19T10:00:00.000Z" });
    expect(ns.rpc).toEqual([{ instance: "status", method: "statusSummary" }]);
  });

  it("say the checks could not be read, with a 503, when the status instance fails", async () => {
    const ns = namespace({ statusSummary: async () => { throw new Error("object gone"); } });
    const res = await worker.fetch(go("/status.json"), env(ns));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "the hourly checks could not be read just now" });
  });

  it("only answer GET and HEAD, and /status needs its page in the bundle", async () => {
    const ns = namespace();
    // A POST to /status.json is no status request: it falls through to the pages and is not found.
    expect((await worker.fetch(go("/status.json", { method: "POST" }), env(ns))).status).toBe(404);
    // No status page built in: /status is not found, after the instance was asked.
    expect((await worker.fetch(go("/status"), env(ns))).status).toBe(404);
    expect(ns.rpc.map((r) => r.method)).toEqual(["statusSummary"]);
  });

  it("the hourly cron runs one round of the checks in the status instance, and waits for it", async () => {
    const ns = namespace();
    const waited: Promise<unknown>[] = [];
    await worker.scheduled!({} as never, env(ns), { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException: () => {} } as never);
    expect(waited).toHaveLength(1);
    expect(await waited[0]).toBeUndefined();
    expect(ns.rpc).toEqual([{ instance: "status", method: "statusRun" }]);
  });
});

describe("the named entrypoints reach their own instance only", () => {
  it("AwxRead refuses a view it does not know before any call, and reads a known one from the awx-read instance", async () => {
    const ns = namespace({ fetch: async (instance) => Response.json(instance === "awx-read" ? { view: "balances", rows: [] } : { error: "no answer" }, { status: instance === "relay" ? 500 : 200 }) });
    const read = new (AwxRead as unknown as new (c: unknown, e: unknown) => InstanceType<typeof AwxRead>)({}, env(ns));
    expect(await read.read("everything")).toEqual({ error: "no such view" });
    expect(ns.calls).toEqual([]);
    expect(await read.read("balances")).toEqual({ view: "balances", rows: [] });
    expect(ns.calls).toEqual([{ instance: "awx-read", path: `${AWX_READ_PATH}?view=balances` }]);
    // The events feed is the relay's; a failed answer is "no answer", not the body.
    expect(await read.events()).toEqual({ error: "no answer" });
    expect(ns.calls[1]).toEqual({ instance: "relay", path: AWX_EVENTS_PATH });
  });

  it("AwxFx asks the awx-fx instance for a quote and the awx-payout instance for a payout or its simulation", async () => {
    const ns = namespace();
    const fx = new (AwxFx as unknown as new (c: unknown, e: unknown) => InstanceType<typeof AwxFx>)({}, env(ns));
    await fx.quote({ company: "c1" } as never);
    await fx.payout({ company: "c1" } as never);
    await fx.payoutSimulate({ company: "c1", terms_sha256: "a".repeat(64) });
    expect(ns.rpc.map((r) => `${r.instance}.${r.method}`)).toEqual(["awx-fx.awxFxQuote", "awx-payout.awxPayoutCreate", "awx-payout.awxPayoutSimulate"]);
  });

  it("AwxGateway refuses a call off its allow-list before any request", async () => {
    const gw = new (AwxGateway as unknown as new (c: unknown, e: unknown) => InstanceType<typeof AwxGateway>)({}, env());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await gw.call({ method: "DELETE", path: "/api/v1/everything" } as never)).toEqual({ ok: false, status: 400, code: "gateway_refused", trace_id: null, refused: "not a call" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("inside one instance, the desk for the path", () => {
  const object = (over: Record<string, unknown> = {}, ns = namespace()) => {
    const ctx = { storage: { sql: sqlOver(new Database(":memory:")) } };
    return { ns, obj: new (RelayObject as unknown as new (c: unknown, e: unknown) => InstanceType<typeof RelayObject>)(ctx, env(ns, over)) };
  };

  it("the relay instance answers the relay's own paths, and its /health asks the try-sign instance for the live agents' spend", async () => {
    const ns = namespace({ fetch: async (instance) => (instance === "try-sign" ? Response.json({ usd: 0.12, budget_usd: 5 }) : new Response("", { status: 500 })) });
    const { obj } = object({}, ns);
    const health = (await (await obj.fetch(go("/health"))).json()) as { status: string; runner: string; live_agents_today: unknown };
    expect(health.status).toBe("recorded_demo");
    expect(health.runner).toBe("off");
    expect(health.live_agents_today).toEqual({ usd: 0.12, budget_usd: 5 });
    expect(ns.calls).toEqual([{ instance: "try-sign", path: LIVE_AGENTS_PATH }]);
    // A runner sync without the token is refused by the relay's own desk.
    const sync = await obj.fetch(go("/api/runner/sync", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(sync.status).toBe(401);
  });

  it("/health shows no live agents' spend when the try-sign instance does not answer", async () => {
    const { obj } = object({}, namespace({ fetch: async () => new Response("", { status: 500 }) }));
    const health = (await (await obj.fetch(go("/health"))).json()) as { live_agents_today?: unknown };
    expect(health.live_agents_today ?? null).toBeNull();
  });

  it("the try-sign instance answers its spend today, and Try Purser's desk answers /api/try", async () => {
    const { obj } = object();
    expect(await (await obj.fetch(go(LIVE_AGENTS_PATH))).json()).toEqual({ usd: 0, budget_usd: 50 });
    const tried = await obj.fetch(go("/api/try", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }));
    expect(tried.status).toBe(400);
    expect(await tried.json()).toEqual({ error: 'send {"text": "..."}' });
  });

  it("without a key, the Airwallex read desk, the FX quote and the payout make no call and say why", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { obj } = object();
    const read = (await (await obj.fetch(go(`${AWX_READ_PATH}?view=balances`))).json()) as Record<string, unknown>;
    expect(read).toMatchObject({ view: "balances", source: "unavailable", code: "no_key", reason: "this deployment holds no Airwallex sandbox key" });
    const ask = { company: "c1", buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "100.00" };
    expect(await obj.awxFxQuote(ask)).toEqual({ ok: false, reason: "no_key" });
    expect(await obj.awxFxQuote({ ...ask, buyAmount: "lots" })).toEqual({ ok: false, reason: "bad_request" });
    const pay = { company: "c1", terms_sha256: "a".repeat(64), amount: "10.00", currency: "EUR", reference: "INV-1" };
    expect(await obj.awxPayoutCreate(pay)).toEqual({ ok: false, reason: "no_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the FX quote's and the payout's switches stop them before the key is looked at", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const keys = { AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key" };
    const ask = { company: "c1", buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "100.00" };
    expect(await object({ ...keys, AWX_FX: " OFF " }).obj.awxFxQuote(ask)).toEqual({ ok: false, reason: "switched_off" });
    const pay = { company: "c1", terms_sha256: "a".repeat(64), amount: "10.00", currency: "EUR", reference: "INV-1" };
    // The payout's own key wins over the Worker's sandbox key; the switch stops either.
    expect(await object({ ...keys, AIRWALLEX_PAYOUT_CLIENT_ID: "pid", AIRWALLEX_PAYOUT_API_KEY: "pkey", AWX_PAYOUT: "Off" }).obj.awxPayoutCreate(pay)).toEqual({ ok: false, reason: "switched_off" });
    expect(await object({ ...keys, AWX_PAYOUT: "off" }).obj.awxPayoutSimulate({ company: "c1", terms_sha256: "a".repeat(64) })).toMatchObject({ ok: false, reason: "switched_off" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the x402 desk and the mandate inspector each answer their own path; without a recorded read the inspector is a 503", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { obj } = object({ METAL_INSPECTOR: "off", METAL_RPC_URL: "https://rpc.example/key" });
    const x402 = await obj.fetch(go(X402_PATH));
    expect(x402.status).toBe(402);
    const insp = await obj.fetch(go(METAL_INSPECTOR_PATH));
    expect(insp.status).toBe(503);
    expect(await insp.json()).toEqual({ error: "this bundle carries no recorded read" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

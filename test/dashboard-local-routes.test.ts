// The local dashboard server (src/servers/dashboard.ts, dashboardApp): every page it serves answers with its own
// content security policy, old addresses redirect, and what is not a page is refused. Breaks if a page goes out
// without its policy (or with another page's), if a host other than loopback is answered, or if a malformed id reaches
// a handler.
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import {
  AGENT_CSPS, AGENT_PAGES, AIRWALLEX_CSP, AIRWALLEX_PAGE, AWX_CALLS_CSP, AWX_CALLS_PAGE, BOOKS_CSP, CLAUDE_CSP, DEMO_CSP, DOCS_CSP, FILM_CSP, LIVE_CSP, LOGOS,
  METAL_CSP, METAL_PAGE, MONTH_CSP, RUNS_CSP, SECURITY_CSP, STATUS_CSP, T0_READBACK_TEXT, TRACE_CSP, TRY_CSP, TRY_PAGE_OFFLINE, VISA_CSP, dashboardApp,
} from "../src/servers/dashboard.js";
import { AGENT_CARDS_PATH } from "../worker/src/agentCardsLive.js";
import { T0_READBACK_PATH } from "../src/accounting/t0Readback.js";

let server: Server;
let base = "";
beforeAll(async () => {
  server = dashboardApp(openDb(":memory:"), { approvalsUrl: "http://127.0.0.1:4200/", now: () => new Date("2026-11-20T10:00:00Z") }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { redirect: "manual", ...init });

describe("the local dashboard's pages", () => {
  it.each([
    ["/alta", METAL_CSP], ["/visa", VISA_CSP], ["/airwallex", AIRWALLEX_CSP], ["/airwallex/calls", AWX_CALLS_CSP], ["/trace", TRACE_CSP], ["/runs", RUNS_CSP],
    ["/claude", CLAUDE_CSP], ["/security", SECURITY_CSP], ["/docs", DOCS_CSP], ["/status", STATUS_CSP], ["/books", BOOKS_CSP], ["/try", TRY_CSP],
    ["/demo", DEMO_CSP], ["/film", FILM_CSP], ["/live", LIVE_CSP], ["/month", MONTH_CSP],
  ])("%s is HTML with its own policy and the loopback headers", async (path, csp) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("content-security-policy")).toBe(csp);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toMatch(/<html/i);
  });

  it("serves the pages built at start as they were built, and each agent's page with its own policy", async () => {
    expect(await (await get("/alta")).text()).toBe(METAL_PAGE);
    expect(await (await get("/airwallex")).text()).toBe(AIRWALLEX_PAGE);
    expect(await (await get("/airwallex/calls")).text()).toBe(AWX_CALLS_PAGE);
    expect(await (await get("/try")).text()).toBe(TRY_PAGE_OFFLINE);
    const id = Object.keys(AGENT_PAGES)[0]!;
    const agent = await get(`/agents/${id}`);
    expect(agent.headers.get("content-security-policy")).toBe(AGENT_CSPS[id]);
    expect(await agent.text()).toBe(AGENT_PAGES[id]);
    expect((await get("/agents/constructor")).status).toBe(404);
    expect((await get("/agents/nobody")).status).toBe(404);
  });

  it("serves the fonts and logos, and the T:0 read-back as a download", async () => {
    const font = await get("/assets/inter.woff2");
    expect(font.headers.get("content-type")).toBe("font/woff2");
    const name = Object.keys(LOGOS)[0]!;
    const logo = await get(`/assets/${name}`);
    expect(logo.headers.get("content-type")).toContain(LOGOS[name]!.type.split(";")[0]!);
    expect(Buffer.from(await logo.arrayBuffer()).equals(LOGOS[name]!.body)).toBe(true);
    expect((await get("/assets/nothing.png")).status).toBe(404);
    const t0 = await get(T0_READBACK_PATH);
    expect(t0.headers.get("content-disposition")).toBe('attachment; filename="t0-readback.json"');
    expect(await t0.text()).toBe(T0_READBACK_TEXT);
  });

  it("says it holds no sandbox key for the live cards, and asks no model for Try Purser", async () => {
    const cards = (await (await get(AGENT_CARDS_PATH)).json()) as { source: string; reason: string };
    expect(cards).toMatchObject({ source: "unavailable", reason: "no sandbox key on this machine" });
    const tried = await get("/api/try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(tried.status).toBeGreaterThanOrEqual(200);
    expect(JSON.stringify(await tried.json())).not.toMatch(/claude-|request_id/);
  });

  it("redirects old addresses, and sends an approval to the approval page only for a proposal id", async () => {
    const metal = await get("/metal");
    expect([metal.status, metal.headers.get("location")]).toEqual([301, "/alta"]);
    // 21 Nov (the owner: "merge them"): T:0 lives on /books.
    const t0 = await get("/t0");
    expect([t0.status, t0.headers.get("location")]).toEqual([301, "/books"]);
    for (const [old, to] of [["/pricing", "/business"], ["/tour", "/home"]]) {
      const r = await get(old!);
      expect([r.status, r.headers.get("location")]).toEqual([302, to]);
    }
    const ok = await get("/approve/P-0042");
    expect([ok.status, ok.headers.get("location")]).toEqual([302, "http://127.0.0.1:4200/#P-0042"]);
    const bad = await get("/approve/P-42");
    expect([bad.status, await bad.text()]).toEqual([400, "bad proposal id"]);
  });

  it("answers the ledger's numbers as JSON and Prometheus metrics", async () => {
    const health = await get("/health");
    expect([200, 503]).toContain(health.status);
    expect(await health.json()).toHaveProperty("status");
    const metrics = await get("/metrics");
    expect(metrics.headers.get("content-type")).toMatch(/^text\/plain; version=0\.0\.4/);
    const snap = await get("/api/snapshot");
    expect(snap.status).toBe(200);
  });

  it("answers no host but loopback", async () => {
    // fetch will not send another Host, so node:http does (DNS rebinding sends the attacker's name).
    const port = (server.address() as AddressInfo).port;
    const answer = await new Promise<[number, string]>((ok, no) => {
      const req = request({ host: "127.0.0.1", port, path: "/alta", headers: { host: "evil.example" } }, (res) => {
        let body = "";
        res.on("data", (d) => { body += String(d); });
        res.on("end", () => ok([res.statusCode ?? 0, body]));
      });
      req.on("error", no);
      req.end();
    });
    expect(answer).toEqual([403, "forbidden host"]);
  });
});

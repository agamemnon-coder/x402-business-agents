// npm run cloud:smoke (scripts/engine-smoke.ts): the engine's chain against a running cloud, step by step with its wall
// time. Here only against a cloud in this process (testCloud with the Node engine) through its own fetch: no network.
import { describe, expect, it } from "vitest";
import { CHANGED_TERMS, main, PLAIN_STEPS, runParallel, runSmoke, SMOKE_STEPS } from "../scripts/engine-smoke.js";
import { ADMIN_TOKEN, ORIGIN, testCloud } from "./support/cloud.js";

describe("the engine's smoke run", () => {
  it("runs the chain on the cloud's own relying party, every step timed, and finds everything as it should be", async () => {
    const c = testCloud({ engine: true });
    try {
      const lines: string[] = [];
      const out = await runSmoke({ base: ORIGIN, adminToken: ADMIN_TOKEN, fetch: c.fetch, log: (l) => lines.push(l) });
      expect(out.failed, JSON.stringify(out.steps)).toBeNull();
      expect(out.steps.map((s) => s.step)).toEqual([...SMOKE_STEPS]);
      for (const s of out.steps) expect(s.ms).toBeGreaterThanOrEqual(0);
      expect(lines).toHaveLength(SMOKE_STEPS.length + 1);
      expect(lines.at(-1)).toMatch(/^smoke: all \d+ steps passed in \d+ ms$/);
      // The admin token is never printed.
      expect(lines.join("\n")).not.toContain(ADMIN_TOKEN);
      expect(CHANGED_TERMS).toBe("This signature is over other terms than the ones on screen. Nothing was paid.");
    } finally { c.close(); }
  });

  it("stops at the first step that does not match, says which, and exits non-zero", async () => {
    const c = testCloud({ engine: true });
    try {
      // A ledger that answers one entry short.
      const fetch = async (input: string, init?: RequestInit) => {
        const res = await c.fetch(input, init);
        if (!input.includes("/v1/ledger/entries")) return res;
        const body = (await res.json()) as { items: unknown[] };
        return new Response(JSON.stringify({ ...body, items: body.items.slice(1) }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const lines: string[] = [];
      const out = await runSmoke({ base: ORIGIN, adminToken: ADMIN_TOKEN, fetch, log: (l) => lines.push(l) });
      expect(out.failed).toMatchObject({ step: "read the ledger back", reason: expect.stringContaining("7") });
      expect(lines.at(-1)).toMatch(/^smoke: FAILED at "read the ledger back": /);
      const code = await main([ORIGIN], { PURSER_ADMIN_TOKEN: ADMIN_TOKEN }, { fetch, log: () => undefined });
      expect(code).toBe(1);
    } finally { c.close(); }
  });

  it("asks for the base URL and the admin token, and names the variable, never its value", async () => {
    const lines: string[] = [];
    expect(await main([], { PURSER_ADMIN_TOKEN: "x" }, { fetch: async () => new Response(null), log: (l) => lines.push(l) })).toBe(2);
    expect(await main(["https://cloud.test"], {}, { fetch: async () => new Response(null), log: (l) => lines.push(l) })).toBe(2);
    expect(await main(["not a url"], { PURSER_ADMIN_TOKEN: "secret-value" }, { fetch: async () => new Response(null), log: (l) => lines.push(l) })).toBe(2);
    expect(lines.join("\n")).toMatch(/PURSER_ADMIN_TOKEN/);
    expect(lines.join("\n")).not.toContain("secret-value");
  });

  it("checks the cloud alone with --plain: health, a company, a sign-in, its invoices; the engine is not asked", async () => {
    const c = testCloud({ engine: true });
    try {
      const asked: string[] = [];
      const fetch = (input: string, init?: RequestInit) => { asked.push(new URL(input).pathname); return c.fetch(input, init); };
      const lines: string[] = [];
      const out = await runSmoke({ base: ORIGIN, adminToken: ADMIN_TOKEN, fetch, log: (l) => lines.push(l), plain: true });
      expect(out.failed, JSON.stringify(out)).toBeNull();
      expect(out.steps.map((s) => s.step)).toEqual([...PLAIN_STEPS]);
      expect(asked.some((p) => p.startsWith("/v1/engine"))).toBe(false);
      expect(await main([ORIGIN, "--plain"], { PURSER_ADMIN_TOKEN: ADMIN_TOKEN }, { fetch: c.fetch, log: () => undefined })).toBe(0);
    } finally { c.close(); }
  });

  it("runs N companies at once with --parallel, each polling the engine's events while it works, and reports p50 and p95", async () => {
    const c = testCloud({ engine: true });
    try {
      const lines: string[] = [];
      const out = await runParallel({ base: ORIGIN, adminToken: ADMIN_TOKEN, fetch: c.fetch, log: (l) => lines.push(l), n: 3, pollMs: 50 });
      expect(out.runs).toHaveLength(3);
      for (const r of out.runs) expect(r.failed, JSON.stringify(r)).toBeNull();
      // Every step of the chain, and the polls, with their percentiles.
      expect(Object.keys(out.steps).sort()).toEqual([...SMOKE_STEPS].sort());
      for (const st of Object.values(out.steps)) { expect(st.n).toBe(3); expect(st.p95).toBeGreaterThanOrEqual(st.p50); }
      expect(out.polls.n).toBeGreaterThan(0);
      expect(out.polls.p95).toBeGreaterThanOrEqual(out.polls.p50);
      expect(out.errors).toEqual([]);
      expect(out.ok).toBe(true);
      expect(lines.join("\n")).toMatch(/polls: \d+, p50 \d+ ms, p95 \d+ ms/);
      expect(lines.at(-1)).toBe("smoke: 3 of 3 companies passed");
      expect(lines.join("\n")).not.toContain(ADMIN_TOKEN);
      expect(await main([ORIGIN, "--parallel", "2", "--poll", "50"], { PURSER_ADMIN_TOKEN: ADMIN_TOKEN }, { fetch: c.fetch, log: () => undefined })).toBe(0);
    } finally { c.close(); }
  });

  it("reports every answer that is not 2xx word for word, and 429 and 5xx by route, and fails the run", async () => {
    const c = testCloud({ engine: true });
    try {
      let polls = 0;
      // Every second poll of the events is answered as an overloaded cloud would.
      const fetch = async (input: string, init?: RequestInit) => {
        if (new URL(input).pathname === "/v1/engine/events" && ++polls % 2 === 0) return new Response(JSON.stringify({ error: "slow down", code: "slow_down" }), { status: 429 });
        return c.fetch(input, init);
      };
      const lines: string[] = [];
      const out = await runParallel({ base: ORIGIN, adminToken: ADMIN_TOKEN, fetch, log: (l) => lines.push(l), n: 2, pollMs: 20 });
      expect(out.ok).toBe(false);
      expect(out.errors.length).toBeGreaterThan(0);
      expect(out.errors[0]).toMatchObject({ route: "GET /v1/engine/events", status: 429, body: expect.stringContaining("slow down") });
      expect(out.byRoute["GET /v1/engine/events"]).toMatchObject({ 429: expect.any(Number) });
      expect(lines.join("\n")).toMatch(/429 GET \/v1\/engine\/events/);
      expect(lines.at(-1)).toMatch(/^smoke: 2 of 2 companies passed; \d+ answers were not 2xx$/);
    } finally { c.close(); }
  });
});

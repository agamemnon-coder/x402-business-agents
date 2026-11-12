// npm run cloud:smoke (scripts/engine-smoke.ts): the engine's chain against a running cloud, step by step with its wall
// time. Here only against a cloud in this process (testCloud with the Node engine) through its own fetch: no network.
import { describe, expect, it } from "vitest";
import { CHANGED_TERMS, main, runSmoke, SMOKE_STEPS } from "../scripts/engine-smoke.js";
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
});

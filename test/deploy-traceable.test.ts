// ASVS 4.0.3 V1.14.4, V14.1.1 (docs/security/asvs-l2.md): a repeatable deploy (scripts/deploy.ts, npm run deploy) that
// refuses a dirty tree or a commit that is not on origin/main, stamps the commit and the build time into each Worker,
// and after deploying checks the live /health reports that commit and the baseline security headers are served.
// Both Workers' health answers carry the stamp: kit11's /health and purser-try's /v1/health.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Relay, type Sql } from "../worker/src/core.js";
import { testCloud } from "./support/cloud.js";
import { deployRefusal, liveProblems, stampArgs, TARGETS } from "../scripts/deploy.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("each Worker's health says which commit it runs", () => {
  it("purser-try's /v1/health: build.sha and build.built_at from the deploy's vars, version the short sha", async () => {
    const c = testCloud();
    try {
      c.env.version = SHA.slice(0, 12);
      c.env.build = { sha: SHA.slice(0, 12), built_at: "2026-11-20T10:00:00.000Z" };
      const h = await c.req("GET", "/v1/health");
      expect(h.json).toMatchObject({ version: SHA.slice(0, 12), build: { sha: SHA.slice(0, 12), built_at: "2026-11-20T10:00:00.000Z" } });
      c.env.build = undefined;
      expect((await c.req("GET", "/v1/health")).json.build).toEqual({ sha: null, built_at: null });
    } finally { c.close(); }
  });

  it("kit11's /health: the same build block", async () => {
    const db = new Database(":memory:");
    const sql: Sql = { exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
    const r = new Relay(sql, { relayToken: "t".repeat(64), now: () => new Date("2026-11-20T10:00:00Z"), build: { sha: SHA.slice(0, 12), built_at: "2026-11-20T09:59:00.000Z" } });
    const body = await (await r.fetch(new Request("https://kit11.test/health"))).json() as Record<string, unknown>;
    expect(body.build).toEqual({ sha: SHA.slice(0, 12), built_at: "2026-11-20T09:59:00.000Z" });
    const bare = new Relay(sql, { relayToken: "t".repeat(64) });
    expect(((await (await bare.fetch(new Request("https://kit11.test/health"))).json()) as Record<string, unknown>).build).toEqual({ sha: null, built_at: null });
  });
});

describe("the deploy's rules (scripts/deploy.ts)", () => {
  it("refuses a dirty tree, a commit not on origin/main, and an unknown commit", () => {
    expect(deployRefusal({ dirty: [" M cloud/src/app.ts"], sha: SHA, onOriginMain: true })).toMatch(/uncommitted/);
    expect(deployRefusal({ dirty: [], sha: SHA, onOriginMain: false })).toMatch(/not on origin\/main/);
    expect(deployRefusal({ dirty: [], sha: "", onOriginMain: true })).toMatch(/commit/);
    expect(deployRefusal({ dirty: [], sha: SHA, onOriginMain: true })).toBeNull();
  });

  it("stamps the short commit and the build time as Worker vars, nothing secret", () => {
    expect(stampArgs(SHA, new Date("2026-11-20T10:00:00Z"))).toEqual(["--var", `GIT_SHA:${SHA.slice(0, 12)}`, "--var", "BUILT_AT:2026-11-20T10:00:00.000Z"]);
  });

  it("deploys purser-try and kit11, each checked at its own health path", () => {
    expect(TARGETS.map((t) => [t.name, t.health])).toEqual([["purser-try", "/v1/health"], ["kit11", "/health"]]);
  });

  it("after deploying, the live health must report the same commit and the baseline headers", () => {
    const headers = new Headers({ "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
    expect(liveProblems({ status: 200, headers, body: { build: { sha: SHA.slice(0, 12) } } }, SHA)).toEqual([]);
    expect(liveProblems({ status: 200, headers, body: { build: { sha: "fedcba987654" } } }, SHA)).toEqual([expect.stringMatching(/reports fedcba987654, not 0123456789ab/)]);
    expect(liveProblems({ status: 200, headers, body: { version: "dev" } }, SHA)).toEqual([expect.stringMatching(/reports no commit/)]);
    expect(liveProblems({ status: 200, headers: new Headers(), body: { build: { sha: SHA.slice(0, 12) } } }, SHA)).toEqual([expect.stringMatching(/strict-transport-security/), expect.stringMatching(/x-content-type-options/)]);
  });
});

// Every route of Purser Cloud's API states its auth requirement, and the router enforces it (zero-trust hardening, 13 Nov).
// It holds: each route in the table names one of the five requirements; the routes anyone may call are exactly the list
// below, each with the reason it needs no key or session (a route made public by mistake fails here until it is
// reviewed and added); every other route, called with no credential, is refused with 401 before it runs; and the
// sensitive settings (alert targets, the webhook, connector tokens, keys, team members, the export, closing) all need a
// fresh passkey check (cloud/src/stepUp.ts), so a sensitive write added without it fails here too.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { SESSION_ONLY_ROUTES, STEP_UP_ROUTES } from "../cloud/src/stepUp.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const NEEDS = new Set(["public", "platform", "read", "sync", "admin"]);

/** The public routes and why each needs no key or session: it is the sign-in itself, checks its own signature, or holds nothing of a company. */
const PUBLIC: Record<string, string> = {
  "GET /v1/health": "an uptime monitor's: no company's data",
  "POST /v1/airwallex/webhook": "Airwallex's: its own signature (x-signature) is checked, failures are counted per address",
  "GET /v1/connect/{provider}/callback": "the provider's redirect: stores nothing, forwards the code to the signed-in owner's console",
  "POST /v1/connect/airwallex/webhook": "Airwallex's: its own signature is checked, failures are counted per address",
  "GET /v1/openapi.json": "the API's description",
  "GET /v1/openapi.read.json": "the read API's description",
  "GET /v1/connections": "the catalogue of connections: no company's data",
  "POST /v1/auth/challenge": "the passkey sign-in's first step (rate limited per address)",
  "POST /v1/auth/login": "the passkey sign-in (rate limited per address)",
  "POST /v1/auth/enrol": "a passkey enrolment: its single-use secret is the credential",
  "POST /v1/auth/invite": "an invite's secret is the credential",
  "POST /v1/auth/guest": "the demo company's read-only guest session: made-up data",
  "GET /v1/export/download/{id}/{part}": "a 15-minute signed link is the credential",
  "GET /v1/stats": "the cloud's own counters: no company's id or amount",
  "POST /v1/try/start": "the hands-on demo's own test company (test money, 24 hours)",
  "POST /v1/try/challenge": "the hands-on demo's bot check",
  "POST /v1/try/session": "the visitor's token is the credential",
  "GET /v1/try/counter": "the demo's public counter",
  "POST /v1/try/feedback": "the demo's feedback form",
  "GET /v1/try/ops": "answers 404 unless the platform admin's token is sent with POST",
  "GET /connect-ai": "a page",
  "GET /favicon.ico": "an icon", "GET /favicon.svg": "an icon", "GET /apple-touch-icon.png": "an icon", "GET /icon.png": "an icon",
  "GET /.well-known/oauth-protected-resource": "OAuth discovery", "GET /.well-known/oauth-protected-resource/mcp": "OAuth discovery",
  "GET /.well-known/oauth-authorization-server": "OAuth discovery",
  "POST /oauth/register": "OAuth dynamic client registration: grants nothing by itself",
  "GET /oauth/authorize": "the consent page: the owner pastes a connector token there (rate limited per address)",
  "POST /oauth/authorize": "the consent page's answer: its own signed, single-use form token",
  "POST /oauth/token": "OAuth's token request: a code bound to its PKCE verifier",
};

const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
const filled = (path: string) => path.replace(/\{[^}]+\}/g, "x1");

let c: TestCloud, ip = 0;
beforeEach(() => { c = testCloud(); });
afterEach(() => c.close());

describe("every API route states its auth requirement", () => {
  it("names one of public, platform, read, sync or admin, and no route is listed twice", () => {
    const bad = ROUTES.filter((r) => !NEEDS.has(String((r as { need?: unknown }).need))).map(key);
    expect(bad).toEqual([]);
    expect(new Set(ROUTES.map(key)).size).toBe(ROUTES.length);
  });

  it("opens to anyone only the routes on the reviewed list, each with its reason", () => {
    expect(ROUTES.filter((r) => r.need === "public").map(key).sort()).toEqual(Object.keys(PUBLIC).sort());
  });

  it("refuses every other route with 401 when no credential is sent, before it runs", async () => {
    const leaks: string[] = [];
    for (const r of ROUTES.filter((x) => x.need !== "public")) {
      // Each from its own address: failed sign-ins are counted per address, and past twenty the answer is 429.
      const res = await c.req(r.method, filled(r.path), { headers: { "cf-connecting-ip": `198.51.100.${++ip % 250}` }, ...(r.method === "GET" ? {} : { body: {} }) });
      if (res.status !== 401) leaks.push(`${key(r)} answered ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("refuses a made-up bearer token on every route that needs one", async () => {
    const leaks: string[] = [];
    for (const r of ROUTES.filter((x) => x.need !== "public")) {
      const res = await c.req(r.method, filled(r.path), { key: "pcs.e30.not-signed", headers: { "cf-connecting-ip": `203.0.113.${++ip % 250}` }, ...(r.method === "GET" ? {} : { body: {} }) });
      if (res.status !== 401) leaks.push(`${key(r)} answered ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });
});

describe("sensitive settings need a fresh passkey check", () => {
  it("lists only routes that exist and need admin", () => {
    const table = new Map(ROUTES.map((r) => [key(r), r]));
    for (const k of STEP_UP_ROUTES) {
      expect(table.has(k), k).toBe(true);
      expect(table.get(k)!.need, k).toBe("admin");
    }
    for (const k of SESSION_ONLY_ROUTES) expect(STEP_UP_ROUTES.has(k), k).toBe(true);
  });

  it("covers every write to alert targets, the webhook, connector tokens, keys and team members", () => {
    const sensitive = ROUTES.filter((r) => r.method !== "GET" && r.need === "admin" && (
      /^\/v1\/(alerts|webhook|keys|users|claude\/connectors)(\/|$)/.test(r.path) || r.path === "/v1/connect/{provider}/start" || (r.path === "/v1/connect/{provider}" && r.method === "DELETE")));
    expect(sensitive.length).toBeGreaterThan(10);
    expect(sensitive.map(key).filter((k) => !STEP_UP_ROUTES.has(k))).toEqual([]);
  });
});

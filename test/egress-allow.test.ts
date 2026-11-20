// ASVS 4.0.3 V12.6.1 (docs/security/asvs-l2.md): the addresses a company or a client sets for Purser Cloud to call (the
// alert webhook, Slack and Teams alert targets, a Claude client's metadata document) pass one allow rule
// (cloud/src/egress.ts), when they are set and again before each request: https on port 443, a public host name, never
// an address, a local or reserved name, a cloud metadata host, or a name that maps to an address (nip.io and the like).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { egressProblem } from "../cloud/src/egress.js";
import { isCimdId } from "../cloud/src/claude/oauth.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

describe("the allow rule for user-set addresses (V12.6.1)", () => {
  it("takes a public https host", () => {
    for (const u of ["https://hooks.example.com/purser", "https://hooks.slack.com/services/T0/B0/x", "https://prod-12.westeurope.logic.azure.com:443/workflows/1"]) expect(egressProblem(u), u).toBeNull();
  });

  it("refuses http, other ports, credentials and what is not a URL", () => {
    for (const u of ["http://hooks.example.com/x", "ftp://hooks.example.com/x", "https://hooks.example.com:8443/x", "https://user:pw@hooks.example.com/x", "not a url", "javascript:alert(1)"]) expect(egressProblem(u), u).not.toBeNull();
  });

  it("refuses private, loopback, link-local and other address literals, in every spelling", () => {
    for (const u of ["https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.0.1/x", "https://172.16.0.1/x", "https://169.254.169.254/latest/meta-data", "https://0x7f.0.0.1/x", "https://2130706433/x",
      "https://0177.0.0.1/x", "https://[::1]/x", "https://[fe80::1]/x", "https://[::ffff:127.0.0.1]/x", "https://[fd00::1]/x", "https://100.100.100.200/x", "https://8.8.8.8/x"]) expect(egressProblem(u), u).not.toBeNull();
  });

  it("refuses local and reserved names, metadata hosts and names that map to an address", () => {
    for (const u of ["https://localhost/x", "https://intranet/x", "https://printer.local/x", "https://db.internal/x", "https://metadata.google.internal/computeMetadata/v1/", "https://metadata.goog/x",
      "https://instance-data/x", "https://1.0.0.127.in-addr.arpa/x", "https://127.0.0.1.nip.io/x", "https://10-0-0-1.sslip.io/x", "https://app.localtest.me/x",
      "https://x.lvh.me/x", "https://hooks.127.0.0.1.example.com/x", "https://a.b.onion/x", "https://hooks.example.com./x"]) expect(egressProblem(u), u).not.toBeNull();
  });

  it("a Claude client's metadata address follows the same rule", () => {
    expect(isCimdId("https://claude.ai/oauth/claude-code-client-metadata")).toBe(true);
    expect(isCimdId("https://127.0.0.1.nip.io/client.json")).toBe(false);
    expect(isCimdId("https://metadata.google.internal/client.json")).toBe(false);
  });
});

describe("the rule holds at the routes and before each delivery (V12.6.1)", () => {
  let c: TestCloud;
  let t: TestTenant;
  beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
  afterEach(() => c.close());

  it("the alert webhook refuses an address that maps to a private one", async () => {
    const r = await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://127.0.0.1.nip.io/hook" } });
    expect(r.status).toBe(400);
  });

  it("a webhook stored before the rule is not called", async () => {
    const calls: string[] = [];
    c.env.outbound = async (url: string) => { calls.push(url); return new Response("ok"); };
    expect((await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example.com/x" } })).status).toBe(200);
    await c.env.sql.run("UPDATE webhooks SET url = ? WHERE tenant_id = ?", ["https://169.254.169.254/latest/meta-data", t.id]);
    const { notify } = await import("../cloud/src/monitor.js");
    expect(await notify(c.env.sql, t.id, "test.event", { a: "b" }, c.clock.now, c.env.outbound, 0)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("the chat hooks and the OIDC providers follow it too (V12.6.1)", () => {
  it("a Slack or Teams hook is still held to its exact shape, and a stored URL past the rule is never posted to", async () => {
    const { chatHookUrl, testChatHook } = await import("../cloud/src/chatHooks.js");
    expect(() => chatHookUrl("slack", "https://127.0.0.1.nip.io/services/T000/B000/XXXXXXXXXXXX")).toThrow();
    expect(() => chatHookUrl("slack", "https://hooks.slack.com.evil.example/services/T000/B000/XXXXXXXXXXXX")).toThrow();
    expect(chatHookUrl("slack", "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX")).toBe("https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX");
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const calls: string[] = [];
      const out = async (url: string) => { calls.push(url); return new Response("ok"); };
      await c.env.sql.run("INSERT INTO chat_hooks (tenant_id, id, url, created_at, created_by, consecutive_failures) VALUES (?, 'slack', ?, ?, 'test', 0)", [t.id, "https://169.254.169.254/latest/meta-data", c.clock.now.toISOString()]);
      const r = await testChatHook({ sql: c.env.sql, tenantId: t.id, now: c.clock.now, out, retryDelayMs: 0, origin: "https://cloud.test" }, "slack");
      expect(r.delivered).toBe(false);
      expect(calls).toEqual([]);
    } finally { c.close(); }
  });

  it("every OIDC provider endpoint Purser calls passes the rule", async () => {
    const { idpOf } = await import("../cloud/src/oidc.js");
    for (const [name, client] of [["google", { clientId: "x" }], ["microsoft", { clientId: "x" }], ["microsoft", { clientId: "x", tenant: "organizations" }], ["apple", { clientId: "x" }]] as const) {
      const idp = idpOf(name, client);
      for (const u of [idp.token, idp.jwks]) expect(egressProblem(u), u).toBeNull();
    }
  });
});

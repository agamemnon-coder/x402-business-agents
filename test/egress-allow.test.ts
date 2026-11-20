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

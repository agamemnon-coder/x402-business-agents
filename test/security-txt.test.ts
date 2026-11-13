// /.well-known/security.txt (RFC 9116) on both Workers: the relay and Purser Cloud (final review S5). It names how to
// report a vulnerability (SECURITY.md's private advisory), the policy, and an expiry in the future, within a year.
import { afterEach, describe, expect, it } from "vitest";
import { SECURITY_TXT, SECURITY_TXT_EXPIRES } from "../src/lib/securityTxt.js";
import { pageResponse } from "../worker/src/core.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud | null = null;
afterEach(() => { c?.close(); c = null; });

describe("security.txt", () => {
  it("says where to report, the policy, and when it expires (within a year of 13 Nov 2026)", () => {
    expect(SECURITY_TXT).toMatch(/^Contact: https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/security\/advisories\/new$/m);
    expect(SECURITY_TXT).toMatch(/^Policy: .*SECURITY\.md$/m);
    const left = Date.parse(SECURITY_TXT_EXPIRES) - Date.parse("2026-11-13T00:00:00Z");
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(366 * 86_400_000);
  });

  it("is served by the relay and by Purser Cloud, as plain text over HSTS", async () => {
    const relay = pageResponse(new Request("https://kit11.example/.well-known/security.txt"), {} as never)!;
    expect(relay.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await relay.text()).toBe(SECURITY_TXT);
    c = testCloud();
    const r = await c.req("GET", "/.well-known/security.txt");
    expect(r.status).toBe(200);
    expect(await r.res.text()).toBe(SECURITY_TXT);
    expect(r.res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});

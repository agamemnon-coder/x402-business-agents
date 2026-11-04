// The local stand-in for the Worker serves the same pages and API over plain Node http.
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalRelay } from "../src/relay/local.js";

describe("local relay", () => {
  const servers: Server[] = [];
  afterEach(() => { while (servers.length) servers.pop()!.close(); });

  it("serves the pages under their CSP and answers the runner with its token only", async () => {
    const { server, url } = await startLocalRelay({ port: 0, token: "local-token" });
    servers.push(server);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    const page = await fetch(`${url}/approve/P-0001`);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await page.text()).toContain('data-page="approve"');
    expect((await fetch(`${url}/assets/approve.js`)).headers.get("content-type")).toMatch(/javascript/);
    const sync = (token: string) => fetch(`${url}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ state_hash: "x" }) });
    expect((await sync("nope")).status).toBe(401);
    expect(await (await sync("local-token")).json()).toEqual({ need_state: true, inbox: [], hooks: [] });
    expect((await fetch(`${url}/nothing`)).status).toBe(404);
  });
});

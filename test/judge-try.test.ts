// npm run judge serves the hands-on /try (src/cli/judgeTry.ts): the hosted page's v2 frame (the Live engine rail, the
// recording-mode script), answered by Purser Cloud in the judge's own process, with a label that says it is the
// offline copy; its API works with no key and no network (a test company starts, code reads, the simulated bank pays).
// The earlier task demo moved to /tasks. The browser run is test/browser/judge-try.check.ts.
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_PATHS, judgeMenu, startJudge } from "../src/cli/judge.js";
import { OFFLINE_TRY_NOTE, OFFLINE_WORDS } from "../src/cli/judgeTry.js";
import { TRY_PAGE_OFFLINE } from "../src/servers/dashboard.js";
import { tryPageResponse } from "../cloud/src/tryPage.js";
import type { CloudEnv } from "../cloud/src/app.js";

let server: Server;
let base: string;
beforeAll(async () => { ({ server, url: base } = await startJudge(0)); });
afterAll(() => server?.close());

const hosted = async () => tryPageResponse(new Request("https://kit11.max-31b.workers.dev/try"), new URL("https://kit11.max-31b.workers.dev/try"), { origin: "https://kit11.max-31b.workers.dev", rpId: "kit11.max-31b.workers.dev" } as CloudEnv).text();

describe("npm run judge: the hands-on /try, offline", () => {
  it("serves the hosted page's v2 frame (the Live engine rail), for this origin, with the offline label", async () => {
    const res = await fetch(`${base}/try`);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const marker of ["pv-rail", "Live engine", "pv-shell", '<main id="main">']) expect({ marker, has: html.includes(marker) }).toEqual({ marker, has: true });
    expect(html).toContain(`<p class="judge-offline" role="note">${OFFLINE_TRY_NOTE}</p>`);
    // The passkey belongs to this server: the page's config names http://localhost:<port> and rpId localhost.
    const cfg = JSON.parse(/<meta name="purser-try" content="([^"]+)">/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as { origin: string; rpId: string };
    expect(cfg).toMatchObject({ origin: base, rpId: "localhost" });
    // The label's style is under the page's own nonce, as the policy allows.
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")![1]!;
    expect(html).toContain(`<style nonce="${nonce}">.judge-offline{`);
  });

  it("says code reads the invoice and the simulated bank pays, in place of each of the hosted page's fixed words", async () => {
    const page = await hosted();
    const offline = await (await fetch(`${base}/try`)).text();
    for (const [h, o] of OFFLINE_WORDS) {
      expect({ h, hosted: page.includes(h) }).toEqual({ h, hosted: true });
      expect({ h, offline: offline.includes(h), says: offline.includes(o) }).toEqual({ h, offline: false, says: true });
    }
    // Its links to the site's pages stay on this computer; only the share preview's image names the hosted site.
    expect(offline.match(/https:\/\/kit11\.max-31b\.workers\.dev\/(home|proof|books|airwallex|alta|visa|security|docs|claude|runs|verify|assets\/logo-airwallex)/g)).toBeNull();
  });

  it("starts a test company through the judge, offline: code reads (no Claude), the simulated bank (no Airwallex)", async () => {
    const start = await fetch(`${base}/v1/try/start`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" });
    expect(start.status).toBe(201);
    const s = (await start.json()) as { session: string; tenant: string; mode: Record<string, string> };
    expect(s.tenant).toMatch(/^t_try_/);
    expect(s.mode).toEqual({ claude: "code", agents: "code", rail_awx: "off" });
    const auth = { authorization: `Bearer ${s.session}`, origin: base };
    const samples = (await (await fetch(`${base}/v1/engine/samples`, { headers: auth })).json()) as { items: { key: string; title: string }[] };
    expect(samples.items.length).toBeGreaterThan(1);
    const filed = await fetch(`${base}/v1/engine/samples/${samples.items[0]!.key}`, { method: "POST", headers: auth });
    expect(filed.status).toBe(200);
    // A request from another site is refused, as on the hosted demo.
    expect((await fetch(`${base}/v1/try/start`, { method: "POST", headers: { origin: "https://elsewhere.example", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  });

  it("sends 127.0.0.1 to localhost, where the passkey belongs", async () => {
    const r = await fetch(`${base.replace("localhost", "127.0.0.1")}/try?present=1`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`${base}/try?present=1`);
  });

  it("keeps the earlier task demo at /tasks, and checks and names both", async () => {
    expect(await (await fetch(`${base}/tasks`)).text()).toBe(TRY_PAGE_OFFLINE);
    expect(CHECK_PATHS).toEqual(expect.arrayContaining(["/try", "/tasks"]));
    const menu = judgeMenu(base).join("\n");
    expect(menu).toContain(`${base}/try           the hands-on demo`);
    expect(menu).toContain(`${base}/tasks         the earlier offline task demo`);
  });
});

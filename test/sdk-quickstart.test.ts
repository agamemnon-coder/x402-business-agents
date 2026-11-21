// The SDK quickstart (cloud/src/claude/sdkQuickstart.ts): both snippets run against Purser Cloud in this process (behind a
// listener on 127.0.0.1) and answer which invoice waits for the CFO; the README, docs/integrations/README.md and
// /connect-ai carry the same snippets; nothing says npm or PyPI, since neither client is published.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sdkQuickstart, sdkQuickstartMarkdown } from "../cloud/src/claude/sdkQuickstart.js";
import { connectPage } from "../cloud/src/claude/connectPage.js";
import { Purser } from "../sdk/typescript/src/index.js";
import { integrationsWorld, listen, type IntegrationsWorld } from "./support/integrationsWorld.js";

const run = promisify(execFile);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

let w: IntegrationsWorld, base: string, server: Server;
beforeAll(async () => {
  w = await integrationsWorld();
  ({ base, server } = await listen(w.c));
  // One invoice waiting for the CFO: a propose key files it (nothing is paid).
  await new Purser({ baseUrl: base, apiKey: w.proposeKey }).proposePayment("AP-0001");
}, 60_000);
afterAll(() => { server.close(); w.c.close(); });

const q = sdkQuickstart();
const WAITS = "AP-0001 Bergtex Textil GmbH EUR 1850.00 waits for the CFO";

describe("the SDK quickstart", () => {
  it("Python: with a read key, prints the invoice that waits for the CFO", async () => {
    const out = await run("python3", ["-B", "-c", q.py], { env: { PATH: process.env.PATH ?? "", PURSER_URL: base, PURSER_API_KEY: w.readKey }, timeout: 60_000 });
    expect(out.stdout.trim()).toBe(WAITS);
  });

  it("TypeScript: with a read key, prints the invoice that waits for the CFO", async () => {
    const out = await run("npx", ["tsx", "--input-type=module", "-e", q.ts], { env: { PATH: process.env.PATH ?? "", PURSER_URL: base, PURSER_API_KEY: w.readKey }, timeout: 90_000 });
    expect(out.stdout.trim()).toBe(WAITS);
  }, 120_000);

  it("is 5 to 8 lines each, takes a placeholder key, never a real one, and installs from the repository", () => {
    for (const s of [q.ts, q.py]) {
      expect(s.split("\n").length).toBeGreaterThanOrEqual(5);
      expect(s.split("\n").length).toBeLessThanOrEqual(8);
    }
    expect(q.shell).toContain("PURSER_API_KEY=pck_...");
    expect(q.shell).toContain("git clone https://github.com/agamemnon-coder/x402-business-agents");
    expect(`${q.shell}${q.ts}${q.py}`).not.toMatch(/pck_[A-Za-z0-9]{4,}|npm install|pip install/);
  });

  it("the README, docs/integrations/README.md and /connect-ai carry the same snippets, and say the clients are not published", async () => {
    for (const f of ["README.md", "docs/integrations/README.md"]) {
      const md = readFileSync(f, "utf8");
      expect({ f, has: md.includes(sdkQuickstartMarkdown()) }).toEqual({ f, has: true });
      expect({ f, says: /not published to npm or PyPI/.test(md) }).toEqual({ f, says: true });
    }
    const html = await connectPage("https://purser.example.com").text();
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    for (const s of [q.shell, q.ts, q.py]) expect(html).toContain(esc(s));
    expect(html).toContain("not published to npm or PyPI");
  });
});

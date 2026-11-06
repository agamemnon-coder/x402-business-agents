// The suite's own guard (test/support/noNetwork.ts, test/support/no-network.cjs): no live key in a test's environment,
// and no request to a host that is not this machine, here or in a child process a test starts.
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { LIVE_KEYS } from "./support/noNetwork.js";

// These refusals are on purpose: kept out of a logging preload's count (NETLOG_FILE), which is for accidents.
const quiet = <T>(fn: () => T): T => { const log = process.env.NETLOG_FILE; delete process.env.NETLOG_FILE; try { return fn(); } finally { if (log !== undefined) process.env.NETLOG_FILE = log; } };

describe("the test suite's network guard", () => {
  it("leaves no live key in the environment", () => {
    for (const k of LIVE_KEYS) expect(process.env[k], k).toBeUndefined();
  });

  it("refuses fetch, http and https to any outside host before anything is sent", async () => {
    await expect(quiet(() => fetch("https://x402-testnet.metalntwx.com/x402/facilitator/supported"))).rejects.toThrow(/no network in the test suite/);
    await expect(quiet(() => fetch(new URL("https://api.sandbox.airwallex.com/api/v1/balances/current")))).rejects.toThrow(/no network/);
    expect(() => quiet(() => https.request("https://api.anthropic.com/v1/messages"))).toThrow(/no network/);
    expect(() => quiet(() => http.get({ hostname: "example.com", path: "/" }))).toThrow(/no network/);
  });

  it("lets a test talk to its own local server", async () => {
    const server = http.createServer((_q, r) => r.end("ok")).listen(0, "127.0.0.1");
    await new Promise((ok) => server.once("listening", ok));
    try {
      const { port } = server.address() as AddressInfo;
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
      expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe("ok");
    } finally {
      server.close();
    }
  });

  it("goes with a child process a test starts", () => {
    const r = spawnSync(process.execPath, ["-e", "fetch('https://example.com/').then(() => console.log('SENT'), (e) => console.log(e.message))"], { env: { ...process.env, NETLOG_FILE: "" }, encoding: "utf8", timeout: 20_000, cwd: resolve(import.meta.dirname, "..") });
    expect(r.stdout).toMatch(/no network in the test suite/);
    expect(r.stdout).not.toMatch(/SENT/);
  });
});

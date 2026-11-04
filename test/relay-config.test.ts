// Where the runner finds the relay and how it proves itself to it, from the environment the session already has.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { relayConfig, relayToken, WORKER_NAME } from "../src/relay/config.js";

const CF = { CLOUDFLARE_API_TOKEN: "cf-token-abc", CLOUDFLARE_ACCOUNT_ID: "acct-1" };
const subdomain = (sub: string) => (async (url: string | URL | Request) => {
  expect(String(url)).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/workers/subdomain");
  return new Response(JSON.stringify({ success: true, result: { subdomain: sub } }));
}) as typeof fetch;

describe("relay config", () => {
  it("derives the relay token from the Cloudflare token unless one is set, and never returns the Cloudflare token", () => {
    expect(relayToken({ KIT11_RELAY_TOKEN: "set-by-hand", ...CF })).toBe("set-by-hand");
    const derived = relayToken(CF)!;
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).toBe(relayToken({ ...CF }));
    expect(derived).not.toBe(relayToken({ CLOUDFLARE_API_TOKEN: "another" }));
    expect(derived).not.toContain(CF.CLOUDFLARE_API_TOKEN);
    expect(relayToken({})).toBeNull();
  });

  it("finds the workers.dev address from the account, or takes the one set; rpId and origin follow it", async () => {
    expect(await relayConfig(CF, subdomain("max-31b"))).toEqual({
      url: "https://kit11.max-31b.workers.dev", origin: "https://kit11.max-31b.workers.dev", rpId: "kit11.max-31b.workers.dev", token: relayToken(CF),
    });
    expect(await relayConfig({ KIT11_RELAY_URL: "http://localhost:4400/", KIT11_RELAY_TOKEN: "x" })).toMatchObject({ url: "http://localhost:4400", rpId: "localhost" });
  });

  it("explains what is missing without echoing a secret", async () => {
    await expect(relayConfig({})).rejects.toThrow(/KIT11_RELAY_URL/);
    const failing = (async () => new Response(JSON.stringify({ success: false, errors: [{ message: "Authentication error" }] }), { status: 403 })) as typeof fetch;
    await expect(relayConfig(CF, failing)).rejects.toThrow(/Authentication error/);
    await expect(relayConfig(CF, failing)).rejects.not.toThrow(/cf-token-abc/);
  });

  it("uses the Worker name the deploy uses", () => {
    expect(readFileSync(new URL("../worker/wrangler.jsonc", import.meta.url), "utf8")).toContain(`"name": "${WORKER_NAME}"`);
  });
});

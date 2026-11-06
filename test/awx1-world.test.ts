// What an Airwallex-only world (awx-1) needs from the tools around the scenario: npm run verify must not ask for Metal
// accounts that world never made; the runner's card poll can be slowed or turned off (the webhooks bring the
// transactions, and every poll is a counted call); the call guard counts every request and refuses the one over budget.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { cardPollMs } from "../src/policy/cards.js";
import { Airwallex, AirwallexAmbiguous, fromEnv } from "../src/airwallex/client.js";
import { AirwallexBudgetSpent, budgetedFetch, countByEndpoint, endpointOf, readCallLog } from "../src/airwallex/callBudget.js";

const repo = resolve(import.meta.dirname, "..");
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "awx1-")); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("npm run verify in an Airwallex-only world", () => {
  it("passes on a ledger with no Metal accounts and no dispute, without reaching any network", () => {
    const dir = tmp();
    const ledger = join(dir, "awx-1.sqlite");
    openDb(ledger).close();
    const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: ledger, KIT11_KEYS_DIR: join(dir, "keys") };
    for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY"]) delete env[k];
    const r = spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/verify.ts")], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
    expect(r.stderr).not.toMatch(/no business account/);
    expect(r.stdout).toMatch(/^ok +audit log hash chain/m);
    expect(r.status).toBe(0);
  }, 70_000);
});

describe("the runner's card poll", () => {
  it("polls every 5 s unless the world says otherwise; off turns it off; nonsense is refused", () => {
    expect(cardPollMs({})).toBe(5000);
    expect(cardPollMs({ KIT11_CARD_POLL_MS: "60000" })).toBe(60_000);
    expect(cardPollMs({ KIT11_CARD_POLL_MS: "off" })).toBeNull();
    expect(() => cardPollMs({ KIT11_CARD_POLL_MS: "100" })).toThrow(/at least 1000/);
    expect(() => cardPollMs({ KIT11_CARD_POLL_MS: "soon" })).toThrow(/KIT11_CARD_POLL_MS/);
  });
});

describe("the Airwallex call budget", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("names endpoints without their ids", () => {
    expect(endpointOf("https://api.sandbox.airwallex.com/api/v1/transfers/1b0c2f7e-0b3c-4f3e-9a3e-2b0e1c4d5e6f?x=1")).toBe("/transfers/{id}");
    expect(endpointOf("https://api.sandbox.airwallex.com/api/v1/simulation/transfers/1b0c2f7e-0b3c-4f3e-9a3e-2b0e1c4d5e6f/transition")).toBe("/simulation/transfers/{id}/transition");
    expect(endpointOf("https://api.sandbox.airwallex.com/api/v1/issuing/cards/create")).toBe("/issuing/cards/create");
  });

  it("counts every request, the login too, and refuses the one over budget before it is sent; a refused POST is not ambiguous", async () => {
    const file = join(tmp(), "calls.jsonl");
    const sent: string[] = [];
    const inner = (async (url: string | URL) => { sent.push(String(url)); return String(url).endsWith("/authentication/login") ? ok({ token: "tok" }) : ok({ items: [], has_more: false }); }) as typeof fetch;
    const api = new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: budgetedFetch(inner, { budget: 3, file }), minGapMs: 0 });
    await api.call("GET", "/balances/current");
    await api.call("GET", "/webhooks");
    const refused = api.call("POST", "/transfers/create", { request_id: "r" }).catch((e: unknown) => e);
    expect(await refused).toBeInstanceOf(AirwallexBudgetSpent);
    expect(await refused).not.toBeInstanceOf(AirwallexAmbiguous);
    expect(sent).toHaveLength(3);
    expect(sent.some((u) => u.includes("/transfers/create"))).toBe(false);
    expect(countByEndpoint(readCallLog(file))).toEqual([
      { endpoint: "POST /authentication/login", calls: 1 }, { endpoint: "GET /balances/current", calls: 1 }, { endpoint: "GET /webhooks", calls: 1 },
    ]);
    // Nothing secret in the log: no key, no token, no body.
    expect(JSON.stringify(readCallLog(file))).not.toMatch(/key|tok|request_id/);
  });

  it("is shared by every process of the run: the log on disk is the count", async () => {
    const file = join(tmp(), "calls.jsonl");
    const inner = (async () => ok({ token: "tok", items: [] })) as typeof fetch;
    const a = budgetedFetch(inner, { budget: 2, file }), b = budgetedFetch(inner, { budget: 2, file });
    await a("https://api.sandbox.airwallex.com/api/v1/balances/current");
    await b("https://api.sandbox.airwallex.com/api/v1/balances/current");
    await expect(a("https://api.sandbox.airwallex.com/api/v1/balances/current")).rejects.toBeInstanceOf(AirwallexBudgetSpent);
  });

  it("comes from the environment only as a pair", () => {
    expect(fromEnv({ AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b" })).toEqual({ clientId: "a", apiKey: "b" });
    expect(fromEnv({ AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b", AIRWALLEX_CALL_BUDGET: "90", AIRWALLEX_CALL_LOG: "/tmp/x" })?.fetchImpl).toBeTypeOf("function");
    expect(() => fromEnv({ AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b", AIRWALLEX_CALL_BUDGET: "90" })).toThrow(/go together/);
    expect(() => fromEnv({ AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b", AIRWALLEX_CALL_BUDGET: "many", AIRWALLEX_CALL_LOG: "/tmp/x" })).toThrow(/whole number/);
  });
});

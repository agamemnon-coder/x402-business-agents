// awx-1's call budget (src/awx/plan.ts) is the number Max approves. These tests tie it to the code that makes each call,
// to the record the Claude estimate is read from, and to the runbook that carries it (docs/runs/awx-1-plan.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AWX1_CALLS, AWX1_CLAUDE, averageCostPerCall, byEndpoint, claudeEstimate, planMarkdown, total, WORST_SINGLE_RETRY } from "../src/awx/plan.js";
import { liveRefusals } from "../src/awx/live.js";

const repo = resolve(import.meta.dirname, "..");
const mainRun = JSON.parse(readFileSync(resolve(repo, "docs/demo/main-run.json"), "utf8"));
const src = (f: string) => readFileSync(resolve(repo, "src", f), "utf8");
const airwallexCode = ["airwallex/adapter.ts", "airwallex/issuing.ts", "airwallex/client.ts", "airwallex/webhooks.ts", "airwallex/verify.ts", "cli/health.ts", "cli/awx1.ts"].map(src).join("\n");

describe("the awx-1 call budget", () => {
  it("adds up: 85 calls expected, 96 at most, and the worst single retry is step a again", () => {
    expect(total("expected")).toBe(85);
    expect(total("upTo")).toBe(96);
    expect(byEndpoint().reduce((s, e) => s + e.expected, 0)).toBe(85);
    expect(WORST_SINGLE_RETRY).toMatchObject({ expected: 15, upTo: 21 });
    for (const l of AWX1_CALLS) expect(l.upTo, `${l.method} ${l.endpoint}`).toBeGreaterThanOrEqual(l.expected);
  });

  it("names only endpoints the code really calls, each with the method the code uses", () => {
    for (const l of AWX1_CALLS) {
      if (l.endpoint === "/authentication/login") continue;
      const path = l.endpoint.replace(/\{id\}.*$/, "");
      expect(airwallexCode, `${l.method} ${l.endpoint}`).toContain(path);
    }
    // No simulation call may set a failure reason: the decline codes are Airwallex's own.
    expect(src("airwallex/issuing.ts")).not.toMatch(/transaction_failure_reason/);
  });

  it("makes no Metal call and no call outside the sandbox's documented endpoints", () => {
    expect(AWX1_CALLS.every((l) => l.endpoint.startsWith("/"))).toBe(true);
    expect(planMarkdown(mainRun)).toMatch(/\*\*Metal: 0 calls\*\*/);
  });

  it("reads the Claude estimate from the main run's own trace (docs/demo/main-run.json)", () => {
    const avg = averageCostPerCall(mainRun);
    const opus = mainRun.snapshot.traces.filter((t: { model: string }) => t.model === "claude-opus-5-5");
    const opusCalls = opus.reduce((s: number, t: { request_ids: unknown[] }) => s + t.request_ids.length, 0);
    expect(avg["claude-opus-5-5"]).toBe(Math.ceil(opus.reduce((s: number, t: { cost_usd_micros: number }) => s + t.cost_usd_micros, 0) / opusCalls));
    const c = claudeEstimate(avg);
    expect(c.calls).toBe(AWX1_CLAUDE.reduce((s, x) => s + x.calls, 0));
    expect(c.calls).toBe(14);
    expect(c.micros).toBe(AWX1_CLAUDE.reduce((s, x) => s + x.calls * avg[x.model], 0));
    expect(c.retry.calls).toBe(5);
  });

  it("is in the runbook exactly as the code computes it", () => {
    const runbook = readFileSync(resolve(repo, "docs/runs/awx-1-plan.md"), "utf8");
    expect(runbook).toContain(planMarkdown(mainRun));
  });
});

describe("the accident while preparing awx-1, booked", () => {
  it("is an upper bound in the evals block: 8 invoices at the main run's own average per call, at most 24 calls", () => {
    const lines = readFileSync(resolve(repo, "docs/runs/api-budget.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { block: string; usd_micros: number; what: string });
    const hit = lines.filter((l) => /^ACCIDENT, UPPER BOUND/.test(l.what) && /awx-1/.test(l.what));
    expect(hit).toHaveLength(1);
    const avg = averageCostPerCall(mainRun);
    const perInvoice = avg["claude-haiku-5-5"] + avg["claude-sonnet-5-5"] + avg["claude-opus-5-5"];
    expect(hit[0]).toMatchObject({ block: "evals", usd_micros: 8 * perInvoice });
    expect(hit[0]!.what).toContain(`${avg["claude-haiku-5-5"]} + ${avg["claude-sonnet-5-5"]} + ${avg["claude-opus-5-5"]}`);
    expect(hit[0]!.what).toMatch(/at most 24 Claude calls/);
    expect(hit[0]!.what).toMatch(/not a measured count/);
  });
});

describe("the live run refuses to start", () => {
  const good = {
    AIRWALLEX_CLIENT_ID: "x", AIRWALLEX_API_KEY: "y", AIRWALLEX_CALL_BUDGET: "96", AIRWALLEX_CALL_LOG: "/k/awx-1/calls.jsonl",
    KIT11_DB: "data/awx-1.sqlite", KIT11_KEYS_DIR: "/home/user/x402-business-agents-keys/awx-1", KIT11_AGENTS: "on", KIT11_CARD_POLL_MS: "off",
  };
  it("only when the world, the budget, the agents and the webhooks are set up for it", () => {
    expect(liveRefusals(good, { keysDirHasHookSecret: true })).toEqual([]);
    expect(liveRefusals({ ...good, METAL_RPC_URL: "https://rpc" }, { keysDirHasHookSecret: true })).toEqual([expect.stringMatching(/METAL_RPC_URL must be unset/)]);
    expect(liveRefusals({ ...good, AIRWALLEX_CALL_BUDGET: undefined }, { keysDirHasHookSecret: true })).toEqual([expect.stringMatching(/AIRWALLEX_CALL_BUDGET/)]);
    expect(liveRefusals({ ...good, KIT11_DB: "data/main-1.sqlite" }, { keysDirHasHookSecret: true })).toEqual([expect.stringMatching(/own ledger/)]);
    expect(liveRefusals({ ...good, KIT11_AUTONOMY: "on" }, { keysDirHasHookSecret: true })).toEqual([expect.stringMatching(/autonomous loops reach Metal/)]);
    expect(liveRefusals(good, { keysDirHasHookSecret: false })).toEqual([expect.stringMatching(/webhook secret/)]);
  });
});

// The live coverage check's plan (src/proof/awxCoverageLive.ts, npm run airwallex:coverage-live), run on its in-memory
// stand-in: the order of the calls, what each needs first, the clean-up, a refusal kept not live, and the record the
// coverage report reads. No network: the client's fetch is the stand-in.

import { describe, expect, it } from "vitest";
import { liveRefusals } from "../src/cli/airwallexCoverageLive.js";
import { recordMentions } from "../src/proof/awxCoverage.js";
import { coverageMarkdownRecord, coverageRecord, notingFetch, runCoverageCheck, standInFetch, TARGETS, type HttpLine } from "../src/proof/awxCoverageLive.js";

async function run(o: Parameters<typeof standInFetch>[0] = {}, template: string | null = null) {
  const lines: HttpLine[] = [];
  const rows = await runCoverageCheck({ cfg: { clientId: "stand-in", apiKey: "stand-in", fetchImpl: notingFetch(standInFetch(o), lines), minGapMs: 0 }, lines, runId: "20261119000000", date: "2026-11-19", hostedFlowTemplate: template });
  const rec = coverageRecord(rows, lines, { ranAt: "2026-11-19T09:00:00.000Z", budget: 30, used: lines.length });
  const row = (endpoint: string) => rows.find((r) => r.endpoint === endpoint)!;
  const live = new Set(recordMentions(JSON.parse(JSON.stringify(rec)), "docs/runs/2026-11-19-airwallex-coverage.json").map((m) => `${m.method} ${m.path}`));
  return { rows, lines, rec, row, live };
}

describe("the coverage check on the stand-in", () => {
  it("calls every target once, in order, each through its function, and records each answer", async () => {
    const { rows, lines, rec } = await run();
    expect(rows.map((r) => `${r.method} ${r.endpoint}`)).toEqual(TARGETS.map((t) => `${t.method} ${t.endpoint}`));
    expect(rows.filter((r) => r.live).map((r) => r.endpoint)).toHaveLength(10);
    // The calls, in order: two logins (the client and the acceptance client), each precondition before its target.
    expect(lines.map((l) => `${l.method} ${l.endpoint}`)).toEqual([
      "POST /authentication/login", "GET /accounts",
      "POST /batch_transfers/create", "GET /batch_transfers", "POST /batch_transfers/{id}/delete", "GET /batch_transfers/{id}",
      "POST /webhooks/create", "POST /webhooks/{id}/delete", "GET /webhooks",
      "POST /issuing/cardholders/create", "GET /global_accounts", "POST /global_accounts/create",
      "GET /deposits/{id}", "GET /issuing/transactions", "GET /issuing/transactions/{id}",
      "POST /authentication/login", "POST /pa/payment_intents/create", "POST /pa/payment_intents/{id}/confirm", "GET /pa/payment_intents/{id}",
    ]);
    expect(rec.totals).toEqual({ targets: 11, live: 10, refused: 0, not_run: 1 });
  });

  it("removes what it makes where Purser's client can, and says where it cannot", async () => {
    const { row } = await run();
    expect(row("/batch_transfers/{id}/delete").cleanup).toMatch(/^the batch is deleted; read back after the delete: Airwallex answered 404/);
    expect(row("/webhooks/create").cleanup).toMatch(/deleted again .*none left at the check's URL/);
    expect(row("/issuing/cardholders/create").cleanup).toMatch(/^none: Purser's client has no call/);
    expect(row("/global_accounts/create").cleanup).toMatch(/^none: Purser's client has no call/);
  });

  it("opens the Global Account usdGlobalAccountId would (USD) when none is held, else one Purser holds none in", async () => {
    expect((await run({ heldCurrencies: ["EUR", "GBP"] })).row("/global_accounts/create").outcome).toContain("for USD");
    expect((await run({ heldCurrencies: ["EUR", "GBP", "USD"] })).row("/global_accounts/create").outcome).toContain("for AUD");
    const all = (await run({ heldCurrencies: ["USD", "AUD", "SGD"] })).row("/global_accounts/create");
    expect(all).toMatchObject({ http_status: null, live: false });
    expect(all.outcome).toMatch(/^not run: Purser already holds USD, AUD, SGD/);
  });

  it("keeps the webhook's signing secret, the test card and the keys out of the record", async () => {
    const { rec } = await run();
    const text = JSON.stringify(rec) + coverageMarkdownRecord(rec, "2026-11-19");
    for (const s of ["whsec_", "STANDIN_SECRET", "4035501000000008", "stand-in-token", "stand-in\""]) expect(text).not.toContain(s);
  });

  it("leaves the hosted flow not run without Airwallex's template, and runs it through onboardingLink with one", async () => {
    const without = await run();
    expect(without.row("/hosted_flows/{id}/authorize")).toMatchObject({ http_status: null, live: false });
    expect(without.lines.some((l) => l.endpoint.startsWith("/hosted_flows"))).toBe(false);
    expect(without.live.has("POST /hosted_flows/{id}/authorize")).toBe(false);
    const withT = await run({}, "template-open-id");
    expect(withT.row("/hosted_flows/{id}/authorize")).toMatchObject({ http_status: 200, live: true });
  });
});

describe("a refusal stays not live", () => {
  it("records Airwallex's status and code, and the coverage scan does not count it", async () => {
    const { row, live, rec } = await run({ refuse: { "POST /issuing/cardholders/create": { status: 403, code: "feature_not_enabled" } } });
    expect(row("/issuing/cardholders/create")).toMatchObject({ http_status: 403, error_code: "feature_not_enabled", live: false, outcome: "Airwallex answered 403 feature_not_enabled" });
    expect(live.has("POST /issuing/cardholders/create")).toBe(false);
    expect(live.has("POST /webhooks/create")).toBe(true);
    expect(rec.totals).toMatchObject({ live: 9, refused: 1, not_run: 1 });
  });

  it("a failed precondition leaves its targets not run and not counted", async () => {
    const { row, live, lines } = await run({ refuse: { "POST /batch_transfers/create": { status: 400, code: "validation_failed" } } });
    for (const e of ["/batch_transfers", "/batch_transfers/{id}/delete"]) {
      expect(row(e)).toMatchObject({ http_status: null, live: false, precondition: "createBatch failed: Airwallex answered 400 validation_failed" });
    }
    expect(lines.filter((l) => l.endpoint.startsWith("/batch_transfers"))).toHaveLength(1);
    expect(live.has("GET /batch_transfers")).toBe(false);
    expect(live.has("POST /batch_transfers/{id}/delete")).toBe(false);
  });

  it("a read whose by-id call is refused but whose function finds it by the list is still not live", async () => {
    const { row, live } = await run({ refuse: { "GET /deposits/{id}": { status: 404, code: "resource_not_found" } } });
    const r = row("/deposits/{id}");
    expect(r).toMatchObject({ http_status: 404, live: false });
    expect(r.outcome).toMatch(/^the call answered 404 resource_not_found; the function went on/);
    expect(live.has("GET /deposits/{id}")).toBe(false);
  });
});

describe("a live run's guard", () => {
  it("needs a call budget and its log, Purser's own account and the API key pair", () => {
    expect(liveRefusals({ AIRWALLEX_CALL_BUDGET: "30", AIRWALLEX_CALL_LOG: "/tmp/x" })).toEqual([]);
    expect(liveRefusals({})).toHaveLength(1);
    expect(liveRefusals({ AIRWALLEX_CALL_BUDGET: "61", AIRWALLEX_CALL_LOG: "/tmp/x" })[0]).toMatch(/1 to 60/);
    expect(liveRefusals({ AIRWALLEX_CALL_BUDGET: "30", AIRWALLEX_CALL_LOG: "/tmp/x", AIRWALLEX_PLATFORM: "on", AIRWALLEX_OAUTH: "on" })).toHaveLength(2);
  });
});

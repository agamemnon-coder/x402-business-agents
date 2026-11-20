// The live coverage check (src/proof/awxCoverageLive.ts) on its stand-in, the refusals test/airwallex-coverage-live.test.ts
// leaves: each precondition that fails leaves its target not run with the reason; a clean-up that fails is said; a call
// with no answer is "outcome unknown", never live; and the run log is written from such a record. No network.
import { describe, expect, it } from "vitest";
import { coverageMarkdownRecord, coverageRecord, notingFetch, runCoverageCheck, standInFetch, type HttpLine } from "../src/proof/awxCoverageLive.js";

type Refuse = Record<string, { status: number; code: string }>;
async function run(o: { refuse?: Refuse; transactions?: number; heldCurrencies?: string[] } = {}, template: string | null = null, wrap: (f: typeof fetch) => typeof fetch = (f) => f) {
  const lines: HttpLine[] = [];
  const log: string[] = [];
  const cfg = { clientId: "stand-in", apiKey: "stand-in", fetchImpl: notingFetch(wrap(standInFetch(o)), lines), minGapMs: 0, sleep: async () => undefined, timeoutMs: 1000 };
  const rows = await runCoverageCheck({ cfg, lines, runId: "20261120000000", date: "2026-11-20", hostedFlowTemplate: template, log: (l) => log.push(l) });
  const rec = coverageRecord(rows, lines, { ranAt: "2026-11-20T09:00:00.000Z", budget: null, used: lines.length });
  return { rows, rec, log, row: (e: string) => rows.find((r) => r.endpoint === e)! };
}

describe("the coverage check's preconditions and clean-ups when Airwallex refuses", () => {
  it("a webhook create refused: nothing to delete, the sweep still lists; a sweep refused is said in the clean-up", async () => {
    const { row, log } = await run({ refuse: { "POST /webhooks/create": { status: 403, code: "forbidden" }, "GET /webhooks": { status: 500, code: "internal_error" } } });
    expect(row("/webhooks/create")).toMatchObject({ http_status: 403, live: false, outcome: "Airwallex answered 403 forbidden" });
    expect(row("/webhooks/create").cleanup).toBe("nothing made; the list after failed: Airwallex answered 500 internal_error");
    expect(row("/webhooks/{id}/delete")).toMatchObject({ http_status: null, live: false, outcome: "not run: no subscription to delete", precondition: "createWebhook made none" });
    expect(log).toContain("SKIP  POST /webhooks/{id}/delete: no subscription to delete");
  });

  it("a batch delete refused says the batch is not deleted, and still reads it back", async () => {
    const { row } = await run({ refuse: { "POST /batch_transfers/{id}/delete": { status: 400, code: "invalid_status" } } });
    expect(row("/batch_transfers/{id}/delete").cleanup).toBe("the delete did not go through; read back after the delete: DRAFTING");
  });

  it("the Global Account list refused: no account opened, and why", async () => {
    const { row } = await run({ refuse: { "GET /global_accounts": { status: 500, code: "internal_error" } } });
    expect(row("/global_accounts/create")).toMatchObject({ http_status: null, live: false, outcome: "not run: the list of Global Accounts failed", precondition: "activeGlobalAccounts failed: Airwallex answered 500 internal_error" });
  });

  it("no card transaction in the list, or the list refused: the by-id read is not run", async () => {
    expect((await run({ transactions: 0 })).row("/issuing/transactions/{id}")).toMatchObject({ outcome: "not run: no card transaction to read", precondition: "the sandbox's card transaction list has none with an id and a card" });
    expect((await run({ refuse: { "GET /issuing/transactions": { status: 403, code: "feature_not_enabled" } } })).row("/issuing/transactions/{id}").precondition).toBe("the card transaction list failed: Airwallex answered 403 feature_not_enabled");
  });

  it("a PaymentIntent create refused leaves the confirm not run; a read back refused is said after the confirm", async () => {
    expect((await run({ refuse: { "POST /pa/payment_intents/create": { status: 401, code: "unauthorized" } } })).row("/pa/payment_intents/{id}/confirm"))
      .toMatchObject({ outcome: "not run: no PaymentIntent to confirm", precondition: "createPaymentIntent failed: Airwallex answered 401 unauthorized" });
    const c = (await run({ refuse: { "GET /pa/payment_intents/{id}": { status: 404, code: "resource_not_found" } } })).row("/pa/payment_intents/{id}/confirm");
    expect(c.live).toBe(true);
    expect(c.outcome).toBe("confirmed with the sandbox success test card: SUCCEEDED; the read back failed: Airwallex answered 404 resource_not_found");
  });

  it("the hosted flow's authorize refused, with the template given, is a refusal, not live", async () => {
    const { row } = await run({ refuse: { "POST /hosted_flows/{id}/authorize": { status: 400, code: "invalid_argument" } } }, "template-open-id");
    expect(row("/hosted_flows/{id}/authorize")).toMatchObject({ http_status: 400, error_code: "invalid_argument", live: false });
  });

  it("a call that gets no answer is 'outcome unknown' and not live; a fault in the client is said without a secret", async () => {
    const silent = (key: string, err: () => Error) => (f: typeof fetch): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (`${(init?.method ?? "GET").toUpperCase()} ${u.pathname}`.startsWith(key)) throw err();
      return f(input, init);
    }) as typeof fetch;
    const lost = await run({}, null, silent("POST /api/v1/issuing/cardholders/create", () => new TypeError("socket hang up")));
    expect(lost.row("/issuing/cardholders/create")).toMatchObject({ http_status: 0, live: false });
    expect(lost.row("/issuing/cardholders/create").outcome).toMatch(/no answer from Airwallex \(outcome unknown\)|socket hang up/);
    expect(lost.rec.totals.live).toBe(9);
  });
});

describe("the coverage run log", () => {
  it("writes the totals without a budget, every row and call, a pipe or line break kept inside its cell", async () => {
    const { rec } = await run({ refuse: { "POST /issuing/cardholders/create": { status: 403, code: "feature_not_enabled" } } });
    rec.results[0]!.outcome = "a | b\nc";
    const md = coverageMarkdownRecord(rec, "2026-11-20");
    expect(md).toContain(`**${rec.totals.live} of ${rec.totals.targets} endpoints answered 2xx (live), ${rec.totals.refused} refused, ${rec.totals.not_run} not run.** ${rec.budget.used} Airwallex calls (the logins included), 0 answered 429.`);
    expect(md).toContain("a \\| b c");
    expect(md).toMatch(/\| `POST \/issuing\/cardholders\/create` \| .* \| 403 `feature_not_enabled` \| no \| Airwallex answered 403 feature_not_enabled \|/);
    expect(md).toMatch(/\| \d+ \| \d\d:\d\d:\d\d\.\d{3} \| `POST \/issuing\/cardholders\/create` \| 403 `feature_not_enabled` \|/);
  });
});

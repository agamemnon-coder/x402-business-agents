// The small Airwallex modules on the paths the other files leave: webhook subscriptions listed across pages, created
// only with their secret, deleted by id; the Cloud's gateway refusing a call before it is sent, a POST without an
// answer as ambiguous, a read's network error as it is, and Airwallex's refusal with or without its code; the gateway's
// rules for query keys, bodies that are not JSON or too large, and a batch without its request_id; a call budget that
// is not one, and the method and URL of a Request; a payee with no name; a transfer body without a date and a cancel
// whose refusal is not Airwallex's; a scope refusal for a path no role covers and a POST on a read scope; a card body
// without controls; and a BIC given as nothing. No network.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bankNameFromBic } from "../src/airwallex/bankNames.js";
import { budgetedFetch } from "../src/airwallex/callBudget.js";
import { createControlsBody } from "../src/airwallex/cardBody.js";
import { AirwallexAmbiguous, AirwallexError, type Airwallex } from "../src/airwallex/client.js";
import { gatewayApi, gatewayCheck, GatewayRefused, type GatewayAnswer } from "../src/airwallex/gateway.js";
import { AirwallexScopeRefused, checkScope } from "../src/airwallex/keyScopes.js";
import { looksLikePerson, publicNickname, publicPayeeName } from "../src/airwallex/personName.js";
import { revokeScheduledTransfer, transferBody } from "../src/airwallex/transferRevoke.js";
import { createWebhook, deleteWebhook, listWebhooks } from "../src/airwallex/webhooks.js";

const SHA = "a".repeat(64);

describe("webhook subscriptions", () => {
  it("listed across pages, created only with their secret, deleted by id", async () => {
    const calls: unknown[][] = [];
    const pages = [{ has_more: true, items: [{ id: "w1", url: "https://r/hooks", events: ["a"], version: "2025-11-11", extra: 1 }] }, { items: [{ id: "w2", url: "https://r/hooks", events: ["b"], version: "2025-11-11" }] }];
    let i = 0;
    const api = { call: async (...a: unknown[]) => { calls.push(a); const path = a[1] as string; if (path === "/webhooks") return pages[i++]; if (path === "/webhooks/create") return (a[2] as { url: string }).url.includes("nosecret") ? { id: "w3" } : { id: "w3", url: "u", events: [], version: "v", secret: "s3cr3t" }; return {}; } } as unknown as Airwallex;
    expect(await listWebhooks(api)).toEqual([{ id: "w1", url: "https://r/hooks", events: ["a"], version: "2025-11-11" }, { id: "w2", url: "https://r/hooks", events: ["b"], version: "2025-11-11" }]);
    expect(await createWebhook(api, { url: "https://r/hooks", events: ["a"], version: "v" })).toEqual({ id: "w3", url: "u", events: [], version: "v", secret: "s3cr3t" });
    await expect(createWebhook(api, { url: "https://r/nosecret", events: ["a"], version: "v" })).rejects.toThrow("Airwallex created the webhook but returned no secret");
    await deleteWebhook(api, "w 1");
    expect(calls.at(-1)).toEqual(["POST", "/webhooks/w%201/delete", {}]);
    expect(calls.filter((c) => c[1] === "/webhooks").map((c) => (c[3] as { page: string }).page)).toEqual(["0", "1"]);
  });
});

describe("the Cloud's gateway", () => {
  const port = (answer: GatewayAnswer | Error) => ({ call: async () => { if (answer instanceof Error) throw answer; return answer; } });

  it("a call not on the list is refused before it is sent", async () => {
    let sent = false;
    const api = gatewayApi({ call: async () => { sent = true; return { ok: true, status: 200, json: {} } as GatewayAnswer; } });
    await expect(api.call("POST", "/transfers/create", { request_id: "short" })).rejects.toBeInstanceOf(GatewayRefused);
    expect(sent).toBe(false);
  });

  it("no answer: a POST is ambiguous, a read's error is as it is", async () => {
    const body = { request_id: "req-12345678", metadata: { approval_sha256: SHA } };
    await expect(gatewayApi(port(new Error("binding down"))).call("POST", "/transfers/create", body)).rejects.toBeInstanceOf(AirwallexAmbiguous);
    await expect(gatewayApi(port(new Error("binding down"))).call("GET", "/balances/current")).rejects.toThrow("binding down");
  });

  it("the kit11 side's refusal, and Airwallex's refusal with or without its code", async () => {
    await expect(gatewayApi(port({ ok: false, status: 403, code: null, trace_id: null, refused: "rate limited" })).call("GET", "/balances/current")).rejects.toThrow(GatewayRefused);
    const withCode = await gatewayApi(port({ ok: false, status: 400, code: "invalid_argument", trace_id: "t1" })).call("GET", "/balances/current").catch((e: unknown) => e);
    expect(withCode).toBeInstanceOf(AirwallexError);
    expect((withCode as AirwallexError).message).toContain("400 invalid_argument");
    const noCode = await gatewayApi(port({ ok: false, status: 500, code: null, trace_id: null })).call("GET", "/balances/current", undefined, { currency: "EUR" }).catch((e: unknown) => e);
    expect((noCode as AirwallexError).status).toBe(500);
  });

  it("its rules: plain query keys, a JSON body of a bounded size, and a batch's request_id", () => {
    expect(gatewayCheck({ method: "GET", path: "/deposits", query: { "Bad-Key": "x" } })).toEqual({ refused: "a query value is not plain" });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(gatewayCheck({ method: "POST", path: "/beneficiaries/schema", body: loop })).toEqual({ refused: "the body is not JSON" });
    expect(gatewayCheck({ method: "POST", path: "/beneficiaries/schema", body: { x: "y".repeat(33 * 1024) } })).toEqual({ refused: "the body is too large" });
    expect(gatewayCheck({ method: "POST", path: "/batch_transfers/create", body: { request_id: 7 } })).toEqual({ refused: "a batch needs its request_id" });
    expect(gatewayCheck({ method: "POST", path: "/batch_transfers/create" })).toEqual({ refused: "a batch needs its request_id" });
    expect(gatewayCheck({ method: "POST", path: "/batch_transfers/create", body: { request_id: "batch-12345678" } })).toMatchObject({ rule: { name: "batch transfer (draft)" } });
  });
});

describe("a call budget", () => {
  it("is a whole number, and counts a Request by its own method and URL", async () => {
    expect(() => budgetedFetch(fetch, { budget: -1, file: "x" })).toThrow("not a call budget: -1");
    expect(() => budgetedFetch(fetch, { budget: 1.5, file: "x" })).toThrow("not a call budget: 1.5");
    const dir = mkdtempSync(join(tmpdir(), "awx-budget-"));
    try {
      const file = join(dir, "calls.jsonl");
      const f = budgetedFetch((async () => new Response("{}")) as typeof fetch, { budget: 5, file, now: () => new Date("2026-11-20T10:00:00Z"), pid: 1 });
      await f(new Request("https://api.sandbox.airwallex.com/api/v1/transfers/create", { method: "post" }));
      await f(new URL("https://api.sandbox.airwallex.com/api/v1/balances/current"));
      const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; endpoint: string });
      expect(lines.map((l) => l.method)).toEqual(["POST", "GET"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("names, bodies and scopes", () => {
  it("a payee with no name, or no nickname, shows none", () => {
    expect(looksLikePerson(null)).toBe(false);
    expect(publicPayeeName(null)).toBeNull();
    expect(publicPayeeName("")).toBeNull();
    expect(publicNickname(null, false)).toBeNull();
    expect(publicNickname("", true)).toBeNull();
  });

  it("a transfer without a date is sent without one; a cancel that fails in another way is not taken as Airwallex's answer", async () => {
    const t = { requestId: "r1", beneficiaryId: "b1", amountCents: 1000, currency: "EUR", reference: "INV-1", reason: "goods_purchased", approvalSha256: SHA };
    expect(transferBody(t)).not.toHaveProperty("transfer_date");
    let reads = 0;
    const api = { call: async (m: string) => { if (m === "GET") { reads++; return { id: "tr_1", status: "SCHEDULED" }; } throw new TypeError("fetch failed"); } };
    await expect(revokeScheduledTransfer(api as never, "tr_1")).rejects.toThrow("fetch failed");
    expect(reads).toBe(1);
    const noCode = { call: async (m: string) => { if (m === "GET") { reads++; return { id: "tr_1", status: reads > 2 ? "CANCELLED" : "SCHEDULED", amount: 10 }; } throw new AirwallexError(400, undefined, {}, "/transfers/tr_1/cancel"); } };
    expect(await revokeScheduledTransfer(noCode as never, "tr_1")).toMatchObject({ cancelAnswer: "400", after: { status: "CANCELLED", amount: "10.00", currency: "" } });
  });

  it("a scope refusal for a path no role covers, and for a write on a read scope", () => {
    expect(() => checkScope("read", "GET", "/nowhere")).toThrow(AirwallexScopeRefused);
    expect(() => checkScope("read", "GET", "/nowhere")).toThrow("no role's scopes cover it");
    expect(() => checkScope("read", "POST", "/transfers/create")).toThrow(/the read key may not call POST \/transfers\/create \(.* needs Write; the read key has (Read|no access)\)/);
  });

  it("a card body without controls is multi-use with limits only; a BIC given as nothing names no bank", () => {
    expect(createControlsBody({ currency: "EUR", perTxCents: 1000, monthlyCents: 5000 })).toEqual({
      allowed_transaction_count: "MULTIPLE", transaction_limits: { currency: "EUR", limits: [{ amount: 10, interval: "PER_TRANSACTION" }, { amount: 50, interval: "MONTHLY" }] },
    });
    expect(createControlsBody({ currency: "EUR", perTxCents: 1000, monthlyCents: 5000 }, { mccs: ["5734"], currencies: ["EUR"], activeTo: null, singleUse: true })).toEqual({
      allowed_transaction_count: "SINGLE", transaction_limits: expect.any(Object), allowed_merchant_categories: ["5734"], allowed_currencies: ["EUR"],
    });
    expect(bankNameFromBic(undefined)).toBeUndefined();
    expect(bankNameFromBic("ZZZZDEFF")).toBeUndefined();
  });
});

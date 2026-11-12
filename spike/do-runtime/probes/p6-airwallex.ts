// SPIKE probe 6: the Airwallex client (src/airwallex/client.ts) and adapter (adapter.ts) in workerd, against a stand-in
// fetch that plays the sandbox. No request leaves the isolate.
import { DurableObject } from "cloudflare:workers";
import * as fs from "node:fs";
import { AirwallexRest, airwallexFromEnv } from "../../../src/airwallex/adapter.js";
import { budgetedFetch, readCallLog, AirwallexBudgetSpent } from "../../../src/airwallex/callBudget.js";
import { Airwallex, AirwallexAmbiguous, AirwallexError, fromEnv } from "../../../src/airwallex/client.js";
import { json, steps } from "./_util.js";

export class Engine extends DurableObject {}

/** A stand-in for the Airwallex sandbox: login, balances, a transfer; it records every request it gets. */
function sandbox(opts: { failTransferOnce?: number } = {}) {
  const seen: { method: string; path: string; auth: string | null; onBehalfOf: string | null; clientId: boolean }[] = [];
  let failed = false;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input instanceof URL ? input.href : (input as RequestInfo), init);
    const u = new URL(req.url);
    const p = u.pathname.replace("/api/v1", "");
    seen.push({ method: req.method, path: p + u.search, auth: req.headers.get("authorization"), onBehalfOf: req.headers.get("x-on-behalf-of"), clientId: req.headers.has("x-client-id") });
    const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-b3-traceid": "trace-spike-1" } });
    if (p === "/authentication/login") return answer({ token: "stand-in-token", expires_at: "2099-01-01T00:00:00Z" }, 201);
    if (p === "/balances/current") return answer([{ currency: "EUR", available_amount: 1250.5, pending_amount: 0, reserved_amount: 0 }, { currency: "USD", available_amount: 10 }]);
    if (p === "/transfers/create") {
      if (opts.failTransferOnce && !failed) { failed = true; return answer({ code: "service_unavailable" }, opts.failTransferOnce); }
      const b = (await req.json()) as { request_id: string; transfer_amount?: unknown };
      return answer({ id: "tr_spike_1", request_id: b.request_id, status: "IN_APPROVAL", transfer_amount: b.transfer_amount ?? 4.84, transfer_currency: "EUR", fee_amount: 0, fee_currency: "EUR" }, 201);
    }
    if (p === "/unknown") return answer({ code: "not_found", message: "no such thing" }, 404);
    return answer({ items: [], has_more: false });
  }) as typeof fetch;
  return { f, seen };
}

export default {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    await step("fromEnv_reads_process_env", () => { const c = fromEnv(); return c ? { clientId: c.clientId === "spike-client-id", hasBudgetedFetch: "fetchImpl" in c } : null; });
    await step("airwallexFromEnv_constructs", async () => { const a = await airwallexFromEnv(); return a ? { rail: typeof a.rail.balances } : null; });
    await step("client_login_then_call", async () => {
      const s = sandbox();
      const awx = new Airwallex({ clientId: "spike-client-id", apiKey: "spike-api-key", fetchImpl: s.f, minGapMs: 0 });
      const rows = await awx.call<unknown[]>("GET", "/balances/current", undefined, { account_type: "cash" });
      await awx.call("GET", "/balances/current");
      return { rows: rows.length, requests: s.seen.map((x) => `${x.method} ${x.path}`), loginOnce: s.seen.filter((x) => x.path === "/authentication/login").length === 1, bearer: s.seen[1]?.auth };
    });
    await step("client_spacing_and_timeouts", async () => {
      const s = sandbox();
      const awx = new Airwallex({ clientId: "a", apiKey: "b", fetchImpl: s.f, minGapMs: 40 });
      const t = Date.now();
      await Promise.all([awx.call("GET", "/balances/current"), awx.call("GET", "/balances/current"), awx.call("GET", "/balances/current")]);
      return { three_calls_ms: Date.now() - t, abortSignalTimeout: typeof AbortSignal.timeout === "function" };
    });
    await step("adapter_balances_on_behalf_of", async () => {
      const s = sandbox();
      const rest = new AirwallexRest(new Airwallex({ clientId: "a", apiKey: "b", fetchImpl: s.f, minGapMs: 0, onBehalfOf: "acct_SC-QD89fOneAeqaRFgOymw" }));
      const b = await rest.balances();
      return { eur_cents: b.EUR?.availableCents, payingAccount: rest.payingAccount, header_on_call: s.seen[1]?.onBehalfOf, header_on_login: s.seen[0]?.onBehalfOf };
    });
    await step("errors_typed", async () => {
      const s = sandbox({ failTransferOnce: 503 });
      const awx = new Airwallex({ clientId: "a", apiKey: "b", fetchImpl: s.f, minGapMs: 0 });
      const notFound = await awx.call("GET", "/unknown").catch((e) => (e instanceof AirwallexError ? `AirwallexError ${e.status} ${e.code} trace ${e.traceId}` : String(e)));
      const ambiguous = await awx.call("POST", "/transfers/create", { request_id: "r1" }).catch((e) => (e instanceof AirwallexAmbiguous ? "AirwallexAmbiguous (a POST that got 503 is not resent)" : String(e)));
      const second = await awx.call<{ id: string }>("POST", "/transfers/create", { request_id: "r1" });
      return { notFound, ambiguous, second: second.id };
    });
    // The file-based call budget (src/airwallex/callBudget.ts): it runs, on workerd's per-request /tmp.
    await step("call_budget_on_tmp_file", async () => {
      const s = sandbox();
      const f = budgetedFetch(s.f, { budget: 2, file: "/tmp/awx-calls.jsonl", pid: 1 });
      const awx = new Airwallex({ clientId: "a", apiKey: "b", fetchImpl: f, minGapMs: 0 });
      await awx.call("GET", "/balances/current");
      const third = await awx.call("GET", "/balances/current").catch((e) => (e instanceof AirwallexBudgetSpent ? `refused: ${e.message.slice(0, 70)}` : String(e)));
      return { counted: readCallLog("/tmp/awx-calls.jsonl").length, third, sent: s.seen.length };
    });
    await step("call_budget_file_from_an_earlier_request", () => ({ exists: fs.existsSync("/tmp/awx-calls.jsonl"), lines: readCallLog("/tmp/awx-calls.jsonl").length }));
    return json(out);
  },
};

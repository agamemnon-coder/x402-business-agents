// /try's sandbox payout (step 2, 14 Nov), on the kit11 Worker's side (worker/src/awxPayout.ts): four calls on the
// sandbox host and nothing else; one transfer per test company, keyed by the signed terms' hash, never twice; a day cap,
// an amount cap, EUR only, and never more than the sandbox's available balance. No network: Airwallex is a fake fetch.
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { sqlOver } from "../src/relay/local.js";
import {
  AWX_PAYOUT_ALLOWED, AWX_PAYOUT_BENEFICIARY, AWX_PAYOUT_DAY, AWX_PAYOUT_HOST, AwxPayoutDesk, PayoutCallNotAllowed, PayoutFailed, SandboxPayouts, payoutUrl, requestIdOf,
  type PayoutRail, type SandboxTransfer,
} from "../worker/src/awxPayout.js";

const KEY = "test-payout-key-cccccccccccccccccccccccc";
const TOKEN = "test-token-dddddddddddddddddddddddddddddd";
const SHA = "a".repeat(8) + "0123456789abcdef".repeat(3) + "b".repeat(8);
const SHA2 = "c".repeat(64);
const ask = (o: Partial<{ company: string; terms_sha256: string; amount: string; currency: string; reference: string }> = {}) => ({ company: "t_try_a", terms_sha256: SHA, amount: "1850.00", currency: "EUR", reference: "BTX-2026-21", ...o });

function fakeRail(o: { balance?: number; create?: () => SandboxTransfer; balanceThrows?: boolean } = {}) {
  const calls: { what: string; arg?: unknown }[] = [];
  const rail: PayoutRail = {
    availableCents: async (c) => { calls.push({ what: "balance", arg: c }); if (o.balanceThrows) throw new PayoutFailed("unavailable", "x"); return o.balance ?? 1_000_000; },
    createTransfer: async (t) => { calls.push({ what: "create", arg: t }); return o.create ? o.create() : { id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL" }; },
    transfer: async (id) => { calls.push({ what: "read", arg: id }); return { id, status: "SCHEDULED" }; },
  };
  return { rail, calls };
}
const desk = (rail: PayoutRail | null, o: { off?: boolean; day?: number } = {}) => new AwxPayoutDesk(sqlOver(new Database(":memory:")), { rail, off: o.off ?? false, now: () => Date.parse("2026-11-14T12:00:00Z"), ...(o.day ? { day: o.day } : {}) });

describe("the payout client: four calls, one host, nothing else", () => {
  it("the table is login, the balance, the transfer's create and its read-back, on the sandbox host only", () => {
    expect(AWX_PAYOUT_HOST).toBe("api.sandbox.airwallex.com");
    expect(AWX_PAYOUT_ALLOWED.map((a) => `${a.method} ${a.path.source}`)).toEqual([
      "POST ^\\/api\\/v1\\/authentication\\/login$", "GET ^\\/api\\/v1\\/balances\\/current$", "POST ^\\/api\\/v1\\/transfers\\/create$", "GET ^\\/api\\/v1\\/transfers\\/[A-Za-z0-9-]{8,64}$",
    ]);
    expect(payoutUrl("POST", "https://api.sandbox.airwallex.com/api/v1/transfers/create").pathname).toBe("/api/v1/transfers/create");
    expect(payoutUrl("GET", "https://api.sandbox.airwallex.com/api/v1/transfers/4074d684-4704-406c-a527-2832753baf4f").pathname).toMatch(/^\/api\/v1\/transfers\//);
    for (const [m, u] of [
      ["POST", "https://api.airwallex.com/api/v1/transfers/create"], ["POST", "https://api-demo.airwallex.com/api/v1/transfers/create"], ["POST", "http://api.sandbox.airwallex.com/api/v1/transfers/create"],
      ["POST", "https://api.sandbox.airwallex.com/api/v1/fx/conversions/create"], ["POST", "https://api.sandbox.airwallex.com/api/v1/beneficiaries/create"], ["POST", "https://api.sandbox.airwallex.com/api/v1/transfers/x/cancel"],
      ["GET", "https://api.sandbox.airwallex.com/api/v1/transfers/create"], ["DELETE", "https://api.sandbox.airwallex.com/api/v1/transfers/4074d684-4704"],
      ["GET", "https://api.sandbox.airwallex.com/api/v1/balances/current?x=1"], ["POST", "https://u:p@api.sandbox.airwallex.com/api/v1/transfers/create"], ["POST", "https://api.sandbox.airwallex.com.evil.example/api/v1/transfers/create"], ["POST", "nope"],
    ] as const) expect(() => payoutUrl(m, u), `${m} ${u}`).toThrow(PayoutCallNotAllowed);
  });

  it("sends the transfer to the main runs' sandbox beneficiary, request_id from the signed hash, metadata.approval_sha256 = the hash; never says the key or the token", async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url).replace(`https://${AWX_PAYOUT_HOST}`, "");
      sent.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === "/api/v1/authentication/login") return Response.json({ token: TOKEN }, { status: 201 });
      if (u === "/api/v1/balances/current") return Response.json([{ currency: "EUR", available_amount: 12000.5 }, { currency: "USD", available_amount: 3 }]);
      if (u === "/api/v1/transfers/create") return Response.json({ id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", echo: `${KEY} ${TOKEN}` }, { status: 201 });
      throw new Error(`unexpected ${u}`);
    });
    const c = new SandboxPayouts({ clientId: "id", apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.availableCents("EUR")).toBe(1_200_050);
    const t = await c.createTransfer({ requestId: requestIdOf(SHA), amount: "1850.00", currency: "EUR", reference: "BTX-2026-21", approvalSha256: SHA });
    expect(t).toEqual({ id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL" });
    expect(JSON.stringify(t)).not.toMatch(/test-payout-key|test-token/);
    expect(sent.map((s) => s.url)).toEqual(["/api/v1/authentication/login", "/api/v1/balances/current", "/api/v1/transfers/create"]);
    expect(sent[2]!.body).toEqual({ request_id: requestIdOf(SHA), beneficiary_id: AWX_PAYOUT_BENEFICIARY, transfer_amount: 1850, transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT", reference: "BTX-2026-21", reason: "goods_purchased", metadata: { approval_sha256: SHA } });
    expect(requestIdOf(SHA)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(requestIdOf(SHA)).toBe(requestIdOf(SHA));
    expect(requestIdOf(SHA2)).not.toBe(requestIdOf(SHA));
  });

  it("a create that is not answered is ambiguous (asked again with the same request_id), a 4xx is refused; the reason is fixed text", async () => {
    const fail = (status: number | "throw") => new SandboxPayouts({ clientId: "id", apiKey: KEY, fetchImpl: (async (url: string) => {
      if (String(url).endsWith("/login")) return Response.json({ token: TOKEN }, { status: 201 });
      if (status === "throw") throw new Error(`socket ${KEY}`);
      return Response.json({ message: `bad ${KEY}` }, { status });
    }) as unknown as typeof fetch });
    const make = (c: SandboxPayouts) => c.createTransfer({ requestId: requestIdOf(SHA), amount: "1.00", currency: "EUR", reference: "r", approvalSha256: SHA }).catch((e: PayoutFailed) => [e.code, e.message]);
    expect(await make(fail("throw"))).toEqual(["ambiguous", "the Airwallex sandbox did not answer"]);
    expect(await make(fail(503))).toEqual(["ambiguous", "the Airwallex sandbox did not take the transfer (HTTP 503)"]);
    expect(await make(fail(400))).toEqual(["refused", "the Airwallex sandbox did not take the transfer (HTTP 400)"]);
  });
});

describe("the payout desk: one per company, never twice, capped", () => {
  it("pays once; the same signed terms again answer the stored transfer and read its status back, with no second create", async () => {
    const { rail, calls } = fakeRail();
    const d = desk(rail);
    const first = await d.payout(ask());
    expect(first).toEqual({ ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: "1850.00", currency: "EUR", request_id: requestIdOf(SHA), again: false });
    expect(calls.find((c) => c.what === "create")!.arg).toEqual({ requestId: requestIdOf(SHA), amount: "1850.00", currency: "EUR", reference: "BTX-2026-21", approvalSha256: SHA });
    expect(await d.payout(ask())).toMatchObject({ ok: true, again: true, status: "SCHEDULED" });
    expect(calls.filter((c) => c.what === "create")).toHaveLength(1);
    // Other terms for the same company: its one payout is spent.
    expect(await d.payout(ask({ terms_sha256: SHA2 }))).toEqual({ ok: false, reason: "company_cap" });
    expect(d.payoutsToday()).toBe(1);
  });

  it("checks the sandbox balance first: too little, or no answer, and no transfer is asked for", async () => {
    const low = fakeRail({ balance: 184_999 });
    expect(await desk(low.rail).payout(ask())).toEqual({ ok: false, reason: "balance_low" });
    expect(low.calls.map((c) => c.what)).toEqual(["balance"]);
    const down = fakeRail({ balanceThrows: true });
    expect(await desk(down.rail).payout(ask())).toEqual({ ok: false, reason: "unavailable" });
    expect(down.calls.map((c) => c.what)).toEqual(["balance"]);
  });

  it(`at most ${AWX_PAYOUT_DAY} a UTC day in all; EUR only; at most EUR 5,000; switched off or without the key, nothing is called`, async () => {
    expect(AWX_PAYOUT_DAY).toBe(100);
    const { rail, calls } = fakeRail();
    const d = desk(rail, { day: 2 });
    expect(await d.payout(ask({ company: "t_try_a", terms_sha256: SHA }))).toMatchObject({ ok: true });
    expect(await d.payout(ask({ company: "t_try_b", terms_sha256: SHA2 }))).toMatchObject({ ok: true });
    expect(await d.payout(ask({ company: "t_try_c", terms_sha256: "d".repeat(64) }))).toEqual({ ok: false, reason: "day_cap" });
    expect(await desk(rail).payout(ask({ currency: "USD" }))).toEqual({ ok: false, reason: "not_eur" });
    expect(await desk(rail).payout(ask({ amount: "5000.01" }))).toEqual({ ok: false, reason: "over_max" });
    const before = calls.length;
    expect(await desk(rail, { off: true }).payout(ask())).toEqual({ ok: false, reason: "switched_off" });
    expect(await desk(null).payout(ask())).toEqual({ ok: false, reason: "no_key" });
    for (const bad of [ask({ terms_sha256: "x" }), ask({ amount: "1850" }), ask({ company: "a b" }), ask({ reference: "é" }), null]) expect(await desk(rail).payout(bad as never)).toEqual({ ok: false, reason: "bad_request" });
    expect(calls.length).toBe(before);
  });

  it("refused: spent, never retried; ambiguous: asked again with the same request_id, and only once made", async () => {
    let n = 0;
    const refused = fakeRail({ create: () => { throw new PayoutFailed("refused", "x"); } });
    const d1 = desk(refused.rail);
    expect(await d1.payout(ask())).toEqual({ ok: false, reason: "refused" });
    expect(await d1.payout(ask())).toEqual({ ok: false, reason: "refused" });
    expect(refused.calls.filter((c) => c.what === "create")).toHaveLength(1);
    const flaky = fakeRail({ create: () => { if (n++ === 0) throw new PayoutFailed("ambiguous", "x"); return { id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL" }; } });
    const d2 = desk(flaky.rail);
    expect(await d2.payout(ask())).toEqual({ ok: false, reason: "ambiguous" });
    expect(await d2.payout(ask())).toMatchObject({ ok: true, again: false });
    const creates = flaky.calls.filter((c) => c.what === "create").map((c) => (c.arg as { requestId: string }).requestId);
    expect(creates).toEqual([requestIdOf(SHA), requestIdOf(SHA)]);
    expect(flaky.calls.filter((c) => c.what === "balance")).toHaveLength(1);
  });
});

describe("the entrypoint and the keys", () => {
  const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
  it("the payout key is its own, read only into the payout client; the instance is reached only from the AwxFx entrypoint", () => {
    expect(index).toMatch(/new SandboxPayouts\(\{ clientId: id, apiKey: key \}\)/);
    expect(index).toMatch(/AIRWALLEX_PAYOUT_CLIENT_ID: id, AIRWALLEX_PAYOUT_API_KEY: key/);
    expect(index.match(/idFromName\("awx-payout"\)/g)).toHaveLength(1);
    expect(index.slice(index.indexOf("export class AwxFx"), index.indexOf("export default"))).toContain('idFromName("awx-payout")');
    // The quote client still gets only the quote key.
    expect(index).toMatch(/AIRWALLEX_CLIENT_ID: id, AIRWALLEX_API_KEY: key \} = this\.env;\n\s+this\.awxFx/);
  });
});

// /try's sandbox payout client (worker/src/awxPayout.ts SandboxPayouts), against a stand-in sandbox: a login that is
// refused or carries no usable token stops the call; the token is reused until a minute before it ends and fetched again
// once on a 401; a transfer create with no answer, or a 5xx, is "ambiguous" (it may have happened; the request_id makes
// asking again safe) and a 4xx is "refused"; an answer without a plain id and status is not taken as a transfer; and a
// balance is read only from Airwallex's own row for that currency.
import { describe, expect, it } from "vitest";
import { AWX_PAYOUT_BENEFICIARY, PayoutFailed, SandboxPayouts } from "../worker/src/awxPayout.js";

const BASE = "https://api.sandbox.airwallex.com/api/v1";
const TOKEN = "t".repeat(32);
type Step = Response | Error;
function sandbox(calls: Step[], login: () => Step = () => Response.json({ token: TOKEN })) {
  const seen: { path: string; method: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    const path = url.replace(BASE, "");
    seen.push({ path, method: init.method ?? "GET", auth: h.get("authorization") ?? (h.get("x-api-key") ? "key" : null), body: init.body ? JSON.parse(init.body as string) : null });
    const next = path === "/authentication/login" ? login() : calls.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const client = (s: ReturnType<typeof sandbox>, now?: () => number) => new SandboxPayouts({ clientId: "cid", apiKey: "key", fetchImpl: s.fetchImpl, ...(now ? { now } : {}) });
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof PayoutFailed ? [e.code, e.message] : ["not a PayoutFailed", String(e)]; } return ["no failure", ""]; };
const ASK = { requestId: "0f0e0d0c-0b0a-4908-8706-050403020100", amount: "125.50", currency: "EUR", reference: "INV-7", approvalSha256: "a".repeat(64) };

describe("the login", () => {
  it("refused, or with a token too short to be one: the call is not made, and says the login was refused", async () => {
    const refused = sandbox([], () => Response.json({ code: "credentials_invalid" }, { status: 401 }));
    expect(await failure(client(refused).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox refused the login (HTTP 401)"]);
    const short = sandbox([], () => Response.json({ token: "abc" }));
    expect(await failure(client(short).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox refused the login (HTTP 200)"]);
    const list = sandbox([], () => Response.json([TOKEN]));
    expect(await failure(client(list).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox refused the login (HTTP 200)"]);
    const down = sandbox([], () => new Error("ECONNRESET"));
    expect(await failure(client(down).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox did not answer"]);
    for (const s of [refused, short, list, down]) expect(s.seen.map((x) => x.path)).toEqual(["/authentication/login"]);
  });

  it("is reused until a minute before its 20 minutes end; a 401 fetches it again once", async () => {
    let t = 0;
    const s = sandbox([Response.json([]), Response.json([]), new Response("", { status: 401 }), Response.json([])]);
    const c = client(s, () => t);
    await c.availableCents("EUR");
    t = 18 * 60_000;
    await c.availableCents("EUR");
    t = 19 * 60_000 + 1;
    await c.availableCents("EUR");
    expect(s.seen.map((x) => x.path)).toEqual(["/authentication/login", "/balances/current", "/balances/current", "/authentication/login", "/balances/current", "/authentication/login", "/balances/current"]);
  });
});

describe("a balance", () => {
  it("is the currency's own available amount in cents; a missing, negative or non-number amount counts as none", async () => {
    const rows = [{ currency: "USD", available_amount: 99 }, { currency: "EUR", available_amount: 1234.565 }, { currency: "GBP", available_amount: -5 }, { currency: "CHF", available_amount: "10" }, null];
    const c = client(sandbox(Array.from({ length: 5 }, () => Response.json(rows))));
    expect(await c.availableCents("EUR")).toBe(123457);
    expect(await c.availableCents("GBP")).toBe(0);
    expect(await c.availableCents("CHF")).toBe(0);
    expect(await c.availableCents("JPY")).toBe(0);
  });

  it("an answer that is not a list, or not a 200, is no balance", async () => {
    expect(await failure(client(sandbox([Response.json({ items: [] })])).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox gave no balance (HTTP 200)"]);
    expect(await failure(client(sandbox([new Response("down", { status: 503 })])).availableCents("EUR"))).toEqual(["unavailable", "the Airwallex sandbox gave no balance (HTTP 503)"]);
  });
});

describe("a transfer", () => {
  it("is created to the sandbox's one beneficiary with the signed terms' hash, and taken only with a plain id and status", async () => {
    const s = sandbox([Response.json({ id: "tr-0000-1111", status: "PROCESSING", reason: "ignored" })]);
    expect(await client(s).createTransfer(ASK)).toEqual({ id: "tr-0000-1111", status: "PROCESSING" });
    expect(s.seen[1]).toEqual({ path: "/transfers/create", method: "POST", auth: `Bearer ${TOKEN}`, body: {
      request_id: ASK.requestId, beneficiary_id: AWX_PAYOUT_BENEFICIARY, transfer_amount: 125.5, transfer_currency: "EUR", source_currency: "EUR",
      transfer_method: "SWIFT", reference: "INV-7", reason: "goods_purchased", metadata: { approval_sha256: ASK.approvalSha256 },
    } });
  });

  it("with no answer or a 5xx may have happened: ambiguous; a 4xx or an answer without a plain id is refused", async () => {
    expect(await failure(client(sandbox([new Error("socket hang up")])).createTransfer(ASK))).toEqual(["ambiguous", "the Airwallex sandbox did not answer"]);
    expect(await failure(client(sandbox([Response.json({}, { status: 502 })])).createTransfer(ASK))).toEqual(["ambiguous", "the Airwallex sandbox did not take the transfer (HTTP 502)"]);
    expect(await failure(client(sandbox([Response.json({ code: "invalid_argument" }, { status: 400 })])).createTransfer(ASK))).toEqual(["refused", "the Airwallex sandbox did not take the transfer (HTTP 400)"]);
    expect(await failure(client(sandbox([Response.json({ id: "../../x", status: "PAID" })])).createTransfer(ASK))).toEqual(["refused", "the Airwallex sandbox did not take the transfer (HTTP 200)"]);
    expect(await failure(client(sandbox([Response.json({ id: "tr-0000-1111", status: "paid; drop" })])).createTransfer(ASK))).toEqual(["refused", "the Airwallex sandbox did not take the transfer (HTTP 200)"]);
    expect(await failure(client(sandbox([Response.json([{ id: "tr-0000-1111", status: "PAID" }])])).createTransfer(ASK))).toEqual(["refused", "the Airwallex sandbox did not take the transfer (HTTP 200)"]);
  });

  it("is read and moved by its id; a read without an answer is unavailable, a move the sandbox refuses is refused", async () => {
    const s = sandbox([Response.json({ id: "tr-0000-1111", status: "SENT" }), Response.json({ id: "tr-0000-1111", status: "PAID" })]);
    const c = client(s);
    expect(await c.transfer("tr-0000-1111")).toEqual({ id: "tr-0000-1111", status: "SENT" });
    expect(await c.simulate("tr-0000-1111", "PAID")).toEqual({ id: "tr-0000-1111", status: "PAID" });
    expect(s.seen.slice(1).map((x) => [x.method, x.path, x.body])).toEqual([["GET", "/transfers/tr-0000-1111", null], ["POST", "/simulation/transfers/tr-0000-1111/transition", { next_status: "PAID" }]]);
    expect(await failure(client(sandbox([new Error("timeout")])).transfer("tr-0000-1111"))).toEqual(["unavailable", "the Airwallex sandbox did not answer"]);
    expect(await failure(client(sandbox([Response.json({ code: "not_found" }, { status: 404 })])).transfer("tr-0000-1111"))).toEqual(["unavailable", "the Airwallex sandbox gave no status (HTTP 404)"]);
    expect(await failure(client(sandbox([Response.json({ code: "invalid_status" }, { status: 400 })])).simulate("tr-0000-1111", "SENT"))).toEqual(["refused", "the Airwallex sandbox did not move the transfer (HTTP 400)"]);
    expect(await failure(client(sandbox([new Response("not json")])).simulate("tr-0000-1111", "SENT"))).toEqual(["refused", "the Airwallex sandbox did not move the transfer (HTTP 200)"]);
  });

  it("an id that is not one path segment is never sent: the call is not on the allow-list", async () => {
    const s = sandbox([]);
    await expect(client(s).transfer("a/../../balances")).rejects.toThrow();
    expect(s.seen.filter((x) => x.path !== "/authentication/login")).toEqual([]);
  });
});

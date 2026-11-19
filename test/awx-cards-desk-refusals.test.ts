// kit11's card desk (worker/src/awxCards.ts): the one place the sandbox key touches cards. It refuses every request
// that is not exactly a card request before anything is sent, holds reads to a rate per minute, logs in again once on a
// 401, and turns every failure of Airwallex (refused login, no Issuing access, no such card, another status, no answer,
// an answer it cannot read) into a fixed refusal with Airwallex's own code, never an exception and never card data.
import { describe, expect, it } from "vitest";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import type { CardsAsk } from "../src/airwallex/cardGate.js";
import { fakeSandbox } from "./support/awxCardsFake.js";

const SHA = "a".repeat(64);
const KEYS = { AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" };
type Handler = (path: string, init: RequestInit | undefined) => Response | Promise<Response>;
/** A sandbox answering by path; every call is recorded. */
function sandbox(handle: Handler) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const path = u.pathname.replace(/^\/api\/v1/, "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/authentication/login") return new Response(JSON.stringify({ token: `tok${calls.length}` }), { status: 200 });
    return handle(path, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("requests the desk refuses before anything is sent", () => {
  it("not a request, a malformed card id, a write without the signed action's hash, an unknown op", async () => {
    const s = sandbox(() => json(200, {}));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl });
    expect(await desk.ask(null as unknown as CardsAsk)).toMatchObject({ ok: false, code: "refused", reason: "not a request" });
    expect(await desk.ask({ op: "card", card_id: "../transfers" })).toMatchObject({ code: "refused", reason: "not a card id" });
    expect(await desk.ask({ op: "card", card_id: 7 } as unknown as CardsAsk)).toMatchObject({ code: "refused", reason: "not a card id" });
    expect(await desk.ask({ op: "status", card_id: "card_1", status: "INACTIVE" } as unknown as CardsAsk)).toMatchObject({ code: "refused", reason: expect.stringMatching(/hash of the action/) });
    expect(await desk.ask({ op: "wire", action_sha256: SHA } as unknown as CardsAsk)).toMatchObject({ code: "refused", reason: "not a card request" });
    expect(s.calls).toEqual([]);
  });

  it("a status other than ACTIVE or INACTIVE, a cardholder without an e-mail, a freeze list that is empty, too long or malformed", async () => {
    const s = sandbox(() => json(200, {}));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl });
    expect(await desk.ask({ op: "status", card_id: "card_1", status: "CLOSED", action_sha256: SHA } as unknown as CardsAsk)).toMatchObject({ code: "refused", reason: "a status is ACTIVE or INACTIVE" });
    const create = { op: "create", action_sha256: SHA, holder: { email: "not an address", first_name: "S", last_name: "Agent" }, nickname: "n", created_by: "c", limits: { per_tx_cents: 3000, monthly_cents: 10000 }, mccs: ["5734"], active_days: 30 };
    expect(await desk.ask(create as unknown as CardsAsk)).toMatchObject({ code: "refused", reason: expect.stringMatching(/e-mail/) });
    for (const card_ids of [[], Array.from({ length: 500 }, (_, i) => `card_${i}`), ["../x"]]) {
      expect(await desk.ask({ op: "freeze_many", action_sha256: SHA, card_ids } as unknown as CardsAsk)).toMatchObject({ ok: false, code: "refused" });
    }
    expect(s.calls).toEqual([]);
  });

  it("without the key nothing is called; writes stay off until AWX_CARDS_WRITE is on", async () => {
    const s = sandbox(() => json(200, {}));
    expect(await new AwxCardsDesk({}, { fetchImpl: s.fetchImpl }).ask({ op: "card", card_id: "card_1" })).toMatchObject({ code: "no_key" });
    const off = new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k" }, { fetchImpl: s.fetchImpl });
    expect(await off.ask({ op: "limits", card_id: "card_1", limits: { per_tx_cents: 3000, monthly_cents: 10000 }, action_sha256: SHA })).toMatchObject({ code: "writes_off" });
    expect(s.calls).toEqual([]);
  });
});

describe("what Airwallex answers, as fixed refusals", () => {
  it("a refused login, a login that does not answer, and a sandbox that does not answer", async () => {
    const refused = new AwxCardsDesk(KEYS, { fetchImpl: (async () => json(401, { code: "credentials_invalid" })) as typeof fetch });
    expect(await refused.ask({ op: "card", card_id: "card_1" })).toMatchObject({ code: "forbidden", reason: "the sandbox refused the login", status: 401 });
    const silent = new AwxCardsDesk(KEYS, { fetchImpl: (async () => { throw new Error("socket hang up"); }) as typeof fetch });
    expect(await silent.ask({ op: "card", card_id: "card_1" })).toMatchObject({ code: "no_answer", reason: "the sandbox login did not answer" });
    const s = sandbox(() => { throw new Error("reset"); });
    expect(await new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl }).ask({ op: "card", card_id: "card_1" })).toMatchObject({ code: "no_answer", reason: "the sandbox did not answer" });
  });

  it("logs in again once after a 401; a second 401 is the key refused", async () => {
    let n = 0;
    const s = sandbox(() => (++n === 1 ? json(401, {}) : json(200, { card_id: "card_1", card_status: "ACTIVE", card_number: "4242424242421902" })));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl });
    const r = await desk.ask({ op: "card", card_id: "card_1" });
    expect(r).toMatchObject({ ok: true, op: "card", card: { last4: "1902", status: "ACTIVE" } });
    expect(JSON.stringify(r)).not.toContain("4242424242421902");
    expect(s.calls.filter((c) => c.endsWith("/authentication/login"))).toHaveLength(2);
    const always = sandbox(() => json(401, {}));
    expect(await new AwxCardsDesk(KEYS, { fetchImpl: always.fetchImpl }).ask({ op: "card", card_id: "card_1" })).toMatchObject({ code: "forbidden", reason: "the sandbox key may not do this (no Issuing access)", status: 401 });
    expect(always.calls.filter((c) => c.endsWith("/authentication/login"))).toHaveLength(2);
  });

  it("403 is no Issuing access, 404 no such card, anything else Airwallex's refusal: with its code and trace id, odd ones dropped", async () => {
    const at = (status: number, body: unknown, headers: Record<string, string> = {}) => new AwxCardsDesk(KEYS, { fetchImpl: sandbox(() => json(status, body, headers)).fetchImpl }).ask({ op: "card", card_id: "card_1" });
    expect(await at(403, { code: "unauthorized" }, { "x-b3-traceid": "abc123" })).toMatchObject({ code: "forbidden", status: 403, awx_code: "unauthorized", trace_id: "abc123" });
    expect(await at(404, {})).toMatchObject({ code: "not_found", reason: "the sandbox has no such card", awx_code: null });
    expect(await at(400, { code: "validation failed <script>" }, { "x-b3-traceid": "bad id!" })).toMatchObject({ code: "airwallex", status: 400, awx_code: null, trace_id: null });
    expect(await at(200, { not: "a card" })).toMatchObject({ ok: false, code: "airwallex", reason: "the sandbox's card answer could not be read" });
  });

  it("reads are held to sixty a minute, then answered again the next minute", async () => {
    let now = Date.parse("2026-11-19T10:00:00Z");
    const s = sandbox(() => json(200, { items: [], has_more: false }));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl, now: () => now });
    for (let i = 0; i < 60; i++) expect((await desk.ask({ op: "scope" })).ok).toBe(true);
    expect(await desk.ask({ op: "scope" })).toMatchObject({ code: "no_answer", reason: expect.stringMatching(/too many card reads/) });
    now += 60_000;
    expect((await desk.ask({ op: "scope" })).ok).toBe(true);
  });

  it("transactions: only this card's, newest first, at most ten, never the card number", async () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ card_transaction_id: `ctx_${i}`, card_id: i === 3 ? "card_2" : "card_1", card_number: "4242424242421902", transaction_amount: -5, transaction_currency: "EUR", status: "APPROVED", created_at: `2026-11-${String(10 + i).padStart(2, "0")}T00:00:00Z` }));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: sandbox(() => json(200, { items })).fetchImpl });
    const r = await desk.ask({ op: "transactions", card_id: "card_1" });
    expect(r.ok && r.op === "transactions").toBe(true);
    const got = (r as { items: { id: string; card_id: string }[] }).items;
    expect(got).toHaveLength(10);
    expect(got.every((t) => t.card_id === "card_1")).toBe(true);
    expect(got[0]!.id).toBe("ctx_13");
    expect(JSON.stringify(r)).not.toContain("4242424242421902");
    const none = new AwxCardsDesk(KEYS, { fetchImpl: sandbox(() => json(200, { nothing: true })).fetchImpl });
    expect(await none.ask({ op: "transactions", card_id: "card_1" })).toMatchObject({ ok: true, items: [] });
  });
});

describe("writes", () => {
  it("a freeze of many stops at the first card the gateway may not write, and says why for each", async () => {
    let n = 0;
    const s = sandbox((path) => (path.endsWith("/update") ? (++n === 2 ? json(403, { code: "unauthorized" }) : json(200, { card_id: path.split("/")[3], card_status: "INACTIVE" })) : json(404, {})));
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl });
    const r = await desk.ask({ op: "freeze_many", action_sha256: SHA, card_ids: ["card_aaaa1111", "card_bbbb2222", "card_cccc3333"] });
    expect(r).toMatchObject({ ok: true, op: "freeze_many" });
    const frozen = (r as { frozen: { card_id_last4: string; ok: boolean; reason: string | null }[] }).frozen;
    expect(frozen).toEqual([
      { card_id_last4: "1111", ok: true, reason: null },
      { card_id_last4: "2222", ok: false, reason: "the sandbox key may not do this (no Issuing access) (unauthorized)" },
    ]);
    expect(s.calls.filter((c) => c.endsWith("/update"))).toHaveLength(2);
  });

  it("a new card: an existing cardholder is reused, a new one created, and an unreadable cardholder answer stops it", async () => {
    const s = fakeSandbox();
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: s.fetchImpl });
    const ask = { op: "create", action_sha256: SHA, holder: { email: "sourcing@agents.test", first_name: "Sourcing", last_name: "Agent" }, nickname: "n", created_by: "c", limits: { per_tx_cents: 3000, monthly_cents: 10000 }, mccs: ["5734"], active_days: 30 } as unknown as CardsAsk;
    expect(await desk.ask(ask)).toMatchObject({ ok: true, op: "create", card: { status: "ACTIVE" } });
    expect(await desk.ask({ ...ask, action_sha256: "b".repeat(64) } as CardsAsk)).toMatchObject({ ok: true, op: "create" });
    expect(s.calls.filter((c) => c === "POST /issuing/cardholders/create")).toHaveLength(1);
    const odd = sandbox((path) => (path === "/issuing/cardholders" ? json(200, { items: [] }) : path === "/issuing/cardholders/create" ? json(200, { id: 5 }) : json(500, {})));
    expect(await new AwxCardsDesk(KEYS, { fetchImpl: odd.fetchImpl }).ask(ask)).toMatchObject({ ok: false, code: "airwallex", reason: "the sandbox's cardholder answer could not be read" });
    expect(odd.calls).not.toContain("POST /issuing/cards/create");
  });

  it("a simulation whose answer cannot be read is a refusal, not a purchase", async () => {
    const desk = new AwxCardsDesk(KEYS, { fetchImpl: sandbox(() => json(200, { what: "?" })).fetchImpl });
    expect(await desk.ask({ op: "simulate", action_sha256: SHA, card_id: "card_1", amount_cents: 3500, merchant: "m", mcc: "5734" })).toMatchObject({ ok: false, code: "airwallex", reason: "the sandbox's simulation answer could not be read" });
  });
});

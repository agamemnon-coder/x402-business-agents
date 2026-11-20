// kit11's card desk (worker/src/awxCards.ts), the paths test/awx-cards-desk-refusals.test.ts leaves: the list read page
// by page with each limitless agent card read on its own (and kept as listed when that read fails), a refusal at every
// step of a write passed on as it is, a login or an answer that is not JSON, the platform's own fetch (no network in the
// tests: a login that does not answer), and a request that makes the desk itself fail, answered, never thrown.
import { describe, expect, it } from "vitest";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import type { CardsAsk } from "../src/airwallex/cardGate.js";

const SHA = "c".repeat(64);
const KEYS = { AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "k", AWX_CARDS_WRITE: "on" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
/** A sandbox answering by method and path (the query kept in `calls`); the login always works. */
function sandbox(handle: (key: string, q: URLSearchParams) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${u.pathname.replace(/^\/api\/v1/, "")}`;
    calls.push(`${key}${u.search}`);
    if (key === "POST /authentication/login") return json(200, { token: "tok" });
    return handle(key, u.searchParams);
  }) as typeof fetch;
  return { calls, fetchImpl, desk: new AwxCardsDesk(KEYS, { fetchImpl }) };
}
const card = (id: string, o: { nick?: string; status?: string; limits?: boolean } = {}) => ({
  card_id: id, card_status: o.status ?? "ACTIVE", nick_name: o.nick ?? "Sourcing agent card", card_number: "4242424242421902", created_at: "2026-11-15T03:00:00Z",
  ...(o.limits ? { authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 30, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } } } : {}),
});
const createAsk = { op: "create", action_sha256: SHA, holder: { email: "support@agents.test", first_name: "Support", last_name: "Agent" }, nickname: "Support agent card", created_by: "cfo", limits: { per_tx_cents: 3000, monthly_cents: 10000 }, mccs: ["5734"], active_days: 30 } as unknown as CardsAsk;

describe("the card list", () => {
  it("reads every page while Airwallex says there is more, keeps only open agent cards, and reads a limitless one on its own", async () => {
    const s = sandbox((key, q) => {
      if (key === "GET /issuing/cards" && q.get("page_num") === "0") return json(200, { items: [card("card_a", { limits: true }), card("card_b"), card("card_x", { nick: "Office printer" })], has_more: true });
      if (key === "GET /issuing/cards") return json(200, { items: [card("card_c", { status: "CLOSED" }), card("card_d")], has_more: false });
      if (key === "GET /issuing/cards/card_b") return json(200, { ...card("card_b", { limits: true }), nick_name: undefined, created_at: undefined });
      if (key === "GET /issuing/cards/card_d") return json(500, { code: "internal" });
      return json(404, {});
    });
    const r = await s.desk.ask({ op: "list" });
    expect(r).toMatchObject({ ok: true, op: "list", cut: false });
    const cards = (r as { cards: { card_id: string; nickname: string | null; limits: unknown; created_at: string | null }[] }).cards;
    expect(cards.map((c) => c.card_id)).toEqual(["card_a", "card_b", "card_d"]);
    // card_b's own read brought its limits; its nickname and date stay the list's where the read has none.
    expect(cards[1]).toMatchObject({ nickname: "Sourcing agent card", created_at: "2026-11-15T03:00:00Z", limits: { per_tx_cents: 3000, monthly_cents: 10000 } });
    // card_d's own read failed: it is kept as listed, without limits.
    expect(cards[2]).toMatchObject({ card_id: "card_d", limits: null });
    expect(s.calls.filter((c) => c.startsWith("GET /issuing/cards?"))).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("4242424242421902");
  });

  it("stops after five pages (the list is cut), and a list answer without items is an empty page", async () => {
    const s = sandbox(() => json(200, { has_more: true }));
    expect(await s.desk.ask({ op: "list" })).toEqual({ ok: true, op: "list", cards: [], cut: true });
    expect(s.calls.filter((c) => c.startsWith("GET /issuing/cards?"))).toHaveLength(5);
  });

  it("a page Airwallex refuses is the answer", async () => {
    const s = sandbox(() => json(403, { code: "unauthorized" }));
    expect(await s.desk.ask({ op: "list" })).toMatchObject({ ok: false, code: "forbidden", awx_code: "unauthorized" });
  });
});

describe("a refusal at each step of a card request is passed on as it is", () => {
  it("transactions refused", async () => {
    expect(await sandbox(() => json(404, {})).desk.ask({ op: "transactions", card_id: "card_1" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("a new card: the cardholder list, the new cardholder, the card itself, and a card answer that cannot be read", async () => {
    expect(await sandbox(() => json(500, {})).desk.ask(createAsk)).toMatchObject({ ok: false, code: "airwallex", status: 500 });
    const noHolder = sandbox((key) => (key === "GET /issuing/cardholders" ? json(200, { nothing: true }) : json(400, { code: "validation_failed" })));
    expect(await noHolder.desk.ask(createAsk)).toMatchObject({ ok: false, code: "airwallex", awx_code: "validation_failed" });
    expect(noHolder.calls.map((c) => c.split("?")[0])).toEqual(["POST /authentication/login", "GET /issuing/cardholders", "POST /issuing/cardholders/create"]);
    const holders = { items: [{ cardholder_id: "ch_1", email: "support@agents.test" }] };
    const cardRefused = sandbox((key) => (key === "GET /issuing/cardholders" ? json(200, holders) : json(409, { code: "duplicate_request" })));
    expect(await cardRefused.desk.ask(createAsk)).toMatchObject({ ok: false, code: "airwallex", awx_code: "duplicate_request" });
    expect(cardRefused.calls.some((c) => c.startsWith("POST /issuing/cardholders/create"))).toBe(false);
    const unreadable = sandbox((key) => (key === "GET /issuing/cardholders" ? json(200, holders) : json(200, { card_id: "not/an/id" })));
    expect(await unreadable.desk.ask(createAsk)).toMatchObject({ ok: false, code: "airwallex", reason: "the sandbox's card answer could not be read" });
  });

  it("a status or limits change refused, or done but not read back", async () => {
    const status = { op: "status", card_id: "card_1", status: "INACTIVE", action_sha256: SHA } as CardsAsk;
    const limits = { op: "limits", card_id: "card_1", limits: { per_tx_cents: 2000, monthly_cents: 9000 }, action_sha256: SHA } as CardsAsk;
    const refused = sandbox(() => json(403, { code: "unauthorized" }));
    expect(await refused.desk.ask(status)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await refused.desk.ask(limits)).toMatchObject({ ok: false, code: "forbidden" });
    const notReadBack = sandbox((key) => (key.endsWith("/update") ? json(200, {}) : json(404, {})));
    expect(await notReadBack.desk.ask(status)).toMatchObject({ ok: false, code: "not_found" });
    expect(await notReadBack.desk.ask(limits)).toMatchObject({ ok: false, code: "not_found" });
    const fine = sandbox((key) => (key.endsWith("/update") ? json(200, {}) : json(200, card("card_1", { status: "INACTIVE", limits: true }))));
    expect(await fine.desk.ask(status)).toMatchObject({ ok: true, op: "status", card: { status: "INACTIVE" } });
    expect(await fine.desk.ask(limits)).toMatchObject({ ok: true, op: "limits", card: { limits: { per_tx_cents: 3000 } } });
  });

  it("a simulated purchase Airwallex refuses, and one it answers with only its id", async () => {
    const sim = { op: "simulate", action_sha256: SHA, card_id: "card_1", amount_cents: 1250, merchant: "A test shop with a long name, cut at forty", mcc: "5734" } as CardsAsk;
    expect(await sandbox(() => json(400, { code: "invalid_card" })).desk.ask(sim)).toMatchObject({ ok: false, code: "airwallex", awx_code: "invalid_card" });
    const s = sandbox(() => json(200, { card_transaction_id: "ctx_9", status: "APPROVED" }));
    expect(await s.desk.ask(sim)).toMatchObject({ ok: true, op: "simulate", tx: { id: "ctx_9", card_id: "card_1", amount_cents: 1250, currency: "EUR", approved: true } });
  });
});

describe("answers that are not JSON, no network, and a request that breaks the desk", () => {
  it("a login that answers with no JSON is a refused login; a card answer with no JSON is unreadable", async () => {
    const noJson = new AwxCardsDesk(KEYS, { fetchImpl: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    expect(await noJson.ask({ op: "card", card_id: "card_1" })).toMatchObject({ ok: false, code: "forbidden", reason: "the sandbox refused the login" });
    expect(await sandbox(() => new Response("not json", { status: 200 })).desk.ask({ op: "card", card_id: "card_1" })).toMatchObject({ ok: false, code: "airwallex", reason: "the sandbox's card answer could not be read" });
  });

  it("with the platform's own fetch and no network, the login does not answer", async () => {
    expect(await new AwxCardsDesk(KEYS).ask({ op: "scope" })).toMatchObject({ ok: false, code: "no_answer", reason: "the sandbox login did not answer" });
  });

  it("a request whose fields throw when read is answered as a failure of the gateway", async () => {
    const s = sandbox(() => json(200, {}));
    const hostile = new Proxy({}, { has: () => true, get: () => { throw new Error("boom"); } }) as CardsAsk;
    expect(await s.desk.ask(hostile)).toEqual({ ok: false, code: "no_answer", reason: "the card gateway failed" });
    expect(s.calls).toEqual([]);
  });
});

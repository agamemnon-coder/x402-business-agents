// The Issuing adapter against a recording stand-in for Airwallex (src/airwallex/issuing.ts): cardholders and cards found
// across pages, a closed card with the same nickname passed over, a create whose answer was lost settled by looking the
// card up (and refused when it is not there), a lost update settled by reading the card back while any other error
// stops; card amounts as Airwallex signs them, a transaction with a date that is not one refused, and which keys the
// rail and the charge simulation use. No network: every answer is the stand-in's.
import { describe, expect, it } from "vitest";
import { AirwallexAmbiguous, AirwallexError, type Airwallex } from "../src/airwallex/client.js";
import { IssuingRest, issuingFromEnv, toCardTransaction, toLimits } from "../src/airwallex/issuing.js";

type Answer = unknown | ((body: unknown, query: Record<string, string> | undefined) => unknown);
/** Answers by "METHOD /path" and page (a list of answers is taken in turn); records every call. */
function standIn(answers: Record<string, Answer | Answer[]>) {
  const calls: { method: string; path: string; body: unknown; query?: Record<string, string> }[] = [];
  const turn = new Map<string, number>();
  const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    calls.push({ method, path, body, query });
    const key = `${method} ${path}`;
    const a = answers[key];
    if (a === undefined) throw new Error(`unexpected ${key}`);
    const n = turn.get(key) ?? 0;
    turn.set(key, n + 1);
    const one = Array.isArray(a) ? a[Math.min(n, a.length - 1)] : a;
    const v = typeof one === "function" ? (one as (b: unknown, q: unknown) => unknown)(body, query) : one;
    if (v instanceof Error) throw v;
    return v;
  };
  const rail = new IssuingRest({ call, onBehalfOf: null } as unknown as Airwallex, () => {});
  return { rail, calls };
}

const card = (id: string, over: Record<string, unknown> = {}) => ({
  card_id: id, cardholder_id: "ch_1", card_number: "4111 1111 1111 4242", card_status: "ACTIVE", nick_name: "support",
  authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ interval: "PER_TRANSACTION", amount: 100 }, { interval: "MONTHLY", amount: 500 }] } }, ...over,
});
const ambiguous = (path: string) => new AirwallexAmbiguous(path, new Error("socket hang up"));
const refused = (path: string) => new AirwallexError(400, "invalid_argument", { code: "invalid_argument", message: "no" }, path);

describe("finding a cardholder and a card", () => {
  it("reads page after page until the cardholder is there, and says none when the last page has none", async () => {
    const { rail, calls } = standIn({
      "GET /issuing/cardholders": [
        { has_more: true, items: [{ cardholder_id: "ch_0", email: "other@x.test", status: "READY" }] },
        { has_more: false, items: [{ cardholder_id: "ch_1", email: "support@x.test", status: "READY" }] },
      ],
    });
    expect(await rail.findCardholderByEmail("support@x.test")).toEqual({ id: "ch_1", email: "support@x.test", status: "READY" });
    expect(calls.map((c) => c.query?.page_num)).toEqual(["0", "1"]);
    expect(await rail.findCardholderByEmail("nobody@x.test")).toBeUndefined();
  });

  it("passes over a closed card with the same nickname, and reads the open one by id for its controls", async () => {
    const { rail, calls } = standIn({
      "GET /issuing/cards": [
        { has_more: true, items: [card("c_closed", { card_status: "CLOSED" }), card("c_other", { nick_name: "sourcing" })] },
        { has_more: false, items: [card("c_open", { authorization_controls: undefined })] },
      ],
      "GET /issuing/cards/c_open": card("c_open"),
    });
    const found = await rail.findCard("ch_1", "support");
    expect(found).toMatchObject({ cardId: "c_open", last4: "4242", limits: { currency: "EUR", perTxCents: 10000, monthlyCents: 50000 } });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /issuing/cards", "GET /issuing/cards", "GET /issuing/cards/c_open"]);
    expect(calls[0]!.query).toMatchObject({ cardholder_id: "ch_1", page_num: "0" });
  });

  it("no open card with that nickname: none", async () => {
    const { rail } = standIn({ "GET /issuing/cards": { has_more: false, items: [card("c_closed", { card_status: "CLOSED" })] } });
    expect(await rail.findCard("ch_1", "support")).toBeUndefined();
  });
});

describe("a create whose answer was lost is settled by looking, never by creating again", () => {
  const limits = { currency: "EUR" as const, perTxCents: 10000, monthlyCents: 50000 };

  it("the card is there: that card is the answer, and only one create was sent", async () => {
    const { rail, calls } = standIn({
      "POST /issuing/cards/create": ambiguous("/issuing/cards/create"),
      "GET /issuing/cards": { has_more: false, items: [card("c_new")] },
      "GET /issuing/cards/c_new": card("c_new"),
    });
    expect(await rail.createCard({ cardholderId: "ch_1", nickname: "support", createdBy: "Purser", limits })).toMatchObject({ cardId: "c_new" });
    expect(calls.filter((c) => c.path === "/issuing/cards/create")).toHaveLength(1);
  });

  it("the card is not there: the lost answer is reported, not retried", async () => {
    const { rail, calls } = standIn({
      "POST /issuing/cards/create": ambiguous("/issuing/cards/create"),
      "GET /issuing/cards": { has_more: false, items: [] },
    });
    await expect(rail.createCard({ cardholderId: "ch_1", nickname: "support", createdBy: "Purser", limits })).rejects.toBeInstanceOf(AirwallexAmbiguous);
    expect(calls.filter((c) => c.path === "/issuing/cards/create")).toHaveLength(1);
  });

  it("a refusal is a refusal: nothing is looked up", async () => {
    const { rail, calls } = standIn({ "POST /issuing/cards/create": refused("/issuing/cards/create") });
    await expect(rail.createCard({ cardholderId: "ch_1", nickname: "support", createdBy: "Purser", limits })).rejects.toThrow("Airwallex /issuing/cards/create -> 400 invalid_argument");
    expect(calls).toHaveLength(1);
  });
});

describe("an update whose answer was lost is settled by reading the card back; any other error stops", () => {
  const path = "/issuing/cards/c_1/update";

  it("limits, controls and status", async () => {
    const { rail, calls } = standIn({ [`POST ${path}`]: ambiguous(path), "GET /issuing/cards/c_1": card("c_1", { card_status: "INACTIVE" }) });
    expect(await rail.setCardLimits("c_1", { currency: "EUR", perTxCents: 10000, monthlyCents: 50000 })).toMatchObject({ cardId: "c_1" });
    expect(await rail.setCardControls("c_1", { mccs: ["5734"], currencies: ["EUR"] })).toMatchObject({ cardId: "c_1" });
    expect(await rail.setCardStatus("c_1", "INACTIVE")).toMatchObject({ status: "INACTIVE" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${path}`, "GET /issuing/cards/c_1", `POST ${path}`, "GET /issuing/cards/c_1", `POST ${path}`, "GET /issuing/cards/c_1"]);
    expect(calls[4]!.body).toEqual({ card_status: "INACTIVE" });
  });

  it("a refusal of any of them is thrown, with no read-back", async () => {
    const { rail, calls } = standIn({ [`POST ${path}`]: refused(path) });
    await expect(rail.setCardLimits("c_1", { currency: "EUR", perTxCents: 1, monthlyCents: 2 })).rejects.toBeInstanceOf(AirwallexError);
    await expect(rail.setCardControls("c_1", { mccs: [], currencies: [] })).rejects.toBeInstanceOf(AirwallexError);
    await expect(rail.setCardStatus("c_1", "ACTIVE")).rejects.toBeInstanceOf(AirwallexError);
    expect(calls.every((c) => c.method === "POST")).toBe(true);
  });
});

describe("what Airwallex sends, read strictly", () => {
  const tx = { card_transaction_id: "tx_1", card_id: "c_1", transaction_currency: "EUR", status: "APPROVED", transaction_date: "2026-11-19T10:00:00Z" };

  it("an amount as a signed decimal string; a merchant missing is no merchant and no MCC", () => {
    expect(toCardTransaction({ ...tx, transaction_amount: "-12.50" as unknown as number })).toMatchObject({ amountCents: 1250, merchant: "", mcc: null, type: "AUTHORIZATION", approved: true });
    expect(toCardTransaction({ ...tx, transaction_amount: "7" as unknown as number })).toMatchObject({ amountCents: 700 });
  });

  it("a date that is not a date is refused", () => {
    expect(() => toCardTransaction({ ...tx, transaction_amount: 1, transaction_date: "the 19th" })).toThrow("an Airwallex card transaction with a date that is not a date");
  });

  it("limits without a monthly or a per-transaction limit are no limits", () => {
    expect(toLimits({ currency: "EUR", limits: [{ interval: "PER_TRANSACTION", amount: 100 }] } as never)).toBeNull();
    expect(toLimits({ currency: "EUR", limits: [{ interval: "MONTHLY", amount: 100 }] } as never)).toBeNull();
  });
});

describe("which keys the card rail and the charge simulation use", () => {
  const BASE = { AIRWALLEX_CLIENT_ID: "stand-in-client", AIRWALLEX_API_KEY: "stand-in-general-key" };

  it("no keys: no rail", () => {
    expect(issuingFromEnv(undefined, {})).toBeNull();
  });

  it("one general key: the rail and the simulation are the same client", () => {
    const r = issuingFromEnv(undefined, BASE)!;
    expect(r.rail).toBe(r.sim);
  });

  it("an issuing key and no key that can simulate: the simulation runs on the issuing key's client", () => {
    const r = issuingFromEnv(undefined, { AIRWALLEX_CLIENT_ID: "stand-in-client", AIRWALLEX_API_KEY_ISSUING: "the-issuing-key" })!;
    expect(r.rail).toBe(r.sim);
  });

  it("an issuing key beside a general key: the simulation runs on another client", () => {
    const r = issuingFromEnv(undefined, { ...BASE, AIRWALLEX_API_KEY_ISSUING: "the-issuing-key" })!;
    expect(r.rail).not.toBe(r.sim);
  });
});

// Purser Cloud's live Airwallex tab (cloud/src/awxLive.ts), the edges test/awx-live.test.ts leaves: a gateway that is not
// there, that throws, or that answers a view in a shape it should not; the reconciliation refused on a cut window or an
// amount that is not in cents; rates whose pair does not name the two currencies; cards and rows that are not objects;
// and the events feed with rows it must drop. Each is an answer labelled "unavailable" or a row dropped, never a throw.
import { describe, expect, it } from "vitest";
import { annotateBeneficiaries, annotateIssuing, annotateRates, annotateTransfers, awxEventsView, awxLiveView, checkEventRow, checkGatewayAnswer, rateWords, reconcileView, type AwxLiveAnswer } from "../cloud/src/awxLive.js";

const NOW = new Date("2026-11-14T12:00:00Z");
const HOST = "api.sandbox.airwallex.com";
const live = (data: Record<string, unknown>): AwxLiveAnswer => ({ view: "financial", source: "airwallex-sandbox", host: HOST, read_at: "2026-11-14T11:59:00Z", cache_seconds: 60, data });

describe("the gateway's answer, checked", () => {
  it("no gateway, a gateway that throws, a sandbox that says it is unavailable, and every view's own annotation", async () => {
    expect(await awxLiveView(undefined, "balances" as never, NOW)).toMatchObject({ source: "unavailable", code: "no_gateway" });
    const throws = { read: async () => { throw new Error("binding down"); } };
    expect(await awxLiveView(throws as never, "transfers", NOW)).toMatchObject({ source: "unavailable", code: "no_answer", reason: "the Airwallex gateway did not answer" });
    expect(await awxLiveView(throws as never, "reconcile", NOW)).toMatchObject({ view: "reconcile", source: "unavailable", code: "no_answer" });
    const said = { read: async () => ({ host: HOST, source: "unavailable" }) };
    expect(await awxLiveView(said as never, "rates", NOW)).toMatchObject({ source: "unavailable", code: "no_answer", reason: "the Airwallex sandbox is unavailable" });
    const gw = { read: async (view: string) => ({ host: HOST, source: "airwallex-sandbox", read_at: "2026-11-14T11:59:00Z", data: { view, rates: [], cards: [], beneficiaries: [], transfers: [] } }) };
    for (const v of ["transfers", "beneficiaries", "issuing", "rates", "balances"] as const) expect((await awxLiveView(gw as never, v as never, NOW)).source, v).toBe("airwallex-sandbox");
  });

  it("an answer from another host, with a secret-looking field, or without its data, is withheld", () => {
    expect(checkGatewayAnswer("transfers", null, NOW)).toMatchObject({ code: "bad_answer" });
    expect(checkGatewayAnswer("transfers", { host: "api.airwallex.com" }, NOW)).toMatchObject({ code: "bad_answer" });
    expect(checkGatewayAnswer("transfers", { host: HOST, source: "airwallex-sandbox", read_at: "t", data: { token: "x" } }, NOW)).toMatchObject({ reason: "the Airwallex gateway's answer was withheld" });
    expect(checkGatewayAnswer("transfers", { host: HOST, source: "airwallex-sandbox", read_at: "t", data: null }, NOW)).toMatchObject({ code: "bad_answer" });
    expect(checkGatewayAnswer("transfers", { host: HOST, source: "airwallex-sandbox", read_at: "t", data: {}, cache_seconds: "lots" }, NOW)).toMatchObject({ cache_seconds: 0 });
  });
});

describe("the views' own annotations", () => {
  it("rows that are not objects are dropped; a transfer the run does not hold has no recorded hash", () => {
    const t = annotateTransfers({ transfers: [{ id: "unknown-1", approval_sha256: 5 }, null, "x"], readback: [{ id: "unknown-2" }, 7] });
    expect(t).toMatchObject({ transfers: [{ id: "unknown-1", approval_sha256: null, recorded: null }], with_approval_hash: 0, readback: [] });
    expect(annotateTransfers({}).transfers).toEqual([]);
  });

  it("a beneficiary without a recorded payee check, a person's name as initials", () => {
    const b = annotateBeneficiaries({ beneficiaries: [{ name: "Jane Example", entity_type: "PERSONAL", nickname: "Jane Example EUR" }, { name: 42 }] }) as { beneficiaries: { name: string | null; payee_check: unknown }[] };
    expect(b.beneficiaries[0]!.payee_check).toBeNull();
    expect(b.beneficiaries[0]!.name).not.toContain("Jane Example");
    expect(b.beneficiaries[1]).toMatchObject({ payee_check: null });
  });

  it("a rate says '1 X = Y' only when its pair names the two currencies", () => {
    expect(rateWords({ pair: "EURUSD", buy_currency: "USD", sell_currency: "EUR", rate: "1.08768" })).toEqual({ base: "EUR", quote: "USD", says: "1 EUR = 1.08768 USD" });
    expect(rateWords({ pair: "EURGBP", buy_currency: "EUR", sell_currency: "USD", rate: "1.1" })).toBeNull();
    expect(rateWords({ pair: "eurusd", buy_currency: "EUR", sell_currency: "USD", rate: "1.1" })).toBeNull();
    expect(rateWords({ pair: "EURUSD", buy_currency: "EUR", sell_currency: "USD", rate: "about one" })).toBeNull();
    expect(annotateRates({ rates: [{ pair: "X", rate: "1" }] })).toEqual({ rates: [{ pair: "X", rate: "1", base: null, quote: null, says: null }] });
  });

  it("cards take their agent from the nickname; the counts and cuts as the gateway gave them", () => {
    expect(annotateIssuing({ cards: [{ nickname: "Sourcing agent: data" }, { nickname: "office" }], cards_cut: true })).toMatchObject({
      cards: [{ agent: "sourcing" }, { agent: null }], transactions: [], cards_read: null, cards_cut: true, transactions_read: null, transactions_cut: false,
    });
  });
});

describe("the reconciliation", () => {
  it("passes on an unavailable answer, refuses a cut window and an amount not in cents", () => {
    const down: AwxLiveAnswer = { view: "financial", source: "unavailable", host: HOST, code: "no_answer", reason: "r", checked_at: NOW.toISOString() };
    expect(reconcileView(down, NOW)).toMatchObject({ view: "reconcile", source: "unavailable", code: "no_answer" });
    expect(reconcileView(live({ run_complete: false, run: [] }), NOW)).toMatchObject({ view: "reconcile", code: "bad_answer", reason: /more rows than one page/ });
    expect(reconcileView(live({ run: [{ id: "f1", amount: "1.234", currency: "EUR" }] }), NOW)).toMatchObject({ code: "bad_answer", reason: /not in cents/ });
    const empty = reconcileView(live({ run: [] }), NOW);
    expect(empty).toMatchObject({ view: "reconcile", source: "airwallex-sandbox", data: { computed: true, airwallex_rows: 0, window: null } });
  });
});

describe("the events feed", () => {
  it("drops rows that are not verified or not well formed, and keeps the four fields of those that are", () => {
    expect(checkEventRow(null)).toBeNull();
    expect(checkEventRow({ event_id: "e1", type: "payout.transfer.paid", received_at: "2026-11-14T10:00:00Z" })).toBeNull();
    expect(checkEventRow({ signature_verified: true, event_id: "bad id!", type: "payout.transfer.paid", received_at: "2026-11-14T10:00:00Z" })).toBeNull();
    expect(checkEventRow({ signature_verified: true, event_id: "e1", type: "payout.transfer.paid", received_at: "not a time" })).toBeNull();
    expect(checkEventRow({ signature_verified: true, event_id: "e1", type: "payout.transfer.paid", topic: "<b>", object_id: "x y", occurred_at: 5, received_at: "2026-11-14T10:00:00Z", body: "dropped" }))
      .toEqual({ event_id: "e1", type: "payout.transfer.paid", topic: "Other", object_id: null, occurred_at: null, received_at: "2026-11-14T10:00:00.000Z", signature_verified: true });
  });

  it("no link, a list that is not one, a site that does not answer; a good list with its newest event", async () => {
    expect(await awxEventsView(undefined, NOW)).toMatchObject({ source: "unavailable", code: "no_gateway" });
    expect(await awxEventsView({ read: async () => null } as never, NOW)).toMatchObject({ code: "no_gateway" });
    expect(await awxEventsView({ read: async () => null, events: async () => ({ source: "elsewhere" }) } as never, NOW)).toMatchObject({ code: "bad_answer" });
    expect(await awxEventsView({ read: async () => null, events: async () => { throw new Error("x"); } } as never, NOW)).toMatchObject({ code: "no_answer" });
    const ok = await awxEventsView({ read: async () => null, events: async () => ({ source: "airwallex-webhooks", receiving: true, read_at: "bad", events: [{ signature_verified: true, event_id: "e1", type: "a.b", received_at: "2026-11-14T10:00:00Z" }, { nope: 1 }] }) } as never, NOW);
    expect(ok).toMatchObject({ source: "airwallex-webhooks", receiving: true, read_at: NOW.toISOString(), last_event_at: "2026-11-14T10:00:00.000Z" });
    expect((ok as { events: unknown[] }).events).toHaveLength(1);
    const none = await awxEventsView({ read: async () => null, events: async () => ({ source: "airwallex-webhooks", events: [] }) } as never, NOW);
    expect(none).toMatchObject({ receiving: false, last_event_at: null });
  });
});

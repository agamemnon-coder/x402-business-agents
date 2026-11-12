// Airi (VIC) as a third rail in the Sourcing agent's rail choice (src/agents/railChoice.ts, 7 Nov). Breaks if Airi is
// offered with KIT11_AIRI_RAIL off, for a merchant off the CFO's Airi allowlist or outside the registry, above the hard
// cap, in another currency, or to a paused agent; if the offer and its reason are not in the audit trail; if the agent
// can pay Stockline or Packwise with Airi, or the Airi merchant on another rail; if offering it skips a Purser check
// (above the CFO's limit it waits for the Face ID, with 0 Airi calls; a merchant blocked after the offer is refused before
// Airi is asked); or if nothing changes for the two-rail morning without an Airi purchase. Fake Claude client and the
// Airi stand-ins only: no network, no airi-cli, no Airwallex.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { AIRI_RAIL, airiRailOffer, airiRailPay, airiRailPayment, chooseRails, type AiriRailPurchase, type RailDeps } from "../src/agents/railChoice.js";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { airiPurchases, airiRailChoice, executeAiriPurchase, requestAiriPurchase, type AiriDeps } from "../src/airi/purchase.js";
import { decide, resuming } from "../src/policy/approvals.js";

const ON = { KIT11_AIRI_RAIL: "on" };
const OFF = {};
const SHOP = "northwind-sandbox";

function seed(db: DB, o: { alone?: string; merchant?: "allowed" | "blocked"; pause?: "on" | "off" } = {}) {
  const set = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v, "2026-11-07T10:00:00Z");
  set("approval.airi_alone", o.alone ?? "20.00");
  set("approval.airi_alone_per_day", "3");
  set(`airi.merchant.${SHOP}`, o.merchant ?? "allowed");
  if (o.pause) set("pause.sourcing", o.pause);
  return db;
}
const fresh = (o: Parameters<typeof seed>[1] = {}) => seed(openDb(":memory:"), o);
const buyOf = (amount = "12.00", over: Partial<AiriRailPurchase> = {}) => ({ merchantId: SHOP, item: "Trail map pack", amount, currency: "EUR", ...over });

type Call = { name: string; input: unknown };
/** A fake Claude client that plays the given turns and keeps every request (to read the tools it was offered). */
function fake(turns: Call[][], requestIds: string[] = []) {
  let i = 0;
  const requests: { system: unknown; tools: { name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }[]; messages: { content: unknown }[] }[] = [];
  const client = { beta: { messages: { create: async (params: (typeof requests)[number]) => {
    requests.push(JSON.parse(JSON.stringify(params)));
    const t = turns[i++];
    const usage = { input_tokens: 800, output_tokens: 100 };
    const rid = requestIds[i - 1] ? { _request_id: requestIds[i - 1] } : {};
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage, ...rid };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage, ...rid };
  } } } } as unknown as Anthropic;
  return { client, requests };
}
const pay = (supplier: string, rail: string) => ({ name: "pay", input: { supplier, rail, reason: "its checkout" } });

function deps(env: Record<string, string>, airi: AiriRailPurchase | undefined) {
  const paid: string[] = [];
  const d: RailDeps = {
    payStockline: async () => { paid.push("stockline"); return { ok: true, text: "stock check #51 bought for 0.03", ref: "0xabc" }; },
    payPackwise: async () => { paid.push("packwise"); return { ok: true, text: "19.99 EUR approved by Airwallex", ref: "awx-1" }; },
    ...(airi ? { airi: { ...airi, pay: async () => { paid.push(airi.merchantId); return airi.pay(); } } } : {}),
    env,
  };
  return { d, paid };
}
const standInPay = async () => ({ ok: true, text: "paid with a single-use Visa credential from Airi (stand-in)", ref: "standin-order-1" });

function events(db: DB, event: string) {
  return (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { subject: string; payload_json: string }[])
    .map((r) => ({ subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }) as Record<string, unknown>);
}
const enumOf = (req: { tools: { name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }[] }, tool: string, field: string) => req.tools.find((t) => t.name === tool)!.input_schema.properties[field]!.enum;

afterEach(() => { resuming.clear(); });

describe("whether the agent is offered Airi (airiRailOffer)", () => {
  it("offers it only with the rail on, at a merchant on the CFO's Airi allowlist, for an amount Purser would take", () => {
    expect(airiRailOffer(fresh(), buyOf(), OFF)).toMatchObject({ offered: false, why: expect.stringContaining("KIT11_AIRI_RAIL") });
    expect(airiRailOffer(fresh(), buyOf(), ON)).toMatchObject({ offered: true, why: expect.stringMatching(/on the CFO's Airi allowlist and 12\.00 EUR is within the CFO's limit of 20\.00/) });
    // Above the CFO's limit: offered, and the payment waits for the CFO's Face ID.
    expect(airiRailOffer(fresh(), buyOf("45.00"), ON)).toMatchObject({ offered: true, why: expect.stringContaining("waits for the CFO's Face ID") });
    expect(airiRailOffer(fresh({ merchant: "blocked" }), buyOf(), ON)).toMatchObject({ offered: false, why: expect.stringContaining("PURSER_MERCHANT_NOT_ALLOWED") });
    expect(airiRailOffer(fresh(), buyOf("12.00", { merchantId: "shop-example" }), ON)).toMatchObject({ offered: false, why: expect.stringContaining("not a merchant of the Airi registry") });
    expect(airiRailOffer(fresh(), buyOf("250.00"), ON)).toMatchObject({ offered: false, why: expect.stringContaining("PURSER_ABOVE_HARD_CAP") });
    expect(airiRailOffer(fresh(), buyOf("12.00", { currency: "USD" }), ON)).toMatchObject({ offered: false, why: expect.stringContaining("PURSER_CURRENCY_NOT_ALLOWED") });
    expect(airiRailOffer(fresh(), buyOf("12"), ON)).toMatchObject({ offered: false, why: expect.stringContaining("PURSER_AMOUNT_INVALID") });
    expect(airiRailOffer(fresh({ pause: "on" }), buyOf(), ON)).toMatchObject({ offered: false, why: expect.stringContaining("paused by the CFO") });
  });
});

describe("the rail choice with an Airi purchase", () => {
  it("changes nothing without an Airi purchase: two purchases, two rails, the same prompt", async () => {
    const db = fresh();
    const { d, paid } = deps(ON, undefined);
    const { client, requests } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]);
    const r = await chooseRails(db, d, client);
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(enumOf(requests[0]!, "pay", "rail")).toEqual(["metal_x402", "airwallex_card"]);
    expect(enumOf(requests[0]!, "pay", "supplier")).toEqual(["stockline", "packwise"]);
    expect(JSON.stringify(requests[0]!.system)).not.toMatch(/Airi/);
    expect(r.purchases).toHaveLength(2);
    expect(events(db, "purchase.airi_rail_offered")).toEqual([]);
    expect(events(db, "purchase.airi_rail_not_offered")).toEqual([]);
  });

  it("does not offer Airi with KIT11_AIRI_RAIL off, and records why: the agent never sees it, nothing is paid there", async () => {
    const db = fresh();
    const { d, paid } = deps(OFF, { ...buyOf(), pay: standInPay });
    const { client, requests } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]);
    const r = await chooseRails(db, d, client);
    expect(enumOf(requests[0]!, "pay", "rail")).not.toContain(AIRI_RAIL);
    expect(enumOf(requests[0]!, "pay", "supplier")).not.toContain(SHOP);
    expect(paid).toEqual(["stockline", "packwise"]);
    expect(r.purchases.map((p) => p.supplier)).toEqual(["stockline", "packwise"]);
    expect(events(db, "purchase.airi_rail_not_offered")).toEqual([expect.objectContaining({ subject: SHOP, amount: "12.00", why: expect.stringContaining("KIT11_AIRI_RAIL") })]);
    expect(events(db, "purchase.rails_chosen")[0]).toMatchObject({ airi: { offered: false } });
  });

  it("does not offer Airi for a merchant the CFO has not allowed, even with the rail on", async () => {
    const db = fresh({ merchant: "blocked" });
    const { d, paid } = deps(ON, { ...buyOf(), pay: standInPay });
    const { client, requests } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card")]]);
    await chooseRails(db, d, client);
    expect(enumOf(requests[0]!, "pay", "rail")).not.toContain(AIRI_RAIL);
    expect(paid).not.toContain(SHOP);
    expect(events(db, "purchase.airi_rail_not_offered")).toEqual([expect.objectContaining({ why: expect.stringContaining("PURSER_MERCHANT_NOT_ALLOWED") })]);
  });

  it("offers it as a third option when allowed; the agent pays the Airi merchant with Airi, the reason in the audit trail", async () => {
    const db = fresh();
    const { d, paid } = deps(ON, { ...buyOf(), pay: standInPay });
    const { client, requests } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card"), pay(SHOP, AIRI_RAIL)]]);
    const r = await chooseRails(db, d, client);
    expect(enumOf(requests[0]!, "pay", "rail")).toEqual(["metal_x402", "airwallex_card", AIRI_RAIL]);
    expect(enumOf(requests[0]!, "pay", "supplier")).toEqual(["stockline", "packwise", SHOP]);
    expect(JSON.stringify(requests[0]!.system)).toMatch(/Purser checks it again before Airi is asked/);
    expect(paid).toEqual(["stockline", "packwise", SHOP]);
    expect(r.source).toBe("claude");
    expect(r.purchases.find((p) => p.supplier === SHOP)).toMatchObject({ rail: AIRI_RAIL, by: "claude", ok: true });
    expect(events(db, "purchase.airi_rail_offered")).toEqual([expect.objectContaining({ subject: SHOP, why: expect.stringContaining("within the CFO's limit") })]);
    expect(events(db, "purchase.rail_chosen").find((e) => e.subject === SHOP)).toMatchObject({ rail: AIRI_RAIL, airi_offer: expect.stringContaining("allowlist") });
    expect(events(db, "purchase.rails_chosen")[0]).toMatchObject({ airi: { offered: true } });
  });

  it("refuses Airi for Stockline or Packwise, and another rail for the Airi merchant, before anything is paid", async () => {
    const db = fresh();
    const { d, paid } = deps(ON, { ...buyOf(), pay: standInPay });
    const { client } = fake([[pay("packwise", AIRI_RAIL), pay(SHOP, "airwallex_card")], [pay("stockline", "metal_x402"), pay("packwise", "airwallex_card"), pay(SHOP, AIRI_RAIL)]]);
    const r = await chooseRails(db, d, client);
    expect(r.run.calls[0]).toMatchObject({ blocked: "supplier's rails" });
    expect(r.run.calls[0]!.text).toMatch(/Packwise is not a merchant on the CFO's Airi allowlist/);
    expect(r.run.calls[1]).toMatchObject({ blocked: "supplier's rails" });
    expect(r.run.calls[1]!.text).toMatch(/paid only with a single-use Visa credential from Airwallex's Airi/);
    expect(paid).toEqual(["stockline", "packwise", SHOP]);
    expect(events(db, "purchase.rail_refused").map((e) => [e.subject, e.rail])).toEqual([["packwise", AIRI_RAIL], [SHOP, "airwallex_card"]]);
  });

  it("without Claude, code pays the Airi purchase on the Airi rail the policy offered", async () => {
    const db = fresh();
    const { d, paid } = deps(ON, { ...buyOf(), pay: standInPay });
    const r = await chooseRails(db, d, null);
    expect(r.source).toBe("fallback");
    expect(paid).toEqual(["stockline", "packwise", SHOP]);
    expect(r.purchases.find((p) => p.supplier === SHOP)).toMatchObject({ rail: AIRI_RAIL, by: "code" });
  });
});

describe("paying on the Airi rail goes through Purser's checks (stand-ins)", () => {
  function airiDeps() {
    const airi = new StandInAiriClient(), checkout = new StandInCheckout();
    const d: AiriDeps = { airi, checkout, tmpRoot: mkdtempSync(join(tmpdir(), "airi-rail-")), showPasskeyUrl: () => {} };
    return { d, airi, checkout };
  }
  const T = () => new Date("2026-11-07T10:00:00Z");

  it("within the CFO's limit: paid with Airi's credential at the checkout", async () => {
    const db = fresh(), { d, airi } = airiDeps();
    const out = await airiRailPay(db, d, buyOf(), "standin-pm-1", T)();
    expect(out).toMatchObject({ ok: true, ref: "standin-order-1" });
    expect(out.text).toMatch(/single-use Visa credential from Airi: mandate standin-mdt-1/);
    expect(airi.calls.map((c) => c.op)).toContain("mandate create");
  });

  it("above the CFO's limit: waits for the CFO's Face ID, Airi not asked", async () => {
    const db = fresh(), { d, airi, checkout } = airiDeps();
    const out = await airiRailPay(db, d, buyOf("45.00"), "standin-pm-1", T)();
    expect(out).toMatchObject({ ok: false, ref: null });
    expect(out.text).toMatch(/P-\d{4} waits for the CFO's Face ID; Airi was not asked/);
    expect(airi.calls).toEqual([]);
    expect(checkout.seen).toEqual([]);
  });

  it("a merchant the CFO blocks after the offer is refused by Purser at payment, with 0 Airi calls", async () => {
    const db = fresh(), { d, airi } = airiDeps();
    expect(airiRailOffer(db, buyOf(), ON).offered).toBe(true);
    seed(db, { merchant: "blocked" });
    const { d: rd } = deps(ON, { ...buyOf(), pay: airiRailPay(db, d, buyOf(), "standin-pm-1", T) });
    const r = await chooseRails(db, rd, null);
    // Blocked before the choice: not offered at all.
    expect(r.purchases.map((p) => p.supplier)).toEqual(["stockline", "packwise"]);
    // And a payment that was offered earlier is still checked again by Purser.
    const late = await airiRailPay(db, d, buyOf(), "standin-pm-1", T)();
    expect(late).toMatchObject({ ok: false });
    expect(late.text).toMatch(/refused by Purser \(PURSER_MERCHANT_NOT_ALLOWED\)/);
    expect(airi.calls).toEqual([]);
  });

  it("reports every outcome of Purser's Airi rail as the rail choice's answer", () => {
    expect(airiRailPayment({ status: "refused", by: "airi", code: "DENIED", reason: "x", mandateId: "m1" })).toEqual({ ok: false, text: "refused by Airi (DENIED)", ref: "m1" });
    expect(airiRailPayment({ status: "unconfirmed", actionId: "a", orderSha256: "h", mandateId: "m2", reference: "r2", reason: "x" })).toMatchObject({ ok: false, ref: "r2" });
  });
});

describe("the rail choice is recorded with the purchase: who chose Airi, and the Claude request id (12 Nov)", () => {
  function airiDeps() {
    const airi = new StandInAiriClient(), checkout = new StandInCheckout();
    const d: AiriDeps = { airi, checkout, tmpRoot: mkdtempSync(join(tmpdir(), "airi-rail-")), showPasskeyUrl: () => {} };
    return { d, airi, checkout };
  }
  const T = () => new Date("2026-11-07T10:00:00Z");
  const REQ = "req_011CTestRailChoice01";
  const rows = (db: DB) => airiPurchases(db) as Record<string, unknown>[];

  it("Claude picks airi_vic: its request id stands in the purchase's row beside the mandate id and the checkout's reference", async () => {
    const db = fresh(), { d } = airiDeps();
    const { d: rd } = deps(ON, { ...buyOf(), pay: airiRailPay(db, d, buyOf(), "standin-pm-1", T) });
    const { client } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card"), pay(SHOP, AIRI_RAIL)]], [REQ]);
    const r = await chooseRails(db, rd, client);
    expect(r.purchases.find((p) => p.supplier === SHOP)).toMatchObject({ rail: AIRI_RAIL, by: "claude", ok: true });
    const [row] = rows(db);
    expect(row).toMatchObject({ status: "SETTLED", mandate_id: "standin-mdt-1", checkout_ref: "standin-order-1", rail_choice: { rail: AIRI_RAIL, by: "claude", agent: "sourcing", model: "claude-haiku-5-5", request_id: REQ } });
    expect(airiRailChoice(db, String(row!.action_id))).toMatchObject({ by: "claude", request_id: REQ });
    expect(events(db, "airi.rail_choice")).toEqual([expect.objectContaining({ subject: row!.action_id, rail: AIRI_RAIL, by: "claude", request_id: REQ })]);
  });

  it("above the CFO's limit the choice is kept with the proposal, and stands in the row once the CFO approved and it ran", async () => {
    const db = fresh(), { d, airi } = airiDeps();
    const { d: rd } = deps(ON, { ...buyOf("45.00"), pay: airiRailPay(db, d, buyOf("45.00"), "standin-pm-1", T) });
    const { client } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card"), pay(SHOP, AIRI_RAIL)]], [REQ]);
    await chooseRails(db, rd, client);
    expect(airi.calls).toEqual([]);
    expect(rows(db)).toEqual([]);
    const p = db.prepare("SELECT proposal_id, terms_sha256 FROM proposals WHERE kind = 'airi_purchase'").get() as { proposal_id: string; terms_sha256: string };
    expect(airiRailChoice(db, p.proposal_id)).toMatchObject({ rail: AIRI_RAIL, by: "claude", request_id: REQ });
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: p.terms_sha256, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T());
    expect(await executeAiriPurchase(db, d, p.proposal_id, T())).toMatchObject({ status: "succeeded" });
    expect(rows(db)[0]).toMatchObject({ proposal_id: p.proposal_id, mandate_id: "standin-mdt-1", checkout_ref: "standin-order-1", rail_choice: { by: "claude", request_id: REQ } });
  });

  it("a purchase asked for by a script, or paid by code's fallback, says so: by code, no request id", async () => {
    const db = fresh(), { d } = airiDeps();
    const out = await requestAiriPurchase(db, d, { agent: "sourcing", paymentMethodId: "standin-pm-1", merchantName: "Northwind test shop", merchantUrl: "https://kit11.max-31b.workers.dev/", merchantCountry: "NL", amount: "12.00", currency: "EUR", items: [{ name: "Trail map pack", unitPrice: "12.00", quantity: "1" }], description: "order 1" }, T());
    expect(out.status).toBe("succeeded");
    expect(rows(db)[0]!.rail_choice).toEqual({ rail: AIRI_RAIL, by: "code" });
    // Without Claude (no client), code pays on the Airi rail the policy offered: recorded as code's, never as Claude's.
    const db2 = fresh(), { d: d2 } = airiDeps();
    const { d: rd } = deps(ON, { ...buyOf(), pay: airiRailPay(db2, d2, buyOf(), "standin-pm-1", T) });
    const r = await chooseRails(db2, rd, null);
    expect(r.source).toBe("fallback");
    expect(rows(db2)[0]!.rail_choice).toEqual({ rail: AIRI_RAIL, by: "code" });
    expect(JSON.stringify(rows(db2))).not.toMatch(/request_id/);
  });

  it("a Claude call that came back without a request id is not passed off as one", async () => {
    const db = fresh(), { d } = airiDeps();
    const { d: rd } = deps(ON, { ...buyOf(), pay: airiRailPay(db, d, buyOf(), "standin-pm-1", T) });
    const { client } = fake([[pay("stockline", "metal_x402"), pay("packwise", "airwallex_card"), pay(SHOP, AIRI_RAIL)]]);
    await chooseRails(db, rd, client);
    expect(rows(db)[0]!.rail_choice).toEqual({ rail: AIRI_RAIL, by: "claude", agent: "sourcing", model: "claude-haiku-5-5", request_id: null });
  });
});

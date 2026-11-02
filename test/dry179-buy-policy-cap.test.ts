// dry-179, acceptance item 5 (2 November): the Sourcing agent had set its own buy policy {stockline, max_price 0.03}.
// After the silent rise to 0.04, purchase #17 was refused by that buy policy ("over the 0.03 the Sourcing agent's
// policy allows") before Purser's mandate-cap pre-check ever saw it: no mandate_cap_exceeded, no record of Metal's
// refusal on chain, and Max's one let-through stayed armed with nothing to catch.
// Now Purser's pre-check comes first: when both would refuse, the refusal recorded is the mandate's cap, so the
// record pull and the let-through happen as designed. The buy policy still refuses everything it refused that the
// mandate would allow (never looser), and now also on the amount actually signed. Only the one armed let-through, over
// the mandate's cap, passes the policy's max_price on its way to Metal; the policy's supplier choice still applies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { DB } from "../src/db/open.js";

const state = vi.hoisted(() => ({ db: null as DB | null, signed: [] as number[], onChain: [] as number[], offer: null as number | null, payTo: "0x0000000000000000000000000000000000000001" }));

vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<object>()),
  activeMandate: async () => ({ agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "", keyFile: "", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" }),
  // The cap written in the bound credential: 0.03.
  boundCapUnits: () => 3n * 10n ** 16n,
}));
// The offer at signing is the ledger's upstream price; Purser's guard decides whether anything is signed; a signed
// payment over 0.03 meets "Metal", which refuses it on the cap.
vi.mock("../src/metal/pay.js", async (orig) => ({
  ...(await orig<object>()),
  payUnderMandate: async (_m: unknown, _url: string, _init: unknown, guard?: (cents: number, payTo: string) => string | null) => {
    const { getSetting } = await import("../src/world/settings.js");
    const cents = Math.round(Number(getSetting(state.db!, "upstream_price", "0.02")) * 100);
    const blocked = guard ? guard(cents, state.payTo) : null;
    if (blocked) return { kind: "refused", reason: blocked, status: 0, body: "" };
    state.signed.push(cents);
    const nonce = `0x${String(state.signed.length).padStart(64, "0")}`;
    if (cents <= 3) return { kind: "paid", status: 200, body: JSON.stringify({ supplier: "Stockline", stock: {} }), tx: `0x${"ab".repeat(32)}`, nonce, signedOffer: "", amount: String(BigInt(cents) * 10n ** 16n), payTo: state.payTo };
    return { kind: "refused", reason: "mandate_cap_exceeded", status: 402, body: "", nonce };
  },
  findSettlementByNonce: async () => undefined,
}));
vi.mock("../src/metal/recordRefusal.js", () => ({ recordCapRefusalOnChain: async (_m: unknown, _to: unknown, cents: number, _id: string, _gas: unknown, onPullStart?: () => void) => {
  onPullStart?.();
  state.onChain.push(cents);
  return { tx: `0x${"cd".repeat(32)}`, reason: "mandate_cap_exceeded" };
} }));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { SourcingAgent } = await import("../src/agents/sourcing.js");
const { claimLetThrough, letThrough, requestLetThrough } = await import("../src/world/letThrough.js");
const { describe: feedLine } = await import("../src/dashboard/snapshot.js");
const { createProposal } = await import("../src/policy/approvals.js");
const { TERMS_SCHEMA } = await import("../src/lib/terms.js");

const SUPPLIER = "0x0000000000000000000000000000000000000001" as const;
const env = { ...process.env };
beforeEach(() => {
  process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on";
  state.signed = []; state.onChain = []; state.offer = null; state.payTo = SUPPLIER;
  // The supplier's free 402 (the buy policy's price check): the ledger's price, unless the test makes it differ.
  vi.stubGlobal("fetch", vi.fn(async () => {
    const { getSetting } = await import("../src/world/settings.js");
    const cents = state.offer ?? Math.round(Number(getSetting(state.db!, "upstream_price", "0.02")) * 100);
    const header = encodePaymentRequiredHeader({ x402Version: 2, resource: { url: "http://supplier/v1/stock-check" },
      accepts: [{ scheme: "exact", network: "eip155:63825", amount: (BigInt(cents) * 10n ** 16n).toString(), asset: "0x000000000000000000000000000000000000B5d5", payTo: SUPPLIER, maxTimeoutSeconds: 60, extra: {} }] } as never);
    return new Response("{}", { status: 402, headers: { "payment-required": header } });
  }));
});
afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });

function world(policy: { supplier: string; max_price: string | null }): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sourcing.buy_policy', ?, ?)").run(JSON.stringify({ ...policy, cache_seconds: 0, set_by: "sourcing" }), new Date().toISOString());
  state.db = db;
  return db;
}
const price = (db: DB, p: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('upstream_price', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(p, new Date().toISOString());
const n = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const refusedRows = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'upstream.refused' ORDER BY seq").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const lastFeed = (db: DB) => {
  const r = db.prepare("SELECT * FROM audit_log WHERE event = 'upstream.refused' ORDER BY seq DESC LIMIT 1").get() as never;
  return feedLine(r, () => undefined).text;
};
function armed(db: DB, supplier: `0x${string}` = SUPPLIER): InstanceType<typeof SourcingAgent> {
  const a = new SourcingAgent(db, "http://supplier", supplier);
  requestLetThrough(db);
  a.armLetThrough(claimLetThrough(db)!.armed_at!);
  return a;
}

describe("dry-179: Purser's mandate-cap pre-check before the Sourcing agent's own buy policy", () => {
  it("a buy policy with max_price 0.03 and a rise to 0.04 gives mandate_cap_exceeded, recorded on chain; nothing signed", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    const a = new SourcingAgent(db, "http://supplier", SUPPLIER);
    price(db, "0.04");
    const r = await a.buy(17);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^mandate_cap_exceeded: 0\.04 is over the sourcing mandate's 0\.03/) });
    expect(state.signed).toEqual([]);
    expect(db.prepare("SELECT outcome, refusal_reason LIKE 'mandate_cap_exceeded:%' AS cap FROM upstream_purchases").all()).toEqual([{ outcome: "REFUSED", cap: 1 }]);
    // Honest about who refused: Purser, against the mandate; and that the agent's policy would have refused it too.
    expect(refusedRows(db)).toEqual([expect.objectContaining({ refused_by: "purser", buy_policy_also_refuses: "0.03" })]);
    // Metal's record of the same refusal on chain, once (Metal QA's record pull).
    expect(state.onChain).toEqual([4]);
    expect(n(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.refused_on_chain'")).toBe(1);
    // The Sourcing agent hears of a cap refusal (so it asks Treasury), not of its own policy.
    expect(JSON.parse((db.prepare("SELECT payload_json FROM world_events WHERE kind = 'upstream.refused'").get() as { payload_json: string }).payload_json)).toMatchObject({ refused_by: "purser", reason: expect.stringMatching(/^mandate_cap_exceeded/) });
    expect(lastFeed(db)).toMatch(/refused by Purser before signing, against the mandate/);
    // Not a turned-away customer under the agent's own policy.
    expect(n(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE refusal_reason LIKE 'buy_policy:%'")).toBe(0);
  });

  it("with the let-through armed, that purchase goes to Metal once (Metal refuses it, recorded), then Purser refuses again", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    const a = armed(db);
    price(db, "0.04");
    expect(await a.buy(17)).toMatchObject({ ok: false, reason: "mandate_cap_exceeded" });
    expect(state.signed).toEqual([4]);
    expect(letThrough(db)).toMatchObject({ stage: "used", outcome: "metal_refused", seq: 17 });
    expect(n(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.let_through_refused'")).toBe(1);
    expect(refusedRows(db)[0]).toMatchObject({ refused_by: "metal" });
    // Disarmed: the next one is Purser's refusal before signing, as always; never the buy policy's.
    expect(await a.buy(18)).toMatchObject({ ok: false, reason: expect.stringMatching(/^mandate_cap_exceeded: /) });
    expect(state.signed).toEqual([4]);
    expect(n(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.let_through'")).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM holds WHERE status = 'HELD'").get()).toEqual({ n: 0 });
  });

  it("the buy policy still refuses a price under the cap but over its max_price: nothing reserved or signed, the arm untouched", async () => {
    const db = world({ supplier: "stockline", max_price: "0.02" });
    const a = armed(db);
    price(db, "0.03");
    const r = await a.buy(17);
    expect(r).toMatchObject({ ok: false, reason: "buy_policy: Stockline asks 0.03, over the 0.02 the Sourcing agent's policy allows" });
    expect(state.signed).toEqual([]);
    expect(n(db, "SELECT COUNT(*) AS n FROM holds")).toBe(0);
    expect(n(db, "SELECT COUNT(*) AS n FROM velocity_events")).toBe(0);
    expect(letThrough(db)).toMatchObject({ stage: "armed" });
    // The audit trail and the feed name the agent's own policy, not Purser or the mandate.
    expect(refusedRows(db)).toEqual([expect.objectContaining({ refused_by: "buy_policy" })]);
    expect(lastFeed(db)).toMatch(/the Sourcing agent's own buy policy/);
    expect(lastFeed(db)).not.toMatch(/Purser|mandate/);
  });

  it("never looser: an offer that changed after the price check is held to max_price on the amount actually signed", async () => {
    // The check saw 0.02 (within the policy); at signing the supplier asks 0.03, within the cap but over the policy.
    const db = world({ supplier: "stockline", max_price: "0.02" });
    state.offer = 2;
    price(db, "0.03");
    expect(await new SourcingAgent(db, "http://supplier", SUPPLIER).buy(17)).toMatchObject({ ok: false, reason: expect.stringMatching(/^buy_policy: Stockline asks 0\.03/) });
    expect(state.signed).toEqual([]);
    expect(n(db, "SELECT COUNT(*) AS n FROM holds WHERE status = 'HELD'")).toBe(0);
    // And the other way: the check saw 0.04 (over the cap, so on to Purser), at signing 0.03 is within the cap but over
    // the policy: the policy refuses it, nothing is signed.
    const other = world({ supplier: "stockline", max_price: "0.02" });
    state.offer = 4;
    price(other, "0.03");
    expect(await new SourcingAgent(other, "http://supplier", SUPPLIER).buy(17)).toMatchObject({ ok: false, reason: expect.stringMatching(/^buy_policy: Stockline asks 0\.03/) });
    expect(state.signed).toEqual([]);
    expect(n(other, "SELECT COUNT(*) AS n FROM holds WHERE status = 'HELD'")).toBe(0);
  });

  it("within the policy and the cap: paid as before", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    price(db, "0.02");
    expect(await new SourcingAgent(db, "http://supplier", SUPPLIER).buy(5)).toMatchObject({ ok: true });
    expect(state.signed).toEqual([2]);
  });

  it("a supplier mismatch is still refused: 'do not buy' refuses even an armed over-cap purchase, and the arm waits", async () => {
    const db = world({ supplier: "none", max_price: null });
    const a = armed(db);
    price(db, "0.04");
    expect(await a.buy(17)).toMatchObject({ ok: false, reason: expect.stringMatching(/^buy_policy: the Sourcing agent chose not to buy/) });
    expect(state.signed).toEqual([]);
    expect(letThrough(db)).toMatchObject({ stage: "armed" });
  });

  it("a supplier mismatch is still refused: an offer paying someone other than the policy's supplier is not let through", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    const a = armed(db, "0x0000000000000000000000000000000000000002");
    price(db, "0.04");
    expect(await a.buy(17)).toMatchObject({ ok: false, reason: expect.stringMatching(/^mandate_cap_exceeded: /) });
    expect(state.signed).toEqual([]);
    expect(letThrough(db)).toMatchObject({ stage: "used", outcome: "not_let_through", detail: expect.stringMatching(/pays someone other than the supplier the policy targets/) });
  });

  it("an unreachable supplier is told as the supplier's, not Purser's", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await new SourcingAgent(db, "http://supplier", SUPPLIER).buy(17)).toMatchObject({ ok: false, reason: expect.stringMatching(/^supplier_unavailable: /) });
    expect(refusedRows(db)).toEqual([expect.objectContaining({ refused_by: "supplier" })]);
    expect(lastFeed(db)).not.toMatch(/Purser|against the mandate/);
  });
});

describe("dry-179 item 8: the Sourcing agent's purchases while a replace of its mandate is open", () => {
  function openReplace(db: DB): string {
    const steps = ["treasury", "sourcing"].map((agent, i) => ({ order: String(i + 1), agent, principal: "0xb1", cap: "0.04", budget: "6.00", payees: [], expires_at: "2099-01-01T00:00:00Z", credential_hash: `0x${agent}1`, replaces_credential_hash: `0x${agent}0`, spent_at_proposal: "0.00" }));
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: "P-0002", expires_at: new Date(Date.now() + 3_600_000).toISOString(), option: "A", query_price: "0.05", upstream_price: "0.04", margin: "0.01", total_budget: "20.00", steps, evidence: [] } as never, createdBy: "treasury" });
    return "P-0002";
  }

  it("within the cap: held by Purser before signing, with the reason; the customer is answered with an error status; nothing reserved", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    openReplace(db);
    price(db, "0.02");
    const r = await new SourcingAgent(db, "http://supplier", SUPPLIER).buy(20);
    expect(r).toMatchObject({ ok: false, reason: "replace_pending: mandate replace P-0002 pending; spending waits until it is executed or closed" });
    expect(state.signed).toEqual([]);
    expect(n(db, "SELECT COUNT(*) AS n FROM holds")).toBe(0);
    expect(refusedRows(db)).toEqual([expect.objectContaining({ refused_by: "purser", reason: expect.stringMatching(/^replace_pending: /) })]);
    expect(lastFeed(db)).toMatch(/held by Purser before signing: mandate replace P-0002 pending/);
    // Not a turned-away customer under the agent's own policy, and not a cap refusal to record on chain.
    expect(n(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE refusal_reason LIKE 'buy_policy:%'")).toBe(0);
    expect(state.onChain).toEqual([]);
  });

  it("over the cap, armed: the hold comes first, so nothing goes to Metal and the arm is not used up", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    const a = armed(db);
    openReplace(db);
    price(db, "0.04");
    expect(await a.buy(21)).toMatchObject({ ok: false, reason: expect.stringMatching(/^replace_pending: /) });
    expect(state.signed).toEqual([]);
    expect(state.onChain).toEqual([]);
    expect(letThrough(db)).toMatchObject({ stage: "armed" });
  });

  it("the replace executed: the hold lifts and the Sourcing agent buys again", async () => {
    const db = world({ supplier: "stockline", max_price: "0.03" });
    openReplace(db);
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0002'").run();
    price(db, "0.02");
    expect(await new SourcingAgent(db, "http://supplier", SUPPLIER).buy(22)).toMatchObject({ ok: true });
    expect(state.signed).toEqual([2]);
  });
});

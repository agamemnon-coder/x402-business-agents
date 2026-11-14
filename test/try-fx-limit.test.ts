// /try's FX limit (14 Nov, live): the Airwallex sandbox prices its quotes about 1% over its own market rate, so at the
// default limit (FX_QUOTE_MAX_MARKUP_BPS, 0.50%) every live quote escalated and /try stopped at Approve. A try company's
// seed sets its own limit to 1.50% (TRY_FX_QUOTE_MAX_MARKUP_BPS, setting fx.max_markup_bps); every other company keeps
// 0.50%. A quote 1% over is used live and goes through Approve to paid; one over the company's limit falls back to the
// recorded rate (cloud/src/engine/liveFx.ts, over_limit, #339) at the same limit. The terms' view says the limit. The source is a fake of the AwxFx entrypoint: no network.
import { describe, expect, it } from "vitest";
import { useDocStore } from "../src/ap/docStore.js";
import { FX_QUOTE_MAX_MARKUP_BPS, TRY_FX_QUOTE_MAX_MARKUP_BPS } from "../src/config/policy.js";
import { openDb } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { fxMarkupLimitBps } from "../src/world/settings.js";
import { withLiveFx, type LiveFxSource } from "../cloud/src/engine/liveFx.js";

const RP = "engine.example.invalid";
const ORIGIN = `https://${RP}`;
const MARKET = 1.1;

/** Airwallex's quote for what was asked, `bps` over its own market rate (1.1000). */
const over = (bps: number): LiveFxSource => ({
  quote: async (a) => {
    const rate = (MARKET * (1 + bps / 10_000)).toFixed(4);
    const sell = (Math.ceil(Number(a.buyAmount) * Number(rate) * 100) / 100).toFixed(2);
    return { ok: true, quote: { quote_id: `q-${bps}-0000-0000-000000000000`, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: a.buyAmount, sell_amount: sell, client_rate: rate, valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: MARKET.toFixed(4) };
  },
});

async function company(source: LiveFxSource, fxMarkupBps?: number) {
  const { SAMPLES } = await import("../cloud/src/engine/samples.gen.js");
  const db = openDb(":memory:");
  const docs = new Map<string, Buffer>();
  useDocStore(db, { put: (sha, b) => { docs.set(`mem:${sha}`, Buffer.from(b)); return `mem:${sha}`; }, get: (p) => docs.get(p)! });
  const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
  const bank = standInBank(store);
  const fx = withLiveFx(bank, { company: "t_try_test", source, allowed: async () => true, db, keep: { get: () => null, set: () => {} } });
  const h = new EngineHost({ db, reader: parserOnly, rails: { rail: fx.rail, sim: bank }, afterMoney: () => store.save(bankToText(bank)), rp: { rpId: RP, origin: ORIGIN }, company: { name: "Try Co", lang: "en" }, vault: null, feed: null, samples: SAMPLES, ...(fxMarkupBps !== undefined ? { fxMarkupBps } : {}) });
  await h.seed();
  const up = await h.uploadSample("clean");
  return { db, h, invoiceId: up!.invoice!.id };
}

describe("/try's FX limit: 1.50% for a try company, 0.50% everywhere else", () => {
  it("the limits: a try company's seed sets 150 bps; a company without it keeps 50", async () => {
    expect(TRY_FX_QUOTE_MAX_MARKUP_BPS).toBe(150);
    expect(FX_QUOTE_MAX_MARKUP_BPS).toBe(50);
    const t = await company(over(10), TRY_FX_QUOTE_MAX_MARKUP_BPS);
    expect(fxMarkupLimitBps(t.db)).toBe(150);
    const other = await company(over(10));
    expect(fxMarkupLimitBps(other.db)).toBe(50);
  });

  it("a live quote 1.00% over: the try company files it, the terms carry it and say the limit, and it is approved and paid", async () => {
    const { db, h, invoiceId } = await company(over(100), TRY_FX_QUOTE_MAX_MARKUP_BPS);
    const p = await h.propose(invoiceId);
    expect(p.ok).toBe(true);
    const proposal = (p as { proposal: { id: string; terms_sha256: string; challenge: string } }).proposal;
    const view = h.terms(proposal.id)!;
    const cv = (view.terms as unknown as { conversion: { quote_id: string; client_rate: string } }).conversion;
    expect(cv.quote_id).toBe("q-100-0000-0000-000000000000");
    expect(view.fx_limit_bps).toBe(150);
    const checked = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'fx.rate_checked'").get() as { payload_json: string }).payload_json);
    expect(checked).toMatchObject({ markup_bps: 100, limit_bps: 150 });
    const phone = new FakeAuthenticator();
    const start = await h.passkeyStart();
    await h.passkeyFinish({ code: start.code, credential: phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: "Test Owner" });
    const paid = await h.approve({ proposal_id: proposal.id, terms_sha256: proposal.terms_sha256, credential: phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(paid).toMatchObject({ status: "approved", settled: { invoice_status: "paid" } });
  });

  it("the same quote at a company without the setting (0.50%): over the limit, so the recorded rate is used (#339), never a 409", async () => {
    const { h, invoiceId } = await company(over(100));
    const p = await h.propose(invoiceId);
    expect(p.ok).toBe(true);
    const view = h.terms((p as { proposal: { id: string } }).proposal.id)!;
    expect((view.terms as unknown as { conversion: { quote_id: string } }).conversion.quote_id).not.toBe("q-100-0000-0000-000000000000");
    expect(view.fx_limit_bps).toBe(50);
  });

  it("a live quote 2.00% over at the try company: over its 1.50%, so the recorded rate is used (over_limit), never a 409", async () => {
    const { h, invoiceId } = await company(over(200), TRY_FX_QUOTE_MAX_MARKUP_BPS);
    const p = await h.propose(invoiceId);
    expect(p.ok).toBe(true);
    const view = h.terms((p as { proposal: { id: string } }).proposal.id)!;
    expect((view.terms as unknown as { conversion: { quote_id: string } }).conversion.quote_id).not.toBe("q-200-0000-0000-000000000000");
  });
});

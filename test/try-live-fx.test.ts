// /try's live FX quote (14 Nov), on the engine's side (cloud/src/engine/liveFx.ts): a test company's payment that needs
// currency bought plans with the Airwallex sandbox's quote, so the terms the passkey signs carry its quote id, rate,
// amounts and valid-to; when Airwallex is off, slow or wrong, the recorded rate is used and the note says why.
// The source here is a fake of the kit11 Worker's AwxFx entrypoint (worker/src/awxFx.ts): no network.
import { describe, expect, it } from "vitest";
import { useDocStore } from "../src/ap/docStore.js";
import { openDb, type DB } from "../src/db/open.js";
import { publicEvent, type EventRow } from "../src/engine/events.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { canonicalTerms, termsHash } from "../src/lib/terms.js";
import { withLiveFx, type LiveFxAnswer, type LiveFxSource } from "../cloud/src/engine/liveFx.js";
import { eventLine } from "../cloud/src/tryEvents.js";

const QUOTE_ID = "cc8fb106-29bb-3cce-b011-5fd0b4685617";

/** The AwxFx entrypoint's answer: Airwallex's quote for exactly what was asked, at 1.1612 (its own rate 1.1601). */
function liveSource(o: { answer?: (a: { buyAmount: string }) => LiveFxAnswer; hang?: boolean } = {}) {
  const asked: { company: string; buyCurrency: string; sellCurrency: string; buyAmount: string }[] = [];
  const source: LiveFxSource = {
    quote: async (a) => {
      asked.push(a);
      if (o.hang) return new Promise<LiveFxAnswer>(() => {});
      if (o.answer) return o.answer(a);
      const sell = (Math.ceil(Number(a.buyAmount) * 1.1612 * 100) / 100).toFixed(2);
      return { ok: true, quote: { quote_id: QUOTE_ID, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: a.buyAmount, sell_amount: sell, client_rate: "1.1612", valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: "1.1601" };
    },
  };
  return { source, asked };
}

async function company(source: LiveFxSource, o: { allowed?: boolean; waitMs?: number; fxMarkupBps?: number } = {}) {
  const { SAMPLES } = await import("../cloud/src/engine/samples.gen.js");
  const db = openDb(":memory:");
  const docs = new Map<string, Buffer>();
  useDocStore(db, { put: (sha, b) => { docs.set(`mem:${sha}`, Buffer.from(b)); return `mem:${sha}`; }, get: (p) => docs.get(p)! });
  const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
  const bank = standInBank(store);
  const notes = new Map<string, string>();
  const fx = withLiveFx(bank, { company: "t_try_test", source, allowed: async () => o.allowed ?? true, db, keep: { get: (id) => notes.get(id) ?? null, set: (id, n) => { notes.set(id, n); } }, ...(o.waitMs ? { waitMs: o.waitMs } : {}) });
  const h = new EngineHost({ db, reader: parserOnly, rails: { rail: fx.rail, sim: bank }, afterMoney: () => store.save(bankToText(bank)), rp: { rpId: "engine.example.invalid", origin: "https://engine.example.invalid" }, company: { name: "Try Co", lang: "en" }, vault: null, feed: null, samples: SAMPLES, ...(o.fxMarkupBps !== undefined ? { fxMarkupBps: o.fxMarkupBps } : {}) });
  await h.seed();
  const up = await h.uploadSample("clean");
  const p = await h.propose(up!.invoice!.id);
  expect(p.ok).toBe(true);
  const id = (p as { proposal: { id: string; terms_sha256: string } }).proposal;
  const t = h.terms(id.id)!;
  return { db, bank, h, proposal: id, terms: t, note: fx.noteFor(t.terms) };
}

const events = (db: DB) => (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log ORDER BY seq").all() as EventRow[]).map(publicEvent);
type Conversion = { quote_id: string; client_rate: string; sell_amount: string; buy_amount: string; sell_currency: string; buy_currency: string; valid_to: string };

describe("/try's live FX quote in the signed terms", () => {
  it("the clean invoice's shortfall is bought on Airwallex's live sandbox quote, and the passkey's challenge covers its id, rate, amounts and valid-to", async () => {
    const { source, asked } = liveSource();
    const { db, bank, proposal, terms, note } = await company(source);
    const cv = (terms.terms as unknown as { conversion: Conversion | null }).conversion!;
    expect(cv).not.toBeNull();
    expect(cv.quote_id).toBe(QUOTE_ID);
    expect(cv.client_rate).toBe("1.1612");
    expect(cv.buy_currency).toBe("EUR");
    expect(cv.sell_currency).toBe("USD");
    // The company's own id, the pair and the shortfall: nothing else is sent to kit11.
    expect(asked[0]).toEqual({ company: "t_try_test", buyCurrency: "EUR", sellCurrency: "USD", buyAmount: cv.buy_amount });
    // Asked once for the plan's rate and its quote.
    expect(asked).toHaveLength(1);
    // The signature's challenge is the hash of these exact terms: another quote id or rate is another hash.
    expect(terms.terms_sha256).toBe(proposal.terms_sha256);
    expect(termsHash(terms.terms)).toBe(proposal.terms_sha256);
    expect(canonicalTerms(terms.terms)).toContain(QUOTE_ID);
    const other = { ...terms.terms, conversion: { ...cv, client_rate: "1.0850" } };
    expect(termsHash(other)).not.toBe(proposal.terms_sha256);
    const otherId = { ...terms.terms, conversion: { ...cv, quote_id: "00000000-0000-0000-0000-000000000000" } };
    expect(termsHash(otherId)).not.toBe(proposal.terms_sha256);
    // The page's note, and the step in the log in plain words.
    expect(note).toMatchObject({ source: "airwallex-sandbox", quote_id: QUOTE_ID, client_rate: "1.1612", market_rate: "1.1601" });
    const ev = events(db).find((e) => e.event === "airwallex.quote")!;
    expect(ev.fields).toEqual({ quote_id: QUOTE_ID, client_rate: "1.1612", valid_to: cv.valid_to });
    expect(eventLine(ev).text).toBe(`Airwallex sandbox: quote ${QUOTE_ID} at 1.1612.`);
    expect(eventLine(ev).who).toBe("Airwallex sandbox");
    // The markup was checked against Airwallex's own rate from the same answer.
    const checked = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'fx.rate_checked'").get() as { payload_json: string };
    expect(JSON.parse(checked.payload_json)).toMatchObject({ market_rate: "1.1601", quote_id: QUOTE_ID, quote_rate: "1.1612" });
    // The simulated bank knows the quote, so it converts at Airwallex's amounts later (test money).
    expect(bank.quotes.has(QUOTE_ID)).toBe(true);
  });

  it("Airwallex too slow: the recorded rate is used, the note and the log say so, and nothing waits longer than the limit", async () => {
    const { source } = liveSource({ hang: true });
    const t0 = Date.now();
    const { db, terms, note } = await company(source, { waitMs: 200 });
    expect(Date.now() - t0).toBeLessThan(10_000);
    const cv = (terms.terms as unknown as { conversion: Conversion }).conversion;
    expect(cv.client_rate).toBe("1.0850");
    expect(cv.quote_id).not.toBe(QUOTE_ID);
    expect(note).toMatchObject({ source: "recorded", reason: "timeout", client_rate: "1.0850" });
    const ev = events(db).find((e) => e.event === "airwallex.unavailable")!;
    expect(ev.fields).toEqual({ reason: "timeout", client_rate: "1.0850" });
    expect(eventLine(ev).text).toBe("Airwallex unavailable, recorded rate used (1.0850).");
    expect(events(db).some((e) => e.event === "airwallex.quote")).toBe(false);
  });

  it("the switch off: Airwallex is never asked, and the recorded rate is labelled", async () => {
    const { source, asked } = liveSource();
    const { note } = await company(source, { allowed: false });
    expect(asked).toHaveLength(0);
    expect(note).toMatchObject({ source: "recorded", reason: "switched_off" });
  });

  it("an answer that is not for what was asked, a refusal, or a throw: the recorded rate, never a guess", async () => {
    const wrong = await company(liveSource({ answer: (a) => ({ ok: true, quote: { quote_id: QUOTE_ID, buy_currency: "EUR", sell_currency: "USD", buy_amount: (Number(a.buyAmount) + 1).toFixed(2), sell_amount: "10.00", client_rate: "1.16", valid_to_at: new Date(Date.now() + 900_000).toISOString() }, market_rate: "1.16" }) }).source);
    expect(wrong.note).toMatchObject({ source: "recorded", reason: "bad_answer" });
    const capped = await company(liveSource({ answer: () => ({ ok: false, reason: "day_cap" }) }).source);
    expect(capped.note).toMatchObject({ source: "recorded", reason: "day_cap" });
    // The sandbox's quote 1% over its own rate: over Purser's FX limit, so the recorded rate is used and Approve runs.
    const dear = await company(liveSource({ answer: (a) => ({ ok: true, quote: { quote_id: QUOTE_ID, buy_currency: "EUR", sell_currency: "USD", buy_amount: a.buyAmount, sell_amount: (Math.ceil(Number(a.buyAmount) * 1.1717 * 100) / 100).toFixed(2), client_rate: "1.1717", valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: "1.1601" }) }).source);
    expect(dear.note).toMatchObject({ source: "recorded", reason: "over_limit" });
    expect((dear.terms.terms as unknown as { conversion: Conversion }).conversion.quote_id).not.toBe(QUOTE_ID);
    // A try company's limit is 1.50% (TRY_FX_QUOTE_MAX_MARKUP_BPS): the same quote 1% over is used live; one 2% over is not.
    const tryCo = await company(liveSource({ answer: (a) => ({ ok: true, quote: { quote_id: QUOTE_ID, buy_currency: "EUR", sell_currency: "USD", buy_amount: a.buyAmount, sell_amount: (Math.ceil(Number(a.buyAmount) * 1.1717 * 100) / 100).toFixed(2), client_rate: "1.1717", valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: "1.1601" }) }).source, { fxMarkupBps: 150 });
    expect(tryCo.note).toMatchObject({ source: "airwallex-sandbox", quote_id: QUOTE_ID });
    expect((tryCo.terms.terms as unknown as { conversion: Conversion }).conversion.quote_id).toBe(QUOTE_ID);
    const tooDear = await company(liveSource({ answer: (a) => ({ ok: true, quote: { quote_id: QUOTE_ID, buy_currency: "EUR", sell_currency: "USD", buy_amount: a.buyAmount, sell_amount: (Math.ceil(Number(a.buyAmount) * 1.1833 * 100) / 100).toFixed(2), client_rate: "1.1833", valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: "1.1601" }) }).source, { fxMarkupBps: 150 });
    expect(tooDear.note).toMatchObject({ source: "recorded", reason: "over_limit" });
    const odd = await company(liveSource({ answer: () => ({ ok: false, reason: "something Airwallex said" }) }).source);
    expect(odd.note).toMatchObject({ source: "recorded", reason: "unavailable" });
    const thrown = await company({ quote: async () => { throw new Error("binding failed"); } });
    expect(thrown.note).toMatchObject({ source: "recorded", reason: "unavailable" });
  });
});

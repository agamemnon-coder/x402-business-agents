// Hardening plan item 2: Airwallex webhook payloads. The relay (worker/src/core.ts) and the runner
// (src/policy/cardHooks.ts) each check x-signature = HMAC-SHA256(secret, x-timestamp + raw body); the runner then
// records the card transaction once (src/policy/cards.ts). These properties hold for arbitrary bodies, timestamps and
// signatures: any change fails verification, nothing throws, and a webhook never records more than Airwallex said.
import Database from "better-sqlite3";
import fc from "fast-check";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CARD_EVENTS } from "../src/airwallex/webhooks.js";
import { openDb, type DB } from "../src/db/open.js";
import { handleAirwallexHook, hookSignatureOk } from "../src/policy/cardHooks.js";
import { setupCards } from "../src/policy/cards.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { Relay, type Sql } from "../worker/src/core.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const SECRET = ["whsec", "prop", "y".repeat(24)].join("_");
const t0 = new Date("2026-11-03T10:00:00Z");
const RUNS = { numRuns: 300 };

const sign = (ts: string, body: string, key = SECRET) => createHmac("sha256", key).update(ts + body).digest("hex");

/** One edit of a string: replace, insert or delete a character. Always returns a different string. */
const edited = (s: string) => fc.tuple(fc.nat(), fc.constantFrom("replace", "insert", "delete"), fc.string({ unit: "grapheme", minLength: 1, maxLength: 1 })).map(([at, how, ch]) => {
  const i = s.length === 0 ? 0 : at % (how === "insert" ? s.length + 1 : s.length);
  const out = how === "insert" || s.length === 0 ? s.slice(0, i) + ch + s.slice(i)
    : how === "delete" ? s.slice(0, i) + s.slice(i + 1)
    : s.slice(0, i) + ch + s.slice(i + 1);
  return out === s ? `${s}${ch === "x" ? "y" : "x"}` : out;
});

const tsArb = fc.integer({ min: 1_000_000_000, max: 9_999_999_999_999 }).map(String);
const bodyArb = fc.oneof(fc.json({ maxDepth: 3 }), fc.string({ unit: "grapheme", maxLength: 60 }), fc.string({ maxLength: 60 }));

describe("the runner's signature check (hookSignatureOk)", () => {
  // Breaks if the HMAC no longer covers the body, or compares only a prefix of it.
  it("accepts the true signature, in either case, and refuses any one-character change to the body", () => {
    fc.assert(fc.property(tsArb, bodyArb.chain((b) => fc.tuple(fc.constant(b), edited(b))), fc.boolean(), (ts, [body, changed], upper) => {
      const signature = upper ? sign(ts, body).toUpperCase() : sign(ts, body);
      expect(hookSignatureOk({ id: "e", ts, signature, body }, SECRET)).toBe(true);
      // A changed body under the original signature.
      fc.pre(Buffer.from(changed, "utf8").compare(Buffer.from(body, "utf8")) !== 0);
      expect(hookSignatureOk({ id: "e", ts, signature, body: changed }, SECRET)).toBe(false);
    }), RUNS);
  });

  // Breaks if the timestamp is left out of the HMAC (an old event could then be replayed with a new timestamp).
  it("refuses any one-character change to the timestamp", () => {
    fc.assert(fc.property(tsArb.chain((ts) => fc.tuple(fc.constant(ts), edited(ts))), bodyArb, ([ts, changed], body) => {
      // A change that only moves the boundary between timestamp and body is the next test's subject.
      fc.pre(changed + body !== ts + body);
      expect(hookSignatureOk({ id: "e", ts: changed, signature: sign(ts, body), body }, SECRET)).toBe(false);
    }), RUNS);
  });

  // Breaks if the comparison accepts a shorter, non-hex or partially matching signature, or another key's MAC.
  it("refuses any other signature or secret, and never throws on garbage", () => {
    fc.assert(fc.property(tsArb, bodyArb, fc.oneof(fc.string({ maxLength: 70 }), fc.stringMatching(/^[0-9a-f]{64}$/), fc.stringMatching(/^[0-9a-f]{63}$/)), fc.string({ minLength: 1, maxLength: 20 }), fc.nat(63), (ts, body, sig, otherKey, flip) => {
      const good = sign(ts, body);
      fc.pre(sig.toLowerCase() !== good);
      expect(hookSignatureOk({ id: "e", ts, signature: sig, body }, SECRET)).toBe(false);
      const flipped = good.slice(0, flip) + (good[flip] === "0" ? "1" : "0") + good.slice(flip + 1);
      expect(hookSignatureOk({ id: "e", ts, signature: flipped, body }, SECRET)).toBe(false);
      fc.pre(otherKey !== SECRET);
      expect(hookSignatureOk({ id: "e", ts, signature: sign(ts, body, otherKey), body }, SECRET)).toBe(false);
    }), RUNS);
  });
});

// ── Card events, well-formed and not ──

const card = { ids: [] as string[] };
let db: DB;
let seq = 0;
const nextTx = () => `ct-prop-${++seq}`;
/** A moment of its own for each transaction: the ledger treats same card, amount, outcome and moment as one authorisation. */
const momentOf = (tx: string) => new Date(t0.getTime() - Number(tx.slice("ct-prop-".length)) * 1000).toISOString();

const anyValue = fc.jsonValue({ maxDepth: 2 });
const amountValue = fc.oneof(fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }).map((c) => c / 100), fc.constantFrom("45", "45.00", "0.01"), anyValue);
const statusValue = fc.oneof(fc.constantFrom("APPROVED", "DECLINED", "FAILED", "REVERSED", "PENDING", "CLEARED"), anyValue, fc.constant(undefined));
const dateValue = fc.oneof(fc.constant(t0.toISOString()), fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), anyValue, fc.constant(undefined));

/** A card transaction object with each field well-typed, mistyped or missing. */
const cardObject = fc.record({
  card_id: fc.oneof(fc.constant("OUR"), fc.string({ maxLength: 10 }), anyValue),
  card_transaction_id: fc.oneof(fc.constant("FRESH"), anyValue, fc.constant(undefined)),
  transaction_amount: fc.oneof(amountValue, fc.constant(undefined)),
  transaction_currency: fc.oneof(fc.constantFrom("EUR", "USD"), anyValue),
  process_result: statusValue,
  status: fc.oneof(fc.constant(undefined), statusValue),
  failure_reason: fc.oneof(fc.constant(undefined), fc.constant(null), fc.constantFrom("LIMIT_EXCEEDED", ""), anyValue),
  transacted_at: dateValue,
  merchant: fc.oneof(fc.record({ name: fc.oneof(fc.string({ maxLength: 12 }), anyValue), category_code: fc.oneof(fc.constant("5734"), anyValue) }), anyValue),
}, { requiredKeys: [] });

const eventArb = fc.record({
  id: fc.oneof(fc.string({ maxLength: 12 }), anyValue),
  name: fc.oneof(fc.constantFrom(...CARD_EVENTS), fc.constantFrom("issuing.other", "account.active", ""), anyValue),
  flat: fc.boolean(),
  object: cardObject,
}).map(({ id, name, flat, object }) => ({ id, name, data: flat ? object : { object } }));

/** Fills the placeholders: our card, a fresh transaction id (so dedupe never hides a recording). */
function realise(e: { id: unknown; name: unknown; data: unknown }, cardPick: number): string {
  const fresh = nextTx();
  return JSON.stringify(e, (k, v) => (v === "OUR" ? card.ids[cardPick % card.ids.length] : v === "FRESH" ? fresh : k === "transacted_at" && v === t0.toISOString() ? momentOf(fresh) : v));
}

const rows = () => (db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get() as { n: number }).n;
// The relay passes each event on under the event's own id (worker/src/core.ts keeps only bodies with a string id).
const idOf = (body: string) => { try { const v = JSON.parse(body) as { id?: unknown }; return typeof v?.id === "string" ? v.id : "evt"; } catch { return "evt"; } };
const handled = (body: string, ts = String(t0.getTime())) => handleAirwallexHook(db, { id: idOf(body), ts, signature: sign(ts, body), body }, SECRET, t0);

describe("the runner records a webhook's card transaction (handleAirwallexHook)", () => {
  beforeAll(async () => {
    db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => t0.getTime();
    await setupCards(db, awx, t0);
    card.ids = awx.cards.map((c) => c.cardId);
  });
  afterAll(() => db.close());

  // Breaks if handleAirwallexHook lets an exception out (it promises "never throws"), e.g. the try/catch around
  // toCardTransaction is narrowed, or JSON.parse is moved outside its try.
  // FOUND (bug 3, also when "name" is an object such as {"toString":""}: String(name) throws "Cannot convert object to
  // primitive value"; seed 1960890412). Skipped until the handler refuses such bodies instead of throwing (after the
  // Friday runs); then un-skip.
  it("never throws on any signed body and records at most one transaction per event", () => {
    fc.assert(fc.property(fc.oneof(eventArb.chain((e) => fc.nat().map((n) => realise(e, n))), bodyArb), (body) => {
      fc.pre(body.trim() !== "null"); // the one body that does throw: see the skipped test below
      const before = rows();
      let line = "";
      expect(() => { line = handled(body); }).not.toThrow();
      expect(typeof line).toBe("string");
      expect(rows() - before).toBeGreaterThanOrEqual(0);
      expect(rows() - before).toBeLessThanOrEqual(1);
    }), { numRuns: 500 });
  });

  // FOUND (hardening plan item 2): handleAirwallexHook promises "Never throws", but a correctly signed body that is
  // the JSON literal null makes it throw. src/policy/cardHooks.ts:31 parses it to null and :35 reads event.name:
  //   body = "null"  -> TypeError: Cannot read properties of null (reading 'name')   (expected: "...ignored" line)
  // The relay never passes such a body on (it answers 400 to anything but an object with a string id), and it needs a
  // valid signature, so this is a robustness gap in the runner's own check, not a forgery path. Fix idea: refuse any
  // parsed value that is not a plain object before reading fields. Skipped until fixed.
  it("never throws, even on a signed body of null", () => {
    fc.assert(fc.property(fc.constantFrom("null", " null ", "null\n"), (body) => {
      expect(() => handled(body)).not.toThrow();
    }), { numRuns: 10 });
  });

  // Breaks if the signature check is moved after recording, or skipped for some event names.
  it("records nothing from an event whose body or timestamp was changed after signing", () => {
    fc.assert(fc.property(eventArb, fc.nat(), fc.nat(), fc.boolean(), (e, pick, at, inTs) => {
      const body = realise(e, pick);
      const ts = String(t0.getTime());
      const before = rows();
      const i = at % body.length;
      const changedBody = inTs ? body : body.slice(0, i) + (body[i] === " " ? "_" : " ") + body.slice(i + 1);
      const changedTs = inTs ? String(t0.getTime() + 1 + (at % 1000)) : ts;
      expect(handleAirwallexHook(db, { id: "evt", ts: changedTs, signature: sign(ts, body), body: changedBody }, SECRET, t0)).toMatch(/bad signature/);
      expect(rows()).toBe(before);
    }), RUNS);
  });

  // Breaks if a card id that is not one of ours, or an event that is not issuing.*, can reach the ledger.
  it("records nothing for a card that is not ours or an event that is not a card transaction", () => {
    fc.assert(fc.property(eventArb, (e) => {
      const body = JSON.stringify(e);
      const parsed = JSON.parse(body) as { name?: unknown };
      const before = rows();
      // A malformed body may make the handler throw (bug 3 below, skipped until fixed); what matters here is that
      // nothing is recorded either way.
      try { handled(body); } catch { /* bug 3 */ }
      // "OUR" was never replaced: no card in the event is ours, whatever else it says.
      if (!card.ids.some((id) => body.includes(id)) || !String(parsed.name ?? "").startsWith("issuing.")) expect(rows()).toBe(before);
    }), RUNS);
  });

  // Breaks if a declined result (DECLINED, FAILED, REVERSED, or a failure reason without a status) is ever recorded as
  // an approved charge, e.g. if DECLINED in issuing.ts loses a word or the failure_reason fallback is dropped.
  it("never records a declined transaction as an approved charge", () => {
    const declined = fc.record({
      result: fc.oneof(fc.constantFrom("DECLINED", "FAILED", "REVERSED").map((r) => ({ process_result: r })), fc.constantFrom("LIMIT_EXCEEDED", "CARD_INACTIVE").map((f) => ({ failure_reason: f }))),
      amount: fc.integer({ min: 0, max: 1_000_000 }).map((c) => c / 100),
      flat: fc.boolean(),
      pick: fc.nat(),
    });
    fc.assert(fc.property(declined, ({ result, amount, flat, pick }) => {
      const tx = nextTx();
      const object = { card_transaction_id: tx, card_id: card.ids[pick % card.ids.length], transaction_amount: amount, transaction_currency: "EUR", transacted_at: momentOf(tx), merchant: { name: "Shop", category_code: "5734" }, ...result };
      handled(JSON.stringify({ id: `evt-${tx}`, name: "issuing.card_transaction_event.failed", data: flat ? object : { object } }));
      const row = db.prepare("SELECT approved FROM card_transactions WHERE transaction_id = ?").get(tx) as { approved: number } | undefined;
      expect(row).toEqual({ approved: 0 });
    }), RUNS);
  });

  // FOUND (hardening plan item 2): a correctly signed but malformed card event is recorded as an APPROVED charge.
  // src/policy/cardHooks.ts:39 only checks that transaction_amount is not undefined, and src/airwallex/issuing.ts:134
  // reads it with Number(...), which accepts almost anything; issuing.ts:128 takes any non-string status as given and
  // treats every status outside DECLINED/FAILED/REVERSED as approved. Counterexamples (card_id one of our cards,
  // card_transaction_id set, no failure_reason; each is recorded with approved = 1, an audit "card.charge_approved"
  // and a velocity observation):
  //   transaction_amount: true      -> recorded approved 1.00 EUR   (expected: refused, "not an amount")
  //   transaction_amount: null      -> recorded approved 0.00 EUR
  //   transaction_amount: [45]      -> recorded approved 45.00 EUR
  //   transaction_amount: "0x2d"    -> recorded approved 45.00 EUR
  //   transaction_amount: "1e2"     -> recorded approved 100.00 EUR
  //   transaction_amount: ""        -> recorded approved 0.00 EUR
  //   process_result: 7 (a number)  -> recorded approved 5.00 EUR with status "7.0"
  // The signature means only Airwallex (or whoever holds the webhook secret) can send these, so the risk is a
  // misread rather than a forgery: a wrong amount in the ledger and in the agent's velocity count. Fix idea: accept
  // only a finite number or a decimal string as the amount (cents() on the raw value, without Number()), and only a
  // string status. Fixed (HF8): src/airwallex/issuing.ts cardAmountCents and the result check.
  it("never records an approved charge from a malformed event", () => {
    const malformed = fc.record({
      bad: fc.oneof(
        fc.constantFrom(true, null, [45], "0x2d", "1e2", "", false, {}, "  7 ").map((a) => ({ transaction_amount: a as unknown })),
        fc.constantFrom(7, true, ["APPROVED"], { s: 1 }).map((s) => ({ transaction_amount: 5, process_result: s as unknown })),
      ),
      pick: fc.nat(),
    });
    fc.assert(fc.property(malformed, ({ bad, pick }) => {
      const tx = nextTx();
      const object = { card_transaction_id: tx, card_id: card.ids[pick % card.ids.length], transaction_currency: "EUR", transacted_at: momentOf(tx), merchant: { name: "Shop" }, ...bad };
      handled(JSON.stringify({ id: `evt-${tx}`, name: "issuing.card_transaction_event.success", data: { object } }));
      const row = db.prepare("SELECT approved FROM card_transactions WHERE transaction_id = ?").get(tx) as { approved: number } | undefined;
      expect(row?.approved ?? 0).toBe(0);
    }), { ...RUNS, examples: [[{ bad: { transaction_amount: true }, pick: 0 }]] });
  });
});

// ── The relay (worker/src/core.ts) ──

describe("the relay's webhook route (worker Relay /hooks/airwallex)", () => {
  const raw = new Database(":memory:");
  const sql: Sql = { exec(query, ...bindings) { const st = raw.prepare(query); const out = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => out }; } };
  const relay = new Relay(sql, { relayToken: TOKEN, webhookSecret: SECRET, now: () => t0 });
  afterAll(() => raw.close());
  // Each request from its own address, so the relay's count of failed signatures (HF1) does not turn 401s into 429s.
  let from = 0;
  const post = (body: string, ts: string, signature: string) => {
    from++;
    const ip = `10.${(from >> 16) & 255}.${(from >> 8) & 255}.${from & 255}`;
    return relay.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": signature, "cf-connecting-ip": ip }, body }));
  };
  const kept = (): number => (raw.prepare("SELECT COUNT(*) AS n FROM hooks").get() as { n: number } | undefined)?.n ?? 0;
  const fresh = fc.integer({ min: -299_000, max: 299_000 }).map((d) => String(t0.getTime() + d));
  let n = 0;
  /** A body that is a JSON object with a unique string id, or anything else. */
  const relayBody = fc.oneof(
    fc.dictionary(fc.string({ maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 4 }).map((o) => JSON.stringify({ ...o, id: `evt-relay-${++n}` })),
    bodyArb,
  );

  // Breaks if the relay keeps anything but a correctly signed JSON object with a string id, or if a malformed body
  // makes it throw (a 500 from the Worker). A body that is not JSON is never kept: 401 or 400 (see the FOUND note
  // below for why it is not always 401).
  it("for any correctly signed body, keeps exactly the events and refuses the rest, and never throws", async () => {
    await fc.assert(fc.asyncProperty(relayBody, fresh, async (body, ts) => {
      const before = kept();
      const res = await post(body, ts, sign(ts, body));
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        value = undefined;
      }
      const event = typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string" && (value as { id: string }).id.length <= 128;
      if (event) expect(res.status).toBe(200);
      else expect([400, 401]).toContain(res.status);
      expect(kept() - before).toBeLessThanOrEqual(event ? 1 : 0);
    }), RUNS);
  });

  // Breaks if the relay checks the signature over a re-serialised body (JSON.stringify(parsed)) instead of the raw
  // bytes, or leaves the timestamp out of the HMAC.
  it("refuses any one-character change to the body or the timestamp, and keeps nothing", async () => {
    await fc.assert(fc.asyncProperty(relayBody.chain((b) => fc.tuple(fc.constant(b), edited(b))), fresh, fc.integer({ min: 1, max: 200_000 }), fc.boolean(), async ([body, changed], ts, dt, inTs) => {
      fc.pre(new TextEncoder().encode(changed).join() !== new TextEncoder().encode(body).join());
      const before = kept();
      const res = inTs ? await post(body, String(Number(ts) + (Number(ts) + dt - t0.getTime() > 299_000 ? -dt : dt)), sign(ts, body)) : await post(changed, ts, sign(ts, body));
      expect(res.status).not.toBe(200);
      if (inTs) expect(res.status).toBe(401);
      expect(kept()).toBe(before);
    }), RUNS);
  });

  // FOUND (hardening plan item 2): for a body that is not JSON, the relay checks the signature over the EMPTY string,
  // not over the body. worker/src/core.ts:327 sets text = "" when readJson could not parse the body, and the HMAC is
  // then computed over x-timestamp + "". Counterexample: x-timestamp "1793700000000", x-signature = HMAC(secret,
  // "1793700000000" + ""), body " " (or any non-JSON text) -> 400 "malformed event"; expected 401 "bad or missing
  // webhook signature" (and a correctly signed non-JSON body gets 401 instead of 400). Nothing is kept either way, so
  // there is no forgery path, but it contradicts the comment "The body is checked exactly as received, before anything
  // parses it". Fix idea: keep the raw text when JSON.parse fails. Skipped until fixed.
  it("answers 401 to every change of the signed body, JSON or not", async () => {
    await fc.assert(fc.asyncProperty(relayBody.chain((b) => fc.tuple(fc.constant(b), edited(b))), fresh, fc.integer({ min: 1, max: 200_000 }), fc.boolean(), async ([body, changed], ts, dt, inTs) => {
      fc.pre(new TextEncoder().encode(changed).join() !== new TextEncoder().encode(body).join());
      const before = kept();
      const res = inTs ? await post(body, String(Number(ts) + (Number(ts) + dt - t0.getTime() > 299_000 ? -dt : dt)), sign(ts, body)) : await post(changed, ts, sign(ts, body));
      expect(res.status).toBe(401);
      expect(kept()).toBe(before);
    }), { ...RUNS, examples: [[["", " "], "1793700000000", 1, false]] });
  });

  // Breaks if HOOK_TOLERANCE_MS is dropped or widened: a captured event could be replayed later.
  it("refuses a correctly signed event whose timestamp is more than five minutes off", async () => {
    await fc.assert(fc.asyncProperty(relayBody, fc.integer({ min: 300_001, max: 10 ** 10 }), fc.boolean(), async (body, off, past) => {
      const ts = String(t0.getTime() + (past ? -off : off));
      fc.pre(/^\d{10,16}$/.test(ts));
      const before = kept();
      expect((await post(body, ts, sign(ts, body))).status).toBe(401);
      expect(kept()).toBe(before);
    }), RUNS);
  });

  // The HMAC covers ts + body as one string (Airwallex's scheme), so moving characters across the boundary keeps the
  // MAC valid. Breaks if the relay stops requiring a 10-16 digit timestamp or a JSON object body: such a shifted pair
  // must still never be kept.
  it("never keeps an event whose timestamp/body boundary was moved", async () => {
    await fc.assert(fc.asyncProperty(relayBody, fresh, fc.integer({ min: -6, max: 6 }).filter((k) => k !== 0), async (body, ts, k) => {
      const whole = ts + body;
      const cut = ts.length + k;
      fc.pre(cut >= 0 && cut <= whole.length);
      const [ts2, body2] = [whole.slice(0, cut), whole.slice(cut)];
      const before = kept();
      let res: Response;
      try {
        res = await post(body2, ts2, sign(ts, body));
      } catch {
        // A header value outside Latin-1 cannot even be sent: nothing reaches the relay.
        expect(kept()).toBe(before);
        return;
      }
      expect(res.status).not.toBe(200);
      expect(kept()).toBe(before);
    }), RUNS);
  });
});

// /try/sign (A2): the Treasury agent's sentence on the waiting payment comes from a real Claude Haiku call, given the
// test world only (invoice, balance, floor, limit), never a visitor's words; a budget of USD 1 a day, limits per minute
// and per address, an 8 s timeout; otherwise the fixed sentence, labelled. The model only proposes: the checks, the
// terms (but for who proposed) and the approval stay in code and the passkey. No network: Anthropic is a fake fetch.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HAIKU, claudeSentence } from "../src/try/claude.js";
import { AGENT_LINE_ALL_PER_MINUTE, AGENT_LINE_DAILY_USD, AGENT_LINE_PER_HOUR, AGENT_LINE_SYSTEM, AGENT_LINE_TIMEOUT_MS, agentLineFacts, agentLineGiven, agentLineSource, amountsFit, checkLine, cleanLine, moneyForPeople } from "../worker/src/agentLine.js";
import { VOICE_LABELS, WHATS_REAL, trySignPage } from "../src/try/sign.js";
import { FIXED_PROPOSALS, TEST_WORLD, TrySignDesk } from "../worker/src/trySign.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import Database from "better-sqlite3";
import { StandInLine } from "./support/lineStandIn.js";
import { BASE, RP, call, challengeOf, signBody, sqlOver, t0, type WorldAnswer } from "./support/trySign.js";

type Voiced = WorldAnswer["proposals"][number] & { says: string; voice: null | { source: string; reason?: string; model?: string; request_id?: string | null; why?: string } };
const waiting = (w: WorldAnswer) => w.proposals.find((p) => p.check === "pass") as Voiced;
const blocked = (w: WorldAnswer) => w.proposals.find((p) => p.check === "fail") as Voiced;

function deskWith(line: StandInLine | null, db = new Database(":memory:")) {
  let clock = t0;
  const d = new TrySignDesk(sqlOver(db), { now: () => clock, agentLine: line?.source ?? null });
  return { d, db, at: (t: Date) => { clock = t; } };
}
let n = 0;
async function world(d: TrySignDesk, ip = `198.51.100.${++n % 250}`): Promise<WorldAnswer> {
  const r = await call(d, "world", {}, { ip });
  expect(r.status).toBe(201);
  return (await r.json()) as WorldAnswer;
}

/** A fake Messages API: records each request, answers like the API (structured output in a text block). */
function fakeApi(o: { status?: number; sentence?: unknown; hang?: boolean; stop?: string } = {}) {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (o.hang) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    if (o.status && o.status !== 200) return new Response("{\"error\":{\"message\":\"secret detail\"}}", { status: o.status });
    return Response.json({ model: HAIKU, stop_reason: o.stop ?? "end_turn", content: [{ type: "text", text: JSON.stringify({ sentence: o.sentence ?? "Alpine Packaging's invoice of EUR 1850.00 is above my EUR 500.00 limit, so I ask you to sign." }) }], usage: { input_tokens: 220, output_tokens: 40 } }, { headers: { "request-id": "req_011abc" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("what the model is given: the test world, written by code; never a visitor's words", () => {
  it("the facts are the invoice, the balance, the reserve floor and the limit, and nothing else, the amounts written the page's way", () => {
    const p = FIXED_PROPOSALS.find((x) => x.id === "T-0002")!;
    const facts = agentLineFacts({ ...p, currency: TEST_WORLD.currency }, TEST_WORLD);
    expect(facts).toBe([
      "Invoice: Invoice INV-2026-118, from Alpine Packaging (test payee), EUR 1,850.00.",
      "Balance: EUR 30,000.00. Reserve floor (the balance may not go below it): EUR 25,000.00.",
      "An agent may pay alone up to EUR 500.00.",
    ].join("\n"));
    // And the instructions say to copy them exactly as given.
    expect(AGENT_LINE_SYSTEM).toContain("Copy every amount exactly as the facts write it (currency code, commas and cents, as in EUR 1,850.00), and write no other amount or number.");
  });

  it("the page's own money formatter (its amt() and eur(), run here from the built page) writes amounts as the facts do", () => {
    const html = trySignPage();
    const fn = (name: string) => new RegExp(`function ${name}\\(s\\) \\{.*\\}`).exec(html)?.[0] ?? "";
    const groupSrc = fn("group"), amtSrc = /function amt\(cur, s\) \{.*\}/.exec(html)?.[0] ?? "", eurSrc = fn("eur");
    expect([groupSrc, amtSrc, eurSrc].every((x) => x.length > 20)).toBe(true);
    const page = new Function(`${groupSrc}\n${amtSrc}\n${eurSrc}\nreturn { amt: amt, eur: eur };`)() as { amt: (c: string, s: string) => string; eur: (s: string) => string };
    for (const a of ["0.01", "500.00", "1850.00", "1850.01", "25000.00", "30000.00", "999999.99", "1234567.00"]) {
      expect({ a, ours: moneyForPeople("EUR", a) }).toEqual({ a, ours: page.eur(a) });
      expect({ a, ours: moneyForPeople("USD", a) }).toEqual({ a, ours: page.amt("USD", a) });
    }
    const facts = agentLineFacts({ ...FIXED_PROPOSALS[1]!, currency: "EUR" }, TEST_WORLD);
    for (const a of [FIXED_PROPOSALS[1]!.amount, TEST_WORLD.balance, TEST_WORLD.reserve_floor, TEST_WORLD.alone_limit]) expect(facts).toContain(page.eur(a));
  });

  it("a world's request sends only those facts and the fixed instructions: no address, world id, token or body", async () => {
    const line = new StandInLine();
    const { d } = deskWith(line);
    const r = await call(d, "world", {}, { ip: "203.0.113.77" });
    const w = (await r.json()) as WorldAnswer;
    expect(line.calls).toBe(1);
    const sent = JSON.stringify(line.inputs[0]);
    expect(line.inputs[0]).toEqual({ system: AGENT_LINE_SYSTEM, facts: agentLineFacts({ ...FIXED_PROPOSALS[1]!, currency: "EUR" }, TEST_WORLD) });
    for (const x of ["203.0.113", w.world.id, w.world.token, w.passkey_options.challenge]) expect({ x, in: sent.includes(x) }).toEqual({ x, in: false });
  });

  it("the page's other endpoints never call the model (only a new world does, once)", async () => {
    const line = new StandInLine();
    const { d } = deskWith(line);
    const auth = new FakeAuthenticator();
    const w = await world(d);
    await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) });
    const b = waiting(w);
    await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(line.calls).toBe(1);
  });
});

describe("the call: Haiku, structured output, 8 s, the request id kept", () => {
  it("uses the repo's Haiku model id, one user message of the facts, the key only in its header", async () => {
    const { f, seen } = fakeApi();
    const r = await claudeSentence("sk-test-not-a-key", f)({ system: AGENT_LINE_SYSTEM, facts: "F" });
    expect(HAIKU).toBe("claude-haiku-5-5");
    expect(readFileSync(new URL("../src/try/claude.ts", import.meta.url), "utf8")).toContain('export const HAIKU = "claude-haiku-5-5"');
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.body.model).toBe(HAIKU);
    expect(seen[0]!.body.messages).toEqual([{ role: "user", content: "F" }]);
    expect(seen[0]!.headers["x-api-key"]).toBe("sk-test-not-a-key");
    expect(JSON.stringify(seen[0]!.body)).not.toContain("sk-test");
    expect(r).toMatchObject({ requestId: "req_011abc", model: HAIKU });
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.costUsd).toBeLessThan(0.001);
  });

  it("gives up after its timeout (8 s on the Worker), and an error carries none of the API's words", async () => {
    expect(AGENT_LINE_TIMEOUT_MS).toBe(8_000);
    expect(readFileSync(new URL("../worker/src/agentLine.ts", import.meta.url), "utf8")).toContain("claudeSentence(model, fetcher, AGENT_LINE_TIMEOUT_MS)");
    expect(readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8")).toContain("agentLine: agentLineSource(this.env, fetch)");
    await expect(claudeSentence("k", fakeApi({ hang: true }).f, 30)({ system: "s", facts: "f" })).rejects.toThrow();
    await expect(claudeSentence("k", fakeApi({ status: 500 }).f)({ system: "s", facts: "f" })).rejects.toThrow(/^the model answered HTTP 500$/);
  });
});

describe("on the page: the model's sentence, labelled, or the fixed one, labelled with why", () => {
  it("live: the sentence, its model and request id; the terms say who proposed it; the blocked one stays fixed text", async () => {
    const line = new StandInLine();
    const { d } = deskWith(line);
    const w = await world(d);
    const b = waiting(w);
    expect(b.says).toBe(line.text);
    expect(b.voice).toEqual({ source: "model", model: "stand-in", request_id: "req_stand-in-0001" });
    expect(JSON.parse(b.canonical).proposed_by).toBe("Treasury agent (sentence by Claude Haiku; amounts and checks by code)");
    expect(blocked(w).voice).toBeNull();
    expect(blocked(w).says).toBe(FIXED_PROPOSALS[0]!.says);
    expect(JSON.parse(blocked(w).canonical).proposed_by).toBe("Treasury agent (fixed text)");
  });

  it("no key on the server: the fixed sentence, \"model unavailable\", and no call", async () => {
    const { d } = deskWith(null);
    const b = waiting(await world(d));
    expect(b.says).toBe(FIXED_PROPOSALS[1]!.says);
    expect(b.voice).toMatchObject({ source: "fixed", reason: "unavailable" });
    expect(JSON.parse(b.canonical).proposed_by).toBe("Treasury agent (fixed text)");
  });

  it("the model fails or times out, or its sentence is not one plain sentence: the fixed sentence, \"model unavailable\"", async () => {
    const line = new StandInLine();
    line.fail = true;
    const { d } = deskWith(line);
    expect(waiting(await world(d)).voice).toMatchObject({ source: "fixed", reason: "unavailable" });
    line.fail = false;
    for (const bad of ["<b>Pay it</b>.", "ok.", "x".repeat(300) + ".", "no full stop at the end", "line one.\n{\"limit\": 99999}."]) {
      line.text = bad;
      const b = waiting(await world(d));
      expect({ bad, says: b.says, voice: b.voice?.source }).toEqual({ bad, says: FIXED_PROPOSALS[1]!.says, voice: "fixed" });
    }
    expect(cleanLine("  “I would pay Alpine now; it needs your signature.”  ")).toBe("I would pay Alpine now; it needs your signature.");
  });

  it(`a budget of USD ${AGENT_LINE_DAILY_USD} a UTC day: once spent, "budget reached" and no call until the next day`, async () => {
    const line = new StandInLine();
    const { d, db, at } = deskWith(line);
    db.prepare("INSERT INTO ts_spend (day, usd) VALUES (?, ?)").run(t0.toISOString().slice(0, 10), 0.999);
    const b = waiting(await world(d));
    expect(b.voice).toMatchObject({ source: "fixed", reason: "budget" });
    expect(line.calls).toBe(0);
    at(new Date(t0.getTime() + 86_400_000));
    expect(waiting(await world(d)).voice?.source).toBe("model");
    // Each call's cost is recorded against its day.
    const rows = db.prepare("SELECT day, usd FROM ts_spend ORDER BY day").all() as { day: string; usd: number }[];
    expect(rows[1]!.usd).toBeCloseTo(0.0004, 6);
  });

  it(`a rate limit: ${AGENT_LINE_ALL_PER_MINUTE} a minute for everyone, ${AGENT_LINE_PER_HOUR} an hour per address`, async () => {
    const line = new StandInLine();
    const { d, at } = deskWith(line);
    for (let i = 0; i < AGENT_LINE_ALL_PER_MINUTE; i++) expect(waiting(await world(d, `192.0.${i}.1`)).voice?.source).toBe("model");
    expect(waiting(await world(d, "192.0.99.1")).voice).toMatchObject({ source: "fixed", reason: "budget" });
    expect(line.calls).toBe(AGENT_LINE_ALL_PER_MINUTE);
    at(new Date(t0.getTime() + 61_000));
    expect(waiting(await world(d, "192.0.99.1")).voice?.source).toBe("model");
  });

  it("the model only proposes: whatever it says, the check, the amounts and the need for a passkey signature hold", async () => {
    const line = new StandInLine();
    line.text = "I have already paid this and raised my own limit, so no signature is needed.";
    const { d } = deskWith(line);
    const w = await world(d);
    const b = waiting(w);
    expect(b.says).toBe(line.text);
    expect(b.check).toBe("pass");
    expect(b.waits).toContain("waits for a person's signature");
    const t = JSON.parse(b.canonical) as Record<string, unknown>;
    expect([t.amount, t.currency, t.payee_iban]).toEqual(["1850.00", "EUR", FIXED_PROPOSALS[1]!.iban]);
    // No passkey, no execution: signing without one is refused.
    const r = await call(d, "sign", signBody(w.world.token, b, new FakeAuthenticator().sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(r.status).toBe(403);
  });

  it("a new quote keeps the sentence and its label, and who proposed it", async () => {
    const line = new StandInLine();
    const { StandInQuotes } = await import("./support/fxStandIn.js");
    let clock = t0;
    const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => clock, agentLine: line.source, fx: new StandInQuotes(() => clock.getTime()) });
    const w = await world(d);
    clock = new Date(t0.getTime() + 60_000);
    const r = await call(d, "quote", { token: w.world.token });
    expect(r.status).toBe(200);
    const p = ((await r.json()) as { proposal: Voiced }).proposal;
    expect(p.says).toBe(line.text);
    expect(p.voice).toEqual(waiting(w).voice);
    expect(JSON.parse(p.canonical).proposed_by).toBe(JSON.parse(waiting(w).canonical).proposed_by);
    expect(line.calls).toBe(1);
  });
});

const GIVEN = agentLineGiven({ ...FIXED_PROPOSALS[1]!, currency: "EUR" }, TEST_WORLD);

describe("the amounts in the sentence: each one of the four it was given, written exactly as given; else the fixed text", () => {
  it("the allowed set: the invoice's EUR 1,850.00 (the signed amount), the balance, the reserve floor and the limit, and the reference", () => {
    expect(GIVEN).toEqual({ amounts: ["EUR 1,850.00", "EUR 30,000.00", "EUR 25,000.00", "EUR 500.00"], references: ["Invoice INV-2026-118", "INV-2026-118"] });
  });

  it("a correct sentence passes", () => {
    for (const ok of [
      "Alpine Packaging's EUR 1,850.00 invoice is above the EUR 500.00 I may pay alone, so I need your signature.",
      "Paying INV-2026-118 for EUR 1,850.00 leaves the balance well above the floor.",
      "Please sign: Invoice INV-2026-118 from Alpine Packaging is EUR 1,850.00, above my EUR 500.00 limit; the balance of EUR 30,000.00 stays above EUR 25,000.00.",
      "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.",
    ]) expect({ ok, fits: amountsFit(ok, GIVEN), line: checkLine(ok, GIVEN) }).toEqual({ ok, fits: true, line: { says: ok } });
  });

  it("a wrong amount, an unformatted amount, or an extra amount does not", () => {
    for (const bad of [
      "Alpine Packaging's invoice of EUR 1850.00 is above my EUR 500.00 limit, so I ask you to sign.", // the live sample's way
      "Paying EUR 1,850.00 keeps us above the EUR 25000.00 floor, so please sign.",
      "Alpine Packaging's invoice of EUR 1,850.01 needs your signature.", // one cent off
      "Alpine Packaging's invoice of EUR 1,580.00 needs your signature.", // a wrong amount
      "Alpine Packaging's invoice of USD 1,850.00 needs your signature.", // another currency
      "Alpine's 1,850 EUR invoice is above my limit, so I need your signature.",
      "Alpine's invoice of €1,850 is above my limit, so I need your signature.",
      "Alpine's invoice of 1850 is above my limit, so I need your signature.",
      "Alpine's invoice is EUR 1,850.00 plus EUR 37.00 in fees, so I need your signature.", // an extra amount
      "After EUR 1,850.00 the balance is EUR 28,150.00, so please sign.", // an amount it was not given
      "Alpine's invoice of EUR 1,850.005 needs your signature.",
      "Alpine's invoice of eighteen hundred and fifty euros needs your signature.",
      "Alpine's invoice of EUR 11,850.00 needs your signature.",
    ]) {
      expect({ bad, fits: amountsFit(bad, GIVEN), line: checkLine(bad, GIVEN) }).toEqual({ bad, fits: false, line: { bad: "amounts" } });
    }
    expect(checkLine("<b>x</b> EUR 1,850.00.", GIVEN)).toEqual({ bad: "shape" });
  });

  it("on the page: a mismatched sentence is replaced by the fixed one, labelled \"fixed text (sentence did not match the terms)\"", async () => {
    const line = new StandInLine();
    line.text = "Alpine Packaging's invoice of EUR 1850.00 is above my EUR 500.00 limit, so I ask you to sign.";
    const { d } = deskWith(line);
    const b = waiting(await world(d));
    expect(line.calls).toBe(1);
    expect(b.says).toBe(FIXED_PROPOSALS[1]!.says);
    expect(b.voice).toMatchObject({ source: "fixed", reason: "mismatch" });
    expect(JSON.parse(b.canonical).proposed_by).toBe("Treasury agent (fixed text)");
    expect(VOICE_LABELS.mismatch).toBe("fixed text (sentence did not match the terms)");
    // The correct one passes, as the model's.
    line.text = "Alpine Packaging's EUR 1,850.00 invoice is above the EUR 500.00 I may pay alone, so I need your signature.";
    expect(waiting(await world(d))).toMatchObject({ says: line.text, voice: { source: "model" } });
  });
});

describe("the Worker's key: the call is made when the Worker has ANTHROPIC_API_KEY, else the fixed text", () => {
  it("with the key: the call goes to the (fake) API; without it: no source, \"model unavailable\", no call", async () => {
    const { f, seen } = fakeApi({ sentence: "Alpine Packaging's EUR 1,850.00 invoice is above the EUR 500.00 I may pay alone, so I need your signature." });
    const src = agentLineSource({ ANTHROPIC_API_KEY: "sk-test-not-a-key" }, f);
    expect(typeof src).toBe("function");
    const b = waiting(await world(new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, agentLine: src })));
    expect(seen).toHaveLength(1);
    expect(b.voice).toMatchObject({ source: "model", model: HAIKU, request_id: "req_011abc" });
    for (const env of [{}, { ANTHROPIC_API_KEY: "" }]) {
      const none = agentLineSource(env, f);
      expect(none).toBeNull();
      const c = waiting(await world(new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, agentLine: none })));
      expect(c.voice).toMatchObject({ source: "fixed", reason: "unavailable" });
    }
    expect(seen).toHaveLength(1);
    expect(Object.keys(VOICE_LABELS).sort()).toEqual(["budget", "mismatch", "off", "unavailable"]);
  });
});

/** The switch's sentence in "What's real?", word for word. */
const SWITCH_LINE = "An emergency switch on the server (TRY_SIGN_HAIKU=off) stops the call; the fixed sentence is then shown, labelled “fixed text (live model switched off)”.";

describe("the emergency switch: the Worker var TRY_SIGN_HAIKU=off stops the Haiku call; default on", () => {
  const KEY = { ANTHROPIC_API_KEY: "sk-test-not-a-key" };
  const ok = "Alpine Packaging's EUR 1,850.00 invoice is above the EUR 500.00 I may pay alone, so I need your signature.";

  it("off (any case, trimmed): no request to Anthropic, no budget spent, the fixed sentence labelled \"live model switched off\"", async () => {
    for (const flag of ["off", "OFF", "Off", " off ", "\toFF\n"]) {
      const { f, seen } = fakeApi({ sentence: ok });
      const src = agentLineSource({ ...KEY, TRY_SIGN_HAIKU: flag }, f);
      expect({ flag, src }).toEqual({ flag, src: "off" });
      const db = new Database(":memory:");
      const b = waiting(await world(new TrySignDesk(sqlOver(db), { now: () => t0, agentLine: src })));
      expect(seen).toHaveLength(0);
      expect(b.says).toBe(FIXED_PROPOSALS[1]!.says);
      expect(b.voice).toMatchObject({ source: "fixed", reason: "off" });
      expect(JSON.parse(b.canonical).proposed_by).toBe("Treasury agent (fixed text)");
      expect(db.prepare("SELECT COUNT(*) AS n FROM ts_spend").get()).toEqual({ n: 0 });
    }
    expect(VOICE_LABELS.off).toBe("fixed text (live model switched off)");
  });

  it("absent: the call runs, as before", async () => {
    const { f, seen } = fakeApi({ sentence: ok });
    const src = agentLineSource(KEY, f);
    expect(typeof src).toBe("function");
    const b = waiting(await world(new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, agentLine: src })));
    expect(seen).toHaveLength(1);
    expect(b).toMatchObject({ says: ok, voice: { source: "model", model: HAIKU } });
  });

  it("any other value (ON, on, empty, false, 0, disabled, \"of\", \"off now\"): the call runs", async () => {
    for (const flag of ["ON", "on", "", " ", "false", "0", "disabled", "of", "off now", "no"]) {
      const { f, seen } = fakeApi({ sentence: ok });
      const src = agentLineSource({ ...KEY, TRY_SIGN_HAIKU: flag }, f);
      expect({ flag, kind: typeof src }).toEqual({ flag, kind: "function" });
      const b = waiting(await world(new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, agentLine: src })));
      expect({ flag, calls: seen.length, voice: b.voice?.source }).toEqual({ flag, calls: 1, voice: "model" });
    }
    // Without the key the switch changes nothing: no call either way.
    expect(agentLineSource({ TRY_SIGN_HAIKU: "on" })).toBeNull();
  });

  it("\"What's real?\" says the switch exists, in one sentence", () => {
    expect(WHATS_REAL.real.filter((l) => l.includes(SWITCH_LINE))).toHaveLength(1);
    expect(trySignPage()).toContain(SWITCH_LINE);
  });
});

describe("the sentence is text on the page, never markup", () => {
  it("the page puts it (and its label and why) in text nodes only; the only markup it sets is its own icons", () => {
    const html = trySignPage();
    const js = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf("run-data")))?.[1] ?? "";
    expect(js.length).toBeGreaterThan(1000);
    // Every place the sentence goes in: el(), which appends strings as text nodes.
    expect(js.match(/p\.says/g)?.length).toBe(js.match(/el\("p", "says", \[p\.says\]\)/g)?.length);
    expect(js).toContain('n.appendChild(typeof k === "string" ? document.createTextNode(k) : k)');
    // innerHTML (or outerHTML, insertAdjacentHTML, document.write) only for the fixed icon set.
    expect(js.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/g)).toEqual(["innerHTML"]);
    expect(js).toContain("s.innerHTML = D.icons[name]");
  });

  it("a sentence with markup in it never reaches the page from the model: the fixed text instead", async () => {
    const line = new StandInLine();
    const { d } = deskWith(line);
    for (const bad of ["Please sign <b>x</b> for EUR 1,850.00.", "Please sign <img src=x onerror=alert(1)> now."]) {
      line.text = bad;
      const b = waiting(await world(d));
      expect({ bad, says: b.says, voice: b.voice?.reason }).toEqual({ bad, says: FIXED_PROPOSALS[1]!.says, voice: "unavailable" });
    }
  });
});

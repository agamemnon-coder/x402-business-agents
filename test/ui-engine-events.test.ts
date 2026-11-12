// The engine's events as lines a person reads (src/ui/engineEvents.ts): who did it, what, in English and Dutch. Every
// event on the allowlist of src/engine/events.ts has its own line; anything else gets one neutral line. A line is
// words, never a field dump: no JSON, no event name, and the bank is always the stand-in bank.
//
// The allowlist's names are read from the source text of src/engine/events.ts (the module exports no list), and each
// name is then confirmed by probing publicEvent: an event on the list keeps its subject, any other loses it.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { publicEvent, type EngineEvent } from "../src/engine/events.js";
import { EVENT_LINE_JS, eventLine } from "../src/ui/engineEvents.js";
import { DATA_NL, I18N_JS, MESSAGES } from "../src/ui/i18n.js";

const SRC = readFileSync("src/engine/events.ts", "utf8");
const from = SRC.indexOf("const EVENTS");
const BLOCK = SRC.slice(from, SRC.indexOf("\n};", from));
const NAMES = [...BLOCK.matchAll(/^\s+"([a-z_]+(?:\.[a-z_]+)+)":/gm)].map((m) => m[1]!);

const row = (event: string, payload: unknown, actor = "system") => publicEvent({ seq: 1, ts: "2026-11-12T12:00:00.000Z", actor, event, subject: "S-1", payload_json: JSON.stringify(payload) });
// Payloads as the engine writes them: every field any event on the list picks, in the two shapes an amount comes in.
const RICH = { status: "ready", to: "paid", from: "waiting_cfo", read_by: "parser", total: "1850.00", currency: "EUR", findings: [{ code: "possible_duplicate", detail: "x" }, { code: "iban_invalid", detail: "y" }],
  model: "claude-sonnet-5-5", pages: 2, readings: 1, invoice_id: "AP-0001", request_id: "req-1", cost_usd_micros: 3100, kind: "supplier_payment", method: "passkey", buy: "EUR 100.00", fee: "EUR 0.50", paid: 1, of: 2, files: 2, corrections: 0, proposal_id: "P-0001" };
const PAYLOADS: Record<string, unknown>[] = [{}, { ...RICH, amount: "EUR 13.40" }, { ...RICH, amount: "25000.00" }];
const LANGS = ["en", "nl"] as const;
const neutral = (lang: "en" | "nl") => MESSAGES[lang]["cs.eng.step"];

describe("the allowlist, as this test reads it", () => {
  it("finds every event of src/engine/events.ts, and each one is really on the list", () => {
    expect(NAMES.length).toBeGreaterThan(70);
    expect(new Set(NAMES).size).toBe(NAMES.length);
    for (const name of NAMES) expect({ name, subject: row(name, {}).subject }).toEqual({ name, subject: "S-1" });
    expect(row("setting.changed", {}).subject).toBeNull();
    for (const must of ["ap.received", "ap.status", "claude.read", "proposal.approved", "transfer.created", "vault.filed"]) expect(NAMES).toContain(must);
  });
});

describe("a line for every event", () => {
  it("has its own words in English and in Dutch, whatever fields the event carries", () => {
    for (const name of NAMES) for (const payload of PAYLOADS) for (const lang of LANGS) {
      const line = eventLine(row(name, payload), lang);
      const at = { name, lang, text: line.text };
      expect(line.text.trim().length, name).toBeGreaterThan(8);
      expect({ ...at, neutral: line.text === neutral(lang) }).toEqual({ ...at, neutral: false });
      expect({ ...at, raw: /[{}"[\]]|undefined|null|NaN|\s{2}|\s[.,:;]|[:,;]\s*[.]/.exec(line.text)?.[0] ?? null }).toEqual({ ...at, raw: null });
      expect({ ...at, named: line.text.includes(name) }).toEqual({ ...at, named: false });
      expect(/[.]$/.test(line.text), `${name} (${lang}) ends as a sentence: ${line.text}`).toBe(true);
      expect(line.who.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("differs between English and Dutch, and between events", () => {
    const seen = new Map<string, string>();
    for (const name of NAMES) {
      const en = eventLine(row(name, RICH), "en").text;
      const nl = eventLine(row(name, RICH), "nl").text;
      expect({ name, same: en === nl }).toEqual({ name, same: false });
      expect({ name, sameAs: seen.get(en) ?? null }).toEqual({ name, sameAs: null });
      seen.set(en, name);
    }
  });

  it("the catalogue holds no line for an event that is not on the list", () => {
    const lines = Object.keys(MESSAGES.en).filter((k) => k.startsWith("cs.eng.ev.")).map((k) => k.slice("cs.eng.ev.".length).replace(/_(plain|why)$/, ""));
    expect(lines.length).toBeGreaterThan(70);
    expect(lines.filter((n) => !NAMES.includes(n))).toEqual([]);
  });

  it("uses the fields the event shows: the amount, the status in words, what the checks found", () => {
    const got = eventLine(row("ap.received", { status: "needs_review", read_by: "parser", total: "1850.00", currency: "EUR", findings: [{ code: "duplicate" }, { code: "new_supplier" }] }), "en").text;
    expect(got).toContain("EUR 1,850.00");
    expect(got).toContain("needs a person");
    expect(got).toContain(MESSAGES.en["cs.w.f.duplicate"].toLowerCase());
    expect(got).toContain(MESSAGES.en["finding.new_supplier"]);
    const nl = eventLine(row("ap.received", { status: "ready", read_by: "parser", total: "1850.00", currency: "EUR", findings: [] }), "nl").text;
    expect(nl).toContain("€ 1.850,00");
    expect(nl).toContain("klaar om te betalen");
    expect(eventLine(row("ap.status", { from: "waiting_cfo", to: "paid" }), "en").text).toContain("paid");
    // A finding or a status with no words of its own is shown as its code, in words.
    expect(eventLine(row("ap.received", { status: "ready", total: "1.00", currency: "EUR", findings: [{ code: "brand_new_code" }] }), "en").text).toContain("brand new code");
    expect(eventLine(row("transfer.status", { status: "IN_REVIEW" }), "en").text).toContain("in review");
    expect(eventLine(row("vault.filed", { files: 2, corrections: 0 }), "en").text).toContain("2");
  });

  it("says where the money is: the stand-in bank and test money, and never that Airwallex did something", () => {
    for (const name of NAMES) for (const payload of PAYLOADS) for (const lang of LANGS) {
      const text = eventLine(row(name, payload), lang).text;
      expect({ name, lang, airwallex: /airwallex|sandbox/i.test(text) }).toEqual({ name, lang, airwallex: false });
    }
    for (const name of ["transfer.created", "treasury.seeded"]) {
      const text = eventLine(row(name, { ...RICH, amount: name === "treasury.seeded" ? "25000.00" : "EUR 13.40" }), "en").text;
      expect(text, name).toContain("stand-in bank");
      expect(text, name).toContain("test money");
    }
    const bank = NAMES.filter((n) => /^(transfer\.(created|adopted|status|refused|fee|awaiting_airwallex_approval)|fx\.(converted|adopted)|payee\.(added|adopted)|treasury\.seeded)$/.test(n));
    expect(bank.length).toBe(11);
    for (const name of bank) expect(eventLine(row(name, {}), "en").text, name).toContain("stand-in bank");
  });
});

describe("an event that is not on the list", () => {
  it("gives one neutral line, never its name alone and never raw JSON", () => {
    for (const lang of LANGS) {
      const line = eventLine(row("setting.changed", { key: "floor", value: { a: 1 } }), lang);
      expect(line.text).toBe(neutral(lang));
      expect(line.text).not.toContain("setting");
      expect(line.tag).toBe("code");
    }
    const odd: EngineEvent = { seq: 9, ts: "2026-11-12T12:00:00Z", actor: '{"x":1}', event: '{"event":"x"}', subject: null, fields: { status: '{"a":"b"}', model: '"><b>' } };
    expect(eventLine(odd, "en").text).toBe(neutral("en"));
    expect(neutral("en")).not.toBe(neutral("nl"));
    // Nothing at all still gives a line.
    expect(eventLine({} as EngineEvent, "en").text).toBe(neutral("en"));
  });

  it("a field that holds JSON or markup never reaches a known event's line as such", () => {
    const hostile: EngineEvent = { seq: 9, ts: "2026-11-12T12:00:00Z", actor: "system", event: "ap.status", subject: "AP-0001", fields: { status: '{"a":["b"]}', from: "<script>" } };
    for (const lang of LANGS) expect(eventLine(hostile, lang).text).not.toMatch(/[{}"[\]<>]/);
    const model: EngineEvent = { seq: 9, ts: "2026-11-12T12:00:00Z", actor: "treasury", event: "claude.read", subject: "t", fields: { source: "claude", model: '{"m":1}' } };
    const line = eventLine(model, "en");
    expect(line.who).toBe("Claude");
    expect(line.text).not.toMatch(/[{}"]/);
  });
});

describe("who did it", () => {
  it("names the model for what Claude read", () => {
    expect(eventLine(row("ap.received", { ...RICH, read_by: "claude:claude-sonnet-5-5" }), "en")).toMatchObject({ who: "Claude Sonnet 5.5", tag: "claude" });
    expect(eventLine(row("ap.received", { ...RICH, read_by: "claude-scan:claude-opus-5-5" }), "nl")).toMatchObject({ who: "Claude Opus 5.5", tag: "claude" });
    expect(eventLine(row("claude.read", { model: "claude-haiku-5-5", request_id: "r", cost_usd_micros: 12 }, "treasury"), "en")).toMatchObject({ who: "Claude Haiku 5.5", tag: "claude" });
    expect(eventLine(row("ap.scan_read", { model: "claude-sonnet-4-5-20250929", pages: 1, readings: 1 }, "treasury"), "en")).toMatchObject({ who: "Claude Sonnet 4.5", tag: "claude" });
    expect(eventLine(row("claude.read", {}, "treasury"), "en")).toMatchObject({ who: "Claude", tag: "claude" });
  });

  it("says the parser when the parser read it, and code for a step of the engine's own code", () => {
    expect(eventLine(row("ap.received", RICH), "en")).toMatchObject({ who: "the parser", tag: "parser" });
    expect(eventLine(row("ap.received", RICH), "nl")).toMatchObject({ who: MESSAGES.nl["cs.eng.who.parser"], tag: "parser" });
    expect(eventLine(row("treasury.seeded", { amount: "25000.00", currency: "USD" }, "awx-executor"), "en")).toMatchObject({ who: "code", tag: "code" });
    expect(eventLine(row("vault.filed", { files: 2 }), "en")).toMatchObject({ who: "code", tag: "code" });
    expect(eventLine(row("ap.status", { to: "waiting_cfo" }, "treasury"), "en")).toMatchObject({ who: "code", tag: "code" });
    // A model's answer that was set aside is the code's doing, not the model's.
    expect(eventLine(row("claude.fallback", { model: "claude-sonnet-5-5" }, "treasury"), "en").tag).toBe("code");
    expect(eventLine(row("claude.rejected", { model: "claude-sonnet-5-5" }), "en").tag).toBe("code");
  });

  it("says a person, with no tag, for what a person did", () => {
    expect(eventLine(row("proposal.approved", { method: "passkey" }, "human"), "en")).toEqual({ who: "a person", text: expect.stringContaining("passkey") as string, tag: null });
    expect(eventLine(row("passkey.enrolled", {}, "human"), "nl")).toMatchObject({ who: MESSAGES.nl["cs.eng.who.person"], tag: null });
    expect(eventLine(row("ap.status", { to: "rejected" }, "human"), "en")).toMatchObject({ who: "a person", tag: null });
  });
});

describe("the page's copy of the same code", () => {
  it("is plain script: nothing that builds code or HTML from text", () => {
    expect(EVENT_LINE_JS).not.toMatch(/eval\(|new Function|innerHTML|document\.|<\/script|`|\$\{/);
    expect(() => new Script(EVENT_LINE_JS)).not.toThrow();
  });

  it("writes the same lines with the page's own words and amounts", () => {
    for (const lang of LANGS) {
      const ctx: Record<string, unknown> = {};
      const events = NAMES.flatMap((name) => PAYLOADS.map((p) => row(name, p))).concat([row("setting.changed", {})]);
      new Script(`const L=${JSON.stringify({ lang, m: MESSAGES[lang], data: lang === "nl" ? DATA_NL : {} })};${I18N_JS};${EVENT_LINE_JS};const line=eventLineOf(L.m,ma);out=JSON.stringify(${JSON.stringify(events)}.map(line))`).runInNewContext(ctx);
      expect(JSON.parse(ctx.out as string)).toEqual(events.map((e) => eventLine(e, lang)));
    }
  });
});

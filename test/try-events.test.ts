// The /try page's event lines (cloud/src/tryEvents.ts): every event on the engine's allowlist (src/engine/events.ts) has
// a line of its own; an event not on it gets one neutral line; a line only ever shows a field that event's allowlist
// lets through; who did it follows the event's own source; and an open Claude call is marked as asking.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_LINE_JS, eventLine } from "../cloud/src/tryEvents.js";
import { LIVE } from "../cloud/src/tryCopy.js";
import { publicEvent, type EngineEvent } from "../src/engine/events.js";

/** The allowlist's event names, read from its source (the list itself is not exported), each confirmed by publicEvent. */
const SOURCE = readFileSync(new URL("../src/engine/events.ts", import.meta.url), "utf8");
const LISTED = [...SOURCE.slice(SOURCE.indexOf("const EVENTS"), SOURCE.indexOf("\n};", SOURCE.indexOf("const EVENTS"))).matchAll(/^\s+"([a-z_]+\.[a-z_]+)":/gm)].map((m) => m[1]!);

/** Every payload key any event's pick reads, each with a plausible value: what publicEvent lets through is that event's allowlist. */
const FULL_PAYLOAD: Record<string, unknown> = {
  status: "ready", read_by: "claude:claude-haiku-4-5", total: "1850.00", currency: "EUR", findings: [{ code: "possible_duplicate" }], to: "ready", from: "received",
  proposal_id: "P-0001", invoice_id: "AP-0001", amount: "EUR 13.40", model: "claude-haiku-4-5", pages: 2, readings: 1, kind: "payment", method: "passkey",
  buy: "EUR 13.40", fee: "EUR 0.50", request_id: "req_1", paid: 1, of: 2, files: 3, corrections: 0, cost_usd_micros: 1200,
};
const allowed = (event: string) => publicEvent({ seq: 1, ts: "2026-11-12T12:00:00Z", actor: "system", event, subject: "S-1", payload_json: JSON.stringify(FULL_PAYLOAD) }).fields;
const ev = (event: string, fields: EngineEvent["fields"] = {}, actor = "system"): EngineEvent => ({ seq: 1, ts: "2026-11-12T12:00:00Z", actor, event, subject: "S-1", fields });

describe("the allowlist as read here", () => {
  it("is the engine's own: every name is let through by publicEvent, and a name not on it is not", () => {
    expect(LISTED.length).toBeGreaterThan(60);
    for (const e of LISTED) expect(publicEvent({ seq: 1, ts: "t", actor: "a", event: e, subject: "S", payload_json: "{}" }).subject, e).toBe("S");
    expect(publicEvent({ seq: 1, ts: "t", actor: "a", event: "no.such_event", subject: "S", payload_json: "{}" }).subject).toBeNull();
  });
});

describe("eventLine", () => {
  it("gives every allowlisted event a line of its own, with no fields and with its allowlisted fields", () => {
    for (const e of LISTED) {
      for (const fields of [{}, allowed(e)]) {
        const l = eventLine(ev(e, fields));
        expect(l.text, e).not.toBe(LIVE.step);
        expect(l.text.length, e).toBeGreaterThan(3);
        expect(l.text, e).not.toMatch(/[{}<>]/);
        expect(l.who, e).not.toBe("");
      }
    }
  });

  it("gives an unknown event the one neutral line, never its fields", () => {
    const l = eventLine(ev("agent.something_new", { secret: "SECRET-1", model: "claude-opus-5" }));
    expect(l).toEqual({ who: LIVE.who.purser, text: LIVE.step, tag: null, asking: false });
    expect(LIVE.step).toBe("Purser recorded a step.");
    // Not even a shape the page did not expect breaks it.
    expect(eventLine({} as EngineEvent).text).toBe(LIVE.step);
  });

  it("never shows a value of a field the event's allowlist does not let through", () => {
    const keys = [...Object.keys(FULL_PAYLOAD), "iban", "approver", "note", "output", "credential", "reason", "prompt", "agent", "source"];
    for (const e of [...LISTED, "claude.asking"]) {
      const ok = allowed(e);
      const fields: EngineEvent["fields"] = { ...ok };
      for (const k of keys) if (!Object.hasOwn(ok, k) && !(e === "claude.asking" && (k === "model" || k === "agent"))) fields[k] = "SECRETVALUE";
      const l = eventLine(ev(e, fields));
      expect(`${l.who} ${l.text}`, e).not.toMatch(/SECRET/i);
    }
  });

  it("names Claude and its model only when the event says Claude answered", () => {
    const read = eventLine(ev("claude.read", { source: "claude", model: "claude-haiku-4-5-20251001", request_id: "req_1", cost_usd_micros: 900 }));
    expect(read.who).toBe("Claude Haiku 4.5");
    expect(read.tag).toBe("claude");
    expect(read.text).toMatch(/live/);
    // The fallback names a model it did not use: the line is Purser's code's.
    const fb = eventLine(ev("claude.fallback", { source: "fallback", model: "claude-haiku-4-5" }));
    expect(fb.who).toBe(LIVE.who.code);
    expect(fb.tag).toBe("code");
    expect(fb.text).toMatch(/Purser's code/);
    expect(`${fb.who} ${fb.text}`).not.toMatch(/Claude/);
    // A model's answer that was refused: Claude answered, Purser's check said no.
    expect(eventLine(ev("claude.rejected", { model: "claude-sonnet-4-5" })).who).toBe("Claude Sonnet 4.5");
    // An event that is not Claude's never says Claude, whatever its fields hold.
    for (const e of LISTED.filter((x) => !x.startsWith("claude."))) {
      const l = eventLine(ev(e, allowed(e)));
      expect(l.who, e).not.toMatch(/Claude/);
      expect(l.tag, e).not.toBe("claude");
    }
  });

  it("says You for a person's own passkey and approval steps", () => {
    const a = eventLine(ev("proposal.approved", { method: "passkey" }, "human"));
    expect(a.who).toBe(LIVE.who.you);
    expect(a.tag).toBe("sign");
    expect(eventLine(ev("passkey.enrolled", {}, "human")).who).toBe(LIVE.who.you);
    // A refusal is Purser's check, not the person.
    expect(eventLine(ev("passkey.refused")).who).toBe(LIVE.who.code);
  });

  it("says simulated bank and test money where money moves", () => {
    const sent = eventLine(ev("transfer.created", { amount: "13.40", currency: "EUR", status: "PAID", request_id: "r" }));
    expect(sent.tag).toBe("money");
    expect(sent.text).toContain("EUR 13.40");
    expect(sent.text).toContain("simulated bank · test money");
    for (const e of LISTED) {
      const l = eventLine(ev(e, allowed(e)));
      if (l.tag === "money") expect(l.text, e).toContain("simulated bank · test money");
    }
    expect(eventLine(ev("treasury.seeded", { amount: "50000.00", currency: "EUR" })).tag).toBe("money");
  });

  it("marks an open Claude call as asking, with the agent or the Reader and the model", () => {
    const a = eventLine(ev("claude.asking", { model: "claude-haiku-4-5", agent: "checker" }));
    expect(a.asking).toBe(true);
    expect(a.tag).toBe("claude");
    expect(`${a.who} · ${a.text}`).toBe("Checker · Claude Haiku 4.5 · asking…");
    expect(`${eventLine(ev("claude.asking", { model: "claude-haiku-4-5" })).who}`).toBe("Reader · Claude Haiku 4.5");
    for (const e of LISTED) expect(eventLine(ev(e, allowed(e))).asking, e).toBe(false);
  });

  it("is plain script with no DOM, clock or network, so the page carries the same text", () => {
    expect(EVENT_LINE_JS).not.toMatch(/\b(document|window|fetch|Date|setTimeout|setInterval|innerHTML|eval|Function)\b/);
  });
});

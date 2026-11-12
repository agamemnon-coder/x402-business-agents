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
    expect(l).toEqual({ who: LIVE.who.purser, text: LIVE.step, tag: null, asking: false, fold: false, lead: "", own: "", enforced: "" });
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
      expect(`${l.who} ${l.text} ${l.lead} ${l.own} ${l.enforced}`, e).not.toMatch(/SECRET/i);
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
    // The agents' rows (lane A, from ap-agents-1112) are Claude's turns: Claude is named when the row's own fields say so
    // (a model and no other source, or source "claude"); a decision code made says Purser's code.
    expect(eventLine(ev("agent.said", { agent: "checker", model: "claude-haiku-4-5", text: "x" })).who).toBe("Claude Haiku 4.5");
    expect(eventLine(ev("ap.checker_decided", { source: "code", model: "claude-haiku-4-5" })).who).toBe(`Checker agent · ${LIVE.who.code}`);
    expect(eventLine(ev("agent.run", { status: "done" })).who).toBe(LIVE.who.code);
    const agents = (x: string) => x.startsWith("agent.") || x === "ap.checker_decided" || x === "ap.payer_proposed" || x === "ap.coded";
    // Any other event that is not Claude's never says Claude, whatever its fields hold.
    for (const e of LISTED.filter((x) => !x.startsWith("claude.") && !agents(x))) {
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
    // The engine's allowlist now holds claude.asking itself (lane A); every other listed event is never an open call.
    for (const e of LISTED.filter((x) => x !== "claude.asking")) expect(eventLine(ev(e, allowed(e))).asking, e).toBe(false);
  });

  it("gives each agent's decision one line: who, its lead, the reason in its own words, and what Purser's code enforced", () => {
    const checker = eventLine(ev("ap.checker_decided", { source: "claude", model: "claude-haiku-4-5", action: "pay", outcome: "ask_cfo", overridden: true, overridden_by: "agent_may_not_pay_alone",
      code_requires: "ask_cfo", codes: "possible_duplicate", reason: "Bergtex is on file and the totals add up.", enforced: "The agent may pay no invoice alone.", request_id: "req_1" }, "checker"));
    expect(checker).toMatchObject({ who: "Checker agent · Claude Haiku 4.5", tag: "claude", fold: false, lead: "Decided: pay, because", own: "Bergtex is on file and the totals add up",
      enforced: "Purser's code enforced: ask cfo; The agent may pay no invoice alone" });
    expect(checker.text).toBe("Decided: pay, because Bergtex is on file and the totals add up. Purser's code enforced: ask cfo; The agent may pay no invoice alone.");

    const coded = eventLine(ev("ap.coded", { source: "claude", model: "claude-haiku-4-5", status: "coded", lines: 2, account: "6200", vat_code: "P21", cost_centre: "OPS", reason: "Office supplies at the high rate.", request_id: "req_2" }, "treasury"));
    expect(coded).toMatchObject({ who: "Coder agent · Claude Haiku 4.5", tag: "claude", fold: false, lead: "6200 expense, VAT 21%:", own: "Office supplies at the high rate", enforced: "" });
    // Code refused the agent's coding: the model that answered is named, and what code enforced instead is under it.
    const refused = eventLine(ev("ap.coded", { source: "fallback", model: null, agent_model: "claude-haiku-4-5", account: "4000", vat_code: null, overridden_by: "account_not_purchase", refused: "Account 1300 may not take purchase lines." }));
    expect(refused).toMatchObject({ who: "Coder agent · Claude Haiku 4.5", lead: `4000 expense, VAT ${LIVE.noVat}.`, own: "", enforced: "Purser's code enforced: Account 1300 may not take purchase lines" });

    const payer = eventLine(ev("ap.payer_proposed", { source: "claude", model: "claude-haiku-4-5", rail: "bank_swift", pay_on: "2026-11-20", pay_currency: "EUR", outcome: "ask_cfo", overridden: false,
      reason: "Due on the 26th; paying on the 20th keeps the float.", enforced: "Over the agent's limit: the CFO signs these exact terms.", request_id: "req_3" }, "payer"));
    expect(payer).toMatchObject({ who: "Payer agent · Claude Haiku 4.5", lead: "Proposed: pay on 2026-11-20 via bank swift from EUR, because", own: "Due on the 26th; paying on the 20th keeps the float",
      enforced: "Purser's code enforced: ask cfo; Over the agent's limit: the CFO signs these exact terms" });

    // Code decided (no model answered): Purser's code, never Claude, and no reason in a model's name.
    const code = eventLine(ev("ap.checker_decided", { source: "fallback", action: "ask_cfo", outcome: "ask_cfo", enforced: "No answer came." }));
    expect(code).toMatchObject({ who: `Checker agent · ${LIVE.who.code}`, tag: "code", lead: "Decided: ask cfo.", own: "", enforced: "Purser's code enforced: ask cfo; No answer came" });
    // No fields at all: the event's own sentence, nothing made up.
    for (const e of ["ap.checker_decided", "ap.coded", "ap.payer_proposed"]) {
      const l = eventLine(ev(e));
      expect([l.lead, l.own, l.enforced], e).toEqual(["", "", ""]);
      expect(l.text, e).not.toBe(LIVE.step);
    }
    // Every other event has no lead, reason or enforced line, whatever its fields.
    for (const e of LISTED.filter((x) => !Object.hasOwn(LIVE.agents, x))) {
      const l = eventLine(ev(e, { ...allowed(e), reason: "r", enforced: "e", outcome: "pay", action: "pay" }));
      expect([l.lead, l.own, l.enforced], e).toEqual(["", "", ""]);
    }
  });

  it("puts an agent's working rows in the fold: its tool calls, words, nudges and runs, and a Claude call of its turn", () => {
    for (const e of LISTED.filter((x) => x.startsWith("agent."))) expect(eventLine(ev(e, allowed(e))).fold, e).toBe(true);
    expect(eventLine(ev("agent.tool", { agent: "checker", tool: "vendor_on_file", turn: 1, model: "claude-haiku-4-5", answer: "Bergtex is on file." })).fold).toBe(true);
    expect(eventLine(ev("claude.asking", { agent: "checker", model: "claude-haiku-4-5", turn: 2 })).fold).toBe(true);
    expect(eventLine(ev("claude.asking", { model: "claude-haiku-4-5", turn: 1 })).fold).toBe(true);
    expect(eventLine(ev("claude.read", { source: "claude", model: "claude-haiku-4-5" }, "payer")).fold).toBe(true);
    // The Reader's own call and answer, and every other row (the decisions too), stay in view.
    expect(eventLine(ev("claude.asking", { model: "claude-haiku-4-5", role: "act" })).fold).toBe(false);
    expect(eventLine(ev("claude.read", { source: "claude", model: "claude-haiku-4-5" }, "treasury")).fold).toBe(false);
    for (const e of LISTED.filter((x) => !x.startsWith("agent."))) expect(eventLine(ev(e, allowed(e))).fold, e).toBe(false);
  });

  it("is plain script with no DOM, clock or network, so the page carries the same text", () => {
    expect(EVENT_LINE_JS).not.toMatch(/\b(document|window|fetch|Date|setTimeout|setInterval|innerHTML|eval|Function)\b/);
  });
});

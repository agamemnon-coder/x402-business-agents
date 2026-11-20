// The phone page's small helpers (src/approve/client.ts) at their edges: the countdown in both languages, a passkey's
// fingerprint, Dutch amounts, and which policy changes loosen. Breaks if an expired approval reads as still open, a
// countdown drops its hours, or a change that loosens the policy on the phone is shown as tightening.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countdown, nlMoney, passkeyFingerprint, policyLoosens } from "../src/approve/client.js";

describe("the countdown", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T10:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("is empty for no time, says expired (in either language) once over, and warns in the last two minutes", () => {
    expect(countdown("not a time")).toEqual({ text: "", soon: false, over: false });
    expect(countdown("2026-11-20T10:00:00Z")).toEqual({ text: "expired", soon: true, over: true });
    expect(countdown("2026-11-20T09:00:00Z", "nl")).toEqual({ text: "verlopen", soon: true, over: true });
    expect(countdown("2026-11-20T10:01:05Z")).toEqual({ text: "expires in 1m 05s", soon: true, over: false });
    expect(countdown("2026-11-20T12:03:09Z", "nl")).toEqual({ text: "verloopt over 2h 3m 09s", soon: false, over: false });
  });
});

describe("a passkey's fingerprint and Dutch amounts", () => {
  it("shows the first eight bytes of the key's SHA-256 in groups of four", async () => {
    // SHA-256 of the empty string starts e3b0c442 98fc1c14.
    expect(await passkeyFingerprint(new ArrayBuffer(0))).toBe("E3B0-C442-98FC-1C14");
  });

  it("writes euros the Dutch way and keeps other currencies' codes", () => {
    expect(nlMoney("EUR 4,617.20 and USD -1,000.05; GBP 3.10")).toBe("€ 4.617,20 and USD -1.000,05; GBP 3,10");
    expect(nlMoney("EUR 3.1")).toBe("EUR 3.1");
  });
});

describe("which policy changes loosen", () => {
  it.each([
    ["cap.sourcing", "0.03", "0.05", true], ["cap.sourcing", "0.05", "0.03", false], ["cap.sourcing", "0.05", "none", true], ["cap.sourcing", "none", "0.05", false],
    ["card.per_tx", "30.00", "60.00", true], ["card.per_tx", "60.00", "30.00", false],
    ["approval.four_eyes_eur", "1000.00", "", true], ["approval.four_eyes_eur", "1000.00", "500.00", false],
    ["approval.second_key_eur", "5000.00", "9000.00", true], ["approval.second_key_eur", "5000.00", "1000.00", false],
    ["approval.second_key_new_payee", "on", "off", true], ["approval.second_key_new_payee", "off", "on", false],
    ["approval.auto_eur", "10.00", "20.00", true], ["approval.auto_eur", "10.00", "off", false],
    ["treasury.eur_floor", "500.00", "100.00", true], ["treasury.eur_floor", "500.00", "", true], ["treasury.eur_floor", "100.00", "500.00", false],
    ["counterparty:0xabc", "blocked", "allowed", true], ["counterparty:0xabc", "allowed", "blocked", false],
    ["freeze", "on", "off", true], ["stop.cards", "off", "on", false], ["pause.sourcing", "on", "", true],
    ["something.new", "a", "b", true],
  ])("%s from %s to %s loosens: %s", (key, from, to, loosens) => {
    expect(policyLoosens({ key, from, to })).toBe(loosens);
  });
});

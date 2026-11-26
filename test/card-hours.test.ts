// Card hours (a time window per agent card) and the card's merchant categories and currencies as CFO policy: the pure
// rules. What the hours are, when a card is inside them, and which change loosens the policy (wider hours, a new
// merchant category or currency) and so needs the CFO's passkey, as a raise of a card limit does. 0 network, no database.
import { describe, expect, it } from "vitest";
import { cardControlLoosens, cardHoursProblem, cardHoursWithin, currencyListProblem, localMoment, mccListProblem, parseCardHours, withinCardHours } from "../src/policy/cardHours.js";
import { loosens } from "../src/policy/loosens.js";
import { policyLoosens } from "../src/approve/client.js";
import { openDb } from "../src/db/open.js";
import { currentPolicy, validateChange } from "../src/policy/rules.js";

const OFFICE = "Mon-Fri 08:00-18:00 Europe/Amsterdam";

describe("card hours: what they are", () => {
  it("reads days, a time range and an IANA time zone", () => {
    expect(parseCardHours(OFFICE)).toEqual({ days: [1, 2, 3, 4, 5], startMin: 480, endMin: 1080, tz: "Europe/Amsterdam" });
    expect(parseCardHours("Mon,Wed,Sat-Sun 00:00-24:00 UTC")).toEqual({ days: [0, 1, 3, 6], startMin: 0, endMin: 1440, tz: "UTC" });
    expect(parseCardHours("")).toBeNull();
  });

  it("refuses what is not hours, with a reason the CFO can act on", () => {
    expect(cardHoursProblem(OFFICE)).toBeNull();
    expect(cardHoursProblem("")).toBeNull();
    for (const bad of ["Mon-Fri 08:00-18:00", "Fri-Mon 08:00-18:00 UTC", "Mon-Fri 18:00-08:00 UTC", "Mon-Fri 08:00-08:00 UTC", "Mon-Fri 8:00-18:00 UTC",
      "Mon-Fri 08:00-18:00 Mars/Olympus", "Funday 08:00-18:00 UTC", "Mon-Fri 08:00-24:30 UTC", "Mon-Fri 08:60-18:00 UTC", "always"]) {
      expect(cardHoursProblem(bad), bad).toMatch(/hours/);
    }
  });

  it("knows the local day and time in the card's time zone, summer time included", () => {
    const h = parseCardHours(OFFICE);
    // Thursday 26 November 2026: Amsterdam is UTC+1.
    expect(localMoment(new Date("2026-11-26T06:59:00Z"), "Europe/Amsterdam")).toEqual({ day: 4, minute: 7 * 60 + 59 });
    expect(withinCardHours(h, new Date("2026-11-26T06:59:00Z"))).toBe(false);
    expect(withinCardHours(h, new Date("2026-11-26T07:00:00Z"))).toBe(true);
    expect(withinCardHours(h, new Date("2026-11-26T16:59:59Z"))).toBe(true);
    expect(withinCardHours(h, new Date("2026-11-26T17:00:00Z"))).toBe(false);
    // Saturday 28 November: closed all day.
    expect(withinCardHours(h, new Date("2026-11-28T10:00:00Z"))).toBe(false);
    // Wednesday 1 July: summer time, UTC+2; 08:00 there is 06:00 UTC.
    expect(withinCardHours(h, new Date("2026-07-01T05:59:00Z"))).toBe(false);
    expect(withinCardHours(h, new Date("2026-07-01T06:00:00Z"))).toBe(true);
    // No hours set: any time.
    expect(withinCardHours(null, new Date("2026-11-28T03:00:00Z"))).toBe(true);
  });

  it("knows when one set of hours sits inside another", () => {
    expect(cardHoursWithin("Tue-Thu 09:00-17:00 Europe/Amsterdam", OFFICE)).toBe(true);
    expect(cardHoursWithin(OFFICE, OFFICE)).toBe(true);
    expect(cardHoursWithin(OFFICE, "")).toBe(true);
    expect(cardHoursWithin("", OFFICE)).toBe(false);
    expect(cardHoursWithin("Mon-Sat 08:00-18:00 Europe/Amsterdam", OFFICE)).toBe(false);
    expect(cardHoursWithin("Mon-Fri 07:00-18:00 Europe/Amsterdam", OFFICE)).toBe(false);
    expect(cardHoursWithin("Mon-Fri 08:00-19:00 Europe/Amsterdam", OFFICE)).toBe(false);
    // Another time zone is not proven to be inside: it counts as wider.
    expect(cardHoursWithin("Mon-Fri 09:00-17:00 Europe/London", OFFICE)).toBe(false);
    expect(cardHoursWithin("nonsense", OFFICE)).toBe(false);
  });
});

describe("which card control change loosens the policy (and needs the CFO's passkey)", () => {
  const cases: [string, string, string, boolean][] = [
    // Hours: set where there were none tightens; wider, removed or moved to another zone loosens.
    ["card.sourcing.hours", "", OFFICE, false],
    ["card.sourcing.hours", OFFICE, "Mon-Fri 09:00-17:00 Europe/Amsterdam", false],
    ["card.sourcing.hours", OFFICE, "", true],
    ["card.sourcing.hours", OFFICE, "Mon-Sun 08:00-18:00 Europe/Amsterdam", true],
    ["card.sourcing.hours", OFFICE, "Mon-Fri 07:00-18:00 Europe/Amsterdam", true],
    ["card.sourcing.hours", OFFICE, "Mon-Fri 08:00-18:00 America/New_York", true],
    // Merchant categories and currencies: a new one loosens, removing one tightens.
    ["card.sourcing.mccs", "5734", "5734,7372", true],
    ["card.sourcing.mccs", "5734,7372", "5734", false],
    ["card.sourcing.mccs", "5734", "7372", true],
    ["card.sourcing.currencies", "EUR", "EUR,USD", true],
    ["card.sourcing.currencies", "EUR,USD", "EUR", false],
    // The limits keep their rule.
    ["card.sourcing.per_tx", "30.00", "50.00", true],
    ["card.sourcing.per_tx", "30.00", "20.00", false],
  ];

  it("on the runner (loosens); the phone (policyLoosens) never calls tighter what the runner calls looser", () => {
    for (const [key, from, to, want] of cases) {
      expect(loosens({ key, from, to }), `${key} ${from} -> ${to}`).toBe(want);
      // The phone reads merchant categories and currencies as the runner does. Of the hours it reads only "set where
      // there were none" as tightening; narrowing existing hours it leaves to a proposal from the runner.
      const phone = policyLoosens({ key, from, to });
      if (want) expect(phone, `phone: ${key} ${from} -> ${to}`).toBe(true);
      else if (!key.endsWith(".hours") || from === "") expect(phone, `phone: ${key} ${from} -> ${to}`).toBe(false);
      else expect(phone, `phone: ${key} ${from} -> ${to}`).toBe(true);
    }
  });

  it("treats a value it cannot read as a loosening (fails closed)", () => {
    expect(cardControlLoosens("card.sourcing.hours", OFFICE, "whenever")).toBe(true);
    expect(cardControlLoosens("card.sourcing.mccs", "5734", "57x4")).toBe(true);
    expect(cardControlLoosens("card.sourcing.per_tx", "1.00", "2.00")).toBeNull();
  });
});

describe("the card controls in the CFO policy", () => {
  it("has hours, merchant categories and currencies per agent card, starting from what the code gives the card", () => {
    const db = openDb(":memory:");
    const p = Object.fromEntries(currentPolicy(db).map((r) => [r.key, r]));
    expect(p["card.sourcing.hours"]).toMatchObject({ value: "", display: "any time (no hours set)", kind: "text", agent: "sourcing" });
    expect(p["card.sourcing.mccs"]).toMatchObject({ value: "5734", kind: "text" });
    expect(p["card.support.mccs"]).toMatchObject({ value: "7372" });
    expect(p["card.treasury.currencies"]).toMatchObject({ value: "EUR" });
  });

  it("validates a change before it can be proposed", () => {
    const db = openDb(":memory:");
    expect(validateChange(db, { key: "card.sourcing.hours", from: "", to: OFFICE })).toBeNull();
    expect(validateChange(db, { key: "card.sourcing.hours", from: "", to: "Mon-Fri 18:00-08:00 Europe/Amsterdam" })).toMatch(/hours/);
    expect(validateChange(db, { key: "card.sourcing.mccs", from: "5734", to: "5734,7372" })).toBeNull();
    expect(validateChange(db, { key: "card.sourcing.mccs", from: "5734", to: "" })).toMatch(/merchant categor/);
    expect(validateChange(db, { key: "card.sourcing.currencies", from: "EUR", to: "EUR,usd" })).toMatch(/currenc/);
    expect(mccListProblem("5734, 7372")).toBeNull();
    expect(currencyListProblem("EUR,EUR")).toMatch(/twice/);
  });
});

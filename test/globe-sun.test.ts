// The globe's day and night (src/ui/globe.ts): the subsolar point and the Sun's height at a place, against known
// moments (equinox, solstices, the equation of time in early November) and places whose day or night is plain.
import { describe, expect, it } from "vitest";
import { globeScript, SUBSOLAR_JS, subsolar, sunAltitude } from "../src/ui/globe.js";

const at = (iso: string) => Date.parse(iso);
const AMSTERDAM = [52.37, 4.9] as const, SYDNEY = [-33.87, 151.21] as const, TOKYO = [35.68, 139.69] as const, NEW_YORK = [40.71, -74.01] as const;

describe("the subsolar point", () => {
  it("is on the equator at the equinox and on the tropics at the solstices", () => {
    expect(subsolar(at("2026-03-20T12:00:00Z"))[1]).toBeCloseTo(0, 0);
    expect(subsolar(at("2026-06-21T12:00:00Z"))[1]).toBeCloseTo(23.44, 1);
    expect(subsolar(at("2026-12-21T12:00:00Z"))[1]).toBeCloseTo(-23.43, 1);
  });
  it("stands near Greenwich at 12:00 UTC, less the equation of time (about 16 minutes early in November)", () => {
    const [lon] = subsolar(at("2026-11-03T12:00:00Z"));
    expect(lon).toBeGreaterThan(-5); expect(lon).toBeLessThan(-3);
    expect(Math.abs(subsolar(at("2026-06-21T12:00:00Z"))[0])).toBeLessThan(1);
  });
  it("moves 15 degrees west an hour and stays in -180..180", () => {
    for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const [lon] = subsolar(at(`2026-11-26T${String(h).padStart(2, "0")}:00:00Z`));
      expect(lon).toBeGreaterThanOrEqual(-180); expect(lon).toBeLessThan(180);
      const want = ((180 - h * 15 + 540) % 360) - 180, d = ((lon - want + 540) % 360) - 180;
      expect(Math.abs(d)).toBeLessThan(4);
    }
  });
});

describe("day and night at a place", () => {
  const day = (p: readonly [number, number], iso: string) => sunAltitude(p[0], p[1], at(iso)) > 0;
  it("Amsterdam is in daylight at 12:00 UTC and in the dark at 00:00 UTC, summer and winter", () => {
    for (const d of ["2026-06-21", "2026-11-26", "2027-01-15"]) { expect(day(AMSTERDAM, `${d}T12:00:00Z`)).toBe(true); expect(day(AMSTERDAM, `${d}T00:00:00Z`)).toBe(false); }
    expect(sunAltitude(...AMSTERDAM, at("2026-11-26T12:00:00Z"))).toBeCloseTo(16.5, 0);
  });
  it("the other side of the world the other way round", () => {
    expect(day(SYDNEY, "2026-11-26T00:00:00Z")).toBe(true); expect(day(SYDNEY, "2026-11-26T12:00:00Z")).toBe(false);
    expect(day(TOKYO, "2026-11-26T03:00:00Z")).toBe(true); expect(day(TOKYO, "2026-11-26T12:00:00Z")).toBe(false);
    expect(day(NEW_YORK, "2026-11-26T17:00:00Z")).toBe(true); expect(day(NEW_YORK, "2026-11-26T05:00:00Z")).toBe(false);
  });
});

describe("the page's script", () => {
  it("carries the same computation, written out as plain JavaScript (the same bytes whatever compiles the page)", () => {
    const fn = new Function(`return (${SUBSOLAR_JS});`)() as typeof subsolar;
    for (let ms = Date.parse("2026-01-01T00:00:00Z"); ms < Date.parse("2028-01-01T00:00:00Z"); ms += 7 * 3600_000 + 13 * 60_000) expect(fn(ms)).toEqual(subsolar(ms));
    expect(globeScript({ selector: "canvas", places: [] })).toContain(`var SUN = ${SUBSOLAR_JS},`);
    expect(globeScript({ selector: "canvas", places: [] })).not.toContain("subsolar(ms)");
  });
});

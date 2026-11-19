// The shields.io endpoint badges in docs/badges/ (src/proof/badges.ts, npm run badges): each file is exactly what its
// committed record gives, follows the endpoint schema, and no badge exists without its record (no mutation record is
// committed, so no mutation badge). The figures are read here from the records a second way, not through the module.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGE_RECORDS, BUILD, badgeFile, badgeJson, badges } from "../src/proof/badges.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));

describe("shields endpoint badges from the records", () => {
  const made = badges(ROOT);

  it("each committed badge file is what its record gives, byte for byte (run npm run badges if not)", () => {
    expect(made.length).toBeGreaterThanOrEqual(4);
    for (const { name, badge } of made) {
      expect(exists(badgeFile(name)), `${badgeFile(name)} missing`).toBe(true);
      expect(read(badgeFile(name))).toBe(badgeJson(badge));
    }
    const files = readdirSync(new URL("../docs/badges/", import.meta.url)).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(made.map((m) => `${m.name}.json`).sort());
  });

  it("follows the shields endpoint schema", () => {
    for (const { name } of made) {
      const b = json<Record<string, unknown>>(badgeFile(name));
      expect(b.schemaVersion).toBe(1);
      expect(typeof b.label).toBe("string");
      expect(typeof b.message).toBe("string");
      expect(["brightgreen", "green", "yellow", "orange", "red", "lightgrey"]).toContain(b.color);
      expect(exists(b.record as string)).toBe(true);
    }
  });

  it("states the records' own figures", () => {
    const tamper = json<{ totals: { tried: number; refused: number; accepted: number } }>("docs/evidence/tamper-matrix.json").totals;
    expect(json<{ message: string }>("docs/badges/tamper-matrix.json").message).toBe(`${tamper.refused.toLocaleString("en-US")}/${tamper.tried.toLocaleString("en-US")} refused`);

    const awx = json<{ totals: { endpoints: number; live: number } }>("docs/evidence/airwallex-api-coverage.json").totals;
    expect(json<{ message: string }>("docs/badges/airwallex-endpoints.json").message).toBe(`${awx.live}/${awx.endpoints}`);

    const chaos = json<{ totals: { scenarios: number }; invariants: Record<string, { broken: number }> }>("docs/evidence/chaos-money.json");
    const broken = Object.values(chaos.invariants).reduce((s, i) => s + i.broken, 0);
    expect(json<{ message: string }>("docs/badges/chaos.json").message).toBe(`${broken} in ${chaos.totals.scenarios.toLocaleString("en-US")} scenarios`);

    const fuzz = json<{ totals: { runs: number; properties: number; failed: number } }>("docs/evidence/fuzzing.json").totals;
    const f = json<{ message: string; color: string }>("docs/badges/fuzz.json");
    expect(f.message).toBe(`${fuzz.runs.toLocaleString("en-US")} · ${fuzz.failed}/${fuzz.properties} properties failed`);
    // Failed properties are never shown green.
    expect(f.color).toBe(fuzz.failed === 0 ? "brightgreen" : "orange");

    const dafny = json<{ verifier: string; totals: { verified: number; errors: number } }>("docs/evidence/formal-proofs.json");
    const d = json<{ message: string; color: string }>("docs/badges/dafny.json");
    expect(dafny.verifier).toBe(`Dafny program verifier finished with ${dafny.totals.verified} verified, ${dafny.totals.errors} errors`);
    expect(d.message).toBe(`${dafny.totals.verified} verified, ${dafny.totals.errors} errors`);
    expect(d.color).toBe(dafny.totals.errors === 0 ? "brightgreen" : "red");
    // Coverage of the product's measured scope, from the counts (docs/evidence/coverage.md); bright green only at OpenSSF
    // gold's bar of 90% statements and 80% branches, which the record does not reach.
    const cov = json<{ scopes: { product: { after: Record<"statements" | "branches", { covered: number; total: number }> } } }>("docs/evidence/coverage.json").scopes.product.after;
    const pct = (k: "statements" | "branches") => ((cov[k].covered / cov[k].total) * 100).toFixed(1);
    const c = json<{ message: string; color: string }>("docs/badges/coverage.json");
    expect(c.message).toBe(`${pct("statements")}% statements · ${pct("branches")}% branches`);
    expect(c.color).toBe(Number(pct("statements")) >= 90 && cov.branches.covered / cov.branches.total >= 0.8 ? "brightgreen" : "green");
  });

  it("writes no mutation badge while no mutation record is committed", () => {
    expect(exists(BADGE_RECORDS.mutation)).toBe(false);
    expect(exists(badgeFile("mutation"))).toBe(false);
  });

  it("turns red on a broken figure, and refuses a record without its figure", () => {
    expect(BUILD["tamper-matrix"]({ totals: { tried: 10, refused: 9, accepted: 1 } }).color).toBe("red");
    expect(BUILD.chaos({ totals: { scenarios: 3 }, invariants: { I1: { broken: 1 }, I2: { broken: 0 } } })).toEqual({ label: "chaos invariants broken", message: "1 in 3 scenarios", color: "red" });
    expect(() => BUILD.fuzz({ totals: { runs: 5 } })).toThrow(/not a count/);
    expect(() => BUILD["airwallex-endpoints"]({})).toThrow(/no totals/);
    expect(BUILD.coverage({ scopes: { product: { after: { statements: { covered: 90, total: 100 }, branches: { covered: 80, total: 100 } } } } })).toEqual({ label: "coverage", message: "90.0% statements · 80.0% branches", color: "brightgreen" });
    expect(() => BUILD.coverage({ scopes: { product: { after: { statements: { covered: 5, total: 4 }, branches: { covered: 1, total: 2 } } } } })).toThrow(/not a share/);
    expect(() => BUILD.coverage({ scopes: {} })).toThrow(/no product scope/);
  });
});

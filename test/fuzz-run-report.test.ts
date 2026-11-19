// The fuzzing runner and its report (src/fuzz/run.ts, npm run fuzz): a failing property is kept with a shrunk
// counterexample and the seed and path that replay it; the field-by-field sweep of a committed bundle and receipt finds
// no forgery; the report's totals and Markdown say what ran, what failed and what each finding means.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FuzzContext, FuzzProperty } from "../src/fuzz/properties.js";
import { CANONICALIZATION, FINDING_NOTES, fuzzContext, fuzzMarkdown, fuzzReport, runProperty, sweepArtifacts, type FuzzResult } from "../src/fuzz/run.js";

const EMPTY: FuzzContext = { bundles: [], receipts: [] };
const prop = (id: string, make: FuzzProperty["make"], notes?: () => string): FuzzProperty => ({ id, target: "src/x.ts", what: `${id} holds`, runs: 50, timeLimitMs: 5_000, make, ...(notes ? { notes } : {}) });

describe("runProperty", () => {
  it("passes a property that holds, with the seed it was given and its notes", async () => {
    const r = await runProperty(prop("holds", () => fc.property(fc.integer(), (n) => n + 0 === n), () => "slowest 1 ms"), EMPTY, { seed: 5, runs: 40 });
    expect(r).toMatchObject({ id: "holds", status: "PASS", runs_asked: 40, runs_done: 40, seed: 5, interrupted: false, notes: "slowest 1 ms" });
    expect(r).not.toHaveProperty("counterexample");
  });

  it("scales the property's own runs and time limit for the nightly run", async () => {
    const r = await runProperty(prop("scaled", () => fc.property(fc.boolean(), () => true)), EMPTY, { seed: 1, scale: 2 });
    expect(r).toMatchObject({ runs_asked: 100, runs_done: 100, time_limit_ms: 10_000 });
  });

  it("keeps a failure shrunk, with what broke and the path that replays it", async () => {
    const p = prop("fails", () => fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => { if (n >= 10) throw new Error(`too big: ${n}`); return true; }));
    const r = await runProperty(p, EMPTY, { seed: 99, runs: 200 });
    expect(r.status).toBe("FAIL");
    // Shrunk to the smallest counterexample.
    expect(r.counterexample).toBe("[10]");
    expect(r.error).toContain("too big: 10");
    expect(r.shrinks).toBeGreaterThan(0);
    expect(r.path).toMatch(/^\d+(:\d+)*$/);
    // The path replays the same counterexample straight away.
    const again = await runProperty(p, EMPTY, { seed: 99, runs: 200, path: r.path });
    expect(again).toMatchObject({ status: "FAIL", counterexample: "[10]" });
  });

  it("says a property that returned false, and shows values JSON cannot (bigint, NaN, -0, Map, Set, undefined)", async () => {
    const odd = [10n, Number.NaN, -0, new Map([["k", 1]]), new Set([2]), undefined];
    const r = await runProperty(prop("false", () => fc.property(fc.constant(odd), () => false)), EMPTY, { seed: 3, runs: 5 });
    expect(r.status).toBe("FAIL");
    expect(r.error).toMatch(/false/i);
    expect(r.counterexample).toBe('[["10n","NaN","-0",[["k",1]],[2],"undefined"]]');
  });

  it("shows a counterexample JSON cannot write at all as text", async () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const r = await runProperty(prop("cyclic", () => fc.property(fc.constant(cyclic), () => false)), EMPTY, { seed: 3, runs: 1 });
    expect(r.counterexample).toBe("[object Object]");
  });
});

describe("sweepArtifacts", () => {
  it("changes every field of a committed bundle and receipt; only context or encodings of the same signed value still verify", async () => {
    const all = fuzzContext();
    const ctx: FuzzContext = { bundles: all.bundles.filter((b) => b.file === "docs/proof/try-paid.json"), receipts: all.receipts.slice(0, 1) };
    expect(ctx.bundles).toHaveLength(1);
    expect(ctx.receipts).toHaveLength(1);
    const s = await sweepArtifacts(ctx);
    expect(s.tried).toBeGreaterThan(100);
    expect(s.still_valid.filter((x) => x.covered === "signature")).toEqual([]);
    // The bundle's note is context (not signed); editing the terms never verifies.
    expect(s.still_valid).toContainEqual({ kind: "bundle", change: "edit", path: "note", artifacts: 1, covered: "context" });
    expect(s.still_valid.some((x) => x.path.startsWith("terms"))).toBe(false);
    // Sorted by kind, change and path.
    const keys = s.still_valid.map((x) => `${x.kind}\t${x.change}\t${x.path}\t${x.covered}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  }, 120_000);
});

describe("the fuzzing report", () => {
  const pass: FuzzResult = { id: "terms-order-whitespace", target: "src/lib/terms.ts", what: "order | whitespace", status: "PASS", runs_asked: 10_000, runs_done: 9_000, skipped: 1_200, ms: 4_250, time_limit_ms: 60_000, interrupted: true, seed: 1, notes: "slowest 3 ms" };
  const fail: FuzzResult = { id: "bundle-malformed", target: "src/proof/bundle.ts", what: "malformed bundles", status: "FAIL", runs_asked: 500, runs_done: 12, skipped: 0, ms: 300, time_limit_ms: 60_000, interrupted: false, seed: 7, counterexample: "[`a`]", error: "InvalidCharacterError", shrinks: 4, path: "3:1" };
  const failNoNote: FuzzResult = { ...fail, id: "new-finding", counterexample: undefined, shrinks: undefined };
  const sweep = { tried: 1234, still_valid: [
    { kind: "bundle", change: "edit", path: "note", artifacts: 2, covered: "context" as const },
    { kind: "bundle", change: "edit", path: "public_key.cose", artifacts: 2, covered: "same key" as const },
    { kind: "receipt", change: "edit", path: "terms.amount", artifacts: 1, covered: "signature" as const },
  ] };
  const ctx: FuzzContext = { bundles: [{ file: "b1.json", value: {} }, { file: "b2.json", value: {} }], receipts: [{ file: "r1.json", value: {} }] };

  it("totals the runs, passes, failures and time, and lists the artifacts", () => {
    const r = fuzzReport([pass, fail], ctx, "2026-11-19", sweep);
    expect(r.format).toBe("purser.fuzzing/v1");
    expect(r.totals).toEqual({ properties: 2, runs: 9_012, passed: 1, failed: 1, ms: 4_550 });
    expect(r.artifacts).toEqual({ bundles: ["b1.json", "b2.json"], receipts: ["r1.json"] });
    expect(r.canonicalization).toBe(CANONICALIZATION);
  });

  it("writes each property's runs and result, each failure with its replay and meaning, and the sweep", () => {
    const md = fuzzMarkdown(fuzzReport([pass, fail, failNoNote], ctx, "2026-11-19", sweep));
    expect(md).toContain("**3 properties, 9,024 runs, 1 held, 2 failed** (5 s)");
    expect(md).toContain("2 proof bundles and 1 receipts.");
    expect(md).toContain("| `terms-order-whitespace`: order \\| whitespace | src/lib/terms.ts | 9,000 of 10,000 (1,200 skipped by a precondition), time limit reached | 4.3 s; slowest 3 ms | held |");
    expect(md).toContain("| `bundle-malformed`: malformed bundles | src/proof/bundle.ts | 12 of 500 | 0.3 s | **FAILED** |");
    expect(md).not.toContain("No property failed.");
    expect(md).toContain("### `bundle-malformed` failed");
    expect(md).toContain("- Counterexample (shrunk 4 times): `['a']`");
    expect(md).toContain("- Replay: `npm run fuzz -- --only bundle-malformed --seed 7 --path 3:1`");
    expect(md).toContain(FINDING_NOTES["bundle-malformed"]!);
    expect(md).toContain("- Counterexample (shrunk 0 times): ``");
    expect(md).toContain("1,234 changed copies");
    expect(md).toContain("| bundle | edit | `note` | 2 | context, not signed |");
    expect(md).toContain("| bundle | edit | `public_key.cose` | 2 | same key: an encoding of the same signed value |");
    expect(md).toContain("| receipt | edit | `terms.amount` | 1 | **covered by the signature: a forgery** |");
    expect(md).toContain("Rows covered by the signature that still verify (a forgery): 1.");
    for (const c of CANONICALIZATION) expect(md).toContain(`- ${c}`);
  });

  it("says no property failed when none did", () => {
    const md = fuzzMarkdown(fuzzReport([pass], ctx, "2026-11-19", { tried: 0, still_valid: [] }));
    expect(md).toContain("No property failed.");
    expect(md).toContain("Rows covered by the signature that still verify (a forgery): 0.");
  });
});

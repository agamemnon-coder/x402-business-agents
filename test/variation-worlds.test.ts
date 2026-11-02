// D26: the seeded world generator of the variation test. Breaks if a seed does not give the same world every time, if
// worlds stop varying, or if a world can say something impossible (a wrong sale outside the dispute, a price rise after
// the last query, a third supplier in a one-supplier world).
import { describe, expect, it } from "vitest";
import { generateWorld, generateWorlds, rng } from "../src/evals/worlds.js";

const MANY = Array.from({ length: 300 }, (_, i) => generateWorld(i + 1));

describe("the seeded world generator", () => {
  it("is deterministic per seed and pure", () => {
    expect(generateWorld(7)).toEqual(generateWorld(7));
    expect(JSON.stringify(generateWorld(123))).toBe(JSON.stringify(generateWorld(123)));
    const r1 = rng(42), r2 = rng(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(generateWorlds(5, 3).map((w) => w.seed)).toEqual([5, 6, 7]);
  });

  it("varies across seeds in every parameter", () => {
    const distinct = (f: (w: (typeof MANY)[number]) => unknown) => new Set(MANY.map((w) => JSON.stringify(f(w)))).size;
    expect(new Set(MANY.map((w) => JSON.stringify(w))).size).toBe(MANY.length);
    expect(distinct((w) => w.suppliers)).toBe(3);
    expect(distinct((w) => w.dispute.kind)).toBe(3);
    expect(distinct((w) => w.moneyIn)).toBe(3);
    expect(distinct((w) => w.cardDecline)).toBe(2);
    expect(distinct((w) => w.stockline.afterCents)).toBeGreaterThan(2);
    expect(distinct((w) => w.priceRiseAfter)).toBeGreaterThan(3);
    expect(distinct((w) => w.invoiceEurCents)).toBeGreaterThan(2);
    expect(distinct((w) => w.ridgeline?.ageSeconds ?? null)).toBeGreaterThan(5);
  });

  it("never describes an impossible world", () => {
    for (const w of MANY) {
      expect(w.stockline.beforeCents).toBeLessThanOrEqual(w.capCents);
      expect(w.stockline.afterCents).toBeGreaterThan(w.stockline.beforeCents);
      expect(w.sellCents).toBeGreaterThan(w.stockline.beforeCents);
      expect(w.priceRiseAfter).toBeGreaterThanOrEqual(1);
      expect(w.priceRiseAfter).toBeLessThan(w.queries);
      expect(w.ridgeline === null).toBe(w.suppliers === 1);
      expect(w.third === null).toBe(w.suppliers !== 3);
      if (w.ridgeline) {
        expect(w.ridgeline.unavailableOf20).toBeGreaterThanOrEqual(0);
        expect(w.ridgeline.unavailableOf20).toBeLessThanOrEqual(15);
      }
      const { kind, seqs, wrong } = w.dispute;
      expect(seqs.length).toBeGreaterThanOrEqual(3);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seqs.every((s) => s >= 1 && s <= w.history)).toBe(true);
      expect(wrong.every((s) => seqs.includes(s))).toBe(true);
      if (kind === "false") expect(wrong).toEqual([]);
      if (kind === "justified") expect(wrong).toEqual(seqs);
      if (kind === "partly") { expect(wrong.length).toBeGreaterThan(0); expect(wrong.length).toBeLessThan(seqs.length); }
      expect(w.invoiceEurCents).toBeGreaterThan(0);
    }
  });
});

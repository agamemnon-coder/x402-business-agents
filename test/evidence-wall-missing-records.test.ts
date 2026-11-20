// The evidence wall (src/redesign/evidenceWallData.ts) when its records are not in the checkout: a tile whose record is
// missing is left out, never filled with a guessed figure, and the wall still renders from what remains. The records are
// hidden from this test's file system only while the wall is computed (the files are not touched).
import { readFileSync as realRead } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hide: null as RegExp | null }));
vi.mock("node:fs", async (orig) => {
  const fs = await orig<typeof import("node:fs")>();
  const hidden = (p: unknown) => !!state.hide && state.hide.test(String(p).replace(/\\/g, "/"));
  const enoent = (p: unknown) => Object.assign(new Error(`ENOENT: no such file or directory, open '${String(p)}'`), { code: "ENOENT" });
  const existsSync = (p: Parameters<typeof fs.existsSync>[0]) => (hidden(p) ? false : fs.existsSync(p));
  const readFileSync = ((p: Parameters<typeof fs.readFileSync>[0], o?: Parameters<typeof fs.readFileSync>[1]) => { if (hidden(p)) throw enoent(p); return fs.readFileSync(p, o as never); }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, existsSync, readFileSync }, existsSync, readFileSync };
});

const { evidenceWall } = await import("../src/redesign/evidenceWallData.js");
const { evidenceWallHtml } = await import("../src/redesign/evidenceWall.js");

/** Every record path the wall's own code names (its tiles' sources). */
const RECORDS = [...new Set(realRead(new URL("../src/redesign/evidenceWallData.ts", import.meta.url), "utf8").match(/"docs\/[^"]+"/g)!.map((s) => s.slice(1, -1)))];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keys = (w: ReturnType<typeof evidenceWall>) => w.groups.flatMap((g) => g.tiles.map((t) => t.key));
const withHidden = <T>(re: RegExp, f: () => T): T => { state.hide = re; try { return f(); } finally { state.hide = null; } };

describe("the evidence wall without its records", () => {
  const full = evidenceWall();

  it("with every record the wall names hidden, the tiles that read them are gone and none is guessed", () => {
    const re = new RegExp(`/(${RECORDS.map(esc).join("|")})$`);
    const bare = withHidden(re, () => evidenceWall());
    const kept = keys(bare);
    expect(kept.length).toBeLessThan(keys(full).length);
    // Each remaining tile is one the full wall has too, with the same figure: nothing new appears, nothing is changed.
    const fullTiles = new Map(full.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
    for (const g of bare.groups) for (const t of g.tiles) expect(t.fig, t.key).toBe(fullTiles.get(t.key)!.fig);
    // Gone: the tiles whose figures live in those records.
    for (const k of ["spend-bills", "alta-refusals-more"]) if (fullTiles.has(k)) expect(kept).not.toContain(k);
    expect(bare.groups.every((g) => g.tiles.length > 0)).toBe(true);
    const html = withHidden(re, () => evidenceWallHtml(bare));
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("the records of each folder hidden on their own take away at most their own tiles", () => {
    const fullKeys = keys(full);
    let removed = 0;
    for (const dir of ["docs/evals/", "docs/evidence/", "docs/runs/2026-11-1", "docs/runs/2026-11-2", "docs/runs/c", "docs/redteam/", "docs/assurance.md"]) {
      const these = RECORDS.filter((p) => p.startsWith(dir));
      expect(these.length, dir).toBeGreaterThan(0);
      const w = withHidden(new RegExp(`/(${these.map(esc).join("|")})$`), () => evidenceWall());
      const k = keys(w);
      for (const x of k) expect(fullKeys, `${dir}: ${x}`).toContain(x);
      removed += fullKeys.length - k.length;
    }
    expect(removed).toBeGreaterThan(0);
  });
});

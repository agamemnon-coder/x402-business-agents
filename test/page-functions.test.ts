// Code sent to the browser must not lean on a bundler's helper (19 Nov). Walk 2 of the /try mega run
// (docs/runs/2026-11-19-mega-run.md) stopped with "page.evaluate: ReferenceError: __name is not defined": a named
// helper had been put inside the function scripts/try-live-record.ts hands to page.evaluate, tsx (esbuild with
// keepNames) wrapped it in __name(...), and the function's source, run in the page, met no __name there. The site's
// steps had passed; the recording script stopped. This transforms every file that hands functions to a browser the way
// tsx does and holds each such function free of __name, so the same stop cannot come back unseen.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_CALLS, pageFunctionsUsingHelpers } from "./support/pageFunctions.js";

const ROOT = new URL("../", import.meta.url);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SENDS_CODE = new RegExp(`\\.(${BROWSER_CALLS.map(escapeRegExp).join("|")})\\(`);

/** Every TypeScript file under these folders that hands something to a browser call. */
function browserDrivers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p); }
      else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) && SENDS_CODE.test(readFileSync(new URL(p, ROOT), "utf8"))) out.push(p);
    }
  };
  for (const d of ["scripts", "src", "test/browser"]) walk(d);
  return out.sort();
}

describe("functions handed to the browser carry no bundler helper", () => {
  it("finds walk 2's stop: a named helper inside page.evaluate gets __name under tsx", () => {
    // The shape of walk 2's change (a helper to wait between event reads), not its exact text.
    const walk2 = `
      export async function events(p: { evaluate<T>(f: () => Promise<T>): Promise<T> }) {
        return p.evaluate(async () => {
          const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
          await pause(600);
          return [];
        });
      }`;
    const found = pageFunctionsUsingHelpers(walk2, "walk2.ts");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ call: "evaluate" });
    expect(found[0]!.code).toMatch(/__name\(/);
  });

  it("lets an inline arrow, and a named helper outside the page function, through", () => {
    const fine = `
      const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
      export async function read(p: { evaluate<T>(f: () => Promise<T>): Promise<T>; waitForFunction(f: () => boolean): Promise<unknown> }) {
        await later(10);
        await p.waitForFunction(() => document.readyState === "complete");
        return p.evaluate(async () => { await new Promise((r) => setTimeout(r, 600)); return document.title; });
      }`;
    expect(pageFunctionsUsingHelpers(fine, "fine.ts")).toEqual([]);
  });

  it("scripts/try-live-record.ts, the /try walk's recorder, is among the files checked", () => {
    expect(browserDrivers()).toContain(join("scripts", "try-live-record.ts"));
  });

  it("no file in scripts, src or test/browser hands the browser a function that needs __name", () => {
    const found = browserDrivers().flatMap((f) => pageFunctionsUsingHelpers(readFileSync(new URL(f, ROOT), "utf8"), f).map((x) => `${f} ${x.call}: ${x.code.slice(0, 120)}`));
    expect(found).toEqual([]);
  });
});

// Every transaction hash and Airwallex id the public surfaces name is in a run record (master list 526, part 1). The
// surfaces: README.md, llms.txt, docs/claims.md and every page the site serves (buildPages). The records: every file
// under docs/runs and docs/demo. A full hash (0x and 64 hex digits) and a UUID-shaped id (Airwallex's transfers,
// conversions, authorizations and requests) must appear as written; a shortened hash ("0x2e92f9cb…1871") must match a
// full one in a record. Breaks when a page or doc names an id that no record holds. Offline: the external links are
// checked by `npm run links:external` (scripts/linkcheck-external.ts), never in this suite.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const RECORDS = [...walk(join(ROOT, "docs/runs")), ...walk(join(ROOT, "docs/demo"))].map((f) => readFileSync(f, "latin1").toLowerCase()).join("\n");
const PAGES = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
const SURFACES: [string, string][] = [
  ["README.md", read("README.md")], ["llms.txt", read("llms.txt")], ["docs/claims.md", read("docs/claims.md")],
  ...Object.entries(PAGES).map(([k, v]): [string, string] => [`page ${k}`, typeof v === "string" ? v : JSON.stringify(v)]),
];
const FULL = /0x[0-9a-f]{64}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SHORT = /(0x[0-9a-f]{6,12})(?:…|\.\.\.)([0-9a-f]{4,8})\b/gi;

describe("ids on the public surfaces are in a run record", () => {
  it("reads the surfaces and finds ids in them (the check is not empty)", () => {
    expect(SURFACES.length).toBeGreaterThan(5);
    expect(SURFACES.reduce((n, [, t]) => n + (t.match(FULL)?.length ?? 0), 0)).toBeGreaterThan(50);
  });

  it("finds every full transaction hash and Airwallex id in docs/runs or docs/demo", () => {
    const missing = SURFACES.flatMap(([name, t]) => [...t.matchAll(FULL)].map((m) => m[0]).filter((id) => !RECORDS.includes(id.toLowerCase())).map((id) => `${name}: ${id}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("matches every shortened hash to a full one in a record", () => {
    const missing = SURFACES.flatMap(([name, t]) => [...t.matchAll(SHORT)]
      .filter((m) => !new RegExp(`${m[1]!.toLowerCase()}[0-9a-f]*${m[2]!.toLowerCase()}\\b`).test(RECORDS)).map((m) => `${name}: ${m[0]}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});

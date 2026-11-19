// docs/assurance.md (19 Nov): each invariant, the code that enforces it, its tests, the CI job and the record. Every
// file it links exists, every function it names is defined in the file it links to, and every CI job it names is a job
// in .github/workflows/ci.yml, so the table cannot point at something that is gone.
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));

const DOC = "docs/assurance.md";
const doc = read(DOC);
const rows = doc.split("\n").filter((l) => l.startsWith("| **"));
const ciJobs = new Set([...read(".github/workflows/ci.yml").matchAll(/^ {2}([a-z0-9_-]+):$/gm)].map((m) => m[1]!));

/** The repository path a link in docs/assurance.md points to, without its #anchor. */
const target = (href: string) => posix.normalize(posix.join(posix.dirname(DOC), href.split("#")[0]!));

describe("docs/assurance.md", () => {
  it("has one row per invariant, each with five cells", () => {
    expect(rows.length).toBe(6);
    for (const r of rows) expect(r.split(" | "), r.slice(0, 60)).toHaveLength(5);
  });

  it("links only files that exist", () => {
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((h) => !/^[a-z]+:/.test(h));
    expect(links.length).toBeGreaterThan(30);
    for (const h of links) expect({ h, there: exists(target(h)) }).toEqual({ h, there: true });
  });

  it("names, in every row, functions that the linked file defines", () => {
    let named = 0;
    for (const r of rows) {
      const enforced = r.split(" | ")[1]!;
      const fns = [...enforced.matchAll(/\[`([A-Za-z_$][\w$]*)`\]\(([^)]+)\)/g)];
      expect(fns.length, r.slice(0, 60)).toBeGreaterThan(0);
      for (const [, name, href] of fns) {
        const file = target(href!);
        expect(file).toMatch(/^src\/.+\.ts$/);
        const defined = new RegExp(`(?:function\\*?|class|const|let)\\s+${name!.replace(/\$/g, "\\$")}\\b`).test(read(file));
        expect({ name, file, defined }).toEqual({ name, file, defined: true });
        named++;
      }
    }
    expect(named).toBeGreaterThanOrEqual(15);
  });

  it("links at least one test per row, and each test file exists", () => {
    for (const r of rows) {
      const tests = [...r.split(" | ")[2]!.matchAll(/\]\(([^)]+)\)/g)].map((m) => target(m[1]!));
      expect(tests.length, r.slice(0, 60)).toBeGreaterThan(0);
      for (const t of tests) expect({ t, test: /^test\/.+\.(test|check)\.ts$/.test(t) && exists(t) }).toEqual({ t, test: true });
    }
  });

  it("names only CI jobs that ci.yml runs", () => {
    expect([...ciJobs]).toEqual(expect.arrayContaining(["test", "judge", "secrets"]));
    for (const r of rows) {
      const jobs = [...r.split(" | ")[3]!.matchAll(/`([a-z0-9_-]+)`/g)].map((m) => m[1]!);
      expect(jobs.length, r.slice(0, 60)).toBeGreaterThan(0);
      for (const j of jobs) expect({ j, inCi: ciJobs.has(j) }).toEqual({ j, inCi: true });
    }
  });

  it("is linked from docs/README.md", () => {
    expect(read("docs/README.md")).toContain("[assurance.md](assurance.md)");
  });
});

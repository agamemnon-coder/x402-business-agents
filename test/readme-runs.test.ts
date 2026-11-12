// The README's "What ran live" table is the run records' (src/readme/runsTable.ts): every row from liveRuns(), each
// with its record link, no figure typed in. Regenerate with `npm run readme-runs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUNS_END, RUNS_START, runsTable, withRunsTable } from "../src/readme/runsTable.js";
import { liveRuns } from "../src/redesign/runs.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README: what ran live", () => {
  it("is the table the records give now", () => {
    expect(withRunsTable(readme)).toBe(readme);
  });
  it("has one row per live run, each linking a record in this repository", () => {
    const block = readme.slice(readme.indexOf(RUNS_START), readme.indexOf(RUNS_END));
    const rows = block.split("\n").filter((l) => /^\| \d/.test(l));
    expect(rows).toHaveLength(liveRuns().length);
    for (const r of rows) expect(r).toMatch(/\]\((docs\/(runs|demo)\/[^)]+)\)/);
    expect(runsTable()).not.toMatch(/github\.com\/[^)]*\/blob\//);
  });
});
